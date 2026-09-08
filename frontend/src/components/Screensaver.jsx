import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import useStore from '../store/index.js';
import t from '../i18n/he.json';
import WeatherIcon, { getConditionLabel } from './WeatherIcon.jsx';
import useHebrewCalendar from '../hooks/useHebrewCalendar.js';
import useDailyPhrase from '../hooks/useDailyPhrase.js';
import useCalendar, { toLocalDateKey, eventFallsOnDay } from '../hooks/useCalendar.js';
import useTasks from '../hooks/useTasks.js';
import useNews from '../hooks/useNews.js';
import { getHebrewDateParts } from '../utils/hebrewDate.js';
import { useMusicContext } from '../context/MusicContext.jsx';
import {
  SCREENSAVER_INTERACTIVE_ATTR,
  isScreensaverInteractive,
} from '../hooks/useIdleDetection.js';

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

/** Gregorian date, written out in Hebrew — e.g. "יום שני, 8 בספטמבר 2026" */
function formatGregorianDate(date) {
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

// ─── Weather ─────────────────────────────────────────────────────────────────
// Current conditions + multi-day forecast. Reads the store that App.jsx already
// keeps polling while the screensaver is up, so this needs no fetching of its
// own. Sized to be the anchor of its region — readable from across the room.

function ScreensaverWeather({ compact = false }) {
  const weather = useStore((s) => s.weather.current);
  const temperatureUnit = useStore((s) => s.settings.temperatureUnit) || 'celsius';

  // Nothing until the first successful weather fetch — better an absent row
  // than a placeholder dash on a full-screen display.
  if (weather.temp == null && weather.code == null) return null;

  const unitLabel = temperatureUnit === 'celsius' ? t.weather.celsius : t.weather.fahrenheit;
  const iconSize = compact ? 56 : 76;
  const shadow = compact ? '0 1px 8px rgba(0,0,0,0.55)' : 'none';

  return (
    <div className="flex flex-col items-end select-none" dir="rtl">
      <div className="flex items-center gap-4">
        {weather.temp != null && (
          <span
            className="text-white font-light"
            style={{
              fontFamily: "'DM Mono', monospace",
              fontSize: compact ? 60 : 84,
              lineHeight: 1,
              textShadow: shadow,
            }}
          >
            {Math.round(weather.temp)}
            {unitLabel}
          </span>
        )}
        {weather.code != null && (
          <div style={{ filter: compact ? 'drop-shadow(0 1px 6px rgba(0,0,0,0.5))' : 'none' }}>
            <WeatherIcon code={weather.code} size={iconSize} />
          </div>
        )}
      </div>

      <div
        className="flex items-center gap-3 text-white/55 font-light"
        style={{ fontSize: compact ? 16 : 21, marginTop: 6, textShadow: shadow }}
      >
        {weather.code != null && <span>{getConditionLabel(weather.code)}</span>}
        {weather.feelsLike != null && (
          <>
            <span className="text-white/25">·</span>
            <span>
              {t.weather.feelsLike} {Math.round(weather.feelsLike)}
              {unitLabel}
            </span>
          </>
        )}
      </div>
    </div>
  );
}

// ─── Forecast ────────────────────────────────────────────────────────────────
// Day name, condition icon, high/low. Highs stay bright, lows recede — the
// pair reads as a range at a glance instead of two competing numbers.

const FORECAST_DAYS = 5;

function ScreensaverForecast({ compact = false }) {
  const daily = useStore((s) => s.weather.daily);
  const temperatureUnit = useStore((s) => s.settings.temperatureUnit) || 'celsius';

  const days = (daily || []).slice(0, FORECAST_DAYS);
  if (days.length === 0) return null;

  const unitLabel = temperatureUnit === 'celsius' ? t.weather.celsius : t.weather.fahrenheit;
  const rowFont = compact ? 20 : 26;
  const todayKey = toLocalDateKey(new Date());

  return (
    <div className="flex flex-col items-stretch w-full select-none" dir="rtl" style={{ maxWidth: compact ? 380 : 460 }}>
      <SectionHeading label={t.weather.forecast} />
      <div className="flex flex-col mt-3">
        {days.map((day) => {
          const isToday = day.date === todayKey;
          return (
            <div
              key={day.date}
              className="grid items-center"
              style={{
                gridTemplateColumns: 'minmax(0, 1fr) auto 64px 64px',
                columnGap: 14,
                paddingBlock: compact ? 5 : 8,
              }}
            >
              <span
                className={isToday ? 'text-white/85 font-medium' : 'text-white/55 font-light'}
                style={{ fontSize: rowFont }}
              >
                {isToday ? t.weather.today : day.dayName}
              </span>

              <WeatherIcon code={day.code} size={compact ? 26 : 32} />

              {/* High — the number people actually plan around */}
              <span
                className="text-white/90 text-center"
                style={{ fontFamily: "'DM Mono', monospace", fontSize: rowFont, fontWeight: 500 }}
              >
                {Math.round(day.high)}
                {unitLabel}
              </span>

              {/* Low — recedes so the pair reads as a range */}
              <span
                className="text-white/40 text-center font-light"
                style={{ fontFamily: "'DM Mono', monospace", fontSize: rowFont }}
              >
                {Math.round(day.low)}
                {unitLabel}
              </span>
            </div>
          );
        })}
      </div>
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

// ─── Daily phrase (המשפט היומי) ──────────────────────────────────────────────

function DailyPhrase({ compact = false }) {
  const phrase = useDailyPhrase();
  if (!phrase?.text) return null;

  return (
    <div
      className={`flex flex-col ${compact ? 'items-start' : 'items-center'} text-center max-w-[920px] px-10 select-none`}
      dir="rtl"
    >
      <p
        className="text-white/90 font-light leading-relaxed line-clamp-3"
        style={{
          fontSize: compact ? 28 : 42,
          textShadow: compact ? '0 1px 8px rgba(0,0,0,0.55)' : 'none',
        }}
      >
        {phrase.text}
      </p>

      {/* Attribution — set well below the quote so it reads as a footnote
          rather than a second line of the sentence itself. */}
      {phrase.source && (
        <p
          className="text-white/40 font-light line-clamp-1"
          style={{
            fontSize: compact ? 15 : 19,
            marginTop: compact ? 8 : 14,
            letterSpacing: '0.02em',
            textShadow: compact ? '0 1px 8px rgba(0,0,0,0.55)' : 'none',
          }}
        >
          — {phrase.source}
        </p>
      )}

      {/* Optional gloss, when the source supplies one */}
      {phrase.explanation && (
        <p
          className="text-white/30 font-light leading-snug line-clamp-2"
          style={{
            fontSize: compact ? 14 : 17,
            marginTop: 6,
            maxWidth: compact ? 480 : 720,
            textShadow: compact ? '0 1px 8px rgba(0,0,0,0.55)' : 'none',
          }}
        >
          {phrase.explanation}
        </p>
      )}
    </div>
  );
}

// ─── Now Playing (music keeps running behind the screensaver) ────────────────

const THUMB_FALLBACKS = ['maxresdefault', 'hqdefault', 'mqdefault', 'default'];

// How long a paused player lingers on the screensaver before hiding itself.
const PAUSED_GRACE_MS = 30_000;

function MusicNoteIcon({ className = 'w-6 h-6' }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
      strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden="true">
      <path d="M9 18V5l12-2v13" />
      <circle cx="6" cy="18" r="3" />
      <circle cx="18" cy="16" r="3" />
    </svg>
  );
}

function PlayIcon({ className = 'w-8 h-8' }) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" className={className} aria-hidden="true">
      <path d="M8 5.14v13.72a1 1 0 0 0 1.54.84l10.29-6.86a1 1 0 0 0 0-1.68L9.54 4.3A1 1 0 0 0 8 5.14z" />
    </svg>
  );
}

