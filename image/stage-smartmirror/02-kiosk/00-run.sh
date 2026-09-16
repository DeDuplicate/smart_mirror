#!/bin/bash -e

# systemd services (backend :3001 + frontend :3000)
sed "s/FIRST_USER_NAME/${FIRST_USER_NAME}/g" files/smart-mirror-backend.service \
  > "${ROOTFS_DIR}/etc/systemd/system/smart-mirror-backend.service"
sed "s/FIRST_USER_NAME/${FIRST_USER_NAME}/g" files/smart-mirror-frontend.service \
  > "${ROOTFS_DIR}/etc/systemd/system/smart-mirror-frontend.service"
sed "s/FIRST_USER_NAME/${FIRST_USER_NAME}/g" files/smart-mirror-ytdlp-daemon.service \
  > "${ROOTFS_DIR}/etc/systemd/system/smart-mirror-ytdlp-daemon.service"

# Console autologin for the kiosk user
mkdir -p "${ROOTFS_DIR}/etc/systemd/system/getty@tty1.service.d"
sed "s/FIRST_USER_NAME/${FIRST_USER_NAME}/g" files/autologin.conf \
  > "${ROOTFS_DIR}/etc/systemd/system/getty@tty1.service.d/autologin.conf"

# Physical keyboard: US + Hebrew with an Alt+Shift toggle. The on-screen
# keyboard already offers Hebrew, but a USB keyboard plugged in for setup was
# stuck on US only. Written after stage2 so it overrides pi-gen's KEYBOARD_*.
install -m 644 files/keyboard "${ROOTFS_DIR}/etc/default/keyboard"

# Default audio to HDMI, not the analog headphone jack. The Pi exposes two
# ALSA cards (bcm2835 Headphones + vc4-hdmi) and picks card 0 (headphones) as
# the default with no config, so nothing plays through the screen's speakers.
# vc4-hdmi also only accepts IEC958-framed PCM, so the default must route
# through its "hdmi:" plug device (not a bare "hw:") or playback fails outright.
install -m 644 files/asound.conf "${ROOTFS_DIR}/etc/asound.conf"

# Kiosk X session for the user
install -m 755 -o 1000 -g 1000 files/xinitrc \
  "${ROOTFS_DIR}/home/${FIRST_USER_NAME}/.xinitrc"
install -m 644 -o 1000 -g 1000 files/bash_profile \
  "${ROOTFS_DIR}/home/${FIRST_USER_NAME}/.bash_profile"

on_chroot << EOF
systemctl enable smart-mirror-backend.service
systemctl enable smart-mirror-frontend.service
systemctl enable smart-mirror-ytdlp-daemon.service
systemctl set-default multi-user.target

# Allow non-root X on the console
if [ -f /etc/X11/Xwrapper.config ]; then
  sed -i 's/allowed_users=.*/allowed_users=anybody/' /etc/X11/Xwrapper.config
else
  echo "allowed_users=anybody" > /etc/X11/Xwrapper.config
fi
echo "needs_root_rights=yes" >> /etc/X11/Xwrapper.config

# ddcutil (brightness) needs i2c access
usermod -aG i2c,video,render ${FIRST_USER_NAME} || usermod -aG video ${FIRST_USER_NAME}
EOF

# Load the i2c-dev module for ddcutil brightness control
echo "i2c-dev" > "${ROOTFS_DIR}/etc/modules-load.d/smart-mirror-i2c.conf"
