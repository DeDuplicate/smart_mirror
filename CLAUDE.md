# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Smart Mirror Display — a touch-enabled family dashboard running on Raspberry Pi (1920x1080, landscape). Hebrew RTL interface built for a 27" IR touch frame (minimum touch target: 56x56px).

## Tech Stack

- **Frontend:** React 18 + Vite, Tailwind CSS v3 (logical properties), Zustand for state, Socket.io for real-time
- **Backend:** Node.js + Express, SQLite (better-sqlite3), PM2 for process management
- **Kiosk:** Chromium `--kiosk` on Raspberry Pi OS Bookworm 64-bit
- **External APIs:** Google Calendar/Tasks (OAuth 2.0), Home Assistant (REST + WebSocket), Open-Meteo (weather, free), Spotify or MPD (TBD), NewsAPI or Israeli RSS (TBD)

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

# Fresh Pi setup
./scripts/setup.sh

# Kiosk mode
./scripts/start-kiosk.sh
```

## Architecture

Frontend talks to backend via HTTP + WebSocket (Socket.io). Backend proxies all external APIs and manages OAuth tokens. SQLite stores config and kanban column state. Google OAuth callback: `http://localhost:3001/auth/callback`.

**Pages:** Calendar (weekly grid) | Tasks (3-column kanban) | Home (HA device tiles) | Music (playback controls) | News (headline cards) | Settings (full config UI)

**TopBar** is always visible: live clock, weather, Hebrew date, greeting, brightness control, Wi-Fi manager.

**First-Run Setup Wizard** launches on fresh install — walks through name, location, Google OAuth, HA, Spotify, news sources. All OAuth flows use iframe overlay (kiosk-compatible).

## Critical Design Constraints (LOCKED)

- **RTL throughout:** `<html lang="he" dir="rtl">`, CSS logical properties (`ms-`, `me-`, `text-start`)
- **Fonts:** Heebo + DM Mono bundled locally in `frontend/src/assets/fonts/` (no CDN dependency)
- **Hebrew line-height:** minimum 1.45
- **Color tokens:** see `PLAN.md` section 2 for the full palette (bg #f4f5f7, accent purple #6b62e0, teal #2ab58a, pastel event colors mint/lav/coral/gold)
- **Animation tokens:** consistent easing (`--ease`, `--ease-out`, `--ease-in`) + durations (`--dur-fast` 150ms, `--dur-normal` 250ms, `--dur-slow` 400ms); GPU-only transforms
- **No body scroll:** full-height content area per tab
- **Israeli week:** calendar grid runs Sun-Thu (Fri/Sat toggleable in Settings)
- **Skeleton loading states** for all tabs; empty states when data is loaded but empty
- **SQLite WAL mode** for crash safety; migration system in `backend/db/migrations/`

## Backend Routes

`/auth` (Google + Spotify OAuth) | `/calendar` | `/tasks` | `/weather` | `/ha` (Home Assistant) | `/music` | `/news` | `/wifi` (nmcli) | `/settings` (config CRUD) | `/system` (brightness, version, update, health)

## Key Integration Details

- **Google OAuth:** scopes `calendar.readonly` + `tasks`, refresh tokens encrypted in SQLite
- **Home Assistant:** long-lived token in `.env`, WebSocket for real-time state push
- **Weather:** Open-Meteo, no API key, cached 10 min, location Netanya (32.33, 34.86)
- **Hebrew Calendar:** Hebcal API, free, no key — Shabbat times + Jewish holidays
- **Sync intervals:** Calendar 5 min, Tasks 2 min, News 30 min
- **Socket.io events:** namespaced pattern `category:action` (e.g., `auth:google:success`, `ha:state_changed`)
- **i18n:** all Hebrew strings in `frontend/src/i18n/he.json`; `useTranslation()` hook; numbers wrapped in `<span dir="ltr">`
- **Dev mode:** `NODE_ENV=development` enables mock data, relaxed CORS, verbose logging; Pi-specific deps (`ddcutil`, `nmcli`) gracefully no-op on non-Pi systems
