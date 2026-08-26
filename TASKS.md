# TASKS

Working task list for ongoing development. Checked items are done and verified
(build passes). New items found by Claude or subagents get appended with a
source note.

> Note: this file was repeatedly overwritten by concurrent subagents working
> from stale copies (dropping entries, resurrecting already-fixed items). This
> is an authoritative rewrite reconciled against `git log`.

## Requested

- [ ] **Redesign the News section** using the Apple-design/`frontend-design`
      skill. Now that the design-system rules exist (press-feedback tiers,
      radius-by-element-class, semantic elevation — documented at the top of
      `frontend/src/styles/global.css`), News should be reworked to follow them
      deliberately rather than merely comply. Scope: `NewsPage.jsx` featured
      card + headline list + full-article overlay. Fold in the pre-existing raw
      hex on the category badge → tokens.

## In progress

_(none)_

## Backlog — correctness / real bugs

- [ ] **Dark mode is substantially broken (systemic).** `tailwind.config.js`
      defines theme colors as literal hex, so `bg-surf` compiles to
      `rgb(255 255 255)` and `text-tp` to `rgb(26 28 46)` — neither responds to
      the `data-theme="dark"` attribute this app themes with. 477 such utility
      usages across 21 files vs only 74 theme-aware `[var(--x)]` ones, while
      `body` itself *is* theme-aware (`background-color: var(--bg)`) — so in
      dark mode the page goes dark but most surfaces/text stay light. Verified:
      no `darkMode` key in the config, no utility-override shim in `global.css`.
      Good news: no *unreadable* combos exist today (checked — no theme-aware
      background meets a literal text color).
      The tempting one-line fix (`surf: 'var(--surf)'`) is NOT safe: ~9 call
      sites use opacity modifiers on these tokens (`bg-tp/50`, `bg-tp/20`,
      `border-bd/50`, `border-bd/40`, `bg-s2/60`, `text-tm/40`, `bg-tp/40`) and
      Tailwind cannot apply `/opacity` to a plain `var()` color — it silently
      emits no rule (same failure mode as the `bg-[var(--coral-bg)]/30` bug
      already fixed). Doing it properly means the `<alpha-value>` approach:
      store the vars as RGB channels, define colors as
      `rgb(var(--surf-rgb) / <alpha-value>)`. Needs its own pass.
- [ ] **Locked 56px touch-target minimum still violated by *labelled*
      controls.** The a11y pass correctly scoped itself to icon-only controls;
      these remain under the CLAUDE.md-locked minimum: `ACControlPopup` temp
      chips (`w-11 h-11` = 44px) and mode/fan-speed buttons (`py-2.5` ≈ 40px);
      `ShoppingListPopup` item toggle rows (≈40px) and text input (≈38px);
      `HomePage` `ClimateModeSelector` (`px-3 py-1.5` ≈ 28px, ~line 590);
      `ChoresPage` add-task button (`min-h-[48px]`).
- [ ] **Popup clamp uses a stale hardcoded height.** `HomePage.jsx`
      `popupH = 320` (~line 618) and `CurtainPopup` `popupH = 360` (~line 964)
      estimate popup height to clamp position, but the close buttons grew 28px
      in the a11y pass — so a popup opened near the bottom edge can overflow by
      ~28px. Fix by measuring the real height (a `popupRef` already exists)
      rather than bumping the magic number.
- [ ] `ShoppingListPopup` positioning math recomputes only on render, not on
      window resize — needs verification on the real 1920x1080 kiosk frame.
- [ ] `useWifi.js` stale-closure bug on first scan (self-corrects after one
      manual re-scan) — low impact.
      _(Both the duplicate `CREATE TABLE` in `tasks.js` and TopBar's hardcoded
      English `aria-label="Weather"` were on this list and are now fixed —
      see Done.)_

## Backlog — features / gaps

- [ ] Wire the "install update" UI path. Backend is ready (`POST
      /api/system/update` now installs backend+frontend deps, rebuilds, and
      restarts via PM2), but Settings only calls `/check-update` — it reports
      "update available" with no way to apply it.
- [ ] Shopping list: no offline/dev-mode fallback when HA is unreachable — the
      popup silently shows "empty" instead of a clear offline state. Also no
      "clear completed" / "check all" bulk actions.
- [ ] Calendar month view (PLAN.md Known Issues #7 — genuine future
      enhancement, larger scope).
- [ ] Task column names (`taskCol1/2/3`) and `taskCleanupInterval` in Settings
      have no effect — `TasksPage.jsx`'s `COLUMNS` is a hardcoded constant that
      never reads them. Needs a design decision (what should cleanup-interval
      even do?), not a quick fix.
- [ ] `TouchRipple.jsx` and `ConnectionBanner.jsx` are fully built and working
      but imported nowhere. PLAN.md marks both complete ([x] "Touch feedback
      system (tap ripple, press states)" and "Connection status banners"), so
      these are documented-as-done features that aren't actually active —
      decide deliberately, don't just delete.
- [ ] Consider extending the new screensaver weather row to slideshow mode too
      (currently clock mode only, which is what was asked for).

## Backlog — design follow-ups

_(source: design-system consolidation agent — deliberately left out of scope)_

- [ ] `HomePage` electricity-tile hex: `#2ab58a`/`#c95454` have tokens but the
      amber `#e0a630` does not — converting two of three would be *less*
      consistent, so this needs a new token first.
- [ ] `NewsPage` category-badge raw hex → tokens (folded into the News redesign
      above).

## Done

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
