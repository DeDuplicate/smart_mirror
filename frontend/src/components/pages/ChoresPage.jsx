import { useState, useRef, useCallback, useMemo, useEffect } from 'react';
import t from '../../i18n/he.json';
import useStore from '../../store/index.js';
import { TasksSkeleton } from '../Skeleton.jsx';
import OnScreenKeyboard from '../OnScreenKeyboard.jsx';
import useChores from "../../hooks/useChores.js";
import CelebrationAnimation from '../CelebrationAnimation.jsx';

// ─── Recurrence config ─────────────────────────────────────────────────────

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
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3"
      strokeLinecap="round" strokeLinejoin="round" className={className}>
      <polyline points="20 6 9 17 4 12" />
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
    <svg width={size} height={size} className="absolute inset-0">
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
        style={{ transition: 'stroke-dashoffset 600ms ease-out' }}
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

  const handlePhotoClick = useCallback(() => {
    if (fileInputRef.current) fileInputRef.current.click();
  }, []);

  const handleFileChange = useCallback((e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    // Resize and convert to base64
    const reader = new FileReader();
    reader.onload = (ev) => {
      const img = new Image();
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
  }, [personId, onPhotoChange]);

  return (
    <div className="relative flex items-center justify-center" style={{ width: 68, height: 68 }}>
      <ProgressRing progress={progress} color={color} />
      <div
        onClick={handlePhotoClick}
        className={`
          w-[60px] h-[60px] rounded-full flex items-center justify-center
          text-white text-xl font-bold select-none cursor-pointer
          transition-shadow duration-500 overflow-hidden
          ${isComplete ? 'avatar-pulse-glow' : ''}
        `}
        style={{
          backgroundColor: color,
          boxShadow: isComplete ? `0 0 16px ${color}66, 0 0 32px ${color}33` : 'none',
        }}
        title="לחץ להעלאת תמונה"
      >
        {photo ? (
          <img src={photo} alt={name} className="w-full h-full object-cover" />
        ) : (
          initials
        )}
      </div>
      {/* Small camera badge */}
      {!photo && (
        <div className="absolute -bottom-0.5 -left-0.5 w-5 h-5 rounded-full bg-[var(--acc)] flex items-center justify-center shadow-sm">
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
        capture="environment"
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

function TaskCard({ task, personColor, onToggle, onDelete, onClap }) {
  const isComplete = task.completed;
  const overdue = !isComplete && isOverdue(task.dueDate);
  const [justToggled, setJustToggled] = useState(false);

  const recurrenceLabel = useMemo(() => {
    const found = RECURRENCE_OPTIONS.find((r) => r.value === task.recurrence);
    return found ? found.label : '';
  }, [task.recurrence]);

  const handleToggle = useCallback(() => {
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

  const bgClass = isComplete
    ? 'bg-[#edfaf6] dark:bg-[#1a3025]'
    : overdue
      ? 'bg-[#fff0f0] dark:bg-[#3d1a1a]'
      : 'bg-[var(--surf)]';

  return (
    <button
      onClick={handleToggle}
      data-clap-target
      className={`
        relative w-full flex items-center gap-3 p-3 rounded-xl
        border border-[var(--bd)]
        transition-all duration-200
        active:scale-[0.98]
        min-h-[56px]
        ${bgClass}
      `}
      style={{ borderRight: `3px solid ${personColor}` }}
    >
      {/* Checkbox */}
      <div
        className={`
          relative flex-shrink-0 w-[44px] h-[44px] rounded-full
          flex items-center justify-center
          border-2 transition-all duration-300
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
          {task.emoji && <span className="text-lg">{task.emoji}</span>}
          <span
            className={`
              text-sm font-medium text-right leading-snug truncate
              transition-all duration-300
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

      {/* Delete button */}
      <div
        onClick={handleDelete}
        className="flex-shrink-0 p-2 rounded-lg text-[var(--tm)] hover:text-[var(--coral-d)] hover:bg-[var(--coral-bg)]/30 transition-colors"
        role="button"
        tabIndex={-1}
      >
        <TrashIcon />
      </div>

    </button>
  );
}

// ─── PersonColumn component ────────────────────────────────────────────────

function PersonColumn({
  person,
  hideCompleted,
  onToggleTask,
  onAddTask,
  onDeleteTask,
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

  const visibleTasks = useMemo(() => {
    if (hideCompleted) {
      return person.tasks.filter((t) => !t.completed);
    }
    return person.tasks;
  }, [person.tasks, hideCompleted]);

  // Sort: incomplete first, then completed
  const sortedTasks = useMemo(() => {
    return [...visibleTasks].sort((a, b) => {
      if (a.completed !== b.completed) return a.completed ? 1 : -1;
      return 0;
    });
  }, [visibleTasks]);

  const handleToggle = useCallback(
    async (taskId) => {
      const result = await onToggleTask(person.id, taskId);
      if (result && result.justCompleted) {
        setCelebration({
          personName: result.personName,
          personColor: result.personColor,
        });
      }
    },
    [onToggleTask, person.id]
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

  const progressText = allDone
    ? t.tasks.allCompleted
    : t.tasks.progressText
        .replace('{completed}', completedTasks)
        .replace('{total}', totalTasks);

  return (
    <div
      ref={columnRef}
      className="relative flex flex-col rounded-2xl border border-[var(--bd)] bg-[var(--surf)] overflow-hidden"
      style={{ minWidth: 220, flex: '1 1 0%' }}
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
          className="h-full rounded-full transition-all duration-500 ease-out"
          style={{
            width: `${progress * 100}%`,
            backgroundColor: person.color,
          }}
        />
      </div>

      {/* Task list */}
      <div className="flex-1 overflow-y-auto px-3 pb-2 flex flex-col gap-2">
        {sortedTasks.map((task) => (
          <TaskCard
            key={task.id}
            task={task}
            personColor={person.color}
            onToggle={handleToggle}
            onDelete={handleDelete}
            onClap={() => setShowClap(true)}
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
            transition-all duration-200
            min-h-[48px]
          "
        >
          <PlusIcon className="w-4 h-4" />
          <span>{t.tasks.addTaskBtn}</span>
        </button>
      </div>

      {/* Add task bottom sheet */}
      {addingTask && (
        <AddTaskSheet
          personId={person.id}
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

function AddTaskSheet({ personId, personColor, onAdd, onClose }) {
  const [title, setTitle] = useState('');
  const [emoji, setEmoji] = useState('');
  const [recurrence, setRecurrence] = useState('once');
  const [showKeyboard, setShowKeyboard] = useState(false);
  const [showEmojiPicker, setShowEmojiPicker] = useState(false);
  const inputRef = useRef(null);

  const handleSave = useCallback(() => {
    if (!title.trim()) return;
    onAdd(personId, { title: title.trim(), emoji, recurrence });
    onClose();
  }, [title, emoji, recurrence, personId, onAdd, onClose]);

  const handleInputFocus = useCallback(() => {
    setShowKeyboard(true);
  }, []);

  return (
    <div className="fixed inset-0 z-50 flex flex-col">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/40 backdrop-blur-sm"
        onClick={onClose}
      />

      {/* Sheet — sits above keyboard when keyboard is open */}
      <div
        className="relative bg-[var(--surf)] rounded-t-2xl border-t border-[var(--bd)] p-5 pb-4 flex flex-col gap-4 celebration-sheet-slide-up"
        style={{
          zIndex: 51,
          position: showKeyboard ? 'absolute' : 'relative',
          bottom: showKeyboard ? '40%' : '0',
          left: 0,
          right: 0,
          marginTop: showKeyboard ? undefined : 'auto',
          transition: 'bottom 0.25s ease',
        }}
      >
        {/* Emoji picker */}
        <div className="flex flex-col gap-2">
          <label className="text-sm font-semibold text-[var(--tp)]">
            סמל מטלה
          </label>
          <div className="flex items-center gap-3">
            {/* Selected emoji display / toggle button */}
            <button
              onClick={() => setShowEmojiPicker(v => !v)}
              className="
                w-16 h-16 rounded-2xl border-2 flex items-center justify-center
                text-3xl transition-all duration-200 active:scale-95 shrink-0
              "
              style={{
                borderColor: emoji ? personColor : 'var(--bd)',
                backgroundColor: emoji ? `${personColor}15` : 'var(--s2)',
              }}
            >
              {emoji || '➕'}
            </button>
            {emoji && (
              <button
                onClick={() => setEmoji('')}
                className="text-xs text-[var(--tm)] hover:text-[var(--coral-d)] transition-colors"
              >
                הסר
              </button>
            )}
          </div>
          {showEmojiPicker && (
            <div className="grid grid-cols-8 gap-1.5 p-3 bg-[var(--s2)] rounded-xl border border-[var(--bd)] max-h-[140px] overflow-y-auto">
              {CHORE_EMOJIS.map((e) => (
                <button
                  key={e}
                  onClick={() => { setEmoji(e); setShowEmojiPicker(false); }}
                  className={`
                    w-11 h-11 rounded-xl flex items-center justify-center text-xl
                    transition-all duration-150 active:scale-90
                    ${emoji === e ? 'bg-[var(--acc)]/20 ring-2 ring-[var(--acc)]' : 'hover:bg-[var(--bd)]'}
                  `}
                >
                  {e}
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Title input */}
        <div className="flex flex-col gap-2">
          <label className="text-sm font-semibold text-[var(--tp)]">
            {t.tasks.title}
          </label>
          <input
            ref={inputRef}
            type="text"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            onFocus={() => { setShowKeyboard(true); setShowEmojiPicker(false); }}
            placeholder={t.tasks.titlePlaceholder}
            className="
              w-full py-3 px-4 rounded-xl text-sm
              bg-[var(--s2)] text-[var(--tp)]
              border border-[var(--bd)]
              placeholder-[var(--tm)]
              focus:outline-none focus:border-[var(--acc)]
              transition-colors duration-200
            "
            dir="rtl"
            autoFocus
          />
        </div>

        {/* Recurrence picker */}
        <div className="flex flex-col gap-2">
          <label className="text-sm font-semibold text-[var(--tp)]">
            {t.tasks.recurrenceLabel}
          </label>
          <div className="flex gap-2">
            {RECURRENCE_OPTIONS.map((option) => (
              <button
                key={option.value}
                onClick={() => setRecurrence(option.value)}
                className={`
                  flex-1 py-2.5 px-3 rounded-xl text-sm font-medium
                  border transition-all duration-200
                  ${recurrence === option.value
                    ? 'border-[var(--acc)] bg-[var(--acc)]/10 text-[var(--acc)]'
                    : 'border-[var(--bd)] bg-[var(--s2)] text-[var(--ts)]'
                  }
                `}
              >
                {option.label}
              </button>
            ))}
          </div>
        </div>

        {/* Buttons */}
        <div className="flex gap-3">
          <button
            onClick={handleSave}
            disabled={!title.trim()}
            className="
              flex-1 py-3 px-4 rounded-xl text-sm font-bold text-white
              transition-all duration-200
              disabled:opacity-40 disabled:cursor-not-allowed
              active:scale-[0.98]
            "
            style={{ backgroundColor: personColor || 'var(--acc)' }}
          >
            {t.common.save}
          </button>
          <button
            onClick={onClose}
            className="
              flex-1 py-3 px-4 rounded-xl text-sm font-medium
              bg-[var(--s2)] text-[var(--ts)]
              border border-[var(--bd)]
              active:scale-[0.98]
              transition-all duration-200
            "
          >
            {t.common.cancel}
          </button>
        </div>
      </div>

      {/* On-screen keyboard */}
      <OnScreenKeyboard
        visible={showKeyboard}
        onInput={(char) => setTitle(prev => prev + char)}
        onBackspace={() => setTitle(prev => prev.slice(0, -1))}
        onEnter={() => setShowKeyboard(false)}
        onClose={() => setShowKeyboard(false)}
      />
    </div>
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
  } = useChores();

  const addToast = useStore((s) => s.addToast);

  // Photo upload — persist to localStorage
  const [photos, setPhotos] = useState(() => {
    try {
      return JSON.parse(localStorage.getItem('chores_avatars') || '{}');
    } catch { return {}; }
  });

  const handlePhotoChange = useCallback((personId, dataUrl) => {
    setPhotos(prev => {
      const next = { ...prev, [personId]: dataUrl };
      localStorage.setItem('chores_avatars', JSON.stringify(next));
      return next;
    });
  }, []);

  // Merge photos into people data
  const peopleWithPhotos = useMemo(() => {
    if (!people) return [];
    return people.map(p => ({ ...p, avatar: photos[p.id] || p.avatar }));
  }, [people, photos]);

  // Loading state
  if (loading) {
    return <TasksSkeleton />;
  }

  // Error state
  if (error) {
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
            border transition-all duration-200
            active:scale-[0.98]
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
        className="flex-1 flex gap-4 overflow-x-auto pb-1"
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
            onPhotoChange={handlePhotoChange}
          />
        ))}
      </div>
    </div>
  );
}
