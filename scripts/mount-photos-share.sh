#!/usr/bin/env bash
# mount-photos-share.sh — back the photo-frame directory with a CIFS/SMB share.
#
# The slideshow screensaver shows whatever is under
# /opt/smart-mirror/backend/data/photos (backend/routes/photos.js walks it).
# This script mounts a NAS share at .../photos/nas so the family can drop
# pictures on the NAS and have them appear on the mirror, without the app
# knowing anything about SMB.
#
# It is BOTH an operator tool (over SSH) and the privileged worker the Node
# backend calls through one sudoers line, so it never prompts, never takes a
# password on the command line, bounds every network call with a timeout, and
# can emit a single line of JSON for a caller to parse.
#
# Run as root (directly, or via sudo). See scripts/README-photo-share.md.

set -euo pipefail

# ---------------------------------------------------------------------------
# Defaults
# ---------------------------------------------------------------------------

PHOTO_ROOT=/opt/smart-mirror/backend/data/photos
TARGET_DEFAULT="${PHOTO_ROOT}/nas"
CRED_FILE=/etc/smb-photos.cred
FSTAB=/etc/fstab                           # --self-test points this at a temp
                                           # file; deliberately NOT settable
                                           # from the environment, so a caller
                                           # that reaches this through sudo can
                                           # never redirect a root-owned write.
FSTAB_MARKER="# smart-mirror photo share (managed by scripts/mount-photos-share.sh)"
SERVICE_UNIT=smart-mirror-backend.service  # backend/routes/system.js:28

# How long systemd waits for the mount command before giving up. This is the
# number that decides how long a readdir() inside the backend can block when
# the NAS is off, so keep it short: a UI request waiting on the photo list
# waits at most this long, once, before autofs reports the failure.
MOUNT_TIMEOUT="${SMB_MOUNT_TIMEOUT:-10}"

# SMB dialect. 3.0 is the sane pin: Synology DSM 6+, TrueNAS, Windows 8+ and
# Samba 4 all speak it, and it is the highest dialect every one of them has in
# common. `vers=default` negotiates >= 2.1 on kernels since 4.13.5, which is
# usually fine but turns a dialect problem into a confusing mount error(112)
# instead of a clean failure. Older boxes need 2.0 or 1.0 — see --help.
SMB_VERS_DEFAULT=3.0

# Attribute cache. Default is 1s, which means the screensaver's repeated
# readdir()s hit the network constantly. 60s is a photo frame: new pictures
# show up within a minute of landing on the NAS.
ACTIMEO=60

MODE=mount
JSON=0
FORCE=0
GUEST=0
PASSWORD_STDIN=0
HOST=''
SHARE=''
SUBDIR=''
SMB_USER=''
SMB_DOMAIN=''
TARGET="$TARGET_DEFAULT"
SMB_VERS="$SMB_VERS_DEFAULT"
SERVICE_USER=''

# ---------------------------------------------------------------------------
# Output helpers
#
# In --json mode stdout carries exactly one line of JSON and nothing else, so
# every human-readable word goes to stderr.
# ---------------------------------------------------------------------------

log() { if [ "$JSON" = 1 ]; then echo "$*" >&2; else echo "$*"; fi; }
warn() { echo "$*" >&2; }

json_escape() {
  # Enough for the values this script produces: quotes, backslashes, and the
  # control characters that could appear in a mount error message.
  printf '%s' "$1" | sed -e 's/\\/\\\\/g' -e 's/"/\\"/g' -e 's/\t/\\t/g' | tr -d '\000-\010\013\014\016-\037' | tr '\n' ' '
}

# die <code> <message> — machine-readable failure. The code, not the text, is
# what the backend switches on.
die() {
  local code=$1 msg=$2
  if [ "$JSON" = 1 ]; then
    printf '{"ok":false,"code":"%s","error":"%s"}\n' "$(json_escape "$code")" "$(json_escape "$msg")"
  fi
  warn "ERROR [$code]: $msg"
  exit 1
}

