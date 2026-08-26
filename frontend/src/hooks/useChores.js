import { useState, useEffect, useCallback, useRef } from 'react';
import { io } from 'socket.io-client';

// ─── Socket.io singleton (same pattern as useTasks / useHomeAssistant) ─────

let socket = null;

function getSocket() {
  if (!socket) {
    socket = io('/', {
      path: '/socket.io',
      transports: ['websocket', 'polling'],
      reconnectionAttempts: Infinity,
      reconnectionDelay: 2000,
    });
  }
  return socket;
}

// ─── Family members from localStorage (written by Settings → Family) ───────
// Used ONLY to seed the backend table; the backend is the source of truth.

function getConfiguredPeople() {
  try {
    return JSON.parse(localStorage.getItem('chores_people') || '[]');
  } catch {
    return [];
  }
}

// ─── API helpers ───────────────────────────────────────────────────────────

async function apiFetch(url, options = {}) {
  const res = await fetch(url, {
    headers: { 'Content-Type': 'application/json' },
    ...options,
  });
  if (!res.ok) throw new Error(`API error: ${res.status}`);
  return res.json();
}

// ─── localStorage helpers (UI preference only) ─────────────────────────────

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

export default function useChores() {
  const [people, setPeople] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [hideCompleted, setHideCompletedState] = useState(loadHideCompleted);
  const intervalRef = useRef(null);

  // ── Fetch people + chores from the backend (SQLite) ────────────────────
  // If Settings has a configured family, sync it into the DB first so the
  // two stores converge; otherwise read the DB as-is.
  const fetchTasks = useCallback(async () => {
    try {
      const configured = getConfiguredPeople();
      let url = '/api/tasks/people';
      if (configured.length > 0) {
        const syncParam = encodeURIComponent(
          JSON.stringify(
            configured.map((p) => ({ id: p.id, name: p.name, color: p.color }))
          )
        );
        url += `?sync=${syncParam}`;
      }
      const data = await apiFetch(url);
      setPeople(data);
      setError(null);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, []);

  // ── Initial fetch + polling + live socket updates ──────────────────────
  useEffect(() => {
    fetchTasks();
    intervalRef.current = setInterval(fetchTasks, 2 * 60 * 1000);

    const s = getSocket();
    const onUpdated = () => fetchTasks();
    s.on('tasks:updated', onUpdated);

    return () => {
      clearInterval(intervalRef.current);
      s.off('tasks:updated', onUpdated);
    };
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

      try {
        await apiFetch(`/api/tasks/people/${personId}/tasks/${taskId}/toggle`, {
          method: 'PATCH',
        });
      } catch {
        await fetchTasks();
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
  const addTask = useCallback(async (personId, { title, emoji, recurrence }) => {
    const created = await apiFetch(`/api/tasks/people/${personId}/tasks`, {
      method: 'POST',
      body: JSON.stringify({
        title,
        emoji: emoji || '📌',
        recurrence: recurrence || 'once',
        dueDate: null,
      }),
    });
    setPeople((prev) =>
      prev.map((person) =>
        person.id === personId
          ? { ...person, tasks: [...person.tasks, created] }
          : person
      )
    );
    return created;
  }, []);

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

      try {
        await apiFetch(`/api/tasks/people/${personId}/tasks/${taskId}`, {
          method: 'DELETE',
        });
      } catch {
        await fetchTasks();
      }
    },
    [fetchTasks]
  );

  // ── Avatar photo (camera/file picker) — persisted to the DB ────────────
  const uploadAvatar = useCallback(
    async (personId, dataUrl) => {
      try {
        await apiFetch(`/api/tasks/people/${personId}/avatar`, {
          method: 'PUT',
          body: JSON.stringify({ avatar: dataUrl }),
        });
        setPeople((prev) =>
          prev.map((p) => (p.id === personId ? { ...p, avatar: dataUrl } : p))
        );
        return true;
      } catch (err) {
        setError(err.message);
        return false;
      }
    },
    []
  );

  const removeAvatar = useCallback(
    async (personId) => {
      setPeople((prev) =>
        prev.map((p) => (p.id === personId ? { ...p, avatar: null } : p))
      );
      try {
        await apiFetch(`/api/tasks/people/${personId}/avatar`, { method: 'DELETE' });
      } catch {
        await fetchTasks();
      }
    },
    [fetchTasks]
  );

  // ── People CRUD (Settings → Family) ────────────────────────────────────
  const addPerson = useCallback(async ({ name, color }) => {
    const created = await apiFetch('/api/tasks/people', {
      method: 'POST',
      body: JSON.stringify({ name, color }),
    });
    setPeople((prev) => [...prev, created]);
    return created;
  }, []);

  const removePerson = useCallback(
    async (personId) => {
      setPeople((prev) => prev.filter((p) => p.id !== personId));
      try {
        await apiFetch(`/api/tasks/people/${personId}`, { method: 'DELETE' });
      } catch {
        await fetchTasks();
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
    addPerson,
    removePerson,
    uploadAvatar,
    removeAvatar,
    refetch: fetchTasks,
  };
}
