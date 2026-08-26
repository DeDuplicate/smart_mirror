import { useState, useEffect, useRef, useCallback } from 'react';
import { io } from 'socket.io-client';
import { fetchApi } from '../hooks/useApi.js';
import t from '../i18n/he.json';

// ─── Socket.io singleton (real-time HA sync) ────────────────────────────────

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

// ─── Icons ─────────────────────────────────────────────────────────────────

function CloseIcon({ className = 'w-5 h-5' }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
      strokeLinecap="round" strokeLinejoin="round" className={className}>
      <line x1="18" y1="6" x2="6" y2="18" />
      <line x1="6" y1="6" x2="18" y2="18" />
    </svg>
  );
}

function CheckIcon({ className = 'w-4 h-4' }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"
      strokeLinecap="round" strokeLinejoin="round" className={className}>
      <polyline points="20 6 9 17 4 12" />
    </svg>
  );
}

function PlusIcon({ className = 'w-4 h-4' }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"
      strokeLinecap="round" strokeLinejoin="round" className={className}>
      <line x1="12" y1="5" x2="12" y2="19" />
      <line x1="5" y1="12" x2="19" y2="12" />
    </svg>
  );
}

function ShoppingBagIcon({ className = 'w-5 h-5' }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
      strokeLinecap="round" strokeLinejoin="round" className={className}>
      <path d="M6 2L3 6v14a2 2 0 002 2h14a2 2 0 002-2V6l-3-4z" />
      <line x1="3" y1="6" x2="21" y2="6" />
      <path d="M16 10a4 4 0 01-8 0" />
    </svg>
  );
}

function TrashIcon({ className = 'w-4 h-4' }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
      strokeLinecap="round" strokeLinejoin="round" className={className}>
      <polyline points="3 6 5 6 21 6" />
      <path d="M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6" />
      <path d="M10 11v6M14 11v6" />
    </svg>
  );
}

// ─── Constants ──────────────────────────────────────────────────────────────

const ENTITY_ID = 'todo.shopping_list';
const POLL_INTERVAL = 30_000;

// ─── ShoppingListPopup ────────────────────────────────────────────────────

