import { useState, useEffect, useCallback, useRef } from 'react';

// ─── Mock Data ─────────────────────────────────────────────────────────────

const MOCK_TASKS = [
  {
    id: '1',
    title: 'לקנות חלב ולחם מהסופר',
    description: 'חלב תנובה 3%, לחם אחיד',
    status: 'todo',
    priority: 'high',
    starred: true,
    dueDate: '2026-04-07',
    listName: 'קניות',
    listColor: '#6b62e0',
  },
  {
    id: '2',
    title: 'לתאם פגישה עם רו"ח',
    description: 'לדבר על דוח שנתי ומע"מ',
    status: 'todo',
    priority: 'medium',
    starred: false,
    dueDate: '2026-04-10',
    listName: 'עבודה',
    listColor: '#2ab58a',
  },
  {
    id: '3',
    title: 'לתקן את הברז במטבח',
    description: '',
    status: 'todo',
    priority: 'low',
    starred: false,
    dueDate: null,
    listName: 'בית',
    listColor: '#b07c10',
  },
  {
    id: '4',
    title: 'להכין מצגת לישיבת צוות',
    description: 'כולל גרפים מרבעון אחרון',
    status: 'inProgress',
    priority: 'high',
    starred: true,
    dueDate: '2026-04-08',
    listName: 'עבודה',
    listColor: '#2ab58a',
  },
  {
    id: '5',
    title: 'לעדכן קורות חיים',
    description: 'להוסיף את הפרויקט האחרון',
    status: 'inProgress',
    priority: 'medium',
    starred: false,
    dueDate: '2026-04-12',
    listName: 'אישי',
    listColor: '#c95454',
  },
  {
    id: '6',
    title: 'לשלם חשבון ארנונה',
    description: 'תשלום רבעוני',
    status: 'inProgress',
    priority: 'high',
    starred: false,
    dueDate: '2026-04-05',
    listName: 'בית',
    listColor: '#b07c10',
  },
  {
    id: '7',
    title: 'להזמין טיסות לחופשה',
    description: 'בדקנו טיסות לברצלונה',
    status: 'done',
    priority: 'medium',
    starred: true,
    dueDate: '2026-04-01',
    listName: 'אישי',
    listColor: '#c95454',
  },
  {
    id: '8',
    title: 'לשלוח דוח חודשי למנהל',
    description: 'דוח מרץ 2026',
    status: 'done',
    priority: 'low',
    starred: false,
    dueDate: '2026-04-02',
    listName: 'עבודה',
    listColor: '#2ab58a',
  },
  {
    id: '9',
    title: 'לנקות את המחסן',
    description: '',
    status: 'done',
    priority: 'none',
    starred: false,
    dueDate: '2026-03-30',
    listName: 'בית',
    listColor: '#b07c10',
  },
  {
    id: '10',
    title: 'להרשם לקורס ריצה',
    description: 'קורס ערב ביום שלישי',
    status: 'todo',
    priority: 'none',
    starred: false,
    dueDate: '2026-04-15',
    listName: 'אישי',
    listColor: '#c95454',
  },
];

// ─── Dev mode check ────────────────────────────────────────────────────────

const isDev =
  typeof import.meta !== 'undefined' &&
  import.meta.env &&
  import.meta.env.DEV;

// ─── API helpers ───────────────────────────────────────────────────────────

async function apiFetch(url, options = {}) {
  const res = await fetch(url, {
    headers: { 'Content-Type': 'application/json' },
    ...options,
  });
  if (!res.ok) throw new Error(`API error: ${res.status}`);
  return res.json();
}

// ─── Hook ──────────────────────────────────────────────────────────────────

let nextMockId = 100;

export default function useTasks() {
  const [tasks, setTasks] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const intervalRef = useRef(null);

  // ── Fetch tasks ────────────────────────────────────────────────────────
  const fetchTasks = useCallback(async () => {
    try {
      if (isDev) {
        // Simulate network delay on first load
        if (loading) await new Promise((r) => setTimeout(r, 800));
        setTasks(MOCK_TASKS);
      } else {
        const data = await apiFetch('/api/tasks');
        setTasks(data);
      }
      setError(null);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Initial fetch + 2-minute polling ───────────────────────────────────
  useEffect(() => {
    fetchTasks();
    intervalRef.current = setInterval(fetchTasks, 2 * 60 * 1000);
    return () => clearInterval(intervalRef.current);
  }, [fetchTasks]);

  // ── Grouped by column ─────────────────────────────────────────────────
  const columns = {
    todo: tasks.filter((t) => t.status === 'todo'),
    inProgress: tasks.filter((t) => t.status === 'inProgress'),
    done: tasks.filter((t) => t.status === 'done'),
  };

  // ── Create task ───────────────────────────────────────────────────────
  const createTask = useCallback(
    async (taskData) => {
      const newTask = {
        ...taskData,
        id: isDev ? String(++nextMockId) : undefined,
        status: taskData.status || 'todo',
      };
      if (isDev) {
        setTasks((prev) => [...prev, newTask]);
        return newTask;
      }
      const created = await apiFetch('/api/tasks', {
        method: 'POST',
        body: JSON.stringify(newTask),
      });
      setTasks((prev) => [...prev, created]);
      return created;
    },
    []
  );

  // ── Update task (including column move) ───────────────────────────────
  const updateTask = useCallback(
    async (id, patch) => {
      setTasks((prev) =>
        prev.map((t) => (t.id === id ? { ...t, ...patch } : t))
      );
      if (!isDev) {
        try {
          await apiFetch(`/api/tasks/${id}`, {
            method: 'PATCH',
            body: JSON.stringify(patch),
          });
        } catch {
          // Revert on failure
          await fetchTasks();
        }
      }
    },
    [fetchTasks]
  );

  // ── Delete task ───────────────────────────────────────────────────────
  const deleteTask = useCallback(
    async (id) => {
      setTasks((prev) => prev.filter((t) => t.id !== id));
      if (!isDev) {
        try {
          await apiFetch(`/api/tasks/${id}`, { method: 'DELETE' });
        } catch {
          await fetchTasks();
        }
      }
    },
    [fetchTasks]
  );

  // ── Clear completed ───────────────────────────────────────────────────
  const clearCompleted = useCallback(async () => {
    const doneIds = tasks.filter((t) => t.status === 'done').map((t) => t.id);
    setTasks((prev) => prev.filter((t) => t.status !== 'done'));
    if (!isDev) {
      try {
        await Promise.all(
          doneIds.map((id) =>
            apiFetch(`/api/tasks/${id}`, { method: 'DELETE' })
          )
        );
      } catch {
        await fetchTasks();
      }
    }
  }, [tasks, fetchTasks]);

  return {
    tasks,
    columns,
    loading,
    error,
    createTask,
    updateTask,
    deleteTask,
    clearCompleted,
    refetch: fetchTasks,
  };
}