function PauseIcon({ className = 'w-8 h-8' }) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" className={className} aria-hidden="true">
      <rect x="6" y="4" width="4" height="16" rx="1.5" />
      <rect x="14" y="4" width="4" height="16" rx="1.5" />
    </svg>
  );
}

function SkipNextIcon({ className = 'w-6 h-6' }) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" className={className} aria-hidden="true">
      <path d="M6 5.14v13.72a1 1 0 0 0 1.54.84l9-6.86a1 1 0 0 0 0-1.68l-9-6.86A1 1 0 0 0 6 5.14z" />
      <rect x="17.5" y="4" width="2.5" height="16" rx="1.25" />
    </svg>
  );
}

function SkipPrevIcon({ className = 'w-6 h-6' }) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" className={className} aria-hidden="true">
      <path d="M18 5.14v13.72a1 1 0 0 1-1.54.84l-9-6.86a1 1 0 0 1 0-1.68l9-6.86A1 1 0 0 1 18 5.14z" />
      <rect x="4" y="4" width="2.5" height="16" rx="1.25" />
    </svg>
  );
}

function formatTrackTime(seconds) {
  const s = Math.max(0, Math.floor(Number(seconds) || 0));
  const m = Math.floor(s / 60);
  return `${m}:${String(s % 60).padStart(2, '0')}`;
}

