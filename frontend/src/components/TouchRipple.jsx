import { useState, useRef, useCallback } from 'react';

// ─── TouchRipple Component ──────────────────────────────────────────────────
// Wraps children with an expanding circle ripple on touch/click.

export default function TouchRipple({
  children,
  className = '',
  onClick,
  disabled = false,
}) {
  const [ripples, setRipples] = useState([]);
  const containerRef = useRef(null);
  const rippleIdRef = useRef(0);

  const createRipple = useCallback(
    (e) => {
      if (disabled) return;

      const container = containerRef.current;
      if (!container) return;

      const rect = container.getBoundingClientRect();

      // Get touch/mouse position relative to container
      const clientX = e.touches ? e.touches[0].clientX : e.clientX;
      const clientY = e.touches ? e.touches[0].clientY : e.clientY;
      const x = clientX - rect.left;
      const y = clientY - rect.top;

      // Calculate the maximum distance from the click to any corner
      const maxDistX = Math.max(x, rect.width - x);
      const maxDistY = Math.max(y, rect.height - y);
      const radius = Math.sqrt(maxDistX * maxDistX + maxDistY * maxDistY);

      const id = ++rippleIdRef.current;
      const newRipple = { id, x, y, radius };

      setRipples((prev) => [...prev, newRipple]);

      // Remove after animation completes (300ms expand + 200ms fade)
      setTimeout(() => {
        setRipples((prev) => prev.filter((r) => r.id !== id));
      }, 500);
    },
    [disabled]
  );

  const handleInteraction = useCallback(
    (e) => {
      createRipple(e);
      if (onClick && !disabled) {
        onClick(e);
      }
    },
    [createRipple, onClick, disabled]
  );

  return (
    <div
      ref={containerRef}
      className={`relative overflow-hidden ${className}`}
      onTouchStart={createRipple}
      onMouseDown={(e) => {
        // Avoid double ripple on touch devices
        if (e.button === 0) createRipple(e);
      }}
      onClick={disabled ? undefined : onClick}
      role={onClick ? 'button' : undefined}
      tabIndex={onClick && !disabled ? 0 : undefined}
      aria-disabled={disabled || undefined}
      style={{ cursor: disabled ? 'default' : onClick ? 'pointer' : undefined }}
    >
      {children}

      {/* Ripple circles */}
      {ripples.map((ripple) => (
        <span
          key={ripple.id}
          className="absolute pointer-events-none rounded-full"
          style={{
            left: ripple.x - ripple.radius,
            top: ripple.y - ripple.radius,
            width: ripple.radius * 2,
            height: ripple.radius * 2,
            background: 'rgba(255, 255, 255, 0.20)',
            transform: 'scale(0)',
            animation: 'touchRippleExpand 300ms ease-out forwards',
          }}
        />
      ))}
    </div>
  );
}
