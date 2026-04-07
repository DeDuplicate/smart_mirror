#!/usr/bin/env bash
# backup.sh — Create a timestamped backup of the Smart Mirror SQLite database.
# Copies the backup to a USB drive if one is mounted, then prunes backups older
# than 7 days.

set -euo pipefail

# ---------------------------------------------------------------------------
# Configuration
# ---------------------------------------------------------------------------
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "${SCRIPT_DIR}")"
DB_FILE="${PROJECT_DIR}/backend/db/mirror.db"
BACKUP_DIR="${PROJECT_DIR}/backend/db/backups"
USB_MOUNT="/media/usb"
LOG_FILE="${PROJECT_DIR}/logs/backup.log"
KEEP_DAYS=7

TIMESTAMP="$(date +%Y%m%d_%H%M%S)"
BACKUP_FILE="${BACKUP_DIR}/mirror_${TIMESTAMP}.db"

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------
log() {
  local msg="[$(date '+%Y-%m-%d %H:%M:%S')] $*"
  echo "${msg}"
  mkdir -p "$(dirname "${LOG_FILE}")"
  echo "${msg}" >> "${LOG_FILE}"
}

# ---------------------------------------------------------------------------
# Pre-flight checks
# ---------------------------------------------------------------------------
if [ ! -f "${DB_FILE}" ]; then
  log "ERROR: Database not found at ${DB_FILE}. Nothing to back up."
  exit 1
fi

mkdir -p "${BACKUP_DIR}"

# ---------------------------------------------------------------------------
# Create local backup
# ---------------------------------------------------------------------------
log "Starting backup of ${DB_FILE}..."
cp "${DB_FILE}" "${BACKUP_FILE}"
log "Local backup created: ${BACKUP_FILE}"

# ---------------------------------------------------------------------------
# Copy to USB if available
# ---------------------------------------------------------------------------
if mountpoint -q "${USB_MOUNT}" 2>/dev/null; then
  USB_BACKUP_DIR="${USB_MOUNT}/smart-mirror-backups"
  mkdir -p "${USB_BACKUP_DIR}"
  cp "${BACKUP_FILE}" "${USB_BACKUP_DIR}/"
  log "Backup also copied to USB: ${USB_BACKUP_DIR}/$(basename "${BACKUP_FILE}")"
else
  log "USB not mounted at ${USB_MOUNT}. Skipping USB copy."
fi

# ---------------------------------------------------------------------------
# Prune backups older than KEEP_DAYS days
# ---------------------------------------------------------------------------
log "Pruning backups older than ${KEEP_DAYS} days from ${BACKUP_DIR}..."
find "${BACKUP_DIR}" -maxdepth 1 -name "mirror_*.db" -mtime "+${KEEP_DAYS}" -print -delete | while read -r removed; do
  log "Removed old backup: ${removed}"
done

log "Backup complete."
