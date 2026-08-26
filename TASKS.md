# TASKS

Working task list for ongoing development. Checked items are done and verified
(build passes). New items found by Claude or subagents get appended with a
source note.

> Note: this file was repeatedly overwritten by concurrent subagents working
> from stale copies (dropping entries, resurrecting already-fixed items). This
> is an authoritative rewrite reconciled against `git log`.

## Requested

_(none)_

## In progress

_(none)_

## Backlog — correctness / real bugs

_(none known — verify the new 56px controls and popup clamps on the real
1920x1080 kiosk frame when next on-device.)_

## Backlog — features / gaps

- [ ] Vestigial Spotify plumbing after the YouTube migration: `/api/system/health`
      still reports a `spotify` integration, `useHealth.js:47` still maps it into
      `connections.spotify`, and `store/index.js:161` still seeds it. Nothing
      renders it (TopBar shows only wifi + ha), so it's harmless dead state
      rather than a misleading UI — but it should be removed along with the
      remaining Spotify credential paths in `auth.js`/Settings.

## Backlog — design follow-ups

- [ ] **`--tm` is used as real text 77 times at 2.05:1 (light) / 2.78:1 (dark).**
      Needs a per-usage audit, NOT a token change: `--tm` is the muted/tertiary
      tier, and darkening it to 4.5:1 would collapse it into `--ts` and destroy
      the three-tier text hierarchy. WCAG exempts genuinely decorative and
      disabled text, so the work is deciding, per call site, which `text-tm`
      instances are real readable content (→ move to `--ts`) and which are
      decorative marks/placeholders (→ leave, and ideally stop using a *text*
      colour for them). The News redesign already did this for its own screen.
- [ ] **No scalable-text support.** The HIG accessibility reference asks for up
      to 200% text scaling; the app is a fixed 1920x1080 transform-scaled canvas
      with no text-size setting. Would need a Settings control + `global.css`.
- [ ] **`bg-acc` + `text-white` is 3.21:1 in dark mode** (4.72:1 light). It's the
      app-wide primary-button pairing. Currently only legal where it's bold and
      ≥19px (the HIG 3:1 row). Proper fix is a token change to `--acc`.
- [ ] `SkeletonBlock`'s default 8px radius is off the locked radius scale, but
      it's shared by six skeletons — change it deliberately, in one pass.

- [ ] `--amber` (`#e0a630` light / `#f0b840` dark) is the only color token with
      no `-rgb` channel sibling and no `tailwind.config.js` entry, so it can't
      be used as a utility or with an opacity modifier. Add the triplet if the
      electricity-tile amber is meant to be a first-class token.

## Done

- [x] **Flashable OS image (pi-gen kiosk appliance) (user-requested).**
      New `image/` directory: `build.sh` clones pi-gen (arm64/Bookworm),
      injects `stage-smartmirror`, and builds via Docker → flashable
      `smart-mirror.img.xz`. The stage: (00) apt packages incl. X11,
      Chromium, ffmpeg, ddcutil; (01) Node 20 + yt-dlp + clone/build app
      into `/opt/smart-mirror`; (02) systemd services for backend :3001 +
      frontend :3000, tty1 autologin → startx → Chromium kiosk, i2c for
      brightness. Added `.gitattributes` (LF for shell/stage files),
      gitignored `image/pi-gen/`, docs in `image/README.md` + main README
      section. All bash scripts syntax-verified (`bash -n`).

- [x] **WiFi: audited for Pi-readiness, fixed 4 real nmcli bugs (user-requested).**
      Frontend is fully real (always hits `/api/wifi/*`); backend mocks only
      run on non-Linux dev machines. Fixed the Linux (`nmcli`) paths that
      would have broken on the Pi: (1) `/status` queried a wired-only field
      on hardcoded `wlan0` and returned no signal/ip/mac — rewritten to use
      `device wifi list` (ACTIVE row) + auto-detected wifi interface for
      IP/MAC; (2) terse output parsing split on raw `:` which broke SSIDs
      containing colons — added a proper `\:`-aware `splitTerse` parser
      (unit-verified); (3) a failed connect (wrong password) left a broken
      saved profile making all retries fail — profile now deleted on failure;
      (4) connect timeout raised 15s→45s (scan + DHCP can exceed 15s).

- [x] **Brightness button did nothing (user-reported).**
      Two bugs: frontend sent `{ brightness }` while backend read `req.body.value`
      (always fell back to 50), and on non-Linux / unsupported hardware nothing
      visible happened. Fixed the payload mismatch (backend now accepts both
      keys), persisted the level in localStorage (slider no longer resets to
      80%), and added a software dimming overlay (`#brightness-dim-overlay`,
      pointer-events-none, capped at 85% black) applied on load and on change —
      brightness now visibly works on any hardware, alongside
      ddcutil/sysfs/xrandr on the Pi.

- [x] **Shopping list: on-screen keyboard + longer list (user-reported).**
      The add-item input never opened `OnScreenKeyboard` on the touch kiosk.
      Wired it per the TasksPage pattern: input `onFocus`/`onClick` opens the
      keyboard driving `newItem` state (Enter adds and keeps the keyboard up
      for burst entry); the popup's outside-click handler is suppressed while
      the keyboard is open       so key/backdrop taps don't close the popup. The keyboard is portaled
      to `#root` — rendered inside the popup it inherited the popup's
      `transform` (from the popupIn entrance animation), which made
      `position: fixed` resolve against the 320px popup box instead of the
      viewport and trapped the keyboard inside the list; portaling to
      `document.body` instead escaped the app-scale transform and rendered
      the keys unscaled/tiny, so `#root` is the correct target (escapes the
      popup, keeps the 1920×1080 canvas scale). List
      area lengthened 240→520px (popup max-h 460→760px); while the keyboard
      is open the list caps at 260px so the add row stays above the keyboard
      panel (bottom 40% of the 1080 canvas).

