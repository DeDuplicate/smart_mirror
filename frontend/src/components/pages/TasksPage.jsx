import { Fragment, useState, useRef, useCallback, useEffect, useMemo } from 'react';
import t from '../../i18n/he.json';
import useStore from '../../store/index.js';
import { TasksSkeleton } from '../Skeleton.jsx';
import OnScreenKeyboard from '../OnScreenKeyboard.jsx';
import useTasks from '../../hooks/useTasks.js';
import usePullToRefresh from '../../hooks/usePullToRefresh.js';

// ─── Column definitions ─────────────────────────────────────────────────────

const COLUMNS = [
  { key: 'todo', label: t.tasks.todo },
  { key: 'inProgress', label: t.tasks.inProgress },
  { key: 'done', label: t.tasks.done },
];

const COLUMN_BG = {
  todo: 'bg-lav/30',
  inProgress: 'bg-gold/30',
  done: 'bg-mint/30',
};

const COLUMN_BADGE = {
  todo: 'bg-lav text-lav-d',
  inProgress: 'bg-gold text-gold-d',
  done: 'bg-mint text-mint-d',
};

// ─── Priority config ────────────────────────────────────────────────────────

const PRIORITIES = [
  { value: 'none', label: t.tasks.priorityNone, color: null },
  { value: 'low', label: t.tasks.priorityLow, color: '#22c55e' },
  { value: 'medium', label: t.tasks.priorityMedium, color: '#f59e0b' },
  { value: 'high', label: t.tasks.priorityHigh, color: '#ef4444' },
];

const PRIORITY_DOT_COLOR = {
  high: 'bg-red-500',
  medium: 'bg-amber-500',
  low: 'bg-green-500',
  none: '',
};

// ─── SVG Icons ──────────────────────────────────────────────────────────────

function PlusIcon({ className = 'w-7 h-7' }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"
      strokeLinecap="round" strokeLinejoin="round" className={className}>
      <line x1="12" y1="5" x2="12" y2="19" />
      <line x1="5" y1="12" x2="19" y2="12" />
    </svg>
  );
}

function StarIcon({ filled, className = 'w-5 h-5' }) {
  return (
    <svg viewBox="0 0 24 24" fill={filled ? 'currentColor' : 'none'}
      stroke="currentColor" strokeWidth="2" strokeLinecap="round"
      strokeLinejoin="round" className={className}>
      <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
    </svg>
  );
}

function CloseIcon({ className = 'w-6 h-6' }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
      strokeLinecap="round" strokeLinejoin="round" className={className}>
      <line x1="18" y1="6" x2="6" y2="18" />
      <line x1="6" y1="6" x2="18" y2="18" />
    </svg>
  );
}

function CheckIcon({ className = 'w-5 h-5' }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3"
      strokeLinecap="round" strokeLinejoin="round" className={className}>
      <polyline points="20 6 9 17 4 12" />
    </svg>
  );
}

function GripIcon({ className = 'w-5 h-5' }) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" className={className}>
      <circle cx="9" cy="6" r="1.5" />
      <circle cx="15" cy="6" r="1.5" />
      <circle cx="9" cy="12" r="1.5" />
      <circle cx="15" cy="12" r="1.5" />
      <circle cx="9" cy="18" r="1.5" />
      <circle cx="15" cy="18" r="1.5" />
    </svg>
  );
}

