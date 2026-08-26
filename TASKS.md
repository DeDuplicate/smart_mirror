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

- [ ] Calendar month view (PLAN.md Known Issues #7 — genuine future
      enhancement, larger scope).
- [ ] Task column names (`taskCol1/2/3`) and `taskCleanupInterval` in Settings
      have no effect — `TasksPage.jsx`'s `COLUMNS` is a hardcoded constant that
      never reads them. Needs a design decision (what should cleanup-interval
      even do?), not a quick fix.
- [ ] TopBar/WeatherPopup never display the configured city name — only the
      Settings page confirmation card (added in the city-picker fix) shows it.
      Consider surfacing it in the weather popup too so it's visible outside
      Settings.

## Backlog — design follow-ups

_(none)_

## Done

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
