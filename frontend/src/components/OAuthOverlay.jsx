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

export default function OAuthOverlay({ provider, authUrl, onSuccess, onClose }) {
  const [iframeLoaded, setIframeLoaded] = useState(false);
  const [timedOut, setTimedOut] = useState(false);
  const [closing, setClosing] = useState(false);
  const timeoutRef = useRef(null);
  const iframeRef = useRef(null);

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

  // Retry on timeout
  const handleRetry = () => {
    setTimedOut(false);
    setIframeLoaded(false);
    // Reset timeout
    clearTimeout(timeoutRef.current);
    timeoutRef.current = setTimeout(() => {
      setTimedOut(true);
    }, TIMEOUT_MS);
    // Force iframe reload
    if (iframeRef.current) {
      iframeRef.current.src = authUrl;
    }
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

      {/* Iframe container */}
      <div
        className="relative bg-surf rounded-2xl shadow-2xl overflow-hidden flex flex-col"
        style={{
          width: 560,
          height: 680,
          maxWidth: '90vw',
          maxHeight: '90vh',
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
        <div className="flex-1 relative">
          {/* Loading spinner */}
          {!iframeLoaded && !timedOut && (
            <div className="absolute inset-0 flex items-center justify-center bg-surf z-10">
              <div className="flex flex-col items-center gap-4">
                <div
                  className="w-10 h-10 border-3 border-bd border-t-acc rounded-full"
                  style={{
                    animation: 'spin 0.8s linear infinite',
                  }}
                />
                <span className="text-ts text-sm font-medium">
                  {t.common.loading}
                </span>
              </div>
            </div>
          )}

          {/* Timeout message */}
          {timedOut && (
            <div className="absolute inset-0 flex items-center justify-center bg-surf z-10">
              <div className="flex flex-col items-center gap-4 text-center px-8">
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
            </div>
          )}

          {/* OAuth iframe */}
          {!timedOut && (
            <iframe
              ref={iframeRef}
              src={authUrl}
              onLoad={() => setIframeLoaded(true)}
              className="w-full h-full border-0"
              title={`${provider} OAuth`}
              sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-popups-to-escape-sandbox"
            />
          )}
        </div>
      </div>
    </div>
  );
}
