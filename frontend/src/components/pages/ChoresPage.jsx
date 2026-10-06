import { useState, useRef, useCallback, useMemo, useEffect } from 'react';
import { createPortal } from 'react-dom';
import t from '../../i18n/he.json';
import useStore from '../../store/index.js';
import { TasksSkeleton } from '../Skeleton.jsx';
import OnScreenKeyboard from '../OnScreenKeyboard.jsx';
import useChores from "../../hooks/useChores.js";
import CelebrationAnimation from '../CelebrationAnimation.jsx';
import { insertionPoint, moveNextTo } from '../../hooks/choreOrder.js';

// ─── Recurrence config ─────────────────────────────────────────────────────

// The IR frame can register one touch twice, and the Pi is slow enough that a tap
// shows nothing for a moment, so people tap again. Either one would undo the tap:
// a chore ignores a second toggle this soon after the first.
const TOGGLE_LOCKOUT_MS = 500;
// With "hide completed", a chore that vanishes the instant it is ticked pulls the
// next one under the finger. Ticked chores stay this long after the last tap.
const JUST_DONE_MS = 4000;

const RECURRENCE_OPTIONS = [
  { value: 'daily', label: t.tasks.recurrenceDaily },
  { value: 'weekly', label: t.tasks.recurrenceWeekly },
  { value: 'once', label: t.tasks.recurrenceOnce },
];

// ─── SVG Icons ─────────────────────────────────────────────────────────────

function PlusIcon({ className = 'w-5 h-5' }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"
      strokeLinecap="round" strokeLinejoin="round" className={className}>
      <line x1="12" y1="5" x2="12" y2="19" />
      <line x1="5" y1="12" x2="19" y2="12" />
    </svg>
  );
}

function CheckIcon({ className = 'w-5 h-5' }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"
      strokeLinecap="round" strokeLinejoin="round" className={className}>
      <polyline points="20 6 9 17 4 12" />
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

function TrashIcon({ className = 'w-4 h-4' }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
      strokeLinecap="round" strokeLinejoin="round" className={className}>
      <polyline points="3 6 5 6 21 6" />
      <path d="M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2" />
    </svg>
  );
}

// ─── Date helpers ──────────────────────────────────────────────────────────

function isOverdue(dateStr) {
  if (!dateStr) return false;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const due = new Date(dateStr + 'T00:00:00');
  return due < today;
}

// ─── Progress Ring SVG ─────────────────────────────────────────────────────

function ProgressRing({ progress, color, size = 68, strokeWidth = 4 }) {
  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference - progress * circumference;
  const isComplete = progress >= 1;

  return (
    <svg width={size} height={size} className="absolute inset-0 pointer-events-none">
      {/* Background ring */}
      <circle
        cx={size / 2}
        cy={size / 2}
        r={radius}
        fill="none"
        stroke="var(--bd)"
        strokeWidth={strokeWidth}
      />
      {/* Progress ring */}
      <circle
        cx={size / 2}
        cy={size / 2}
        r={radius}
        fill="none"
        stroke={color}
        strokeWidth={strokeWidth}
        strokeLinecap="round"
        strokeDasharray={circumference}
        strokeDashoffset={offset}
        transform={`rotate(-90 ${size / 2} ${size / 2})`}
        style={{ transition: 'stroke-dashoffset var(--dur-slow) var(--ease-out)' }}
        className={isComplete ? 'celebration-ring-pulse' : ''}
      />
    </svg>
  );
}

// ─── Avatar with initials ──────────────────────────────────────────────────

