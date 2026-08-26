import { useState, useEffect, useRef, useCallback } from 'react';
import useStore from '../store/index.js';
import t from '../i18n/he.json';
import WeatherIcon, { getConditionLabel } from './WeatherIcon.jsx';
import useHebrewCalendar from '../hooks/useHebrewCalendar.js';

// ─── Screensaver Component ───────────────────────────────────────────────────
// Two modes: "clock" (full-screen dark clock) or "slideshow" (Ken Burns photos).
// Fades in on mount. Any touch/click dismisses it via onDismiss callback.

// ─── Gradient "photos" for slideshow placeholder ─────────────────────────────

const SLIDESHOW_GRADIENTS = [
  'linear-gradient(135deg, #1a1c2e 0%, #2d1b69 30%, #0a0a1f 100%)',
  'linear-gradient(145deg, #0a1628 0%, #1a3a4a 40%, #0a0a1f 100%)',
  'linear-gradient(125deg, #1f0a28 0%, #3a1a4a 35%, #0a0a1f 100%)',
  'linear-gradient(155deg, #0a1a0a 0%, #1a3a2a 40%, #0a0a1f 100%)',
  'linear-gradient(130deg, #1a1a0a 0%, #3a2a1a 35%, #0a0a1f 100%)',
];

const SLIDE_DURATION = 15000; // 15s per slide
const CROSSFADE_DURATION = 1000; // 1s crossfade

// ─── Clock Display ───────────────────────────────────────────────────────────

function useClock() {
  const [time, setTime] = useState(() => new Date());

  useEffect(() => {
    const timer = setInterval(() => setTime(new Date()), 1000);
    return () => clearInterval(timer);
  }, []);

  return time;
}

function formatClockTime(date) {
  const hh = String(date.getHours()).padStart(2, '0');
  const mm = String(date.getMinutes()).padStart(2, '0');
  const ss = String(date.getSeconds()).padStart(2, '0');
  return { hh, mm, ss };
}

function formatHebrewDate(date) {
  try {
    return date.toLocaleDateString('he-IL', {
      weekday: 'long',
      year: 'numeric',
      month: 'long',
      day: 'numeric',
    });
  } catch {
    return '';
  }
}

// ─── Weather line ────────────────────────────────────────────────────────────
// Animated condition icon + temperature + Hebrew condition name. Reads the
// store that App.jsx already keeps polling while the screensaver is up, so
// this needs no fetching of its own.

function ScreensaverWeather({ iconSize = 44 }) {
  const weather = useStore((s) => s.weather.current);
  const temperatureUnit = useStore((s) => s.settings.temperatureUnit) || 'celsius';

  // Nothing until the first successful weather fetch — better an absent row
  // than a placeholder dash on a full-screen display.
  if (weather.temp == null && weather.code == null) return null;

  const unitLabel =
    temperatureUnit === 'celsius' ? t.weather.celsius : t.weather.fahrenheit;

  return (
    <div className="flex items-center gap-3 select-none" dir="rtl">
      {weather.code != null && (
        <WeatherIcon code={weather.code} size={iconSize} />
      )}
      {weather.temp != null && (
        <span
          className="text-white/70 font-light"
          style={{
            fontFamily: "'DM Mono', monospace",
            fontSize: `${Math.round(iconSize * 0.64)}px`,
            lineHeight: 1,
          }}
        >
          {Math.round(weather.temp)}
          {unitLabel}
        </span>
      )}
      {weather.code != null && (
        <span className="text-white/40 text-lg font-light">
          {getConditionLabel(weather.code)}
        </span>
      )}
    </div>
  );
}

// ─── Shabbat times (Friday + Saturday only) ──────────────────────────────────

function FlameIcon({ size = 20 }) {
  return (
    <svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className="shrink-0"
    >
      <path d="M12 2c1.5 3.5 5 5.5 5 9.5a5 5 0 0 1-10 0C7 8.5 10.5 6 12 2z" />
    </svg>
  );
}

/**
 * Shabbat times on the screensaver — only rendered on Friday and Saturday.
 * `date` comes from the caller's ticking clock so the day flips correctly if
 * the screensaver stays up across midnight.
 *
 * Friday shows when Shabbat comes IN; Saturday shows when it goes OUT — an
 * "entry" time is meaningless once Shabbat has already begun.
 */
function ScreensaverShabbat({ date }) {
  const { shabbatCandles, shabbatHavdalah } = useHebrewCalendar();

  const day = date.getDay(); // 0=Sun … 5=Fri, 6=Sat
  const isFriday = day === 5;
  const isSaturday = day === 6;
  if (!isFriday && !isSaturday) return null;

  const label = isFriday ? t.holidays.shabbatEntry : t.holidays.shabbatExit;
  const timeStr = isFriday ? shabbatCandles : shabbatHavdalah;
  if (!timeStr) return null;

  return (
    <div className="flex items-center gap-2 select-none text-white/50" dir="rtl">
      <FlameIcon size={18} />
      <span className="text-base font-light">{label}</span>
      <span
        className="text-white/75 text-base"
        style={{ fontFamily: "'DM Mono', monospace" }}
      >
        {timeStr}
      </span>
    </div>
  );
}

// ─── Clock Mode ──────────────────────────────────────────────────────────────

