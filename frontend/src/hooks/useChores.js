import { useState, useEffect, useCallback, useRef } from 'react';

// ─── Dev mode check ────────────────────────────────────────────────────────

const isDev =
  typeof import.meta !== 'undefined' &&
  import.meta.env &&
  import.meta.env.DEV;

// ─── Load people from localStorage (configured in Settings → Family) ───────

function getConfiguredPeople() {
  try {
    const stored = JSON.parse(localStorage.getItem('chores_people') || '[]');
    if (stored.length > 0) {
      return stored.map(p => ({ ...p, listId: null, avatar: null, tasks: [] }));
    }
  } catch { /* ignore */ }
  // Fallback mock data if no people configured
  return [
    { id: 'p1', name: 'חיים', color: '#2a9d7f', listId: null, avatar: null, tasks: [] },
    { id: 'p2', name: 'מעיין', color: '#5b52cc', listId: null, avatar: null, tasks: [] },
    { id: 'p3', name: 'רון', color: '#c95454', listId: null, avatar: null, tasks: [] },
  ];
}

// Sample tasks for dev mode (assigned to configured people)
function getMockTasks(personIndex) {
  const taskSets = [
    [
      { id: 't1', title: 'לקנות חלב ולחם', emoji: '🛒', completed: true, recurrence: 'once', dueDate: '2026-04-06' },
      { id: 't2', title: 'לשלם חשבון ארנונה', emoji: '💳', completed: true, recurrence: 'once', dueDate: '2026-04-05' },
      { id: 't3', title: 'להוציא את הכלב', emoji: '🐕', completed: true, recurrence: 'daily', dueDate: '2026-04-07' },
      { id: 't4', title: 'לתקן ברז במטבח', emoji: '🔧', completed: false, recurrence: 'once', dueDate: null },
      { id: 't5', title: 'לנקות את המחסן', emoji: '🧹', completed: false, recurrence: 'weekly', dueDate: '2026-04-10' },
    ],
    [
      { id: 't6', title: 'להכין שיעורי בית', emoji: '📚', completed: true, recurrence: 'daily', dueDate: '2026-04-07' },
      { id: 't7', title: 'לסדר את החדר', emoji: '🛏️', completed: true, recurrence: 'weekly', dueDate: '2026-04-07' },
      { id: 't8', title: 'לתרגל פסנתר', emoji: '🎹', completed: true, recurrence: 'daily', dueDate: '2026-04-07' },
      { id: 't9', title: 'לקרוא ספר', emoji: '📖', completed: true, recurrence: 'once', dueDate: '2026-04-09' },
    ],
    [
      { id: 't10', title: 'להכין מצגת לעבודה', emoji: '💼', completed: false, recurrence: 'once', dueDate: '2026-04-08' },
      { id: 't11', title: 'לרוץ 5 ק"מ', emoji: '🏃', completed: true, recurrence: 'daily', dueDate: '2026-04-07' },
      { id: 't12', title: 'לעדכן קורות חיים', emoji: '📝', completed: false, recurrence: 'once', dueDate: '2026-04-12' },
      { id: 't13', title: 'לתאם פגישה עם רו"ח', emoji: '📞', completed: false, recurrence: 'once', dueDate: '2026-04-10' },
      { id: 't14', title: 'להחליף שמן ברכב', emoji: '🚗', completed: false, recurrence: 'once', dueDate: '2026-04-15' },
      { id: 't15', title: 'לקנות מתנה ליום הולדת', emoji: '🎁', completed: false, recurrence: 'once', dueDate: '2026-04-03' },
    ],
  ];
  return taskSets[personIndex % taskSets.length] || [];
}

const MOCK_PEOPLE = getConfiguredPeople().map((p, i) => ({ ...p, tasks: getMockTasks(i) }));

// ─── API helpers ───────────────────────────────────────────────────────────

async function apiFetch(url, options = {}) {
  const res = await fetch(url, {
    headers: { 'Content-Type': 'application/json' },
    ...options,
  });
  if (!res.ok) throw new Error(`API error: ${res.status}`);
  return res.json();
}

// ─── localStorage helpers ─────────────────────────────────────────────────

const HIDE_COMPLETED_KEY = 'tasks_hideCompleted';

function loadHideCompleted() {
  try {
    return localStorage.getItem(HIDE_COMPLETED_KEY) === 'true';
  } catch {
    return false;
  }
}

function saveHideCompleted(val) {
  try {
    localStorage.setItem(HIDE_COMPLETED_KEY, val ? 'true' : 'false');
  } catch {
    // ignore
  }
}

