import { useState, useEffect, useRef, useCallback } from 'react';
import useStore from '../store/index.js';
import t from '../i18n/he.json';
import WeatherPopup from './WeatherPopup.jsx';

// ─── Helpers ────────────────────────────────────────────────────────────────

/** Map WMO weather code to emoji icon */
function getWeatherIcon(code) {
  if (code === 0) return '☀️';
  if (code >= 1 && code <= 3) return '⛅';
  if (code >= 45 && code <= 48) return '🌫️';
  if (code >= 51 && code <= 67) return '🌧️';
  if (code >= 71 && code <= 77) return '❄️';
  if (code >= 80 && code <= 82) return '🌦️';
  if (code >= 95 && code <= 99) return '⛈️';
  return '🌤️';
}

/** 24h clock with seconds — HH:MM:SS */
function getFormattedTime() {
  const now = new Date();
  const h = String(now.getHours()).padStart(2, '0');
  const m = String(now.getMinutes()).padStart(2, '0');
  const s = String(now.getSeconds()).padStart(2, '0');
  return `${h}:${m}:${s}`;
}

/** Time-based greeting from i18n */
function getGreeting() {
  const hour = new Date().getHours();
  if (hour >= 5 && hour < 12) return t.topBar.greetings.morning;
  if (hour >= 12 && hour < 17) return t.topBar.greetings.afternoon;
  if (hour >= 17 && hour < 21) return t.topBar.greetings.evening;
  return t.topBar.greetings.night;
}

/** Hebrew numerals (gematria) conversion */
const HEBREW_ONES = ['', 'א', 'ב', 'ג', 'ד', 'ה', 'ו', 'ז', 'ח', 'ט'];
const HEBREW_TENS = ['', 'י', 'כ', 'ל', 'מ', 'נ', 'ס', 'ע', 'פ', 'צ'];
const HEBREW_HUNDREDS = ['', 'ק', 'ר', 'ש', 'ת', 'תק', 'תר', 'תש', 'תת', 'תתק'];
const HEBREW_MONTHS = [
  'ניסן', 'אייר', 'סיוון', 'תמוז', 'אב', 'אלול',
  'תשרי', 'חשוון', 'כסלו', 'טבת', 'שבט', 'אדר', 'אדר ב׳'
];

function toHebrewNumeral(n) {
  if (n === 15) return 'ט״ו';
  if (n === 16) return 'ט״ז';
  if (n <= 0) return '';

  let result = '';
  if (n >= 100) {
    result += HEBREW_HUNDREDS[Math.floor(n / 100)];
    n %= 100;
  }
  if (n >= 10) {
    result += HEBREW_TENS[Math.floor(n / 10)];
    n %= 10;
  }
  if (n > 0) {
    result += HEBREW_ONES[n];
  }

  // Add geresh (׳) for single letter, gershayim (״) before last letter for multi
  if (result.length === 1) {
    result += '׳';
  } else if (result.length > 1) {
    result = result.slice(0, -1) + '״' + result.slice(-1);
  }
  return result;
}

function toHebrewYear(year) {
  // Hebrew year e.g. 5786 → ה׳תשפ״ו
  const thousands = Math.floor(year / 1000);
  const remainder = year % 1000;
  const hundredsVal = Math.floor(remainder / 100);
  const tensVal = Math.floor((remainder % 100) / 10);
  const onesVal = remainder % 10;

  let yearStr = HEBREW_HUNDREDS[hundredsVal] + HEBREW_TENS[tensVal] + HEBREW_ONES[onesVal];
  // Add gershayim before last char
  if (yearStr.length > 1) {
    yearStr = yearStr.slice(0, -1) + '״' + yearStr.slice(-1);
  }
  return HEBREW_ONES[thousands] + '׳' + yearStr;
}

