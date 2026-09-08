# Smart Mirror OS Image

Build a flashable Raspberry Pi image that boots straight into the Smart
Mirror — a true kiosk appliance. Power on → app on screen. No desktop, no
manual setup.

## What the image contains

- **Raspberry Pi OS Bookworm Lite (64-bit)** base
- **The app** pre-installed at `/opt/smart-mirror` (deps installed, frontend built)
- **Node.js 20**, **ffmpeg**, **yt-dlp** (for Nest/Home casting), **ddcutil** (brightness)
- **systemd services**: `smart-mirror-backend` (:3001) + `smart-mirror-frontend` (:3000), enabled on boot
- **Kiosk boot chain**: console autologin (user `mirror`) → `startx` → Chromium `--kiosk` at `http://localhost:3000` with a watchdog relaunch loop, screen blanking disabled, cursor hidden
- **SSH enabled** for remote administration
- Hostname `smartmirror`, timezone `Asia/Jerusalem`

## Which Pi will this boot on?

**Check this before flashing.** The default build is **64-bit**, and a 64-bit
image contains only `kernel8.img`. On a 32-bit-only Pi the GPU firmware paints
the rainbow splash, finds no kernel it can execute, and stops — no error, no
console, just the rainbow forever.

| Board | Arch | Build with |
|---|---|---|
| Pi 5 / 500, Pi 4 / 400, CM4, CM5 | 64-bit | `./build.sh` (default) |
| Pi 3, 3A+, 3B+, Zero 2 W, CM3 | 64-bit | `./build.sh` (default) |
| **Pi 2 v1.2** (BCM2837) | 64-bit | `./build.sh` (default) |
| **Pi 2 v1.1** (BCM2836) | 32-bit only | `SMART_MIRROR_ARCH=armhf ./build.sh` |
| Pi 1 A/B/A+/B+, Zero, Zero W | 32-bit only | `SMART_MIRROR_ARCH=armhf ./build.sh` |

The two Pi 2 revisions are the trap: they look identical and both say
"Raspberry Pi 2 Model B", but only **V1.2** has the 64-bit BCM2837. The
revision is printed on the board next to the model name, or:

```bash
grep Revision /proc/cpuinfo    # a02082/a22082 = v1.2 (64-bit ok)
                               # a01041/a21041 = v1.1 (32-bit only)
```

A quick way to tell after the fact: mount the card's `bootfs` partition. If it
has only `kernel8.img` and no `kernel7.img`, it is a 64-bit image.

> **Performance note for older boards:** a Pi 2 (900 MHz ARMv7, 1 GB RAM) will
> run this, but Chromium rendering a 1080p dashboard on that hardware is slow.
> A Pi 4 with 2 GB or more is the comfortable target.

## Building

Requires a **Linux host or WSL2** with **Docker** (pi-gen builds inside Docker).

```bash
cd image
./build.sh
```

- First build takes 30–90 minutes (downloads + an emulated chroot).
- Resume a failed build with `CONTINUE=1 ./build.sh`.
- Build 32-bit with `SMART_MIRROR_ARCH=armhf ./build.sh` (see the table above).
  Use a separate `PIGEN_WORK_DIR` per architecture — the two need different
  pi-gen branches (`bookworm-arm64` vs `bookworm`) and cannot share a checkout.
- Output: `<build dir>/deploy/image_<date>-smart-mirror.img.xz` (~835 MB).

**If the repo path contains a space** (e.g. `G:\Projects\smart screen` on
Windows), debootstrap cannot build there. `build.sh` refuses to start and tells
you to pick another directory:

```bash
PIGEN_WORK_DIR="${HOME}/pi-gen-smart-mirror" ./build.sh
# -> ~/pi-gen-smart-mirror/deploy/image_<date>-smart-mirror.img.xz
```

From Windows that path is reachable as
`\\wsl$\<distro>\home\<user>\pi-gen-smart-mirror\deploy\`, which
Raspberry Pi Imager's "Use custom" picker opens directly — no need to copy it
to a Windows drive first.

`build.sh` also works around three Docker-Desktop-on-WSL2 traps automatically:
a `credsStore` pointing at a Windows `.exe` helper, pi-gen's host-side
`qemu-aarch64-static` requirement, and `kernel.core_pattern` piping to
`/wsl-capture-crash` (absent inside containers — it turns any crash in the
emulated chroot into an unkillable D-state hang with no timeout).

Bake a different branch/fork:

```bash
SMART_MIRROR_REPO=https://github.com/you/fork.git SMART_MIRROR_REF=my-branch ./build.sh
```

## Flashing

Use **Raspberry Pi Imager** (choose "Use custom") or:

```bash
xzcat deploy/image_<date>-smart-mirror.img.xz | sudo dd of=/dev/sdX bs=4M status=progress
```

> Note: OS customization in Raspberry Pi Imager (hostname/user/WiFi) is
> supported — the image uses the standard Raspberry Pi OS first-boot
> mechanisms.

## First boot

1. Flash, insert, power on. The filesystem auto-expands and the app starts.
2. Connect to the network: plug in Ethernet, **or** pre-configure WiFi in
   Raspberry Pi Imager, **or** use the in-app WiFi manager (top bar).
3. The first-run setup wizard walks through name, location, Google,
   Home Assistant, music and news.
4. For Home Assistant + Google secrets, SSH in and edit the env file:

   ```bash
   ssh mirror@smartmirror.local     # default password: mirror — change it!
   nano /opt/smart-mirror/backend/.env
   sudo systemctl restart smart-mirror-backend
   ```

## Default credentials

| | |
|---|---|
| User | `mirror` |
| Password | `mirror` (**change with `passwd` after first boot**) |
| Hostname | `smartmirror.local` |

## Service management

```bash
sudo systemctl status  smart-mirror-backend smart-mirror-frontend
sudo systemctl restart smart-mirror-backend
journalctl -u smart-mirror-backend -f
```

## How it's structured (pi-gen)

```
image/
├── build.sh                      # clones pi-gen, injects our stage, builds via Docker
├── config                        # pi-gen config (stages, user, locale, ssh)
└── stage-smartmirror/            # custom pi-gen stage
    ├── 00-packages/              # apt packages (X, chromium, ffmpeg, ...)
    ├── 01-app/                   # node 20 + yt-dlp + clone/build app in /opt
    └── 02-kiosk/                 # systemd services, autologin, xinitrc kiosk
```
