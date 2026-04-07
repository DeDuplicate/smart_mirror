#!/usr/bin/env bash
# setup.sh — Full Raspberry Pi OS setup for the Smart Mirror Display project.
# Run as a regular user with sudo access.

set -euo pipefail

PROJECT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------
info()    { echo -e "\n\033[1;34m[setup]\033[0m $*"; }
success() { echo -e "\033[1;32m[setup]\033[0m $*"; }
error()   { echo -e "\033[1;31m[setup]\033[0m $*" >&2; }

# ---------------------------------------------------------------------------
# 1. Verify Raspberry Pi OS
# ---------------------------------------------------------------------------
info "Checking platform..."
if ! grep -qi "raspberry" /etc/os-release 2>/dev/null && \
   ! grep -qi "raspbian"  /etc/os-release 2>/dev/null; then
  error "This script is designed for Raspberry Pi OS."
  error "Detected OS: $(grep PRETTY_NAME /etc/os-release 2>/dev/null | cut -d= -f2 || echo 'unknown')"
  read -r -p "[setup] Continue anyway? [y/N] " confirm
  [[ "${confirm,,}" == "y" ]] || exit 1
fi
success "Platform check passed."

# ---------------------------------------------------------------------------
# 2. Update apt
# ---------------------------------------------------------------------------
info "Updating apt package lists..."
sudo apt-get update -y
sudo apt-get upgrade -y
success "System packages updated."

# ---------------------------------------------------------------------------
# 3. Install dependencies
# ---------------------------------------------------------------------------
info "Installing system dependencies (git, ddcutil, xdotool)..."
sudo apt-get install -y git ddcutil xdotool curl gnupg

info "Installing Node.js 20 LTS via NodeSource..."
if ! command -v node &>/dev/null || [[ "$(node --version | cut -d. -f1 | tr -d 'v')" -lt 20 ]]; then
  curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
  sudo apt-get install -y nodejs
else
  success "Node.js $(node --version) is already installed."
fi
success "Node.js $(node --version) / npm $(npm --version) ready."

# ---------------------------------------------------------------------------
# 4. Change to project directory
# ---------------------------------------------------------------------------
info "Working in project directory: ${PROJECT_DIR}"
cd "${PROJECT_DIR}"

# ---------------------------------------------------------------------------
# 5. Copy .env.example → .env if .env doesn't exist
# ---------------------------------------------------------------------------
if [ ! -f "${PROJECT_DIR}/.env" ]; then
  if [ -f "${PROJECT_DIR}/.env.example" ]; then
    cp "${PROJECT_DIR}/.env.example" "${PROJECT_DIR}/.env"
    success ".env created from .env.example — review and update secrets before starting."
  else
    error ".env.example not found. Skipping .env creation."
  fi
else
  info ".env already exists. Skipping copy."
fi

# ---------------------------------------------------------------------------
# 6. npm install in frontend/ and backend/
# ---------------------------------------------------------------------------
info "Installing frontend dependencies..."
npm install --prefix "${PROJECT_DIR}/frontend"
success "Frontend dependencies installed."

info "Installing backend dependencies..."
npm install --prefix "${PROJECT_DIR}/backend"
success "Backend dependencies installed."

# ---------------------------------------------------------------------------
# 7. Build frontend
# ---------------------------------------------------------------------------
info "Building frontend (npx vite build)..."
(cd "${PROJECT_DIR}/frontend" && npx vite build)
success "Frontend build complete."

# ---------------------------------------------------------------------------
# 8. Install PM2 and configure startup
# ---------------------------------------------------------------------------
info "Installing PM2 globally..."
sudo npm install -g pm2
success "PM2 $(pm2 --version) installed."

info "Configuring PM2 to start on boot..."
PM2_STARTUP_CMD="$(pm2 startup | tail -n 1)"
if [[ "${PM2_STARTUP_CMD}" == sudo* ]]; then
  eval "${PM2_STARTUP_CMD}"
else
  echo "[setup] Run the following command to enable PM2 startup:"
  echo "  ${PM2_STARTUP_CMD}"
fi
success "PM2 startup configured."

info "Starting application with PM2..."
pm2 start "${PROJECT_DIR}/ecosystem.config.js"
pm2 save
success "PM2 processes started and saved."

# ---------------------------------------------------------------------------
# 9. Summary
# ---------------------------------------------------------------------------
LOCAL_IP="$(hostname -I | awk '{print $1}')"
echo ""
echo "========================================================"
echo "  Smart Mirror setup complete!"
echo "========================================================"
echo ""
echo "  Local IP address : ${LOCAL_IP}"
echo "  Frontend URL     : http://${LOCAL_IP}:3000"
echo "  Backend API      : http://${LOCAL_IP}:5000  (or your configured port)"
echo ""
echo "  Next steps:"
echo "    1. Review and update ${PROJECT_DIR}/.env with your API keys."
echo "    2. Run 'bash scripts/start-kiosk.sh' on the Pi's desktop session"
echo "       to launch Chromium in kiosk mode."
echo "    3. Monitor processes with:  pm2 status"
echo "    4. View logs with:          pm2 logs"
echo "    5. Schedule daily backups:  crontab -e"
echo "         0 2 * * * bash ${PROJECT_DIR}/scripts/backup.sh"
echo ""
echo "========================================================"
