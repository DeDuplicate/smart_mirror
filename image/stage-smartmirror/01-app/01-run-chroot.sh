#!/bin/bash -e

source /tmp/smart-mirror-app.env

echo "[stage-smartmirror] Installing Node.js 20 LTS..."
curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
apt-get install -y nodejs
node --version

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
