import { useEffect } from 'react';

// ─── useRippleEffect ─────────────────────────────────────────────────────────
// Activates the CSS `.ripple` touch-feedback effect (see global.css) used
// across the app on buttons/tiles. The class alone does nothing — this hook
// delegates a single pointerdown listener at the document root, finds the
// nearest `.ripple` ancestor of the interaction target, and toggles the
// `.active` class that drives the expanding-circle keyframe animation.
// Mount once near the app root.

export default function useRippleEffect() {
  useEffect(() => {
    const handlePointerDown = (e) => {
      const el = e.target.closest?.('.ripple');
      if (!el) return;

      // Restart the animation even on rapid repeat taps.
      el.classList.remove('active');
      // Force reflow so the class removal is registered before re-adding.
      // eslint-disable-next-line no-unused-expressions
      el.offsetWidth;
      el.classList.add('active');
    };

    const clearActive = (e) => {
      if (e.target.classList?.contains('ripple')) {
        e.target.classList.remove('active');
      }
    };

    document.addEventListener('pointerdown', handlePointerDown);
    document.addEventListener('animationend', clearActive, true);

    return () => {
      document.removeEventListener('pointerdown', handlePointerDown);
      document.removeEventListener('animationend', clearActive, true);
    };
  }, []);
}
