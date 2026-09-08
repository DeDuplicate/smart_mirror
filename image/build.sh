#!/usr/bin/env bash
# build.sh — Build a flashable Smart Mirror OS image with pi-gen.
#
# Requirements: Linux host (or WSL2) with Docker installed and running.
# Output: image/pi-gen/deploy/<date>-smart-mirror.img.xz
#
# Usage:
#   ./build.sh                # build the image
#   CONTINUE=1 ./build.sh     # resume a previously failed build
#
# Optional env vars:
#   SMART_MIRROR_ARCH  arm64 (default) or armhf — see the note below. Getting
#                      this wrong gives a rainbow splash and no boot.
#   SMART_MIRROR_REPO  git URL baked into the image (default: this repo's origin)
#   SMART_MIRROR_REF   branch/tag to bake (default: main)
#   PIGEN_WORK_DIR     where to build (must be a space-free native Linux path)

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PIGEN_DIR="${PIGEN_WORK_DIR:-${SCRIPT_DIR}/pi-gen}"
PIGEN_REPO="https://github.com/RPi-Distro/pi-gen.git"

# Target architecture. This is NOT cosmetic: a 64-bit image contains only
# kernel8.img, so a 32-bit-only Pi shows the rainbow splash and then stops
# dead, because the GPU firmware finds no kernel it can execute.
#
#   arm64 (default) - Pi 3, 3A+, 3B+, 4, 400, 5, 500, Zero 2 W, CM3/4/5,
#                     and Pi 2 v1.2 (BCM2837 only)
#   armhf           - everything older: Pi 1, Pi 2 v1.1 (BCM2836), Zero, Zero W
#
# Check yours with `cat /proc/cpuinfo | grep Revision` on an existing card, or
# read the board: "Pi 2 Model B V1.1" cannot run arm64, V1.2 can.
SMART_MIRROR_ARCH="${SMART_MIRROR_ARCH:-arm64}"

case "${SMART_MIRROR_ARCH}" in
  arm64)
    # bookworm-arm64 pins Bookworm, matching RELEASE in ./config. The plain
    # `arm64` branch has moved on to Trixie, and forcing RELEASE=bookworm
    # against Trixie-era stages is not supported by pi-gen.
    DEFAULT_BRANCH="bookworm-arm64"
    QEMU_BIN="qemu-aarch64-static"
    ;;
  armhf)
    DEFAULT_BRANCH="bookworm"
    QEMU_BIN="qemu-arm-static"
    ;;
  *)
    echo "[image] ERROR: SMART_MIRROR_ARCH must be arm64 or armhf, got '${SMART_MIRROR_ARCH}'." >&2
    exit 1
    ;;
esac
PIGEN_BRANCH="${PIGEN_BRANCH:-${DEFAULT_BRANCH}}"
echo "[image] Building for ${SMART_MIRROR_ARCH} (pi-gen branch: ${PIGEN_BRANCH})"

if ! command -v docker &>/dev/null; then
  echo "[image] ERROR: Docker is required. Install Docker and retry." >&2
  exit 1
fi

# debootstrap does not support build paths containing spaces (pi-gen README),
# and the chroot needs real Linux ownership semantics, so a Windows drive mount
# (/mnt/c, /mnt/g, ...) will not work either. Fail early instead of 40 minutes in.
case "${PIGEN_DIR}" in
  *\ *)
    echo "[image] ERROR: build path contains a space:" >&2
    echo "[image]   ${PIGEN_DIR}" >&2
    echo "[image] debootstrap cannot handle this. Build elsewhere, e.g.:" >&2
    echo "[image]   PIGEN_WORK_DIR=\"\${HOME}/pi-gen-smart-mirror\" ./build.sh" >&2
    exit 1
    ;;