usage() {
  cat <<'EOF'
Back the mirror's photo frame with a CIFS/SMB share from a NAS.

USAGE
  mount-photos-share.sh --host <host> --share <share> [options]   # mount
  mount-photos-share.sh --status [--json]                         # inspect
  mount-photos-share.sh --unmount | --remove [--json]             # reverse
  mount-photos-share.sh --self-test                               # check logic
  mount-photos-share.sh --help

MOUNT OPTIONS
  --host <host>        NAS hostname or IP (required)
  --share <name>       Share name, e.g. "photo" or "Family Photos" (required)
  --subdir <path>      Folder inside the share to mount instead of its root
  --user <name>        SMB username (omit with --guest)
  --domain <name>      SMB domain / workgroup
  --guest              Anonymous mount, no username or password
  --password-stdin     Read the password from stdin (first line). PREFERRED.
  --target <path>      Mount point. Default: /opt/smart-mirror/backend/data/photos/nas
                       Must be under that photos directory or under /mnt/.
  --vers <dialect>     SMB dialect. Default 3.0. Use 2.0 for a DSM 5-era
                       Synology, 1.0 only for a NAS too old for anything else
                       (SMB1 is insecure and disabled in some kernels).
  --service-user <u>   User the mirror runs as, for uid/gid. Auto-detected
                       from smart-mirror-backend.service.
  --force              Mount over a non-empty directory, or replace a mount
                       that is already there from a different share.
  --json               One line of JSON on stdout, everything else on stderr.

PASSWORD
  Never passed as an argument — argv is world-readable in `ps`. Use
  --password-stdin (works under sudo) or the SMB_PASSWORD environment
  variable (does NOT survive sudo unless env_keep is set).

  printf '%s' "$pw" | mount-photos-share.sh --host nas --share photo \
      --user mirror --password-stdin

ENVIRONMENT
  SMB_PASSWORD         Password, if not using --password-stdin
  SMB_MOUNT_TIMEOUT    Seconds systemd waits for the mount (default 10)

EXIT
  0 on success. Non-zero on failure; with --json the "code" field is one of:
  bad_args, not_root, missing_tools, install_failed, invalid_target,
  target_not_empty, already_mounted_elsewhere, bad_credentials,
  host_unreachable, share_not_found, dialect_unsupported, mount_failed,
  fstab_write_failed, not_mounted.
EOF
}

# ---------------------------------------------------------------------------
# Argument parsing
# ---------------------------------------------------------------------------

while [ $# -gt 0 ]; do
  case "$1" in
    --host) HOST="${2:-}"; shift 2 ;;
    --share) SHARE="${2:-}"; shift 2 ;;
    --subdir) SUBDIR="${2:-}"; shift 2 ;;
    --user|--username) SMB_USER="${2:-}"; shift 2 ;;
    --domain) SMB_DOMAIN="${2:-}"; shift 2 ;;
    --target) TARGET="${2:-}"; shift 2 ;;
    --vers) SMB_VERS="${2:-}"; shift 2 ;;
    --service-user) SERVICE_USER="${2:-}"; shift 2 ;;
    --guest) GUEST=1; shift ;;
    --password-stdin) PASSWORD_STDIN=1; shift ;;
    --force) FORCE=1; shift ;;
    --json) JSON=1; shift ;;
    --status) MODE=status; shift ;;
    --unmount|--umount|--remove) MODE=remove; shift ;;
    --self-test) MODE=selftest; shift ;;
    -h|--help) usage; exit 0 ;;
    *) die bad_args "unknown argument: $1 (see --help)" ;;
  esac
done

# ---------------------------------------------------------------------------
# Validation — this is a trust boundary. The Settings UI hands these values to
# a root process that writes /etc/fstab, so a newline in a share name must not
# be able to append a second fstab entry.
# ---------------------------------------------------------------------------

# True if $1 contains any control character. Strip-and-compare rather than
# `grep [[:cntrl:]]`, because grep works line by line and would never see the
# one character that matters most here: the newline that could append a second
# entry to /etc/fstab. Multi-byte Hebrew survives (only 0x00-0x1f and 0x7f go).
has_control_chars() {
  local stripped
  stripped=$(printf '%s' "$1" | LC_ALL=C tr -d '\000-\037\177')
  [ "${#stripped}" -ne "${#1}" ]
}

