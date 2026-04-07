import { useState, useRef, useCallback } from 'react';

// ─── Pull-to-Refresh Hook ────────────────────────────────────────────────────
// Detects pull-down gesture on touch and triggers a callback when pulled
// past a threshold. Returns touch event handlers to spread on a container.

const PULL_THRESHOLD = 60; // px to trigger refresh
const MAX_PULL = 100; // max pull distance
const RESISTANCE = 0.4; // resistance factor for elastic feel

export default function usePullToRefresh(onRefresh) {
  const [pullDistance, setPullDistance] = useState(0);
  const [isPulling, setIsPulling] = useState(false);

  const startYRef = useRef(0);
  const pullingRef = useRef(false);
  const containerRef = useRef(null);

  const handleTouchStart = useCallback((e) => {
    const container = e.currentTarget;
    containerRef.current = container;

    // Only activate if scrolled to top
    if (container.scrollTop > 0) return;

    startYRef.current = e.touches[0].clientY;
    pullingRef.current = false;
  }, []);

  const handleTouchMove = useCallback((e) => {
    if (startYRef.current === 0) return;

    const container = containerRef.current;
    if (!container || container.scrollTop > 0) {
      // Reset if user has scrolled down
      startYRef.current = 0;
      pullingRef.current = false;
      setPullDistance(0);
      setIsPulling(false);
      return;
    }

    const currentY = e.touches[0].clientY;
    const rawDelta = currentY - startYRef.current;

    // Only activate on downward pull
    if (rawDelta <= 0) {
      if (pullingRef.current) {
        pullingRef.current = false;
        setPullDistance(0);
        setIsPulling(false);
      }
      return;
    }

    // Apply resistance for elastic feel
    const distance = Math.min(rawDelta * RESISTANCE, MAX_PULL);

    if (!pullingRef.current) {
      pullingRef.current = true;
      setIsPulling(true);
    }

    setPullDistance(distance);
  }, []);

  const handleTouchEnd = useCallback(() => {
    if (pullingRef.current && pullDistance >= PULL_THRESHOLD * RESISTANCE) {
      // Trigger refresh
      if (onRefresh) onRefresh();
    }

    // Reset state with snap-back
    startYRef.current = 0;
    pullingRef.current = false;
    setPullDistance(0);
    setIsPulling(false);
  }, [pullDistance, onRefresh]);

  const bind = {
    onTouchStart: handleTouchStart,
    onTouchMove: handleTouchMove,
    onTouchEnd: handleTouchEnd,
  };

  return { pullDistance, isPulling, bind };
}
