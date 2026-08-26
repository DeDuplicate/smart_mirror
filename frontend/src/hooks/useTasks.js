import { useState, useEffect, useCallback, useRef } from 'react';
import { io } from 'socket.io-client';

// ─── Socket.io singleton (same pattern as useHomeAssistant) ────────────────

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

export default function useTasks() {
  const [tasks, setTasks] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const intervalRef = useRef(null);

  // ── Fetch tasks ────────────────────────────────────────────────────────
  const fetchTasks = useCallback(async () => {
    try {
      const data = await apiFetch('/api/tasks');
      setTasks(data);
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

  // ── Grouped by column (ordered by position) ───────────────────────────
  const columns = {
    todo: tasks.filter((t) => t.status === 'todo'),
    inProgress: tasks.filter((t) => t.status === 'inProgress'),
    done: tasks.filter((t) => t.status === 'done'),
  };

  // ── Create task ───────────────────────────────────────────────────────
  const createTask = useCallback(async (taskData) => {
    const created = await apiFetch('/api/tasks', {
      method: 'POST',
      body: JSON.stringify({ status: 'todo', ...taskData }),
    });
    setTasks((prev) => [...prev, created]);
    return created;
  }, []);

  // ── Update task (including column move) ───────────────────────────────
  const updateTask = useCallback(
    async (id, patch) => {
      setTasks((prev) =>
        prev.map((t) => (t.id === id ? { ...t, ...patch } : t))
      );
      try {
        await apiFetch(`/api/tasks/${id}`, {
          method: 'PATCH',
          body: JSON.stringify(patch),
        });
      } catch {
        await fetchTasks();
      }
    },
    [fetchTasks]
  );

  // ── Reorder: persist column + position for many tasks at once ─────────
  // updates: [{ id, status, position }] — applied optimistically first.
  const reorderTasks = useCallback(
    async (updates) => {
      const byId = new Map(updates.map((u) => [u.id, u]));
      setTasks((prev) =>
        prev.map((t) => (byId.has(t.id) ? { ...t, ...byId.get(t.id) } : t))
      );
      try {
        await apiFetch('/api/tasks/reorder', {
          method: 'PUT',
          body: JSON.stringify({ tasks: updates }),
        });
      } catch {
        await fetchTasks();
      }
    },
    [fetchTasks]
  );

  // ── Delete task ───────────────────────────────────────────────────────
  const deleteTask = useCallback(
    async (id) => {
      setTasks((prev) => prev.filter((t) => t.id !== id));
      try {
        await apiFetch(`/api/tasks/${id}`, { method: 'DELETE' });
      } catch {
        await fetchTasks();
      }
    },
    [fetchTasks]
  );

  // ── Clear completed (single request) ──────────────────────────────────
  const clearCompleted = useCallback(async () => {
    setTasks((prev) => prev.filter((t) => t.status !== 'done'));
    try {
      await apiFetch('/api/tasks/completed', { method: 'DELETE' });
    } catch {
      await fetchTasks();
    }
  }, [fetchTasks]);

  // ── Subtasks (checklist items inside a task) ──────────────────────────
  const addSubtask = useCallback(async (taskId, title) => {
    const created = await apiFetch(`/api/tasks/${taskId}/subtasks`, {
      method: 'POST',
      body: JSON.stringify({ title }),
    });
    setTasks((prev) =>
      prev.map((t) =>
        t.id === taskId ? { ...t, subtasks: [...(t.subtasks || []), created] } : t
      )
    );
    return created;
  }, []);

  const updateSubtask = useCallback(async (taskId, subId, patch) => {
    setTasks((prev) =>
      prev.map((t) =>
        t.id === taskId
          ? {
              ...t,
              subtasks: (t.subtasks || []).map((s) =>
                s.id === subId ? { ...s, ...patch } : s
              ),
            }
          : t
      )
    );
    try {
      await apiFetch(`/api/tasks/${taskId}/subtasks/${subId}`, {
        method: 'PATCH',
        body: JSON.stringify(patch),
      });
    } catch {
      await fetchTasks();
    }
  }, [fetchTasks]);

  const deleteSubtask = useCallback(async (taskId, subId) => {
    setTasks((prev) =>
      prev.map((t) =>
        t.id === taskId
          ? { ...t, subtasks: (t.subtasks || []).filter((s) => s.id !== subId) }
          : t
      )
    );
    try {
      await apiFetch(`/api/tasks/${taskId}/subtasks/${subId}`, { method: 'DELETE' });
    } catch {
      await fetchTasks();
    }
  }, [fetchTasks]);

  return {
    tasks,
    columns,
    loading,
    error,
    createTask,
    updateTask,
    reorderTasks,
    deleteTask,
    clearCompleted,
    addSubtask,
    updateSubtask,
    deleteSubtask,
    refetch: fetchTasks,
  };
}
