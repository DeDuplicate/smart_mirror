import { useState, useEffect } from 'react';
import t from '../../i18n/he.json';
import { CalendarSkeleton } from '../Skeleton.jsx';

// ─── Icons ──────────────────────────────────────────────────────────────────

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

// ─── Day column names (Sun-Thu for work week) ───────────────────────────────

const WEEKDAYS = t.topBar.days.slice(0, 5); // ראשון - חמישי

// ─── CalendarPage ───────────────────────────────────────────────────────────

export default function CalendarPage() {
  const [loading, setLoading] = useState(true);
  const [events] = useState([]);

  useEffect(() => {
    const timer = setTimeout(() => setLoading(false), 1000);
    return () => clearTimeout(timer);
  }, []);

  if (loading) return <CalendarSkeleton />;

  const isEmpty = events.length === 0;

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Week navigation header */}
      <div className="flex items-center gap-3 px-6 py-3 shrink-0 border-b border-bd bg-surf">
        <button
          className="ripple flex items-center justify-center min-w-[44px] min-h-[44px] rounded-xl
                     text-ts hover:bg-s2 hover:text-tp active:scale-95 transition-all duration-[var(--dur-fast)]"
          aria-label="שבוע הבא"
        >
          <ChevronRight />
        </button>

        <span className="text-base font-semibold text-tp min-w-[140px] text-center">
          {t.topBar.months[new Date().getMonth()]} {new Date().getFullYear()}
        </span>

        <button
          className="ripple flex items-center justify-center min-w-[44px] min-h-[44px] rounded-xl
                     text-ts hover:bg-s2 hover:text-tp active:scale-95 transition-all duration-[var(--dur-fast)]"
          aria-label="שבוע קודם"
        >
          <ChevronLeft />
        </button>

        <div className="flex-1" />

        <button
          className="ripple px-5 min-h-[44px] rounded-xl bg-acc text-white font-medium text-sm
                     hover:bg-acc/90 active:scale-95 transition-all duration-[var(--dur-fast)]"
        >
          {t.calendar.today}
        </button>
      </div>

      {/* Main content: 5-column grid + upcoming sidebar */}
      <div className="flex flex-1 overflow-hidden">
        {/* Week columns */}
        <div className="flex-1 grid grid-cols-5 gap-px bg-bd overflow-y-auto">
          {WEEKDAYS.map((day, i) => (
            <div key={i} className="flex flex-col bg-bg">
              {/* Day header */}
              <div className="sticky top-0 z-10 bg-surf border-b border-bd px-4 py-3 text-center">
                <span className="text-sm font-semibold text-tp">{day}</span>
              </div>

              {/* Events area */}
              <div className="flex-1 p-3">
                {isEmpty && (
                  <div className="flex items-center justify-center h-full">
                    <span className="text-xs text-tm">&mdash;</span>
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>

        {/* Upcoming sidebar */}
        <aside className="w-[280px] shrink-0 border-s border-bd bg-surf overflow-y-auto">
          <div className="px-5 py-4 border-b border-bd">
            <h2 className="text-sm font-semibold text-tp">{t.calendar.upcoming}</h2>
          </div>

          {isEmpty && (
            <div className="flex flex-col items-center justify-center h-[calc(100%-60px)] px-6">
              <div
                className="w-full border-2 border-dashed border-bd rounded-2xl flex items-center
                           justify-center py-12"
              >
                <span className="text-tm text-base">{t.empty.noEvents}</span>
              </div>
            </div>
          )}
        </aside>
      </div>
    </div>
  );
}
