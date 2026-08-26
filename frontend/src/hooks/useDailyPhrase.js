import { useState, useEffect } from 'react';
import { fetchApi } from './useApi.js';

const SLOT_MS = 10 * 60 * 1000;

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

function fromSlot(list, now = Date.now()) {
  const slot = Math.floor(now / SLOT_MS);
  const item = list[slot % list.length];
  return {
    text: item.text,
    source: item.source || '',
    nextChangeAt: (slot + 1) * SLOT_MS,
  };
}

export default function useDailyPhrase() {
  const [phrase, setPhrase] = useState(() => fromSlot(FALLBACK));

  useEffect(() => {
    let cancelled = false;
    let timer;

    async function load() {
      try {
        const data = await fetchApi('/api/quotes');
        if (cancelled || !data?.text) return;
        setPhrase(data);
        const wait = Math.max(5_000, (data.nextChangeAt || Date.now() + SLOT_MS) - Date.now() + 250);
        timer = setTimeout(load, wait);
      } catch {
        if (cancelled) return;
        const fallback = fromSlot(FALLBACK);
        setPhrase(fallback);
        timer = setTimeout(load, Math.max(5_000, fallback.nextChangeAt - Date.now() + 250));
      }
    }

    load();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, []);

  return phrase;
}
