import { useState, useEffect, useCallback } from 'react';
import t from '../i18n/he.json';
import { fetchApi } from '../hooks/useApi.js';

// ─── Folder Picker ───────────────────────────────────────────────────────────
// Browses the folders under backend/data/photos/ so the photo frame can be
// pointed at one album instead of everything. A mounted network share shows up
// here as just another folder, which is the whole reason the picker walks the
// local tree rather than talking SMB itself.
//
// A centred modal rather than the anchored dropdown WifiPopup uses: this opens
// from near the bottom of a long Settings page, where `absolute top-full` would
// put the list off-screen.
// ─────────────────────────────────────────────────────────────────────────────

function FolderIcon({ className = 'w-6 h-6' }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className={className}>
      <path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7z" />
    </svg>
  );
}

function UpIcon({ className = 'w-6 h-6' }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className={className}>
      <path d="M12 19V5M5 12l7-7 7 7" />
    </svg>
  );
}

function Spinner({ className = 'w-6 h-6' }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" className={`animate-spin ${className}`}>
      <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" opacity="0.25" />
      <path d="M12 2a10 10 0 0 1 10 10" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
    </svg>
  );
}

function countLabel(n) {
  if (!n) return t.photoFrame.noPhotos;
  if (n === 1) return t.photoFrame.photoOne;
  return t.photoFrame.photosCount.replace('{n}', String(n));
}

/**
 * @param {string} value    currently selected folder, '' = the whole tree
 * @param {(path: string) => void} onSelect
 */
export default function FolderPickerPopup({ visible, value, onClose, onSelect }) {
  const [path, setPath] = useState(value || '');
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const load = useCallback(async (next) => {
    setLoading(true);
    setError(null);
    try {
      const d = await fetchApi(`/api/photoframe/folders?path=${encodeURIComponent(next)}`);
      setData(d);
      setPath(d.path);
    } catch (err) {
      setError(err?.message || 'failed');
      setData(null);
    } finally {
      setLoading(false);
    }
  }, []);

  // Reopening always starts from the saved folder, not wherever the user
  // wandered to last time and then cancelled.
  useEffect(() => {
    if (!visible) return;
    setPath(value || '');
    load(value || '');
  }, [visible, value, load]);

  useEffect(() => {
    if (!visible) return undefined;
    const onKey = (e) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [visible, onClose]);

  if (!visible) return null;

  const folders = data?.folders || [];
  const canGoUp = data?.parent !== null && data?.parent !== undefined;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center"
      style={{ direction: 'rtl' }}
      onClick={onClose}
    >
      <div className="absolute inset-0 bg-black" style={{ opacity: 0.4, animation: 'fadeIn var(--dur-fast) var(--ease-out)' }} />

      <div
        className="relative bg-surf border border-bd rounded-2xl shadow-modal
                   w-[560px] max-w-[92vw] max-h-[70vh] flex flex-col overflow-hidden"
        style={{ animation: 'popupIn var(--dur-normal) var(--ease-out) forwards' }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header — current location */}
        <div className="flex items-center gap-3 px-5 py-4 border-b border-bd">
          <button
            onClick={() => canGoUp && load(data.parent)}
            disabled={!canGoUp}
            aria-label={t.photoFrame.up}
            className="w-14 h-14 shrink-0 rounded-xl flex items-center justify-center
                       text-ts bg-s2 border border-bd disabled:opacity-30
                       active:scale-95 transition-all duration-[var(--dur-fast)]"
          >
            <UpIcon />
          </button>
          <div className="min-w-0 flex-1">
            <p className="text-lg font-semibold text-tp truncate" dir="auto">
              {path || t.photoFrame.folderRoot}
            </p>
            <p className="text-sm text-tm">{countLabel(data?.photoCount || 0)}</p>
          </div>
        </div>

        {/* Folder list */}
        <div className="flex-1 overflow-y-auto px-3 py-3" style={{ scrollbarWidth: 'thin' }}>
          {loading && (
            <div className="flex justify-center py-10 text-ts">
              <Spinner />
            </div>
          )}

          {!loading && error && (
            <p className="text-sm text-coral-d bg-coral/10 rounded-xl px-3 py-2 mx-2">{error}</p>
          )}

          {!loading && !error && folders.length === 0 && (
            <p className="text-sm text-tm text-center py-10">{t.photoFrame.noFolders}</p>
          )}

          {!loading &&
            folders.map((folder) => (
              <button
                key={folder.path}
                onClick={() => load(folder.path)}
                className="w-full flex items-center gap-3 px-3 min-h-[56px] rounded-xl text-start
                           border border-transparent hover:bg-s2
                           active:scale-[0.99] transition-all duration-[var(--dur-fast)]"
              >
                <FolderIcon className="w-6 h-6 text-acc shrink-0" />
                <span className="flex-1 min-w-0 truncate text-base text-tp" dir="auto">
                  {folder.name}
                </span>
                <span className="text-sm text-tm shrink-0">{countLabel(folder.photoCount)}</span>
              </button>
            ))}
        </div>

        {/* Actions */}
        <div className="flex items-center gap-3 px-5 py-4 border-t border-bd">
          <button
            onClick={() => {
              onSelect(path);
              onClose();
            }}
            className="ripple flex-1 min-h-[56px] rounded-xl bg-acc text-white font-semibold text-lg
                       active:scale-95 transition-all duration-[var(--dur-fast)]"
          >
            {t.photoFrame.useFolder}
          </button>
          <button
            onClick={onClose}
            className="ripple px-5 min-h-[56px] rounded-xl bg-s2 text-ts border border-bd
                       font-semibold text-lg active:scale-95 transition-all duration-[var(--dur-fast)]"
          >
            {t.common.cancel}
          </button>
        </div>
      </div>
    </div>
  );
}
