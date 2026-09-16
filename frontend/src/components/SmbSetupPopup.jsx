import { useState, useEffect, useCallback } from 'react';
import { createPortal } from 'react-dom';
import t from '../i18n/he.json';
import useStore from '../store/index.js';
import { fetchApi } from '../hooks/useApi.js';
import OnScreenKeyboard from './OnScreenKeyboard.jsx';

// ─── Network share (SMB/CIFS) setup ──────────────────────────────────────────
// Enter a NAS address, list the shares it is offering, pick one, connect. The
// mount itself happens on the Pi via scripts/mount-photos-share.sh; once it is
// up, the share is just a folder under the photo directory and the folder
// picker takes over.
//
// This screen is the reason the on-screen keyboard is wired here rather than
// into InputRow: on the kiosk there is no hardware keyboard, so a plain input
// (like the one the WiFi password still uses) cannot be typed into at all.
// ─────────────────────────────────────────────────────────────────────────────

const FIELDS = ['host', 'username', 'password'];

function Spinner({ className = 'w-5 h-5' }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" className={`animate-spin ${className}`}>
      <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" opacity="0.25" />
      <path d="M12 2a10 10 0 0 1 10 10" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
    </svg>
  );
}

function ShareIcon({ className = 'w-6 h-6' }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className={className}>
      <rect x="3" y="4" width="18" height="7" rx="2" />
      <rect x="3" y="13" width="18" height="7" rx="2" />
      <path d="M7 7.5h.01M7 16.5h.01" strokeLinecap="round" />
    </svg>
  );
}

/** Map the backend's classified failure codes onto Hebrew. */
function shareErrorLabel(code) {
  if (code === 'bad-credentials') return t.photoFrame.smbBadCredentials;
  if (code === 'unreachable') return t.photoFrame.smbUnreachable;
  if (code === 'not-installed') return t.photoFrame.smbNotInstalled;
  return t.photoFrame.smbFailed;
}

