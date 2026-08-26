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

## Building

Requires a **Linux host or WSL2** with **Docker** (pi-gen builds inside Docker).

```bash
cd image
./build.sh
```

- First build takes 30–90 minutes (downloads + emulated arm64 chroot).
- Resume a failed build with `CONTINUE=1 ./build.sh`.
- Output: `image/pi-gen/deploy/<date>-smart-mirror.img.xz`

Bake a different branch/fork:

```bash
SMART_MIRROR_REPO=https://github.com/you/fork.git SMART_MIRROR_REF=my-branch ./build.sh
```

## Flashing

Use **Raspberry Pi Imager** (choose "Use custom") or:

```bash
xzcat deploy/<file>.img.xz | sudo dd of=/dev/sdX bs=4M status=progress
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