function ClockMode() {
  const time = useClock();
  const { hh, mm, ss } = formatClockTime(time);
  const dateStr = formatHebrewDate(time);

  return (
    <div className="flex flex-col items-center justify-center h-full select-none">
      {/* Large clock with breathing animation */}
      <div
        className="screensaver-clock-breathing"
        style={{
          fontFamily: "'DM Mono', monospace",
          fontSize: '120px',
          fontWeight: 300,
          color: '#ffffff',
          letterSpacing: '0.05em',
          lineHeight: 1,
        }}
      >
        <span>{hh}</span>
        <span style={{ opacity: 0.6 }}>:</span>
        <span>{mm}</span>
        <span style={{ fontSize: '60px', opacity: 0.4, marginInlineStart: '24px' }}>
          {ss}
        </span>
      </div>

      {/* Hebrew date below */}
      <p
        className="mt-6 text-white/40 text-lg font-light select-none"
        dir="rtl"
      >
        {dateStr}
      </p>

      {/* Current weather */}
      <div className="mt-8">
        <ScreensaverWeather />
      </div>

      {/* Shabbat times — Friday and Saturday only */}
      <div className="mt-4">
        <ScreensaverShabbat date={time} />
      </div>
    </div>
  );
}

// ─── Slideshow Mode ──────────────────────────────────────────────────────────

function SlideshowMode() {
  const time = useClock();
  const { hh, mm } = formatClockTime(time);
  const dateStr = formatHebrewDate(time);

  const [currentSlide, setCurrentSlide] = useState(0);
  const [nextSlide, setNextSlide] = useState(1);
  const [transitioning, setTransitioning] = useState(false);
  const slideTimerRef = useRef(null);

  // Cycle through slides
  useEffect(() => {
    slideTimerRef.current = setInterval(() => {
      setTransitioning(true);

      // After crossfade completes, swap slides
      setTimeout(() => {
        setCurrentSlide((prev) => {
          const next = (prev + 1) % SLIDESHOW_GRADIENTS.length;
          return next;
        });
        setNextSlide((prev) => {
          const next = (prev + 1) % SLIDESHOW_GRADIENTS.length;
          return next;
        });
        setTransitioning(false);
      }, CROSSFADE_DURATION);
    }, SLIDE_DURATION);

    return () => {
      if (slideTimerRef.current) clearInterval(slideTimerRef.current);
    };
  }, []);

  return (
    <div className="relative w-full h-full overflow-hidden">
      {/* Current slide with Ken Burns */}
      <div
        className="absolute inset-0 kenburns-1"
        style={{
          background: SLIDESHOW_GRADIENTS[currentSlide],
          opacity: transitioning ? 0 : 1,
          transition: `opacity ${CROSSFADE_DURATION}ms ease`,
          willChange: 'transform',
        }}
      />

      {/* Next slide (fades in during transition) */}
      <div
        className="absolute inset-0 kenburns-2"
        style={{
          background: SLIDESHOW_GRADIENTS[nextSlide],
          opacity: transitioning ? 1 : 0,
          transition: `opacity ${CROSSFADE_DURATION}ms ease`,
          willChange: 'transform',
        }}
      />

      {/* Clock overlay in bottom-right (RTL: bottom-left) */}
      <div
        className="absolute bottom-8 left-8 flex flex-col items-start select-none"
        dir="rtl"
        style={{ zIndex: 2 }}
      >
        <span
          style={{
            fontFamily: "'DM Mono', monospace",
            fontSize: '48px',
            fontWeight: 300,
            color: '#ffffff',
            textShadow: '0 2px 12px rgba(0,0,0,0.6)',
            lineHeight: 1,
          }}
        >
          {hh}:{mm}
        </span>
        <span
          className="mt-2 text-white/50 text-sm font-light"
          style={{ textShadow: '0 1px 6px rgba(0,0,0,0.5)' }}
        >
          {dateStr}
        </span>

        {/* Current weather — same row as clock mode, small overlay so it
            stays readable over the photos without covering them */}
        <div
          className="mt-3"
          style={{
            filter: 'drop-shadow(0 1px 6px rgba(0,0,0,0.5))',
            textShadow: '0 1px 6px rgba(0,0,0,0.5)',
          }}
        >
          <ScreensaverWeather iconSize={30} />
        </div>
      </div>
    </div>
  );
}

// ─── Screensaver Container ───────────────────────────────────────────────────

export default function Screensaver({ style = 'clock', onDismiss }) {
  const [visible, setVisible] = useState(false);
  const [exiting, setExiting] = useState(false);

  // Fade in on mount
  useEffect(() => {
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        setVisible(true);
      });
    });
  }, []);

  // Handle dismiss
  const handleDismiss = useCallback(() => {
    if (exiting) return;
    setExiting(true);
    setVisible(false);

    // Wait for fade-out to complete, then call onDismiss
    setTimeout(() => {
      if (onDismiss) onDismiss();
    }, 400); // matches --dur-slow
  }, [exiting, onDismiss]);

  // Dismiss on any touch/click/key
  useEffect(() => {
    const dismiss = () => handleDismiss();

    // Small delay to prevent immediate dismissal from the same event
    // that might have triggered idle state
    const timer = setTimeout(() => {
      window.addEventListener('touchstart', dismiss, { once: true });
      window.addEventListener('mousedown', dismiss, { once: true });
      window.addEventListener('keydown', dismiss, { once: true });
    }, 500);

    return () => {
      clearTimeout(timer);
      window.removeEventListener('touchstart', dismiss);
      window.removeEventListener('mousedown', dismiss);
      window.removeEventListener('keydown', dismiss);
    };
  }, [handleDismiss]);

  return (
    <div
      className="fixed inset-0"
      style={{
        zIndex: 30,
        backgroundColor: '#0a0a0f',
        opacity: visible ? 1 : 0,
        transition: `opacity var(--dur-slow) var(--ease)`,
        cursor: 'pointer',
      }}
    >
      {style === 'slideshow' ? <SlideshowMode /> : <ClockMode />}
    </div>
  );
}
