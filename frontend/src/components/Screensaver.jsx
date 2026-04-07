import { useState, useEffect, useRef, useCallback } from 'react';

// ─── Screensaver Component ───────────────────────────────────────────────────
// Two modes: "clock" (full-screen dark clock) or "slideshow" (Ken Burns photos).
// Fades in on mount. Any touch/click dismisses it via onDismiss callback.

// ─── Gradient "photos" for slideshow placeholder ─────────────────────────────

const SLIDESHOW_GRADIENTS = [
  'linear-gradient(135deg, #1a1c2e 0%, #2d1b69 30%, #0a0a1f 100%)',
  'linear-gradient(145deg, #0a1628 0%, #1a3a4a 40%, #0a0a1f 100%)',
  'linear-gradient(125deg, #1f0a28 0%, #3a1a4a 35%, #0a0a1f 100%)',
  'linear-gradient(155deg, #0a1a0a 0%, #1a3a2a 40%, #0a0a1f 100%)',
  'linear-gradient(130deg, #1a1a0a 0%, #3a2a1a 35%, #0a0a1f 100%)',
];

const SLIDE_DURATION = 15000; // 15s per slide
const CROSSFADE_DURATION = 1000; // 1s crossfade

// ─── Clock Display ───────────────────────────────────────────────────────────

function useClock() {
  const [time, setTime] = useState(() => new Date());

  useEffect(() => {
    const timer = setInterval(() => setTime(new Date()), 1000);
    return () => clearInterval(timer);
  }, []);

  return time;
}

function formatClockTime(date) {
  const hh = String(date.getHours()).padStart(2, '0');
  const mm = String(date.getMinutes()).padStart(2, '0');
  const ss = String(date.getSeconds()).padStart(2, '0');
  return { hh, mm, ss };
}

function formatHebrewDate(date) {
  try {
    return date.toLocaleDateString('he-IL', {
      weekday: 'long',
      year: 'numeric',
      month: 'long',
      day: 'numeric',
    });
  } catch {
    return '';
  }
}

// ─── Clock Mode ──────────────────────────────────────────────────────────────

function ClockMode() {
  const time = useClock();
  const { hh, mm, ss } = formatClockTime(time);
  const dateStr = formatHebrewDate(time);

  return (
    <div className="flex flex-col items-center justify-center h-full select-none">
      {/* Large clock with breathing animation */}
      <div
        className="screensaver-clock-breathing"
        style={{
          fontFamily: "'DM Mono', monospace",
          fontSize: '120px',
          fontWeight: 300,
          color: '#ffffff',
          letterSpacing: '0.05em',
          lineHeight: 1,
        }}
      >
        <span>{hh}</span>
        <span style={{ opacity: 0.6 }}>:</span>
        <span>{mm}</span>
        <span style={{ fontSize: '60px', opacity: 0.4, marginInlineStart: '8px' }}>
          {ss}
        </span>
      </div>

      {/* Hebrew date below */}
      <p
        className="mt-6 text-white/40 text-lg font-light select-none"
        dir="rtl"
      >
        {dateStr}
      </p>
    </div>
  );
}

// ─── Slideshow Mode ──────────────────────────────────────────────────────────

function SlideshowMode() {
  const time = useClock();
  const { hh, mm } = formatClockTime(time);
  const dateStr = formatHebrewDate(time);

  const [currentSlide, setCurrentSlide] = useState(0);
  const [nextSlide, setNextSlide] = useState(1);
  const [transitioning, setTransitioning] = useState(false);
  const slideTimerRef = useRef(null);

  // Cycle through slides
  useEffect(() => {
    slideTimerRef.current = setInterval(() => {
      setTransitioning(true);

      // After crossfade completes, swap slides
      setTimeout(() => {
        setCurrentSlide((prev) => {
          const next = (prev + 1) % SLIDESHOW_GRADIENTS.length;
          return next;
        });
        setNextSlide((prev) => {
          const next = (prev + 1) % SLIDESHOW_GRADIENTS.length;
          return next;
        });
        setTransitioning(false);
      }, CROSSFADE_DURATION);
    }, SLIDE_DURATION);

    return () => {
      if (slideTimerRef.current) clearInterval(slideTimerRef.current);
    };
  }, []);

  return (
    <div className="relative w-full h-full overflow-hidden">
      {/* Current slide with Ken Burns */}
      <div
        className="absolute inset-0 kenburns-1"
        style={{
          background: SLIDESHOW_GRADIENTS[currentSlide],
          opacity: transitioning ? 0 : 1,
          transition: `opacity ${CROSSFADE_DURATION}ms ease`,
          willChange: 'transform',
        }}
      />

      {/* Next slide (fades in during transition) */}
      <div
        className="absolute inset-0 kenburns-2"
        style={{
          background: SLIDESHOW_GRADIENTS[nextSlide],
          opacity: transitioning ? 1 : 0,
          transition: `opacity ${CROSSFADE_DURATION}ms ease`,
          willChange: 'transform',
        }}
      />

      {/* Clock overlay in bottom-right (RTL: bottom-left) */}
      <div
        className="absolute bottom-8 left-8 flex flex-col items-start select-none"
        dir="rtl"
        style={{ zIndex: 2 }}
      >
        <span
          style={{
            fontFamily: "'DM Mono', monospace",
            fontSize: '48px',
            fontWeight: 300,
            color: '#ffffff',
            textShadow: '0 2px 12px rgba(0,0,0,0.6)',
            lineHeight: 1,
          }}
        >
          {hh}:{mm}
        </span>
        <span
          className="mt-2 text-white/50 text-sm font-light"
          style={{ textShadow: '0 1px 6px rgba(0,0,0,0.5)' }}
        >
          {dateStr}
        </span>
      </div>
    </div>
  );
}

// ─── Screensaver Container ───────────────────────────────────────────────────

export default function Screensaver({ style = 'clock', onDismiss }) {
  const [visible, setVisible] = useState(false);
  const [exiting, setExiting] = useState(false);

  // Fade in on mount
  useEffect(() => {
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        setVisible(true);
      });
    });
  }, []);

  // Handle dismiss
  const handleDismiss = useCallback(() => {
    if (exiting) return;
    setExiting(true);
    setVisible(false);

    // Wait for fade-out to complete, then call onDismiss
    setTimeout(() => {
      if (onDismiss) onDismiss();
    }, 400); // matches --dur-slow
  }, [exiting, onDismiss]);

  // Dismiss on any touch/click/key
  useEffect(() => {
    const dismiss = () => handleDismiss();

    // Small delay to prevent immediate dismissal from the same event
    // that might have triggered idle state
    const timer = setTimeout(() => {
      window.addEventListener('touchstart', dismiss, { once: true });
      window.addEventListener('mousedown', dismiss, { once: true });
      window.addEventListener('keydown', dismiss, { once: true });
    }, 500);

    return () => {
      clearTimeout(timer);
      window.removeEventListener('touchstart', dismiss);
      window.removeEventListener('mousedown', dismiss);
      window.removeEventListener('keydown', dismiss);
    };
  }, [handleDismiss]);

  return (
    <div
      className="fixed inset-0"
      style={{
        zIndex: 30,
        backgroundColor: '#0a0a0f',
        opacity: visible ? 1 : 0,
        transition: `opacity var(--dur-slow) var(--ease)`,
        cursor: 'pointer',
      }}
    >
      {style === 'slideshow' ? <SlideshowMode /> : <ClockMode />}
    </div>
  );
}