- [x] **Shopping list popup opened detached from its anchor, far off to the
      left (user-reported, with screenshot).** Root cause: the popup used
      `position: fixed` + `getBoundingClientRect()`/`window.innerWidth`
      viewport math, but it renders inside `#root`, which carries
      `transform: scale(var(--app-scale))` — a transformed ancestor turns
      `fixed` into "absolute relative to #root", so the popup was placed in
      #root's unscaled 1920×1080 coordinate space using viewport (scaled)
      coordinates. Fixed by switching to the codebase's other-popover
      pattern (`WeatherPopup`): `absolute top-full start-0 mt-3` inside the
      TopBar button's `relative` wrapper — no coordinate math at all.
      Removed `computePosition`/position state/resize listener; added the
      missing anchor exclusion to the outside-click handler (clicking the
      cart button while open now closes instead of reopening, matching
      `WeatherPopup`). Apple-design polish pass on the same component:
      count badge 10px→11px (typography minimum), removed dead `group`
      classes, completed rows no longer dim the delete button along with
      the content (`opacity-50` removed — line-through + check icon still
      signal state). Build clean; hot-reloaded into the running dev server.

- [x] **Shopping list popup always empty despite 26 items in HA
      (user-reported).** Root cause: `todo.get_items` is a response-data
      service — HA 400s with "Service call requires responses but caller did
      not ask for responses. Add ?return_response to query parameters"
      unless that param is on the URL, and the route then silently fell back
      to `/api/states/<entity>`, whose attributes never contain the items
      (state is just the item count), so the popup always rendered empty.
      Fixed `GET /api/ha/todo/:entity_id` in
      `backend/routes/homeassistant.js`: added `?return_response` and parse
      the real REST wrapper shape
      `{ changed_states, service_response: { "<entity>": { items } } }`
      (older shapes kept as fallbacks). Verified live against the real HA:
      all 26 items load with the `summary`/`status`/`uid` fields the popup
      expects; add/update/remove endpoints untouched (not response-data
      services).

- [x] **Chores tab — photos uploaded from the camera icon persist in the DB.**
      (user request) The avatar/camera button on each person already opened a
      file picker but only stored the result in `localStorage`
      (`chores_avatars`), so photos didn't survive or sync. Added a
      lazily-created `avatar TEXT` column on `chore_people`,
      `PUT`/`DELETE /api/tasks/people/:id/avatar` (validated image data URL,
      ≤1.5 MB, JSON body limit raised to 2 MB), and the people payload now
      carries `avatar`. The page uploads via the hook and emits
      `tasks:updated`, so a photo taken on one device appears on the others.
      **Root cause of "tapping does nothing", found via Playwright E2E:** the
      `ProgressRing` SVG is `absolute inset-0` *on top of* the static avatar
      button, so it swallowed every tap — the button never received a click.
      Fixed with `pointer-events-none` on the ring SVG; also removed
      `capture="environment"` (forces a camera app that may not exist),
      reset `input.value` after each pick so re-picking the same file
      re-fires `onChange`, and added success/error toasts. Verified in real
      Chromium: tap → file chooser opens → resize → PUT → avatar in DB.