// ─── Hook ──────────────────────────────────────────────────────────────────

let nextMockId = 200;

export default function useTasks() {
  const [people, setPeople] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [hideCompleted, setHideCompletedState] = useState(loadHideCompleted);
  const intervalRef = useRef(null);

  // ── Fetch tasks (person-based) ─────────────────────────────────────────
  const fetchTasks = useCallback(async () => {
    try {
      if (isDev) {
        // Simulate network delay on first load
        await new Promise((r) => setTimeout(r, 800));
        setPeople(MOCK_PEOPLE.map((p) => ({ ...p, tasks: [...p.tasks] })));
      } else {
        const data = await apiFetch('/api/tasks/people');
        setPeople(data);
      }
      setError(null);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, []);

  // ── Initial fetch + 2-minute polling ───────────────────────────────────
  useEffect(() => {
    fetchTasks();
    intervalRef.current = setInterval(fetchTasks, 2 * 60 * 1000);
    return () => clearInterval(intervalRef.current);
  }, [fetchTasks]);

  // ── Toggle task completion (optimistic) ────────────────────────────────
  const toggleTask = useCallback(
    async (personId, taskId) => {
      let wasAllComplete = false;
      let isNowAllComplete = false;
      let personName = '';
      let personColor = '';

      setPeople((prev) =>
        prev.map((person) => {
          if (person.id !== personId) return person;

          personName = person.name;
          personColor = person.color;

          const updatedTasks = person.tasks.map((task) =>
            task.id === taskId ? { ...task, completed: !task.completed } : task
          );

          const totalTasks = updatedTasks.length;
          const completedBefore = person.tasks.filter((t) => t.completed).length;
          const completedAfter = updatedTasks.filter((t) => t.completed).length;

          wasAllComplete = completedBefore === totalTasks;
          isNowAllComplete = completedAfter === totalTasks && totalTasks > 0;

          return { ...person, tasks: updatedTasks };
        })
      );

      if (!isDev) {
        try {
          await apiFetch(`/api/tasks/people/${personId}/tasks/${taskId}/toggle`, {
            method: 'PATCH',
          });
        } catch {
          await fetchTasks();
        }
      }

      // Return whether celebration should trigger
      return {
        justCompleted: !wasAllComplete && isNowAllComplete,
        personName,
        personColor,
      };
    },
    [fetchTasks]
  );

  // ── Add task to a person ───────────────────────────────────────────────
  const addTask = useCallback(
    async (personId, { title, emoji, recurrence }) => {
      const newTask = {
        id: isDev ? `t${++nextMockId}` : undefined,
        title,
        emoji: emoji || '📌',
        completed: false,
        recurrence: recurrence || 'once',
        dueDate: null,
      };

      if (isDev) {
        setPeople((prev) =>
          prev.map((person) =>
            person.id === personId
              ? { ...person, tasks: [...person.tasks, newTask] }
              : person
          )
        );
        return newTask;
      }

      const created = await apiFetch(`/api/tasks/people/${personId}/tasks`, {
        method: 'POST',
        body: JSON.stringify(newTask),
      });
      setPeople((prev) =>
        prev.map((person) =>
          person.id === personId
            ? { ...person, tasks: [...person.tasks, created] }
            : person
        )
      );
      return created;
    },
    []
  );

  // ── Delete task ────────────────────────────────────────────────────────
  const deleteTask = useCallback(
    async (personId, taskId) => {
      setPeople((prev) =>
        prev.map((person) =>
          person.id === personId
            ? { ...person, tasks: person.tasks.filter((t) => t.id !== taskId) }
            : person
        )
      );

      if (!isDev) {
        try {
          await apiFetch(`/api/tasks/people/${personId}/tasks/${taskId}`, {
            method: 'DELETE',
          });
        } catch {
          await fetchTasks();
        }
      }
    },
    [fetchTasks]
  );

  // ── Hide completed toggle ─────────────────────────────────────────────
  const setHideCompleted = useCallback((val) => {
    const next = typeof val === 'function' ? val(hideCompleted) : val;
    setHideCompletedState(next);
    saveHideCompleted(next);
  }, [hideCompleted]);

  const toggleHideCompleted = useCallback(() => {
    setHideCompleted((prev) => !prev);
  }, [setHideCompleted]);

  return {
    people,
    loading,
    error,
    hideCompleted,
    toggleHideCompleted,
    toggleTask,
    addTask,
    deleteTask,
    refetch: fetchTasks,
  };
}
