import { useState, useEffect, useCallback, useRef } from 'react';
import useStore from '../store/index.js';

// ─── Idle Detection Hook ─────────────────────────────────────────────────────
// Tracks user activity (touch, mouse, keyboard) and sets idle state
// after a configurable timeout from settings.idleTimeout (minutes).

const ACTIVITY_EVENTS = [
  'touchstart',
  'touchmove',
  'mousedown',
  'mousemove',
  'keydown',
  'scroll',
  'wheel',
];

export default function useIdleDetection() {
  const idleMinutes = useStore((s) => s.settings.idleTimeout) || 5;
  const [isIdle, setIsIdle] = useState(false);
  const timerRef = useRef(null);
  const idleRef = useRef(false);

  const resetIdle = useCallback(() => {
    // Clear existing timer
    if (timerRef.current) {
      clearTimeout(timerRef.current);
    }

    // If currently idle, exit idle state
    if (idleRef.current) {
      idleRef.current = false;
      setIsIdle(false);
    }

    // Set new timeout
    timerRef.current = setTimeout(() => {
      idleRef.current = true;
      setIsIdle(true);
    }, idleMinutes * 60 * 1000);
  }, [idleMinutes]);

  useEffect(() => {
    // Start initial timer
    resetIdle();

    // Attach activity listeners
    const handleActivity = () => {
      resetIdle();
    };

    for (const event of ACTIVITY_EVENTS) {
      window.addEventListener(event, handleActivity, { passive: true });
    }

    return () => {
      if (timerRef.current) {
        clearTimeout(timerRef.current);
      }
      for (const event of ACTIVITY_EVENTS) {
        window.removeEventListener(event, handleActivity);
      }
    };
  }, [resetIdle]);

  return { isIdle, resetIdle };
}
