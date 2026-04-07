import { useEffect, useRef } from 'react';
import useStore from '../store/index.js';
import t from '../i18n/he.json';

// ─── ConfirmDialog Component ────────────────────────────────────────────────

export default function ConfirmDialog() {
  const { isOpen, title, message, onConfirm } = useStore((s) => s.confirm);
  const hideConfirm = useStore((s) => s.hideConfirm);
  const cardRef = useRef(null);

  // Close on Escape key
  useEffect(() => {
    if (!isOpen) return;
    function handleKey(e) {
      if (e.key === 'Escape') hideConfirm();
    }
    document.addEventListener('keydown', handleKey);
    return () => document.removeEventListener('keydown', handleKey);
  }, [isOpen, hideConfirm]);

  if (!isOpen) return null;

  const handleConfirm = () => {
    if (onConfirm) onConfirm();
    hideConfirm();
  };

  const handleBackdropClick = (e) => {
    // Only close if clicking the backdrop itself, not the card
    if (cardRef.current && !cardRef.current.contains(e.target)) {
      hideConfirm();
    }
  };

  return (
    <div
      className="fixed inset-0 z-40 flex items-center justify-center"
      onClick={handleBackdropClick}
      style={{ direction: 'rtl' }}
    >
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-tp"
        style={{
          opacity: 0.4,
          animation: `fadeIn var(--dur-fast) var(--ease) forwards`,
        }}
      />

      {/* Card */}
      <div
        ref={cardRef}
        className="relative bg-surf border border-bd rounded-2xl shadow-2xl p-8 min-w-[380px] max-w-[480px]"
        style={{
          animation: `confirmCardIn var(--dur-normal) var(--ease-out) forwards`,
        }}
      >
        {/* Title */}
        {title && (
          <h2 className="text-xl font-semibold text-tp mb-2 font-heebo">
            {title}
          </h2>
        )}

        {/* Message */}
        {message && (
          <p className="text-base text-ts mb-8 leading-relaxed font-heebo font-normal">
            {message}
          </p>
        )}

        {/* Buttons */}
        <div className="flex gap-3 justify-start">
          {/* Confirm button - filled accent */}
          <button
            onClick={handleConfirm}
            className="
              px-6 min-h-[56px] bg-acc text-white rounded-xl
              font-heebo font-medium text-base
              hover:brightness-110 active:scale-95
              transition-all select-none
            "
            style={{ transitionDuration: 'var(--dur-fast)' }}
          >
            {t.common.confirm}
          </button>

          {/* Cancel button - outlined */}
          <button
            onClick={hideConfirm}
            className="
              px-6 min-h-[56px] bg-transparent border border-bd text-ts rounded-xl
              font-heebo font-medium text-base
              hover:bg-s2 active:scale-95
              transition-all select-none
            "
            style={{ transitionDuration: 'var(--dur-fast)' }}
          >
            {t.common.cancel}
          </button>
        </div>
      </div>
    </div>
  );
}
