import { useState, useEffect, useCallback, useRef } from 'react';
import { io } from 'socket.io-client';
import useStore from '../store/index.js';
import t from '../i18n/he.json';

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

// One chore set to an explicit state. Setting (not flipping) means applying it
// twice, or on top of a fresher list, can never undo it.
const withCompleted = (people, personId, taskId, completed) =>
  people.map((p) =>
    p.id !== personId
      ? p
      : { ...p, tasks: p.tasks.map((t) => (t.id === taskId ? { ...t, completed } : t)) }
  );

// ─── Hook ──────────────────────────────────────────────────────────────────

export default function useChores() {
  const [people, setPeople] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [hideCompleted, setHideCompletedState] = useState(loadHideCompleted);
  const intervalRef = useRef(null);
  const addToast = useStore((s) => s.addToast);

  // Always the latest list, including edits React has not rendered yet, so two
  // taps in the same frame both see each other.
  const peopleRef = useRef(people);
  peopleRef.current = people;

  // Every save broadcasts tasks:updated, and every screen answers by refetching
  // the whole list. A refetch that overlaps a save returns a list WITHOUT that
  // save yet, and applying it makes the chore jump back and then forward again
  // (and the next tap on it then undoes it). So a read that started before, or
  // runs during, a save is thrown away; one fresh read follows the last save.
  const savesRef = useRef(0); // saves in flight
  const epochRef = useRef(0); // bumps when a save starts
  const staleRef = useRef(false); // a read was thrown away while saves were in flight

  // ── Fetch people + chores from the backend (SQLite) ────────────────────
  // If Settings has a configured family, sync it into the DB first so the
  // two stores converge; otherwise read the DB as-is.
  const fetchTasks = useCallback(async function load() {
    try {
      const epoch = epochRef.current;
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
      if (savesRef.current > 0 || epoch !== epochRef.current) {
        // Out of date. Read again now if no save is running, else when the last one lands.
        if (savesRef.current === 0) return load();
        staleRef.current = true;
        return undefined;
      }
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

  // Runs a save while keeping refetches from overwriting what it changed.
  const save = useCallback(
    async (run) => {
      savesRef.current += 1;
      epochRef.current += 1;
      try {
        return await run();
      } finally {
        savesRef.current -= 1;
        if (savesRef.current === 0 && staleRef.current) {
          staleRef.current = false;
          fetchTasks();
        }
      }
    },
    [fetchTasks]
  );

  // ── Toggle task completion (optimistic) ────────────────────────────────
  const toggleTask = useCallback(
    async (personId, taskId) => {
      const person = peopleRef.current.find((p) => p.id === personId);
      const task = person?.tasks.find((t) => t.id === taskId);
      if (!task) return null;

      const completed = !task.completed;
      peopleRef.current = withCompleted(peopleRef.current, personId, taskId, completed);
      setPeople((prev) => withCompleted(prev, personId, taskId, completed));
      const justCompleted =
        completed && peopleRef.current.find((p) => p.id === personId).tasks.every((t) => t.completed);

      // The server decides whether this tap finished the day (and so earned a star).
      let starAwarded = false;
      await save(async () => {
        try {
          const res = await apiFetch(`/api/tasks/people/${personId}/tasks/${taskId}/toggle`, {
            method: 'PATCH',
            body: JSON.stringify({ completed }),
          });
          starAwarded = Boolean(res?.starAwarded);
        } catch {
          await fetchTasks(); // read again once the saves settle, which also undoes the tap
        }
      });

      // Return whether celebration should trigger
      return { justCompleted, starAwarded, personName: person.name, personColor: person.color };
    },
    [fetchTasks, save]
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
    // The POST broadcasts tasks:updated to every socket including this one, so
    // a refetch can land before this line and already hold the new chore —
    // append only if it isn't there, or it renders twice under the same key.
    setPeople((prev) =>
      prev.map((person) =>
        person.id === personId && !person.tasks.some((t) => t.id === created.id)
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

      await save(async () => {
        try {
          await apiFetch(`/api/tasks/people/${personId}/tasks/${taskId}`, {
            method: 'DELETE',
          });
        } catch {
          // Reverting on its own just made the chore reappear with no explanation.
          addToast('error', t.tasks.choreDeleteError);
          await fetchTasks();
        }
      });
    },
    [fetchTasks, addToast, save]
  );

  // ── Reorder one kid's chores (drag and drop) ───────────────────────────
  // `orderedIds` is the person's full chore list in the new order. Optimistic.
  // On failure (server unreachable, or a 409 because another screen changed the
  // list) the chore snaps back to where it was: leaving it in an order that was
  // never saved looks like it worked, and a refetch alone cannot undo that when
  // the server is the thing that is down.
  const reorderTasks = useCallback(
    async (personId, orderedIds) => {
      const before = peopleRef.current.find((p) => p.id === personId)?.tasks.map((task) => task.id) || [];
      setPeople((prev) =>
        prev.map((person) => {
          if (person.id !== personId) return person;
          const byId = new Map(person.tasks.map((task) => [task.id, task]));
          const tasks = orderedIds.map((id) => byId.get(id)).filter(Boolean);
          return tasks.length === person.tasks.length ? { ...person, tasks } : person;
        })
      );
      try {
        await save(() =>
          apiFetch(`/api/tasks/people/${personId}/tasks/reorder`, {
            method: 'PUT',
            body: JSON.stringify({ order: orderedIds }),
          })
        );
      } catch {
        addToast('error', t.tasks.choreReorderError);
        const rank = new Map(before.map((id, i) => [id, i]));
        setPeople((prev) =>
          prev.map((person) =>
            person.id === personId
              ? {
                ...person,
                tasks: [...person.tasks].sort((a, b) => (rank.get(a.id) ?? Infinity) - (rank.get(b.id) ?? Infinity)),
              }
              : person
          )
        );
        await fetchTasks(); // best effort: picks up whatever really changed
      }
    },
    [fetchTasks, addToast, save]
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
    reorderTasks,
    addPerson,
    removePerson,
    uploadAvatar,
    removeAvatar,
    refetch: fetchTasks,
  };
}
