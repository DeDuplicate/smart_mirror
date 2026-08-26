#!/bin/bash -e

# systemd services (backend :3001 + frontend :3000)
sed "s/FIRST_USER_NAME/${FIRST_USER_NAME}/g" files/smart-mirror-backend.service \
  > "${ROOTFS_DIR}/etc/systemd/system/smart-mirror-backend.service"
sed "s/FIRST_USER_NAME/${FIRST_USER_NAME}/g" files/smart-mirror-frontend.service \
  > "${ROOTFS_DIR}/etc/systemd/system/smart-mirror-frontend.service"

# Console autologin for the kiosk user
mkdir -p "${ROOTFS_DIR}/etc/systemd/system/getty@tty1.service.d"
sed "s/FIRST_USER_NAME/${FIRST_USER_NAME}/g" files/autologin.conf \
  > "${ROOTFS_DIR}/etc/systemd/system/getty@tty1.service.d/autologin.conf"

# Kiosk X session for the user
install -m 755 -o 1000 -g 1000 files/xinitrc \
  "${ROOTFS_DIR}/home/${FIRST_USER_NAME}/.xinitrc"
install -m 644 -o 1000 -g 1000 files/bash_profile \
  "${ROOTFS_DIR}/home/${FIRST_USER_NAME}/.bash_profile"

on_chroot << EOF
systemctl enable smart-mirror-backend.service
systemctl enable smart-mirror-frontend.service
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