/** Full Hebrew calendar date using only Hebrew letters */
function getHebrewDate() {
  const now = new Date();

  // Extract Hebrew calendar parts using Intl
  const parts = new Intl.DateTimeFormat('he-IL-u-ca-hebrew', {
    day: 'numeric',
    month: 'numeric',
    year: 'numeric',
  }).formatToParts(now);

  const dayNum = parseInt(parts.find(p => p.type === 'day')?.value || '1', 10);
  const monthNum = parseInt(parts.find(p => p.type === 'month')?.value || '1', 10);
  const yearNum = parseInt(parts.find(p => p.type === 'year')?.value || '5786', 10);

  const hebrewDay = toHebrewNumeral(dayNum);
  const hebrewMonth = HEBREW_MONTHS[monthNum - 1] || '';
  const hebrewYear = toHebrewYear(yearNum);

  const hebrewDate = `${hebrewDay} ${hebrewMonth} ${hebrewYear}`;

  // Regular day name from i18n
  const dayName = t.topBar.daysLong[now.getDay()];

  return { hebrewDate, dayName };
}

// ─── Sub-components ─────────────────────────────────────────────────────────

/** Live clock — updates every second */
function LiveClock() {
  const [time, setTime] = useState(getFormattedTime);

  useEffect(() => {
    const id = setInterval(() => setTime(getFormattedTime()), 1000);
    return () => clearInterval(id);
  }, []);

  return (
    <div
      className="font-mono text-[2.25rem] font-light text-tp tracking-wider leading-none select-none"
      aria-label={time}
    >
      {time}
    </div>
  );
}

/** Weather button + popup */
function WeatherSection() {
  const weather = useStore((s) => s.weather.current);
  const temperatureUnit = useStore((s) => s.settings.temperatureUnit);
  const [open, setOpen] = useState(false);
  const anchorRef = useRef(null);

  const toggle = useCallback(() => setOpen((v) => !v), []);
  const close = useCallback(() => setOpen(false), []);

  if (weather.temp == null && weather.code == null) return null;

  const unitLabel =
    temperatureUnit === 'celsius' ? t.weather.celsius : t.weather.fahrenheit;
  const tempText =
    weather.temp != null ? `${Math.round(weather.temp)}${unitLabel}` : '';

  return (
    <div className="relative">
      <button
        ref={anchorRef}
        onClick={toggle}
        className="flex items-center gap-2 px-3 py-2 rounded-xl min-w-[56px] min-h-[56px]
                   hover:bg-s2 active:scale-95 transition-all duration-[var(--dur-fast)]
                   select-none"
        aria-label="Weather"
      >
        <span className="text-2xl leading-none">
          {getWeatherIcon(weather.code)}
        </span>
        {tempText && (
          <span className="font-mono text-xl font-light text-tp">
            {tempText}
          </span>
        )}
      </button>

      {open && <WeatherPopup anchorRef={anchorRef} onClose={close} />}
    </div>
  );
}

/** Hebrew date + day name */
function HebrewDateSection() {
  const [dateInfo, setDateInfo] = useState(getHebrewDate);

  // Update once per minute (date only changes at midnight, but minute is safe)
  useEffect(() => {
    const id = setInterval(() => setDateInfo(getHebrewDate()), 60_000);
    return () => clearInterval(id);
  }, []);

  return (
    <div className="flex flex-col items-center select-none leading-tight">
      <span className="text-sm font-medium text-tp">{dateInfo.dayName}</span>
      <span className="text-xs text-ts">{dateInfo.hebrewDate}</span>
    </div>
  );
}

/** Time-based greeting + user name */
function GreetingSection() {
  const userName = useStore((s) => s.settings.userName);
  const [greeting, setGreeting] = useState(getGreeting);

  useEffect(() => {
    const id = setInterval(() => setGreeting(getGreeting()), 60_000);
    return () => clearInterval(id);
  }, []);

  return (
    <div className="flex flex-col select-none leading-tight">
      <span className="text-lg font-semibold text-tp">
        {greeting}
        {userName ? `, ${userName}` : ''}
      </span>
    </div>
  );
}