export default function SmbSetupPopup({ visible, onClose, onMounted }) {
  const addToast = useStore((s) => s.addToast);

  const [fields, setFields] = useState({ host: '', username: '', password: '' });
  const [shares, setShares] = useState(null);
  const [selectedShare, setSelectedShare] = useState('');
  const [browsing, setBrowsing] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const [error, setError] = useState(null);

  const [keyboardOpen, setKeyboardOpen] = useState(false);
  const [keyboardTarget, setKeyboardTarget] = useState('host');

  // Never leave a password sitting in state after the dialog closes.
  useEffect(() => {
    if (visible) return;
    setFields({ host: '', username: '', password: '' });
    setShares(null);
    setSelectedShare('');
    setError(null);
    setKeyboardOpen(false);
  }, [visible]);

  const setField = useCallback((name, value) => {
    setFields((prev) => ({ ...prev, [name]: value }));
  }, []);

  const focusField = useCallback((name) => {
    setKeyboardTarget(name);
    setKeyboardOpen(true);
  }, []);

  const handleKeyboardInput = useCallback(
    (char) => setFields((prev) => ({ ...prev, [keyboardTarget]: prev[keyboardTarget] + char })),
    [keyboardTarget]
  );
  const handleKeyboardBackspace = useCallback(
    () => setFields((prev) => ({ ...prev, [keyboardTarget]: prev[keyboardTarget].slice(0, -1) })),
    [keyboardTarget]
  );

  const browseShares = useCallback(async () => {
    if (!fields.host) return;
    setBrowsing(true);
    setError(null);
    setShares(null);
    try {
      const d = await fetchApi('/api/photoframe/smb/shares', {
        method: 'POST',
        body: JSON.stringify({
          host: fields.host.trim(),
          username: fields.username || undefined,
          password: fields.password || undefined,
        }),
      });
      setShares(d.shares || []);
    } catch (err) {
      // fetchApi throws `API <status>: <body>`; dig the code back out.
      const code = /"code"\s*:\s*"([a-z-]+)"/.exec(err?.message || '')?.[1];
      setError(shareErrorLabel(code));
      setShares([]);
    } finally {
      setBrowsing(false);
    }
  }, [fields]);

  const connect = useCallback(async () => {
    if (!selectedShare) return;
    setConnecting(true);
    setError(null);
    try {
      await fetchApi('/api/photoframe/smb/mount', {
        method: 'POST',
        body: JSON.stringify({
          host: fields.host.trim(),
          share: selectedShare,
          username: fields.username || undefined,
          password: fields.password || undefined,
        }),
      });
      addToast('success', `${t.photoFrame.smbConnected}: ${selectedShare}`);
      if (onMounted) onMounted();
      onClose();
    } catch (err) {
      const code = /"code"\s*:\s*"([a-z-]+)"/.exec(err?.message || '')?.[1];
      setError(shareErrorLabel(code));
      addToast('error', `${t.photoFrame.smbFailed}: ${selectedShare}`);
    } finally {
      setConnecting(false);
    }
  }, [selectedShare, fields, addToast, onMounted, onClose]);

  if (!visible) return null;

  const labels = {
    host: t.photoFrame.smbHost,
    username: t.photoFrame.smbUser,
    password: t.photoFrame.smbPassword,
  };

  return (
    <>
      <div
        className="fixed inset-0 z-50 flex items-center justify-center"
        style={{ direction: 'rtl' }}
        // The keyboard's own backdrop sits under this one; without the guard
        // every keypress would count as an outside tap and close the dialog.
        onClick={() => !keyboardOpen && onClose()}
      >
        <div
          className="absolute inset-0 bg-black"
          style={{ opacity: 0.4, animation: 'fadeIn var(--dur-fast) var(--ease-out)' }}
        />

        <div
          className="relative bg-surf border border-bd rounded-2xl shadow-modal
                     w-[560px] max-w-[92vw] flex flex-col overflow-hidden"
          style={{ animation: 'popupIn var(--dur-normal) var(--ease-out) forwards' }}
          onClick={(e) => e.stopPropagation()}
        >
          <div className="px-5 py-4 border-b border-bd">
            <h2 className="text-xl font-semibold text-tp">{t.photoFrame.smbTitle}</h2>
          </div>

          <div
            className="flex-1 overflow-y-auto px-5 py-4 flex flex-col gap-4"
            // The keyboard takes the bottom 40% of the screen; shrink rather
            // than let it cover the fields being typed into.
            style={{ maxHeight: keyboardOpen ? '30vh' : '60vh', scrollbarWidth: 'thin' }}
          >
            {FIELDS.map((name) => (
              <div key={name} className="flex flex-col gap-1.5">
                <label className="text-sm font-medium text-ts">{labels[name]}</label>
                <input
                  type={name === 'password' ? 'password' : 'text'}
                  value={fields[name]}
                  placeholder={name === 'host' ? t.photoFrame.smbHostPlaceholder : ''}
                  onChange={(e) => setField(name, e.target.value)}
                  onFocus={() => focusField(name)}
                  onClick={() => focusField(name)}
                  dir="ltr"
                  className={`bg-s2 border rounded-xl min-h-[56px] px-4 text-tp text-base
                              placeholder:text-tm focus:outline-none focus:border-acc w-full
                              transition-colors duration-[var(--dur-fast)]
                              ${keyboardTarget === name && keyboardOpen ? 'border-acc' : 'border-bd'}`}
                />
              </div>
            ))}

            <p className="text-sm text-tm -mt-2">{t.photoFrame.smbGuest}</p>

            <button
              onClick={browseShares}
              disabled={!fields.host || browsing}
              className="ripple inline-flex items-center justify-center gap-2 px-5 min-h-[56px] rounded-xl
                         bg-s2 text-ts border border-bd font-semibold text-lg
                         disabled:opacity-50 active:scale-95 transition-all duration-[var(--dur-fast)]"
            >
              {browsing ? <Spinner /> : <ShareIcon />}
              {t.photoFrame.smbBrowseShares}
            </button>

            {shares !== null && (
              <div className="flex flex-col gap-1">
                <span className="text-sm font-medium text-ts">{t.photoFrame.smbShares}</span>
                {shares.length === 0 && !browsing && (
                  <p className="text-sm text-tm text-center py-4">{t.photoFrame.smbNoShares}</p>
                )}
                {shares.map((share) => (
                  <button
                    key={share.name}
                    onClick={() => setSelectedShare(share.name)}
                    className={`w-full flex items-center gap-3 px-3 min-h-[56px] rounded-xl text-start
                                border transition-all duration-[var(--dur-fast)] active:scale-[0.99]
                                ${
                                  selectedShare === share.name
                                    ? 'bg-acc/10 border-acc/30'
                                    : 'border-transparent hover:bg-s2'
                                }`}
                  >
                    <ShareIcon className="w-5 h-5 text-acc shrink-0" />
                    <span className="flex-1 min-w-0 truncate text-base text-tp" dir="ltr">
                      {share.name}
                    </span>
                    {share.comment && (
                      <span className="text-sm text-tm shrink-0 truncate max-w-[40%]">{share.comment}</span>
                    )}
                  </button>
                ))}
              </div>
            )}

            {error && <p className="text-sm text-coral-d bg-coral/10 rounded-xl px-3 py-2">{error}</p>}
          </div>

          <div className="flex items-center gap-3 px-5 py-4 border-t border-bd">
            <button
              onClick={connect}
              disabled={!selectedShare || connecting}
              className="ripple flex-1 inline-flex items-center justify-center gap-2 min-h-[56px] rounded-xl
                         bg-acc text-white font-semibold text-lg disabled:opacity-50
                         active:scale-95 transition-all duration-[var(--dur-fast)]"
            >
              {connecting ? <Spinner /> : null}
              {t.photoFrame.smbConnect}
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

      {/* Portaled to #root: this dialog carries a `transform` from its entrance
          animation, which would capture the keyboard's `position: fixed` and
          trap it inside the dialog box. #root rather than <body> keeps it
          inside the app's scaled 1920x1080 canvas. */}
      {createPortal(
        <OnScreenKeyboard
          visible={keyboardOpen}
          onInput={handleKeyboardInput}
          onBackspace={handleKeyboardBackspace}
          onEnter={() => {
            setKeyboardOpen(false);
            if (keyboardTarget !== 'host' || fields.host) browseShares();
          }}
          onClose={() => setKeyboardOpen(false)}
        />,
        document.getElementById('root') || document.body
      )}
    </>
  );
}
