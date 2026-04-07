#!/usr/bin/env bash
# start-kiosk.sh — Launch Chromium in kiosk mode for the Smart Mirror display.
# Waits for the frontend to be ready, disables screen saver/DPMS, then runs
# Chromium with a watchdog loop that relaunches it if it exits.

set -euo pipefail

KIOSK_URL="http://localhost:3000"
MAX_WAIT=60   # seconds to wait for the server before giving up
RETRY_DELAY=3 # seconds between Chromium relaunch attempts

# ---------------------------------------------------------------------------
# Wait for the frontend server
# ---------------------------------------------------------------------------
echo "[kiosk] Waiting for ${KIOSK_URL} (timeout: ${MAX_WAIT}s)..."
elapsed=0
until curl --silent --fail --max-time 2 "${KIOSK_URL}" > /dev/null 2>&1; do
  if [ "${elapsed}" -ge "${MAX_WAIT}" ]; then
    echo "[kiosk] ERROR: Frontend not available after ${MAX_WAIT}s. Aborting." >&2
    exit 1
  fi
  sleep 2
  elapsed=$((elapsed + 2))
done
echo "[kiosk] Frontend is up after ${elapsed}s."

# ---------------------------------------------------------------------------
# Disable screen saver and DPMS so the mirror never goes blank
# ---------------------------------------------------------------------------
echo "[kiosk] Disabling screen saver and DPMS..."
xset s off          # disable screen saver
xset s noblank      # don't blank the screen
xset -dpms          # disable Display Power Management Signaling

# ---------------------------------------------------------------------------
# Watchdog loop — relaunch Chromium whenever it exits
# ---------------------------------------------------------------------------
echo "[kiosk] Entering watchdog loop. Press Ctrl-C to stop."
while true; do
  echo "[kiosk] Launching Chromium..."
  chromium-browser \
    --kiosk \
    --noerrdialogs \
    --disable-infobars \
    --no-first-run \
    --disable-session-crashed-bubble \
    --disable-restore-session-state \
    --disable-background-networking \
    --disable-default-apps \
    --disable-extensions \
    --disable-sync \
    --disable-translate \
    --disable-dev-shm-usage \
    --no-sandbox \
    --js-flags="--max-old-space-size=128" \
    "${KIOSK_URL}" || true

  echo "[kiosk] Chromium exited. Relaunching in ${RETRY_DELAY}s..."
  sleep "${RETRY_DELAY}"
done
