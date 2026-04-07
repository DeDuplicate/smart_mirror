# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Smart Mirror Display — a touch-enabled family dashboard running on Raspberry Pi (1920x1080, landscape). Hebrew RTL interface built for a 27" IR touch frame (minimum touch target: 56x56px). Features 7 tabs, dark mode, celebration animations, and real Home Assistant integration.

## Tech Stack

- **Frontend:** React 18 + Vite, Tailwind CSS v3 (logical properties), Zustand for state, Socket.io for real-time
- **Backend:** Node.js + Express, SQLite (better-sqlite3), PM2 for process management
- **Kiosk:** Chromium `--kiosk` on Raspberry Pi OS Bookworm 64-bit
- **External APIs:** Google Calendar/Tasks (OAuth 2.0), Home Assistant (REST + WebSocket), Open-Meteo + IMS weather, Spotify, Hebcal (Jewish holidays), Ynet/Channel 14 RSS

## Build & Run Commands

```bash
# Development (both frontend + backend with hot reload)
npm run dev

# Frontend only (port 3000, proxies API to 3001)
cd frontend && npm install && npx vite dev

# Backend only (port 3001)
cd backend && npm install && node server.js

# Production (PM2)
pm2 start ecosystem.config.js

# Generate PWA icons (SVG; run once after clone)
node scripts/generate-icons.js

# Fresh Pi setup
./scripts/setup.sh

# Kiosk mode
./scripts/start-kiosk.sh
```

## Architecture

Frontend talks to backend via HTTP + WebSocket (Socket.io). Backend proxies all external APIs and manages OAuth tokens. SQLite stores config and kanban column state. Multi-resolution scaling via CSS transform.

**7 Tabs:** Calendar (weekly grid) | Tasks (kanban drag-drop) | Chores (person columns + celebrations) | Home (HA tiles + AC + IR) | Music (Spotify player) | News (RSS headlines) | Settings (full config)

**TopBar** is always visible: live clock, animated weather icon, Hebrew date (gematria), holiday badge, Shabbat times, greeting, dark mode toggle, brightness, shopping list, person presence, WiFi manager.

**First-Run Setup Wizard** (7 steps): name, location, Google OAuth, HA connection + entity discovery, Spotify, news sources, finish.

## Critical Design Constraints (LOCKED)

- **RTL throughout:** `<html lang="he" dir="rtl">`, CSS logical properties
- **Fonts:** Heebo variable + DM Mono bundled locally (no CDN)
- **Dark mode:** CSS variables via `data-theme="dark"`, toggle in TopBar + Settings
- **Color tokens:** bg #f4f5f7, accent purple #6b62e0, teal #2ab58a, pastels mint/lav/coral/gold
- **Animation tokens:** `--ease`, `--ease-out`, `--ease-in`, durations fast/normal/slow; GPU-only transforms
- **Israeli week:** calendar Sun-Thu (Fri/Sat toggleable)
- **Skeleton loading + empty states** for all tabs
- **SQLite WAL mode** for crash safety; migration system in `backend/db/migrations/`
- **Multi-resolution:** CSS transform scaling, works at any window size

## Frontend Hooks (15)

| Hook | Purpose |
|------|---------|
| `useCalendar` | Google Calendar events, week navigation, mock data |
| `useTasks` | Kanban tasks CRUD, drag-drop state |
| `useChores` | Person-based chores, reads family from localStorage |
| `useHomeAssistant` | HA entity states, toggles, services, WebSocket |
| `useMusic` | Spotify playback state, controls, queue |
| `useNews` | RSS articles, full article extraction |
| `useHebrewCalendar` | Hebcal API, holidays, Shabbat times |
| `useAuth` | Google/Spotify OAuth flow, account management |
| `useApi` | Generic fetch with stale-while-revalidate cache |
| `useHealth` | Health polling, connection status updates |
| `useSettings` | Settings CRUD to backend |
| `useWifi` | WiFi scan/connect/forget via nmcli |
| `useIdleDetection` | Idle timeout → screensaver trigger |
| `useDisplaySchedule` | Wake/sleep schedule, temporary wake |
| `usePullToRefresh` | Touch pull-down gesture on Calendar/Tasks/News |

## Frontend Components (Key)

TopBar, TabBar, WeatherIcon (animated SVG), WeatherPopup, BrightnessPopup, WifiPopup, ShoppingListPopup, ACControlPopup, IRRemoteOverlay, OAuthOverlay, ConnectionBanner, OnScreenKeyboard (Hebrew/English/emoji), ConfirmDialog, ToastContainer, TouchRipple, Screensaver (clock/slideshow), CelebrationAnimation (Canvas fireworks), ErrorBoundary, Skeleton loaders

## Backend Routes

| Route | Purpose |
|-------|---------|
| `/api/auth/*` | Google + Spotify OAuth flows |
| `/api/calendar/*` | Google Calendar events |
| `/api/tasks/*` | Google Tasks CRUD |
| `/api/weather` | Open-Meteo + IMS weather |
| `/api/ha/*` | HA states, services, todo, remote, weather entity |
| `/api/music/*` | Spotify playback controls |
| `/api/news/*` | RSS feeds + readability extraction |
| `/api/wifi/*` | Network scan/connect/forget (nmcli) |
| `/api/settings/*` | Config CRUD in SQLite |
| `/api/system/*` | Health, brightness, logs, update, backup, schedule |

## Key Integration Details

- **Home Assistant:** `https://nadav7.duckdns.org:8123`, token in `.env` (gitignored)
- **HA Entities:** 383 entities including lights, covers, scripts (AC via IR), media players, remotes, power meter, todo list
- **AC Control:** 38 `script.aircon_*` entities mapped by temp/mode/speed in ACControlPopup
- **Weather:** Open-Meteo default, IMS via HA toggle in Settings
- **Hebrew Calendar:** Hebcal API, holidays in TopBar + Calendar grid
- **Sync intervals:** Calendar 5 min, Tasks/Chores 2 min, News 30 min, Weather 10 min, Health 30s
- **Chores:** Person-based columns, family configured in Settings, photos in localStorage, clap + fireworks celebrations with sound
- **Socket.io events:** `auth:*`, `ha:*`, `music:*`, `calendar:*`, `tasks:*`, `system:*`, `heartbeat`
- **i18n:** `frontend/src/i18n/he.json` — all Hebrew strings centralized
- **Dev mode:** mock data for all integrations, Pi-specific deps gracefully no-op

## PWA

- **Manifest:** `frontend/public/manifest.json` — `display: standalone`, `theme_color: #6b62e0`, `orientation: landscape`
- **Icons:** `frontend/public/icons/icon.svg` (any-size SVG, primary), `favicon.svg` (32px browser tab icon). PNG fallbacks (`icon-192.png`, `icon-512.png`) can be generated with `sharp` or Inkscape — see `scripts/generate-icons.js` for instructions
- **Favicon:** `frontend/public/favicon.svg` referenced in `index.html` via `<link rel="icon">`

## Project Stats (April 2026)

- **60 source files** (`.js`, `.jsx`, `.json`, `.css`) across frontend + backend
- **~21,000 lines of code** total
- **Build:** `npx vite build` — 114 modules, 0 warnings, 1.88s, 453 kB JS bundle (128 kB gzip)