function PersonAvatar({ personId, name, color, progress, photo, onPhotoChange }) {
  const initials = name.charAt(0);
  const isComplete = progress >= 1;
  const fileInputRef = useRef(null);
  const addToast = useStore((s) => s.addToast);

  const handlePhotoClick = useCallback(() => {
    if (fileInputRef.current) fileInputRef.current.click();
  }, []);

  const handleFileChange = useCallback((e) => {
    const file = e.target.files?.[0];
    // Reset so picking the same file again re-fires onChange
    e.target.value = '';
    if (!file) return;
    if (!file.type.startsWith('image/')) {
      addToast('error', t.tasks.photoUploadError);
      return;
    }
    // Resize and convert to base64
    const reader = new FileReader();
    reader.onerror = () => addToast('error', t.tasks.photoUploadError);
    reader.onload = (ev) => {
      const img = new Image();
      img.onerror = () => addToast('error', t.tasks.photoUploadError);
      img.onload = () => {
        // Resize to 120x120 for performance
        const canvas = document.createElement('canvas');
        canvas.width = 120;
        canvas.height = 120;
        const ctx = canvas.getContext('2d');
        // Crop to square center
        const size = Math.min(img.width, img.height);
        const sx = (img.width - size) / 2;
        const sy = (img.height - size) / 2;
        ctx.drawImage(img, sx, sy, size, size, 0, 0, 120, 120);
        const dataUrl = canvas.toDataURL('image/jpeg', 0.8);
        if (onPhotoChange) onPhotoChange(personId, dataUrl);
      };
      img.src = ev.target.result;
    };
    reader.readAsDataURL(file);
  }, [personId, onPhotoChange, addToast]);

  return (
    <div className="relative flex items-center justify-center" style={{ width: 68, height: 68 }}>
      <ProgressRing progress={progress} color={color} />
      <button
        type="button"
        onClick={handlePhotoClick}
        aria-label={t.tasks.uploadPhoto}
        title={t.tasks.uploadPhoto}
        className={`
          w-[60px] h-[60px] rounded-full flex items-center justify-center
          text-white text-xl font-bold select-none cursor-pointer
          transition-shadow duration-[var(--dur-slow)] overflow-hidden
          ${isComplete ? 'avatar-pulse-glow' : ''}
        `}
        style={{
          backgroundColor: color,
          boxShadow: isComplete ? `0 0 16px ${color}66, 0 0 32px ${color}33` : 'none',
        }}
      >
        {photo ? (
          <img src={photo} alt={name} className="w-full h-full object-cover" />
        ) : (
          initials
        )}
      </button>
      {/* Small camera badge */}
      {!photo && (
        <div className="absolute -bottom-0.5 -left-0.5 w-5 h-5 rounded-full bg-[var(--acc)] flex items-center justify-center shadow-card">
          <svg viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="w-3 h-3">
            <path d="M23 19a2 2 0 01-2 2H3a2 2 0 01-2-2V8a2 2 0 012-2h4l2-3h6l2 3h4a2 2 0 012 2z"/>
            <circle cx="12" cy="13" r="4"/>
          </svg>
        </div>
      )}
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={handleFileChange}
      />
    </div>
  );
}

// ─── TaskCard component ────────────────────────────────────────────────────

// Preload clap sound
const clapSound = typeof Audio !== 'undefined' ? new Audio() : null;
if (clapSound) {
  // Use a short clap — data URI for a tiny click/clap sound
  clapSound.preload = 'auto';
  clapSound.volume = 0.5;
  // Will try /sounds/clap.mp3, fallback silently
  clapSound.src = '/sounds/clap.mp3';
}

function playClap() {
  if (!clapSound) return;
  clapSound.currentTime = 0;
  clapSound.play().catch(() => {});
}

// Clap hands emoji burst on single task completion
function ClapBurst({ onDone }) {
  const [particles, setParticles] = useState([]);

  useEffect(() => {
    const emojis = ['👏', '👏🏻', '👏🏽', '⭐', '✨', '🎉', '💪', '🌟', '👍'];
    const newParticles = Array.from({ length: 30 }, (_, i) => ({
      id: i,
      emoji: emojis[Math.floor(Math.random() * emojis.length)],
      x: (Math.random() - 0.5) * 400,
      y: -(Math.random() * 250 + 60),
      rotation: (Math.random() - 0.5) * 120,
      scale: 1.0 + Math.random() * 1.2,
      delay: Math.random() * 600,
    }));
    setParticles(newParticles);
    const timer = setTimeout(() => { if (onDone) onDone(); }, 2500);
    return () => clearTimeout(timer);
  }, [onDone]);

  return (
    <div className="absolute inset-0 pointer-events-none overflow-visible z-10">
      {particles.map((p) => (
        <div
          key={p.id}
          className="absolute"
          style={{
            left: '50%',
            top: '50%',
            fontSize: `${p.scale * 36}px`,
            transform: `translate(-50%, -50%)`,
            animation: `clapParticle 2s ease-out ${p.delay}ms forwards`,
            '--clap-x': `${p.x}px`,
            '--clap-y': `${p.y}px`,
            '--clap-rot': `${p.rotation}deg`,
          }}
        >
          {p.emoji}
        </div>
      ))}
    </div>
  );
}

function GripIcon({ className = 'w-6 h-6' }) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" className={className} aria-hidden="true">
      <circle cx="9" cy="6" r="1.6" /><circle cx="15" cy="6" r="1.6" />
      <circle cx="9" cy="12" r="1.6" /><circle cx="15" cy="12" r="1.6" />
      <circle cx="9" cy="18" r="1.6" /><circle cx="15" cy="18" r="1.6" />
    </svg>
  );
}

