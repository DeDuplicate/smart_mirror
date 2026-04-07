import { useState, useEffect } from 'react';
import t from '../../i18n/he.json';
import { TasksSkeleton } from '../Skeleton.jsx';

// ─── Column definitions ─────────────────────────────────────────────────────

const COLUMNS = [
  { key: 'todo', label: t.tasks.todo },
  { key: 'inProgress', label: t.tasks.inProgress },
  { key: 'done', label: t.tasks.done },
];

// Column accent colors
const COLUMN_COLORS = {
  todo: 'bg-lav text-lav-d',
  inProgress: 'bg-gold text-gold-d',
  done: 'bg-mint text-mint-d',
};

// ─── Plus icon ──────────────────────────────────────────────────────────────

function PlusIcon({ className = 'w-7 h-7' }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"
      strokeLinecap="round" strokeLinejoin="round" className={className}>
      <line x1="12" y1="5" x2="12" y2="19" />
      <line x1="5" y1="12" x2="19" y2="12" />
    </svg>
  );
}

// ─── TasksPage ──────────────────────────────────────────────────────────────

export default function TasksPage() {
  const [loading, setLoading] = useState(true);
  const [tasks] = useState({ todo: [], inProgress: [], done: [] });

  useEffect(() => {
    const timer = setTimeout(() => setLoading(false), 1000);
    return () => clearTimeout(timer);
  }, []);

  if (loading) return <TasksSkeleton />;

  return (
    <div className="relative flex h-full overflow-hidden">
      {/* Kanban columns */}
      <div className="flex flex-1 gap-5 p-6 overflow-x-auto">
        {COLUMNS.map((col) => {
          const items = tasks[col.key] || [];
          return (
            <div
              key={col.key}
              className="flex-1 min-w-[280px] flex flex-col bg-surf border border-bd rounded-2xl overflow-hidden"
            >
              {/* Column header */}
              <div className="flex items-center gap-3 px-5 py-4 border-b border-bd">
                <h3 className="text-base font-semibold text-tp">{col.label}</h3>
                <span
                  className={`
                    flex items-center justify-center min-w-[28px] h-7
                    rounded-full px-2 text-xs font-bold
                    ${COLUMN_COLORS[col.key]}
                  `}
                >
                  {items.length}
                </span>
              </div>

              {/* Cards area */}
              <div className="flex-1 overflow-y-auto p-4">
                {items.length === 0 ? (
                  <div
                    className="flex items-center justify-center h-full border-2 border-dashed
                               border-bd rounded-2xl py-12"
                  >
                    <span className="text-tm text-sm">{t.empty.noTasks}</span>
                  </div>
                ) : (
                  <div className="flex flex-col gap-3">
                    {items.map((task, i) => (
                      <div
                        key={i}
                        className="card hover:shadow-md transition-shadow duration-[var(--dur-fast)] cursor-pointer"
                      >
                        <p className="text-sm text-tp">{task.title}</p>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {/* Floating add button */}
      <button
        className="ripple absolute bottom-6 start-6 w-14 h-14 rounded-full bg-acc text-white
                   shadow-lg flex items-center justify-center
                   hover:bg-acc/90 active:scale-90 transition-all duration-[var(--dur-fast)]"
        aria-label={t.tasks.addTask}
      >
        <PlusIcon />
      </button>
    </div>
  );
}
