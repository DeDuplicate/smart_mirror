#!/bin/bash -e

source /tmp/smart-mirror-app.env

# Node from the official nodejs.org tarball, not the NodeSource apt repo.
#
# NodeSource dropped 32-bit ARM: its setup script exits with "Unsupported
# architecture: armhf. Only amd64, arm64 are supported", which killed the
# build for older Pis. nodejs.org publishes official armv7l AND arm64 builds,
# so one path covers both boards, and pinning the version keeps image builds
# reproducible instead of tracking whatever the repo serves that day.
NODE_VERSION=v20.20.2   # LTS "Iron"

case "$(dpkg --print-architecture)" in
  armhf) NODE_ARCH=armv7l ;;
  arm64) NODE_ARCH=arm64 ;;
  *)
    echo "[stage-smartmirror] ERROR: no Node build for $(dpkg --print-architecture)" >&2
    exit 1
    ;;
esac

NODE_TAR="node-${NODE_VERSION}-linux-${NODE_ARCH}.tar.xz"
echo "[stage-smartmirror] Installing Node ${NODE_VERSION} for ${NODE_ARCH}..."
cd /tmp
curl -fsSL --retry 3 -O "https://nodejs.org/dist/${NODE_VERSION}/${NODE_TAR}"

# Verify against the published checksums before unpacking: this binary is
# baked into an OS image, so an unverified download is a trust boundary.
curl -fsSL --retry 3 -O "https://nodejs.org/dist/${NODE_VERSION}/SHASUMS256.txt"
grep " ${NODE_TAR}\$" SHASUMS256.txt | sha256sum -c -

# --strip-components=1 lands bin/, lib/, include/ and share/ straight into
# /usr/local, so `node` and `npm` are on PATH with no symlinking.
tar -xJf "${NODE_TAR}" -C /usr/local --strip-components=1 \
  --exclude=CHANGELOG.md --exclude=LICENSE --exclude=README.md
rm -f "${NODE_TAR}" SHASUMS256.txt

# The tarball lands in /usr/local/bin, but plenty of things assume the apt
# package's /usr/bin/node — systemd units, helper scripts, third-party
# shebangs. Symlink both so either path works and there is no class of
# "no such file or directory" failures that look like unrelated faults.
ln -sf /usr/local/bin/node /usr/bin/node
ln -sf /usr/local/bin/npm  /usr/bin/npm
ln -sf /usr/local/bin/npx  /usr/bin/npx

node --version
npm --version

echo "[stage-smartmirror] Installing yt-dlp..."
curl -fsSL https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp \
  -o /usr/local/bin/yt-dlp
chmod a+rx /usr/local/bin/yt-dlp

echo "[stage-smartmirror] Cloning ${SMART_MIRROR_REPO} (${SMART_MIRROR_REF})..."
rm -rf /opt/smart-mirror
git clone --depth 1 --branch "${SMART_MIRROR_REF}" "${SMART_MIRROR_REPO}" /opt/smart-mirror

cd /opt/smart-mirror

echo "[stage-smartmirror] Installing app dependencies..."
npm install --prefix frontend
npm install --omit=dev --prefix backend

echo "[stage-smartmirror] Building frontend..."
(cd frontend && npx vite build)

# Default .env — user fills in secrets after first boot (or via setup wizard)
if [ -f backend/.env.example ] && [ ! -f backend/.env ]; then
  cp backend/.env.example backend/.env
fi

chown -R 1000:1000 /opt/smart-mirror

rm -f /tmp/smart-mirror-app.env
echo "[stage-smartmirror] App installed at /opt/smart-mirror."
