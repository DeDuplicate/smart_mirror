import { useState, useEffect } from 'react';
import { fetchApi } from './useApi.js';
import useStore from '../store/index.js';

const DEFAULT_INTERVAL_MIN = 10;

const FALLBACK = [
  { text: 'אם אין אני לי, מי לי? וכשאני לעצמי, מה אני? ואם לא עכשיו, אימתי?', source: 'הלל הזקן' },
  { text: 'איזהו חכם? הלומד מכל אדם.', source: 'פרקי אבות' },
  { text: 'איזהו עשיר? השמח בחלקו.', source: 'פרקי אבות' },
  { text: 'דברי חכמים בנחת נשמעים.', source: 'קהלת' },
  { text: 'שלח לחמך על פני המים, כי ברוב הימים תמצאנו.', source: 'קהלת' },
  { text: 'הבוקר מביא התחלה חדשה.', source: 'משפט יומי' },
  { text: 'שלום בית קודם לכל.', source: 'משפט יומי' },
  { text: 'יום אחד בכל פעם.', source: 'משפט יומי' },
];

function fromSlot(list, slotMs, now = Date.now()) {
  const slot = Math.floor(now / slotMs);
  const item = list[slot % list.length];
  return {
    text: item.text,
    source: item.source || '',
    explanation: item.explanation || '',
    nextChangeAt: (slot + 1) * slotMs,
  };
}

/**
 * Current daily phrase. Rotation cadence is user-configurable in Settings; the
 * interval is sent to the server so both agree on which slot is current, and
 * the next fetch is scheduled for exactly when that slot expires.
 */
export default function useDailyPhrase() {
  const intervalMin = useStore((s) => s.settings.phraseIntervalMin) ?? DEFAULT_INTERVAL_MIN;
  const slotMs = Math.max(1, intervalMin) * 60 * 1000;

  const [phrase, setPhrase] = useState(() => fromSlot(FALLBACK, slotMs));

  useEffect(() => {
    let cancelled = false;
    let timer;

    async function load() {
      try {
        const data = await fetchApi(`/api/quotes?intervalMin=${intervalMin}`);
        if (cancelled || !data?.text) return;
        setPhrase(data);
        const wait = Math.max(5_000, (data.nextChangeAt || Date.now() + slotMs) - Date.now() + 250);
        timer = setTimeout(load, wait);
      } catch {
        if (cancelled) return;
        const fallback = fromSlot(FALLBACK, slotMs);
        setPhrase(fallback);
        timer = setTimeout(load, Math.max(5_000, fallback.nextChangeAt - Date.now() + 250));
      }
    }

    load();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
    // Re-subscribes when the user changes the cadence in Settings.
  }, [intervalMin, slotMs]);

  return phrase;
}
