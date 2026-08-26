# TASKS

Working task list for ongoing development. Checked items are done and verified
(build passes). New items found by Claude or subagents get appended under
"Found along the way" with a source note.

## In progress

- [ ] a11y + touch-target batch: Hebrew `aria-label`s via he.json + >=56px
      tap areas on icon-only controls, plus the invalid nested-button
      restructure in ChoresPage
- [ ] Design-system consolidation: define + apply app-wide rules for
      press-feedback scale, radius scale, icon stroke weight, shadow
      elevation; swap ChoresPage raw hex to real pastel tokens; resolve
      the vestigial `.card` utility
- [ ] Wire the "install update" path in the UI — backend is now ready
      (see Done); Settings currently reports "update available" with no
      way to apply it. Deferred to avoid edit conflicts with the two
      agents currently in SettingsPage-adjacent files.

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
- [ ] `TouchRipple.jsx` and `ConnectionBanner.jsx` are fully built, working
      components with zero imports anywhere — wire them in or remove them.
      NOTE: PLAN.md marks both as complete ([x] "Touch feedback system (tap
      ripple, press states)" and "Connection status banners"), so these are
      documented-as-done features that aren't actually active. Worth
      deciding deliberately, not just deleting.
- [ ] Duplicate/drifting inline `CREATE TABLE` in `backend/routes/tasks.js:220-243`
      re-implements migration `002_chores.sql` — collapse to one source of truth
- [ ] `useWifi.js` has a stale-closure bug on first scan (self-corrects after
      one manual re-scan) — low impact, lower priority
- [ ] Several `useMusic.js`/`useAuth.js` playback controls silently swallow
      errors with no user-facing feedback (toast) on failure

_(source: this session, found while verifying the audit findings)_

- [ ] `"Restart App"` restarts only `mirror-backend`, not the `mirror-frontend`
      PM2 process. Deliberate for now (the kiosk browser doesn't reload either
      way, and bouncing the static server risks a visible error) — but revisit
      if the label proves misleading in practice
- [ ] PLAN.md Phase 5 marks "Auto-update mechanism (git-based)" as [x], but it
      was only reachable via a route with no caller. Backend is fixed now;
      re-check the PLAN claim once the UI path is wired

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

- [x] Backend infra batch — three real gaps found while verifying the audit:
      `/api/system/update` pulled code but never restarted (so updates
      silently didn't take effect) and only installed *frontend* deps, so a
      commit adding a backend dep would never install it; `ws` was only
      resolving transitively via socket.io while the HA relay fails
      *silently* without it (newly load-bearing now that the relay is
      actually wired up); and `backend/db/schema.sql` was dead code, a
      verbatim duplicate of `001_initial.sql`'s table set, and had already
      drifted (missing `chore_people`/`chore_tasks`) — deleted, migrations
      are the single source of truth. Syntax + module-load verified.
- [x] Crash-safety completion — the agent on that batch hit its session
      limit mid-file, so I finished the four cache reads it never reached
      (`news.js` GET /, `weather.js` GET / and GET /ims, `calendar.js`
      GET /ics). Each was a sync SQLite read at the top of an `async`
      handler, where a throw becomes an unhandled rejection that Node >=15
      treats as fatal. Confirmed the already-safe cases
      (`backgroundRefresh`, ICS revalidation) were correctly left alone.
- [x] Verified the dead agents' committed work by hand (2817dc8) — the
      `allowMockFallback` opt-in correctly keeps placeholder family names
      off the production sync path, and the Calendar `AbortController` +
      request-id guard genuinely gates `setEvents`. Traced the early-return
      paths to confirm the newest request can never bail, so
      `setLoading(false)` is always reached (no stuck spinner). Also
      verified `PM2_APP_NAME` matches `ecosystem.config.js` — a wrong name
      would have made the new Restart button fail silently.
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
