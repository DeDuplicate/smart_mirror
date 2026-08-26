#!/bin/bash -e

# Pass the app repo/ref (written by image/build.sh into files/app.env)
# into the chroot for the next script.
install -m 644 files/app.env "${ROOTFS_DIR}/tmp/smart-mirror-app.env"
