# Photo frame from a NAS (CIFS/SMB)

The slideshow screensaver shows whatever is under
`/opt/smart-mirror/backend/data/photos`. `scripts/mount-photos-share.sh` mounts
a NAS share **read-only** at `/opt/smart-mirror/backend/data/photos/nas`, so the
family drops pictures on the NAS and the mirror shows them. No application
change: the backend just sees another folder.

Mounting one level down (`nas/`, not the photos directory itself) means local
photos and NAS photos coexist, the committed `README.md` in the photos
directory is not shadowed, and the folder picker in Settings shows `nas` as one
album among the others.

Run it as root on the Pi. It never prompts, and running it twice is the same as
running it once.

---

## Usage

```bash
# Synology (DSM 6/7). Share "photo", user "mirror", password from stdin.
printf '%s' 'the-password' | sudo scripts/mount-photos-share.sh \
  --host 192.168.1.20 --share photo --user mirror --password-stdin

# TrueNAS (SCALE or CORE). Same thing; the share name is whatever the SMB
# share is called, not the dataset path.
printf '%s' 'the-password' | sudo scripts/mount-photos-share.sh \
  --host truenas.local --share family --subdir photos/2024 --user mirror --password-stdin

# Generic SMB box, guest/anonymous share, older dialect.
sudo scripts/mount-photos-share.sh --host 192.168.1.30 --share Public --guest --vers 2.0

# Windows share in a domain
printf '%s' 'the-password' | sudo scripts/mount-photos-share.sh \
  --host winbox --share Photos --user yossef --domain WORKGROUP --password-stdin
```

`--help` lists everything. The useful extras:

| Flag | Why |
|---|---|
| `--subdir a/b` | Mount a folder inside the share instead of its root |
| `--vers 2.0` \| `1.0` | Older NAS — see troubleshooting |
| `--force` | Mount over a non-empty directory, or replace another share |
| `--target /mnt/...` | Somewhere other than `.../photos/nas` (only under the photos directory or `/mnt/`) |
| `--json` | One line of JSON on stdout, for the backend |
| `--status` | What is mounted right now |
| `--unmount` | Undo all of it |
| `--self-test` | Check the fstab/validation logic; no root, no network |

**The password is never an argument.** Anything in `argv` is world-readable in
`ps`. Use `--password-stdin` (the only form that works through `sudo`, which
clears the environment) or `SMB_PASSWORD=...` for a root shell.

Credentials land in `/etc/smb-photos.cred`, mode `600`, owned by root.

Synology creates a hidden `@eaDir` thumbnail folder inside every share. The
backend already skips it (`backend/routes/photos.js`), so it will not show up as
photos.

## Verify

```bash
scripts/mount-photos-share.sh --status
sudo systemctl restart smart-mirror-backend      # the mirror re-reads the folder
curl -s localhost:3001/api/photoframe/list | head -c 300
```

`--status` prints the source, whether it is mounted, whether the NAS answers on
port 445, and how many image files are visible within the 3 levels the app
walks. `--status --json` is the same thing for scripts.

---

## The fstab line, and why it cannot break the boot

```
//nas/photo /opt/smart-mirror/backend/data/photos/nas cifs \
  ro,credentials=/etc/smb-photos.cred,uid=1000,gid=1000,file_mode=0444,dir_mode=0555,\
  iocharset=utf8,vers=3.0,soft,actimeo=60,_netdev,nofail,x-systemd.automount,\
  x-systemd.mount-timeout=10s,x-systemd.idle-timeout=600 0 0
```

The four options that matter, and what each one is actually holding up:

- **`x-systemd.automount`** — systemd creates an *automount* unit; the `.mount`
  unit is not started at boot. Setting up an autofs point touches no network, so
  boot cannot wait on the NAS. The share is mounted on first access instead.
- **`nofail`** — the mount is "only wanted, not required, by `local-fs.target`
  or `remote-fs.target`. Moreover, the mount unit is not ordered before these
  target units" (`systemd.mount(5)`). Without it, a NAS that is off at boot
  fails `remote-fs.target` and can drop the Pi to an emergency shell — on a
  wall-mounted screen with no keyboard.