- [x] **Chores tab — mock data removed, everything backed by SQLite.** (user
      request) `useChores.js` shipped 3 mock people with 14 hard-coded Hebrew
      chores and used them whenever `import.meta.env.DEV` was true, so in dev
      nothing touched the DB and toggles were lost on reload. The hook now
      always goes through `/api/tasks/people` (people + chores), with Socket.io
      `tasks:updated` live sync. Family members are now persisted in the DB:
      Settings → Family loads from `/api/tasks/people` (seeding from
      `chores_people` localStorage on first run so existing installs converge),
      and add/remove person hit new `POST`/`DELETE /api/tasks/people[/:id]`
      routes (delete cascades to that person's chores). Every chores mutation
      route now emits `tasks:updated`.
- [x] **Tasks tab — mock data removed, everything backed by SQLite.** (user
      request) `useTasks.js` shipped 10 hard-coded Hebrew mock tasks and used
      them whenever `import.meta.env.DEV` was true, so in dev the tab never
      touched the DB and every mutation was lost on reload. The mock array and
      dev branch are gone: the tab always reads/writes through `/api/tasks`
      (Vite proxies to the backend in dev, so the same code path runs
      everywhere).
- [x] **Tasks tab — checklist sub-items inside tasks; list badges removed.**
      (user request) Each task now holds a tickable checklist, edited inside
      the task detail overlay: `kanban_subtasks` table (migration
      `005_task_subtasks.sql`, `ON DELETE CASCADE` from `kanban_tasks`),
      `POST/PATCH/DELETE /api/tasks/:id/subtasks[/:subId]` routes, subtasks
      embedded in the task payload, and an overlay section with circular
      tick boxes, strike-through on done items, per-item delete, and an
      add-item row (on-screen keyboard, Enter adds). Cards show a
      "x מתוך y בוצעו" progress line when a task has items.
      Note: the live DB had already recorded schema_version=5 from the
      earlier `005_task_lists.sql` experiment, so the subtasks migration was
      applied by hand and the leftover `task_lists` table dropped — on a
      fresh DB the migration runs normally. The list/badge feature itself was
      rejected by the user and fully removed: picker UI, card pill, and
      `/api/tasks/lists` routes (the unused `list_name`/`list_color` columns
      remain in the `kanban_tasks` schema but nothing reads or writes them).
- [x] **Tasks tab — position-aware drag reorder.** The `position` column
      existed in the schema but drag-and-drop only changed `status` — cards
      always appended to the end of the target column and could never be
      reordered within a column. The drag now tracks a `{ col, index }`
      insertion point (pointer vs. card midpoints, dragged card excluded),
      renders an accent drop indicator at that slot, and persists the new
      order via bulk `PUT /api/tasks/reorder` (single transaction; source
      column reindexed on cross-column moves). New tasks now also append at
      the end of *their* column instead of using a global max position.
- [x] **Tasks tab — single-request clear-completed.** `clearCompleted` fired N
      parallel `DELETE /api/tasks/:id` calls (one per done task) and any
      failure triggered a full refetch. Now one `DELETE /api/tasks/completed`.
- [x] **Tasks tab — Socket.io live sync.** Every mutation route emits
      `tasks:updated`; `useTasks` subscribes (same `io('/')` singleton pattern
      as `useHomeAssistant`) and refetches, so changes from another
      tab/device appear without waiting for the 2-minute poll.
- [x] **News section redesigned against the Apple HIG** (using the cloned skill
      at `.github/skills/apple-design-skill/`, HIG-cited review then
      implementation). The old page was a phone layout on a 1920x1080 wall
      panel: one 1872px column, 11-15px metadata, 16px body, headlines over
      arbitrary news photography. Rebuilt as a front page (lead + two seconds +
      a scrolling timeline rail), body 16px → 22px/1.8, reading measure
      1872px → 856px (~78ch) for ~2.5m viewing.
      Real accessibility violations fixed, ratios independently re-verified by
      hand: the category badge failed in every colour and both themes
      (2.61-4.02:1 → 11.34-13.49:1); secondary text was 3.91:1 and separators
      2.05:1 → `text-tp/70` at 6.21:1 light / 7.44:1 dark; and **no text sits
      on an image anywhere on the screen any more**, so headline contrast no
      longer depends on whatever the newsroom published (16.8:1 on `bg-surf`).
      Added an onscreen refresh (pull-to-refresh was the only way to reload),
      an explicit notice + retry when article extraction fails (it used to
      silently show the RSS summary under a full-size headline), and
      Escape/`role="dialog"`/reduced-motion on the overlay.
      Notable interaction: `text-tp/70` only emits CSS *because* of the
      `<alpha-value>` token fix — before it, an opacity modifier on a theme
      colour produced no rule at all, so all 14 usages would have silently
      failed.
- [x] **Fixed the app-wide secondary-text contrast the review surfaced** —
      light-mode `--ts` was 3.91:1 on `--surf`, 3.46:1 on `--s2`, 3.58:1 on
      `--bg`, all below the 4.5:1 floor, across 118 usages. Darkened to
      `#676b85` preserving hue (5.23 / 4.63 / 4.79:1). Dark mode already passed
      at 6.54:1 and is untouched.
- [x] **Verified the dark-mode rewrite rather than trusting it** — the change
      swapped every color token to RGB channel triplets, where a single
      hex→decimal slip would silently shift the palette. Checked all 18
      light + dark conversions programmatically against the original hex:
      exact. Confirmed from the built CSS that `.bg-surf` now emits
      `rgb(var(--surf-rgb) / …)` and — the case that made the naive
      `surf: 'var(--surf)'` fix unsafe — that opacity modifiers now emit real
      rules (`.bg-tp\/50{background-color:rgb(var(--tp-rgb) / .5)}`).
- [x] **Removed the token duplication that rewrite left behind** — 36 tokens
      were defined twice per theme (`--surf: #fff` *and*
      `--surf-rgb: 255 255 255`). They matched, but editing one without the
      other would have split the 477 Tailwind utility usages from the 72
      `[var(--x)]` arbitrary-value usages, in one theme only. Now
      `--x: rgb(var(--x-rgb))`, triplet is the single source of truth, and the
      comment documents the rule. Safe: nothing reads these from JS.
- [x] **Runtime verification of the backend** (unverified across ~40 commits):
      boots clean, `/api/system/health` reports `database: ok` and Home
      Assistant `configured: true, reachable: true` against the live instance.
      All three migrations applied in the real DB (`schema_version` = 3, with
      `kanban_tasks`, `chore_people`, `chore_tasks` present).
- [x] **Committed load-bearing untracked work** — `frontend/src/context/`
      `MusicContext.jsx` was untracked while already imported by `App.jsx`,
      `MusicPage.jsx` and `TopBar.jsx`, so a fresh clone would not have built.
      Also gitignored `backend/*.log` (PM2 writes `err.log`/`out.log` beside
      the backend and they were surfacing as untracked noise).

- [x] **Fix Google account connection → Google integration fully removed;
      family calendar via ICS; Tasks tab converted to local SQLite (user
      request).** Root cause of the original failure: `GOOGLE_CLIENT_ID` /
      `GOOGLE_CLIENT_SECRET` in `backend/.env` were empty (verified live:
      `/api/system/health` → `google.configured=false`,
      `/api/auth/google/url` → 503). The "calendar not syncing" report was
      actually a working ICS pipeline with an empty calendar — the family
      feed's last event is 2026-07-22 (verified via `/api/calendar/ics`
      returning 13 June–July events). Per user decision, ALL Google OAuth
      code was removed instead of re-credentialed:
      backend — Google routes/helpers/exports stripped from `auth.js`
      (Spotify + token encryption kept), Google `/calendar/events`
      read+write routes removed from `calendar.js` (ICS kept), `google`
      dropped from `/api/system/health` and `server.js` OPTIONAL_VARS,
      empty `GOOGLE_*` vars removed from `.env` + `.env.example`;
      `backend/routes/tasks.js` rewritten from Google Tasks API to local
      SQLite (new migration `003_kanban_tasks.sql`, `kanban_tasks` table) —
      this also fixed a latent contract mismatch where the Google-shaped
      responses never matched the kanban UI's expected shape. Frontend —
      wizard's Google step + `GoogleAccountCard` removed (steps
      renumbered), Settings Google-accounts section removed, CalendarPage's
      Google write path removed (event editor/plus button/slot-click/detail
      actions; orphaned `EventEditor.jsx` deleted), `useAuth` reduced to
      Spotify-only, `connections.google` dropped from store + `useHealth`,
      dead i18n keys removed from `he.json`. Verified: `node --check` all
      touched backend files, `npx vite build` clean, backend restarted and
      live-tested — health shows no `google`, tasks CRUD round-trip passes
      (POST→PATCH→DELETE), `/api/calendar/ics` returns family events,
      `/api/auth/google/*` → 404, chores routes unaffected. Note: ICS feeds
      are read-only, so calendar events are now view-only on the mirror
      (add/edit in Google Calendar directly).

