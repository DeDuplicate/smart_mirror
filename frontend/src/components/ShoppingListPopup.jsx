import { useState, useEffect, useRef, useCallback } from 'react';
import { fetchApi } from '../hooks/useApi.js';
import t from '../i18n/he.json';

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

// ─── Constants ──────────────────────────────────────────────────────────────

const ENTITY_ID = 'todo.shopping_list';
const POLL_INTERVAL = 30_000;

// ─── ShoppingListPopup ────────────────────────────────────────────────────

export default function ShoppingListPopup({ visible, onClose, anchorRef }) {
  const popupRef = useRef(null);
  const inputRef = useRef(null);
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [newItem, setNewItem] = useState('');
  const [adding, setAdding] = useState(false);
  const pollRef = useRef(null);

  // Fetch items
  const fetchItems = useCallback(async () => {
    try {
      const res = await fetchApi(`/api/ha/todo/${encodeURIComponent(ENTITY_ID)}`);
      const fetched = res?.items || [];
      setItems(fetched);
      setLoading(false);
    } catch (err) {
      console.error('Shopping list fetch error:', err);
      setLoading(false);
    }
  }, []);

  // Fetch on open + poll
  useEffect(() => {
    if (!visible) return;
    setLoading(true);
    fetchItems();
    pollRef.current = setInterval(fetchItems, POLL_INTERVAL);
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
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
      // Optimistic add
      setItems((prev) => [...prev, { summary: trimmed, status: 'needs_action', uid: Date.now().toString() }]);
      // Refresh to get real data
      setTimeout(fetchItems, 500);
    } catch (err) {
      console.error('Add item error:', err);
    } finally {
      setAdding(false);
    }
  }, [newItem, adding, fetchItems]);

  // Toggle item completion
  const handleToggleItem = useCallback(async (item) => {
    const newStatus = item.status === 'completed' ? 'needs_action' : 'completed';
    // Optimistic update
    setItems((prev) =>
      prev.map((i) =>
        i.summary === item.summary && i.uid === item.uid
          ? { ...i, status: newStatus }
          : i
      )
    );
    try {
      await fetchApi(`/api/ha/todo/${encodeURIComponent(ENTITY_ID)}/update`, {
        method: 'POST',
        body: JSON.stringify({ item: item.summary, status: newStatus }),
      });
      setTimeout(fetchItems, 500);
    } catch (err) {
      console.error('Update item error:', err);
      // Revert
      setItems((prev) =>
        prev.map((i) =>
          i.summary === item.summary && i.uid === item.uid
            ? { ...i, status: item.status }
            : i
        )
      );
    }
  }, [fetchItems]);

  if (!visible) return null;

  // Position relative to anchor (top bar icon)
  const style = {};
  if (anchorRef?.current) {
    const rect = anchorRef.current.getBoundingClientRect();
    style.position = 'fixed';
    style.top = `${rect.bottom + 8}px`;
    style.right = `${window.innerWidth - rect.right}px`;
    style.zIndex = 50;
  }

  const activeItems = items.filter((i) => i.status !== 'completed');
  const completedItems = items.filter((i) => i.status === 'completed');
  const itemCount = activeItems.length;

  return (
    <div
      ref={popupRef}
      className="bg-surf border border-bd rounded-2xl shadow-2xl w-[320px] max-h-[460px] flex flex-col
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
          className="w-7 h-7 rounded-full flex items-center justify-center text-tm hover:bg-s2
                     transition-colors active:scale-90"
        >
          <CloseIcon className="w-4 h-4" />
        </button>
      </div>

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
            {activeItems.map((item, idx) => (
              <button
                key={`active-${item.uid || idx}`}
                onClick={() => handleToggleItem(item)}
                className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl
                           hover:bg-s2 transition-colors active:scale-[0.98]"
              >
                <div className="w-5 h-5 rounded border-2 border-bd flex items-center justify-center shrink-0" />
                <span className="text-sm text-tp text-right flex-1">{item.summary}</span>
              </button>
            ))}
            {/* Completed items */}
            {completedItems.map((item, idx) => (
              <button
                key={`done-${item.uid || idx}`}
                onClick={() => handleToggleItem(item)}
                className="w-full flex items-center gap-3 px-3 py-2 rounded-xl
                           hover:bg-s2 transition-colors active:scale-[0.98] opacity-50"
              >
                <div className="w-5 h-5 rounded bg-acc2/20 border-2 border-acc2 flex items-center justify-center shrink-0">
                  <CheckIcon className="w-3 h-3 text-acc2" />
                </div>
                <span className="text-sm text-tm text-right flex-1 line-through">{item.summary}</span>
              </button>
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
          className="flex-1 bg-s2 border border-bd rounded-xl px-3 py-2 text-sm text-tp
                     placeholder:text-tm focus:outline-none focus:border-acc
                     transition-colors"
          dir="auto"
        />
        <button
          onClick={handleAdd}
          disabled={!newItem.trim() || adding}
          className="w-9 h-9 rounded-xl bg-acc text-white flex items-center justify-center
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