function TaskCard({ task, personColor, onToggle, onDelete, onClap, onDragStart, isBeingDragged, dropEdge }) {
  const cardRef = useRef(null);
  const isComplete = task.completed;
  const overdue = !isComplete && isOverdue(task.dueDate);
  const [justToggled, setJustToggled] = useState(false);
  const lastToggleRef = useRef(0);

  const recurrenceLabel = useMemo(() => {
    const found = RECURRENCE_OPTIONS.find((r) => r.value === task.recurrence);
    return found ? found.label : '';
  }, [task.recurrence]);

  const handleToggle = useCallback(() => {
    const now = Date.now();
    if (now - lastToggleRef.current < TOGGLE_LOCKOUT_MS) return;
    lastToggleRef.current = now;
    const wasIncomplete = !task.completed;
    setJustToggled(true);
    setTimeout(() => setJustToggled(false), 500);
    if (wasIncomplete) {
      playClap();
      if (onClap) onClap();
    }
    onToggle(task.id);
  }, [onToggle, onClap, task.id, task.completed]);

  const handleDelete = useCallback(
    (e) => {
      e.stopPropagation();
      onDelete(task.id);
    },
    [onDelete, task.id]
  );

  // Pastel tokens, not raw hex: --mint-bg / --coral-bg are redefined under
  // [data-theme="dark"], so these follow the app's own theme toggle. A `dark:`
  // variant would not — Tailwind's darkMode here is prefers-color-scheme, which
  // tracks the OS rather than the toggle.
  const bgClass = isComplete
    ? 'bg-[var(--mint-bg)]'
    : overdue
      ? 'bg-[var(--coral-bg)]'
      : 'bg-[var(--surf)]';

  return (
    // Card shell is a plain container: the toggle button and the delete button are
    // SIBLINGS inside it, never nested (nested interactive elements are invalid
    // HTML and made the delete action unreachable by keyboard/switch access).
    <div
      ref={cardRef}
      data-chore-id={task.id}
      data-chore-group={isComplete ? 'done' : 'open'}
      className={`
        relative flex items-center rounded-xl
        border border-[var(--bd)]
        transition-all duration-[var(--dur-fast)]
        active:scale-[0.98]
        min-h-[56px]
        ${bgClass}
        ${isBeingDragged ? 'opacity-40 border-dashed' : ''}
      `}
      style={{ borderInlineStart: `3px solid ${personColor}` }}
    >
      {/* Where the dragged chore would land. Drawn over the gap between cards,
          not as a list item, so nothing shifts and the drop point cannot flicker. */}
      {dropEdge && (
        <div
          aria-hidden="true"
          className={`absolute inset-x-1 h-1.5 rounded-full bg-[var(--acc)] opacity-70 pointer-events-none
                      ${dropEdge === 'before' ? '-top-[7px]' : '-bottom-[7px]'}`}
        />
      )}

      {/* Drag handle - press and move to reorder. At the start edge, as far as
          possible from the delete button. touch-none stops the browser from
          scrolling the column instead of dragging. */}
      {onDragStart && (
        <button
          type="button"
          data-no-swipe
          onMouseDown={(e) => onDragStart(task, e, cardRef.current)}
          onTouchStart={(e) => onDragStart(task, e, cardRef.current)}
          aria-label={t.tasks.dragToReorder.replace('{title}', task.title)}
          className="flex-shrink-0 min-w-[44px] min-h-[56px] flex items-center justify-center
                     text-[var(--ts)] cursor-grab touch-none select-none"
        >
          <GripIcon />
        </button>
      )}

      {/* Card body — tap to toggle. Fills the row apart from the delete target. */}
      <button
        type="button"
        onClick={handleToggle}
        data-clap-target
        aria-pressed={isComplete}
        aria-label={`${task.title}${isComplete ? ` — ${t.tasks.done}` : ''}${overdue ? ` — ${t.tasks.overdue}` : ''}`}
        className="flex-1 min-w-0 flex items-center gap-3 ps-1 py-3 rounded-xl"
      >
        {/* Checkbox — purely decorative: state is announced by the button label */}
        <div
          aria-hidden="true"
          className={`
            relative flex-shrink-0 w-[44px] h-[44px] rounded-full
            flex items-center justify-center
            border-2 transition-all duration-[var(--dur-normal)]
            ${isComplete
              ? 'border-[var(--acc2)] bg-[var(--acc2)]'
              : 'border-[var(--tm)] bg-transparent'}
            ${justToggled ? 'task-checkbox-animate' : ''}
          `}
        >
          {isComplete && (
            <CheckIcon className="w-5 h-5 text-white" />
          )}
        </div>

        {/* Content */}
        <div className="flex-1 flex flex-col items-start gap-0.5 min-w-0">
          <div className="flex items-center gap-2 w-full">
            {task.emoji && <span className="text-lg" aria-hidden="true">{task.emoji}</span>}
            <span
              className={`
                text-sm font-medium text-start leading-snug truncate
                transition-all duration-[var(--dur-normal)]
                ${isComplete ? 'line-through text-[var(--ts)]' : 'text-[var(--tp)]'}
              `}
            >
              {task.title}
            </span>
          </div>
          {recurrenceLabel && (
            <span className="text-xs text-[var(--tm)]">
              {recurrenceLabel}
            </span>
          )}
        </div>
      </button>

      {/* Delete — a real focusable button; 56x56 hit area, 32px visual chip */}
      <button
        type="button"
        onClick={handleDelete}
        aria-label={t.tasks.deleteChore.replace('{title}', task.title)}
        className="group flex-shrink-0 min-w-[56px] min-h-[56px] flex items-center justify-center"
      >
        {/* No /opacity modifier on a var() colour: Tailwind cannot split a var()
            into channels, so `bg-[var(--coral-bg)]/30` emits no rule at all. The
            pastel token at full strength is already a soft wash, and it follows
            data-theme the way the coral-d text beside it does. */}
        <span
          className="w-8 h-8 rounded-full flex items-center justify-center text-[var(--tm)]
                     group-hover:text-[var(--coral-d)] group-hover:bg-[var(--coral-bg)]
                     transition-colors"
        >
          <TrashIcon />
        </span>
      </button>
    </div>
  );
}

