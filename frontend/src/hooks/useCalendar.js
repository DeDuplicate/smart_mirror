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

/** Format date as YYYY-MM-DD for API queries. */
function toISODate(date) {
  return date.toISOString().split('T')[0];
}

// ─── Hook ───────────────────────────────────────────────────────────────────

const REFRESH_INTERVAL = 5 * 60 * 1000; // 5 minutes

export default function useCalendar(weekStart) {
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
    if (!weekStart) return;

    // Cancel any previous in-flight fetch — its result is now stale.
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }
    const controller = new AbortController();
    abortControllerRef.current = controller;
    const requestId = ++requestIdRef.current;

    const start = toISODate(weekStart);
    const end = toISODate(getWeekEnd(weekStart));

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
  }, [weekStart]);

  // Initial fetch + refresh on weekStart change
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
