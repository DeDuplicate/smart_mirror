import { useState, useEffect, useRef } from 'react';
import { io } from 'socket.io-client';
import t from '../i18n/he.json';

// ─── Socket singleton ───────────────────────────────────────────────────────

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

// ─── Timeout duration ───────────────────────────────────────────────────────

const TIMEOUT_MS = 120_000; // 2 minutes

// ─── OAuthOverlay Component ─────────────────────────────────────────────────
// The actual login UI happens in a real top-level popup window (opened by
// useAuth's startGoogleAuth/startSpotifyAuth) — OAuth providers block their
// consent pages from being embedded in an <iframe>, so this overlay only
// shows a "waiting for the popup" status while the person completes the
// flow in the separate window, and lets them retry if it stalls.

export default function OAuthOverlay({ provider, authUrl, onSuccess, onClose, onRetry }) {
  const [timedOut, setTimedOut] = useState(false);
  const [closing, setClosing] = useState(false);
  const timeoutRef = useRef(null);

  // Listen for auth success via Socket.io
  useEffect(() => {
    const sock = getSocket();

    const eventName =
      provider === 'google' ? 'auth:google:linked' : 'auth:spotify:linked';

    const handleSuccess = (data) => {
      clearTimeout(timeoutRef.current);
      if (onSuccess) onSuccess(data);
      handleClose();
    };

    sock.on(eventName, handleSuccess);

    return () => {
      sock.off(eventName, handleSuccess);
    };
  }, [provider, onSuccess]);

  // Timeout after 2 minutes
  useEffect(() => {
    timeoutRef.current = setTimeout(() => {
      setTimedOut(true);
    }, TIMEOUT_MS);

    return () => {
      clearTimeout(timeoutRef.current);
    };
  }, [authUrl]);

  // Animated close
  const handleClose = () => {
    setClosing(true);
    setTimeout(() => {
      if (onClose) onClose();
    }, 250);
  };

  // Retry on timeout — reopens a fresh popup via useAuth's retryAuth
  const handleRetry = () => {
    setTimedOut(false);
    clearTimeout(timeoutRef.current);
    timeoutRef.current = setTimeout(() => {
      setTimedOut(true);
    }, TIMEOUT_MS);
    if (onRetry) onRetry();
  };

  if (!authUrl) return null;

  return (
    <div
      className="fixed inset-0 z-[45] flex items-center justify-center"
      style={{
        direction: 'rtl',
        animation: closing
          ? 'fadeOut var(--dur-fast) var(--ease) forwards'
          : 'fadeIn var(--dur-normal) var(--ease) forwards',
      }}
    >
      {/* Semi-transparent backdrop */}
      <div
        className="absolute inset-0 bg-tp/50"
        onClick={handleClose}
      />

      {/* Status panel */}
      <div
        className="relative bg-surf rounded-2xl shadow-modal overflow-hidden flex flex-col"
        style={{
          width: 420,
          maxWidth: '90vw',
          animation: closing
            ? 'fadeOut var(--dur-fast) var(--ease) forwards'
            : 'popupIn var(--dur-normal) var(--ease-out) forwards',
        }}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-bd">
          <h3 className="text-lg font-semibold text-tp">
            {provider === 'google' ? t.setup.googleAccount : t.setup.spotify}
          </h3>

          {/* Close button */}
          <button
            onClick={handleClose}
            className="w-[56px] h-[56px] flex items-center justify-center rounded-xl
                       text-ts hover:bg-s2 active:scale-95
                       transition-all"
            style={{ transitionDuration: 'var(--dur-fast)' }}
            aria-label={t.common.cancel}
          >
            <svg
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              className="w-6 h-6"
            >
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>

        {/* Content area */}
        <div className="relative py-10 px-8">
          {!timedOut && (
            <div className="flex flex-col items-center gap-4 text-center">
              <div
                className="w-10 h-10 border-3 border-bd border-t-acc rounded-full"
                style={{ animation: 'spin 0.8s linear infinite' }}
              />
              <p className="text-tp font-semibold text-base">
                ממתינים לאישור בחלון שנפתח
              </p>
              <p className="text-ts text-sm">
                השלימו את ההתחברות בחלון שנפתח בדפדפן. אם לא נפתח חלון, ודאו
                שחלונות קופצים (popups) מותרים ונסו שוב.
              </p>
            </div>
          )}

          {/* Timeout message */}
          {timedOut && (
            <div className="flex flex-col items-center gap-4 text-center">
              {/* Timeout icon */}
              <div className="w-16 h-16 rounded-full bg-gold/30 flex items-center justify-center">
                <svg
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  className="w-8 h-8 text-gold-d"
                >
                  <circle cx="12" cy="12" r="10" />
                  <polyline points="12 6 12 12 16 14" />
                </svg>
              </div>

              <p className="text-tp font-semibold text-lg">
                {provider === 'google'
                  ? 'החיבור לגוגל לא הושלם'
                  : 'החיבור לספוטיפיי לא הושלם'}
              </p>
              <p className="text-ts text-sm">
                עבר יותר מדי זמן. נסה שוב.
              </p>

              <button
                onClick={handleRetry}
                className="px-6 min-h-[56px] bg-acc text-white rounded-xl
                           font-medium text-base
                           hover:brightness-110 active:scale-95
                           transition-all select-none"
                style={{ transitionDuration: 'var(--dur-fast)' }}
              >
                {t.errors.tryAgain}
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