- [x] **Music: keep playback running in the background when leaving the
      Music tab, and show a mini-player in the TopBar (user-reported).**
      Root cause: `useMusic()` (and the YouTube iframe it owns via
      `useYoutubePlayer.js`) was only ever instantiated inside
      `MusicPage.jsx`, which fully unmounts on tab switch (`App.jsx`'s
      `TabContent` only renders the single active tab) — this destroyed the
      iframe (`playerRef.current?.destroy?.()` in the cleanup) and killed
      YouTube playback. Fixed by lifting the player to a persistent
      app-root provider instead of duplicating/rebuilding it per tab:
      - New `frontend/src/context/MusicContext.jsx`: `MusicProvider` calls
        `useMusic()` exactly once and renders the single real player `<div>`
        permanently, positioned via `position: fixed` to "dock" wherever a
        consumer currently claims it (`registerDock(ownerId, rect)` /
        `unregisterDock`), or off-screen (1×1 at -9999,-9999) when nothing
        claims it — the iframe itself is never destroyed/recreated, so
        playback continues uninterrupted. Mounted once in `App.jsx`,
        wrapping `TopBar`/`TabBar`/`TabContent` (survives all tab switches).
      - `MusicPage.jsx` no longer calls `useMusic()` directly — it consumes
        `useMusicContext()` and its old player `<div>` became a measuring
        placeholder (`dockAnchorRef`) that registers/re-measures
        (`ResizeObserver` + window resize) its `getBoundingClientRect()` so
        the real player docks into the visible 400×400 "album art" box
        while that tab is active, and releases on unmount.
      - New `MusicMiniPlayer` in `TopBar.jsx`: shown whenever a track is
        loaded and the Music tab (index 4) isn't already active — static
        `imageUrl` thumbnail (not the live video, since the real iframe
        stays docked/hidden elsewhere), truncated title/artist (RTL), and
        prev/play-pause/next controls reading from the shared context;
        tapping the strip navigates back to the Music tab.
      - Verified live end-to-end with a real headless-Chromium run
        (Playwright, installed temporarily and removed after — confirmed
        `backend/package.json` has no leftover diff): started a real
        YouTube track from the "recommended" playlist, confirmed exactly
        one `<iframe>` exists throughout, confirmed its bounding rect
        matches MusicPage's 400×400 box while active (`top:620,left:1182,
        400x400`) and moves to the off-screen dock (`1x1 @ -9999,-9998`)
        immediately after switching to the Calendar tab (same iframe
        instance — never recreated), confirmed the TopBar mini-player
        renders the correct track/artist while away from Music, and
        confirmed tapping the mini-player returns to the Music tab.
      - Frontend build (`npx vite build`) verified clean throughout.
- [x] **News: Globes source was showing English headlines in the Hebrew RTL
      news feed (user-reported).** Root cause: the Globes RSS URL used
      `iID=1725`, which is `en.globes.co.il`'s English-language feed
      (`<language>en</language>`, links to `en.globes.co.il`) — verified live
      by fetching the raw feed. Found the correct Hebrew feed by inspecting
      `<link rel="alternate" type="application/rss+xml">` tags on
      globes.co.il's homepage; switched to `iID=9917` ("בארץ" — Globes'
      general Hebrew business/economy feed, confirmed `<language>he</language>`
      live). Verified live: headlines now return real Hebrew text (e.g. "טראמפ
      חושף פרטים על מצבו של ח'אמנאי..."). No frontend changes needed.
- [x] **Calendar month view** (PLAN.md Known Issues #7) — new `MonthGrid`
      component (Sunday-first Israeli week, up to 3 event chips per cell,
      "+N עוד" overflow, today ring, dimmed adjacent-month days); week/month
      segmented toggle persisted to localStorage; `useCalendar` now takes an
      explicit range covering grid spillover (abort + request-id guards
      preserved); day selection shows an agenda in the sidebar slot; month
      nav, swipe, pull-to-refresh and a `MonthGridSkeleton` all work in both
      views.
- [x] **Task column names wired; dead cleanup setting removed** (user
      decision) — `taskCol1/2/3` now rename the Tasks kanban columns (labels
      read from store settings with i18n defaults); `taskCleanupInterval`
      select removed from Settings since it never had an effect.
- [x] **News: structural in-article images + noise filtering + 6 new
      sources** — extraction emits ordered typed blocks (text/image) so
      in-body photos render at their position; class-token-prefix noise
      removal + line filters for credits/bylines/comment counters; JSON-LD
      fallback-only. Added tgspot, geektime, gadgety, hwzone, one, globes
      (verified live; full Chrome UA for all fetches — Globes 403s
      otherwise). `news_sources` config filtering with all-on default and
      selection-keyed cache. `detectCategory` gained a source hint +
      sport/tech/finance keywords.

- [x] **News: expand source list + real Settings news-source picker
      (user-reported, two combined requests).** Note: the backend
      `DEFAULT_SOURCES` catalog and per-selection cache-key invalidation in
      `backend/routes/news.js` were already added by a concurrent process
      before this pass (tgspot, geektime, gadgety, hwzone, one, globes) —
      this pass verified each feed URL live, added the missing TheMarker
      feed (`https://www.themarker.com/srv/tm-all-articles`, confirmed 200
      + valid RSS/media namespaces), and built the actual picker UI:
      1. **Sources verified live, one by one**, not guessed: Ynet, now14,
         tgspot, geektime, gadgety, hwzone, one (covers Sport1 — one.co.il
         and sport1.maariv.co.il share the same feed/network), globes, and
         themarker all return real 200 RSS responses. **Sport5 and Calcalist
         do not have a working public feed** as of this writing — sport5.co.il
         returns HTTP 500 on every RSS path tried (server-side error, feed
         generator appears discontinued) and calcalist.co.il returns HTTP 403
         on every RSS path even with a full browser User-Agent (bot-blocked
         at the edge) — documented in a code comment in `news.js` rather than
         silently dropped, so this is discoverable if either site's feed
         comes back later.
      2. **`GET /api/news/sources`** (new route) returns the full catalog
         (`id`, `name`, `category`) plus the currently-`enabled` id list, so
         the frontend doesn't need to duplicate the source list.
      3. **`SettingsPage.jsx`'s `NewsSection`** was rewritten from two dead
         hardcoded toggles (`newsYnet`/`newsNow14`, which `backend/routes/
         news.js` never actually read) into a dynamic list: fetches the
         catalog on mount, renders one `ToggleRow` per source, and saves the
         selected id array to the `news_sources` config key (the exact key
         `resolveSources()` in `news.js` already reads) via `updateSettings`.
         Guards against saving an empty selection (toast + no-op) so news
         can't be silently disabled entirely by unchecking everything.
      4. **The onboarding wizard's step 6** (`SetupWizard` in `App.jsx`) had
         its own separate, equally-dead Ynet/now14-only toggle pair — fixed
         the same way (dynamic catalog fetch, writes `news_sources` on
         finish) so both places manage the exact same setting instead of two
         different dead ones.
      Verified end-to-end live: `PUT /api/settings` with `news_sources:
      ['ynet','globes']` → `GET /api/news` returned articles from only those
      two `sourceId`s; re-verified via a live headless-Chromium (Playwright)
      render of the real Settings page showing all 9 source toggles
      (Ynet, ערוץ 14, TGSpot, גיקטיים, גאדג'טי, HWZone, ONE, גלובס,
      TheMarker) rendered and functional. Reset to all-sources-enabled after
      testing. Frontend build clean.
