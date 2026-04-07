# Smart Mirror Display OS

A beautiful, touch-enabled family dashboard for Raspberry Pi — Hebrew RTL interface with 7 tabs, dark mode, Home Assistant integration, and gamified chores for kids.

![Node.js](https://img.shields.io/badge/Node.js-20%2B-339933?logo=node.js&logoColor=white)
![React](https://img.shields.io/badge/React-18-61DAFB?logo=react&logoColor=white)
![Vite](https://img.shields.io/badge/Vite-5-646CFF?logo=vite&logoColor=white)
![Tailwind CSS](https://img.shields.io/badge/Tailwind-3-06B6D4?logo=tailwindcss&logoColor=white)
![License](https://img.shields.io/badge/License-MIT-blue)

---

## Features

### 7 Interactive Tabs

| Tab | Description |
|-----|-------------|
| :calendar: **Calendar** | Weekly grid with Google Calendar sync, color-coded events, week navigation |
| :white_check_mark: **Tasks** | Kanban board with drag-and-drop, priorities, due dates |
| :star: **Chores** | Per-person columns with progress rings, celebration animations & sounds |
| :house: **Smart Home** | Home Assistant tiles, AC control, IR remote, curtain, power monitor |
| :musical_note: **Music** | Spotify player with album art, queue, volume control |
| :newspaper: **News** | Hebrew RSS feeds (Ynet, Channel 14) with full article view |
| :gear: **Settings** | Full configuration UI, family management, dark mode |

### Smart Features

- :crescent_moon: **Dark mode** toggle with system-wide theme
- :clock1: **Hebrew date** (gematria) + Jewish holidays + Shabbat times
- :sun_behind_small_cloud: **Animated weather icons** (sun, rain, snow, thunder)
- :family_man_woman_girl_boy: **Family member photos** on chore avatars
- :fireworks: **Fireworks celebration** when kids complete all chores
- :clap: **Clap animation + sound** on each chore completion
- :shopping_cart: **Shopping list** from Home Assistant
- :bust_in_silhouette: **Person presence** indicators (home/away)
- :zap: **Real-time electricity** monitoring
- :electric_plug: **IR remote control** for TVs per room
- :snowflake: **AC control** via IR scripts
- :iphone: **PWA installable** on mobile
- :desktop_computer: **Multi-resolution scaling** (auto-adapts to any screen)

---

## Tech Stack

| Layer | Technology |
|-------|------------|
| Frontend | React 18 + Vite + Tailwind CSS v3 |
| State | Zustand |
| Real-time | Socket.io |
| Backend | Node.js + Express |
| Database | SQLite (WAL mode) |
| Process | PM2 |
| Kiosk | Chromium (Raspberry Pi) |

---

## Quick Start

### Prerequisites

- **Node.js** 20+
- **npm**

### Development

```bash
# Clone the repository
git clone https://github.com/DeDuplicate/smart_mirror.git
cd smart_mirror

# Install root dependencies
npm install

# Install frontend dependencies
cd frontend && npm install && cd ..

# Install backend dependencies & configure
cd backend && npm install && cp .env.example .env && cd ..

# Start development servers (frontend + backend)
npm run dev
```

Open **http://localhost:3000** in your browser.

### Raspberry Pi Deployment

```bash
./scripts/setup.sh
```

This script installs all dependencies, builds the frontend, configures PM2, and sets up Chromium kiosk mode.

---

## Configuration

Copy `backend/.env.example` to `backend/.env` and fill in your values:

| Variable | Purpose |
|----------|---------|
| `GOOGLE_CLIENT_ID` | Google OAuth client ID (Calendar & Tasks) |
| `GOOGLE_CLIENT_SECRET` | Google OAuth client secret |
| `SPOTIFY_CLIENT_ID` | Spotify app client ID (Music tab) |
| `SPOTIFY_CLIENT_SECRET` | Spotify app client secret |
| `HA_HOST` | Home Assistant URL (e.g. `http://homeassistant.local:8123`) |
| `HA_TOKEN` | Home Assistant long-lived access token |

---

## Project Structure

```
smart_mirror/
├── frontend/
│   ├── public/              # Static assets, PWA manifest, sounds
│   └── src/
│       ├── components/
│       │   ├── pages/       # CalendarPage, TasksPage, ChoresPage, HomePage,
│       │   │                # MusicPage, NewsPage, SettingsPage
│       │   ├── TopBar.jsx   # Clock, weather, Hebrew date, dark mode
│       │   ├── TabBar.jsx   # Bottom navigation tabs
│       │   └── ...          # Shared UI (modals, overlays, animations)
│       ├── hooks/           # useCalendar, useChores, useMusic, useHomeAssistant, ...
│       ├── store/           # Zustand global store
│       ├── i18n/            # Hebrew translations
│       └── styles/          # Design system (CSS custom properties)
├── backend/
│   ├── routes/              # Express API routes
│   ├── .env.example         # Environment variable template
│   └── ...
├── scripts/
│   ├── setup.sh             # Raspberry Pi setup script
│   ├── start-kiosk.sh       # Chromium kiosk launcher
│   └── backup.sh            # Database backup utility
├── ecosystem.config.js      # PM2 process configuration
└── package.json
```

---

## Screenshots

> Screenshots coming soon.

---

## License

MIT
