# TASKS

Working task list for ongoing development. Checked items are done and verified
(build passes). New items found by Claude or subagents get appended under
"Found along the way" with a source note.

## In progress

- [ ] Icon-only button a11y labels (split off — see Backlog item below;
      the other two items in this batch are now done)

## Backlog

_(source: codebase-audit agent, independently verified by hand where noted)_

- [ ] Calendar: month view (PLAN.md Known Issues #7 — future enhancement, larger scope)
- [ ] PLAN.md Known Issues table needs re-check — #7 (month view) still open;
      #5 is now actually fixed in code (this session) so the table should say so
- [ ] Task column names (`taskCol1/2/3`) & cleanup-interval settings in
      SettingsPage have no effect — `TasksPage.jsx`'s `COLUMNS` is a hardcoded
      constant that never reads them; whole Settings section is disconnected UI.
      Needs a real design decision (what should cleanup-interval even do?), not
      a quick fix
- [ ] Icon-only controls under the 56px touch-target minimum with no
      `aria-label` — `ACControlPopup.jsx:200-206`, `IRRemoteOverlay.jsx:31-36,
      66-76,101-107`, `ShoppingListPopup.jsx:224-230,291-299`,
      `HomePage.jsx:776-782,993-996`, `ChoresPage.jsx:593-606`
- [ ] Invalid nested interactive control in `ChoresPage.jsx:275,330-339` — a
      `<div role="button">` delete control nested inside the card's outer
      `<button>`; invalid HTML, delete action unreachable via keyboard/switch
- [ ] `backend/db/schema.sql` is dead (never read; only `migrate.js` +
      `migrations/*.sql` run at boot) and out of sync — missing
      `chore_people`/`chore_tasks`. Either delete it or regenerate from migrations
- [ ] `TouchRipple.jsx` and `ConnectionBanner.jsx` are fully built, working
      components with zero imports anywhere — wire them in or remove them
- [ ] Duplicate/drifting inline `CREATE TABLE` in `backend/routes/tasks.js:220-243`
      re-implements migration `002_chores.sql` — collapse to one source of truth
- [ ] `useWifi.js` has a stale-closure bug on first scan (self-corrects after
      one manual re-scan) — low impact, lower priority
- [ ] Several `useMusic.js`/`useAuth.js` playback controls silently swallow
      errors with no user-facing feedback (toast) on failure
- [ ] `ws` package is used directly in `homeassistant.js` without being a
      declared dependency — works only transitively via socket.io; should be
      an explicit `package.json` dependency

## Found along the way

_(source: design-polish agent, Apple HIG-inspired pass — not implemented, need a deliberate rule rather than a blind find/replace)_

- [ ] Icon stroke-weight is inconsistent across "families": HomePage device icons
      use `strokeWidth="1.8"`, TopBar/TabBar/Chores use `2`, Chores' Plus/Check
      use `2.5` — pick one weight per icon class
- [ ] Border-radius scale is mixed (`rounded-lg`/`xl`/`2xl`/`3xl`) for
      conceptually similar small elements (segmented buttons, pills, chips)
      with no documented "which radius for which element" rule
- [ ] Shared `.card` utility in `global.css` (16px radius, 1px border, 16px
      padding) is nearly vestigial — most consumers override most of its
      properties with custom Tailwind classes; either make it the real
      single source of truth or drop it from call sites that override
      everything anyway
- [ ] `ChoresPage.jsx` completed/overdue task-card backgrounds use raw hex
      (`bg-[#edfaf6]`, `bg-[#fff0f0]`) that are near-duplicates of, but don't
      match, the real `--mint-bg`/`--coral-bg` pastel tokens — swap to the tokens
- [ ] Press-feedback scale varies without a rule (`active:scale-95`,
      `active:scale-[0.97]`, `active:scale-[0.98]` all used for equivalent
      "tap" feedback) — pick one value app-wide
- [ ] Shadow elevation (`shadow-sm/md/lg/xl/2xl`) isn't tied to a defined
      elevation scale (resting/hover/popover/modal) — currently ad hoc per
      component

## Done

- [x] Backend crash safety net — `process.on('unhandledRejection'/'uncaughtException')`
      in `server.js` so one bad async route handler can't take down the kiosk;
      uncaught exceptions still exit(1) so PM2 restarts cleanly. Implemented
      `POST /api/system/restart` (`pm2 restart mirror-backend`) and
      `POST /api/system/reboot` (`sudo reboot`, no-ops off-Linux). Also fixed
      `backend/routes/system.js` `/backup` missing an `await` on the (Promise-
      returning) `db.backup()` call — a failed backup rejected with nothing to
      catch it. Build clean.
- [x] Chores mock-family leak into prod DB — `useChores.js`
      `getConfiguredPeople()` no longer silently falls back to mock names on
      the production sync path; mock fallback is now opt-in
      (`allowMockFallback`) and used only for the dev-mode MOCK_PEOPLE seed.
      A fresh Pi with no Settings → Family configured yet now fetches the
      backend's existing people as-is instead of permanently persisting
      placeholder names into SQLite.
- [x] Calendar race condition — `useCalendar.js` `fetchEvents()` now uses an
      `AbortController` + monotonic request-id guard so rapid next/prev week
      taps can't let a stale older response overwrite the grid after a newer
      one has already landed. Also added `backend/routes/calendar.js`
      try/catch around the cache/account lookup so a DB read error returns a
      500 instead of throwing unhandled.
- [x] Home Assistant reliability batch — wired `setupHAWebSocketRelay()` into
      `server.js` (was fully built but never called; `ha:state_changed` now
      actually fires), fixed a stale-closure bug where a transient poll
      failure after real data loaded would wrongly revert live entity tiles
      to `MOCK_ENTITIES`, and added revert-on-failure to 6 device-control
      setters that had no error handling. Verified by hand, build clean.
- [x] Codebase audit — 3 sub-agents + hand verification, found 8 bugs, 3 gaps,
      4 minor items. Fixed immediately (verified + committed, separately from
      this audit item):
      - Music tab permanently stuck loading (`activeTab === 3` should be `4`
        — this also means the queue tap-to-play shipped earlier never
        actually activated in prod until this fix)
      - AES encryption key (`token_secret`) readable + writable via the
        Settings API — only `api_token` was blocked
      - "Disconnect Spotify" button called a route that doesn't exist
      Remaining findings moved to "In progress" (3 batches now running) and
      "Backlog" (lower-priority / needs a design decision) below.
- [x] Design polish pass — icon-size parity (TopBar Settings gear was
      `w-5 h-5` next to five `w-6 h-6` siblings), unified an invented
      `rounded-[20px]` on HomePage/NewsPage tiles to the app's real
      `rounded-2xl` scale, and moved ChoresPage's magic-number transition
      durations onto the `--dur-fast/normal/slow` tokens every other page
      already uses. Build clean. 6 more opportunities found but left as
      backlog (below) — each needs a deliberate app-wide rule, not a
      blind find/replace.
- [x] Music: wire up "tap queue item to play" — `backend/routes/music.js`
      `POST /play-track` + `useMusic.js` `playTrack()` (optimistic update,
      reconciled ~700ms later) + `MusicPage.jsx` wiring. Spotify has no
      "jump to queue item" API, so it replaces playback with that track's
      URI via `PUT /me/player/play` (confirmed via web search — this is the
      standard approach every third-party Spotify client uses). Build
      clean. PLAN.md Known Issues #5 marked ✅. Known limitation: the rest
      of the old queue isn't preserved as "up next" after the tapped track
      — inherent to the Spotify Web API, not a shortcut taken here.

_(see git log for prior session's completed work: chores SQLite backend,
weather location fix, popup clamping, person-presence fix, calendar empty
state, sync-to-pi script)_
