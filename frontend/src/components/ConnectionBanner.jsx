import { useState } from 'react';
import t from '../i18n/he.json';

// ─── ConnectionBanner Component ─────────────────────────────────────────────
// Shown at the top of a page when an integration is in a degraded state.
// Props:
//   integration — display name string (e.g. "Google", "Home Assistant")
//   message     — description text
//   onAction    — callback for the "Reconnect" action button
//   onDismiss   — optional callback to dismiss the banner

export default function ConnectionBanner({ integration, message, onAction, onDismiss }) {
  const [dismissed, setDismissed] = useState(false);
  const [exiting, setExiting] = useState(false);

  if (dismissed) return null;

  const handleDismiss = () => {
    setExiting(true);
    setTimeout(() => {
      setDismissed(true);
      if (onDismiss) onDismiss();
    }, 250);
  };

  return (
    <div
      className="w-full overflow-hidden"
      style={{
        animation: exiting
          ? 'bannerSlideUp var(--dur-fast) var(--ease) forwards'
          : 'bannerSlideDown var(--dur-normal) var(--ease-out) forwards',
      }}
      dir="rtl"
    >
      <div
        className="flex items-center gap-4 px-6 py-3.5 rounded-xl mx-4 mt-3"
        style={{ backgroundColor: 'var(--gold-bg)' }}
        role="alert"
      >
        {/* Warning icon */}
        <div className="shrink-0" style={{ color: 'var(--gold-d)' }}>
          <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            className="w-6 h-6"
          >
            <path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" />
            <line x1="12" y1="9" x2="12" y2="13" />
            <line x1="12" y1="17" x2="12.01" y2="17" />
          </svg>
        </div>

        {/* Text */}
        <div className="flex-1 min-w-0">
          <span className="text-sm font-semibold" style={{ color: 'var(--gold-d)' }}>
            {integration}
          </span>
          {message && (
            <span className="text-sm font-normal mr-2" style={{ color: 'var(--tp)' }}>
              {' '}&mdash; {message}
            </span>
          )}
        </div>

        {/* Action button */}
        {onAction && (
          <button
            onClick={onAction}
            className="shrink-0 px-4 min-h-[44px] rounded-lg font-medium text-sm
                       active:scale-95 transition-all select-none"
            style={{
              backgroundColor: 'var(--gold-d)',
              color: '#fff',
              transitionDuration: 'var(--dur-fast)',
            }}
          >
            {t.errors.tryAgain}
          </button>
        )}

        {/* Dismiss X */}
        <button
          onClick={handleDismiss}
          className="shrink-0 w-[40px] h-[40px] flex items-center justify-center rounded-lg
                     active:scale-95 transition-all"
          style={{
            color: 'var(--gold-d)',
            transitionDuration: 'var(--dur-fast)',
          }}
          aria-label={t.common.cancel}
        >
          <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            className="w-5 h-5"
          >
            <line x1="18" y1="6" x2="6" y2="18" />
            <line x1="6" y1="6" x2="18" y2="18" />
          </svg>
        </button>
      </div>
    </div>
  );
}
