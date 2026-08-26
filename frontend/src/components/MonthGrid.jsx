import { useMemo } from 'react';
import t from '../i18n/he.json';
import {
  CALENDAR_COLORS,
  getMonthGridRange,
  groupEventsByDay,
  toLocalDateKey,
} from '../hooks/useCalendar.js';

const MAX_CHIPS = 3;

function isSameDay(a, b) {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

function getColorStyle(colorKey) {
  return CALENDAR_COLORS[colorKey] || CALENDAR_COLORS.mint;
}

// ─── Event Chip ─────────────────────────────────────────────────────────────

function MonthEventChip({ event, onTap }) {
  const color = getColorStyle(event.color);
  return (
    <button
      onClick={(e) => {
        e.stopPropagation();
        onTap(event);
      }}
      className="w-full rounded-full px-2 py-0.5 text-[11px] font-medium truncate cursor-pointer
                 hover:brightness-95 active:scale-95 transition-all duration-[var(--dur-fast)] text-start"
      style={{
        direction: 'rtl', /* Chip text is RTL inside the LTR grid */
        backgroundColor: color.bg,
        color: color.text,
        borderRight: `3px solid ${color.border}`,
      }}
    >
      {event.title}
    </button>
  );
}

// ─── Month Grid ─────────────────────────────────────────────────────────────

/**
 * Classic month grid: weeks as rows, 7 day columns (Sunday first, Israeli
 * convention). `monthDate` is any date in the displayed month. Tapping a cell
 * selects the day; tapping a chip opens the event detail.
 */
export default function MonthGrid({ monthDate, events, selectedDate, onSelectDay, onEventTap }) {
  const eventsByDay = useMemo(() => groupEventsByDay(events), [events]);

  // Visible grid days: Sunday of the 1st's week through Saturday of the
  // last day's week (adjacent-month spillover included).
  const weeks = useMemo(() => {
    const { start, end } = getMonthGridRange(monthDate);
    const rows = [];
    for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 7)) {
      const row = [];
      for (let i = 0; i < 7; i++) {
        const day = new Date(d);
        day.setDate(day.getDate() + i);
        row.push(day);
      }
      rows.push(row);
    }
    return rows;
  }, [monthDate]);

  return (
    <div
      className="flex-1 flex flex-col overflow-hidden"
      style={{ direction: 'rtl' /* Sunday on the right, days flow left */ }}
    >
      {/* ── Day-name header ── */}
      <div className="shrink-0 grid grid-cols-7 gap-px bg-bd border-b border-bd">
        {t.topBar.days.map((name, i) => (
          <div key={i} className="bg-surf py-2 flex items-center justify-center">
            <span className="text-xs font-semibold text-ts">{name}</span>
          </div>
        ))}
      </div>

      {/* ── Week rows ── */}
      <div
        className="flex-1 grid grid-cols-7 gap-px bg-bd overflow-hidden"
        style={{ gridTemplateRows: `repeat(${weeks.length}, 1fr)` }}
      >
        {weeks.flat().map((date) => {
          const key = toLocalDateKey(date);
          const inMonth = date.getMonth() === monthDate.getMonth();
          const today = isSameDay(date, new Date());
          const selected = selectedDate && isSameDay(date, selectedDate);
          const dayEvents = eventsByDay.get(key) || [];
          const visible = dayEvents.slice(0, MAX_CHIPS);
          const overflow = dayEvents.length - visible.length;

          return (
            <div
              key={key}
              role="button"
              tabIndex={0}
              onClick={() => onSelectDay(date)}
              onKeyDown={(e) => { if (e.key === 'Enter') onSelectDay(date); }}
              className={`flex flex-col items-stretch gap-1 p-1.5 min-h-0 overflow-hidden cursor-pointer
                          active:scale-[0.98] transition-all duration-[var(--dur-fast)]
                          ${today ? 'bg-acc/[0.06]' : 'bg-bg'}
                          ${selected ? 'shadow-[inset_0_0_0_2px_var(--acc)]' : ''}`}
            >
              {/* Day number */}
              <span
                className={`self-start text-sm font-bold leading-none w-7 h-7 flex items-center justify-center
                  ${today
                    ? 'bg-acc text-white rounded-full'
                    : inMonth
                      ? 'text-tp'
                      : 'text-tm'}`}
              >
                {date.getDate()}
              </span>

              {/* Event chips */}
              {visible.map((ev) => (
                <MonthEventChip key={`${key}-${ev.id}`} event={ev} onTap={onEventTap} />
              ))}

              {/* Overflow indicator */}
              {overflow > 0 && (
                <span className="text-[10px] font-bold text-acc ps-1 text-start" dir="rtl">
                  +{overflow} {t.calendar.moreEvents}
                </span>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
