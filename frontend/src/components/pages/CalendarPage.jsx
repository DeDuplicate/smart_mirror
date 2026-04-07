import { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import t from '../../i18n/he.json';
import useStore from '../../store/index.js';
import useCalendar, {
  getWeekStart,
  getWeekEnd,
  CALENDAR_COLORS,
} from '../../hooks/useCalendar.js';
import { CalendarSkeleton } from '../Skeleton.jsx';

// ─── Constants ──────────────────────────────────────────────────────────────

const HOUR_START = 7;
const HOUR_END = 22;
const TOTAL_HOURS = HOUR_END - HOUR_START;
const HOUR_HEIGHT = 56; // px per hour slot (min event height)
const GRID_HEIGHT = TOTAL_HOURS * HOUR_HEIGHT;

const ALL_DAYS = t.topBar.days;         // 7 items: ראשון..שבת
const WORK_DAYS = ALL_DAYS.slice(0, 5); // ראשון..חמישי

// ─── SVG Icons ──────────────────────────────────────────────────────────────

function ChevronRight({ className = 'w-5 h-5' }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
      strokeLinecap="round" strokeLinejoin="round" className={className}>
      <polyline points="9 18 15 12 9 6" />
    </svg>
  );
}

function ChevronLeft({ className = 'w-5 h-5' }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
      strokeLinecap="round" strokeLinejoin="round" className={className}>
      <polyline points="15 18 9 12 15 6" />
    </svg>
  );
}

function LocationIcon({ className = 'w-3.5 h-3.5' }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
      strokeLinecap="round" strokeLinejoin="round" className={className}>
      <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z" />
      <circle cx="12" cy="10" r="3" />
    </svg>
  );
}

function CloseIcon({ className = 'w-5 h-5' }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
      strokeLinecap="round" strokeLinejoin="round" className={className}>
      <line x1="18" y1="6" x2="6" y2="18" />
      <line x1="6" y1="6" x2="18" y2="18" />
    </svg>
  );
}

