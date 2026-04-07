# Smart Mirror Display — Master Project Plan
> Last updated: April 2026 | Status: Design locked ✅ | Phase: Planning

---

## 1. Hardware

| Component | Spec |
|-----------|------|
| Computer | Raspberry Pi 4 Model B (4GB RAM) or Pi 5 |
| OS | Raspberry Pi OS Bookworm 64-bit |
| Display | 27" LCD monitor, 1920×1080, HDMI |
| Touch | HaiTouch 27" IR Touch Frame — 16 points, USB, free-drive |
| Storage | 32GB+ microSD or USB SSD |
| Power | Official Pi USB-C adapter |
| Mount | Slim flat wall mount, flush to wall |

**Notes:**
- IR frame sits around monitor bezel — adds ~15mm on all sides, USB plug-and-play, no driver needed
- Minimum touch target: 56×56px (IR precision ~5mm)
- Screen runs in landscape 16:9 at all times

---

## 2. Design System (LOCKED ✅)

### Colors
```css
--bg:    #f4f5f7;   /* page background */
--surf:  #ffffff;   /* card / panel surface */
--s2:    #f0f1f5;   /* task card bg */
--bd:    #e8e9f0;   /* borders & dividers */
--tp:    #1a1c2e;   /* primary text */
--ts:    #7b7f9e;   /* secondary text */
--tm:    #b0b4cc;   /* muted / timestamps */
--acc:   #6b62e0;   /* purple — active tabs, progress, CTAs */
--acc2:  #2ab58a;   /* teal — HA on-state */

/* Pastel event palette (from reference photos) */
--mint:     #b8ede0;   --mint-d:  #2a9d7f;   --mint-bg:  #edfaf6;
--lav:      #d4cfff;   --lav-d:   #5b52cc;   --lav-bg:   #f0eeff;
--coral:    #ffc8c8;   --coral-d: #c95454;   --coral-bg: #fff0f0;
--gold:     #ffe4a0;   --gold-d:  #b07c10;   --gold-bg:  #fffbee;
```

### Typography
- **Hebrew text:** `Heebo` (Google Fonts) — weights 300/400/500/600/700
- **Numbers / times / temps:** `DM Mono` — weights 300/400
- **Line-height Hebrew:** 1.45 minimum
- **HTML root:** `<html lang="he" dir="rtl">`

### Animations & Transitions
All UI motion uses consistent easing and durations for a fluid, polished feel.

```css
/* Timing tokens */
--ease:       cubic-bezier(0.4, 0, 0.2, 1);   /* standard material ease */
--ease-out:   cubic-bezier(0.0, 0, 0.2, 1);   /* decelerate — entering elements */
--ease-in:    cubic-bezier(0.4, 0, 1,   1);   /* accelerate — exiting elements */
--dur-fast:   150ms;   /* micro-interactions: ripple, press */
--dur-normal: 250ms;   /* popups, toggles, cards */
--dur-slow:   400ms;   /* page transitions, overlays */
```

**Page / Tab transitions:**
- Tab switch: content crossfade (opacity 0→1, `--dur-normal`) + subtle slide from swipe direction (translateX ±30px)
- First load: staggered card entrance — each card fades in + slides up (translateY 16px→0) with 50ms delay between cards

**Popups & Overlays:**
- Balloon popups (WiFi, Brightness): scale from 0.9→1 + fade in (`--dur-normal --ease-out`); dismiss: reverse
- Confirmation dialog: backdrop fades in (`--dur-fast`), card scales from 0.95→1 + fade (`--dur-normal --ease-out`)
- Toast notifications: slide down from top (translateY -100%→0, `--dur-normal --ease-out`); dismiss: slide up + fade out
- Setup Wizard steps: horizontal slide (current step slides out left, next slides in from right, `--dur-slow`)
- Full article overlay (News): slide up from bottom (translateY 100%→0, `--dur-slow --ease-out`)

**Interactive elements:**
- Tap ripple: expanding circle from touch point, 300ms, white at 20% opacity
- Button/card press: scale(0.97) + slight brightness reduction, `--dur-fast`
- Toggle switches: thumb slides with `--dur-normal --ease`, track color transitions simultaneously
- HA tile toggle: icon + status text crossfade, teal border fades in/out (`--dur-normal`)

**Data & content:**
- Calendar events appearing after sync: fade in + slide down (staggered 30ms per event)
- Kanban card moving between columns: animate position with `--dur-slow --ease`
- Music progress bar: smooth linear animation (CSS `transition: width 1s linear`)
- News cards refresh: old cards fade out (150ms), new cards fade in + slide up (staggered)
- Weather data update: number crossfade (old fades out, new fades in, `--dur-fast`)

**Screensaver:**
- Enter: UI fades out (`--dur-slow`), then photo/clock fades in
- Photo transition: crossfade between photos (1s ease), Ken Burns slow zoom (15s linear)
- Exit on touch: instant brightness restore, photo fades out, UI fades in (`--dur-normal`)

**Scroll & lists:**
- Momentum scrolling on song queue, news list (CSS `scroll-behavior: smooth`)
- Pull-to-refresh: elastic overscroll indicator, spinner rotates in, snaps back on release

**Performance notes:**
- All animations use `transform` and `opacity` only (GPU-composited, no layout thrash)
- `will-change: transform, opacity` on animated elements
- `prefers-reduced-motion` media query: disable all animations, use instant transitions
- Pi 4 target: keep animations under 16ms frame budget; disable stagger delays if FPS drops