/** Album art with progressive YouTube thumbnail fallback. */
function NowPlayingArt({ track, size }) {
  const [level, setLevel] = useState(track?.imageUrl ? -1 : 0);

  useEffect(() => {
    setLevel(track?.imageUrl ? -1 : 0);
  }, [track?.id, track?.imageUrl]);

  const src = level < 0
    ? track?.imageUrl
    : (track?.id ? `https://i.ytimg.com/vi/${track.id}/${THUMB_FALLBACKS[level] || 'default'}.jpg` : null);

  const common = {
    width: size,
    height: size,
    borderRadius: size >= 96 ? 20 : 16,
  };

  if (!src || level >= THUMB_FALLBACKS.length) {
    return (
      <div
        className="shrink-0 flex items-center justify-center overflow-hidden"
        style={{ ...common, background: 'linear-gradient(135deg, #6b62e0 0%, #2ab58a 100%)' }}
      >
        <MusicNoteIcon className="w-8 h-8 text-white/60" />
      </div>
    );
  }

  return (
    <div
      className="shrink-0 overflow-hidden bg-white/10"
      style={{ ...common, boxShadow: '0 8px 28px rgba(0,0,0,0.55)' }}
    >
      <img
        src={src}
        alt=""
        draggable={false}
        referrerPolicy="no-referrer"
        className="w-full h-full object-cover"
        onError={() => setLevel((l) => (l < 0 ? 0 : l + 1))}
      />
    </div>
  );
}

/** Animated bars shown while audio is actually playing. Purely decorative —
 *  the play/pause button icon carries the same state non-visually. */
function EqualizerBars() {
  return (
    <span className="flex items-end gap-[3px] h-4" aria-hidden="true">
      {[0, 160, 320, 90].map((delay, i) => (
        <span
          key={i}
          className="screensaver-eq-bar w-[3px] h-full rounded-full bg-white/70"
          style={{ animationDelay: `${delay}ms` }}
        />
      ))}
    </span>
  );
}

function NowPlayingButton({ onPress, label, primary = false, children }) {
  const size = primary ? 76 : 60;
  return (
    <button
      type="button"
      aria-label={label}
      onClick={() => onPress?.()}
      className={`flex items-center justify-center rounded-full shrink-0
                  active:scale-90 transition-all duration-[var(--dur-fast)]
                  focus-visible:outline focus-visible:outline-2 focus-visible:outline-white
                  ${primary
                    ? 'bg-white text-[#12121a] hover:bg-white/90'
                    : 'bg-white/15 text-white hover:bg-white/25'}`}
      style={{ width: size, height: size }}
    >
      {children}
    </button>
  );
}

/**
 * True once the player has been paused for `graceMs` without resuming.
 *
 * The screensaver should carry the player only while music is actually
 * running; a paused card is just clutter on an idle mirror. The grace period
 * avoids flicker when skipping tracks or scrubbing, which pause briefly.
 */
function usePausedTooLong(isPlaying, hasTrack, graceMs = PAUSED_GRACE_MS) {
  const [tooLong, setTooLong] = useState(false);

  useEffect(() => {
    if (!hasTrack || isPlaying) {
      setTooLong(false);
      return undefined;
    }
    const id = setTimeout(() => setTooLong(true), graceMs);
    return () => clearTimeout(id);
  }, [isPlaying, hasTrack, graceMs]);

  return tooLong;
}

/**
 * Now-playing panel for the screensaver. The YouTube iframe lives in
 * MusicProvider at the app root and is never unmounted, so audio keeps
 * playing while the screensaver is up — this surfaces the track and its
 * transport controls without waking the display.
 *
 * The panel is marked interactive so that touching it neither dismisses the
 * screensaver nor resets the idle timer; only touches *outside* it wake the
 * display. See `isScreensaverInteractive`.
 */