esac
case "${PIGEN_DIR}" in
  /mnt/*)
    echo "[image] WARNING: ${PIGEN_DIR} looks like a Windows drive mount." >&2
    echo "[image] pi-gen needs a native Linux filesystem; set PIGEN_WORK_DIR to a" >&2
    echo "[image] path under \${HOME} if the build fails on permissions." >&2
    ;;
esac

# Docker Desktop on WSL2 writes credsStore=desktop.exe into ~/.docker/config.json.
# That helper is a Windows .exe reached through WSL interop, which is unavailable in
# a detached/non-login shell -> "error getting credentials ... exec format error"
# before a single layer is pulled. pi-gen only needs public images, so fall back to
# a creds-free config instead of editing the user's ~/.docker.
if [ -z "${DOCKER_CONFIG:-}" ] && grep -qs '\.exe' "${HOME}/.docker/config.json"; then
  echo "[image] Docker credsStore points at a Windows helper; using a creds-free config."
  DOCKER_CONFIG="${SCRIPT_DIR}/.docker-nocreds"
  mkdir -p "${DOCKER_CONFIG}"
  echo '{}' > "${DOCKER_CONFIG}/config.json"
  export DOCKER_CONFIG
fi

# pi-gen's build-docker.sh hard-requires the qemu user-mode binary for the
# target arch on the HOST PATH, even though the privileged build container
# registers its own binfmt handler and Docker Desktop already provides one.
# Emulation works either way - only the `which` check fails.
if [ "$(uname -m)" = "x86_64" ] && ! command -v "${QEMU_BIN}" &>/dev/null; then
  echo "[image] ERROR: ${QEMU_BIN} not on PATH (pi-gen requires it for ${SMART_MIRROR_ARCH})." >&2
  echo "[image] Install it:      sudo apt-get install -y qemu-user-static" >&2
  echo "[image] Or, without sudo, lift it out of the pi-gen build image:" >&2
  echo "[image]   docker build -t pi-gen \"${PIGEN_DIR}\" && mkdir -p ~/.local/bin &&" >&2
  echo "[image]   cid=\$(docker create pi-gen true) &&" >&2
  echo "[image]   docker cp \"\$cid:/usr/bin/${QEMU_BIN}\" ~/.local/bin/ &&" >&2
  echo "[image]   docker rm -f \"\$cid\" && export PATH=\"\$HOME/.local/bin:\$PATH\"" >&2
  exit 1
fi

# 1. Get pi-gen
if [ ! -d "${PIGEN_DIR}" ]; then
  echo "[image] Cloning pi-gen (${PIGEN_BRANCH} branch)..."
  git clone --depth 1 --branch "${PIGEN_BRANCH}" "${PIGEN_REPO}" "${PIGEN_DIR}"
fi

# 2. Install our custom stage + config
echo "[image] Installing stage-smartmirror into pi-gen..."
rm -rf "${PIGEN_DIR}/stage-smartmirror"
cp -r "${SCRIPT_DIR}/stage-smartmirror" "${PIGEN_DIR}/stage-smartmirror"
cp "${SCRIPT_DIR}/config" "${PIGEN_DIR}/config"

# `hardlink -t /usr/share/doc` in export-image/05-finalise segfaults under
# qemu user-mode emulation (both arm64 and armhf). Combined with WSL2's core_pattern (see below) that wedges the
# build forever; on its own it just aborts it. Doc dedup is a size optimisation
# only, so neuter the call. Idempotent - pi-gen is re-cloned/reused every run.
FINALISE="${PIGEN_DIR}/export-image/05-finalise/01-run.sh"
if grep -q '^[[:space:]]*hardlink -t /usr/share/doc' "${FINALISE}"; then
  echo "[image] Neutering emulation-hostile 'hardlink' step in 05-finalise..."
  # Substitute ':' for the body rather than deleting the line - the enclosing
  # `if hash hardlink ...; then ... fi` would otherwise have an empty body.
  sed -i 's|^[[:space:]]*hardlink -t /usr/share/doc.*|\t: # dropped by image/build.sh: segfaults under qemu emulation|' "${FINALISE}"
  if grep -q '^[[:space:]]*hardlink -t /usr/share/doc' "${FINALISE}"; then
    echo "[image] ERROR: failed to patch 05-finalise." >&2
    exit 1
  fi
fi

# Only export OUR stage as an image (skip the plain Lite image of stage2)
touch "${PIGEN_DIR}/stage2/SKIP_IMAGES"

# Pass the app repo/ref into the build (read by 01-app inside the chroot)
SMART_MIRROR_REPO="${SMART_MIRROR_REPO:-$(git -C "${SCRIPT_DIR}/.." remote get-url origin 2>/dev/null || echo 'https://github.com/DeDuplicate/smart_mirror.git')}"
SMART_MIRROR_REF="${SMART_MIRROR_REF:-main}"
{
  echo "SMART_MIRROR_REPO=${SMART_MIRROR_REPO}"
  echo "SMART_MIRROR_REF=${SMART_MIRROR_REF}"
} > "${PIGEN_DIR}/stage-smartmirror/01-app/files/app.env"

# WSL2 sets kernel.core_pattern=|/wsl-capture-crash, a helper that does NOT exist
# inside the build container. core_pattern is global (not namespaced), so when any
# emulated binary crashes the kernel blocks the dying process in call_usermodehelper_exec
# and it wedges in unkillable D state -- the build hangs silently with no timeout.
# Point it at a plain file for the duration of the build, then restore it.
CORE_PATTERN_ORIG=""
if [ -r /proc/sys/kernel/core_pattern ] && grep -q '^|' /proc/sys/kernel/core_pattern; then
  CORE_PATTERN_ORIG="$(cat /proc/sys/kernel/core_pattern)"
  echo "[image] core_pattern pipes to a helper absent in containers; setting it to 'core'."
  docker run --rm --privileged alpine sh -c 'echo core > /proc/sys/kernel/core_pattern' >/dev/null
  # shellcheck disable=SC2064
  trap "docker run --rm --privileged alpine sh -c 'echo \"${CORE_PATTERN_ORIG}\" > /proc/sys/kernel/core_pattern' >/dev/null 2>&1 || true" EXIT
fi

# 3. Build inside Docker
echo "[image] Building (this takes 30-90 minutes on first run)..."
cd "${PIGEN_DIR}"
CONTINUE="${CONTINUE:-0}" ./build-docker.sh

echo ""
echo "[image] Done! Flashable image:"
ls -lh "${PIGEN_DIR}/deploy/"*.xz 2>/dev/null || ls -lh "${PIGEN_DIR}/deploy/"
echo ""
echo "[image] Flash with Raspberry Pi Imager or:"
echo "  xzcat deploy/<file>.img.xz | sudo dd of=/dev/sdX bs=4M status=progress"
