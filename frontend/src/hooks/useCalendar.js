import { useState, useEffect, useCallback, useRef } from 'react';

// ─── Color Palettes ─────────────────────────────────────────────────────────

export const CALENDAR_COLORS = {
  mint:  { bg: 'var(--mint-bg)', border: 'var(--mint-d)', text: 'var(--tp)', dot: 'var(--mint-d)' },
  lav:   { bg: 'var(--lav-bg)',  border: 'var(--lav-d)',  text: 'var(--tp)',  dot: 'var(--lav-d)' },
  coral: { bg: 'var(--coral-bg)', border: 'var(--coral-d)', text: 'var(--tp)', dot: 'var(--coral-d)' },
  gold:  { bg: 'var(--gold-bg)',  border: 'var(--gold-d)',  text: 'var(--tp)',  dot: 'var(--gold-d)' },
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
    if (ev.allDay || /^\d{4}-\d{2}-\d{2}$/.test(String(ev.start || ''))) {
      const startKey = eventDateKey(ev.start);
      const endKey = eventDateKey(ev.end || ev.start);
      if (!startKey) continue;
      const s = new Date(`${startKey}T00:00:00`);
      let e = new Date(`${(endKey || startKey)}T00:00:00`);
      if (e > s) e.setDate(e.getDate() - 1);
      if (e < s) e = new Date(s);
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

/** Format date as YYYY-MM-DD for API queries (local timezone, not UTC). */
function toISODate(date) {
  return toLocalDateKey(date);
}

export function normalizeCalendarColor(key) {
  if (key === 'lavender') return 'lav';
  return key && CALENDAR_COLORS[key] ? key : 'mint';
}

export function eventDateKey(value) {
  const raw = String(value || '');
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw;
  if (/^\d{4}-\d{2}-\d{2}T/.test(raw)) return raw.slice(0, 10);
  const d = new Date(raw);
  return Number.isNaN(d.getTime()) ? '' : toLocalDateKey(d);
}

/** Inclusive local-day check. Google all-day `end` is exclusive. */
export function eventFallsOnDay(event, date) {
  const key = toLocalDateKey(date);
  const allDay = event.allDay || /^\d{4}-\d{2}-\d{2}$/.test(String(event.start || ''));
  if (allDay) {
    const startKey = eventDateKey(event.start);
    const endKey = eventDateKey(event.end || event.start);
    if (!startKey) return false;
    if (!endKey || endKey <= startKey) return key === startKey;
    return key >= startKey && key < endKey;
  }
  return eventDateKey(event.start) === key;
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

    const start = rangeStart.toISOString();
    const end = rangeEnd.toISOString();

    const normalize = (ev, fallbackSource) => ({
      ...ev,
      title: ev.title || ev.summary || '(No title)',
      source: ev.source || fallbackSource,
    });

    let icsEvents = [];
    let localEvents = [];

    try {
      const [icsRes, localRes] = await Promise.all([
        fetch(`/api/calendar/ics?start=${start}&end=${end}`, { signal: controller.signal }),
        fetch(`/api/calendar/events?start=${start}&end=${end}`, { signal: controller.signal }),
      ]);

      if (icsRes.ok) {
        const data = await icsRes.json();
        if (data?.events?.length) {
          icsEvents = data.events.map((ev) => normalize(ev, 'ics'));
        }
      }
      if (localRes.ok) {
        const data = await localRes.json();
        if (data?.events?.length) {
          localEvents = data.events.map((ev) => normalize(ev, 'local'));
        }
      }
    } catch (err) {
      if (err?.name === 'AbortError') return;
    }

    if (requestId !== requestIdRef.current) return;

    const merged = [...icsEvents, ...localEvents].sort(
      (a, b) => new Date(a.start) - new Date(b.start)
    );
    setEvents(merged);
    setError(null);
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

  const createEvent = useCallback(async (payload) => {
    const res = await fetch('/api/calendar/events', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || 'Failed to create event');
    await fetchEvents();
    return data;
  }, [fetchEvents]);

  const updateEvent = useCallback(async (id, payload) => {
    const res = await fetch(`/api/calendar/events/${encodeURIComponent(id)}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || 'Failed to update event');
    await fetchEvents();
    return data;
  }, [fetchEvents]);

  const deleteEvent = useCallback(async (id) => {
    const res = await fetch(`/api/calendar/events/${encodeURIComponent(id)}`, {
      method: 'DELETE',
    });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      throw new Error(data.error || 'Failed to delete event');
    }
    await fetchEvents();
  }, [fetchEvents]);

  return {
    events,
    loading,
    error,
    refetch: fetchEvents,
    createEvent,
    updateEvent,
    deleteEvent,
  };
}
