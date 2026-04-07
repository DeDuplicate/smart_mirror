import { useState, useEffect, useRef, useCallback } from 'react';

// ─── Constants ─────────────────────────────────────────────────────────────

const HEBCAL_API =
  'https://www.hebcal.com/hebcal?v=1&cfg=json&maj=on&min=on&mod=on&nx=on&ss=on&mf=on&c=on&geo=pos&latitude=32.33&longitude=34.86&tzid=Asia/Jerusalem&M=on';

const CACHE_KEY = 'hebcal_cache';
const CACHE_TTL = 24 * 60 * 60 * 1000; // 24 hours

// ─── Cache helpers ─────────────────────────────────────────────────────────

function getCached() {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (Date.now() - parsed.timestamp > CACHE_TTL) {
      localStorage.removeItem(CACHE_KEY);
      return null;
    }
    return parsed.data;
  } catch {
    return null;
  }
}

function setCache(data) {
  try {
    localStorage.setItem(
      CACHE_KEY,
      JSON.stringify({ data, timestamp: Date.now() })
    );
  } catch {
    // localStorage full — silently ignore
  }
}

// ─── Mock data ─────────────────────────────────────────────────────────────

function generateMockData() {
  // Simulate a Friday with candle lighting
  return {
    todayHoliday: 'ערב שבת',
    shabbatCandles: '18:45',
    shabbatHavdalah: '19:52',
    upcomingHolidays: [
      { title: 'שבת הגדול', date: '2026-03-28', category: 'parashat' },
      { title: 'ערב פסח', date: '2026-04-01', category: 'holiday' },
      { title: 'פסח', date: '2026-04-02', category: 'holiday' },
      { title: 'שביעי של פסח', date: '2026-04-08', category: 'holiday' },
      { title: 'יום העצמאות', date: '2026-04-29', category: 'holiday' },
    ],
  };
}

// ─── Parse Hebcal response ─────────────────────────────────────────────────

function parseHebcalResponse(data) {
  const items = data.items || [];
  const today = new Date();
  const todayStr = today.toISOString().split('T')[0];

  // Today's day of week (0=Sun, 5=Fri, 6=Sat)
  const dayOfWeek = today.getDay();

  let todayHoliday = null;
  let shabbatCandles = null;
  let shabbatHavdalah = null;
  const upcomingHolidays = [];

  for (const item of items) {
    const itemDate = (item.date || '').split('T')[0];

    // Check if this is today's holiday
    if (itemDate === todayStr && item.category !== 'candles' && item.category !== 'havdalah') {
      if (item.category === 'holiday' || item.category === 'mevpilon') {
        todayHoliday = item.hebrew || item.title;
      }
    }

    // Candle lighting (the upcoming or current Friday)
    if (item.category === 'candles') {
      // Get the time portion
      const dateObj = new Date(item.date);
      const timeDiff = dateObj - today;
      // Take the nearest upcoming candle lighting (within 7 days)
      if (timeDiff > -12 * 60 * 60 * 1000 && timeDiff < 7 * 24 * 60 * 60 * 1000) {
        if (!shabbatCandles) {
          const h = String(dateObj.getHours()).padStart(2, '0');
          const m = String(dateObj.getMinutes()).padStart(2, '0');
          shabbatCandles = `${h}:${m}`;
        }
      }
    }

    // Havdalah
    if (item.category === 'havdalah') {
      const dateObj = new Date(item.date);
      const timeDiff = dateObj - today;
      if (timeDiff > -12 * 60 * 60 * 1000 && timeDiff < 7 * 24 * 60 * 60 * 1000) {
        if (!shabbatHavdalah) {
          const h = String(dateObj.getHours()).padStart(2, '0');
          const m = String(dateObj.getMinutes()).padStart(2, '0');
          shabbatHavdalah = `${h}:${m}`;
        }
      }
    }

    // Upcoming holidays (future, not candles/havdalah/parashat)
    if (
      itemDate > todayStr &&
      item.category !== 'candles' &&
      item.category !== 'havdalah' &&
      upcomingHolidays.length < 5
    ) {
      upcomingHolidays.push({
        title: item.hebrew || item.title,
        date: itemDate,
        category: item.category || 'holiday',
      });
    }
  }

  // On Friday, if no explicit holiday, mark as Erev Shabbat
  if (dayOfWeek === 5 && !todayHoliday) {
    todayHoliday = 'ערב שבת';
  }

  // On Saturday, if no explicit holiday, mark as Shabbat
  if (dayOfWeek === 6 && !todayHoliday) {
    todayHoliday = 'שבת';
  }

  return {
    todayHoliday,
    shabbatCandles,
    shabbatHavdalah,
    upcomingHolidays,
  };
}

// ─── Hook ──────────────────────────────────────────────────────────────────

export default function useHebrewCalendar() {
  const [data, setData] = useState({
    todayHoliday: null,
    shabbatCandles: null,
    shabbatHavdalah: null,
    upcomingHolidays: [],
  });
  const [loading, setLoading] = useState(true);
  const mountedRef = useRef(true);

  const fetchCalendar = useCallback(async () => {
    // Check cache first
    const cached = getCached();
    if (cached) {
      setData(cached);
      setLoading(false);
      return;
    }

    try {
      const res = await fetch(HEBCAL_API);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = await res.json();

      if (!mountedRef.current) return;

      const parsed = parseHebcalResponse(json);
      setCache(parsed);
      setData(parsed);
    } catch (_err) {
      if (!mountedRef.current) return;
      // Fall back to mock data
      const mock = generateMockData();
      setData(mock);
    } finally {
      if (mountedRef.current) {
        setLoading(false);
      }
    }
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    fetchCalendar();

    // Re-fetch once per day (midnight reset)
    const now = new Date();
    const msUntilMidnight =
      new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1).getTime() -
      now.getTime() +
      60_000; // 1min after midnight

    const timeout = setTimeout(() => {
      // Clear cache and re-fetch
      localStorage.removeItem(CACHE_KEY);
      fetchCalendar();
    }, msUntilMidnight);

    return () => {
      mountedRef.current = false;
      clearTimeout(timeout);
    };
  }, [fetchCalendar]);

  return { ...data, loading, refetch: fetchCalendar };
}
