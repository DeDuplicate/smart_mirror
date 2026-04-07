import { useState, useEffect, useRef, useCallback } from 'react';

// ─── Debounce helper ────────────────────────────────────────────────────────

function useDebouncedCallback(fn, delay) {
  const timerRef = useRef(null);

  const debounced = useCallback(
    (...args) => {
      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = setTimeout(() => fn(...args), delay);
    },
    [fn, delay]
  );

  useEffect(() => {
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, []);

  return debounced;
}

// ─── Sun icon ───────────────────────────────────────────────────────────────

function SunIcon({ className = '' }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
    >
      <circle cx="12" cy="12" r="5" />
      <line x1="12" y1="1" x2="12" y2="3" />
      <line x1="12" y1="21" x2="12" y2="23" />
      <line x1="4.22" y1="4.22" x2="5.64" y2="5.64" />
      <line x1="18.36" y1="18.36" x2="19.78" y2="19.78" />
      <line x1="1" y1="12" x2="3" y2="12" />
      <line x1="21" y1="12" x2="23" y2="12" />
      <line x1="4.22" y1="19.78" x2="5.64" y2="18.36" />
      <line x1="18.36" y1="5.64" x2="19.78" y2="4.22" />
    </svg>
  );
}

// ─── BrightnessPopup Component ──────────────────────────────────────────────

export default function BrightnessPopup({ visible, onClose, anchorRef }) {
  const [brightness, setBrightness] = useState(80);
  const popupRef = useRef(null);
  const sliderRef = useRef(null);
  const isDragging = useRef(false);

  // Send brightness to backend (debounced)
  const sendBrightness = useCallback((value) => {
    fetch('/api/system/brightness', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ brightness: value }),
    }).catch(() => {
      // Silently fail
    });
  }, []);

  const debouncedSend = useDebouncedCallback(sendBrightness, 300);

  // Handle brightness change
  const handleBrightnessChange = useCallback(
    (value) => {
      const clamped = Math.max(0, Math.min(100, Math.round(value)));
      setBrightness(clamped);
      debouncedSend(clamped);
    },
    [debouncedSend]
  );

  // Vertical slider touch/mouse handling
  const getValueFromEvent = useCallback((e, sliderEl) => {
    if (!sliderEl) return null;
    const rect = sliderEl.getBoundingClientRect();
    const clientY = e.touches ? e.touches[0].clientY : e.clientY;
    // Top = 100%, bottom = 0%
    const ratio = 1 - (clientY - rect.top) / rect.height;
    return ratio * 100;
  }, []);

  const handleSliderStart = useCallback(
    (e) => {
      isDragging.current = true;
      const val = getValueFromEvent(e, sliderRef.current);
      if (val !== null) handleBrightnessChange(val);
    },
    [getValueFromEvent, handleBrightnessChange]
  );

  const handleSliderMove = useCallback(
    (e) => {
      if (!isDragging.current) return;
      e.preventDefault();
      const val = getValueFromEvent(e, sliderRef.current);
      if (val !== null) handleBrightnessChange(val);
    },
    [getValueFromEvent, handleBrightnessChange]
  );

  const handleSliderEnd = useCallback(() => {
    isDragging.current = false;
  }, []);

  // Global move/end listeners for dragging
  useEffect(() => {
    if (!visible) return;

    const handleMove = (e) => handleSliderMove(e);
    const handleEnd = () => handleSliderEnd();

    document.addEventListener('mousemove', handleMove);
    document.addEventListener('mouseup', handleEnd);
    document.addEventListener('touchmove', handleMove, { passive: false });
    document.addEventListener('touchend', handleEnd);

    return () => {
      document.removeEventListener('mousemove', handleMove);
      document.removeEventListener('mouseup', handleEnd);
      document.removeEventListener('touchmove', handleMove);
      document.removeEventListener('touchend', handleEnd);
    };
  }, [visible, handleSliderMove, handleSliderEnd]);

  // Close on click outside
  useEffect(() => {
    if (!visible) return;

    function handlePointerDown(e) {
      if (
        popupRef.current &&
        !popupRef.current.contains(e.target) &&
        anchorRef?.current &&
        !anchorRef.current.contains(e.target)
      ) {
        onClose();
      }
    }
    document.addEventListener('pointerdown', handlePointerDown);
    return () => document.removeEventListener('pointerdown', handlePointerDown);
  }, [visible, onClose, anchorRef]);

  // Close on Escape
  useEffect(() => {
    if (!visible) return;
    function handleKey(e) {
      if (e.key === 'Escape') onClose();
    }
    document.addEventListener('keydown', handleKey);
    return () => document.removeEventListener('keydown', handleKey);
  }, [visible, onClose]);

  if (!visible) return null;

  return (
    <div
      ref={popupRef}
      className="absolute top-full mt-3 z-50"
      style={{
        animation: 'brightnessPopupIn var(--dur-normal) var(--ease-out) forwards',
      }}
    >
      {/* Triangle pointer */}
      <div className="absolute -top-2 left-1/2 -translate-x-1/2 w-4 h-4 bg-surf border-t border-l border-bd rotate-45 rounded-sm" />

      {/* Card */}
      <div className="bg-surf border border-bd rounded-2xl shadow-xl p-5 flex flex-col items-center gap-4 min-w-[80px]">
        {/* Sun icon at top */}
        <SunIcon className="w-6 h-6 text-gold-d" />

        {/* Vertical slider */}
        <div
          ref={sliderRef}
          className="relative w-10 rounded-full bg-s2 border border-bd cursor-pointer select-none touch-none"
          style={{ height: '200px' }}
          onMouseDown={handleSliderStart}
          onTouchStart={handleSliderStart}
        >
          {/* Filled portion (from bottom up) */}
          <div
            className="absolute bottom-0 left-0 right-0 rounded-full bg-acc"
            style={{
              height: `${brightness}%`,
              transition: isDragging.current ? 'none' : 'height var(--dur-fast) var(--ease)',
            }}
          />

          {/* Thumb */}
          <div
            className="absolute left-1/2 -translate-x-1/2 w-7 h-7 rounded-full bg-white border-2 border-acc shadow-md"
            style={{
              bottom: `calc(${brightness}% - 14px)`,
              transition: isDragging.current ? 'none' : 'bottom var(--dur-fast) var(--ease)',
            }}
          />
        </div>

        {/* Percentage label */}
        <span className="font-mono text-lg font-medium text-tp">
          {brightness}%
        </span>
      </div>
    </div>
  );
}