function CalendarIcon({ className = 'w-4 h-4' }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
      strokeLinecap="round" strokeLinejoin="round" className={className}>
      <rect x="3" y="4" width="18" height="18" rx="2" ry="2" />
      <line x1="16" y1="2" x2="16" y2="6" />
      <line x1="8" y1="2" x2="8" y2="6" />
      <line x1="3" y1="10" x2="21" y2="10" />
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

// ─── Date helpers ───────────────────────────────────────────────────────────

function formatDate(dateStr) {
  if (!dateStr) return null;
  const d = new Date(dateStr + 'T00:00:00');
  const day = d.getDate();
  const month = t.topBar.months[d.getMonth()];
  return `${day} ${month}`;
}

function isOverdue(dateStr) {
  if (!dateStr) return false;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const due = new Date(dateStr + 'T00:00:00');
  return due < today;
}

function toDateStr(day, month, year) {
  const mm = String(month + 1).padStart(2, '0');
  const dd = String(day).padStart(2, '0');
  return `${year}-${mm}-${dd}`;
}

function daysInMonth(month, year) {
  return new Date(year, month + 1, 0).getDate();
}

// ─── ScrollPicker (reusable date column picker) ─────────────────────────────

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
  }, [items, value, onChange, itemHeight]);

  return (
    <div className="flex flex-col items-center gap-1 flex-1">
      <span className="text-xs text-ts font-medium">{label}</span>
      <div className="relative h-[144px] w-full overflow-hidden rounded-xl bg-s2">
        {/* Selection highlight */}
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
              className={`
                w-full h-[48px] flex items-center justify-center text-base
                transition-colors duration-[var(--dur-fast)]
                ${item.value === value ? 'text-tp font-semibold' : 'text-tm'}
              `}
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

// ─── DatePicker (3-column scrollable) ───────────────────────────────────────

function DatePicker({ value, onChange }) {
  const parsed = value ? new Date(value + 'T00:00:00') : new Date();
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

  const monthItems = t.topBar.months.map((name, i) => ({
    value: i,
    label: name,
  }));

  const currentYear = new Date().getFullYear();
  const yearItems = Array.from({ length: 5 }, (_, i) => ({
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

// ─── Drop indicator (insertion point while dragging) ────────────────────────

function DropIndicator() {
  return (
    <div
      className="h-1.5 rounded-full bg-acc/60 mx-1 shrink-0"
      style={{ animation: 'fadeIn var(--dur-fast) var(--ease) forwards' }}
    />
  );
}

// ─── TaskCard ───────────────────────────────────────────────────────────────

function TaskCard({ task, index, isDone, onTap, onDragStart, isBeingDragged }) {
  const cardRef = useRef(null);
  const wasDragged = useRef(false);

  const subtasks = task.subtasks || [];
  const subsDone = subtasks.filter((s) => s.done).length;

  // Instant drag start from grip handle (mouse or touch)
  const startDrag = useCallback((e) => {
    e.stopPropagation();
    e.preventDefault();
    wasDragged.current = true;
    const point = e.touches ? e.touches[0] : e;
    onDragStart(task, { clientX: point.clientX, clientY: point.clientY, preventDefault: () => {} }, cardRef.current);
  }, [task, onDragStart]);

  const overdue = !isDone && isOverdue(task.dueDate);

  return (
    <div
      ref={cardRef}
      className={`
        bg-surf border border-bd rounded-xl p-4 shadow-card
        cursor-pointer select-none
        transition-all duration-[var(--dur-fast)]
        hover:shadow-raised active:scale-[0.98]
      `}
      style={{
        opacity: isBeingDragged ? 0.4 : 0,
        animation: isBeingDragged
          ? 'none'
          : `taskCardIn var(--dur-normal) var(--ease-out) ${index * 60}ms forwards`,
        ...(isBeingDragged ? { border: '2px dashed var(--acc)', background: 'var(--s2)' } : {}),
      }}
      onClick={(e) => {
        if (wasDragged.current) {
          wasDragged.current = false;
          return;
        }
        onTap(task);
      }}
      data-task-id={task.id}
    >
      <div className="flex items-start gap-3">
        {/* Drag grip handle — INSTANT drag on mousedown/touchstart */}
        <div
          className="text-tm hover:text-ts mt-0.5 shrink-0 cursor-grab active:cursor-grabbing p-1 -m-1 rounded"
          title="Drag to move"
          onMouseDown={startDrag}
          onTouchStart={startDrag}
        >
          <GripIcon className="w-5 h-5" />
        </div>

        {/* Card content */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            {/* Priority dot */}
            {task.priority && task.priority !== 'none' && (
              <span className={`w-2.5 h-2.5 rounded-full shrink-0 ${PRIORITY_DOT_COLOR[task.priority]}`} />
            )}

            {/* Title */}
            <span
              className={`
                text-sm font-medium leading-snug line-clamp-2 flex-1
                ${isDone ? 'line-through text-tm' : 'text-tp'}
              `}
            >
              {task.title}
            </span>

            {/* Star */}
            {task.starred && (
              <span className="text-amber-400 shrink-0">
                <StarIcon filled className="w-4 h-4" />
              </span>
            )}
          </div>

          {/* Bottom row: due date + checklist progress */}
          <div className="flex items-center gap-2 mt-2">
            {subtasks.length > 0 && (
              <span
                className={`
                  flex items-center gap-1 text-xs font-medium
                  ${isDone ? 'text-tm' : subsDone === subtasks.length ? 'text-mint-d' : 'text-ts'}
                `}
              >
                <CheckIcon className="w-3.5 h-3.5" />
                {t.tasks.subtaskProgress
                  .replace('{done}', String(subsDone))
                  .replace('{total}', String(subtasks.length))}
              </span>
            )}
            {task.dueDate && (
              <span
                className={`
                  flex items-center gap-1 text-xs font-mono
                  ${overdue ? 'text-red-500 font-semibold' : isDone ? 'text-tm' : 'text-ts'}
                `}
              >
                <CalendarIcon className="w-3.5 h-3.5" />
                {formatDate(task.dueDate)}
                {overdue && (
                  <span className="bg-red-500/10 text-red-500 text-[10px] px-1.5 py-0.5 rounded-full font-heebo font-medium">
                    {t.tasks.overdue}
                  </span>
                )}
              </span>
            )}
            <div className="flex-1" />
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── TaskDetailOverlay ──────────────────────────────────────────────────────

function TaskDetailOverlay({ task, isNew, tasks, onSave, onDelete, onClose, onAddSubtask, onToggleSubtask, onDeleteSubtask }) {
  const [title, setTitle] = useState(task?.title || '');
  const [description, setDescription] = useState(task?.description || '');
  const [dueDate, setDueDate] = useState(task?.dueDate || null);
  const [hasDueDate, setHasDueDate] = useState(!!task?.dueDate);
  const [priority, setPriority] = useState(task?.priority || 'none');
  const [starred, setStarred] = useState(task?.starred || false);
  const [subtaskDraft, setSubtaskDraft] = useState('');
  const [keyboardTarget, setKeyboardTarget] = useState(null); // 'title' | 'description' | 'subtask' | null
  // Live subtasks from the hook (checkbox ticks update instantly)
  const liveTask = !isNew && task ? tasks.find((x) => x.id === task.id) : null;
  const subtasks = liveTask?.subtasks || task?.subtasks || [];
  const showConfirm = useStore((s) => s.showConfirm);

  // Refs for cursor management
  const titleRef = useRef(null);
  const descRef = useRef(null);

  const handleSave = useCallback(() => {
    if (!title.trim()) return;
    onSave({
      ...(task || {}),
      title: title.trim(),
      description,
      dueDate: hasDueDate ? dueDate : null,
      priority,
      starred,
    });
  }, [title, description, dueDate, hasDueDate, priority, starred, task, onSave]);

  const handleDelete = useCallback(() => {
    showConfirm({
      title: t.tasks.deleteConfirmTitle,
      message: t.tasks.deleteConfirmMessage,
      onConfirm: () => onDelete(task.id),
    });
  }, [task, onDelete, showConfirm]);

  const handleAddSubtask = useCallback(() => {
    const trimmed = subtaskDraft.trim();
    if (!trimmed || !task?.id) return;
    onAddSubtask(task.id, trimmed);
    setSubtaskDraft('');
  }, [subtaskDraft, task, onAddSubtask]);

  const handleKeyboardInput = useCallback(
    (char) => {
      if (keyboardTarget === 'title') {
        setTitle((prev) => prev + char);
      } else if (keyboardTarget === 'description') {
        setDescription((prev) => prev + char);
      } else if (keyboardTarget === 'subtask') {
        setSubtaskDraft((prev) => prev + char);
      }
    },
    [keyboardTarget]
  );

  const handleKeyboardBackspace = useCallback(() => {
    if (keyboardTarget === 'title') {
      setTitle((prev) => prev.slice(0, -1));
    } else if (keyboardTarget === 'description') {
      setDescription((prev) => prev.slice(0, -1));
    } else if (keyboardTarget === 'subtask') {
      setSubtaskDraft((prev) => prev.slice(0, -1));
    }
  }, [keyboardTarget]);

  const handleKeyboardEnter = useCallback(() => {
    if (keyboardTarget === 'description') {
      setDescription((prev) => prev + '\n');
    } else if (keyboardTarget === 'subtask') {
      handleAddSubtask();
    } else {
      setKeyboardTarget(null);
    }
  }, [keyboardTarget, handleAddSubtask]);

  return (
    <div className="fixed inset-0 z-40 flex flex-col">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/40"
        onClick={onClose}
        style={{ animation: 'fadeIn var(--dur-fast) var(--ease) forwards' }}
      />

      {/* Panel — when keyboard open, panel sits directly above keyboard; keyboard=bottom 40%, panel=top of remaining 60% anchored to bottom */}
      <div
        className="relative bg-surf shadow-modal rounded-t-3xl flex flex-col overflow-hidden"
        style={{
          position: keyboardTarget ? 'absolute' : 'relative',
          bottom: keyboardTarget ? '40%' : '0',
          left: 0,
          right: 0,
          marginTop: keyboardTarget ? undefined : 'auto',
          height: keyboardTarget ? '60%' : '80%',
          animation: 'taskOverlayUp var(--dur-normal) var(--ease-out) forwards',
          transition: 'height 0.25s ease, bottom 0.25s ease',
        }}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-bd shrink-0">
          <h2 className="text-lg font-bold text-tp">
            {isNew ? t.tasks.newTask : t.tasks.editTask}
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

        {/* Scrollable content */}
        <div className="flex-1 overflow-y-auto px-6 py-5 space-y-6">
          {/* Title */}
          <div>
            <label className="block text-sm font-semibold text-tp mb-2">{t.tasks.title}</label>
            <input
              ref={titleRef}
              type="text"
              value={title}
              readOnly
              onFocus={() => setKeyboardTarget('title')}
              placeholder={t.tasks.titlePlaceholder}
              className="w-full h-14 px-4 rounded-xl border border-bd bg-s2 text-tp text-base
                         placeholder:text-tm focus:outline-none focus:ring-2 focus:ring-acc/30
                         transition-all duration-[var(--dur-fast)]"
            />
          </div>

          {/* Description */}
          <div>
            <label className="block text-sm font-semibold text-tp mb-2">{t.tasks.description}</label>
            <textarea
              ref={descRef}
              value={description}
              readOnly
              onFocus={() => setKeyboardTarget('description')}
              placeholder={t.tasks.descriptionPlaceholder}
              rows={3}
              className="w-full px-4 py-3 rounded-xl border border-bd bg-s2 text-tp text-sm
                         placeholder:text-tm resize-none focus:outline-none focus:ring-2
                         focus:ring-acc/30 transition-all duration-[var(--dur-fast)]"
            />
          </div>

          {/* Checklist — tick items off inside the task */}
          {!isNew && (
            <div>
              <label className="block text-sm font-semibold text-tp mb-3">
                {t.tasks.subtasks}
                {subtasks.length > 0 && (
                  <span className="text-ts font-normal ms-2">
                    {t.tasks.subtaskProgress
                      .replace('{done}', String(subtasks.filter((s) => s.done).length))
                      .replace('{total}', String(subtasks.length))}
                  </span>
                )}
              </label>
              <div className="space-y-2">
                {subtasks.map((sub) => (
                  <div
                    key={sub.id}
                    className="flex items-center gap-3 px-4 h-12 rounded-xl bg-s2 border border-bd"
                  >
                    <button
                      onClick={() => onToggleSubtask(task.id, sub)}
                      aria-label={sub.title}
                      className={`
                        w-8 h-8 rounded-full border-2 flex items-center justify-center shrink-0
                        transition-all duration-[var(--dur-fast)] active:scale-90
                        ${sub.done
                          ? 'bg-mint-d border-mint-d text-white'
                          : 'border-bd text-transparent hover:border-mint-d hover:text-mint-d/40'
                        }
                      `}
                    >
                      <CheckIcon className="w-4 h-4" />
                    </button>
                    <span
                      className={`flex-1 text-sm truncate ${
                        sub.done ? 'line-through text-tm' : 'text-tp'
                      }`}
                    >
                      {sub.title}
                    </span>
                    <button
                      onClick={() => onDeleteSubtask(task.id, sub.id)}
                      aria-label={t.common.delete}
                      className="w-10 h-10 rounded-full flex items-center justify-center text-tm
                                 hover:text-red-500 hover:bg-red-500/10 active:scale-90
                                 transition-all duration-[var(--dur-fast)] shrink-0"
                    >
                      <TrashIcon className="w-4 h-4" />
                    </button>
                  </div>
                ))}

                {/* Add new checklist item */}
                <div className="flex items-center gap-3">
                  <input
                    type="text"
                    value={subtaskDraft}
                    readOnly
                    onFocus={() => setKeyboardTarget('subtask')}
                    placeholder={t.tasks.subtaskPlaceholder}
                    className="flex-1 h-12 px-4 rounded-xl border border-bd bg-s2 text-tp text-sm
                               placeholder:text-tm focus:outline-none focus:ring-2 focus:ring-acc/30"
                  />
                  <button
                    onClick={handleAddSubtask}
                    disabled={!subtaskDraft.trim()}
                    className="flex items-center gap-1.5 px-4 h-12 rounded-xl bg-acc text-white
                               font-semibold text-sm active:scale-95
                               transition-all duration-[var(--dur-fast)]
                               disabled:opacity-40 disabled:pointer-events-none shrink-0"
                  >
                    <PlusIcon className="w-5 h-5" />
                    {t.tasks.addSubtask}
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* Due date toggle + picker */}
          <div>
            <div className="flex items-center justify-between mb-3">
              <label className="text-sm font-semibold text-tp">{t.tasks.dueDate}</label>
              <button
                onClick={() => {
                  setHasDueDate((v) => !v);
                  if (!hasDueDate && !dueDate) {
                    const today = new Date();
                    setDueDate(toDateStr(today.getDate(), today.getMonth(), today.getFullYear()));
                  }
                }}
                className={`
                  px-4 h-10 rounded-xl text-sm font-medium transition-all duration-[var(--dur-fast)]
                  ${hasDueDate
                    ? 'bg-acc text-white'
                    : 'bg-s2 text-ts border border-bd'
                  }
                `}
              >
                {hasDueDate ? formatDate(dueDate) || t.tasks.dueDate : t.tasks.noDueDate}
              </button>
            </div>
            {hasDueDate && (
              <DatePicker
                value={dueDate}
                onChange={setDueDate}
              />
            )}
          </div>

          {/* Priority */}
          <div>
            <label className="block text-sm font-semibold text-tp mb-3">{t.tasks.priority}</label>
            <div className="flex gap-3">
              {PRIORITIES.map((p) => (
                <button
                  key={p.value}
                  onClick={() => setPriority(p.value)}
                  className={`
                    flex items-center gap-2 px-4 h-12 rounded-xl border text-sm font-medium
                    transition-all duration-[var(--dur-fast)] flex-1 justify-center
                    ${priority === p.value
                      ? 'border-acc bg-acc/10 text-acc'
                      : 'border-bd bg-s2 text-ts'
                    }
                  `}
                >
                  {p.color && (
                    <span
                      className="w-3 h-3 rounded-full shrink-0"
                      style={{ backgroundColor: p.color }}
                    />
                  )}
                  {p.label}
                </button>
              ))}
            </div>
          </div>

          {/* Star toggle */}
          <div>
            <button
              onClick={() => setStarred((v) => !v)}
              className={`
                flex items-center gap-3 px-4 h-14 rounded-xl border w-full
                transition-all duration-[var(--dur-fast)]
                ${starred ? 'border-amber-400 bg-gold' : 'border-bd bg-s2'}
              `}
            >
              <StarIcon filled={starred} className={`w-6 h-6 ${starred ? 'text-amber-400' : 'text-tm'}`} />
              <span className={`text-sm font-medium ${starred ? 'text-amber-700' : 'text-ts'}`}>
                {t.tasks.important}
              </span>
            </button>
          </div>

          {/* Bottom spacer for buttons */}
          <div className="h-4" />
        </div>

        {/* Action buttons */}
        <div className="shrink-0 flex items-center gap-3 px-6 py-4 border-t border-bd bg-surf">
          {!isNew && (
            <button
              onClick={handleDelete}
              className="flex items-center gap-2 px-5 h-14 rounded-xl bg-red-500/10 text-red-500
                         font-semibold text-sm hover:bg-red-500/20 active:scale-95
                         transition-all duration-[var(--dur-fast)]"
            >
              <TrashIcon className="w-5 h-5" />
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
            disabled={!title.trim()}
            className="px-8 h-14 rounded-xl bg-acc text-white font-semibold text-sm
                       hover:bg-acc/90 active:scale-95 transition-all duration-[var(--dur-fast)]
                       disabled:opacity-40 disabled:pointer-events-none"
          >
            {t.common.save}
          </button>
        </div>
      </div>

      {/* On-screen keyboard */}
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

// ─── TasksPage ──────────────────────────────────────────────────────────────

export default function TasksPage() {
  const {
    tasks,
    columns,
    loading,
    createTask,
    updateTask,
    reorderTasks,
    deleteTask,
    clearCompleted,
    addSubtask,
    updateSubtask,
    deleteSubtask,
    refetch,
  } = useTasks();

  const addToast = useStore((s) => s.addToast);

  // Column names are configurable in Settings (taskCol1/2/3)
  const colName1 = useStore((s) => s.settings.taskCol1);
  const colName2 = useStore((s) => s.settings.taskCol2);
  const colName3 = useStore((s) => s.settings.taskCol3);
  const columnDefs = useMemo(() => {
    const names = [colName1, colName2, colName3];
    return COLUMNS.map((col, i) => ({
      ...col,
      label: names[i]?.trim() || col.label,
    }));
  }, [colName1, colName2, colName3]);

  // Pull to refresh
  const { pullDistance, isPulling, bind: pullBind } = usePullToRefresh(refetch);

  // Overlay state
  const [overlayTask, setOverlayTask] = useState(null); // task object or 'new'
  const [overlayOpen, setOverlayOpen] = useState(false);

  // Drag state
  const [draggedTask, setDraggedTask] = useState(null);
  const [dragGhost, setDragGhost] = useState(null); // { x, y, width, height }
  const [dropTarget, setDropTarget] = useState(null); // { col, index } insertion point under the pointer
  const dragSourceCol = useRef(null);
  const dragCardRect = useRef(null);
  const touchOffsetRef = useRef({ x: 0, y: 0 });
  const columnRefs = useRef({});

  // ── Open overlay ─────────────────────────────────────────────────────────
  const openOverlay = useCallback((task) => {
    setOverlayTask(task);
    setOverlayOpen(true);
  }, []);

  const openNewTask = useCallback(() => {
    setOverlayTask('new');
    setOverlayOpen(true);
  }, []);

  const closeOverlay = useCallback(() => {
    setOverlayOpen(false);
    setOverlayTask(null);
  }, []);

  // ── Save handler ─────────────────────────────────────────────────────────
  const handleSave = useCallback(
    async (taskData) => {
      if (overlayTask === 'new') {
        await createTask(taskData);
      } else {
        await updateTask(taskData.id, taskData);
      }
      closeOverlay();
    },
    [overlayTask, createTask, updateTask, closeOverlay]
  );

  // ── Delete handler ───────────────────────────────────────────────────────
  const handleDelete = useCallback(
    async (id) => {
      await deleteTask(id);
      closeOverlay();
    },
    [deleteTask, closeOverlay]
  );


  // ── Subtask handlers ─────────────────────────────────────────────────────
  const handleAddSubtask = useCallback((taskId, title) => addSubtask(taskId, title), [addSubtask]);
  const handleToggleSubtask = useCallback(
    (taskId, sub) => updateSubtask(taskId, sub.id, { done: !sub.done }),
    [updateSubtask]
  );
  const handleDeleteSubtask = useCallback(
    (taskId, subId) => deleteSubtask(taskId, subId),
    [deleteSubtask]
  );

  // ── Drag-and-drop system ─────────────────────────────────────────────────

  const cancelDrag = useCallback(() => {
    setDraggedTask(null);
    setDragGhost(null);
    setDropTarget(null);
    dragSourceCol.current = null;
    dragCardRect.current = null;
  }, []);

  const handleDragStart = useCallback((task, e, cardEl) => {
    if (!cardEl) return;
    const rect = cardEl.getBoundingClientRect();
    dragCardRect.current = rect;

    // Record source column
    dragSourceCol.current = task.status;

    const touch = e.touches ? e.touches[0] : e;
    touchOffsetRef.current = {
      x: touch.clientX - rect.left,
      y: touch.clientY - rect.top,
    };

    setDraggedTask(task);
    setDragGhost({
      x: rect.left,
      y: rect.top,
      width: rect.width,
      height: rect.height,
    });
    // Prevent scroll while dragging
    e.preventDefault?.();
  }, []);

  // Detect the drop point (column + insertion index) under a pointer.
  // The index counts only non-dragged cards in that column.
  const detectDropPoint = useCallback((clientX, clientY, draggedId) => {
    for (const [key, el] of Object.entries(columnRefs.current)) {
      if (!el) continue;
      const rect = el.getBoundingClientRect();
      if (
        clientX >= rect.left &&
        clientX <= rect.right &&
        clientY >= rect.top &&
        clientY <= rect.bottom
      ) {
        const cards = [...el.querySelectorAll('[data-task-id]')].filter(
          (c) => c.dataset.taskId !== draggedId
        );
        let index = cards.length;
        for (let i = 0; i < cards.length; i++) {
          const r = cards[i].getBoundingClientRect();
          if (clientY < r.top + r.height / 2) {
            index = i;
            break;
          }
        }
        return { col: key, index };
      }
    }
    return null;
  }, []);

  const handleGlobalMove = useCallback(
    (e) => {
      if (!draggedTask) return;
      e.preventDefault();
      const point = e.touches ? e.touches[0] : e;
      const x = point.clientX - touchOffsetRef.current.x;
      const y = point.clientY - touchOffsetRef.current.y;

      setDragGhost((prev) => (prev ? { ...prev, x, y } : null));

      setDropTarget(detectDropPoint(point.clientX, point.clientY, draggedTask.id));
    },
    [draggedTask, detectDropPoint]
  );

  const handleGlobalTouchEnd = useCallback(() => {
    if (!draggedTask) return;

    if (dropTarget) {
      const targetCol = dropTarget.col;
      const moved = targetCol !== dragSourceCol.current;

      // New order for the target column: existing tasks minus the dragged
      // one, with the dragged task spliced in at the insertion index
      const targetItems = (columns[targetCol] || []).filter(
        (task) => task.id !== draggedTask.id
      );
      targetItems.splice(Math.min(dropTarget.index, targetItems.length), 0, draggedTask);

      const updates = [];
      targetItems.forEach((item, i) => {
        if (item.status !== targetCol || item.position !== i) {
          updates.push({ id: item.id, status: targetCol, position: i });
        }
      });
      // Reindex the source column so its positions stay contiguous
      if (moved) {
        (columns[dragSourceCol.current] || [])
          .filter((task) => task.id !== draggedTask.id)
          .forEach((task, i) => {
            if (task.position !== i) {
              updates.push({ id: task.id, status: task.status, position: i });
            }
          });
      }

      if (updates.length > 0) {
        reorderTasks(updates);
        if (moved) addToast('success', t.tasks.taskMoved);
      }
    }
    // No drop target → cancel (snap back, no action)

    cancelDrag();
  }, [draggedTask, dropTarget, columns, reorderTasks, addToast, cancelDrag]);

  // Escape key to cancel drag
  useEffect(() => {
    if (!draggedTask) return;
    const handleKeyDown = (e) => {
      if (e.key === 'Escape') {
        cancelDrag();
      }
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [draggedTask, cancelDrag]);

  // Register global touch/mouse listeners for drag
  useEffect(() => {
    if (!draggedTask) return;

    const moveHandler = (e) => handleGlobalMove(e);
    const endHandler = () => handleGlobalTouchEnd();

    document.addEventListener('touchmove', moveHandler, { passive: false });
    document.addEventListener('touchend', endHandler);
    document.addEventListener('touchcancel', endHandler);
    document.addEventListener('mousemove', moveHandler);
    document.addEventListener('mouseup', endHandler);

    return () => {
      document.removeEventListener('touchmove', moveHandler);
      document.removeEventListener('touchend', endHandler);
      document.removeEventListener('touchcancel', endHandler);
      document.removeEventListener('mousemove', moveHandler);
      document.removeEventListener('mouseup', endHandler);
    };
  }, [draggedTask, handleGlobalMove, handleGlobalTouchEnd]);

  // ── Loading state ────────────────────────────────────────────────────────
  if (loading) return <TasksSkeleton />;

  return (
    <div className="relative flex flex-col h-full overflow-hidden">
      {/* Pull-to-refresh indicator */}
      {isPulling && (
        <div
          className="shrink-0 flex items-center justify-center overflow-hidden transition-all duration-[var(--dur-fast)]"
          style={{ height: `${pullDistance}px` }}
        >
          <div
            className={`w-6 h-6 border-2 border-acc border-t-transparent rounded-full
              ${pullDistance > 24 ? 'pull-refresh-spinner' : ''}`}
          />
        </div>
      )}

      {/* Kanban columns */}
      <div className="flex flex-1 gap-5 p-6 overflow-x-auto" {...pullBind}>
        {columnDefs.map((col) => {
          const items = columns[col.key] || [];
          const isDone = col.key === 'done';
          const isDropHere = dropTarget?.col === col.key;

          // The drop index counts non-dragged cards; map it back onto the
          // rendered list (which still contains the dragged card) so the
          // indicator lands in the right visual spot
          let indicatorIdx = isDropHere ? dropTarget.index : null;
          const dragIdx = items.findIndex((task) => task.id === draggedTask?.id);
          if (indicatorIdx != null && dragIdx !== -1 && dragIdx < indicatorIdx) {
            indicatorIdx += 1;
          }

          return (
            <div
              key={col.key}
              ref={(el) => { columnRefs.current[col.key] = el; }}
              className={`
                flex-1 min-w-[280px] flex flex-col rounded-2xl
                transition-all duration-[var(--dur-fast)]
                ${COLUMN_BG[col.key]}
              `}
              style={isDropHere ? {
                outline: '2px dashed var(--acc)',
                outlineOffset: '-2px',
                transform: 'scale(1.01)',
              } : undefined}
            >
              {/* Column header */}
              <div className="flex items-center gap-3 px-5 py-4 shrink-0">
                <h3 className="text-base font-semibold text-tp">{col.label}</h3>
                <span
                  className={`
                    flex items-center justify-center min-w-[28px] h-7
                    rounded-full px-2 text-xs font-bold
                    ${COLUMN_BADGE[col.key]}
                  `}
                >
                  {items.length}
                </span>
              </div>

              {/* Cards area */}
              <div className="flex-1 overflow-y-auto px-4 pb-4">
                {items.length === 0 && !isDropHere ? (
                  <div className="flex items-center justify-center h-full border-2 border-dashed border-bd/50 rounded-2xl py-12">
                    <span className="text-tm text-sm">{t.empty.noTasks}</span>
                  </div>
                ) : (
                  <div className="flex flex-col gap-3">
                    {items.map((task, i) => (
                      <Fragment key={task.id}>
                        {indicatorIdx === i && <DropIndicator />}
                        <TaskCard
                          task={task}
                          index={i}
                          isDone={isDone}
                          onTap={openOverlay}
                          onDragStart={handleDragStart}
                          isBeingDragged={draggedTask?.id === task.id}
                        />
                      </Fragment>
                    ))}
                    {indicatorIdx === items.length && <DropIndicator />}
                  </div>
                )}
              </div>

              {/* Clear completed button for done column */}
              {isDone && items.length > 0 && (
                <div className="shrink-0 px-4 pb-4">
                  <button
                    onClick={clearCompleted}
                    className="ripple w-full h-12 rounded-xl bg-mint-d/10 text-mint-d font-semibold text-sm
                               hover:bg-mint-d/20 active:scale-95 transition-all duration-[var(--dur-fast)]"
                  >
                    {t.tasks.clearCompleted}
                  </button>
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Drag ghost — floating clone following finger */}
      {dragGhost && draggedTask && (
        <div
          className="fixed pointer-events-none"
          style={{
            left: dragGhost.x,
            top: dragGhost.y,
            width: dragGhost.width,
            zIndex: 100,
            transform: 'scale(1.03)',
            opacity: 0.92,
            transition: 'transform var(--dur-fast)',
          }}
        >
          <div className="bg-surf border border-acc/30 rounded-xl p-4 shadow-raised">
            <div className="flex items-start gap-3">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  {draggedTask.priority && draggedTask.priority !== 'none' && (
                    <span className={`w-2.5 h-2.5 rounded-full ${PRIORITY_DOT_COLOR[draggedTask.priority]}`} />
                  )}
                  <span className="text-sm font-medium text-tp line-clamp-1 flex-1">
                    {draggedTask.title}
                  </span>
                  {draggedTask.starred && (
                    <span className="text-amber-400 shrink-0">
                      <StarIcon filled className="w-4 h-4" />
                    </span>
                  )}
                </div>
                {/* Due date row in ghost */}
                {draggedTask.dueDate && (
                  <div className="flex items-center gap-1 mt-2 text-xs text-ts font-mono">
                    <CalendarIcon className="w-3.5 h-3.5" />
                    {formatDate(draggedTask.dueDate)}
                  </div>
                )}
              </div>
              <div className="text-tm/40 mt-0.5 shrink-0">
                <GripIcon className="w-4 h-4" />
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Floating add button */}
      <button
        onClick={openNewTask}
        className="ripple absolute bottom-6 start-6 w-14 h-14 rounded-full bg-acc text-white
                   shadow-raised flex items-center justify-center
                   hover:bg-acc/90 active:scale-95 transition-all duration-[var(--dur-fast)]"
        aria-label={t.tasks.addTask}
      >
        <PlusIcon />
      </button>

      {/* Task detail overlay */}
      {overlayOpen && (
        <TaskDetailOverlay
          task={overlayTask === 'new' ? null : overlayTask}
          isNew={overlayTask === 'new'}
          tasks={tasks}
          onSave={handleSave}
          onDelete={handleDelete}
          onClose={closeOverlay}
          onAddSubtask={handleAddSubtask}
          onToggleSubtask={handleToggleSubtask}
          onDeleteSubtask={handleDeleteSubtask}
        />
      )}

      {/* Inline keyframe for task card entrance + overlay */}
      <style>{`
        @keyframes taskCardIn {
          0% {
            opacity: 0;
            transform: translateY(12px);
          }
          100% {
            opacity: 1;
            transform: translateY(0);
          }
        }
        @keyframes taskOverlayUp {
          0% {
            transform: translateY(100%);
          }
          100% {
            transform: translateY(0);
          }
        }
      `}</style>
    </div>
  );
}
