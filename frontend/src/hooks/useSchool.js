import { useState, useEffect, useCallback, useRef } from 'react';
import { io } from 'socket.io-client';
import { fetchApi } from './useApi.js';
import { toLocalDateKey } from './useCalendar.js';

// ─── Socket.io singleton (same pattern as useTasks / useChores) ────────────

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

const REFRESH_INTERVAL = 2 * 60 * 1000;

// ─── Hook ──────────────────────────────────────────────────────────────────

export default function useSchool() {
  const [today, setToday] = useState(null);      // { date, people: [...] }
  const [schedule, setSchedule] = useState({});  // { personId: { "0": [...], ... } }
  const [items, setItems] = useState({});        // { subject: [item, ...] }
  const [people, setPeople] = useState([]);      // chore_people (Settings editor)
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const intervalRef = useRef(null);

  const fetchToday = useCallback(async () => {
    try {
      const data = await fetchApi(`/api/school/today?date=${toLocalDateKey(new Date())}`);
      setToday(data);
      setError(null);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, []);

  const fetchConfig = useCallback(async () => {
    try {
      const [sched, its, ppl] = await Promise.all([
        fetchApi('/api/school/schedule'),
        fetchApi('/api/school/items'),
        fetchApi('/api/tasks/people'),
      ]);
      setSchedule(sched?.schedule || {});
      setItems(its?.items || {});
      setPeople((ppl || []).map(({ id, name, color, avatar }) => ({ id, name, color, avatar })));
      setError(null);
    } catch (err) {
      setError(err.message);
    }
  }, []);

  const refetch = useCallback(async () => {
    await Promise.all([fetchToday(), fetchConfig()]);
  }, [fetchToday, fetchConfig]);

  // ── Initial fetch + polling + live socket updates ──────────────────────
  useEffect(() => {
    refetch();
    // Polling also rolls the checklist over at midnight without a reload.
    intervalRef.current = setInterval(refetch, REFRESH_INTERVAL);

    const s = getSocket();
    const onUpdated = () => refetch();
    const onChecklist = ({ personId, date, itemKey, checked } = {}) => {
      setToday((prev) => {
        if (!prev || prev.date !== date) return prev;
        return {
          ...prev,
          people: prev.people.map((p) =>
            String(p.personId) !== String(personId)
              ? p
              : {
                  ...p,
                  subjects: p.subjects.map((sub) => ({
                    ...sub,
                    items: sub.items.map((it) =>
                      it.itemKey === itemKey ? { ...it, checked: !!checked } : it
                    ),
                  })),
                }
          ),
        };
      });
    };
    s.on('school:updated', onUpdated);
    s.on('school:checklist-updated', onChecklist);

    return () => {
      clearInterval(intervalRef.current);
      s.off('school:updated', onUpdated);
      s.off('school:checklist-updated', onChecklist);
    };
  }, [refetch]);

  // ── Toggle one checklist item (optimistic) ─────────────────────────────
  const toggleItem = useCallback(
    async (personId, itemKey, checked) => {
      const date = today?.date || toLocalDateKey(new Date());
      setToday((prev) => {
        if (!prev) return prev;
        return {
          ...prev,
          people: prev.people.map((p) =>
            String(p.personId) !== String(personId)
              ? p
              : {
                  ...p,
                  subjects: p.subjects.map((sub) => ({
                    ...sub,
                    items: sub.items.map((it) =>
                      it.itemKey === itemKey ? { ...it, checked } : it
                    ),
                  })),
                }
          ),
        };
      });
      try {
        await fetchApi('/api/school/checklist/toggle', {
          method: 'POST',
          body: JSON.stringify({ personId, date, itemKey, checked }),
        });
      } catch {
        await fetchToday();
      }
    },
    [today, fetchToday]
  );

  // ── Settings: replace one person+day subject list ──────────────────────
  const setDaySchedule = useCallback(
    async (personId, dayOfWeek, subjects) => {
      const day = String(dayOfWeek);
      setSchedule((prev) => ({
        ...prev,
        [personId]: { ...(prev[personId] || {}), [day]: subjects },
      }));
      await fetchApi(`/api/school/schedule/${personId}/${day}`, {
        method: 'PUT',
        body: JSON.stringify({ subjects }),
      });
      fetchToday();
    },
    [fetchToday]
  );

  // ── Settings: replace one subject's item list ─────────────────────────
  const setSubjectItems = useCallback(
    async (subject, list) => {
      setItems((prev) => {
        const next = { ...prev };
        if (list.length) next[subject] = list;
        else delete next[subject];
        return next;
      });
      await fetchApi(`/api/school/items/${encodeURIComponent(subject)}`, {
        method: 'PUT',
        body: JSON.stringify({ items: list }),
      });
      fetchToday();
    },
    [fetchToday]
  );

  return {
    today,
    schedule,
    items,
    people,
    loading,
    error,
    toggleItem,
    setDaySchedule,
    setSubjectItems,
    refetch,
  };
}
