import { useState, useCallback, useEffect, useRef } from 'react';
import t from '../i18n/he.json';
import useStore from '../store/index.js';
import OnScreenKeyboard from './OnScreenKeyboard.jsx';
import { CALENDAR_COLORS, normalizeCalendarColor } from '../hooks/useCalendar.js';

const COLOR_KEYS = ['mint', 'lav', 'coral', 'gold'];

function CloseIcon({ className = 'w-6 h-6' }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
      strokeLinecap="round" strokeLinejoin="round" className={className}>
      <line x1="18" y1="6" x2="6" y2="18" />
      <line x1="6" y1="6" x2="18" y2="18" />
    </svg>
  );
}

function TrashIcon({ className = 'w-5 h-5' }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
      strokeLinecap="round" strokeLinejoin="round" className={className}>
      <polyline points="3 6 5 6 21 6" />
      <path d="M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2" />
    </svg>
  );
}

function toDateStr(day, month, year) {
  return `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

function daysInMonth(month, year) {
  return new Date(year, month + 1, 0).getDate();
}

function addDays(dateStr, days) {
  const d = new Date(`${dateStr}T00:00:00`);
  d.setDate(d.getDate() + days);
  return toDateStr(d.getDate(), d.getMonth(), d.getFullYear());
}

function eventDatePart(value) {
  const raw = String(value || '');
  if (/^\d{4}-\d{2}-\d{2}/.test(raw)) return raw.slice(0, 10);
  const d = new Date(raw);
  if (Number.isNaN(d.getTime())) return toDateStr(new Date().getDate(), new Date().getMonth(), new Date().getFullYear());
  return toDateStr(d.getDate(), d.getMonth(), d.getFullYear());
}

function eventTimeParts(value, fallbackHour = 9, fallbackMinute = 0) {
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return { hours: fallbackHour, minutes: fallbackMinute };
  return { hours: d.getHours(), minutes: d.getMinutes() };
}

function toLocalDateTime(dateStr, hours, minutes) {
  return `${dateStr}T${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:00`;
}

function inclusiveEndDate(start, end, allDay) {
  if (!allDay) return eventDatePart(end || start);
  const startKey = eventDatePart(start);
  const endKey = eventDatePart(end || start);
  if (!endKey || endKey <= startKey) return startKey;
  return addDays(endKey, -1);
}

function ScrollPicker({ items, value, onChange, label }) {
  const listRef = useRef(null);
  const itemHeight = 48;
  const selectedIdx = items.findIndex((i) => i.value === value);

  useEffect(() => {
    if (listRef.current && selectedIdx >= 0) {
      listRef.current.scrollTop = selectedIdx * itemHeight;
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const handleScroll = useCallback(() => {
    if (!listRef.current) return;
    const idx = Math.round(listRef.current.scrollTop / itemHeight);
    const clamped = Math.max(0, Math.min(idx, items.length - 1));
    if (items[clamped] && items[clamped].value !== value) {
      onChange(items[clamped].value);
    }
  }, [items, value, onChange]);

  return (
    <div className="flex flex-col items-center gap-1 flex-1">
      <span className="text-xs text-ts font-medium">{label}</span>
      <div className="relative h-[144px] w-full overflow-hidden rounded-xl bg-s2">
        <div className="absolute inset-x-0 top-[48px] h-[48px] bg-acc/10 rounded-xl pointer-events-none z-10 border-y border-acc/20" />
        <div
          ref={listRef}
          className="h-full overflow-y-auto scroll-smooth"
          onScroll={handleScroll}
          style={{ scrollSnapType: 'y mandatory', paddingTop: 48, paddingBottom: 48 }}
        >
          {items.map((item) => (
            <button
              key={item.value}
              type="button"
              className={`w-full h-[48px] flex items-center justify-center text-base
                transition-colors duration-[var(--dur-fast)]
                ${item.value === value ? 'text-tp font-semibold' : 'text-tm'}`}
              style={{ scrollSnapAlign: 'start', minHeight: 48 }}
              onClick={() => onChange(item.value)}
            >
              {item.label}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

function DatePicker({ value, onChange }) {
  const parsed = value ? new Date(`${value}T00:00:00`) : new Date();
  const [day, setDay] = useState(parsed.getDate());
  const [month, setMonth] = useState(parsed.getMonth());
  const [year, setYear] = useState(parsed.getFullYear());

  const maxDay = daysInMonth(month, year);
  const clampedDay = Math.min(day, maxDay);

  useEffect(() => {
    if (day > maxDay) setDay(maxDay);
  }, [month, year, maxDay, day]);

  useEffect(() => {
    onChange(toDateStr(clampedDay, month, year));
  }, [clampedDay, month, year]); // eslint-disable-line react-hooks/exhaustive-deps

  const dayItems = Array.from({ length: maxDay }, (_, i) => ({
    value: i + 1,
    label: String(i + 1),
  }));
  const monthItems = t.topBar.months.map((name, i) => ({ value: i, label: name }));
  const currentYear = new Date().getFullYear();
  const yearItems = Array.from({ length: 6 }, (_, i) => ({
    value: currentYear - 1 + i,
    label: String(currentYear - 1 + i),
  }));

  return (
    <div className="flex gap-3">
      <ScrollPicker items={dayItems} value={clampedDay} onChange={setDay} label={t.tasks.day} />
      <ScrollPicker items={monthItems} value={month} onChange={setMonth} label={t.tasks.month} />
      <ScrollPicker items={yearItems} value={year} onChange={setYear} label={t.tasks.year} />
    </div>
  );
}

function TimeStepper({ hours, minutes, onChange }) {
  const step = (delta) => {
    const next = (hours * 60 + minutes + delta + 24 * 60) % (24 * 60);
    onChange(Math.floor(next / 60), next % 60);
  };

  return (
    <div className="flex items-center gap-3">
      <button
        type="button"
        onClick={() => step(-15)}
        className="min-w-[56px] min-h-[56px] rounded-xl bg-s2 border border-bd text-tp text-2xl
                   font-medium hover:bg-bd active:scale-95 transition-all duration-[var(--dur-fast)]"
        aria-label="-15"
      >
        −
      </button>
      <span className="flex-1 text-center text-2xl font-semibold text-tp tabular-nums"
        style={{ fontFamily: "'DM Mono', monospace" }}>
        {String(hours).padStart(2, '0')}:{String(minutes).padStart(2, '0')}
      </span>
      <button
        type="button"
        onClick={() => step(15)}
        className="min-w-[56px] min-h-[56px] rounded-xl bg-s2 border border-bd text-tp text-2xl
                   font-medium hover:bg-bd active:scale-95 transition-all duration-[var(--dur-fast)]"
        aria-label="+15"
      >
        +
      </button>
    </div>
  );
}

export default function EventEditor({ event, defaults, onSave, onDelete, onClose, saving }) {
  const isNew = !event;
  const showConfirm = useStore((s) => s.showConfirm);

  const [title, setTitle] = useState(event?.title || '');
  const [location, setLocation] = useState(event?.location || '');
  const [description, setDescription] = useState(event?.description || '');
  const [allDay, setAllDay] = useState(!!(event?.allDay ?? defaults?.allDay));
  const [startDate, setStartDate] = useState(() => {
    if (event) return eventDatePart(event.start);
    if (defaults?.date) return eventDatePart(defaults.date);
    const now = new Date();
    return toDateStr(now.getDate(), now.getMonth(), now.getFullYear());
  });
  const [endDate, setEndDate] = useState(() => {
    if (event) return inclusiveEndDate(event.start, event.end, !!event.allDay);
    if (defaults?.date) return eventDatePart(defaults.date);
    const now = new Date();
    return toDateStr(now.getDate(), now.getMonth(), now.getFullYear());
  });
  const [startTime, setStartTime] = useState(() => {
    if (event && !event.allDay) return eventTimeParts(event.start);
    return { hours: defaults?.hour ?? 9, minutes: defaults?.minute ?? 0 };
  });
  const [endTime, setEndTime] = useState(() => {
    if (event && !event.allDay) return eventTimeParts(event.end, 10, 0);
    const h = defaults?.hour ?? 9;
    const m = defaults?.minute ?? 0;
    const next = h * 60 + m + 60;
    return { hours: Math.floor(next / 60) % 24, minutes: next % 60 };
  });
  const [color, setColor] = useState(normalizeCalendarColor(event?.color || 'mint'));
  const [keyboardTarget, setKeyboardTarget] = useState(null);

  const handleKeyboardInput = useCallback((char) => {
    if (keyboardTarget === 'title') setTitle((prev) => prev + char);
    else if (keyboardTarget === 'location') setLocation((prev) => prev + char);
    else if (keyboardTarget === 'description') setDescription((prev) => prev + char);
  }, [keyboardTarget]);

  const handleKeyboardBackspace = useCallback(() => {
    if (keyboardTarget === 'title') setTitle((prev) => prev.slice(0, -1));
    else if (keyboardTarget === 'location') setLocation((prev) => prev.slice(0, -1));
    else if (keyboardTarget === 'description') setDescription((prev) => prev.slice(0, -1));
  }, [keyboardTarget]);

  const handleKeyboardEnter = useCallback(() => {
    if (keyboardTarget === 'description') setDescription((prev) => prev + '\n');
    else setKeyboardTarget(null);
  }, [keyboardTarget]);

  const handleSave = useCallback(() => {
    const trimmed = title.trim();
    if (!trimmed || saving) return;

    let start = startDate;
    let end = endDate || startDate;
    if (end < start) end = start;

    if (allDay) {
      if (end > start) end = addDays(end, 1);
    } else {
      start = toLocalDateTime(startDate, startTime.hours, startTime.minutes);
      end = toLocalDateTime(endDate || startDate, endTime.hours, endTime.minutes);
      if (new Date(end) <= new Date(start)) {
        const bump = new Date(start);
        bump.setHours(bump.getHours() + 1);
        end = toLocalDateTime(
          toDateStr(bump.getDate(), bump.getMonth(), bump.getFullYear()),
          bump.getHours(),
          bump.getMinutes()
        );
      }
    }

    onSave({
      title: trimmed,
      location: location.trim(),
      description: description.trim(),
      allDay,
      start,
      end,
      color,
    });
  }, [title, location, description, allDay, startDate, endDate, startTime, endTime, color, saving, onSave]);

  const handleDelete = useCallback(() => {
    if (!onDelete) return;
    showConfirm({
      title: t.calendar.deleteConfirmTitle,
      message: t.calendar.deleteConfirmMessage,
      onConfirm: onDelete,
    });
  }, [onDelete, showConfirm]);

  return (
    <div className="fixed inset-0 z-40 flex flex-col" style={{ direction: 'rtl' }}>
      <div
        className="absolute inset-0 bg-black/40"
        onClick={onClose}
        style={{ animation: 'fadeIn var(--dur-fast) var(--ease) forwards' }}
      />

      <div
        className="relative bg-surf shadow-modal rounded-t-3xl flex flex-col overflow-hidden"
        style={{
          position: keyboardTarget ? 'absolute' : 'relative',
          bottom: keyboardTarget ? '40%' : '0',
          left: 0,
          right: 0,
          marginTop: keyboardTarget ? undefined : 'auto',
          height: keyboardTarget ? '60%' : '86%',
          animation: 'taskOverlayUp var(--dur-normal) var(--ease-out) forwards',
          transition: 'height 0.25s ease, bottom 0.25s ease',
        }}
      >
        <div className="flex items-center justify-between px-6 py-4 border-b border-bd shrink-0">
          <h2 className="text-lg font-bold text-tp">
            {isNew ? t.calendar.newEvent : t.calendar.editEvent}
          </h2>
          <button
            onClick={onClose}
            className="flex items-center justify-center w-14 h-14 rounded-full text-ts hover:bg-s2
                       active:scale-95 transition-all duration-[var(--dur-fast)]"
            aria-label={t.common.cancel}
          >
            <CloseIcon />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-6 py-5 space-y-6">
          <div>
            <label className="block text-sm font-semibold text-tp mb-2">{t.calendar.title}</label>
            <input
              type="text"
              value={title}
              readOnly
              onFocus={() => setKeyboardTarget('title')}
              placeholder={t.calendar.titlePlaceholder}
              className="w-full h-14 px-4 rounded-xl border border-bd bg-s2 text-tp text-base
                         placeholder:text-tm focus:outline-none focus:ring-2 focus:ring-acc/30"
            />
          </div>

          <div>
            <label className="block text-sm font-semibold text-tp mb-2">{t.calendar.location}</label>
            <input
              type="text"
              value={location}
              readOnly
              onFocus={() => setKeyboardTarget('location')}
              placeholder={t.calendar.locationPlaceholder}
              className="w-full h-14 px-4 rounded-xl border border-bd bg-s2 text-tp text-base
                         placeholder:text-tm focus:outline-none focus:ring-2 focus:ring-acc/30"
            />
          </div>

          <div>
            <label className="block text-sm font-semibold text-tp mb-2">{t.calendar.description}</label>
            <textarea
              value={description}
              readOnly
              onFocus={() => setKeyboardTarget('description')}
              placeholder={t.calendar.descriptionPlaceholder}
              rows={3}
              className="w-full px-4 py-3 rounded-xl border border-bd bg-s2 text-tp text-sm
                         placeholder:text-tm resize-none focus:outline-none focus:ring-2 focus:ring-acc/30"
            />
          </div>

          <button
            type="button"
            onClick={() => setAllDay((v) => !v)}
            className={`w-full min-h-[56px] rounded-xl border text-sm font-medium
                        transition-all duration-[var(--dur-fast)]
                        ${allDay ? 'border-acc bg-acc/10 text-acc' : 'border-bd bg-s2 text-ts'}`}
          >
            {t.calendar.allDay}
          </button>

          <div>
            <label className="block text-sm font-semibold text-tp mb-3">{t.calendar.startDate}</label>
            <DatePicker value={startDate} onChange={setStartDate} />
          </div>

          {allDay && (
            <div>
              <label className="block text-sm font-semibold text-tp mb-3">{t.calendar.endDate}</label>
              <DatePicker value={endDate} onChange={setEndDate} />
            </div>
          )}

          {!allDay && (
            <>
              <div>
                <label className="block text-sm font-semibold text-tp mb-3">{t.calendar.startTime}</label>
                <TimeStepper
                  hours={startTime.hours}
                  minutes={startTime.minutes}
                  onChange={(hours, minutes) => setStartTime({ hours, minutes })}
                />
              </div>
              <div>
                <label className="block text-sm font-semibold text-tp mb-3">{t.calendar.endTime}</label>
                <TimeStepper
                  hours={endTime.hours}
                  minutes={endTime.minutes}
                  onChange={(hours, minutes) => setEndTime({ hours, minutes })}
                />
              </div>
            </>
          )}

          <div>
            <label className="block text-sm font-semibold text-tp mb-3">{t.calendar.color}</label>
            <div className="flex gap-3">
              {COLOR_KEYS.map((key) => {
                const swatch = CALENDAR_COLORS[key];
                const selected = color === key;
                return (
                  <button
                    key={key}
                    type="button"
                    onClick={() => setColor(key)}
                    className={`flex-1 min-h-[56px] rounded-xl border-2 transition-all duration-[var(--dur-fast)]
                                ${selected ? 'scale-[1.03]' : 'opacity-80'}`}
                    style={{
                      backgroundColor: swatch.bg,
                      borderColor: selected ? swatch.border : 'transparent',
                    }}
                    aria-label={key}
                  />
                );
              })}
            </div>
          </div>
        </div>

        <div className="shrink-0 flex items-center gap-3 px-6 py-4 border-t border-bd bg-surf">
          {!isNew && onDelete && (
            <button
              onClick={handleDelete}
              className="flex items-center gap-2 px-5 h-14 rounded-xl bg-red-500/10 text-red-500
                         font-semibold text-sm hover:bg-red-500/20 active:scale-95
                         transition-all duration-[var(--dur-fast)]"
            >
              <TrashIcon />
              {t.common.delete}
            </button>
          )}
          <div className="flex-1" />
          <button
            onClick={onClose}
            className="px-6 h-14 rounded-xl border border-bd text-ts font-medium text-sm
                       hover:bg-s2 active:scale-95 transition-all duration-[var(--dur-fast)]"
          >
            {t.common.cancel}
          </button>
          <button
            onClick={handleSave}
            disabled={!title.trim() || saving}
            className="px-8 h-14 rounded-xl bg-acc text-white font-semibold text-sm
                       hover:bg-acc/90 active:scale-95 transition-all duration-[var(--dur-fast)]
                       disabled:opacity-40 disabled:pointer-events-none"
          >
            {saving ? t.common.loading : t.common.save}
          </button>
        </div>
      </div>

      <OnScreenKeyboard
        visible={!!keyboardTarget}
        onInput={handleKeyboardInput}
        onBackspace={handleKeyboardBackspace}
        onEnter={handleKeyboardEnter}
        onClose={() => setKeyboardTarget(null)}
      />
    </div>
  );
}