/** Brightness button placeholder */
function BrightnessButton() {
  return (
    <button
      className="flex items-center justify-center w-[56px] h-[56px] rounded-xl
                 hover:bg-s2 active:scale-95 transition-all duration-[var(--dur-fast)]
                 text-ts hover:text-tp"
      aria-label="Brightness"
    >
      {/* Sun icon */}
      <svg
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        className="w-6 h-6"
      >
        <circle cx="12" cy="12" r="5" />
        <line x1="12" y1="1" x2="12" y2="3" />
        <line x1="12" y1="21" x2="12" y2="23" />
        <line x1="4.22" y1="4.22" x2="5.64" y2="5.64" />
        <line x1="18.36" y1="18.36" x2="19.78" y2="19.78" />
        <line x1="1" y1="12" x2="3" y2="12" />
        <line x1="21" y1="12" x2="23" y2="12" />
        <line x1="4.22" y1="19.78" x2="5.64" y2="18.36" />
        <line x1="18.36" y1="5.64" x2="19.78" y2="4.22" />
      </svg>
    </button>
  );
}

/** WiFi indicator with status dot */
function WifiIndicator() {
  const wifiStatus = useStore((s) => s.connections.wifi);

  // Hide entirely when not configured
  if (wifiStatus === 'not_configured') return null;

  const dotColor =
    wifiStatus === 'connected'
      ? 'bg-acc2' // green
      : 'bg-gold-d'; // amber for degraded

  return (
    <button
      className="relative flex items-center justify-center w-[56px] h-[56px] rounded-xl
                 hover:bg-s2 active:scale-95 transition-all duration-[var(--dur-fast)]
                 text-ts hover:text-tp"
      aria-label="WiFi"
    >
      {/* WiFi icon */}
      <svg
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        className="w-6 h-6"
      >
        <path d="M5 12.55a11 11 0 0 1 14.08 0" />
        <path d="M1.42 9a16 16 0 0 1 21.16 0" />
        <path d="M8.53 16.11a6 6 0 0 1 6.95 0" />
        <line x1="12" y1="20" x2="12.01" y2="20" />
      </svg>

      {/* Status dot */}
      <span
        className={`absolute top-2.5 left-2.5 w-2.5 h-2.5 rounded-full border-2 border-surf ${dotColor}`}
      />
    </button>
  );
}

/** Settings gear — switches to Settings tab (index 5) */
function SettingsButton() {
  const setActiveTab = useStore((s) => s.setActiveTab);

  return (
    <button
      onClick={() => setActiveTab(5)}
      className="flex items-center justify-center w-[56px] h-[56px] rounded-xl
                 hover:bg-s2 active:scale-95 transition-all duration-[var(--dur-fast)]
                 text-ts hover:text-tp"
      aria-label={t.tabs.settings}
    >
      {/* Gear icon */}
      <svg
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        className="w-5 h-5"
      >
        <circle cx="12" cy="12" r="3" />
        <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z" />
      </svg>
    </button>
  );
}

// ─── TopBar Component ───────────────────────────────────────────────────────

export default function TopBar() {
  return (
    <header
      className="flex items-center justify-between px-6 bg-surf border-b border-bd shrink-0"
      style={{ height: '72px' }}
    >
      {/* Right side in RTL: Clock + Weather */}
      <div className="flex items-center gap-4">
        <LiveClock />
        <div className="w-px h-8 bg-bd" />
        <WeatherSection />
      </div>

      {/* Center: Hebrew date + Greeting */}
      <div className="flex items-center gap-6">
        <HebrewDateSection />
        <div className="w-px h-8 bg-bd" />
        <GreetingSection />
      </div>

      {/* Left side in RTL: Utility buttons */}
      <div className="flex items-center gap-1">
        <BrightnessButton />
        <WifiIndicator />
        <SettingsButton />
      </div>
    </header>
  );
}