- [x] **Critical: onboarding wizard reopened on every page load, hiding the
      real Settings page — root cause of "I cannot see the new news pickers"
      and likely also of earlier "settings not saving" confusion (user-
      reported).** Found via a live Playwright trace of the running app:
      `App.jsx`'s initial `fetch('/api/settings')` handler treated the raw
      response object as the settings payload, but `GET /api/settings`
      actually returns `{ settings: {...} }` (verified via `useSettings.js`,
      which correctly unwraps it). Because of the missing unwrap, `data.
      firstRun` was always `undefined` (never the real saved `false`), and
      the check `if (data.firstRun !== false) setShowWizard(true)` fired on
      *every single load*, permanently re-showing the full-screen (`z-100`)
      setup wizard overlay in front of the actual app — including its own,
      separate, equally-dead `newsYnet`/`newsNow14` toggle pair on wizard
      step 6 (a duplicate of the dead toggles already flagged in the Settings
      task below). This also meant every other field this fetch spread onto
      the store (`darkMode`, `calendarColors`, etc.) was silently dropped in
      favor of hardcoded defaults on first paint — e.g. saved dark-mode
      preference was being ignored and re-detected from system preference on
      every reload, until some other component's fetch happened to overwrite
      it later. Fixed by unwrapping `body.settings` before use in `App.jsx`.
      Verified live with a real headless-Chromium (Playwright) run against
      the dev server: before the fix, the wizard opened on load and blocked
      all tab navigation; after the fix, the app opens straight to the last
      active tab, and a News-tab check confirmed all 30 Ynet headline images
      load successfully (HTTP 200, real natural widths) — the images were
      never broken; the wizard overlay sitting on top of everything is what
      the user's screenshots/described experience actually maps to. Frontend
      build clean.
- [x] **News: full-article extraction rewritten to be structural and noise-
      free — fixes both "photographer/comments/writer noise" and "images not
      shown at their position" (user-reported).** Installed `cheerio` (real
      DOM parsing — the previous regex-based `<article>` scraping was the
      root cause of both bugs) and rewrote `GET /api/news/:id/full` in
      `backend/routes/news.js`:
      1. **Noise removed at the source, not filtered after the fact.** Tries
         the page's JSON-LD `NewsArticle.articleBody` first when present
         (verified live on Ynet — completely clean plain text with zero
         bylines/credits/comment-counts, since it's the same text schema.org
         feeds to Google, not the rendered widget-laden page). Falls back to
         DOM extraction for sites without it (verified live on now14/c14):
         locates the article body container via class-substring matching
         (`articleContent`/`article-content`/`entry-content`/`post-content`/
         `<article>`, to survive hashed Next.js CSS-module class names),
         strips known noise containers first (`[class*="comment"]`,
         `[class*="related"]`, `[class*="byline"]`, `[class*="credit"]`,
         `figcaption`, etc.), then drops any surviving noise lines by pattern
         (`^צילום:`, comment-counter `^\d+\s*תגובות`, `כתבו תגובה`).
      2. **In-article images now preserved at their real position** instead
         of being stripped along with all other tags. The DOM-walk path
         emits an ordered `blocks` array (`{type:'text'|'image', ...}`)
         instead of one flattened string; `NewsPage.jsx`'s new
         `ArticleBlocks` component renders paragraphs and inline photos
         interleaved in original order (graceful per-image fallback on load
         error). Filters out non-photo noise that slipped into the image
         walk: UI icons (`.svg`, `_next/static/media` gallery-nav/maximize
         icons) and WordPress `-150x150` thumbnail-sized images (used for
         related-post widget cards, never real in-article photos).
      Verified live end-to-end against real Ynet (JSON-LD path, 1 clean text
      block) and now14 (DOM-walk path, 16 blocks — 5 real content photos
      correctly interleaved with paragraph text, zero widget noise). Frontend
      build clean.
- [x] **WeatherPopup shows the configured city** — pin icon + `location`
      (+ country) row at the top of the popup, rendered only when the city
      picker has saved one.
- [x] **News: article overlay now opens/slides in from the left** (user-
      reported — was a bottom sheet). `ArticleOverlay` in `NewsPage.jsx`
      changed from a `translateY(100%→0)` bottom sheet to a left-anchored
      side panel (`translateX(-100%→0)`, `top-0 left-0 h-full w-[92%]
      max-w-[640px]`, `rounded-e-3xl`). Deliberately uses literal `left-0`
      rather than the logical `start-0` so it always opens from the physical
      left edge regardless of RTL, per the explicit request. Verified via
      build.