function UsersIcon({ className = 'w-4 h-4' }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
      strokeLinecap="round" strokeLinejoin="round" className={className}>
      <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
      <circle cx="9" cy="7" r="4" />
      <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
      <path d="M16 3.13a4 4 0 0 1 0 7.75" />
    </svg>
  );
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function isSameDay(a, b) {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

function isToday(date) {
  return isSameDay(date, new Date());
}

/** Format time as HH:MM for display. */
function formatTime(isoString) {
  const d = new Date(isoString);
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  return `${hh}:${mm}`;
}

/** Calculate top offset and height for a timed event within the grid. */
function getEventPosition(event) {
  const start = new Date(event.start);
  const end = new Date(event.end);

  const startHour = start.getHours() + start.getMinutes() / 60;
  const endHour = end.getHours() + end.getMinutes() / 60;

  const clampedStart = Math.max(startHour, HOUR_START);
  const clampedEnd = Math.min(endHour, HOUR_END);

  const top = (clampedStart - HOUR_START) * HOUR_HEIGHT;
  const height = Math.max((clampedEnd - clampedStart) * HOUR_HEIGHT, HOUR_HEIGHT);

  return { top, height };
}

/** Get the day-of-week index (0=Sun) from an event start. */
function getEventDayIndex(event) {
  return new Date(event.start).getDay();
}

/** Get color style object for an event. */
function getColorStyle(colorKey) {
  return CALENDAR_COLORS[colorKey] || CALENDAR_COLORS.mint;
}

/** Generate the array of Date objects for each day column in the week. */
function getWeekDays(weekStart, showWeekend) {
  const count = showWeekend ? 7 : 5;
  return Array.from({ length: count }, (_, i) => {
    const d = new Date(weekStart);
    d.setDate(d.getDate() + i);
    return d;
  });
}

// ─── Overlap Layout ─────────────────────────────────────────────────────────

/**
 * Given an array of timed events for a single day, compute overlap groups.
 * Returns a Map: eventId -> { index, total } where index is 0-based column,
 * and total is the number of columns in the overlap group.
 */
function computeOverlapLayout(events) {
  if (events.length === 0) return new Map();

  // Sort by start time, then by duration (longer first)
  const sorted = [...events].sort((a, b) => {
    const diff = new Date(a.start) - new Date(b.start);
    if (diff !== 0) return diff;
    return (new Date(b.end) - new Date(b.start)) - (new Date(a.end) - new Date(a.start));
  });

  const layout = new Map();
  const groups = []; // Each group: { events: [...], end: latestEnd }

  for (const ev of sorted) {
    const evStart = new Date(ev.start);
    const evEnd = new Date(ev.end);

    // Find an existing group this event overlaps with
    let placed = false;
    for (const group of groups) {
      if (evStart < group.end) {
        // Overlaps with this group
        group.events.push(ev);
        if (evEnd > group.end) group.end = evEnd;
        placed = true;
        break;
      }
    }

    if (!placed) {
      groups.push({ events: [ev], end: evEnd });
    }
  }

  // Assign columns within each group
  for (const group of groups) {
    const total = group.events.length;
    group.events.forEach((ev, idx) => {
      layout.set(ev.id, { index: idx, total });
    });
  }

  return layout;
}

// ─── Event Detail Popup ─────────────────────────────────────────────────────

function EventDetailPopup({ event, onClose, anchorRect }) {
  const popupRef = useRef(null);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    // Trigger entrance animation
    requestAnimationFrame(() => setVisible(true));
  }, []);

  // Close on click outside
  useEffect(() => {
    function handleClick(e) {
      if (popupRef.current && !popupRef.current.contains(e.target)) {
        handleClose();
      }
    }
    document.addEventListener('mousedown', handleClick);
    document.addEventListener('touchstart', handleClick);
    return () => {
      document.removeEventListener('mousedown', handleClick);
      document.removeEventListener('touchstart', handleClick);
    };
  }, []);

  function handleClose() {
    setVisible(false);
    setTimeout(onClose, 200);
  }

  const color = getColorStyle(event.color);
  const hasLocation = event.location && event.location.trim().length > 0;
  const hasDescription = event.description && event.description.trim().length > 0;
  const hasAttendees = event.attendees && event.attendees.length > 0;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center"
      style={{ backgroundColor: visible ? 'rgba(0,0,0,0.25)' : 'transparent', transition: 'background-color 200ms' }}>
      <div
        ref={popupRef}
        className="bg-surf rounded-2xl shadow-xl border border-bd w-[380px] max-h-[520px] overflow-y-auto"
        style={{
          transform: visible ? 'scale(1) translateY(0)' : 'scale(0.92) translateY(12px)',
          opacity: visible ? 1 : 0,
          transition: 'transform var(--dur-normal) var(--ease-out), opacity var(--dur-normal) var(--ease-out)',
        }}
      >
        {/* Color accent bar */}
        <div className="h-2 rounded-t-2xl" style={{ backgroundColor: color.border }} />

        <div className="p-5 flex flex-col gap-4">
          {/* Title + calendar */}
          <div className="flex items-start gap-3">
            <div
              className="w-3 h-3 rounded-full mt-1.5 shrink-0"
              style={{ backgroundColor: color.dot }}
            />
            <div className="flex-1 min-w-0">
              <h3 className="text-lg font-semibold text-tp leading-snug">{event.title}</h3>
              <span className="text-xs text-ts">{event.calendar}</span>
            </div>
          </div>

          {/* Time */}
          <div className="flex items-center gap-2">
            <span className="font-mono text-sm text-tp" style={{ fontFamily: "'DM Mono', monospace" }}>
              {event.allDay
                ? t.calendar.allDay
                : `${formatTime(event.start)} — ${formatTime(event.end)}`}
            </span>
          </div>

          {/* Location */}
          {hasLocation && (
            <div className="flex items-center gap-2 text-ts">
              <LocationIcon className="w-4 h-4 shrink-0" />
              <span className="text-sm">{event.location}</span>
            </div>
          )}

          {/* Description */}
          {hasDescription && (
            <div className="text-sm text-ts leading-relaxed border-t border-bd pt-3">
              <span className="text-xs font-semibold text-tm block mb-1">{t.calendar.description}</span>
              {event.description}
            </div>
          )}

          {/* Attendees */}
          {hasAttendees && (
            <div className="border-t border-bd pt-3">
              <div className="flex items-center gap-2 mb-2">
                <UsersIcon className="w-4 h-4 text-ts" />
                <span className="text-xs font-semibold text-tm">{t.calendar.attendees}</span>
              </div>
              <div className="flex flex-wrap gap-2">
                {event.attendees.map((name, i) => (
                  <span key={i} className="text-xs bg-s2 text-ts rounded-full px-3 py-1">
                    {name}
                  </span>
                ))}
              </div>
            </div>
          )}

          {/* Close button */}
          <button
            onClick={handleClose}
            className="ripple mt-1 self-center flex items-center gap-2 px-5 py-2.5 rounded-xl
                       bg-s2 text-ts text-sm font-medium hover:bg-bd
                       active:scale-95 transition-all duration-[var(--dur-fast)]"
          >
            <CloseIcon className="w-4 h-4" />
            {t.calendar.close}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Event Block (timed) ────────────────────────────────────────────────────