function ScreensaverNowPlaying({ compact = false }) {
  const { currentTrack, isPlaying, position, duration, playPause, next, previous } =
    useMusicContext();

  // Hooks must run before any early return.
  const pausedTooLong = usePausedTooLong(isPlaying, Boolean(currentTrack));

  // Only present while music is genuinely running — a track that has been
  // sitting paused is not worth screen space on an idle mirror.
  if (!currentTrack || pausedTooLong) return null;

  const artSize = compact ? 72 : 104;
  const total = duration || currentTrack.durationSeconds || 0;
  const progress = total > 0 ? Math.min(100, (position / total) * 100) : 0;

  return (
    <div
      dir="rtl"
      {...{ [SCREENSAVER_INTERACTIVE_ATTR]: '' }}
      className={`flex items-center gap-5 rounded-3xl border border-white/10 bg-white/[0.08]
                  ${compact ? 'p-4 max-w-[620px]' : 'p-5 w-[720px]'}`}
      style={{
        backdropFilter: 'blur(24px)',
        WebkitBackdropFilter: 'blur(24px)',
        boxShadow: '0 12px 40px rgba(0,0,0,0.45)',
        cursor: 'default',
      }}
    >
      <NowPlayingArt track={currentTrack} size={artSize} />

      <div className="flex-1 min-w-0 flex flex-col gap-2">
        <div className="flex items-center gap-2 text-white/55">
          {isPlaying ? <EqualizerBars /> : <MusicNoteIcon className="w-4 h-4" />}
          <span className="text-xs font-medium tracking-wide">{t.music.nowPlaying}</span>
        </div>

        <h3
          className={`text-white font-semibold leading-tight truncate ${compact ? 'text-lg' : 'text-2xl'}`}
        >
          {currentTrack.title}
        </h3>
        {currentTrack.artist && (
          <p className={`text-white/60 truncate ${compact ? 'text-sm' : 'text-base'}`}>
            {currentTrack.artist}
          </p>
        )}

        {total > 0 && (
          <div className="flex items-center gap-3 mt-1" dir="ltr">
            <span
              className="text-[11px] text-white/55 tabular-nums w-9 text-right"
              style={{ fontFamily: "'DM Mono', monospace" }}
            >
              {formatTrackTime(position)}
            </span>
            <div
              className="flex-1 h-1.5 rounded-full bg-white/20 overflow-hidden"
              role="progressbar"
              aria-valuemin={0}
              aria-valuemax={Math.round(total)}
              aria-valuenow={Math.round(position)}
            >
              <div
                className="h-full rounded-full bg-white"
                style={{ width: `${progress}%`, transition: 'width 1s linear' }}
              />
            </div>
            <span
              className="text-[11px] text-white/55 tabular-nums w-9"
              style={{ fontFamily: "'DM Mono', monospace" }}
            >
              {formatTrackTime(total)}
            </span>
          </div>
        )}
      </div>

      {/* dir=ltr: transport controls keep their universal physical order */}
      <div className="flex items-center gap-3 shrink-0" dir="ltr">
        <NowPlayingButton onPress={previous} label={t.music.prev}>
          <SkipPrevIcon className="w-6 h-6" />
        </NowPlayingButton>
        <NowPlayingButton
          onPress={playPause}
          primary
          label={isPlaying ? t.music.pause : t.music.play}
        >
          {isPlaying ? <PauseIcon className="w-8 h-8" /> : <PlayIcon className="w-8 h-8" />}
        </NowPlayingButton>
        <NowPlayingButton onPress={next} label={t.music.next}>
          <SkipNextIcon className="w-6 h-6" />
        </NowPlayingButton>
      </div>
    </div>
  );
}

// ─── Section heading ─────────────────────────────────────────────────────────
// Letterspaced label with a hairline rule running to the far edge. Gives every
// panel the same entry point so the eye can scan regions instead of hunting.

function SectionHeading({ label }) {
  return (
    <div className="flex items-center gap-3 w-full" dir="rtl">
      <span
        className="text-white/45 font-semibold shrink-0"
        style={{ fontSize: 13, letterSpacing: '0.14em' }}
      >
        {label}
      </span>
      <span className="h-px flex-1 bg-white/[0.14]" />
    </div>
  );
}

// ─── Upcoming agenda (glanceable, from across the room) ──────────────────────

