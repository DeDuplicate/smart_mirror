import { useEffect, useMemo, useRef } from 'react';
import useStore from '../store/index.js';
import useCalendar, { toLocalDateKey } from './useCalendar.js';
import { dueReminders, reminderKey, DEFAULT_LEAD_MIN } from './reminderSchedule.js';
import { handledKeys, takeDueSnoozes } from './reminderAcks.js';
import { unlockAudioOnGesture } from './reminderTones.js';

// ─── Reminder scheduling ────────────────────────────────────────────────────

const CHECK_INTERVAL_MS = 20 * 1000;
export { DEFAULT_LEAD_MIN };

/**
 * Fires an audible reminder ahead of timed calendar events.
 *
 * Lives in App (not CalendarPage) so it works on whichever tab is showing.
 */
export default function useEventReminders() {
  const enabled = useStore((s) => s.settings.eventRemindersEnabled) !== false;
  const leadMin = useStore((s) => s.settings.eventReminderLeadMin) ?? DEFAULT_LEAD_MIN;
  const pushReminder = useStore((s) => s.pushReminder);

  // Today only. Keyed on the local date string so the Date objects stay
  // referentially stable (useCalendar re-fetches on range identity) but still
  // roll over at midnight.
  const dayKey = toLocalDateKey(new Date());
  const [rangeStart, rangeEnd] = useMemo(() => {
    const s = new Date(`${dayKey}T00:00:00`);
    const e = new Date(`${dayKey}T23:59:59`);
    return [s, e];
  }, [dayKey]);

  const { events } = useCalendar(rangeStart, rangeEnd);

  // Seeded from localStorage so an approval (or a pending snooze) survives a
  // reload - the kiosk's chromium watchdog restarts the browser.
  const firedRef = useRef(null);
  if (firedRef.current === null) firedRef.current = handledKeys();
  const eventsRef = useRef(events);
  eventsRef.current = events;

  useEffect(() => unlockAudioOnGesture(), []);

  useEffect(() => {
    if (!enabled) return;

    const check = () => {
      // 1. Snoozes that have come due ring again regardless of the lead
      //    window - snoozing at 17:28 for a 17:30 event must still ring.
      for (const reminder of takeDueSnoozes()) {
        firedRef.current.add(reminder.id);
        pushReminder(reminder);
      }

      // 2. Events entering the lead window for the first time.
      const due = dueReminders(eventsRef.current, leadMin, Date.now(), firedRef.current);
      for (const { event } of due) {
        const key = reminderKey(event);
        firedRef.current.add(key);
        // The overlay owns ringing/repeat/ducking; this just enqueues.
        pushReminder({
          id: key,
          title: event.title,
          start: event.start,
          location: event.location || '',
        });
      }
    };

    check(); // don't wait a full interval after mount/settings change
    const id = setInterval(check, CHECK_INTERVAL_MS);
    return () => clearInterval(id);
  }, [enabled, leadMin, pushReminder]);
}
