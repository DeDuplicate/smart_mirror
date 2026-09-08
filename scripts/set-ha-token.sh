#!/usr/bin/env bash
# set-ha-token.sh — paste a Home Assistant long-lived token, verify it works.
#
# The token is read with `read -s` so it is never echoed to the screen and never
# lands in shell history. It is written straight to backend/.env, which is
# gitignored, so it stays on this device.
#
# Get a token: Home Assistant -> your avatar (bottom left) -> Security tab ->
# "Long-lived access tokens" -> Create token. Copy it immediately; HA will not
# show it again.
#
# Usage:  sudo bash /opt/smart-mirror/scripts/set-ha-token.sh
#         sudo bash /opt/smart-mirror/scripts/set-ha-token.sh --host https://ha.example:8123

set -euo pipefail

APP_DIR="${APP_DIR:-/opt/smart-mirror}"
ENV_FILE="${APP_DIR}/backend/.env"
HOST_ARG=""

while [ $# -gt 0 ]; do
  case "$1" in
    --host) HOST_ARG="${2:-}"; shift 2 ;;
    -h|--help) sed -n '2,16p' "$0"; exit 0 ;;
    *) echo "unknown argument: $1" >&2; exit 2 ;;
  esac
done

if [ ! -f "${ENV_FILE}" ]; then
  if [ -f "${APP_DIR}/backend/.env.example" ]; then
    cp "${APP_DIR}/backend/.env.example" "${ENV_FILE}"
    echo "[ha] created ${ENV_FILE} from .env.example"
  else
    touch "${ENV_FILE}"
  fi
fi

# ---------------------------------------------------------------------------
# Host
# ---------------------------------------------------------------------------
CURRENT_HOST=$(grep -E '^HA_HOST=' "${ENV_FILE}" 2>/dev/null | cut -d= -f2- || true)
if [ -n "${HOST_ARG}" ]; then
  HA_HOST="${HOST_ARG}"
elif [ -n "${CURRENT_HOST}" ]; then
  HA_HOST="${CURRENT_HOST}"
  echo "[ha] using existing host: ${HA_HOST}"
else
  read -r -p "[ha] Home Assistant URL (e.g. https://ha.example:8123): " HA_HOST
fi
HA_HOST="${HA_HOST%/}"

# ---------------------------------------------------------------------------
# Token — never echoed, never in history
# ---------------------------------------------------------------------------
echo "[ha] Paste the long-lived access token (input is hidden), then press Enter:"
read -r -s HA_TOKEN
echo

if [ -z "${HA_TOKEN}" ]; then
  echo "[ha] ERROR: no token entered. Nothing changed." >&2
  exit 1
fi
# HA tokens are JWTs. Catching a mis-paste here is friendlier than a 401 later.
case "${HA_TOKEN}" in
  eyJ*) : ;;
  *) echo "[ha] WARNING: that does not look like a Home Assistant token (expected it to start with 'eyJ'). Continuing anyway." >&2 ;;
esac

# ---------------------------------------------------------------------------
# Verify BEFORE writing, so a bad token never replaces a good one
# ---------------------------------------------------------------------------
echo "[ha] Testing ${HA_HOST} ..."
CODE=$(curl -s -o /tmp/ha-probe.$$ -w '%{http_code}' --max-time 15 \
  -H "Authorization: Bearer ${HA_TOKEN}" \
  -H 'Content-Type: application/json' \
  "${HA_HOST}/api/" || echo "000")

case "${CODE}" in
  200)
    echo "[ha] OK — Home Assistant answered: $(head -c 120 /tmp/ha-probe.$$)"
    ;;
  401|403)
    echo "[ha] ERROR: ${HA_HOST} rejected the token (HTTP ${CODE}). Nothing changed." >&2
    rm -f /tmp/ha-probe.$$
    exit 1
    ;;
  000)
    echo "[ha] ERROR: could not reach ${HA_HOST} at all. Check the URL and the network. Nothing changed." >&2
    rm -f /tmp/ha-probe.$$
    exit 1
    ;;
  *)
    echo "[ha] ERROR: unexpected HTTP ${CODE} from ${HA_HOST}. Nothing changed." >&2
    rm -f /tmp/ha-probe.$$
    exit 1
    ;;
esac
rm -f /tmp/ha-probe.$$

# ---------------------------------------------------------------------------
# Write
# ---------------------------------------------------------------------------
cp "${ENV_FILE}" "${ENV_FILE}.bak"
set_var() {
  local key="$1" value="$2"
  if grep -qE "^${key}=" "${ENV_FILE}"; then
    # Value goes in via a file, not the sed script, so tokens containing
    # slashes or ampersands cannot corrupt the substitution.
    python3 - "$key" "$value" "$ENV_FILE" <<'PY'
import sys
key, value, path = sys.argv[1], sys.argv[2], sys.argv[3]
lines = open(path).read().splitlines()
out = [f"{key}={value}" if l.startswith(key + "=") else l for l in lines]
open(path, "w").write("\n".join(out) + "\n")
PY
  else
    printf '%s=%s\n' "${key}" "${value}" >> "${ENV_FILE}"
  fi
}
set_var HA_HOST "${HA_HOST}"
set_var HA_TOKEN "${HA_TOKEN}"
chmod 600 "${ENV_FILE}"
chown 1000:1000 "${ENV_FILE}" 2>/dev/null || true
echo "[ha] wrote ${ENV_FILE} (mode 600); previous copy at ${ENV_FILE}.bak"

# ---------------------------------------------------------------------------
# Restart + confirm through the app's own health endpoint
# ---------------------------------------------------------------------------
systemctl restart smart-mirror-backend
echo "[ha] restarted smart-mirror-backend, waiting for it to come up ..."
for _ in $(seq 1 20); do
  sleep 2
  if curl -s --max-time 3 http://127.0.0.1:3001/api/system/health > /tmp/ha-health.$$ 2>/dev/null; then
    break
  fi
done

if [ -s /tmp/ha-health.$$ ]; then
  python3 - <<'PY'
import glob, json
path = glob.glob("/tmp/ha-health.*")[0]
try:
    ha = json.load(open(path)).get("integrations", {}).get("homeAssistant", {})
except Exception:
    print("[ha] could not parse health output")
else:
    print(f"[ha] configured={ha.get('configured')} reachable={ha.get('reachable')} host={ha.get('host')}")
    print("[ha] DONE - the Home tab should populate within a few seconds."
          if ha.get("reachable") else
          "[ha] backend still reports unreachable; check `journalctl -u smart-mirror-backend -n 30`")
PY
else
  echo "[ha] backend did not answer /api/system/health; check journalctl -u smart-mirror-backend"
fi
rm -f /tmp/ha-health.$$