function EventBlock({ event, style, onTap }) {
  const color = getColorStyle(event.color);
  const hasLocation = event.location && event.location.trim().length > 0;

  return (
    <button
      onClick={(e) => {
        e.stopPropagation();
        onTap(event, e.currentTarget.getBoundingClientRect());
      }}
      className="absolute rounded-xl overflow-hidden text-start cursor-pointer
                 hover:brightness-95 active:scale-[0.98] transition-transform duration-[var(--dur-fast)]
                 flex flex-col justify-start p-2.5 gap-0.5"
      style={{
        ...style,
        direction: 'rtl', /* Text inside events is RTL */
        backgroundColor: color.bg,
        borderRight: `4px solid ${color.border}`,
        minHeight: `${HOUR_HEIGHT}px`,
      }}
    >
      <span
        className="text-xs font-semibold leading-tight line-clamp-2"
        style={{ color: color.text }}
      >
        {event.title}
      </span>
      <span
        className="text-[11px] opacity-80"
        style={{ color: color.text, fontFamily: "'DM Mono', monospace" }}
      >
        {formatTime(event.start)}
      </span>
      {hasLocation && (
        <span className="flex items-center gap-1 text-[10px] opacity-70 mt-auto"
          style={{ color: color.text }}>
          <LocationIcon className="w-3 h-3" />
          <span className="truncate">{event.location}</span>
        </span>
      )}
    </button>
  );
}

// ─── All-Day / Multi-Day Pill ───────────────────────────────────────────────

function AllDayPill({ event, span = 1, startCol, onTap }) {
  const color = getColorStyle(event.color);

  return (
    <button
      onClick={(e) => {
        e.stopPropagation();
        onTap(event, e.currentTarget.getBoundingClientRect());
      }}
      className="rounded-lg px-3 py-1.5 text-xs font-medium truncate cursor-pointer
                 hover:brightness-95 active:scale-[0.98] transition-transform duration-[var(--dur-fast)]"
      style={{
        direction: 'rtl',
        backgroundColor: color.bg,
        color: color.text,
        borderRight: `3px solid ${color.border}`,
        gridColumn: `${startCol} / span ${span}`,
      }}
    >
      {event.title}
    </button>
  );
}

// ─── Upcoming Sidebar Card ──────────────────────────────────────────────────

function UpcomingCard({ event, onTap }) {
  const color = getColorStyle(event.color);

  return (
    <button
      onClick={(e) => onTap(event, e.currentTarget.getBoundingClientRect())}
      className="w-full flex items-start gap-3 p-3.5 rounded-xl bg-bg hover:bg-s2
                 active:scale-[0.98] transition-all duration-[var(--dur-fast)] cursor-pointer text-start"
    >
      <div
        className="w-2.5 h-2.5 rounded-full mt-1.5 shrink-0"
        style={{ backgroundColor: color.dot }}
      />
      <div className="flex-1 min-w-0">
        <span className="text-sm font-medium text-tp block truncate">{event.title}</span>
        <span
          className="text-xs text-ts block mt-0.5"
          style={{ fontFamily: "'DM Mono', monospace" }}
        >
          {event.allDay ? t.calendar.allDay : formatTime(event.start)}
        </span>
        <span className="text-[11px] text-tm block mt-0.5">{event.calendar}</span>
      </div>
    </button>
  );
}

