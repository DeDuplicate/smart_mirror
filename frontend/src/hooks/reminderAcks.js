// Persistence for reminder acknowledgements and snoozes.
//
// Why this exists: the hook's in-memory "already fired" set is rebuilt from
// empty on every page load, and the kiosk relaunches Chromium via a watchdog
// loop (scripts/start-kiosk.sh). Without persisting, acknowledging an alarm at
// 17:16 for a 17:30 event would alarm again after any reload inside the lead
// window — exactly the "I already approved it" complaint.
//
// localStorage (not the backend) because this is per-display state, matching
// how the app already stores music volume and family photos. Every access is
// wrapped: private windows and cleared site data make it throw or return null.

const STORAGE_KEY = 'smartMirror.reminders.v1';
const KEEP_MS = 24 * 60 * 60 * 1000; // reminders only look at today

const EMPTY = { acked: {}, snoozed: {} };

function read() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { ...EMPTY };
    const parsed = JSON.parse(raw);
    return {
      acked: parsed?.acked && typeof parsed.acked === 'object' ? parsed.acked : {},
      snoozed: parsed?.snoozed && typeof parsed.snoozed === 'object' ? parsed.snoozed : {},
    };
  } catch {
    return { ...EMPTY }; // unavailable or corrupt — behave like a fresh display
  }
}

function write(state) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    // Storage full or blocked. In-memory dedupe still covers this session.
  }
}

/** Drop entries for events that are well in the past. */
function prune(state, now = Date.now()) {
  const keep = (iso) => {
    const t = new Date(iso).getTime();
    return Number.isNaN(t) ? false : now - t < KEEP_MS;
  };
  const acked = {};
  for (const [k, startIso] of Object.entries(state.acked)) {
    if (keep(startIso)) acked[k] = startIso;
  }
  const snoozed = {};
  for (const [k, entry] of Object.entries(state.snoozed)) {
    if (entry && keep(entry.reminder?.start ?? '')) snoozed[k] = entry;
  }
  return { acked, snoozed };
}

/**
 * Keys the scheduler must treat as already handled: acknowledged ones, plus
 * snoozed ones (a snooze is re-fired by its own timer, so the normal
 * lead-window path must not also fire it after a reload).
 */
export function handledKeys(now = Date.now()) {
  const state = prune(read(), now);
  write(state);
  return new Set([...Object.keys(state.acked), ...Object.keys(state.snoozed)]);
}

/** Record an approval so it survives reloads. */
export function markAcked(key, startIso) {
  const state = prune(read());
  state.acked[key] = startIso;
  delete state.snoozed[key]; // approving ends any pending snooze
  write(state);
}

/**
 * Snooze like an alarm clock: go quiet now, ring again in `minutes`.
 * Deliberately independent of the lead window — snoozing at 17:28 for a 17:30
 * event must still ring at 17:33, after the event has started.
 */
export function snoozeReminder(key, reminder, minutes, now = Date.now()) {
  const state = prune(read(), now);
  state.snoozed[key] = { dueAt: now + minutes * 60000, reminder };
  write(state);
}

/** Snoozes whose time has come, as reminder payloads. Clears them. */
export function takeDueSnoozes(now = Date.now()) {
  const state = prune(read(), now);
  const due = [];
  for (const [k, entry] of Object.entries(state.snoozed)) {
    if (entry && typeof entry.dueAt === 'number' && entry.dueAt <= now) {
      due.push(entry.reminder);
      delete state.snoozed[k];
    }
  }
  if (due.length) write(state);
  return due;
}

/** Test seam / factory reset. */
export function clearReminderState() {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    // nothing to do
  }
}
