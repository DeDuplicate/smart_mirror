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
#   SMART_MIRROR_REPO  git URL baked into the image (default: this repo's origin)
#   SMART_MIRROR_REF   branch/tag to bake (default: main)

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PIGEN_DIR="${SCRIPT_DIR}/pi-gen"
PIGEN_REPO="https://github.com/RPi-Distro/pi-gen.git"
PIGEN_BRANCH="arm64"   # 64-bit Raspberry Pi OS

if ! command -v docker &>/dev/null; then
  echo "[image] ERROR: Docker is required. Install Docker and retry." >&2
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

# Only export OUR stage as an image (skip the plain Lite image of stage2)
touch "${PIGEN_DIR}/stage2/SKIP_IMAGES"

# Pass the app repo/ref into the build (read by 01-app inside the chroot)
SMART_MIRROR_REPO="${SMART_MIRROR_REPO:-$(git -C "${SCRIPT_DIR}/.." remote get-url origin 2>/dev/null || echo 'https://github.com/DeDuplicate/smart_mirror.git')}"
SMART_MIRROR_REF="${SMART_MIRROR_REF:-main}"
{
  echo "SMART_MIRROR_REPO=${SMART_MIRROR_REPO}"
  echo "SMART_MIRROR_REF=${SMART_MIRROR_REF}"
} > "${PIGEN_DIR}/stage-smartmirror/01-app/files/app.env"

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