export default function ShoppingListPopup({ visible, onClose, anchorRef }) {
  const popupRef = useRef(null);
  const inputRef = useRef(null);
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [newItem, setNewItem] = useState('');
  const [adding, setAdding] = useState(false);
  const pollRef = useRef(null);

  // Fetch items
  const fetchItems = useCallback(async () => {
    try {
      const res = await fetchApi(`/api/ha/todo/${encodeURIComponent(ENTITY_ID)}`);
      const fetched = res?.items || [];
      setItems(fetched);
      setError(null);
      setLoading(false);
    } catch (err) {
      console.error('Shopping list fetch error:', err);
      setError(t.shoppingList.loadError);
      setLoading(false);
    }
  }, []);

  // Fetch on open + poll (poll is a fallback safety net; real-time sync
  // happens via the 'ha:state_changed' socket event below)
  useEffect(() => {
    if (!visible) return;
    setLoading(true);
    fetchItems();
    pollRef.current = setInterval(fetchItems, POLL_INTERVAL);
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, [visible, fetchItems]);

  // Real-time sync with Home Assistant — reflect changes made from the HA
  // app / other clients (and our own writes) the moment HA broadcasts them,
  // instead of waiting up to POLL_INTERVAL for the next poll.
  useEffect(() => {
    if (!visible) return;
    const sock = getSocket();

    function handleStateChanged(data) {
      if (!data?.entity_id || data.entity_id !== ENTITY_ID) return;
      const newItems = data.new_state?.attributes?.items;
      if (Array.isArray(newItems)) {
        setItems(newItems);
        setError(null);
      } else {
        fetchItems();
      }
    }

    sock.on('ha:state_changed', handleStateChanged);
    return () => sock.off('ha:state_changed', handleStateChanged);
  }, [visible, fetchItems]);

  // Focus input on open
  useEffect(() => {
    if (visible && inputRef.current) {
      setTimeout(() => inputRef.current?.focus(), 200);
    }
  }, [visible]);

  // Close on click outside
  useEffect(() => {
    if (!visible) return;
    function handleClickOutside(e) {
      if (popupRef.current && !popupRef.current.contains(e.target)) {
        onClose();
      }
    }
    const timer = setTimeout(() => {
      document.addEventListener('pointerdown', handleClickOutside);
    }, 50);
    return () => {
      clearTimeout(timer);
      document.removeEventListener('pointerdown', handleClickOutside);
    };
  }, [visible, onClose]);

  // Close on Escape
  useEffect(() => {
    if (!visible) return;
    function handleKey(e) {
      if (e.key === 'Escape') onClose();
    }
    document.addEventListener('keydown', handleKey);
    return () => document.removeEventListener('keydown', handleKey);
  }, [visible, onClose]);

  // Add item
  const handleAdd = useCallback(async () => {
    const trimmed = newItem.trim();
    if (!trimmed || adding) return;
    setAdding(true);
    try {
      await fetchApi(`/api/ha/todo/${encodeURIComponent(ENTITY_ID)}/add`, {
        method: 'POST',
        body: JSON.stringify({ item: trimmed }),
      });
      setNewItem('');
      setError(null);
      // Optimistic add
      setItems((prev) => [...prev, { summary: trimmed, status: 'needs_action', uid: Date.now().toString() }]);
      // Refresh to get real data (uid/order assigned by HA)
      setTimeout(fetchItems, 500);
    } catch (err) {
      console.error('Add item error:', err);
      setError(t.shoppingList.addError);
    } finally {
      setAdding(false);
    }
  }, [newItem, adding, fetchItems]);

  // Toggle item completion — referenced by index into the source `items`
  // array (not summary+uid) since HA items can share a summary and some
  // don't carry a uid at all, which previously caused every matching item
  // to toggle together.
  const handleToggleItem = useCallback(async (idx) => {
    const item = items[idx];
    if (!item) return;
    const newStatus = item.status === 'completed' ? 'needs_action' : 'completed';
    setItems((prev) => prev.map((it, i) => (i === idx ? { ...it, status: newStatus } : it)));
    try {
      await fetchApi(`/api/ha/todo/${encodeURIComponent(ENTITY_ID)}/update`, {
        method: 'POST',
        body: JSON.stringify({ item: item.summary, status: newStatus }),
      });
      setError(null);
      setTimeout(fetchItems, 500);
    } catch (err) {
      console.error('Update item error:', err);
      setError(t.shoppingList.updateError);
      // Revert
      setItems((prev) => prev.map((it, i) => (i === idx ? { ...it, status: item.status } : it)));
    }
  }, [items, fetchItems]);

  // Remove item permanently
  const handleRemoveItem = useCallback(async (idx, e) => {
    e.stopPropagation();
    const item = items[idx];
    if (!item) return;
    const prevItems = items;
    setItems((prev) => prev.filter((_, i) => i !== idx));
    try {
      await fetchApi(`/api/ha/todo/${encodeURIComponent(ENTITY_ID)}/remove`, {
        method: 'POST',
        body: JSON.stringify({ item: item.summary }),
      });
      setError(null);
      setTimeout(fetchItems, 500);
    } catch (err) {
      console.error('Remove item error:', err);
      setError(t.shoppingList.removeError);
      setItems(prevItems);
    }
  }, [items, fetchItems]);

  if (!visible) return null;

  // Position relative to anchor (top bar icon) with viewport bounds checking
  const style = {};
  if (anchorRef?.current) {
    const rect = anchorRef.current.getBoundingClientRect();
    const popupWidth = 320;
    const popupMaxHeight = 460;

    style.position = 'fixed';
    style.zIndex = 50;

    // Vertical: below the button, but clamp to viewport
    let top = rect.bottom + 8;
    if (top + popupMaxHeight > window.innerHeight) {
      top = Math.max(8, window.innerHeight - popupMaxHeight - 8);
    }
    style.top = `${top}px`;

    // Horizontal: align right edge with button, but clamp to viewport
    let right = window.innerWidth - rect.right;
    if (right < 8) right = 8;
    if (right + popupWidth > window.innerWidth - 8) {
      right = window.innerWidth - popupWidth - 8;
    }
    style.right = `${right}px`;
  }

  const withIdx = items.map((item, idx) => ({ item, idx }));
  const activeItems = withIdx.filter((x) => x.item.status !== 'completed');
  const completedItems = withIdx.filter((x) => x.item.status === 'completed');
  const itemCount = activeItems.length;

  return (
    <div
      ref={popupRef}
      className="bg-surf border border-bd rounded-2xl shadow-popover w-[320px] max-h-[460px] flex flex-col
                 overflow-hidden animate-popup-in"
      style={style}
      dir="rtl"
    >
      {/* Header */}
      <div className="flex items-center justify-between px-4 pt-3 pb-2 border-b border-bd">
        <div className="flex items-center gap-2">
          <ShoppingBagIcon className="w-5 h-5 text-acc" />
          <span className="text-sm font-semibold text-tp">{t.shoppingList.title}</span>
          {itemCount > 0 && (
            <span className="px-1.5 py-0.5 rounded-full bg-acc/15 text-acc text-[10px] font-bold">
              {itemCount}
            </span>
          )}
        </div>
        <button
          onClick={onClose}
          aria-label={t.common.close}
          className="min-w-[56px] min-h-[56px] rounded-full flex items-center justify-center text-tm
                     hover:bg-s2 transition-colors active:scale-95"
        >
          <CloseIcon className="w-4 h-4" />
        </button>
      </div>

      {/* Error banner */}
      {error && (
        <div className="mx-3 mt-2 px-3 py-2 rounded-xl bg-[var(--coral-bg)] text-[13px] text-[var(--coral-d)] flex items-center justify-between gap-2">
          <span>{error}</span>
          <button
            onClick={() => setError(null)}
            aria-label={t.common.close}
            className="min-w-[56px] min-h-[56px] flex items-center justify-center shrink-0"
          >
            <CloseIcon className="w-3.5 h-3.5" />
          </button>
        </div>
      )}

      {/* Item list */}
      <div className="flex-1 overflow-y-auto px-2 py-2" style={{ maxHeight: '320px' }}>
        {loading ? (
          <div className="flex items-center justify-center py-8 text-sm text-tm">
            {t.common.loading}
          </div>
        ) : activeItems.length === 0 && completedItems.length === 0 ? (
          <div className="flex items-center justify-center py-8 text-sm text-tm">
            {t.shoppingList.empty}
          </div>
        ) : (
          <>
            {/* Active items */}
            {activeItems.map(({ item, idx }) => (
              <div
                key={`active-${item.uid || idx}`}
                className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl hover:bg-s2 transition-colors group"
              >
                <button
                  onClick={() => handleToggleItem(idx)}
                  className="flex items-center gap-3 flex-1 min-w-0 min-h-[56px] text-start active:scale-[0.98] transition-transform"
                >
                  <div className="w-5 h-5 rounded border-2 border-bd flex items-center justify-center shrink-0" />
                  <span className="text-sm text-tp text-start flex-1 truncate">{item.summary}</span>
                </button>
                <button
                  onClick={(e) => handleRemoveItem(idx, e)}
                  aria-label={t.common.delete}
                  className="min-w-[56px] min-h-[56px] rounded-xl flex items-center justify-center text-tm
                             hover:bg-[var(--coral-bg)] hover:text-[var(--coral-d)] transition-colors active:scale-95 shrink-0"
                >
                  <TrashIcon className="w-4 h-4" />
                </button>
              </div>
            ))}
            {/* Completed items */}
            {completedItems.map(({ item, idx }) => (
              <div
                key={`done-${item.uid || idx}`}
                className="w-full flex items-center gap-3 px-3 py-2 rounded-xl hover:bg-s2 transition-colors opacity-50 group"
              >
                <button
                  onClick={() => handleToggleItem(idx)}
                  className="flex items-center gap-3 flex-1 min-w-0 min-h-[56px] text-start active:scale-[0.98] transition-transform"
                >
                  <div className="w-5 h-5 rounded bg-acc2/20 border-2 border-acc2 flex items-center justify-center shrink-0">
                    <CheckIcon className="w-3 h-3 text-acc2" />
                  </div>
                  <span className="text-sm text-tm text-start flex-1 truncate line-through">{item.summary}</span>
                </button>
                <button
                  onClick={(e) => handleRemoveItem(idx, e)}
                  aria-label={t.common.delete}
                  className="min-w-[56px] min-h-[56px] rounded-xl flex items-center justify-center text-tm
                             hover:bg-[var(--coral-bg)] hover:text-[var(--coral-d)] transition-colors active:scale-95 shrink-0"
                >
                  <TrashIcon className="w-4 h-4" />
                </button>
              </div>
            ))}
          </>
        )}
      </div>

      {/* Add item input */}
      <div className="border-t border-bd px-3 py-2.5 flex items-center gap-2">
        <input
          ref={inputRef}
          type="text"
          value={newItem}
          onChange={(e) => setNewItem(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') handleAdd();
          }}
          placeholder={t.shoppingList.addItem}
          className="flex-1 bg-s2 border border-bd rounded-xl px-3 min-h-[56px] text-sm text-tp
                     placeholder:text-tm focus:outline-none focus:border-acc
                     transition-colors"
          dir="auto"
        />
        <button
          onClick={handleAdd}
          disabled={!newItem.trim() || adding}
          aria-label={t.common.add}
          className="min-w-[56px] min-h-[56px] rounded-xl bg-acc text-white flex items-center justify-center
                     hover:bg-acc/90 active:scale-95 transition-all
                     disabled:opacity-40 disabled:cursor-not-allowed shrink-0"
        >
          <PlusIcon className="w-4 h-4" />
        </button>
      </div>
    </div>
  );
}

// ─── Export helper: item count hook ─────────────────────────────────────────

export function useShoppingListCount() {
  const [count, setCount] = useState(0);

  useEffect(() => {
    let mounted = true;

    async function fetchCount() {
      try {
        const res = await fetchApi(`/api/ha/todo/${encodeURIComponent(ENTITY_ID)}`);
        if (!mounted) return;
        const items = res?.items || [];
        const active = items.filter((i) => i.status !== 'completed');
        setCount(active.length);
      } catch {
        // Silently fail
      }
    }

    fetchCount();
    const interval = setInterval(fetchCount, 60_000);

    return () => {
      mounted = false;
      clearInterval(interval);
    };
  }, []);

  return count;
}