const SOON_MINUTES = 4 * 60;   // "coming up" window the user asked for
const IMMINENT_MINUTES = 30;   // must not be missed
const MAX_ROWS = 3;

/** Urgency tier drives size + opacity so distance reads as importance. */
const TIER_STYLE = {
  imminent: { title: 38, weight: 700, opacity: 0.95, hour: 40, hourWeight: 700 },
  soon:     { title: 32, weight: 600, opacity: 0.78, hour: 34, hourWeight: 500 },
  later:    { title: 28, weight: 500, opacity: 0.60, hour: 30, hourWeight: 400 },
};

function StarIcon({ className = 'w-5 h-5', style }) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" className={className} style={style} aria-hidden="true">
      <path d="M12 2.5l2.9 5.9 6.5.95-4.7 4.58 1.11 6.47L12 17.35 6.19 20.4 7.3 13.93 2.6 9.35l6.5-.95L12 2.5z" />
    </svg>
  );
}

/**
 * Builds the screensaver's agenda list: today's remaining calendar events
 * plus today's open tasks. Both hooks already poll and dedupe on their own,
 * so this adds no new fetching machinery.
 *
 * `now` is the caller's ticking clock, so tiers re-evaluate every second and
 * the day range rolls over correctly if the screensaver stays up past
 * midnight.
 */