- **`x-systemd.mount-timeout=10s`** — **this is the option that stops a dead NAS
  from freezing the photo listing.** The mount point lives inside a directory
  the Node backend walks, so a `readdir()` there is what triggers the automount.
  If the NAS is off, that call blocks until this timeout, then autofs reports the
  failure and `/api/photoframe/list` falls back to the built-in gradients.
  Raise it and you are choosing a longer freeze; `SMB_MOUNT_TIMEOUT=5` shortens
  it. It is bounded either way — it can never be indefinite.
- **`soft`** — the other half of that guarantee. `mount.cifs(8)`: a program
  accessing the mount "will not hang when the server crashes and will return
  errors to the user application". `mount-timeout` bounds *getting* the mount;
  `soft` bounds *using* it when the NAS vanishes mid-slideshow. (It is today's
  cifs default; pinned so a kernel default change cannot turn a dead NAS into a
  wedged HTTP request.)

The rest: `_netdev` orders it after `network-online.target`; `ro` means nothing
on the screen can delete the family album; `uid`/`gid`/`file_mode`/`dir_mode`
apply because a normal NAS share carries no POSIX ownership, and without them
everything is root-owned and the mirror service cannot read it; `iocharset=utf8`
keeps Hebrew filenames intact; `actimeo=60` stops the screensaver's repeated
directory reads from hitting the network every second (a new photo on the NAS
appears within a minute).

**One known consequence:** while the NAS is unreachable, the first photo request
after a boot waits out `mount-timeout` once, and `walkPhotos` skips the `nas`
folder. Local photos elsewhere under the photos directory still show.

### `--subdir` uses the UNC path, not a bind mount

`--subdir trips/2024` mounts `//nas/photo/trips/2024` directly — `mount.cifs`
takes a path after the share name (the `prefixpath`). The bind-mount
alternative would mean two fstab entries, a second unit, and an
`x-systemd.requires-mounts-for=` ordering dependency between them, all so a
sleeping NAS could fail in two places instead of one. One entry, one failure
mode. The cost: a subfolder that does not exist fails at mount time as
`mount error(2)` (reported as `share_not_found`), and SMB1 servers handle
prefix paths poorly — on `--vers 1.0`, mount the share root and pick the folder
in Settings instead.

---

## Troubleshooting

### 1. `mount error(13): Permission denied` — `bad_credentials`

The NAS rejected the username or password. In order of likelihood:

- The password has a character the shell ate. `--password-stdin` with
  `printf '%s'` (not `echo`, which appends a newline) avoids all quoting.
- The user has no permission on that *share* even though the login is valid.
  Check the share's permissions on the NAS, not just the user account.
- Synology: the user must be allowed under **Control Panel → Shared Folder →
  Edit → Permissions**, and SMB must be on for that share.
- Guest shares that still want a login: drop `--guest` and pass a real user, or
  add `sec=none` to the options in `/etc/fstab` and `sudo mount -a`.
- Test outside the script to see the raw error:
  ```bash
  sudo mount -t cifs //nas/photo /mnt/test -o ro,username=mirror,vers=3.0
  ```

### 2. `mount error(112): Host is down` — `dialect_unsupported`

The NAS is up (you can ping it) but does not speak the SMB dialect asked for.
Since kernel 4.13.5 the client negotiates SMB 2.1 or newer and never SMB1, so an
old box answers with what looks like a network error. The script probes port 445
to tell this apart from a genuinely absent NAS, and reports
`dialect_unsupported` when the port answers.

Walk down the dialects until one connects:

```bash
sudo scripts/mount-photos-share.sh --host nas --share photo --user u --password-stdin --vers 2.1
sudo scripts/mount-photos-share.sh ... --vers 2.0     # DSM 5-era Synology, old WD/Netgear
sudo scripts/mount-photos-share.sh ... --vers 1.0     # last resort
```