### Loading & Empty States
**Skeleton screens (loading):**
- Each tab has a skeleton variant matching its layout — grey shimmering shapes (pulse animation) where real content will appear
- Calendar: 5 column outlines with 3 event-shaped rectangles each
- Tasks: 3 column headers + 2 card-shaped rectangles per column
- Home: 10 tile-shaped rounded squares in grid
- Music: album art square + 3 text lines + control circles
- News: 1 large rectangle + 4 smaller card rectangles
- Skeleton color: `--bd` (#e8e9f0) with shimmer sweep (lighter highlight moving left-to-right in RTL)
- Show skeleton on first load and when switching to a tab that hasn't fetched yet

**Empty states (no data):**
- Each tab has a friendly empty-state when data is loaded but genuinely empty
- Calendar day with no events: light dashed outline + "אין אירועים" (no events) in `--tm` color
- Tasks column empty: subtle dotted border + "אין משימות" with a small illustration
- News no articles: "אין חדשות כרגע" + refresh button
- Music not playing: album art placeholder + "אין מוזיקה פעילה" + "Open Spotify" button
- Style: centered vertically, muted text, optional small SVG illustration, never blank white space

### Layout
- Persistent **TopBar** (clock + weather + date + greeting)
- **TabBar** with 5 tabs below
- Full-height content area per tab, no body scroll
- CSS logical properties throughout (`ms-`, `me-`, `text-start`)

---

## 3. Architecture

```
┌──────────────────────────────────────────────┐
│           React Frontend (Vite)              │
│  TopBar · TabBar · 6 Pages · Setup Wizard    │
│  Zustand state · i18n · On-screen keyboard   │
└──────────────────┬───────────────────────────┘
                   │ HTTP + WebSocket (Socket.io)
┌──────────────────▼───────────────────────────┐
│        Node.js / Express Backend             │
│  /auth  /calendar  /tasks  /weather          │
│  /ha  /music  /news  /wifi  /settings        │
│  /system (health, brightness, update, logs)  │
│  SQLite (WAL) — config, tokens, cache, state │
│  pino logger → rotating log files            │
└──────┬──────────┬───────────┬───────┬────────┘
       ▼          ▼           ▼       ▼
 Google APIs  Home Assistant  Open-  Hebcal
 Calendar     WS + REST      Meteo  (holidays)
 Tasks+OAuth  Long-lived token
 Spotify OAuth
```

### Tech Stack
| Layer | Technology |
|-------|-----------|
| Frontend | React 18 + Vite |
| Styling | Tailwind CSS v3 (logical properties) |
| State | Zustand |
| Real-time | Socket.io |
| Backend | Node.js + Express |
| Database | SQLite (better-sqlite3) |
| Process | PM2 |
| Kiosk | Chromium `--kiosk` |

---

## 4. Pages & Features

### First-Run Setup Wizard
On first boot (no config in SQLite yet), the app enters a full-screen setup wizard instead of the normal tabs:

1. **Welcome screen** — language confirmation (Hebrew), user name input
2. **Location** — city name auto-complete or map pin, saves lat/lon for weather
3. **Google Account** — "Connect Google" button triggers OAuth flow (see below); after auth, user picks which calendars to display and assigns a color to each
4. **Home Assistant** — host URL input + long-lived token paste field; "Test Connection" button with success/fail feedback; entity auto-discovery list with checkboxes + Hebrew label editor
5. **Spotify** (optional) — "Connect Spotify" button triggers OAuth; skip button if not using
6. **News sources** — toggle switches for available sources (Ynet, Channel 14, etc.)
7. **Done** — summary screen, "Start" button → saves everything to SQLite + `.env`, enters normal app

- Wizard can be re-entered from Settings at any time
- Each step has a back button; progress dots at top
- On-screen keyboard available for all text inputs

### TopBar (always visible)
- Live clock (DM Mono, 24h, 1s updates)
- Current weather icon + temp (Open-Meteo, cached 10 min)
  - **Tap → weather detail balloon popup:** current feels-like temp, humidity %, wind speed, 5-day forecast row (day name + icon + high temp per day); same balloon style as WiFi/Brightness popups; tap outside to dismiss
- Hebrew date + day name
- Greeting by time of day (בוקר/צהריים/ערב/לילה + name)
- Brightness icon (tap → slider popup to control display brightness via `xrandr` / `ddcutil`)
- Wi-Fi indicator (tap → balloon popup with Wi-Fi manager)
  - Balloon/cloud-shaped popup anchored to the Wi-Fi icon
  - Scans and lists available Wi-Fi networks (SSID + signal strength bars)
  - Tap a network → password input field (on-screen Hebrew/English keyboard)
  - "Connect" button; spinner while connecting, success/fail feedback
  - Saved networks section: remembers credentials, auto-reconnects on drop
  - Current connection shown at top with signal strength + IP
  - "Forget network" option via long-press on saved entry
  - **Backend:** `/wifi/scan`, `/wifi/connect`, `/wifi/status`, `/wifi/saved`, `/wifi/forget`
  - **Implementation:** `nmcli` (NetworkManager) commands on Pi — scan, connect, save, auto-reconnect
  - **Storage:** connection profiles managed by NetworkManager (persistent across reboots)

### Tab 1 — לוח שנה (Calendar)
- Weekly grid Sun–Thu by default (Israeli work week)
- **Fri/Sat toggle:** Settings option to show/hide Friday & Saturday columns; when enabled, grid shows Sun–Sat (7 columns, narrower); when disabled, Sun–Thu (5 columns)
- **Week navigation:** left/right arrows at top of grid (or swipe horizontally) to browse prev/next weeks; "Today" button snaps back to current week; animated slide transition between weeks
- Color-coded events by calendar/person (mint/lav/coral/gold)
- Today column highlighted
- Upcoming events sidebar (next 4)
- **Event rendering rules:**
  - **Timed events:** positioned vertically by start/end time; height proportional to duration; minimum height = 1 hour slot (so short events remain tappable at 56px)
  - **All-day events:** rendered in a dedicated header row above the timed grid; pastel pill with title, stacked if multiple
  - **Multi-day events:** span across day columns with a continuous bar in the all-day header row; clipped at week boundaries, continued indicator (→) on edges
  - **Overlapping events:** side-by-side within the same time slot, each taking equal width (max 3 visible; "+N more" badge if >3)
- **Event detail popup:** tap any event → overlay card with: title, start/end time, location (with map link), description, calendar name + color dot, attendees list; "Close" button or tap outside to dismiss; slides up from event position (`--dur-normal --ease-out`)
- **Multiple accounts:** support linking 2+ Google accounts; each calendar gets its own color
- **Calendar picker:** in Settings, toggle individual calendars on/off
- **API:** Google Calendar v3, OAuth 2.0 `calendar.readonly`
- **Sync:** poll every 5 min

### Tab 2 — משימות (Tasks) — Person-Based Columns with Celebration
**Layout:** Person-based columns (one per family member), NOT kanban. Each column shows one person's task list for today.

**Person Column Header:**
- Large avatar circle (60×60px) with initials + unique pastel color
- Circular SVG progress ring around avatar (fills clockwise as tasks complete, 600ms ease)
- Person's Hebrew name (bold) + progress text: "3 מתוך 5 הושלמו"
- Full-width progress bar (6px, person's color fill, animates on change)

**Task Cards:**
- Checkbox (44×44px touch target) + emoji icon + title + recurrence label
- Left accent bar (3px) in person's color
- States: incomplete (white), complete (mint bg + strikethrough), overdue (coral bg)
- Tap anywhere on card → toggle complete (optimistic UI update)
- Checkbox animates: circle → checkmark (300ms scale + color)

**Celebration Animation (ALL tasks complete):**
1. Particle burst: 40-60 stars/sparkles/confetti from avatar (Canvas, 1200ms)
2. Firework rockets: 3-5 upward, explode in upper half (200-1800ms)
3. Screen flash: white overlay 30% opacity (300ms)
4. Banner: "כל הכבוד [Name]! 🎉" + "השלמת את כל המטלות!" slides down (400-3000ms)
5. Avatar pulse glow (ongoing until reset)
6. Sound: celebration jingle via Web Audio API (2s, configurable)

**Add Task:** "＋ הוסף מטלה" at bottom of each column → bottom sheet with title input, recurrence picker (יומי/שבועי/חד פעמי), save/cancel

**Hide Completed Toggle:** "🙈 הסתר שהושלם" button, hides done tasks per column

**Data Model:**
- One Google Tasks List = One Person Column
- Config: `tasks.people: [{ name, color, listId }]`
- Settings: hideCompleted, celebrationSound, celebrationVolume

**API:** Google Tasks API, bidirectional
**Sync:** poll every 2 min, optimistic UI on tap

### Tab 3 — בית חכם (Home)
- Device tile grid (configurable count, default 10); scrollable if >10 entities
- Tile: icon + Hebrew label + status text
- Tap → toggle; long-press → entity-specific control popup
- **Entity type-specific behavior:**
  - `light.*` — tap: on/off; long-press: brightness slider (0–100%); if color-capable: color temp slider too
  - `climate.*` — tap: on/off; long-press: target temp slider + mode selector (cool/heat/auto/fan)
  - `switch.*` / `input_boolean.*` — tap: on/off only (no long-press popup)
  - `media_player.*` — tap: play/pause; long-press: volume slider
  - `cover.*` (gate, blinds) — tap: open/close toggle; long-press: position slider (0–100%)
  - `lock.*` — tap: lock/unlock (with confirmation dialog)
  - Unknown types: tap: toggle `homeassistant.toggle`, no long-press
- **Status text per type:** lights → "דולק/כבוי" + brightness %; climate → "24°C / קירור"; cover → "פתוח/סגור"
- 4 quick scene buttons (בוקר טוב / סרט / לילה / יציאה) — activation shows brief pulse animation + success toast
- **API:** Home Assistant REST + WebSocket (real-time push)
- **Auth:** Long-lived access token in `.env`

### Tab 4 — מוזיקה (Music)
- Album art (large gradient fallback)
- Track + artist, animated progress bar
- Controls: shuffle / prev / play-pause / next / repeat
- Volume slider (RTL — right = louder)
- Scrollable song queue
- **API:** Spotify Web API (Premium) OR MPD local — TBD
- **Spotify OAuth:** in-app "Connect Spotify" button → backend redirects to Spotify auth → callback stores tokens in SQLite → auto-refresh

### Tab 5 — חדשות (News)
- Featured headline (full-width)
- 4 news cards in 2×2 grid
- Category badge + relative timestamp
- Tap → **full story overlay:** slides up from bottom; shows headline, source, timestamp, article image (if available), and article body text; "Close" button at top
  - **Content source:** RSS provides summary/description (1–3 paragraphs typically); NewsAPI provides partial content; for full text, backend can optionally fetch + parse the original article URL (using `readability`/`mozilla-readability` library to extract clean text from HTML)
  - **Fallback:** if full text extraction fails → show available summary + "Open in browser" link (though kiosk mode limits this — may open in a new Chromium window)
- **API:** NewsAPI.org or Israeli RSS (Ynet/Channel 14)
- **Refresh:** every 30 min

### Settings Page (gear icon in TopBar or 6th tab — TBD)
Full configuration UI — replaces the need to edit `.env` or `config.json` by hand.

**Sections:**
- **Profile** — user name, greeting style, language
- **Location** — city, lat/lon (for weather)
- **Google Accounts** — list of linked accounts with "Add Account" / "Remove" buttons; per-account calendar toggle + color assignment; re-auth button if token expired
- **Home Assistant** — host URL, token (masked field), "Test Connection" button; entity list with toggle/label/icon editor; scene editor
- **Spotify** — connect/disconnect; show linked account name
- **News** — source toggles, refresh interval slider
- **Tasks** — column names, default list mapping
- **Display** — idle timeout slider, brightness default, screensaver style, temperature units (°C / °F)
- **System** — current version, "Check for Updates" button (see Auto-Update), restart app, restart Pi
- **Wi-Fi** — shortcut to the Wi-Fi balloon (or inline)
- **About** — version, IP address, uptime

All changes save to SQLite immediately. Backend reloads affected services without full restart.

### Connection Status & Error States
Each integration has 3 states: **connected**, **degraded** (auth expired / unreachable), **not configured**.

- **Not configured:** tab shows a centered illustration + "Set up in Settings" button (e.g., Calendar tab before Google is linked)
- **Degraded:** banner at top of the tab — "Google connection lost — tap to reconnect" / "Home Assistant unreachable — retrying…"
- **TopBar indicators:** small colored dot on each relevant icon (green = ok, amber = degraded, hidden = not configured)
- **Backend health endpoint:** `GET /health` returns status of all integrations — frontend polls every 30s

### Toast / Notification System
Lightweight overlay for transient events — no full-screen modals.

- Appears top-center, slides down, auto-dismisses after 4s (tap to dismiss early)
- Stacks up to 3 toasts; older ones collapse
- Types: **success** (green border), **warning** (amber), **error** (red), **info** (purple)
- Examples: "Wi-Fi disconnected", "Google token refreshed", "Home Assistant reconnected", "Task synced", "Update available"
- Frontend Zustand toast slice; `addToast({ type, message, duration? })`

### Auto-Update Mechanism
Keeps the mirror software current without requiring SSH access.

- **Backend route:** `GET /system/version` (current), `GET /system/check-update` (compare with remote)
- **Implementation:** `git fetch` + compare `HEAD` vs `origin/main`; if behind → show "Update available" toast + badge in Settings
- **Update flow:** Settings → "Check for Updates" → shows changelog → "Install Update" button → `git pull && npm install && pm2 restart all`
- **Optional:** cron job checks for updates daily at 3 AM, pushes notification via Socket.io if update available
- **Rollback:** on failure, `git reset --hard HEAD@{1}` + restart

### Screen Brightness Control
- TopBar brightness icon (sun) → balloon popup with slider (0–100%)
- **Implementation:** `ddcutil setvcp 10 <value>` for external monitors via DDC/CI, fallback to `xrandr --brightness` for software dimming
- **Backend route:** `POST /system/brightness { value: 0-100 }`
- Auto-dim: ties into idle screensaver (dim to 10% after timeout, wake on touch)

### Touch Feedback & Gestures
IR frame has no haptic — visual feedback is critical for responsiveness.

- **Tap ripple:** material-style ripple animation on all tappable elements (buttons, tiles, cards, tabs)
- **Swipe:** horizontal swipe on content area to switch between tabs (with snap animation)
- **Pull-to-refresh:** pull down on any synced tab (Calendar, Tasks, News) → triggers immediate re-sync + spinner
- **Long-press:** visual cue — element scales down slightly after 300ms hold, then triggers action (HA sliders, WiFi forget)
- **Touch highlight:** pressed state for all interactive elements (slight darken / scale 0.97)
- **Implementation:** CSS transitions + touch event handlers; consider `react-use-gesture` or Hammer.js for swipe/pinch

### Offline / Cached Data Strategy
Mirror must remain useful when internet drops temporarily.

- **Cache layer:** backend caches last successful API response per integration in SQLite (`cache` table: key, data JSON, fetched_at)
- **Stale-while-revalidate:** frontend always gets data immediately (cached), backend refreshes in background; if refresh fails → serve stale + show "last updated X min ago" muted timestamp
- **Calendar/Tasks:** cached events remain visible; edits queued locally, synced when connection restores
- **Weather:** stale data shown with amber dot; "last updated" timestamp visible
- **HA:** WebSocket reconnect loop (exponential backoff 1s → 30s); tiles show last known state with "offline" badge
- **News:** cached articles remain readable
- **Full offline:** TopBar shows "No internet" indicator; all tabs degrade gracefully to cached data

### Backend API Security
Prevent unauthorized access from other devices on the same network.

- **API token:** backend generates a random token on first run, stores in SQLite; frontend receives it during initial page load (embedded in HTML or fetched via localhost-only endpoint)
- **Auth middleware:** all API routes require `Authorization: Bearer <token>` header; reject without it
- **Localhost bypass:** requests from `127.0.0.1` / `::1` skip auth (for kiosk browser on same device)
- **Settings:** token visible in Settings → System for debugging; "Regenerate Token" button
- **CORS:** configured to allow only `http://localhost:3000` origin

### Crash Recovery / Watchdog
Ensure the kiosk recovers from browser or system issues without manual intervention.

- **Chromium watchdog:** `start-kiosk.sh` runs in a loop — if Chromium exits, wait 3s and relaunch
- **Health ping:** frontend sends heartbeat to backend every 15s via Socket.io; if backend doesn't receive for 60s → PM2 restarts the frontend process
- **OOM protection:** Chromium flags `--max-old-space-size=512` + `--disable-gpu` (fallback); PM2 `max_memory_restart: '300M'` for backend
- **Auto-restart on freeze:** cron job every 5 min checks if Chromium is responding (`xdotool` window check); if not → kill and relaunch
- **Daily reboot:** optional scheduled `sudo reboot` at 4 AM (configurable in Settings) to clear memory leaks

### Logging & Remote Diagnostics
Debug issues without SSH access to the wall-mounted device.

- **Backend logging:** `pino` logger → rotating log files in `logs/` (max 7 days, 10MB per file)
- **Log levels:** `error`, `warn`, `info` (default), `debug` (toggle in Settings)
- **Frontend errors:** global error boundary catches React crashes → sends to backend via `POST /system/log`
- **Log viewer:** Settings → System → "View Logs" — scrollable, filterable log viewer in the UI
- **Remote access:** optional `GET /system/logs?lines=100&level=error` endpoint (protected by API token)
- **PM2 logs:** `pm2 logs` still available via SSH as fallback

### Scheduled Display Power
No need for the screen to be on during sleeping hours.

- **Schedule:** configurable wake/sleep times (default: wake 06:00, sleep 23:00)
- **Sleep action:** dims to 0% + shows minimal clock (or turns off via `vcgencmd display_power 0` on Pi)
- **Wake action:** restores brightness + full UI
- **Override:** any touch during sleep hours → wake for 5 min, then sleep again
- **Shabbat mode (optional):** auto-sleep from candle lighting to havdalah (ties into Jewish calendar data)
- **Settings:** per-day schedule (e.g., Fri sleep earlier, Sat wake later)
- **Backend route:** `GET /system/schedule`, `POST /system/schedule`
- **Implementation:** `node-cron` job in backend; brightness control via same `ddcutil`/`xrandr` path

### Confirmation Dialogs
Prevent accidental taps on destructive or significant actions.

- **Confirm popup:** centered card overlay with Hebrew text, two buttons: "ביטול" (cancel) + "אישור" (confirm)
- **Actions that require confirmation:**
  - HA scene activation (especially "יציאה מהבית" — turns everything off)
  - Deleting a task
  - Forgetting a saved Wi-Fi network
  - Removing a linked Google/Spotify account
  - Installing an update
  - Restarting the app or Pi
- **Design:** semi-transparent backdrop, card with icon + message + two touch-friendly buttons (56px+ height)
- **Implementation:** Zustand `confirmSlice` — `showConfirm({ title, message, onConfirm })`

### On-Screen Keyboard
Touch device requires a built-in keyboard since no physical keyboard is attached.

- **Layout:** fixed at bottom of screen (40% height), semi-transparent backdrop over content above
- **Languages:** Hebrew (default) + English toggle button; switch flips all key labels
- **Hebrew layout:** standard Israeli QWERTY mapping (ק ר א ט ו ן ם פ / ש ד ג כ ע י ח ל ך ף / ז ס ב ה נ מ צ תץ)
- **English layout:** standard QWERTY
- **Rows:** 4 rows — letters, letters, letters + shift, bottom row (lang toggle, space, backspace, enter)
- **Key size:** minimum 48×48px (fits 10–11 keys per row at 1920px width)
- **Features:**
  - Shift key (toggle uppercase/lowercase for English; final-form letters for Hebrew handled automatically)
  - Backspace with hold-to-repeat (accelerating delete after 500ms)
  - Number row or number-mode toggle (for passwords, IPs, dates)
  - Special characters popup (long-press a key for alternatives, e.g., hold "a" → "à á â")
  - Input cursor visible in the text field above; tap to reposition cursor
- **Appearance:** `--surf` background, `--bd` key borders, `--acc` highlight on press; keys have subtle shadow for depth
- **Animation:** slides up from bottom (`--dur-normal --ease-out`); dismisses on "Done" key or tap outside input area
- **Library candidates:** `simple-keyboard` (lightweight, customizable), `react-simple-keyboard`, or custom implementation
- **Contexts used:** WiFi password, task title/description, setup wizard text fields, Settings text inputs, search

### Local Font Bundling
Ensure text renders correctly even when internet is unavailable at boot.

- **Bundled fonts:** download Heebo (woff2, weights 300–700) and DM Mono (woff2, weights 300/400) into `frontend/src/assets/fonts/`
- **CSS:** `@font-face` declarations pointing to local files; no Google Fonts CDN dependency
- **Preload:** `<link rel="preload">` in `index.html` for the most-used weights (Heebo 400/600, DM Mono 400)

### Photo Slideshow Screensaver
Family photo display during idle time instead of just a dim clock.

- **Source:** local folder (`~/photos/`) or Google Photos album (via API, optional)
- **Display:** full-screen photo with slow Ken Burns (pan + zoom) effect, clock overlay in corner
- **Transition:** crossfade between photos every 15s (configurable)
- **Settings:** enable/disable slideshow, photo folder path, transition interval, Google Photos album picker
- **Fallback:** if no photos configured → dim clock only (current plan)
- **Wake:** any touch → exit slideshow, return to last active tab

### Jewish Holidays / Hebrew Calendar
Relevant for Israeli household daily awareness.

- **TopBar:** Hebrew date already shown; add Jewish holiday name when applicable (e.g., "ערב שבת", "חול המועד סוכות")
- **Shabbat times:** candle lighting + havdalah times displayed on Friday in TopBar or Calendar
- **Calendar integration:** Jewish holidays shown as all-day events in the calendar grid (distinct color, e.g., light blue)
- **API:** [Hebcal API](https://www.hebcal.com/home/developer-apis) — free, no key, supports location-based zmanim
- **Data:** Shabbat times, major/minor holidays, Rosh Chodesh, fast days
- **Settings:** toggle which holiday types to show (major only vs. all)

### AC Control (IR-based via Scripts)
User's AC is controlled via 38 `script.aircon_*` HA entities (IR blaster). NOT a climate entity.

- **AC Widget on Home tab:** dedicated large tile (spans 2 columns) with:
  - Current state: on/off, temperature, mode (cool/heat), fan speed (low/mid/high)
  - Quick buttons: common presets (24°C cool low, 24°C cool mid, 30°C heat low)
  - Tap → expanded AC control panel: temp slider (16-30), mode toggle (cool/heat/auto/fan), speed selector (low/mid/high)
  - Maps user selections to the correct `script.aircon_*` entity and calls it
- **Script naming convention:** `script.aircon_{mode}_{temp}_{speed}` e.g. `script.aircon_24_low_on`, `script.aircon_heat_30_mid`
- **Off script:** `script.aircon_off` (or similar) to turn off

### Shopping List Widget
HA `todo.shopping_list` entity with active items. Display on dashboard.

- **TopBar badge** or **dedicated section** on Home tab showing item count
- **Tap → Shopping List overlay:** scrollable list of items, tap to check off, add new item via keyboard
- **Backend:** `GET /api/ha/services/todo/get_items` + `POST /api/ha/services/todo/add_item` + `POST /api/ha/services/todo/update_item`
- **Real-time:** listen for `ha:state_changed` on `todo.shopping_list`

### Person Presence Indicators
HA `person.yossef` and `person.maayan` entities track home/away status.

- **TopBar:** small avatar dots showing who's home (green dot = home, grey = away)
- **Home tab header:** "חיים בבית 🏠" / "מעיין לא בבית" status line
- **Backend:** already receives person state via HA WebSocket
- **Design:** 2 small circles (24px) with initials in TopBar utility area, colored border (green=home, grey=away)

### IMS Weather Integration
Use Israel Meteorological Service via HA `weather.ims_weather` entity for more accurate local weather.

- **Settings toggle:** "מקור מזג אוויר" — Open-Meteo (default) or IMS (via Home Assistant)
- **When IMS selected:** backend fetches weather from `GET /api/ha/states/weather.ims_weather` instead of Open-Meteo
- **Maps IMS conditions** to the same WeatherIcon component codes
- **Fallback:** if HA disconnected, fall back to Open-Meteo automatically

### Electricity Monitor Widget
Shelly EM power meter (`sensor.2_power_meter`) — show real-time power consumption.

- **Small widget** on Home tab (or TopBar): current watts display (DM Mono, live updating)
- **Home tab tile:** power consumption with mini sparkline chart (last 1 hour)
- **Backend:** fetch sensor value from HA state, push updates via Socket.io
- **Design:** lightning bolt icon + "350W" value, green (low) / amber (moderate) / red (high) color coding

### Smart Curtain Control
`cover.smart_curtain_robot_curtain` — dedicated curtain tile with position slider.

- **Home tab tile:** curtain icon, open/close status, position percentage
- **Long-press → slider popup:** vertical slider 0-100% position
- **Quick actions:** "Open" / "Close" / "50%" buttons
- Already partially supported by generic cover handling; enhance with curtain-specific icon and labels

### IR Remote Widget
WiFi IR blasters (`remote.wifi_ir_master_bedroom`, `remote.wifi_ir_childrens_room`).

- **Home tab:** IR remote tiles for each room
- **Tap → Remote control overlay:** grid of IR command buttons (power, volume+/-, channel+/-, mute, input)
- **Backend:** `POST /api/ha/services/remote/send_command` with device + command
- **Room-specific:** different button layouts per room (bedroom TV vs children's room)

### Multi-Resolution Support
Currently locked to 1920x1080. Make responsive for development and different displays.

- **CSS:** replace fixed `width: 1920px; height: 1080px` on `#root` with `width: 100vw; height: 100vh`
- **Tailwind:** add responsive breakpoints for common display sizes
- **Scale:** use CSS `scale()` transform to fit content if viewport differs from 1920x1080
- **Dev mode:** works in any browser window size
- **Pi kiosk:** still renders at native 1920x1080

### PWA Manifest
Enable installation as a web app on mobile devices for remote access.

- **`frontend/public/manifest.json`:** name, short_name, icons, display: standalone, theme_color, background_color
- **`index.html`:** `<link rel="manifest">` reference
- **Icons:** generate from app logo (multiple sizes: 192, 512)
- **Service worker:** basic offline caching of app shell (optional)

### Automation Controls
HA automations (`automation.sunrise`, `automation.sunset`, `automation.boiler_max_temp`).

- **Home tab section** or **Settings:** list of automations with enable/disable toggles
- **Backend:** `POST /api/ha/services/automation/turn_on` / `turn_off`
- **Status indicator:** green dot when enabled, grey when disabled
- **Trigger button:** manually run an automation

---

## 5. Known Issues / Future Improvements

| # | Area | Issue | Priority |
|---|------|--------|----------|
| 1 | Calendar | Event `top` position hardcoded — needs dynamic time calculation | High |
| 2 | Tasks | Drag-and-drop between Kanban columns not yet built | Medium |
| 3 | Tasks | Add-task button + on-screen Hebrew keyboard missing | High |
| 4 | Home | Long-press slider for brightness/temp not implemented | Medium |
| 5 | Music | Queue tap-to-play not wired | Low |
| 6 | General | Idle screensaver (dim + clock only after 5 min) | Medium |
| 7 | Calendar | Month view not available | Low |
| 8 | News | Full article overlay not built | Low |
| 9 | General | Multi-resolution testing needed | Low |

---

## 6. Integration Setup

### Google OAuth 2.0
**One-time developer setup:**
1. Google Cloud Console → enable Calendar API + Tasks API
2. Create OAuth 2.0 credentials (Web Application)
3. Redirect URI: `http://localhost:3001/auth/callback`
4. Scopes: `calendar.readonly` + `tasks`
5. Store client ID + client secret in `.env`

**On-device kiosk flow:**
1. User taps "Connect Google" in Setup Wizard or Settings
2. Frontend calls `GET /auth/google/url` → backend returns the OAuth consent URL
3. Frontend opens the URL in an **iframe overlay** (or navigates within the kiosk window)
4. User logs in to Google → consent screen → Google redirects to `/auth/callback`
5. Backend exchanges code for tokens, stores refresh token encrypted in SQLite
6. Backend sends `auth:google:success` via Socket.io → frontend closes overlay, shows linked account
7. Backend auto-refreshes access tokens; on failure → pushes `auth:google:expired` event → UI shows "Reconnect" banner
8. **Multiple accounts:** repeat flow; each account's tokens stored separately, keyed by Google email

### Home Assistant
```env
HA_TOKEN=<long-lived-access-token>
HA_HOST=http://homeassistant.local:8123
```
- HA Profile → Long-Lived Access Tokens → Create
- WebSocket subscription for real-time state push

### Weather (Open-Meteo — free, no key)
```
GET https://api.open-meteo.com/v1/forecast
  ?latitude=32.33&longitude=34.86
  &current=temperature_2m,weather_code,wind_speed_10m,relative_humidity_2m
  &daily=temperature_2m_max,weather_code
  &forecast_days=5
```

### Music — Spotify
- App at developer.spotify.com → store client ID + secret in `.env`
- Scopes: `user-read-playback-state user-modify-playback-state`
- **On-device flow:** same pattern as Google — "Connect Spotify" button → iframe overlay → callback → tokens in SQLite
- Redirect URI: `http://localhost:3001/auth/spotify/callback`
- Backend auto-refreshes; on failure → `auth:spotify:expired` Socket.io event

---

## 7. File Structure

```
smart-mirror/
├── frontend/
│   ├── index.html              ← lang="he" dir="rtl"
│   ├── vite.config.js
│   └── src/
│       ├── App.jsx
│       ├── styles/global.css   ← CSS variables + font import
│       ├── i18n/he.json        ← all Hebrew UI strings
│       ├── assets/fonts/       ← Heebo + DM Mono woff2 files
│       ├── store/              ← Zustand slices (toast, confirm, settings, etc.)
│       ├── hooks/              ← useCalendar, useTasks, useHA…
│       └── components/
│           ├── TopBar.jsx
│           ├── TabBar.jsx
│           ├── ToastContainer.jsx
│           ├── SetupWizard.jsx
│           ├── BrightnessPopup.jsx
│           ├── WeatherPopup.jsx
│           ├── WifiPopup.jsx
│           ├── OnScreenKeyboard.jsx
│           ├── ConfirmDialog.jsx
│           ├── EventDetailPopup.jsx
│           ├── TaskDetailOverlay.jsx
│           └── pages/
│               ├── CalendarPage.jsx
│               ├── TasksPage.jsx
│               ├── HomePage.jsx
│               ├── MusicPage.jsx
│               ├── NewsPage.jsx
│               └── SettingsPage.jsx
│
├── backend/
│   ├── server.js
│   ├── .env                    ← gitignored (client IDs, secrets, HA token)
│   ├── .env.example            ← template with all required vars + comments
│   ├── db/
│   │   ├── schema.sql
│   │   └── migrations/         ← numbered migration files (001_initial.sql, 002_add_cache.sql…)
│   └── routes/
│       ├── auth.js             ← Google + Spotify OAuth flows
│       ├── calendar.js
│       ├── tasks.js
│       ├── weather.js
│       ├── homeassistant.js
│       ├── music.js
│       ├── news.js
│       ├── wifi.js
│       ├── settings.js         ← CRUD for all config in SQLite
│       └── system.js           ← brightness, version, update, health
│
├── config.json
├── scripts/
│   ├── start-kiosk.sh
│   ├── setup.sh                ← full Pi setup script (see section 12)
│   └── backup.sh               ← SQLite backup to USB / remote
└── smart_mirror_plan.md
```

---

## 8. config.json

```json
{
  "location": { "city": "נתניה", "lat": 32.33, "lon": 34.86 },
  "language": "he",
  "userName": "חיים",
  "idleTimeoutMin": 5,
  "temperatureUnit": "C",
  "calendar": { "showWeekend": false },
  "hebrewCalendar": { "enabled": true, "showShabbatTimes": true, "holidayTypes": ["major"] },
  "display": {
    "schedule": { "wake": "06:00", "sleep": "23:00" },
    "screensaver": "slideshow",
    "photosPath": "~/photos/"
  },
  "music": { "provider": "spotify" },
  "news": { "sources": ["ynet", "now14"], "refreshMin": 30 },
  "homeAssistant": {
    "host": "http://homeassistant.local:8123",
    "entities": [
      { "id": "light.living_room",  "label": "סלון",     "icon": "💡" },
      { "id": "light.kitchen",      "label": "מטבח",     "icon": "💡" },
      { "id": "climate.ac",         "label": "מזגן",     "icon": "❄️" },
      { "id": "media_player.tv",    "label": "טלויזיה", "icon": "📺" },
      { "id": "switch.gate",        "label": "שער",      "icon": "🔒" }
    ],
    "scenes": [
      { "id": "scene.good_morning", "label": "בוקר טוב",    "icon": "🌅" },
      { "id": "scene.movie",        "label": "מצב סרט",     "icon": "🎬" },
      { "id": "scene.good_night",   "label": "לילה טוב",    "icon": "🌙" },
      { "id": "scene.leaving",      "label": "יציאה מהבית", "icon": "🚪" }
    ]
  },
  "tasks": { "columns": ["לביצוע", "בביצוע", "הושלם"] }
}
```

---

## 9. Kiosk Boot

```bash
# start-kiosk.sh
#!/bin/bash
sleep 5
xset s off && xset -dpms && xset s noblank
chromium-browser --noerrdialogs --kiosk --disable-translate \
  --no-first-run --fast-startup --disable-infobars \
  --disable-features=TranslateUI --app=http://localhost:3000
```

```js
// ecosystem.config.js (PM2)
module.exports = { apps: [
  { name: 'mirror-backend',  script: 'backend/server.js' },
  { name: 'mirror-frontend', script: 'npx vite preview --port 3000', cwd: 'frontend' }
]}
```

---

## 10. Infrastructure & DevOps

### `.env.example` Template
Shipped in repo so developers and `setup.sh` know which vars are required:
```env
# Google OAuth (from Google Cloud Console)
GOOGLE_CLIENT_ID=
GOOGLE_CLIENT_SECRET=

# Spotify (from developer.spotify.com)
SPOTIFY_CLIENT_ID=
SPOTIFY_CLIENT_SECRET=

# Home Assistant
HA_HOST=http://homeassistant.local:8123
HA_TOKEN=

# Backend
PORT=3001
NODE_ENV=production
```

### `setup.sh` Script
Full automated Pi setup — run once on fresh Raspberry Pi OS install:
```
1. Update apt, install system deps: Node.js 20 LTS, npm, git, ddcutil, xdotool, NetworkManager
2. Clone repo (or confirm it's already cloned)
3. Copy .env.example → .env, prompt user to fill in values
4. cd frontend && npm install && npx vite build
5. cd backend && npm install
6. Initialize SQLite database (run schema.sql + all migrations)
7. Download & install Heebo + DM Mono fonts to frontend/src/assets/fonts/
8. Install PM2 globally, run pm2 startup to configure autostart
9. Configure start-kiosk.sh as autostart (systemd or .bashrc)
10. Enable overlayfs read-only root (optional, prompted)
11. Print summary: IP address, ports, "Open http://<ip>:3000 to begin setup wizard"
```

### SQLite Schema Migrations
Auto-update pulls new code that may need DB changes. Migration system prevents crashes.

- **Migration files:** `backend/db/migrations/` — numbered sequentially: `001_initial.sql`, `002_add_cache_table.sql`, etc.
- **Version tracking:** `schema_version` table in SQLite with single row (`version INTEGER`)
- **Startup behavior:** on backend boot, compare current `schema_version` with highest migration number; run any unapplied migrations in order, inside a transaction
- **Rollback:** each migration file can optionally include a `-- DOWN` section for rollback SQL
- **Auto-update safe:** `git pull` brings new migration files; next backend restart applies them automatically before serving requests

### SD Card Protection & Backup
Pi SD cards corrupt easily from power loss. Protect data and enable recovery.

**Crash safety:**
- SQLite runs in **WAL mode** (`PRAGMA journal_mode=WAL`) — survives most power-loss scenarios
- Backend does graceful shutdown on `SIGTERM`/`SIGINT` — flushes WAL, closes DB

**Read-only root (optional):**
- Enable Raspberry Pi OS `overlayfs` via `raspi-config` → Performance → Overlay FS
- Writable partition only for: `/home/pi/smart-mirror/backend/db/`, `/home/pi/smart-mirror/logs/`, `/tmp`
- Prevents SD card wear from system writes

**Backup:**
- `scripts/backup.sh` — copies SQLite DB + `.env` to: USB drive (if mounted at `/media/usb/`) or remote path via `rsync`/`scp`
- Cron job: daily at 2 AM
- Backend route: `POST /system/backup` (trigger manually from Settings)
- Settings → System → "Backup Now" button + last backup timestamp display
- **Restore:** `setup.sh` checks for backup on USB at first run, offers to restore

### Development Workflow
Developers can run the mirror on a laptop (Mac/Windows/Linux) — not just on a Pi.

- **Dev mode:** `NODE_ENV=development` — relaxes CORS, disables auth middleware, enables verbose logging
- **Vite proxy:** `vite.config.js` proxies `/api/*` and `/socket.io` to `localhost:3001` so frontend dev server talks to backend seamlessly
- **Mock data:** backend serves mock/sample data when integrations aren't configured (fake calendar events, sample tasks, placeholder weather); allows full UI development without Google/HA/Spotify accounts
- **Hot reload:** Vite HMR for frontend; `nodemon` for backend during development
- **No Pi-specific deps required:** `ddcutil`, `nmcli`, `vcgencmd` calls are wrapped and gracefully no-op on non-Pi systems (log a warning, return mock data)
- **Scripts:** `npm run dev` in root starts both frontend (Vite dev) + backend (nodemon) concurrently

### Socket.io Event Naming Convention
All real-time events follow a namespaced pattern: `category:action`.

| Event | Direction | Description |
|-------|-----------|-------------|
| `auth:google:success` | server→client | Google OAuth completed |
| `auth:google:expired` | server→client | Google token refresh failed |
| `auth:spotify:success` | server→client | Spotify OAuth completed |
| `auth:spotify:expired` | server→client | Spotify token refresh failed |
| `ha:state_changed` | server→client | HA entity state updated |
| `ha:connected` | server→client | HA WebSocket connected |
| `ha:disconnected` | server→client | HA WebSocket lost |
| `music:state` | server→client | Playback state update (track, position, playing) |
| `calendar:synced` | server→client | Calendar data refreshed |
| `tasks:synced` | server→client | Tasks data refreshed |
| `system:update_available` | server→client | New version detected |
| `system:health` | server→client | Periodic health status push |
| `heartbeat` | client→server | Frontend alive ping (every 15s) |

### Timezone Handling
Correct timezone is critical for clock display and calendar event positioning.

- **System timezone:** set via `raspi-config` or `timedatectl` during `setup.sh` (default: `Asia/Jerusalem`)
- **Backend:** all date/time operations use the system timezone; `Intl.DateTimeFormat` for formatting
- **Calendar events:** Google Calendar API returns events with timezone info; backend normalizes all to local timezone before sending to frontend
- **Clock:** frontend uses `Intl.DateTimeFormat('he-IL')` — respects system locale
- **Config:** timezone is NOT user-configurable in Settings (use system-level setting to avoid conflicts); displayed in Settings → About as read-only info

### Boot Sequence & Power Recovery
After power outage or reboot, everything must auto-start in correct order.

```
1. Pi boots → Raspberry Pi OS loads
2. systemd starts NetworkManager → WiFi auto-connects (saved profile)
3. PM2 starts (via pm2 startup systemd):
   a. mirror-backend starts first (wait_ready: true)
      - Validates .env, runs migrations, opens SQLite
      - Starts Express + Socket.io on port 3001
      - Sends PM2 ready signal
   b. mirror-frontend starts (depends on backend ready)
      - Serves built React app on port 3000
4. start-kiosk.sh runs (via systemd or ~/.config/autostart):
   - Waits for localhost:3000 to respond (curl retry loop, max 60s)
   - Launches Chromium in kiosk mode
5. Frontend loads → checks /health → shows Setup Wizard or normal UI
```

- **PM2 ecosystem:** `wait_ready: true` + `listen_timeout: 10000` on backend; `depends_on: ['mirror-backend']` for frontend
- **Kiosk retry:** if localhost:3000 not ready → retry every 3s up to 60s; if still down → show error page via fallback HTML

### i18n / String Management
All user-facing text is in Hebrew, but strings should be maintainable.

- **Approach:** centralized JSON translation file at `frontend/src/i18n/he.json` — all UI strings keyed by ID (e.g., `"calendar.noEvents": "אין אירועים"`)
- **Usage:** `useTranslation()` hook returns `t('calendar.noEvents')` — simple key lookup, no full i18n framework needed (no plurals/gender complexity for single-language)
- **Why not hardcode:** keeps Hebrew strings in one reviewable file; makes it possible to add English or other languages later without touching components; easier for non-developer Hebrew speakers to review/fix text
- **Day/month names:** use `Intl.DateTimeFormat('he-IL')` for date formatting (not manual translation)
- **Numbers in RTL:** wrap numeric values in `<span dir="ltr">` to prevent RTL reordering of negative numbers, IP addresses, time ranges (e.g., "14:00–15:30")

### Backend Startup Validation
On boot, before serving any routes:
1. Check `.env` exists and has all required vars; if missing → log clear error + serve "Setup Required" page
2. Check SQLite is accessible and writable
3. Run pending migrations
4. Validate stored OAuth tokens (quick refresh attempt); mark integrations as degraded if expired
5. Log startup summary: version, integrations status, IP, port

---

## 11. Implementation Phases

### Phase 1 — Scaffold + Clock + Weather + Setup Wizard (Week 1)
- [ ] `setup.sh` script for fresh Pi setup
- [ ] `.env.example` template
- [ ] React + Vite + Tailwind scaffold (+ Vite proxy config for dev)
- [ ] `lang="he" dir="rtl"`, local font bundling (Heebo + DM Mono in assets)
- [ ] i18n: `he.json` string file + `useTranslation()` hook
- [ ] SQLite schema + migration system (version tracking, auto-run on boot)
- [ ] Backend startup validation (.env check, DB check, migration runner)
- [ ] SQLite WAL mode enabled
- [ ] Dev mode: mock data for all integrations when not configured
- [ ] Toast notification system + confirmation dialog component
- [ ] Skeleton loading states for all tabs
- [ ] Touch feedback system (tap ripple, press states)
- [ ] TopBar: live clock + Open-Meteo weather (with detail popup) + brightness control
- [ ] Tab shell (5 tabs + Settings, empty pages + empty states)
- [ ] All CSS design tokens (including animation timing tokens)
- [ ] Socket.io setup with event naming convention
- [ ] First-run Setup Wizard (steps 1–2: welcome + location)
- [ ] Backend API security (token auth + CORS)
- [ ] Logging setup (pino + rotating files)
- [ ] Boot sequence: PM2 ecosystem with wait_ready + kiosk retry loop

### Phase 2 — Google Calendar + Tasks + OAuth (Week 2–3)
- [ ] Google OAuth 2.0 backend (kiosk-compatible iframe flow)
- [ ] Multi-account support + token management in SQLite
- [ ] Setup Wizard step 3 (Google account linking + calendar picker)
- [ ] Calendar weekly grid with event colors (per-calendar colors)
- [ ] Week navigation (prev/next arrows + "Today" button)
- [ ] Fri/Sat column toggle (5 or 7 day view)
- [ ] Event detail popup (tap event → overlay card)
- [ ] Event rendering: all-day header row, multi-day spans, overlapping side-by-side
- [ ] Tasks Kanban board + task list selection (which Google list → which column)
- [ ] Task detail/edit overlay (title, description, due date picker, priority, delete)
- [ ] SQLite column state
- [ ] Bidirectional task sync
- [ ] Completed task auto-archive + "Clear Completed" button
- [ ] Connection status banners + "not configured" empty states
- [ ] Offline cache layer (stale-while-revalidate)
- [ ] Swipe gesture to switch tabs

### Phase 3 — Home Assistant (Week 4)
- [ ] HA REST + WebSocket integration
- [ ] Setup Wizard step 4 (HA host + token + entity discovery)
- [ ] Device tile grid + real-time state (entity type-specific UIs)
- [ ] Scene buttons + confirmation dialog for destructive scenes
- [ ] Long-press entity-specific control popups (brightness, temp, volume, position)
- [ ] HA connection status + error banners + offline tile badges

### Phase 4 — Music + News + Hebrew Calendar (Week 5)
- [ ] Spotify OAuth flow (kiosk-compatible) + Setup Wizard step 5
- [ ] Spotify or MPD music page
- [ ] News feed (RSS or NewsAPI) + full article extraction (readability) + Setup Wizard step 6
- [ ] Setup Wizard done screen (step 7)
- [ ] Jewish holidays + Shabbat times (Hebcal API) in TopBar + Calendar

### Phase 5 — Settings + System (Week 6)
- [ ] Full Settings page (all sections including Fri/Sat toggle, holiday toggles, temp units, task cleanup interval)
- [ ] `/health` endpoint + TopBar integration status dots
- [ ] Wi-Fi manager popup
- [ ] Screen brightness control (ddcutil / xrandr)
- [ ] Scheduled display power (wake/sleep times, per-day schedule)
- [ ] Auto-update mechanism (git-based)
- [ ] System info panel (version, IP, uptime, restart)
- [ ] Log viewer in Settings
- [ ] Backup system (backup.sh + Settings "Backup Now" button)

### Phase 6 — Polish + Hardening (Week 7–8)
- [ ] Idle screensaver — photo slideshow mode OR dim clock
- [ ] On-screen keyboard (Hebrew + English, `simple-keyboard` or custom)
- [ ] Offline fallback + graceful degradation per tab
- [ ] Chromium watchdog + crash recovery loop
- [ ] OOM protection (PM2 memory limits, Chromium flags)
- [ ] Optional daily reboot cron
- [ ] SD card protection (overlayfs read-only root, optional)
- [ ] PM2 auto-start on boot
- [ ] Pull-to-refresh gesture on synced tabs
- [ ] Fix all items in Known Issues table

---

## 12. Open Decisions

| # | Question | Status |
|---|----------|--------|
| 1 | Music: Spotify Premium or local MPD? | ❓ Decide |
| 2 | News: NewsAPI or Israeli RSS? | ❓ Decide |
| 3 | On-screen keyboard library | ❓ Decide |

---

*Design LOCKED ✅ April 2026 — see `smart_mirror_tabs_light` widget in conversation history*