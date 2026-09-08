#!/usr/bin/env bash
# start-kiosk.sh — Launch Chromium in kiosk mode for the Smart Mirror display.
# Waits for the frontend to be ready, disables screen saver/DPMS, then runs
# Chromium with a watchdog loop that relaunches it if it exits.

set -euo pipefail

KIOSK_URL="http://localhost:3000"
# Seconds to wait for the frontend. 60 was too short on slow boards: a Pi 2
# (900 MHz ARMv7) cold-starting `vite preview` on first boot, while the
# filesystem is still expanding, can legitimately take longer than that.
MAX_WAIT="${KIOSK_MAX_WAIT:-180}"
RETRY_DELAY=3 # seconds between Chromium relaunch attempts

# ---------------------------------------------------------------------------
# Wait for the frontend server
# ---------------------------------------------------------------------------
echo "[kiosk] Waiting for ${KIOSK_URL} (timeout: ${MAX_WAIT}s)..."
elapsed=0
until curl --silent --fail --max-time 2 "${KIOSK_URL}" > /dev/null 2>&1; do
  if [ "${elapsed}" -ge "${MAX_WAIT}" ]; then
    echo "[kiosk] ERROR: Frontend not available after ${MAX_WAIT}s. Aborting." >&2
    # Say WHY. Without this the console only shows X starting and dying in a
    # loop, which reads as an X/display fault when the actual cause is a
    # service that never came up (a wrong ExecStart path, a crash on boot).
    echo "[kiosk] --- service state ---" >&2
    systemctl --no-pager --lines=8 status smart-mirror-frontend smart-mirror-backend >&2 2>&1 || true
    echo "[kiosk] --- listening ports ---" >&2
    (ss -ltnp 2>/dev/null || netstat -ltn 2>/dev/null) | grep -E ':(3000|3001)' >&2 || echo "[kiosk] nothing listening on 3000/3001" >&2
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
# Window geometry
# ---------------------------------------------------------------------------
# `--kiosk` does NOT size the window itself: it asks the window manager for
# fullscreen over EWMH. This session runs bare `startx` with no window manager,
# so nothing honours that request and Chromium keeps its own default (observed:
# 945x1060 at +10+10 on a 1920x1080 panel). The app then scales its 1920-wide
# design down to fit that window, which looks like a broken display mode.
#
# Setting the geometry explicitly avoids needing a window manager at all. It
# also fixes keyboard input as a side effect: with no WM, X focus is
# PointerRoot, so keystrokes go to whatever is under the pointer — reliable
# only once the window actually covers the screen.
SCREEN=$(xrandr --current 2>/dev/null | awk '/\*/ {print $1; exit}')
if [ -z "${SCREEN}" ] && [ -r /sys/class/graphics/fb0/virtual_size ]; then
  SCREEN=$(tr ',' 'x' < /sys/class/graphics/fb0/virtual_size)
fi
SCREEN="${SCREEN:-1920x1080}"
SCREEN_W="${SCREEN%x*}"
SCREEN_H="${SCREEN#*x}"
echo "[kiosk] Screen ${SCREEN_W}x${SCREEN_H}"

# ---------------------------------------------------------------------------
# Watchdog loop — relaunch Chromium whenever it exits
# ---------------------------------------------------------------------------
echo "[kiosk] Entering watchdog loop. Press Ctrl-C to stop."
while true; do
  echo "[kiosk] Launching Chromium..."
  chromium-browser \
    --kiosk \
    --window-position=0,0 \
    --window-size="${SCREEN_W},${SCREEN_H}" \
    `# Low-end tuning. Measured on a Pi 2 (4x ARMv7, 921MB): load average sat` \
    `# above 6 with Xorg alone taking ~78% CPU, so the goal is to remove` \
    `# rendering work rather than to add threads.` \
    --enable-low-end-device-mode \
    --disable-smooth-scrolling \
    --disable-composited-antialiasing \
    --num-raster-threads=2 \
    --ignore-gpu-blocklist \
    --autoplay-policy=no-user-gesture-required \
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