validate_common() {
  [ -n "$HOST" ] || die bad_args "--host is required"
  [ -n "$SHARE" ] || die bad_args "--share is required"

  # Hostname or IPv4. Deliberately narrow: no spaces, no slashes, no shell or
  # fstab metacharacters can reach /etc/fstab through here.
  case "$HOST" in
    *[!A-Za-z0-9._-]*) die bad_args "--host may only contain letters, digits, dot, dash and underscore" ;;
  esac

  # Share names legitimately contain spaces and Hebrew, so only the characters
  # that would break the fstab device field or forge a path are rejected.
  case "$SHARE" in
    */*|*\\*) die bad_args "--share is a single share name, not a path (use --subdir)" ;;
  esac
  has_control_chars "$SHARE" && die bad_args "--share contains control characters"

  if [ -n "$SUBDIR" ]; then
    SUBDIR="${SUBDIR#/}"; SUBDIR="${SUBDIR%/}"
    case "$SUBDIR" in
      *..*) die bad_args "--subdir may not contain '..'" ;;
      *\\*) die bad_args "--subdir must use forward slashes" ;;
    esac
    has_control_chars "$SUBDIR" && die bad_args "--subdir contains control characters"
  fi

  has_control_chars "$SMB_USER" && die bad_args "--user contains control characters"
  has_control_chars "$SMB_DOMAIN" && die bad_args "--domain contains control characters"

  case "$SMB_VERS" in
    1.0|2.0|2.1|3.0|3.02|3.1.1|default) ;;
    *) die bad_args "--vers must be one of 1.0 2.0 2.1 3.0 3.02 3.1.1 default" ;;
  esac

  case "$MOUNT_TIMEOUT" in
    ''|*[!0-9]*) die bad_args "SMB_MOUNT_TIMEOUT must be a whole number of seconds" ;;
  esac
}

# Keep a bad --target from mounting over /etc, the app itself, or the photos
# directory root (which would shadow the committed README.md and make the
# checkout look dirty to the OTA updater).
validate_target() {
  TARGET="${TARGET%/}"
  case "$TARGET" in
    /*) ;;
    *) die invalid_target "--target must be an absolute path" ;;
  esac
  case "$TARGET" in
    *..*) die invalid_target "--target may not contain '..'" ;;
  esac
  has_control_chars "$TARGET" && die invalid_target "--target contains control characters"
  case "$TARGET" in
    "${PHOTO_ROOT}"/?*) ;;
    /mnt/?*) ;;
    *) die invalid_target "--target must be under ${PHOTO_ROOT}/ or /mnt/ (got: ${TARGET})" ;;
  esac
}

require_root() {
  [ "$(id -u)" = 0 ] || die not_root "must run as root (use sudo)"
}

# ---------------------------------------------------------------------------
# fstab handling
# ---------------------------------------------------------------------------

# fstab fields are whitespace-separated; a literal space in a share name or
# mount point has to be written as \040. (getmntent(3) octal escapes.)
fstab_escape() {
  printf '%s' "$1" | sed -e 's/\\/\\134/g' -e 's/ /\\040/g' -e 's/\t/\\011/g'
}

# Replace-or-append, keyed on the mount point, so running this twice leaves one
# entry rather than two. Writes through a temp file and only swaps it in after
# a line-count check: a bug in the rewrite must not be able to eat /etc/fstab.
fstab_write_entry() {
  local src=$1 tgt=$2 opts=$3
  local tmp keep_lines new_lines line
  line="${src} ${tgt} cifs ${opts} 0 0"

  [ -f "$FSTAB" ] || : > "$FSTAB"

  keep_lines=$(awk -v tgt="$tgt" -v marker="$FSTAB_MARKER" '
    $0 == marker { next }
    $0 !~ /^[[:space:]]*#/ && $2 == tgt { next }
    { n++ } END { print n+0 }' "$FSTAB")

  tmp=$(mktemp "${FSTAB}.XXXXXX") || die fstab_write_failed "could not create a temp file next to ${FSTAB}"
  awk -v tgt="$tgt" -v marker="$FSTAB_MARKER" -v line="$line" '
    $0 == marker { next }
    $0 !~ /^[[:space:]]*#/ && $2 == tgt { next }
    { print }
    END { print marker; print line }' "$FSTAB" > "$tmp"

  new_lines=$(awk 'END { print NR+0 }' "$tmp")
  if [ "$new_lines" -ne "$((keep_lines + 2))" ]; then
    rm -f "$tmp"
    die fstab_write_failed "refusing to write ${FSTAB}: expected $((keep_lines + 2)) lines, got ${new_lines}"
  fi

  cp -p "$FSTAB" "${FSTAB}.bak-smart-mirror" 2>/dev/null || true
  chmod 644 "$tmp"
  chown root:root "$tmp" 2>/dev/null || true
  mv "$tmp" "$FSTAB"
}

fstab_remove_entry() {
  local tgt=$1 tmp
  [ -f "$FSTAB" ] || return 0
  grep -q -F -- " ${tgt} " "$FSTAB" || grep -q -F -- "$FSTAB_MARKER" "$FSTAB" || return 0

  tmp=$(mktemp "${FSTAB}.XXXXXX") || die fstab_write_failed "could not create a temp file next to ${FSTAB}"
  awk -v tgt="$tgt" -v marker="$FSTAB_MARKER" '
    $0 == marker { next }
    $0 !~ /^[[:space:]]*#/ && $2 == tgt { next }
    { print }' "$FSTAB" > "$tmp"

  cp -p "$FSTAB" "${FSTAB}.bak-smart-mirror" 2>/dev/null || true
  chmod 644 "$tmp"
  chown root:root "$tmp" 2>/dev/null || true
  mv "$tmp" "$FSTAB"
}

fstab_entry_for() {
  # Prints the fstab source for mount point $1, or nothing.
  [ -f "$FSTAB" ] || return 0
  awk -v tgt="$1" '$0 !~ /^[[:space:]]*#/ && $2 == tgt { print $1; exit }' "$FSTAB"
}

# ---------------------------------------------------------------------------
# Mount option semantics — the part that decides whether a sleeping NAS costs
# you a slideshow or costs you the boot.
#
#   nofail                 systemd.mount(5): "this mount will be only wanted,
#                          not required, by local-fs.target or remote-fs.target.
#                          Moreover, the mount unit is not ordered before these
#                          target units." Without it, a NAS that is off at boot
#                          fails remote-fs.target and can drop the Pi to an
#                          emergency shell on a screen with no keyboard.
#   x-systemd.automount    "An automount unit will be created for the file
#                          system." The .mount unit is NOT started at boot; the
#                          .automount unit is what the target pulls in, and
#                          setting up an autofs point touches no network. The
#                          share is mounted on first access instead — i.e. the
#                          first time the backend reads the photo directory.
#   _netdev                Marks it as needing the network, so it is ordered
#                          after network-online.target and lands in
#                          remote-fs.target. systemd already classifies cifs as
#                          a network filesystem; this is stated explicitly so
#                          the intent survives someone editing the fstab line.
#   x-systemd.mount-timeout=  "how long systemd should wait for the mount
#                          command to finish before giving up". This is the
#                          bound on a blocked readdir() in the backend when the
#                          NAS is off: the automount trigger fails after this,
#                          and the photo listing falls back to gradients.
#   x-systemd.idle-timeout=  unmount after idle, so the NAS may spin down and a
#                          share that came back is picked up on next access.
#   soft                   mount.cifs(8): a program accessing the mount "will
#                          not hang when the server crashes and will return
#                          errors to the user application". This is the other
#                          half of the no-hang guarantee: mount-timeout bounds
#                          getting the mount, `soft` bounds using it after the
#                          NAS disappears mid-slideshow. It is the cifs default
#                          today; pinned so a kernel default change cannot turn
#                          a dead NAS into a wedged photo request.
#   ro                     The mirror only ever reads. Nothing on the screen
#                          can delete the family album.
#   uid=/gid=/file_mode=/dir_mode=
#                          mount.cifs(8): these apply "when the server does not
#                          provide ownership information" / "does not support
#                          the CIFS Unix extensions" — i.e. always, for a normal
#                          Windows-style NAS share. Without them everything is
#                          owned by root and the mirror service cannot read it.
#   iocharset=utf8         "Charset used to convert local path names to and from
#                          Unicode" — Hebrew filenames arrive as mojibake or
#                          EIO without it.
# ---------------------------------------------------------------------------

build_options() {
  local uid=$1 gid=$2 auth=$3
  printf 'ro,%s,uid=%s,gid=%s,file_mode=0444,dir_mode=0555,iocharset=utf8,vers=%s,soft,actimeo=%s' \
    "$auth" "$uid" "$gid" "$SMB_VERS" "$ACTIMEO"
}

systemd_options() {
  printf '_netdev,nofail,x-systemd.automount,x-systemd.mount-timeout=%ss,x-systemd.idle-timeout=600' "$MOUNT_TIMEOUT"
}

# ---------------------------------------------------------------------------
# Probing
# ---------------------------------------------------------------------------

# TCP reachability without netcat: bash's /dev/tcp, bounded by `timeout`.
# Used to tell "NAS is off" apart from "NAS is up but we disagree on dialect",
# which are the same mount error(112) on the wire.
probe_host() {
  local host=$1 port=${2:-445} secs=${3:-3}
  # Host and port go in as positional parameters, never interpolated into the
  # -c string: in --status mode the host is read back out of /etc/fstab, which
  # a hand edit could have filled with anything.
  # shellcheck disable=SC2016  # single quotes are the point: $0/$1 must be
  # expanded by the inner shell from its arguments, not spliced in by this one.
  timeout "$secs" bash -c 'exec 3<>/dev/tcp/"$0"/"$1"' "$host" "$port" 2>/dev/null
}

# Turn mount.cifs's stderr into one of the codes the Settings UI can act on.
classify_mount_error() {
  local out=$1 rc=$2
  case "$out" in
    *"mount error(13)"*|*"Permission denied"*|*NT_STATUS_LOGON_FAILURE*|*NT_STATUS_ACCESS_DENIED*)
      echo bad_credentials; return ;;
    *"mount error(2)"*|*NT_STATUS_BAD_NETWORK_NAME*|*"No such file or directory"*)
      echo share_not_found; return ;;
    *"mount error(95)"*|*"Operation not supported"*|*"Protocol not supported"*|*"mount error(93)"*|*"Protocol family not supported"*)
      echo dialect_unsupported; return ;;
    *"Unable to find suitable address"*|*"No route to host"*|*"mount error(113)"*|*"Network is unreachable"*|*"mount error(101)"*|*"Connection timed out"*|*"mount error(110)"*|*"Connection refused"*)
      echo host_unreachable; return ;;
    *"mount error(112)"*|*"Host is down"*)
      # 112 is the ambiguous one: it is what a dialect mismatch looks like, and
      # also what a genuinely absent host looks like. Ask the socket.
      if probe_host "$HOST" 445 3; then echo dialect_unsupported; else echo host_unreachable; fi
      return ;;
  esac
  [ "$rc" = 124 ] && { echo host_unreachable; return; }
  echo mount_failed
}

count_images() {
  # Same extensions and depth as backend/routes/photos.js, same junk skipped.
  # Bounded: a status call from the UI must not hang on a half-dead share.
  local dir=$1 n
  n=$(timeout 8 find "$dir" -maxdepth 3 \( -name '.*' -o -name '@eaDir' \) -prune -o \
    -type f \( -iname '*.jpg' -o -iname '*.jpeg' -o -iname '*.png' -o -iname '*.webp' \
    -o -iname '*.avif' -o -iname '*.gif' \) -print 2>/dev/null | wc -l | tr -cd '0-9') || n=0
  printf '%s' "${n:-0}"   # digits only: this goes straight into the JSON
}

mounted_source() {
  # Empty output means "no share mounted here". The fstype filter matters: with
  # x-systemd.automount the mount point is ALWAYS a mount (type autofs, source
  # "systemd-1") even when the NAS has never answered, so an unfiltered findmnt
  # would report a share that is not there. Bounded by `timeout` because
  # resolving the path stats it, which triggers the automount.
  timeout 15 findmnt -n -o SOURCE -t cifs,smb3,smbfs -M "$1" 2>/dev/null || true
}

# Tear down whatever is currently on the mount point so the bare directory
# underneath becomes visible again. Without this, re-running the script sees
# the previous share's files through the old autofs point and mistakes them for
# local photos it must not hide.
teardown_mount() {
  local tgt=$1
  systemctl stop "$(systemd-escape -p --suffix=automount "$tgt")" 2>/dev/null || true
  systemctl stop "$(systemd-escape -p --suffix=mount "$tgt")" 2>/dev/null || true
  if mountpoint -q "$tgt" 2>/dev/null; then
    timeout 20 umount "$tgt" 2>/dev/null || timeout 20 umount -l "$tgt" 2>/dev/null || true
  fi
}

resolve_service_user() {
  local u=''
  if [ -n "$SERVICE_USER" ]; then printf '%s' "$SERVICE_USER"; return; fi
  u=$(systemctl show -p User --value "$SERVICE_UNIT" 2>/dev/null || true)
  if [ -z "$u" ] || [ "$u" = root ]; then
    u=$(stat -c '%U' "$PHOTO_ROOT" 2>/dev/null || true)
  fi
  # image/config sets FIRST_USER_NAME=mirror, which is who the unit runs as on
  # the flashed image; only reached if neither lookup above worked.
  case "$u" in ''|root|UNKNOWN) u=mirror ;; esac
  printf '%s' "$u"
}

# ---------------------------------------------------------------------------
# Modes
# ---------------------------------------------------------------------------

do_mount() {
  require_root
  validate_common
  validate_target

  # --- credentials -------------------------------------------------------
  local password='' auth='' cred_tmp=''
  if [ "$GUEST" = 1 ]; then
    [ -n "$SMB_USER" ] && die bad_args "--guest and --user are mutually exclusive"
    auth='guest'
  else
    [ -n "$SMB_USER" ] || die bad_args "--user is required (or use --guest)"
    if [ "$PASSWORD_STDIN" = 1 ]; then
      IFS= read -r password || true
    else
      password="${SMB_PASSWORD:-}"
    fi
    [ -n "$password" ] || die bad_args "no password given (use --password-stdin or SMB_PASSWORD)"
    case "$password" in
      *$'\n'*) die bad_args "password may not contain a newline" ;;
    esac
    auth="credentials=${CRED_FILE}"
  fi

  # --- who has to be able to read the files -------------------------------
  local svc_user uid gid
  svc_user=$(resolve_service_user)
  uid=$(id -u "$svc_user" 2>/dev/null) || die bad_args "no such user: ${svc_user} (pass --service-user)"
  gid=$(id -g "$svc_user" 2>/dev/null) || die bad_args "no such group for user: ${svc_user}"
  log "Mirror service user: ${svc_user} (uid=${uid} gid=${gid})"

  # --- cifs-utils ---------------------------------------------------------
  if ! command -v mount.cifs >/dev/null 2>&1; then
    log "Installing cifs-utils..."
    DEBIAN_FRONTEND=noninteractive apt-get update -qq >&2 || true
    DEBIAN_FRONTEND=noninteractive apt-get install -y -qq cifs-utils >&2 \
      || die install_failed "apt-get install cifs-utils failed"
  fi
  command -v mount.cifs >/dev/null 2>&1 || die missing_tools "mount.cifs is still not available after installing cifs-utils"

  # --- the mount point ----------------------------------------------------
  local src src_esc tgt_esc opts
  src="//${HOST}/${SHARE}"
  [ -n "$SUBDIR" ] && src="${src}/${SUBDIR}"

  # Ask what is mounted BEFORE tearing anything down, so replacing someone
  # else's share is a decision and not a surprise.
  local current
  current=$(mounted_source "$TARGET")
  if [ -n "$current" ] && [ "$current" != "$src" ] && [ "$FORCE" != 1 ]; then
    die already_mounted_elsewhere "${TARGET} is already mounted from ${current}; pass --force to replace it"
  fi
  [ -d "$TARGET" ] && teardown_mount "$TARGET"

  if [ ! -d "$TARGET" ]; then
    mkdir -p "$TARGET" || die invalid_target "could not create ${TARGET}"
    chown "${uid}:${gid}" "$TARGET" 2>/dev/null || true
  elif [ -n "$(ls -A "$TARGET" 2>/dev/null)" ] && [ "$FORCE" != 1 ]; then
    die target_not_empty "${TARGET} is not empty. Mounting there would hide the files already in it (they are not deleted, just invisible while mounted). Move them elsewhere under ${PHOTO_ROOT}/, or pass --force to hide them."
  fi

  # --- test the mount before touching /etc/fstab ---------------------------
  # A wrong password must not leave a broken fstab entry behind for the next
  # boot, and this is where a clean error message comes from.
  if [ "$GUEST" != 1 ]; then
    cred_tmp=$(mktemp) || die mount_failed "could not create a temp credentials file"
    chmod 600 "$cred_tmp"
    {
      printf 'username=%s\n' "$SMB_USER"
      printf 'password=%s\n' "$password"
      if [ -n "$SMB_DOMAIN" ]; then printf 'domain=%s\n' "$SMB_DOMAIN"; fi
    } > "$cred_tmp"
    auth="credentials=${cred_tmp}"
  fi

  opts=$(build_options "$uid" "$gid" "$auth")
  log "Testing mount of ${src} (vers=${SMB_VERS})..."

  local out rc=0
  out=$(timeout "$((MOUNT_TIMEOUT + 5))" mount -t cifs "$src" "$TARGET" -o "$opts" 2>&1) || rc=$?

  if [ "$rc" != 0 ]; then
    [ -n "$cred_tmp" ] && rm -f "$cred_tmp"
    local code
    code=$(classify_mount_error "$out" "$rc")
    case "$code" in
      bad_credentials)     die "$code" "the NAS rejected the username or password for ${src}" ;;
      share_not_found)     die "$code" "the NAS has no share (or subfolder) at ${src}" ;;
      dialect_unsupported) die "$code" "${HOST} answered but not on SMB ${SMB_VERS} — try --vers 2.0, then --vers 1.0" ;;
      host_unreachable)    die "$code" "${HOST} is not reachable on port 445 (NAS off, wrong address, or firewalled)" ;;
      *)                   die "$code" "mount failed: $(printf '%s' "$out" | tail -n 2 | tr '\n' ' ')" ;;
    esac
  fi

  local images
  images=$(count_images "$TARGET")
  log "Mounted. ${images} image file(s) visible within 3 levels."
  timeout 20 umount "$TARGET" 2>/dev/null || timeout 20 umount -l "$TARGET" 2>/dev/null || true

  # --- install the credentials for real ------------------------------------
  if [ "$GUEST" = 1 ]; then
    rm -f "$CRED_FILE"
    auth='guest'
  else
    # install(1) creates with the final mode, so the password is never briefly
    # world-readable the way a redirect-then-chmod would leave it.
    install -m 600 -o root -g root "$cred_tmp" "$CRED_FILE" \
      || die mount_failed "could not write ${CRED_FILE}"
    rm -f "$cred_tmp"
    auth="credentials=${CRED_FILE}"
    log "Credentials written to ${CRED_FILE} (mode 600, root)."
  fi

  # --- fstab ---------------------------------------------------------------
  src_esc=$(fstab_escape "$src")
  tgt_esc=$(fstab_escape "$TARGET")
  opts="$(build_options "$uid" "$gid" "$auth"),$(systemd_options)"
  fstab_write_entry "$src_esc" "$tgt_esc" "$opts"
  log "Wrote ${FSTAB}:"
  log "  ${src_esc} ${tgt_esc} cifs ${opts} 0 0"

  # --- hand it to systemd --------------------------------------------------
  local unit
  systemctl daemon-reload || die fstab_write_failed "systemctl daemon-reload failed — check ${FSTAB}"
  unit=$(systemd-escape -p --suffix=automount "$TARGET")
  # Starting the automount unit only sets up the autofs point. It never talks
  # to the NAS, so it cannot hang here.
  systemctl restart "$unit" 2>/dev/null || systemctl start "$unit" 2>/dev/null \
    || die mount_failed "could not start ${unit}"

  # Trigger it once so the answer below is about the real share.
  timeout "$((MOUNT_TIMEOUT + 5))" ls -A "$TARGET" >/dev/null 2>&1 || true
  local final
  final=$(mounted_source "$TARGET")
  [ -n "$final" ] || die mount_failed "the automount unit is installed but the share did not mount; check: journalctl -u ${unit}"
  images=$(count_images "$TARGET")

  log ""
  log "Photo share ready:"
  log "  source  : ${final}"
  log "  target  : ${TARGET}"
  log "  images  : ${images} (within 3 levels, the depth the app walks)"
  log "  automount unit: ${unit}"
  log ""
  log "Now restart the mirror backend so it picks the folder up:"
  log "  sudo systemctl restart ${SERVICE_UNIT}"

  if [ "$JSON" = 1 ]; then
    printf '{"ok":true,"code":"ok","mounted":true,"target":"%s","source":"%s","images":%s,"unit":"%s","serviceUser":"%s","restartCommand":"systemctl restart %s"}\n' \
      "$(json_escape "$TARGET")" "$(json_escape "$final")" "$images" \
      "$(json_escape "$unit")" "$(json_escape "$svc_user")" "$(json_escape "$SERVICE_UNIT")"
  fi
}

do_status() {
  validate_target
  local src fstab_src images state reachable host unit

  src=$(mounted_source "$TARGET")
  fstab_src=$(fstab_entry_for "$(fstab_escape "$TARGET")")
  unit=$(systemd-escape -p --suffix=automount "$TARGET" 2>/dev/null || true)

  # //host/share[/sub] -> host, so the UI can say "the NAS is off" rather than
  # "no photos".
  host=$(printf '%s' "${src:-$fstab_src}" | sed -e 's#^//##' -e 's#/.*##' -e 's/\\040/ /g')
  reachable=false
  if [ -n "$host" ] && probe_host "$host" 445 3; then reachable=true; fi

  if [ -n "$src" ]; then
    state=mounted
    images=$(count_images "$TARGET")
  elif [ -n "$fstab_src" ]; then
    state=configured_not_mounted
    images=0
  else
    state=not_configured
    images=$([ -d "$TARGET" ] && count_images "$TARGET" || echo 0)
  fi

  if [ "$JSON" = 1 ]; then
    printf '{"ok":true,"code":"%s","mounted":%s,"target":"%s","source":"%s","fstabSource":"%s","host":"%s","reachable":%s,"images":%s,"unit":"%s"}\n' \
      "$state" \
      "$([ -n "$src" ] && echo true || echo false)" \
      "$(json_escape "$TARGET")" "$(json_escape "$src")" "$(json_escape "$fstab_src")" \
      "$(json_escape "$host")" "$reachable" "$images" "$(json_escape "$unit")"
  else
    echo "state     : ${state}"
    echo "target    : ${TARGET}"
    echo "source    : ${src:-(not mounted)}"
    echo "fstab     : ${fstab_src:-(no entry)}"
    echo "NAS       : ${host:-(unknown)} reachable=${reachable}"
    echo "images    : ${images}"
  fi
}

do_remove() {
  require_root
  validate_target
  teardown_mount "$TARGET"
  fstab_remove_entry "$(fstab_escape "$TARGET")"
  systemctl daemon-reload 2>/dev/null || true
  rm -f "$CRED_FILE"
  rmdir "$TARGET" 2>/dev/null || true   # only if empty; local photos are kept

  log "Removed the photo share: fstab entry, ${CRED_FILE} and the mount are gone."
  log "Restart the mirror backend: sudo systemctl restart ${SERVICE_UNIT}"

  if [ "$JSON" = 1 ]; then
    printf '{"ok":true,"code":"removed","mounted":false,"target":"%s","restartCommand":"systemctl restart %s"}\n' \
      "$(json_escape "$TARGET")" "$(json_escape "$SERVICE_UNIT")"
  fi
}

# Runs the logic that is easy to get wrong (fstab rewriting, escaping, error
# classification, target validation) against a temp file. No root, no network,
# no NAS: `bash scripts/mount-photos-share.sh --self-test`.
do_selftest() {
  local dir rc=0
  JSON=0
  dir=$(mktemp -d)
  # shellcheck disable=SC2064  # expand $dir now, not at trap time
  trap "rm -rf '$dir'" EXIT
  FSTAB="${dir}/fstab"
  printf 'PARTUUID=aaaa-01 /boot/firmware vfat defaults 0 1\nPARTUUID=aaaa-02 / ext4 defaults,noatime 0 1\n' > "$FSTAB"

  check() { # check <label> <expected> <actual>
    if [ "$2" = "$3" ]; then echo "ok   $1"; else echo "FAIL $1: expected [$2] got [$3]"; rc=1; fi
  }

  check "escape space" 'Family\040Photos' "$(fstab_escape 'Family Photos')"
  check "escape plain" 'photo' "$(fstab_escape 'photo')"

  fstab_write_entry '//nas/photo' '/opt/smart-mirror/backend/data/photos/nas' 'ro,nofail'
  check "entry added" '1' "$(grep -c '^//nas/photo ' "$FSTAB")"
  check "existing kept" '2' "$(grep -c '^PARTUUID' "$FSTAB")"

  # Idempotent: same mount point twice leaves one entry, with the new source.
  fstab_write_entry '//nas/family' '/opt/smart-mirror/backend/data/photos/nas' 'ro,nofail'
  check "no duplicate" '1' "$(grep -c '/opt/smart-mirror/backend/data/photos/nas ' "$FSTAB")"
  check "source updated" '//nas/family' "$(fstab_entry_for '/opt/smart-mirror/backend/data/photos/nas')"
  check "marker once" '1' "$(grep -cF "$FSTAB_MARKER" "$FSTAB")"

  fstab_remove_entry '/opt/smart-mirror/backend/data/photos/nas'
  check "entry removed" '0' "$(grep -c '^//nas/' "$FSTAB")"
  check "fstab intact" '2' "$(awk 'END{print NR}' "$FSTAB")"

  check "cred error"   'bad_credentials'     "$(classify_mount_error 'mount error(13): Permission denied' 32)"
  check "share error"  'share_not_found'     "$(classify_mount_error 'mount error(2): No such file or directory' 32)"
  check "dialect err"  'dialect_unsupported' "$(classify_mount_error 'mount error(95): Operation not supported' 32)"
  check "host error"   'host_unreachable'    "$(classify_mount_error 'Unable to find suitable address.' 32)"
  check "timeout"      'host_unreachable'    "$(classify_mount_error '' 124)"

  # A --target outside the two allowed roots must be refused.
  check "bad target /etc" 'refused' "$(TARGET=/etc; (validate_target) >/dev/null 2>&1 && echo allowed || echo refused)"
  check "bad target root" 'refused' "$(TARGET=$PHOTO_ROOT; (validate_target) >/dev/null 2>&1 && echo allowed || echo refused)"
  check "good target"     'allowed' "$(TARGET=$TARGET_DEFAULT; (validate_target) >/dev/null 2>&1 && echo allowed || echo refused)"
  check "good /mnt"       'allowed' "$(TARGET=/mnt/photos; (validate_target) >/dev/null 2>&1 && echo allowed || echo refused)"

  [ "$rc" = 0 ] && echo "self-test passed" || echo "self-test FAILED"
  return "$rc"
}

case "$MODE" in
  mount)    do_mount ;;
  status)   do_status ;;
  remove)   do_remove ;;
  selftest) do_selftest ;;
esac