function useAgendaItems(now) {
  const dayKey = toLocalDateKey(now);

  const { dayStart, dayEnd } = useMemo(() => {
    const start = new Date(now);
    start.setHours(0, 0, 0, 0);
    const end = new Date(start);
    end.setHours(23, 59, 59, 999);
    return { dayStart: start, dayEnd: end };
    // Recomputed only when the calendar day changes, not every tick —
    // otherwise useCalendar would refetch once a second.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dayKey]);

  const { events } = useCalendar(dayStart, dayEnd);
  const { tasks } = useTasks();

  return useMemo(() => {
    const items = [];

    for (const ev of events || []) {
      const isAllDay = ev.allDay || /^\d{4}-\d{2}-\d{2}$/.test(String(ev.start || ''));
      if (isAllDay) {
        if (!eventFallsOnDay(ev, now)) continue;
        items.push({ id: `ev-${ev.id}`, kind: 'allDay', title: ev.title, color: ev.color, sort: 1 });
        continue;
      }
      const start = new Date(ev.start);
      // Events without an explicit end would otherwise vanish the instant they
      // start; give them a nominal hour so they stay visible while running.
      const end = ev.end ? new Date(ev.end) : new Date(start.getTime() + 60 * 60 * 1000);
      // Keep an event while it's still running, drop it once it's over.
      if (end < now || toLocalDateKey(start) !== dayKey) continue;
      items.push({
        id: `ev-${ev.id}`,
        kind: 'timed',
        title: ev.title,
        color: ev.color,
        start,
        minutesAway: Math.round((start - now) / 60000),
        sort: 0,
        sortTime: start.getTime(),
      });
    }

    for (const task of tasks || []) {
      if (task.status === 'done' || task.dueDate !== dayKey) continue;
      items.push({
        id: `task-${task.id}`,
        kind: 'task',
        title: task.title,
        urgent: Boolean(task.starred) || task.priority === 'high',
        starred: Boolean(task.starred),
        sort: 2,
      });
    }

    items.sort((a, b) => (a.sort - b.sort) || ((a.sortTime || 0) - (b.sortTime || 0)));

    // Tier each item, then let only the single closest one carry the pill.
    let pillAssigned = false;
    const tiered = items.map((item) => {
      let tier = 'later';
      if (item.kind === 'timed') {
        if (item.minutesAway <= IMMINENT_MINUTES) tier = 'imminent';
        else if (item.minutesAway <= SOON_MINUTES) tier = 'soon';
      } else if (item.kind === 'task' && item.urgent) {
        tier = 'imminent';
      }
      const showPill = !pillAssigned && tier === 'imminent';
      if (showPill) pillAssigned = true;
      return { ...item, tier, showPill };
    });

    // Render one row past the cap so the overflow can dissolve visually
    // rather than being announced with a counter.
    return {
      visible: tiered.slice(0, MAX_ROWS + 1),
      hasMore: tiered.length > MAX_ROWS,
    };
  }, [events, tasks, dayKey, now]);
}

/** What goes in the time column for items that have no clock time. */
function timeSlotLabel(item) {
  if (item.kind === 'timed') {
    return `${String(item.start.getHours()).padStart(2, '0')}:${String(item.start.getMinutes()).padStart(2, '0')}`;
  }
  if (item.kind === 'allDay') return t.screensaver.allDay;
  return item.urgent ? t.screensaver.urgent : t.screensaver.today;
}

/**
 * One agenda line. Deliberately plain — no chrome, no card. Title reads from
 * the right, time sits in a fixed column at the far edge so the times form a
 * clean vertical rule instead of ragging along the ends of the titles.
 */
function AgendaRow({ item, compact }) {
  const style = TIER_STYLE[item.tier];
  const isClockTime = item.kind === 'timed';
  const scale = compact ? 0.8 : 1;

  const timeText = item.showPill && item.kind === 'timed'
    ? (item.minutesAway <= 0
        ? t.screensaver.now
        : t.screensaver.inMinutes.replace('{n}', String(item.minutesAway)))
    : timeSlotLabel(item);

  return (
    <div
      className="grid items-baseline"
      style={{
        gridTemplateColumns: 'minmax(0, 1fr) auto',
        columnGap: 24,
        paddingBlock: compact ? 5 : 8,
      }}
    >
      <span className="flex items-baseline gap-2.5 min-w-0">
        {item.starred && (
          <StarIcon
            className="shrink-0"
            style={{
              opacity: style.opacity,
              width: Math.round(style.title * scale * 0.62),
              height: Math.round(style.title * scale * 0.62),
              alignSelf: 'center',
            }}
          />
        )}
        <span
          className="truncate text-white"
          style={{
            opacity: style.opacity,
            fontSize: Math.round(style.title * scale),
            fontWeight: style.weight,
            lineHeight: 1.25,
          }}
        >
          {item.title}
        </span>
      </span>

      {/* Time column — recedes, mirroring the muted date column in a
          classic mirror agenda. The imminent item swaps in a live countdown
          and takes the accent, so urgency is carried by text, not colour. */}
      <span
        className="shrink-0 text-end tabular-nums whitespace-nowrap"
        style={{
          color: item.showPill ? 'var(--acc2, #3dd9a0)' : 'rgba(255,255,255,0.5)',
          fontSize: Math.round((isClockTime ? style.hour : style.hour * 0.78) * scale),
          fontWeight: item.showPill ? 600 : style.hourWeight,
          fontFamily: isClockTime && !item.showPill ? "'DM Mono', monospace" : 'inherit',
          lineHeight: 1.25,
        }}
      >
        {timeText}
      </span>
    </div>
  );
}

/**
 * Glanceable agenda list. Renders nothing when there's nothing left today,
 * so a free evening leaves clean space rather than an empty frame.
 */
function ScreensaverAgenda({ now, compact = false }) {
  const { visible, hasMore } = useAgendaItems(now);
  if (visible.length === 0) return null;

  // Dissolve the trailing row instead of printing "+2 more" — the fade reads
  // as "there is more" at a glance without adding another line to parse.
  const fadeMask = hasMore
    ? 'linear-gradient(to bottom, #000 0%, #000 62%, transparent 100%)'
    : undefined;

  return (
    <div
      dir="rtl"
      className="w-full select-none"
      style={{ maxWidth: compact ? 520 : 660 }}
    >
      <SectionHeading label={t.screensaver.upNext} />
      <div
        className="flex flex-col mt-3"
        style={{ maskImage: fadeMask, WebkitMaskImage: fadeMask }}
      >
        {visible.map((item) => (
          <AgendaRow key={item.id} item={item} compact={compact} />
        ))}
      </div>
    </div>
  );
}

// ─── News ticker ─────────────────────────────────────────────────────────────
// Bottom bar, one headline at a time with its source and age. Rotates slowly
// so a passer-by can finish reading a line before it changes.

const NEWS_ROTATE_MS = 14000;
const NEWS_FADE_MS = 500;
const NEWS_POOL = 8;

function relativeTimeHe(iso, now) {
  const published = new Date(iso).getTime();
  if (!Number.isFinite(published)) return null;

  const minutes = Math.round((now - published) / 60000);
  if (minutes < 1) return t.screensaver.justNow;
  if (minutes < 60) return t.screensaver.minutesAgo.replace('{n}', String(minutes));

  const hours = Math.round(minutes / 60);
  if (hours === 1) return t.screensaver.hourAgo;
  if (hours < 24) return t.screensaver.hoursAgo.replace('{n}', String(hours));

  const days = Math.round(hours / 24);
  return days === 1 ? t.screensaver.dayAgo : t.screensaver.daysAgo.replace('{n}', String(days));
}

function ScreensaverNews({ now, compact = false }) {
  const { articles } = useNews();
  const [index, setIndex] = useState(0);
  const [shown, setShown] = useState(true);

  const items = useMemo(() => (articles || []).slice(0, NEWS_POOL), [articles]);
  const count = items.length;

  useEffect(() => {
    if (count <= 1) return undefined;
    let fadeTimer;
    const rotate = setInterval(() => {
      setShown(false);
      fadeTimer = setTimeout(() => {
        setIndex((i) => i + 1);
        setShown(true);
      }, NEWS_FADE_MS);
    }, NEWS_ROTATE_MS);
    return () => {
      clearInterval(rotate);
      clearTimeout(fadeTimer);
    };
  }, [count]);

  if (count === 0) return null;

  // Modulo at read time so a shrinking feed can never index out of bounds.
  const article = items[index % count];
  const age = article.publishedAt ? relativeTimeHe(article.publishedAt, now.getTime()) : null;
  const byline = [article.source, age].filter(Boolean).join(', ');

  return (
    <div
      dir="rtl"
      className="flex flex-col items-center text-center gap-1.5 w-full select-none"
      style={{
        opacity: shown ? 1 : 0,
        transition: `opacity ${NEWS_FADE_MS}ms ease`,
      }}
    >
      {byline && (
        <span className="text-white/40 font-light" style={{ fontSize: compact ? 13 : 15 }}>
          {byline}
        </span>
      )}
      <p
        className="text-white/85 font-light leading-snug max-w-[1200px] line-clamp-2"
        style={{
          fontSize: compact ? 22 : 28,
          textShadow: compact ? '0 1px 8px rgba(0,0,0,0.55)' : 'none',
        }}
      >
        {article.title}
      </p>
    </div>
  );
}

// ─── Region template ─────────────────────────────────────────────────────────
// Every screensaver element is placed into a named region rather than stacked
// in one column, so both modes share one alignment system and nothing collides.
// The frame is RTL, so grid column 1 is the RIGHT edge of the screen.

function ScreensaverFrame({ background, topStart, topEnd, center, playerBar, bottomBar }) {
  return (
    <div dir="rtl" className="relative w-full h-full overflow-hidden select-none">
      {background}
      <div
        className="relative w-full h-full"
        style={{
          display: 'grid',
          gridTemplateColumns: 'minmax(0, 1fr) minmax(0, 1fr)',
          gridTemplateRows: 'auto minmax(0, 1fr) auto auto',
          columnGap: 56,
          rowGap: 28,
          padding: '48px 56px',
          zIndex: 2,
        }}
      >
        <div className="flex flex-col items-start gap-5 min-w-0" style={{ gridColumn: 1, gridRow: 1 }}>
          {topStart}
        </div>
        <div className="flex flex-col items-end gap-4 min-w-0" style={{ gridColumn: 2, gridRow: 1 }}>
          {topEnd}
        </div>
        <div
          className="flex flex-col items-center justify-center min-w-0 min-h-0 overflow-hidden"
          style={{ gridColumn: '1 / 3', gridRow: 2 }}
        >
          {center}
        </div>
        <div
          className="flex items-end justify-center min-w-0"
          style={{ gridColumn: '1 / 3', gridRow: 3 }}
        >
          {playerBar}
        </div>
        <div className="min-w-0" style={{ gridColumn: '1 / 3', gridRow: 4 }}>
          {bottomBar}
        </div>
      </div>
    </div>
  );
}

// ─── Clock block (time + both calendars) ─────────────────────────────────────

function ScreensaverClock({ time, compact = false }) {
  const { hh, mm, ss } = formatClockTime(time);
  const gregorian = formatGregorianDate(time);
  const hebrew = getHebrewDateParts(time).full;
  const shadow = compact ? '0 2px 12px rgba(0,0,0,0.6)' : 'none';

  return (
    <div className="flex flex-col items-start" dir="rtl">
      <div
        className={compact ? '' : 'screensaver-clock-breathing'}
        style={{
          fontFamily: "'DM Mono', monospace",
          fontSize: compact ? 64 : 120,
          fontWeight: 300,
          color: '#ffffff',
          letterSpacing: '0.05em',
          lineHeight: 1,
          textShadow: shadow,
        }}
      >
        <span>{hh}</span>
        <span style={{ opacity: 0.6 }}>:</span>
        <span>{mm}</span>
        {!compact && (
          <span style={{ fontSize: 60, opacity: 0.4, marginInlineStart: 24 }}>{ss}</span>
        )}
      </div>

      <p
        className="text-white/55 font-light"
        style={{ fontSize: compact ? 16 : 22, marginTop: compact ? 10 : 16, textShadow: shadow }}
      >
        {gregorian}
      </p>

      {/* Hebrew calendar date + year, subordinate to the Gregorian line */}
      {hebrew && (
        <p
          className="text-white/35 font-light"
          style={{ fontSize: compact ? 14 : 19, marginTop: 4, textShadow: shadow }}
        >
          {hebrew}
        </p>
      )}
    </div>
  );
}

// ─── Clock Mode ──────────────────────────────────────────────────────────────

function ClockMode() {
  const time = useClock();

  return (
    <ScreensaverFrame
      topStart={
        <>
          <ScreensaverClock time={time} />
          <ScreensaverAgenda now={time} />
        </>
      }
      topEnd={
        <>
          <ScreensaverWeather />
          <ScreensaverShabbat date={time} />
          <ScreensaverForecast />
        </>
      }
      center={<DailyPhrase />}
      playerBar={<ScreensaverNowPlaying />}
      bottomBar={<ScreensaverNews now={time} />}
    />
  );
}

// ─── Slideshow Mode ──────────────────────────────────────────────────────────

function SlideshowMode() {
  const time = useClock();

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
        setCurrentSlide((prev) => (prev + 1) % SLIDESHOW_GRADIENTS.length);
        setNextSlide((prev) => (prev + 1) % SLIDESHOW_GRADIENTS.length);
        setTransitioning(false);
      }, CROSSFADE_DURATION);
    }, SLIDE_DURATION);

    return () => {
      if (slideTimerRef.current) clearInterval(slideTimerRef.current);
    };
  }, []);

  const background = (
    <>
      <div
        className="absolute inset-0 kenburns-1"
        style={{
          background: SLIDESHOW_GRADIENTS[currentSlide],
          opacity: transitioning ? 0 : 1,
          transition: `opacity ${CROSSFADE_DURATION}ms ease`,
          willChange: 'transform',
        }}
      />
      <div
        className="absolute inset-0 kenburns-2"
        style={{
          background: SLIDESHOW_GRADIENTS[nextSlide],
          opacity: transitioning ? 1 : 0,
          transition: `opacity ${CROSSFADE_DURATION}ms ease`,
          willChange: 'transform',
        }}
      />
      {/* Scrim — keeps text legible over whatever the photo happens to be */}
      <div
        className="absolute inset-0"
        style={{
          background:
            'linear-gradient(to bottom, rgba(0,0,0,0.55) 0%, rgba(0,0,0,0.15) 40%, rgba(0,0,0,0.65) 100%)',
        }}
      />
    </>
  );

  return (
    <ScreensaverFrame
      background={background}
      topStart={
        <>
          <ScreensaverClock time={time} compact />
          <ScreensaverAgenda now={time} compact />
        </>
      }
      topEnd={
        <>
          <ScreensaverWeather compact />
          <ScreensaverShabbat date={time} />
          <ScreensaverForecast compact />
        </>
      }
      center={<DailyPhrase />}
      playerBar={<ScreensaverNowPlaying compact />}
      bottomBar={<ScreensaverNews now={time} compact />}
    />
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

  // Dismiss on any touch/click/key — except interactions with the
  // screensaver's own controls (the now-playing transport).
  useEffect(() => {
    const dismiss = (e) => {
      if (isScreensaverInteractive(e?.target)) return;
      handleDismiss();
    };

    // Small delay to prevent immediate dismissal from the same event
    // that might have triggered idle state
    const timer = setTimeout(() => {
      window.addEventListener('touchstart', dismiss);
      window.addEventListener('mousedown', dismiss);
      window.addEventListener('keydown', dismiss);
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