- [x] **News: photos now shown on headlines and full articles** (user-
      reported — no images anywhere). `backend/routes/news.js`:
      `parseRSSItems()` now captures a lead image per item from
      `<enclosure type="image/*">` / `<media:content>` / `<media:thumbnail>`,
      falling back to the first `<img>` in the description HTML; the
      `/:id/full` route now also extracts `og:image`/`twitter:image` from the
      article page. `NewsPage.jsx` renders these: featured-card background,
      headline-row 64px thumbnail (`HeadlineThumb` component with graceful
      fallback to the category glyph on load error), and the article-overlay
      hero (prefers the full-article's `og:image` once loaded). Verified live
      against the real Ynet/now14 feeds — images now populate for articles
      that have them.
- [x] **News: garbled/mojibake text + unescaped HTML entities fixed** (user-
      reported — e.g. a literal `&#034;` instead of a quote, and byte-soup
      like mangled Hebrew text). Root-caused two distinct bugs in
      `backend/routes/news.js`:
      1. `parseRSSItems()` never decoded HTML entities in `title`/
         `description` (only the separate full-article route did). Added a
         shared `decodeEntities()` helper (named + numeric `&#NNN;`/`&#xHH;`
         entities) applied to both headline parsing and full-article text.
      2. Both the headline-feed fetch and the per-article HTML fetch always
         decoded the response body as UTF-8 via `response.text()`, mangling
         any source actually served in a legacy charset (`windows-1255`/
         `ISO-8859-8`, still common on Israeli sites). Added
         `fetchDecodedText()`: reads the raw `ArrayBuffer`, detects the real
         charset from the `Content-Type` header (falling back to sniffing
         `<meta charset>`/`<?xml encoding?>` in the first 2KB), and decodes
         with the correct `TextDecoder` (confirmed Node's built-in
         `TextDecoder` supports `windows-1255`/`iso-8859-8` natively — no new
         dependency needed). Verified live: headlines now render clean Hebrew
         with real punctuation, no byte-soup.
- [x] **News section redesign** (the "Requested" item) — `NewsPage.jsx`
      reworked to the design-system rules deliberately: featured article is a
      full-width hero (340px, `rounded-3xl`, category-driven pastel gradient +
      legibility scrim, `active:scale-[0.98]` surface-tier press, `shadow-card
      → shadow-raised` on hover); the 2×2 card grid became a real headline
      list (`rounded-xl` rows with pastel category thumbnails, meta line,
      RTL chevron); the full-article overlay is an edge-anchored
      `rounded-t-3xl`/`shadow-modal` sheet with 56px close + footer controls.
      Category-badge raw hex folded into the existing pastel tokens
      (`var(--*-bg)`/`var(--*-d)`), `ConnectionBanner` mounts on feed errors,
      and the concurrently-developed unread-dot feature was preserved.
- [x] **Dark mode fixed systemically** — `tailwind.config.js` colors now
      resolve as `rgb(var(--x-rgb) / <alpha-value>)` with per-theme channel
      triplets in `global.css`, so all ~477 utility usages (incl. `/opacity`
      modifiers like `bg-tp/50`, verified in the built CSS) follow
      `data-theme="dark"`. Also added the missing `--amber` token (both
      themes) and converted the HomePage electricity tile's `#e0a630` to it.
- [x] **56px touch-target minimum on the remaining labelled controls** —
      ACControlPopup temp chips (`w-14 h-14`) + mode/fan buttons,
      ShoppingListPopup item rows + input, ClimateModeSelector pills,
      ChoresPage add-task button all ≥56px. Popup-clamp item verified a
      non-issue: both popups already measure real height via `popupRef` +
      `useLayoutEffect` (the 320/360 are just initial seeds).
- [x] **Shopping list: offline state + bulk actions + resize handling** —
      distinct "list unavailable, check HA" state with retry (no longer looks
      like an empty list), "סמן הכל"/"בטל סימון הכל"/"נקה שהושלמו" bulk
      actions (client-side `Promise.allSettled` loops over the existing todo
      endpoints, optimistic with rollback), and position now recomputes on
      window resize.
- [x] **"Install update" UI wired** — Settings shows an "התקן עדכון" button
      when `/check-update` reports an update; confirm dialog → spinner state
      (double-click guarded) → polls `/api/system/health` through the PM2
      restart → re-checks and toasts success/failure. Also fixed the check
      result reading a `latestVersion` field the backend never returns.
- [x] **TouchRipple/ConnectionBanner decision made: activate, not delete** —
      ripple works app-wide via `useRippleEffect` (delegated pointerdown →
      `.active` toggle; the separate `TouchRipple.jsx` wrapper was deleted as
      a duplicate of the `.ripple` CSS convention). `ConnectionBanner` now
      mounts in HomePage (HA degraded), CalendarPage (Google not connected),
      MusicPage (Spotify error) using the `connection.*` i18n strings.
- [x] **Screensaver weather row extended to slideshow mode** — same
      `ScreensaverWeather` component, small drop-shadowed overlay under the
      clock/date, reuses store weather (no new fetching).
- [x] **`useWifi.js` stale-closure on first scan** — fixed in cf7ebcc
      (was still listed as open here; reconciled).
- [x] **IMS weather (`https://ims.gov.il/he` via HA) showed no real week
      forecast — same root fix also adds an IMS week prediction matching
      Open-Meteo (both user-reported).** IMS *current conditions* were always
      real (verified live: 30.1°C, 71% humidity, etc. straight from HA entity
      `weather.ims_weather`) — the actual bug was `daily` always being `[]`.
      Root cause: Home Assistant 2024.6+ removed the `forecast` attribute from
      weather entity state entirely; forecasts must now be fetched via the
      `weather.get_forecasts` **service call** (`POST
      /api/services/weather/get_forecasts?return_response` with body
      `{entity_id, type: 'daily'}`), not read from `attrs.forecast` (which the
      old code did, and which HA now always leaves undefined). Verified the
      exact working request/response shape live against the real HA instance
      before implementing. Fixed in `backend/routes/weather.js`'s `/ims`
      route: added a second HA call for the forecast (non-fatal — current
      conditions still render if this call fails) and mapped the returned
      7-day `forecast` array into the same `daily` shape Open-Meteo returns
      (date, dayName, code, high/low, description, icon, precipitation),
      reusing the existing `imsConditionToWmo`/`wmoDescription`/`wmoIcon`
      helpers. Verified end-to-end against the live HA instance: `daily` now
      returns a real 7-day forecast (previously always `[]`). No frontend
      changes needed — `WeatherPopup`/screensaver already consume `daily`
      generically. Frontend build clean (unaffected).

- [x] **Settings "not saving" + weather city picker (user-reported).** Root
      cause: `LocationSection` had a free-text "עיר" field saving to
      `settings.location`, but the weather poll in `App.jsx` only ever reads
      `settings.latitude`/`longitude` — typing a city name did nothing to the
      weather shown, and there was no way to verify a typed city resolved to
      the right coordinates (no geocoding at all; lat/lon had to be
      hand-entered separately). Backend PUT/GET `/api/settings` itself was
      verified working via direct curl test, so "not saving" was this
      disconnect, not a persistence bug. Fixed:
      1. New `GET /api/weather/geocode?q=` route proxying Open-Meteo's free
         geocoding API (`geocoding-api.open-meteo.com/v1/search`,
         `language=he`, no API key, 24h in-memory cache) — verified live
         against real city names (Tel Aviv, Haifa).
      2. New `CitySearchBox` in `LocationSection`: debounced search-as-you-type
         with a results dropdown (city + region + country in Hebrew), and
         selecting a result saves `location`/`locationAdmin`/`locationCountry`
         + `latitude`/`longitude` together in one request. Added a persistent
         confirmation card below the search box showing the currently
         configured city, region/country, and exact coordinates, so the user
         can directly verify the picker resolved the correct place — this was
         the actual "doesn't show if I picked the correct city" complaint.
         Manual lat/lon inputs kept for advanced override, now labelled as
         auto-filled-by-picker.
      3. Fixed a secondary bug found along the way: every `SettingsPage.jsx`
         section calls `useSettings()` independently, each firing its own
         `GET /api/settings` on mount (8 redundant requests every time the
         Settings tab opened), and a section remounting mid-debounce (e.g. tab
         away-and-back within 800ms of an edit) could visually revert a field
         to stale data before the pending save landed. Fixed by skipping the
         mount-fetch in `useSettings.js` once `settings.loaded` is already
         true. End-to-end verified: geocode search → select → GET
         `/api/settings` reflects the matching name + lat/lon. Frontend build
         clean.

- [x] **Screensaver: Shabbat times on Friday + Saturday only** — a time row
      below the weather, hidden the rest of the week. Friday shows כניסת שבת
      (candle lighting), Saturday shows יציאת שבת (havdalah): an "entry" time
      is meaningless once Shabbat has already begun, so the label follows the
      day rather than being fixed. Reuses `useHebrewCalendar`, which checks a
      localStorage cache before fetching and is already kept warm by TopBar, so
      it adds no extra Hebcal request. Day comes from the clock's ticking Date
      so it flips correctly across midnight; renders nothing when that day's
      time isn't available. Day-index logic verified (Fri=5, Sat=6) and the
      Hebrew labels confirmed present in the built bundle.
- [x] **Duplicate `CREATE TABLE` removed from `tasks.js`** — table creation now
      lives solely in `db/migrations/002_chores.sql`, applied at boot before any
      route is reachable.
- [x] **TopBar weather button's hardcoded English `aria-label="Weather"`** now
      comes from `he.json` like every other string.
- [x] **`useMusic.js` playback controls silently swallowed errors.** Every
      control (`play`/`pause`/`next`/`prev`/`playTrack`/`setVolume`/
      `toggleShuffle`/`toggleRepeat`/`seekTo`) applied an optimistic UI update
      and then discarded the API failure with `catch { /* ignore */ }` — if
      Spotify was disconnected or the API call 502'd, every button silently
      looked like it worked while doing nothing. Added
      `addToast('error', t.music.playbackError)` on failure (new i18n key) plus
      state revert for the toggle-style controls (`play`/`pause`/`shuffle`/
      `repeat`) where reverting is unambiguous; `seekTo`/`setVolume` show the
      toast but don't revert since the 3s poll reconciles them naturally and a
      revert mid-drag would be worse UX. Audited `useAuth.js` too — its
      swallowed errors (`getGoogleAccounts`/`removeGoogleAccount`/
      `removeSpotifyAccount`) already return `false`/`[]` to callers, and
      `SettingsPage.jsx` already shows `accountRemoveFailed`/
      `spotifyDisconnectFailed` toasts on those paths, so no change needed
      there. Frontend build clean.

- [x] **Screensaver clock now shows current weather** — animated condition icon
      + temperature + Hebrew condition name below the Hebrew date. Reuses the
      existing animated `WeatherIcon` and the store App.jsx already polls, so
      no extra fetching; respects `temperatureUnit`; renders nothing until the
      first successful fetch rather than showing a placeholder dash. Also added
      Hebrew names for all 8 WMO conditions + a `getConditionLabel()` helper,
      which fixed a pre-existing i18n gap where `WeatherIcon`'s `aria-label`
      announced the raw English key ("partly-cloudy") in a Hebrew RTL app.
      Verified the Hebrew strings actually resolve in the built bundle.
- [x] **Design-system consolidation** — defined and applied six app-wide rules
      (press feedback: 2 tiers keyed to control-vs-surface; radius by element
      class; icon stroke `2` with documented exceptions; semantic elevation
      `--elev-card/-raised/-popover/-modal`; pastel tokens over raw hex;
      `.card` strengthened rather than dropped). Rules 1/2/3/5 documented in
      `global.css` so they don't get re-invented. Notably `.card` had to be
      *kept* because it sets `background: var(--surf)` (theme-aware) whereas
      Tailwind's `bg-surf` compiles to literal white — dropping it would have
      broken dark mode on every device tile. Also fixed two silent no-ops found
      en route: an inline `boxShadow` on `FeaturedCard` that defeated its own
      `hover:shadow-xl`, and a reference to a non-existent `--radius-2xl` token.
- [x] **Broken `dark:` variants removed** — found two newly-added
      `dark:bg-[#...]` utilities in ChoresPage and proved from the built CSS
      that they compile to `@media (prefers-color-scheme: dark)`, i.e. they
      follow the *OS* setting and ignore the app's own `data-theme` toggle
      (dark mode on a light-mode OS left the completed-task card light mint on
      a dark surface). `dark:` appeared nowhere else in the tree. Replaced with
      the real `--mint-bg`/`--coral-bg` tokens, defined for both themes. Also
      fixed `bg-[var(--coral-bg)]/30`, which emitted no CSS rule at all.
- [x] **a11y + touch targets** — Hebrew `aria-label`s (all via `he.json`, zero
      hardcoded literals) and ≥56×56px hit areas on every icon-only control
      flagged by the audit, with visual icon sizes untouched. Plus the invalid
      nested-interactive fix in ChoresPage: the card is now two *sibling*
      buttons instead of a `<div role="button" tabIndex={-1}>` nested inside a
      `<button>`, so delete is finally reachable by keyboard/switch access; the
      decorative checkbox became `aria-hidden` with state moved onto the button
      via `aria-pressed`. Verified by hand.
- [x] **Shopping list: delete items + real-time HA sync** — new
      `POST /api/ha/todo/:entity_id/remove` (HA `todo.remove_item`), a per-item
      delete button, and a Socket.io subscription so the list reflects changes
      made elsewhere in Home Assistant.
- [x] **Backend infra** — `/api/system/update` pulled code but never restarted
      (updates silently didn't take effect) and only installed *frontend* deps;
      `ws` was only resolving transitively via socket.io while the HA relay
      fails *silently* without it (newly load-bearing now the relay is wired
      up); `backend/db/schema.sql` was dead code duplicating `001_initial.sql`
      and already drifted — deleted, migrations are the source of truth.
- [x] **Crash safety** — `process.on('unhandledRejection'/'uncaughtException')`
      in `server.js` (uncaught still `exit(1)` so PM2 restarts cleanly), plus
      guards on every unprotected sync SQLite cache read at the top of an
      `async` Express handler (`calendar.js` events + ics, `news.js`,
      `weather.js` current + ims, and `system.js`'s un-awaited `db.backup()`).
      Express 4 doesn't catch async handler rejections and Node ≥15 treats them
      as fatal, so any one could kill the kiosk backend. The agent on this
      batch died mid-way; I finished the four it never reached.
- [x] **`POST /api/system/restart` + `/reboot`** implemented — two Settings
      buttons were calling routes that didn't exist and 404ing silently.
      Verified `PM2_APP_NAME` matches `ecosystem.config.js` (a wrong name would
      have failed silently).
- [x] **Chores mock-family DB leak** — `getConfiguredPeople()` no longer falls
      back to mock names on the production sync path (now an opt-in
      `allowMockFallback`, dev-only), so a fresh Pi no longer permanently
      persists placeholder family members into real SQLite.
- [x] **Calendar week-navigation race** — `AbortController` + monotonic
      request-id guard so a stale older week's response can't overwrite the
      grid. Traced the early-return paths to confirm the newest request can
      never bail, so `setLoading(false)` is always reached (no stuck spinner).
- [x] **Home Assistant reliability** — wired `setupHAWebSocketRelay()` into
      `server.js` (fully built but never called, so the documented
      `ha:state_changed` event never fired and the Home tab only updated on a
      60s poll); fixed a stale-closure bug where a transient poll failure after
      real data had loaded would revert live tiles to `MOCK_ENTITIES`; added
      revert-on-failure to 6 device-control setters that had none.
- [x] **Music tab was permanently stuck loading** — `activeTab === 3` should be
      `4` (Music is index 4; 3 is Home). `useMusic()` never received
      `active=true`, so polling never ran. This also meant queue tap-to-play
      never activated in production until this fix.
- [x] **`token_secret` exposed via the Settings API** — the key deriving the
      AES-256-GCM cipher for every stored Google/Spotify OAuth token was
      readable via `GET /api/settings` and overwritable via `PUT` (only
      `api_token` was blocked). Overwriting it would have broken decryption of
      every stored token.
- [x] **Spotify disconnect 404** — frontend called
      `DELETE /api/auth/spotify/disconnect`; the route is `DELETE /api/auth/spotify`.
- [x] **Music queue tap-to-play** — `POST /api/music/play-track` + `playTrack()`
      with optimistic update reconciled ~700ms later. Spotify has no "jump to
      queue item" endpoint (confirmed via web search), so it replaces playback
      with that track's URI via `PUT /me/player/play`. Known limitation,
      inherent to the Spotify API: the rest of the old queue isn't preserved as
      "up next".
- [x] **Codebase audit** — 3 sub-agents + hand verification; 8 bugs, 3 gaps,
      4 minor items, all triaged into this file.
- [x] **First design polish pass** — TopBar icon-size parity, an invented
      `rounded-[20px]` unified to the real scale, ChoresPage magic-number
      durations moved onto the `--dur-*` tokens.
- [x] **PLAN.md accuracy** — two overstated `[x]` claims corrected to `[~]`:
      the git-based auto-update (backend-only, no UI caller) and "fix all items
      in Known Issues table" (#7 month view still open).

_(Prior session, see git log: chores SQLite backend, weather location fix,
popup clamping, person-presence fix, calendar empty state, sync-to-pi script.)_