`--vers 1.0` is SMB1: insecure, and compiled out of some kernels
(`CONFIG_CIFS_ALLOW_INSECURE_LEGACY`), in which case it fails with
`Operation not supported`. If the NAS can be updated or has an
"enable SMB2/SMB3" setting (Synology: **Control Panel → File Services → SMB →
Advanced → Maximum SMB protocol**), do that instead and stay on `--vers 3.0`.

### 3. The NAS is asleep at boot — photos missing, nothing else broken

This is the designed behaviour, not a failure: `x-systemd.automount` + `nofail`
mean the Pi boots normally and the slideshow falls back to gradients. When the
NAS wakes, the *next* access mounts it — usually the next screensaver, or:

```bash
ls /opt/smart-mirror/backend/data/photos/nas     # triggers the automount
scripts/mount-photos-share.sh --status
```

If it stays empty after the NAS is definitely up:

```bash
# The unit name is the escaped mount point; ask systemd rather than typing it:
U=$(systemd-escape -p --suffix=automount /opt/smart-mirror/backend/data/photos/nas)
systemctl status "$U"                          # opt-smart\x2dmirror-...-nas.automount
journalctl -u "${U%.automount}.mount" -n 30    # why the mount itself failed
sudo systemctl restart "$U"
```

A repeatedly failing mount leaves the unit in a failed state; the `restart`
above clears it. If the NAS spins its disks down, the first photo after an idle
period can take a few seconds — `x-systemd.idle-timeout=600` unmounts after ten
idle minutes so the NAS is allowed to sleep at all.

Wake-on-LAN or "always on" for the NAS is the real fix if the family wants
photos on the screen the instant the Pi boots.

---

## Removing it

```bash
sudo scripts/mount-photos-share.sh --unmount
sudo systemctl restart smart-mirror-backend
```

Unmounts, drops the `/etc/fstab` entry (a backup of the previous file stays at
`/etc/fstab.bak-smart-mirror`), deletes `/etc/smb-photos.cred`, and removes the
`nas` directory if it is empty. Photos stored locally under the photos directory
are untouched.

---

## Calling it from the Settings UI

The backend runs as an unprivileged user, so it invokes this script through one
`sudo` rule. Install the privileged copy **outside** `/opt/smart-mirror`: that
checkout is writable by the mirror user and is rewritten by `git pull` on every
OTA update, so a sudo rule pointing into it would be a way to become root.

```bash
sudo install -m 0755 -o root -g root \
  /opt/smart-mirror/scripts/mount-photos-share.sh /usr/local/sbin/mount-photos-share.sh
printf 'mirror ALL=(root) NOPASSWD: /usr/local/sbin/mount-photos-share.sh\n' \
  | sudo install -m 0440 -o root -g root /dev/stdin /etc/sudoers.d/smart-mirror-photos
sudo visudo -cf /etc/sudoers.d/smart-mirror-photos
```

Re-run the `install` line after an update that changes the script.

The backend then spawns it with the password on stdin (environment variables do
not survive `sudo`):

```
sudo -n /usr/local/sbin/mount-photos-share.sh --json --host <h> --share <s> \
        --user <u> --password-stdin
```

Every call prints exactly one line of JSON on stdout. On failure, `code` is one
of `bad_args`, `not_root`, `missing_tools`, `install_failed`, `invalid_target`,
`target_not_empty`, `already_mounted_elsewhere`, `bad_credentials`,
`host_unreachable`, `share_not_found`, `dialect_unsupported`, `mount_failed`,
`fstab_write_failed`. `--status --json` answers `mounted` /
`configured_not_mounted` / `not_configured` with the source, host reachability
and image count, and needs no root.

---

## Not using a NAS?

Two other ways to fill the frame, both without this script:

- **Copy files in.** `scp` photos to `/opt/smart-mirror/backend/data/photos/` —
  see the README in that directory. Nothing to configure.
- **Immich.** If you already run an Immich server, point the mirror at it in
  **Settings → תצוגה** instead of mounting a share. It is the alternative photo
  source, not a companion to this one — pick one, or the same pictures show up
  twice.