// ─── PersonColumn component ────────────────────────────────────────────────

function PersonColumn({
  person,
  hideCompleted,
  onToggleTask,
  onAddTask,
  onDeleteTask,
  onReorderTasks,
  onPhotoChange,
}) {
  const columnRef = useRef(null);
  const [celebration, setCelebration] = useState(null);
  const [showClap, setShowClap] = useState(false);
  const [addingTask, setAddingTask] = useState(false);

  const totalTasks = person.tasks.length;
  const completedTasks = person.tasks.filter((t) => t.completed).length;
  const progress = totalTasks > 0 ? completedTasks / totalTasks : 0;
  const allDone = totalTasks > 0 && completedTasks === totalTasks;

  const [justDone, setJustDone] = useState(() => new Set());
  const justDoneTimer = useRef(null);
  useEffect(() => () => clearTimeout(justDoneTimer.current), []);

  // Chores stay where they are when ticked, in the saved (draggable) order. They
  // used to drop to the bottom, which moved the next chore under the finger and
  // on this slow IR frame the next tap landed on it.
  const sortedTasks = useMemo(
    () => (hideCompleted ? person.tasks.filter((t) => !t.completed || justDone.has(t.id)) : person.tasks),
    [person.tasks, hideCompleted, justDone]
  );

  const handleToggle = useCallback(
    async (taskId) => {
      if (!person.tasks.find((x) => x.id === taskId)?.completed) {
        setJustDone((set) => new Set(set).add(taskId));
        clearTimeout(justDoneTimer.current);
        justDoneTimer.current = setTimeout(() => setJustDone(new Set()), JUST_DONE_MS);
      }
      const result = await onToggleTask(person.id, taskId);
      if (result && result.justCompleted) {
        setCelebration({
          personName: result.personName,
          personColor: result.personColor,
        });
      }
    },
    [onToggleTask, person.id, person.tasks]
  );

  const handleDelete = useCallback(
    (taskId) => {
      onDeleteTask(person.id, taskId);
    },
    [onDeleteTask, person.id]
  );

  const handleCelebrationComplete = useCallback(() => {
    setCelebration(null);
  }, []);

  // ── Drag to reorder (inside this kid's column only) ──────────────────────
  const listRef = useRef(null);
  const ghostRef = useRef(null);
  const dragRef = useRef(null); // facts the document listeners read; not state, so moves cost no re-render
  const insertRef = useRef(null); // mirrors `insert`, for the listeners
  const tasksRef = useRef(person.tasks);
  tasksRef.current = person.tasks;
  const lastTouchRef = useRef(0);
  const [drag, setDrag] = useState(null); // { task, left, top, width, height } - fixed for the whole drag
  const [insert, setInsert] = useState(null); // { targetId, after }

  const startDrag = useCallback((task, e, cardEl) => {
    if (!cardEl) return;
    // A touch is followed by a compatibility mousedown; it must not start a second drag.
    if (e.type === 'mousedown' && Date.now() - lastTouchRef.current < 800) return;
    if (e.type === 'touchstart') lastTouchRef.current = Date.now();
    const point = e.touches ? e.touches[0] : e;
    const r = cardEl.getBoundingClientRect();
    dragRef.current = {
      id: task.id,
      offsetY: point.clientY - r.top,
      left: r.left,
    };
    insertRef.current = null;
    setInsert(null);
    setDrag({ task, left: r.left, top: r.top, width: r.width, height: r.height });
  }, []);

  useEffect(() => {
    if (!drag) return undefined;

    const finish = (commit) => {
      const d = dragRef.current;
      const point = insertRef.current;
      dragRef.current = null;
      insertRef.current = null;
      setDrag(null);
      setInsert(null);
      if (!commit || !d || !point) return;
      // Reorder the FULL saved list so chores of the other group keep their place.
      const ids = tasksRef.current.map((x) => x.id);
      const next = moveNextTo(ids, d.id, point.targetId, point.after);
      if (next.some((id, i) => id !== ids[i])) onReorderTasks(person.id, next);
    };

    const onMove = (e) => {
      const d = dragRef.current;
      const list = listRef.current;
      if (!d || !list) return;
      e.preventDefault();
      const pt = e.touches ? e.touches[0] : e;
      if (ghostRef.current) {
        ghostRef.current.style.transform = `translate3d(${d.left}px, ${pt.clientY - d.offsetY}px, 0)`;
      }
      // ponytail: edge auto-scroll steps per move event, so a finger held
      // perfectly still at the edge does not keep scrolling. Switch to a
      // requestAnimationFrame loop if long lists make that annoying.
      const box = list.getBoundingClientRect();
      // 'instant': every scroll container is smooth-scrolling (global.css), and a
      // new smooth scroll started on each move lags behind the finger and lets
      // the chores slide under it.
      if (pt.clientY < box.top + 48) list.scrollBy({ top: -14, behavior: 'instant' });
      else if (pt.clientY > box.bottom - 48) list.scrollBy({ top: 14, behavior: 'instant' });

      const cards = [...list.querySelectorAll('[data-chore-id]')]
        .filter((el) => el.dataset.choreId !== d.id)
        .map((el) => {
          const r = el.getBoundingClientRect();
          return { id: el.dataset.choreId, top: r.top, height: r.height };
        });
      const next = insertionPoint(cards, pt.clientY);
      const prev = insertRef.current;
      if (prev?.targetId !== next?.targetId || prev?.after !== next?.after) {
        insertRef.current = next;
        setInsert(next);
      }
    };

    const onEnd = () => finish(true);
    const onCancel = () => finish(false);
    const onKey = (e) => { if (e.key === 'Escape') finish(false); };

    document.addEventListener('touchmove', onMove, { passive: false });
    document.addEventListener('touchend', onEnd);
    document.addEventListener('touchcancel', onCancel);
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onEnd);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('touchmove', onMove);
      document.removeEventListener('touchend', onEnd);
      document.removeEventListener('touchcancel', onCancel);
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onEnd);
      document.removeEventListener('keydown', onKey);
    };
  }, [drag, onReorderTasks, person.id]);

  const progressText = allDone
    ? t.tasks.allCompleted
    : t.tasks.progressText
        .replace('{completed}', completedTasks)
        .replace('{total}', totalTasks);

  return (
    <div
      ref={columnRef}
      className="relative flex flex-col rounded-2xl border border-[var(--bd)] bg-[var(--surf)] overflow-hidden flex-[1_1_0%] min-w-[220px] pt:min-w-[460px] pt:snap-start"
      
    >
      {/* Clap burst overlay — full column */}
      {showClap && <ClapBurst onDone={() => setShowClap(false)} />}

      {/* Celebration overlay */}
      {celebration && (
        <CelebrationAnimation
          personName={celebration.personName}
          personColor={celebration.personColor}
          columnRef={columnRef}
          onComplete={handleCelebrationComplete}
        />
      )}

      {/* Header */}
      <div className="flex flex-col items-center gap-2 pt-5 pb-3 px-4">
        <PersonAvatar
          personId={person.id}
          name={person.name}
          color={person.color}
          progress={progress}
          photo={person.avatar}
          onPhotoChange={onPhotoChange}
        />
        <span className="text-base font-bold text-[var(--tp)]" style={{ fontWeight: 700 }}>
          {person.name}
        </span>
        <span
          className={`text-xs font-medium ${
            allDone ? 'text-[var(--acc2)]' : 'text-[var(--ts)]'
          }`}
        >
          {allDone ? `✅ ${t.tasks.allCompleted}` : progressText}
        </span>
      </div>

      {/* Progress bar */}
      <div className="mx-4 mb-3 h-[6px] rounded-full bg-[var(--s2)] overflow-hidden">
        <div
          className="h-full rounded-full transition-all duration-[var(--dur-slow)] ease-out"
          style={{
            width: `${progress * 100}%`,
            backgroundColor: person.color,
          }}
        />
      </div>

      {/* Task list */}
      <div ref={listRef} className="flex-1 overflow-y-auto px-3 pt-2 pb-2 flex flex-col gap-2">
        {sortedTasks.map((task) => (
          <TaskCard
            key={task.id}
            task={task}
            personColor={person.color}
            onToggle={handleToggle}
            onDelete={handleDelete}
            onClap={() => setShowClap(true)}
            onDragStart={startDrag}
            isBeingDragged={drag?.task.id === task.id}
            dropEdge={insert && insert.targetId === task.id ? (insert.after ? 'after' : 'before') : null}
          />
        ))}
        {sortedTasks.length === 0 && (
          <div className="flex items-center justify-center py-8 text-sm text-[var(--tm)]">
            {hideCompleted ? t.tasks.allHidden : t.empty.noTasks}
          </div>
        )}
      </div>

      {/* Add task button */}
      <div className="px-3 pb-3 pt-1">
        <button
          onClick={() => setAddingTask(true)}
          className="
            w-full flex items-center justify-center gap-2
            py-3 px-4 rounded-xl
            border border-dashed border-[var(--bd)]
            text-[var(--ts)] text-sm font-medium
            hover:bg-[var(--s2)] hover:text-[var(--tp)]
            active:scale-[0.98]
            transition-all duration-[var(--dur-fast)]
            min-h-[56px]
          "
        >
          <PlusIcon className="w-4 h-4" />
          <span>{t.tasks.addTaskBtn}</span>
        </button>
      </div>

      {/* The chore being dragged, following the finger. Moved by transform only. */}
      {drag && createPortal(
        <div
          ref={ghostRef}
          aria-hidden="true"
          className="fixed left-0 top-0 z-[80] pointer-events-none flex items-center gap-3 px-4
                     rounded-xl border border-[var(--bd)] bg-[var(--surf)] shadow-popover"
          style={{
            width: drag.width,
            height: drag.height,
            transform: `translate3d(${drag.left}px, ${drag.top}px, 0)`,
            borderInlineStart: `3px solid ${person.color}`,
            willChange: 'transform',
          }}
        >
          {drag.task.emoji && <span className="text-lg">{drag.task.emoji}</span>}
          <span className="text-sm font-medium text-[var(--tp)] truncate">{drag.task.title}</span>
        </div>,
        document.body
      )}

      {/* Add task bottom sheet */}
      {addingTask && (
        <AddTaskSheet
          personId={person.id}
          personName={person.name}
          personColor={person.color}
          onAdd={onAddTask}
          onClose={() => setAddingTask(false)}
        />
      )}
    </div>
  );
}

