import useStore from '../store/index.js';
import t from '../i18n/he.json';

// ─── SVG Icons per toast type ───────────────────────────────────────────────

const icons = {
  success: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="w-5 h-5 shrink-0">
      <path d="M20 6L9 17l-5-5" />
    </svg>
  ),
  warning: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="w-5 h-5 shrink-0">
      <path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" />
      <line x1="12" y1="9" x2="12" y2="13" />
      <line x1="12" y1="17" x2="12.01" y2="17" />
    </svg>
  ),
  error: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="w-5 h-5 shrink-0">
      <circle cx="12" cy="12" r="10" />
      <line x1="15" y1="9" x2="9" y2="15" />
      <line x1="9" y1="9" x2="15" y2="15" />
    </svg>
  ),
  info: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="w-5 h-5 shrink-0">
      <circle cx="12" cy="12" r="10" />
      <line x1="12" y1="16" x2="12" y2="12" />
      <line x1="12" y1="8" x2="12.01" y2="8" />
    </svg>
  ),
};

// ─── Border color per type (CSS variable values) ────────────────────────────

const borderColors = {
  success: 'var(--acc2)',
  warning: 'var(--gold-d)',
  error: 'var(--coral-d)',
  info: 'var(--acc)',
};

const iconColors = {
  success: 'text-acc2',
  warning: 'text-gold-d',
  error: 'text-coral-d',
  info: 'text-acc',
};

// ─── ToastContainer Component ───────────────────────────────────────────────

export default function ToastContainer() {
  const toasts = useStore((s) => s.toasts);
  const removeToast = useStore((s) => s.removeToast);

  // Only show up to 3 visible toasts
  const visibleToasts = toasts.slice(-3);

  if (visibleToasts.length === 0) return null;

  return (
    <div
      className="fixed top-6 left-1/2 -translate-x-1/2 z-50 flex flex-col gap-3 pointer-events-none"
      style={{ direction: 'rtl' }}
    >
      {visibleToasts.map((toast) => {
        const type = toast.type || 'info';
        return (
          <div
            key={toast.id}
            onClick={() => removeToast(toast.id)}
            className={`
              pointer-events-auto cursor-pointer select-none
              flex items-center gap-3 px-5 py-3.5
              bg-surf border border-bd rounded-xl shadow-lg
              min-w-[320px] max-w-[480px]
              ${toast.exiting ? 'animate-toast-out' : 'animate-toast-in'}
            `}
            style={{
              borderRightWidth: '4px',
              borderRightColor: borderColors[type],
            }}
            role="alert"
            aria-live="polite"
          >
            {/* Icon */}
            <span className={iconColors[type]}>
              {icons[type]}
            </span>

            {/* Text content */}
            <div className="flex flex-col min-w-0 flex-1">
              <span className="text-xs font-semibold text-ts leading-tight">
                {t.toast[type] || ''}
              </span>
              <span className="text-sm font-medium text-tp leading-snug truncate">
                {toast.message}
              </span>
            </div>
          </div>
        );
      })}
    </div>
  );
}
