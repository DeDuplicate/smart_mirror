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

// ─── Mock Data Generator ────────────────────────────────────────────────────

function generateMockEvents(weekStart) {
  const ws = new Date(weekStart);
  const dayDate = (offset) => {
    const d = new Date(ws);
    d.setDate(d.getDate() + offset);
    return d;
  };

  const makeTime = (dayOffset, hour, minute = 0) => {
    const d = dayDate(dayOffset);
    d.setHours(hour, minute, 0, 0);
    return d.toISOString();
  };

  const makeDay = (dayOffset) => {
    const d = dayDate(dayOffset);
    d.setHours(0, 0, 0, 0);
    return toISODate(d);
  };

  return [
    // ── Timed events across the week ──
    {
      id: 'mock-1',
      title: 'פגישת צוות',
      start: makeTime(0, 9, 0),
      end: makeTime(0, 10, 30),
      allDay: false,
      location: 'חדר ישיבות A',
      description: 'סקירה שבועית של הפרויקט',
      calendar: 'עבודה',
      color: 'mint',
      attendees: ['דני כהן', 'שרה לוי', 'איתן גולד'],
    },
    {
      id: 'mock-2',
      title: 'שיחת לקוח',
      start: makeTime(0, 14, 0),
      end: makeTime(0, 15, 0),
      allDay: false,
      location: '',
      description: 'הצגת אב טיפוס',
      calendar: 'עבודה',
      color: 'mint',
      attendees: ['רונית אביב'],
    },
    {
      id: 'mock-3',
      title: 'ארוחת צהריים עם נועה',
      start: makeTime(1, 12, 0),
      end: makeTime(1, 13, 0),
      allDay: false,
      location: 'מסעדת השף',
      description: '',
      calendar: 'אישי',
      color: 'coral',
      attendees: ['נועה ברק'],
    },
    {
      id: 'mock-4',
      title: 'חדר כושר',
      start: makeTime(1, 17, 0),
      end: makeTime(1, 18, 30),
      allDay: false,
      location: 'הולמס פלייס',
      description: 'אימון כוח + קרדיו',
      calendar: 'אישי',
      color: 'coral',
      attendees: [],
    },
    {
      id: 'mock-5',
      title: 'סקירת קוד',
      start: makeTime(2, 10, 0),
      end: makeTime(2, 11, 0),
      allDay: false,
      location: '',
      description: 'PR #142 — רכיב לוח שנה',
      calendar: 'עבודה',
      color: 'mint',
      attendees: ['יוסי דביר'],
    },
    {
      id: 'mock-6',
      title: 'רופא שיניים',
      start: makeTime(3, 8, 0),
      end: makeTime(3, 9, 0),
      allDay: false,
      location: 'מרפאת שיניים — רמת גן',
      description: 'בדיקה תקופתית',
      calendar: 'אישי',
      color: 'coral',
      attendees: [],
    },
    {
      id: 'mock-7',
      title: 'הרצאה — עיצוב מוצר',
      start: makeTime(4, 15, 0),
      end: makeTime(4, 17, 0),
      allDay: false,
      location: 'אולם 3, קומה 2',
      description: 'עקרונות UX למסכי מגע',
      calendar: 'לימודים',
      color: 'lav',
      attendees: [],
    },

    // ── Overlapping events on day 2 (Tuesday) ──
    {
      id: 'mock-8',
      title: 'מפגש דיזיין',
      start: makeTime(2, 14, 0),
      end: makeTime(2, 15, 30),
      allDay: false,
      location: 'חדר ישיבות B',
      description: '',
      calendar: 'עבודה',
      color: 'mint',
      attendees: ['מיכל רז'],
    },
    {
      id: 'mock-9',
      title: 'שיחת סטטוס',
      start: makeTime(2, 14, 0),
      end: makeTime(2, 15, 0),
      allDay: false,
      location: '',
      description: 'עדכון מנהל',
      calendar: 'עבודה',
      color: 'gold',
      attendees: ['אורי שמש'],
    },

    // ── All-day events ──
    {
      id: 'mock-10',
      title: 'יום הולדת דני',
      start: makeDay(1),
      end: makeDay(1),
      allDay: true,
      location: '',
      description: '',
      calendar: 'ימי הולדת',
      color: 'gold',
      attendees: [],
    },
    {
      id: 'mock-11',
      title: 'דדליין פרויקט',
      start: makeDay(4),
      end: makeDay(4),
      allDay: true,
      location: '',
      description: 'הגשת גרסה סופית',
      calendar: 'עבודה',
      color: 'mint',
      attendees: [],
    },

    // ── Multi-day event (spans 2 days) ──
    {
      id: 'mock-12',
      title: 'כנס טכנולוגי',
      start: makeDay(2),
      end: makeDay(3),
      allDay: true,
      location: 'מרכז הכנסים — תל אביב',
      description: 'כנס שנתי בנושא AI ומוצרי מובייל',
      calendar: 'לימודים',
      color: 'lav',
      attendees: [],
    },
  ];
}

// ─── Hook ───────────────────────────────────────────────────────────────────

const REFRESH_INTERVAL = 5 * 60 * 1000; // 5 minutes

export default function useCalendar(weekStart) {
  const [events, setEvents] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const intervalRef = useRef(null);

  const fetchEvents = useCallback(async () => {
    if (!weekStart) return;

    const start = toISODate(weekStart);
    const end = toISODate(getWeekEnd(weekStart));

    try {
      const res = await fetch(`/api/calendar/events?start=${start}&end=${end}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();

      if (data && data.length > 0) {
        setEvents(data);
        setError(null);
      } else {
        // Empty response — fall back to mock in dev
        throw new Error('empty');
      }
    } catch (_err) {
      // Use mock data when API is unavailable or returns empty
      const mock = generateMockEvents(weekStart);
      setEvents(mock);
      setError(null); // Don't show error when we have mock data
    } finally {
      setLoading(false);
    }
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

  return { events, loading, error, refetch: fetchEvents };
}
