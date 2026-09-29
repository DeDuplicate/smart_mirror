#!/usr/bin/env bash
# apply-orientation.sh <landscape|portrait-left|portrait-right> [WxH|auto]
# Rotates the X output and remaps every touch device to match. Runs from
# start-kiosk.sh at boot and from the backend when Settings changes it.
# Rotation direction depends on how the frame is mounted, hence two portraits.
set -u
export DISPLAY="${DISPLAY:-:0}"
case "${1:-landscape}" in
  portrait-left)  ROT=left;   M="0 -1 1 1 0 0 0 0 1" ;;
  portrait-right) ROT=right;  M="0 1 0 -1 0 1 0 0 1" ;;
  *)              ROT=normal; M="1 0 0 0 1 0 0 0 1" ;;
esac
OUT=$(xrandr --current | awk '/ connected/ {print $1; exit}')
MODE=(--auto)
[[ "${2:-auto}" =~ ^[0-9]+x[0-9]+$ ]] && MODE=(--mode "$2")
[ -n "$OUT" ] && { xrandr --output "$OUT" "${MODE[@]}" --rotate "$ROT" || xrandr --output "$OUT" --auto --rotate "$ROT"; }
# Touch panels (not the mouse/keyboard) advertise a Coordinate Transformation Matrix.
# Skip X's virtual master/XTEST pointers: they are not hardware, and rotating
# them skews synthetic input (xdotool, remote tools).
xinput list --name-only 2>/dev/null | grep -v '^Virtual core' | while read -r dev; do
  xinput list-props "$dev" 2>/dev/null | grep -q "Coordinate Transformation Matrix" &&
    xinput set-prop "$dev" "Coordinate Transformation Matrix" $M 2>/dev/null
done
exit 0