// ─── AddTaskSheet (bottom-sheet overlay) ───────────────────────────────────

// Common chore emojis for the picker
const CHORE_EMOJIS = [
  '🧹', '🧽', '🍽️', '🧺', '🛏️', '🚿', '🧸', '📚',
  '🐕', '🐈', '🌿', '🚗', '🛒', '👕', '🗑️', '💊',
  '🍳', '🥗', '🧃', '🏠', '✏️', '🎒', '🦷', '🧴',
  '🪣', '🧼', '🫧', '🪥', '👶', '🎮', '📱', '⚽',
];

function AddTaskSheet({ personId, personName, personColor, onAdd, onClose }) {
  const [title, setTitle] = useState('');
  const [emoji, setEmoji] = useState('');
  const [recurrence, setRecurrence] = useState('once');
  // The keyboard is the only text input on the kiosk, so it opens with the
  // sheet. It used to start closed and be flipped on by the input's autoFocus,
  // which made the sheet jump position on the first frame every single time.
  const [showKeyboard, setShowKeyboard] = useState(true);
  const [showEmojiPicker, setShowEmojiPicker] = useState(false);
  const [saving, setSaving] = useState(false);
  const inputRef = useRef(null);
  const addToast = useStore((s) => s.addToast);

  useEffect(() => {
    inputRef.current?.focus({ preventScroll: true });
  }, []);

  // Was fire-and-forget: onAdd() unawaited, then onClose() regardless. A failed
  // add closed the sheet, dropped the chore and surfaced nothing but an
  // unhandled rejection in a devtools console nobody has open on a wall panel.
  const handleSave = useCallback(async () => {
    const clean = title.trim();
    if (!clean || saving) return;
    setSaving(true);
    try {
      await onAdd(personId, { title: clean, emoji, recurrence });
      addToast('success', t.tasks.choreAdded);
      onClose();
    } catch {
      addToast('error', t.tasks.choreAddError);
      setSaving(false);
    }
  }, [title, emoji, recurrence, personId, onAdd, onClose, addToast, saving]);

  // Same shell as the Tasks and Calendar editors: a full-width panel resting on
  // the keyboard, a header with a close button, a scrolling body and sticky
  // actions. Portalled so the person column's overflow cannot clip it.
  return createPortal(
    <div
      className="fixed inset-0 z-50 flex flex-col"
      role="dialog"
      aria-modal="true"
      aria-labelledby="new-chore-heading"
      onTouchStart={(e) => e.stopPropagation()}
      onTouchEnd={(e) => e.stopPropagation()}
    >
      {/* Backdrop — no blur: the Pi kiosk runs Chromium in low-end-device mode,
          where the extra compositing layer stops the panel painting at all. */}
      <div
        className="absolute inset-0 bg-black/40"
        onClick={onClose}
        style={{ animation: 'fadeIn var(--dur-fast) var(--ease) forwards' }}
      />

      {/* Panel */}
      <div
        className="relative bg-surf shadow-modal rounded-t-3xl flex flex-col overflow-hidden
                   celebration-sheet-slide-up"
        style={{
          position: showKeyboard ? 'absolute' : 'relative',
          bottom: showKeyboard ? '40%' : '0',
          left: 0,
          right: 0,
          marginTop: showKeyboard ? undefined : 'auto',
          height: showKeyboard ? '60%' : '80%',
          transition: 'height 0.25s ease, bottom 0.25s ease',
        }}
      >
        {/* Header — says whose chore this is */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-bd shrink-0">
          <div className="flex items-center gap-2.5 min-w-0">
            <span
              className="w-2.5 h-2.5 rounded-full shrink-0"
              style={{ backgroundColor: personColor }}
              aria-hidden="true"
            />
            <h2 id="new-chore-heading" className="text-lg font-bold text-tp truncate">
              {t.tasks.newChoreFor.replace('{name}', personName)}
            </h2>
          </div>
          <button
            onClick={onClose}
            className="flex items-center justify-center w-14 h-14 rounded-full text-ts hover:bg-s2
                       active:scale-95 transition-all duration-[var(--dur-fast)] shrink-0"
            aria-label={t.common.cancel}
          >
            <CloseIcon />
          </button>
        </div>

        {/* Scrollable content */}
        <div className="flex-1 overflow-y-auto px-6 py-5 space-y-6">
          {/* Emoji */}
          <div>
            <label className="block text-sm font-semibold text-tp mb-2">
              {t.tasks.choreEmoji}
            </label>
            <div className="flex items-center gap-3">
              <button
                type="button"
                onClick={() => setShowEmojiPicker((v) => !v)}
                aria-label={t.tasks.chooseEmoji}
                aria-expanded={showEmojiPicker}
                className="w-16 h-16 rounded-2xl border-2 flex items-center justify-center text-3xl
                           shrink-0 active:scale-95 transition-all duration-[var(--dur-fast)]"
                style={{
                  borderColor: emoji ? personColor : 'var(--bd)',
                  backgroundColor: emoji ? `${personColor}15` : 'var(--s2)',
                }}
              >
                {emoji || '➕'}
              </button>
              {emoji && (
                <button
                  type="button"
                  onClick={() => setEmoji('')}
                  className="min-w-[56px] h-14 px-4 flex items-center justify-center rounded-xl text-sm
                             text-tm hover:text-coral-d hover:bg-s2 active:scale-95
                             transition-all duration-[var(--dur-fast)]"
                >
                  {t.tasks.removeEmoji}
                </button>
              )}
            </div>
            {showEmojiPicker && (
              <div className="grid grid-cols-8 gap-1.5 p-3 mt-3 rounded-xl bg-s2 border border-bd
                              max-h-[172px] overflow-y-auto">
                {CHORE_EMOJIS.map((e) => (
                  <button
                    key={e}
                    type="button"
                    onClick={() => { setEmoji(e); setShowEmojiPicker(false); }}
                    aria-label={`${t.tasks.chooseEmoji} ${e}`}
                    aria-pressed={emoji === e}
                    className={`
                      w-14 h-14 rounded-xl flex items-center justify-center text-xl
                      transition-all duration-[var(--dur-fast)] active:scale-95
                      ${emoji === e ? 'bg-acc/20 ring-2 ring-acc' : 'hover:bg-bd'}
                    `}
                  >
                    {e}
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Title */}
          <div>
            <label htmlFor="new-chore-title" className="block text-sm font-semibold text-tp mb-2">
              {t.tasks.title}
            </label>
            <input
              ref={inputRef}
              id="new-chore-title"
              type="text"
              inputMode="none"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              onFocus={() => { setShowKeyboard(true); setShowEmojiPicker(false); }}
              onClick={() => { setShowKeyboard(true); setShowEmojiPicker(false); }}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.nativeEvent.isComposing) handleSave();
              }}
              placeholder={t.tasks.titlePlaceholder}
              className="w-full h-14 px-4 rounded-xl border border-bd bg-s2 text-tp text-base
                         placeholder:text-tm focus:outline-none focus:ring-2 focus:ring-acc/30
                         transition-all duration-[var(--dur-fast)]"
              dir="rtl"
            />
          </div>

          {/* Recurrence */}
          <div>
            <label className="block text-sm font-semibold text-tp mb-3">
              {t.tasks.recurrenceLabel}
            </label>
            <div className="flex gap-3">
              {RECURRENCE_OPTIONS.map((option) => (
                <button
                  key={option.value}
                  onClick={() => setRecurrence(option.value)}
                  className={`
                    flex-1 h-14 px-4 rounded-xl border text-sm font-medium
                    transition-all duration-[var(--dur-fast)]
                    ${recurrence === option.value
                      ? 'border-acc bg-acc/10 text-acc'
                      : 'border-bd bg-s2 text-ts'
                    }
                  `}
                >
                  {option.label}
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* Action buttons */}
        <div className="shrink-0 flex items-center gap-3 px-6 py-4 border-t border-bd bg-surf">
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

      {/* On-screen keyboard */}
      <OnScreenKeyboard
        visible={showKeyboard}
        onInput={(char) => setTitle((prev) => prev + char)}
        onBackspace={() => setTitle((prev) => prev.slice(0, -1))}
        onEnter={() => setShowKeyboard(false)}
        onClose={() => setShowKeyboard(false)}
      />
    </div>,
    document.getElementById('root') || document.body
  );
}

// ─── TasksPage (main) ─────────────────────────────────────────────────────

export default function TasksPage() {
  const {
    people,
    loading,
    error,
    hideCompleted,
    toggleHideCompleted,
    toggleTask,
    addTask,
    deleteTask,
    reorderTasks,
    uploadAvatar,
  } = useChores();

  const addToast = useStore((s) => s.addToast);

  // Photo upload — persisted to the backend DB (syncs across devices)
  const handlePhotoChange = useCallback(
    async (personId, dataUrl) => {
      const ok = await uploadAvatar(personId, dataUrl);
      addToast(ok ? 'success' : 'error', ok ? t.tasks.photoUploaded : t.tasks.photoUploadError);
    },
    [uploadAvatar, addToast]
  );

  const peopleWithPhotos = useMemo(() => people || [], [people]);

  // Loading state
  if (loading) {
    return <TasksSkeleton />;
  }

  // Error state — only when there is nothing to show. A failed background poll
  // used to replace the whole board with this screen, so one flaky 2-minute
  // refresh wiped every column until the next one happened to succeed.
  if (error && peopleWithPhotos.length === 0) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="text-center">
          <p className="text-lg text-[var(--ts)] mb-2">{t.errors.noConnection}</p>
          <p className="text-sm text-[var(--tm)]">{error}</p>
        </div>
      </div>
    );
  }

  // Empty state
  if (!peopleWithPhotos || peopleWithPhotos.length === 0) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="text-center">
          <p className="text-5xl mb-3">📋</p>
          <p className="text-lg text-[var(--ts)]">{t.empty.noTasks}</p>
          <p className="text-sm text-[var(--tm)] mt-1">{t.errors.configureInSettings}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full p-4 gap-3">
      {/* Top bar with hide completed toggle */}
      <div className="flex items-center justify-between px-2">
        <h2 className="text-lg font-bold text-[var(--tp)]">
          {t.tabs.tasks}
        </h2>
        <button
          onClick={toggleHideCompleted}
          className={`
            flex items-center gap-2 py-2 px-4 rounded-xl text-sm font-medium
            border transition-all duration-[var(--dur-fast)]
            active:scale-95
            ${hideCompleted
              ? 'border-[var(--acc)] bg-[var(--acc)]/10 text-[var(--acc)]'
              : 'border-[var(--bd)] bg-[var(--s2)] text-[var(--ts)]'
            }
          `}
        >
          <span>{hideCompleted ? '👁️' : '🙈'}</span>
          <span>{hideCompleted ? t.tasks.showCompleted : t.tasks.hideCompleted}</span>
        </button>
      </div>

      {/* Person columns */}
      <div
        className="flex-1 flex gap-4 overflow-x-auto pb-1 pt:snap-x pt:snap-mandatory pt:gap-6"
        style={{ minHeight: 0 }}
      >
        {peopleWithPhotos.map((person) => (
          <PersonColumn
            key={person.id}
            person={person}
            hideCompleted={hideCompleted}
            onToggleTask={toggleTask}
            onAddTask={addTask}
            onDeleteTask={deleteTask}
            onReorderTasks={reorderTasks}
            onPhotoChange={handlePhotoChange}
          />
        ))}
      </div>
    </div>
  );
}
