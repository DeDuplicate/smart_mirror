import { useState, useEffect, useCallback, useRef } from 'react';

// ─── Color Palettes ─────────────────────────────────────────────────────────

export const CALENDAR_COLORS = {
  mint:  { bg: 'var(--mint-bg)', border: 'var(--mint-d)', text: 'var(--mint-d)', dot: '#2a9d7f' },
  lav:   { bg: 'var(--lav-bg)',  border: 'var(--lav-d)',  text: 'var(--lav-d)',  dot: '#5b52cc' },
  coral: { bg: 'var(--coral-bg)', border: 'var(--coral-d)', text: 'var(--coral-d)', dot: '#c95454' },
  gold:  { bg: 'var(--gold-bg)',  border: 'var(--gold-d)',  text: 'var(--gold-d)',  dot: '#b07c10' },
};

// ─── Helpers ────────────────────────────────────────────────────────────────

/** Get the Sunday that starts the week containing `date`. */
export function getWeekStart(date) {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() - d.getDay()); // Sunday
  return d;
}

/** Get Saturday (end of week) from a week start. */
export function getWeekEnd(weekStart) {
  const d = new Date(weekStart);
  d.setDate(d.getDate() + 6);
  d.setHours(23, 59, 59, 999);
  return d;
}

/**
 * Get the fetch range for a month grid: the Sunday starting the week that
 * contains the 1st of the month, through the Saturday ending the week that
 * contains the last day — so adjacent-month spillover days are covered.
 */
export function getMonthGridRange(monthDate) {
  const first = new Date(monthDate.getFullYear(), monthDate.getMonth(), 1);
  const last = new Date(monthDate.getFullYear(), monthDate.getMonth() + 1, 0);
  const start = getWeekStart(first);
  const end = getWeekEnd(getWeekStart(last));
  return { start, end };
}

/** Group events by calendar day (YYYY-MM-DD key) for month-view rendering.
 *  All-day events are added to every day they span (inclusive, matching the
 *  week view's all-day row semantics); timed events go to their start day.
 *  Each day's list is sorted: all-day first, then by start time. */
export function groupEventsByDay(events) {
  const map = new Map();
  const push = (date, ev) => {
    const key = toLocalDateKey(date);
    if (!map.has(key)) map.set(key, []);
    map.get(key).push(ev);
  };

  for (const ev of events) {
    if (ev.allDay) {
      const s = new Date(ev.start + 'T00:00:00');
      const e = new Date(ev.end + 'T00:00:00');
      if (e < s) {
        push(s, ev);
        continue;
      }
      for (const d = new Date(s); d <= e; d.setDate(d.getDate() + 1)) {
        push(d, ev);
      }
    } else {
      push(new Date(ev.start), ev);
    }
  }

  for (const list of map.values()) {
    list.sort((a, b) => {
      if (!!a.allDay !== !!b.allDay) return a.allDay ? -1 : 1;
      const at = a.allDay ? new Date(a.start + 'T00:00:00') : new Date(a.start);
      const bt = b.allDay ? new Date(b.start + 'T00:00:00') : new Date(b.start);
      return at - bt;
    });
  }

  return map;
}

/** Format date as YYYY-MM-DD for API queries. */
function toISODate(date) {
  return date.toISOString().split('T')[0];
}

/** Local-timezone YYYY-MM-DD key (toISODate shifts via UTC — wrong for
 *  day-grouping keys around midnight in UTC+ timezones). */
export function toLocalDateKey(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

// ─── Hook ───────────────────────────────────────────────────────────────────

const REFRESH_INTERVAL = 5 * 60 * 1000; // 5 minutes

export default function useCalendar(rangeStart, rangeEnd) {
  const [events, setEvents] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const intervalRef = useRef(null);

  // Tracks the in-flight request so a newer fetch (e.g. rapid next/prev week
  // taps) can cancel a stale older one instead of letting it race to
  // `setEvents` after the newer response has already landed.
  const abortControllerRef = useRef(null);
  // Belt-and-suspenders staleness guard: even if an old request's abort
  // doesn't reject the fetch in time (e.g. it had already resolved before
  // the newer request started), this ensures we never apply a response
  // that isn't from the most recently issued fetch.
  const requestIdRef = useRef(0);

  const fetchEvents = useCallback(async () => {
    if (!rangeStart || !rangeEnd) return;

    // Cancel any previous in-flight fetch — its result is now stale.
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }
    const controller = new AbortController();
    abortControllerRef.current = controller;
    const requestId = ++requestIdRef.current;

    const start = toISODate(rangeStart);
    const end = toISODate(rangeEnd);

    let googleEvents = [];
    let icsEvents = [];
    let gotGoogle = false;
    let gotIcs = false;

    // Try Google OAuth calendar first
    try {
      const res = await fetch(`/api/calendar/events?start=${start}&end=${end}`, {
        signal: controller.signal,
      });
      if (res.ok) {
        const data = await res.json();
        if (data?.events && data.events.length > 0) {
          googleEvents = data.events.map((ev) => ({
            ...ev,
            title: ev.title || ev.summary || '(No title)',
            source: 'google',
          }));
          gotGoogle = true;
        }
      }
    } catch (err) {
      if (err?.name === 'AbortError') return; // superseded — bail before touching state
      // Google OAuth not available — continue
    }

    // Try ICS calendars (always, to merge with Google if available)
    try {
      const res = await fetch(`/api/calendar/ics?start=${start}&end=${end}`, {
        signal: controller.signal,
      });
      if (res.ok) {
        const data = await res.json();
        if (data?.events && data.events.length > 0) {
          icsEvents = data.events.map((ev) => ({
            ...ev,
            title: ev.title || ev.summary || '(No title)',
            source: ev.source || 'ics',
          }));
          gotIcs = true;
        }
      }
    } catch (err) {
      if (err?.name === 'AbortError') return; // superseded — bail before touching state
      // ICS not available — continue
    }

    // Staleness guard: if a newer fetchEvents() call has started since this
    // one began, discard this response instead of overwriting the grid
    // with an out-of-order (older) week's events.
    if (requestId !== requestIdRef.current) return;

    // Merge results from both sources
    if (gotGoogle || gotIcs) {
      const merged = [...googleEvents, ...icsEvents];
      // Sort by start time
      merged.sort((a, b) => new Date(a.start) - new Date(b.start));
      setEvents(merged);
      setError(null);
    } else {
      // Neither source returned data — show empty calendar
      setEvents([]);
      setError(null);
    }

    setLoading(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rangeStart?.getTime(), rangeEnd?.getTime()]);

  // Initial fetch + refresh on range change
  useEffect(() => {
    setLoading(true);
    fetchEvents();
  }, [fetchEvents]);

  // Auto-refresh every 5 minutes
  useEffect(() => {
    intervalRef.current = setInterval(fetchEvents, REFRESH_INTERVAL);
    return () => clearInterval(intervalRef.current);
  }, [fetchEvents]);

  // Abort any outstanding request on unmount to avoid a dangling fetch
  // resolving after the component (and this hook) is gone.
  useEffect(() => {
    return () => {
      if (abortControllerRef.current) abortControllerRef.current.abort();
    };
  }, []);

  return { events, loading, error, refetch: fetchEvents };
}