// ─── CalendarPage ───────────────────────────────────────────────────────────

export default function CalendarPage() {
  const showWeekend = useStore((s) => s.settings.showWeekend);

  // ── Week navigation state ──
  const [currentWeekStart, setCurrentWeekStart] = useState(() => getWeekStart(new Date()));
  const [slideDir, setSlideDir] = useState(null); // 'left' | 'right' | null
  const [animating, setAnimating] = useState(false);

  // ── Data ──
  const { events, loading } = useCalendar(currentWeekStart);

  // ── Popup state ──
  const [selectedEvent, setSelectedEvent] = useState(null);

  // ── Week days ──
  const dayColumns = useMemo(
    () => getWeekDays(currentWeekStart, showWeekend),
    [currentWeekStart, showWeekend]
  );

  const colCount = showWeekend ? 7 : 5;
  const dayNames = showWeekend ? ALL_DAYS : WORK_DAYS;

  // ── Navigation ──
  const goNextWeek = useCallback(() => {
    if (animating) return;
    setSlideDir('left');
    setAnimating(true);
    setTimeout(() => {
      setCurrentWeekStart((prev) => {
        const next = new Date(prev);
        next.setDate(next.getDate() + 7);
        return next;
      });
      setSlideDir(null);
      setAnimating(false);
    }, 250);
  }, [animating]);

  const goPrevWeek = useCallback(() => {
    if (animating) return;
    setSlideDir('right');
    setAnimating(true);
    setTimeout(() => {
      setCurrentWeekStart((prev) => {
        const next = new Date(prev);
        next.setDate(next.getDate() - 7);
        return next;
      });
      setSlideDir(null);
      setAnimating(false);
    }, 250);
  }, [animating]);

  const goToday = useCallback(() => {
    const todayWeek = getWeekStart(new Date());
    if (todayWeek.getTime() === currentWeekStart.getTime()) return;
    setSlideDir(todayWeek > currentWeekStart ? 'left' : 'right');
    setAnimating(true);
    setTimeout(() => {
      setCurrentWeekStart(todayWeek);
      setSlideDir(null);
      setAnimating(false);
    }, 250);
  }, [currentWeekStart]);

  // ── Categorize events ──
  const { timedByDay, allDayEvents, multiDayEvents, upcoming } = useMemo(() => {
    const timed = {};   // dayIndex -> [event]
    const allDay = [];  // single all-day events
    const multi = [];   // multi-day events
    const now = new Date();
    const upcomingList = [];

    for (let i = 0; i < colCount; i++) timed[i] = [];

    for (const ev of events) {
      if (ev.allDay) {
        const startDate = new Date(ev.start + 'T00:00:00');
        const endDate = new Date(ev.end + 'T00:00:00');

        if (startDate.getTime() !== endDate.getTime()) {
          multi.push(ev);
        } else {
          allDay.push(ev);
        }
      } else {
        const dayIdx = getEventDayIndex(ev);
        // Only include if this day is visible
        if (dayIdx < colCount) {
          timed[dayIdx] = timed[dayIdx] || [];
          timed[dayIdx].push(ev);
        }
      }

      // Collect upcoming events (future from now)
      const evTime = ev.allDay ? new Date(ev.start + 'T00:00:00') : new Date(ev.start);
      if (evTime >= now) {
        upcomingList.push(ev);
      }
    }

    // Sort upcoming by start time and take first 4
    upcomingList.sort((a, b) => {
      const at = a.allDay ? new Date(a.start + 'T00:00:00') : new Date(a.start);
      const bt = b.allDay ? new Date(b.start + 'T00:00:00') : new Date(b.start);
      return at - bt;
    });

    return {
      timedByDay: timed,
      allDayEvents: allDay,
      multiDayEvents: multi,
      upcoming: upcomingList.slice(0, 4),
    };
  }, [events, colCount]);

  // ── Overlap layouts per day ──
  const overlapLayouts = useMemo(() => {
    const layouts = {};
    for (let i = 0; i < colCount; i++) {
      layouts[i] = computeOverlapLayout(timedByDay[i] || []);
    }
    return layouts;
  }, [timedByDay, colCount]);

  // ── Event tap handler ──
  function handleEventTap(event, rect) {
    setSelectedEvent(event);
  }

  // ── Month/year label ──
  const monthYearLabel = useMemo(() => {
    // If the week spans two months, show both
    const first = dayColumns[0];
    const last = dayColumns[dayColumns.length - 1];
    const m1 = first.getMonth();
    const m2 = last.getMonth();
    const y = first.getFullYear();

    if (m1 === m2) {
      return `${t.topBar.months[m1]} ${y}`;
    }
    return `${t.topBar.months[m1]} — ${t.topBar.months[m2]} ${y}`;
  }, [dayColumns]);

  // ── Hour labels ──
  const hourLabels = useMemo(() => {
    return Array.from({ length: TOTAL_HOURS }, (_, i) => {
      const h = HOUR_START + i;
      return `${String(h).padStart(2, '0')}:00`;
    });
  }, []);

  // ── All-day row data ──
  const allDayRowItems = useMemo(() => {
    const items = [];

    // Single all-day events
    for (const ev of allDayEvents) {
      const d = new Date(ev.start + 'T00:00:00');
      const dayIdx = d.getDay();
      if (dayIdx < colCount) {
        items.push({ event: ev, startCol: dayIdx, span: 1 });
      }
    }

    // Multi-day events
    for (const ev of multiDayEvents) {
      const startDate = new Date(ev.start + 'T00:00:00');
      const endDate = new Date(ev.end + 'T00:00:00');
      const wsTime = currentWeekStart.getTime();
      const weTime = getWeekEnd(currentWeekStart).getTime();

      let startIdx = startDate.getDay();
      let endIdx = endDate.getDay();

      // Clamp to visible week
      if (startDate.getTime() < wsTime) startIdx = 0;
      if (endDate.getTime() > weTime) endIdx = colCount - 1;

      // Clamp to visible columns
      startIdx = Math.max(0, Math.min(startIdx, colCount - 1));
      endIdx = Math.max(0, Math.min(endIdx, colCount - 1));

      const span = endIdx - startIdx + 1;
      if (span > 0) {
        items.push({ event: ev, startCol: startIdx, span });
      }
    }

    return items;
  }, [allDayEvents, multiDayEvents, colCount, currentWeekStart]);

  // ── Loading state ──
  if (loading) return <CalendarSkeleton />;

  // ── Slide animation class ──
  const slideClass = slideDir === 'left'
    ? 'animate-slideOutLeft'
    : slideDir === 'right'
      ? 'animate-slideOutRight'
      : '';

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* ── Week Navigation Bar ── */}
      <div className="flex items-center gap-3 px-6 py-3 shrink-0 border-b border-bd bg-surf">
        <button
          onClick={goNextWeek}
          className="ripple flex items-center justify-center min-w-[44px] min-h-[44px] rounded-xl
                     text-ts hover:bg-s2 hover:text-tp active:scale-95 transition-all duration-[var(--dur-fast)]"
          aria-label={t.calendar.nextWeek}
        >
          <ChevronRight />
        </button>

        <span className="text-base font-semibold text-tp min-w-[180px] text-center select-none">
          {monthYearLabel}
        </span>

        <button
          onClick={goPrevWeek}
          className="ripple flex items-center justify-center min-w-[44px] min-h-[44px] rounded-xl
                     text-ts hover:bg-s2 hover:text-tp active:scale-95 transition-all duration-[var(--dur-fast)]"
          aria-label={t.calendar.prevWeek}
        >
          <ChevronLeft />
        </button>

        <div className="flex-1" />

        <button
          onClick={goToday}
          className="ripple px-5 min-h-[44px] rounded-xl bg-acc text-white font-medium text-sm
                     hover:bg-acc/90 active:scale-95 transition-all duration-[var(--dur-fast)]"
        >
          {t.calendar.today}
        </button>
      </div>

      {/* ── Main Content ── */}
      <div className="flex flex-1 overflow-hidden">
        {/* ── Day Column Grid ── */}
        <div
          className="flex-1 flex flex-col overflow-hidden"
          style={{
            direction: 'ltr', /* Calendar grid is always LTR (Sun→Sat) */
            opacity: slideDir ? 0.4 : 1,
            transform: slideDir === 'left' ? 'translateX(-20px)' : slideDir === 'right' ? 'translateX(20px)' : 'translateX(0)',
            transition: 'opacity var(--dur-normal) var(--ease), transform var(--dur-normal) var(--ease)',
          }}
        >
          {/* ── Sticky Day Headers ── */}
          <div
            className="shrink-0 grid gap-px bg-bd border-b border-bd"
            style={{ gridTemplateColumns: `48px repeat(${colCount}, 1fr)` }}
          >
            {/* Time gutter header (empty) */}
            <div className="bg-surf" />

            {dayColumns.map((date, i) => {
              const today = isToday(date);
              return (
                <div
                  key={i}
                  className={`flex flex-col items-center justify-center py-2.5 px-2
                    ${today ? 'bg-acc/10' : 'bg-surf'}`}
                >
                  <span className={`text-xs font-semibold ${today ? 'text-acc' : 'text-ts'}`}>
                    {dayNames[i]}
                  </span>
                  <span
                    className={`text-lg font-bold mt-0.5 leading-none
                      ${today
                        ? 'bg-acc text-white w-8 h-8 rounded-full flex items-center justify-center'
                        : 'text-tp'}`}
                  >
                    {date.getDate()}
                  </span>
                </div>
              );
            })}
          </div>

          {/* ── All-Day Events Row ── */}
          {allDayRowItems.length > 0 && (
            <div
              className="shrink-0 grid gap-1.5 px-1.5 py-2 bg-surf border-b border-bd"
              style={{ gridTemplateColumns: `48px repeat(${colCount}, 1fr)` }}
            >
              {/* Time gutter: label */}
              <div className="flex items-center justify-center">
                <span className="text-[10px] text-tm font-medium">{t.calendar.allDay}</span>
              </div>

              {/* All-day pills laid out on the grid */}
              {allDayRowItems.map(({ event, startCol, span }) => (
                <AllDayPill
                  key={event.id}
                  event={event}
                  span={span}
                  startCol={startCol + 2} /* +2: 1 for CSS 1-index, 1 for gutter col */
                  onTap={handleEventTap}
                />
              ))}
            </div>
          )}

          {/* ── Scrollable Time Grid ── */}
          <div className="flex-1 overflow-y-auto overflow-x-hidden">
            <div
              className="grid relative"
              style={{
                gridTemplateColumns: `48px repeat(${colCount}, 1fr)`,
                height: `${GRID_HEIGHT}px`,
              }}
            >
              {/* ── Hour Labels (gutter) ── */}
              <div className="relative bg-surf border-l border-bd">
                {hourLabels.map((label, i) => (
                  <div
                    key={i}
                    className="absolute w-full flex items-start justify-center"
                    style={{ top: `${i * HOUR_HEIGHT}px`, height: `${HOUR_HEIGHT}px` }}
                  >
                    <span
                      className="text-[10px] text-tm -mt-2 select-none"
                      style={{ fontFamily: "'DM Mono', monospace" }}
                    >
                      {label}
                    </span>
                  </div>
                ))}
              </div>

              {/* ── Day Columns ── */}
              {dayColumns.map((date, colIdx) => {
                const dayIdx = date.getDay();
                const today = isToday(date);
                const dayEvents = timedByDay[dayIdx] || [];
                const layout = overlapLayouts[dayIdx] || new Map();
                const isEmpty = dayEvents.length === 0;
                const MAX_VISIBLE = 3;

                return (
                  <div
                    key={colIdx}
                    className={`relative border-l border-bd
                      ${today ? 'bg-acc/[0.03]' : 'bg-bg'}`}
                  >
                    {/* Hour grid lines */}
                    {hourLabels.map((_, i) => (
                      <div
                        key={i}
                        className="absolute w-full border-t border-bd/50"
                        style={{ top: `${i * HOUR_HEIGHT}px` }}
                      />
                    ))}

                    {/* Events */}
                    {dayEvents.map((ev) => {
                      const pos = getEventPosition(ev);
                      const overlap = layout.get(ev.id) || { index: 0, total: 1 };

                      // If more than MAX_VISIBLE, hide overflow events
                      if (overlap.index >= MAX_VISIBLE) return null;

                      const visibleTotal = Math.min(overlap.total, MAX_VISIBLE);
                      const widthPercent = 100 / visibleTotal;
                      const leftPercent = overlap.index * widthPercent;

                      return (
                        <EventBlock
                          key={ev.id}
                          event={ev}
                          style={{
                            top: `${pos.top}px`,
                            height: `${pos.height}px`,
                            left: `${leftPercent}%`,
                            width: `${widthPercent - 2}%`,
                            zIndex: 10 + overlap.index,
                          }}
                          onTap={handleEventTap}
                        />
                      );
                    })}

                    {/* "+N more" badge for overflows */}
                    {dayEvents.some((ev) => {
                      const o = layout.get(ev.id);
                      return o && o.total > MAX_VISIBLE;
                    }) && (() => {
                      // Find the overflow group and show badge
                      const overflowEv = dayEvents.find((ev) => {
                        const o = layout.get(ev.id);
                        return o && o.index === 0 && o.total > MAX_VISIBLE;
                      });
                      if (!overflowEv) return null;
                      const pos = getEventPosition(overflowEv);
                      const o = layout.get(overflowEv.id);
                      const extra = o.total - MAX_VISIBLE;
                      return (
                        <div
                          key="overflow-badge"
                          className="absolute right-1 text-[10px] font-bold text-acc bg-acc/10
                                     rounded-full px-2 py-0.5 z-30"
                          dir="rtl"
                          style={{ top: `${pos.top + pos.height - 20}px` }}
                        >
                          +{extra} {t.calendar.moreEvents}
                        </div>
                      );
                    })()}

                    {/* Empty state */}
                    {isEmpty && (
                      <div className="absolute inset-4 flex items-center justify-center pointer-events-none">
                        <div className="border-2 border-dashed border-bd/40 rounded-xl w-full h-24
                                        flex items-center justify-center">
                          <span className="text-[11px] text-tm">{t.empty.noEvents}</span>
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        </div>

        {/* ── Upcoming Sidebar ── */}
        <aside className="w-[280px] shrink-0 border-s border-bd bg-surf flex flex-col overflow-hidden">
          <div className="px-5 py-4 border-b border-bd shrink-0">
            <h2 className="text-sm font-semibold text-tp">{t.calendar.upcoming}</h2>
          </div>

          <div className="flex-1 overflow-y-auto px-3 py-3 flex flex-col gap-2">
            {upcoming.length > 0 ? (
              upcoming.map((ev) => (
                <UpcomingCard key={ev.id} event={ev} onTap={handleEventTap} />
              ))
            ) : (
              <div className="flex-1 flex flex-col items-center justify-center px-4">
                <div className="w-full border-2 border-dashed border-bd rounded-2xl
                                flex items-center justify-center py-10">
                  <span className="text-sm text-tm">{t.calendar.noUpcoming}</span>
                </div>
              </div>
            )}
          </div>
        </aside>
      </div>

      {/* ── Event Detail Popup ── */}
      {selectedEvent && (
        <EventDetailPopup
          event={selectedEvent}
          onClose={() => setSelectedEvent(null)}
        />
      )}
    </div>
  );
}
