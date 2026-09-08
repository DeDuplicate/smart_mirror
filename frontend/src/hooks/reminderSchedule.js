// Pure reminder-scheduling logic, kept free of React/i18n imports so it can be
// exercised directly by node (see reminderSchedule.test.mjs).

export const DEFAULT_LEAD_MIN = 10;
export const DEFAULT_SNOOZE_MIN = 5;

/**
 * Stable identity for one OCCURRENCE of an event.
 *
 * The event id alone is not enough: the ICS parser numbers recurring
 * occurrences by their index within the fetched range, so a weekly class is
 * `<uid>_0` every single week (verified against the live feed - the same series
 * seven days apart returns an identical id and only `start` differs). Keying
 * acknowledgements on the id alone would therefore silence every future
 * occurrence the first time one was dismissed.
 */
export function reminderKey(ev) {
  return `${ev.id}@${ev.start}`;
}

/** Minutes until `start`, or null if it isn't a usable timestamp. */
export function minutesUntil(start, now) {
  const at = new Date(start);
  if (Number.isNaN(at.getTime())) return null;
  return (at.getTime() - now) / 60000;
}

/** True for events with no meaningful time-of-day. */
export function isAllDay(ev) {
  return !!ev.allDay || /^\d{4}-\d{2}-\d{2}$/.test(String(ev.start || ''));
}

/**
 * Events that should fire a reminder right now: timed (not all-day), starting
 * within the lead window, and still in the future.
 *
 * Requiring `mins > 0` is what stops old events re-alarming. A kiosk reload
 * (chromium watchdog relaunch) rebuilds the `fired` set from empty; without
 * this guard every event earlier in the day would beep at once on restart.
 */
export function dueReminders(events, leadMin, now, fired = new Set()) {
  const out = [];
  for (const ev of events || []) {
    if (!ev || isAllDay(ev)) continue;
    if (fired.has(reminderKey(ev))) continue;
    const mins = minutesUntil(ev.start, now);
    if (mins === null) continue;
    if (mins > 0 && mins <= leadMin) out.push({ event: ev, minutes: Math.round(mins) });
  }
  return out;
}
