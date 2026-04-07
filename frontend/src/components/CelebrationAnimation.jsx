import { useEffect, useRef, useCallback } from 'react';

// ─── Preload celebration sound ─────────────────────────────────────────────

let cachedAudio = null;

function preloadSound() {
  if (cachedAudio) return cachedAudio;
  try {
    cachedAudio = new Audio('/sounds/celebrate.mp3');
    cachedAudio.volume = 0.6;
    cachedAudio.preload = 'auto';
  } catch {
    // Audio API not available
  }
  return cachedAudio;
}

function playSound() {
  try {
    const audio = preloadSound();
    if (!audio) return;
    audio.currentTime = 0;
    audio.volume = 0.6;
    audio.play().catch(() => {
      // Autoplay blocked — silently ignore
    });
  } catch {
    // Silently fail
  }
}

// ─── Particle types ────────────────────────────────────────────────────────

const PARTICLE_CHARS = ['⭐', '✨', '🎉', '🎊', '🏆', '💪', '👏', '🌟', '🔥', '💥'];
const CONFETTI_COLORS = ['#FFD700', '#FF6B6B', '#4ECDC4', '#45B7D1', '#96CEB4', '#FFEAA7', '#DDA0DD', '#98D8C8', '#FF69B4', '#00FF7F'];

function randomRange(min, max) {
  return min + Math.random() * (max - min);
}

// ─── CelebrationAnimation Component ───────────────────────────────────────

export default function CelebrationAnimation({
  personName,
  personColor,
  columnRef,
  onComplete,
}) {
  const canvasRef = useRef(null);
  const bannerRef = useRef(null);
  const flashRef = useRef(null);
  const animFrameRef = useRef(null);
  const startTimeRef = useRef(null);

  // Check for reduced motion
  const prefersReducedMotion =
    typeof window !== 'undefined' &&
    window.matchMedia &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  const runAnimation = useCallback(() => {
    const column = columnRef?.current;
    if (!column) return;

    const rect = column.getBoundingClientRect();
    const canvas = canvasRef.current;
    if (!canvas) return;

    // Size canvas to column
    canvas.width = rect.width;
    canvas.height = rect.height;
    const ctx = canvas.getContext('2d');

    // Avatar center (top center of column, roughly)
    const cx = rect.width / 2;
    const cy = 60;

    // ── Create particles ───────────────────────────────────────────────
    const particleCount = Math.floor(randomRange(80, 120));
    const particles = [];
    for (let i = 0; i < particleCount; i++) {
      const angle = randomRange(0, Math.PI * 2);
      const velocity = randomRange(120, 350);
      const isEmoji = Math.random() > 0.4;
      particles.push({
        x: cx,
        y: cy,
        vx: Math.cos(angle) * velocity,
        vy: Math.sin(angle) * velocity,
        gravity: 100,
        life: randomRange(1200, 2500),
        born: 0,
        type: isEmoji ? 'emoji' : 'confetti',
        char: isEmoji ? PARTICLE_CHARS[Math.floor(Math.random() * PARTICLE_CHARS.length)] : null,
        color: isEmoji ? null : CONFETTI_COLORS[Math.floor(Math.random() * CONFETTI_COLORS.length)],
        size: isEmoji ? randomRange(20, 36) : randomRange(6, 14),
        rotation: randomRange(0, Math.PI * 2),
        rotSpeed: randomRange(-5, 5),
      });
    }

    // ── Create firework rockets ────────────────────────────────────────
    const rocketCount = Math.floor(randomRange(5, 8));
    const rockets = [];
    for (let i = 0; i < rocketCount; i++) {
      const startX = randomRange(rect.width * 0.2, rect.width * 0.8);
      const targetY = randomRange(rect.height * 0.15, rect.height * 0.35);
      rockets.push({
        x: startX,
        y: rect.height,
        targetY,
        startY: rect.height,
        speed: randomRange(300, 500),
        launchDelay: randomRange(200, 1000),
        launched: false,
        exploded: false,
        explodeTime: 0,
        burstParticles: [],
        color: CONFETTI_COLORS[Math.floor(Math.random() * CONFETTI_COLORS.length)],
      });
    }

    // ── Column flash ───────────────────────────────────────────────────
    const flash = flashRef.current;
    if (flash) {
      flash.style.opacity = '0.3';
      flash.style.transition = 'opacity 300ms ease-out';
      requestAnimationFrame(() => {
        setTimeout(() => {
          flash.style.opacity = '0';
        }, 50);
      });
    }

    // ── Banner ─────────────────────────────────────────────────────────
    const banner = bannerRef.current;
    if (banner) {
      setTimeout(() => {
        banner.style.opacity = '1';
        banner.style.transform = 'translateY(0)';
      }, 400);
      setTimeout(() => {
        banner.style.opacity = '0';
        banner.style.transform = 'translateY(-20px)';
      }, 4500);
    }

    // ── Play sound ─────────────────────────────────────────────────────
    playSound();

    // ── Animation loop ─────────────────────────────────────────────────
    startTimeRef.current = performance.now();

    function animate(now) {
      const elapsed = now - startTimeRef.current;
      if (elapsed > 5000) {
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        if (onComplete) onComplete();
        return;
      }

      ctx.clearRect(0, 0, canvas.width, canvas.height);

      // Draw particles (0-2500ms)
      if (elapsed < 2500) {
        for (const p of particles) {
          if (p.born === 0) p.born = elapsed;
          const age = elapsed - p.born;
          if (age > p.life) continue;

          const t = age / 1000;
          const px = p.x + p.vx * t;
          const py = p.y + p.vy * t + 0.5 * p.gravity * t * t;
          const alpha = 1 - age / p.life;

          ctx.globalAlpha = alpha;
          if (p.type === 'emoji') {
            ctx.font = `${p.size}px serif`;
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillText(p.char, px, py);
          } else {
            ctx.save();
            ctx.translate(px, py);
            ctx.rotate(p.rotation + p.rotSpeed * t);
            ctx.fillStyle = p.color;
            ctx.fillRect(-p.size / 2, -p.size / 2, p.size, p.size);
            ctx.restore();
          }
        }
      }

      // Draw rockets (200-3000ms)
      if (elapsed > 200 && elapsed < 3000) {
        for (const r of rockets) {
          if (elapsed < r.launchDelay + 200) continue;

          if (!r.launched) {
            r.launched = true;
            r.launchTime = elapsed;
          }

          const rocketAge = elapsed - r.launchTime;

          if (!r.exploded) {
            // Rising
            const progress = Math.min(rocketAge / 600, 1);
            r.y = r.startY - (r.startY - r.targetY) * progress;

            // Draw rocket trail
            ctx.globalAlpha = 0.8;
            ctx.strokeStyle = r.color;
            ctx.lineWidth = 2;
            ctx.beginPath();
            ctx.moveTo(r.x, r.y);
            ctx.lineTo(r.x, r.y + 20);
            ctx.stroke();

            // Draw rocket head
            ctx.fillStyle = '#fff';
            ctx.beginPath();
            ctx.arc(r.x, r.y, 3, 0, Math.PI * 2);
            ctx.fill();

            if (progress >= 1) {
              r.exploded = true;
              r.explodeTime = elapsed;
              // Create burst
              const burstCount = Math.floor(randomRange(20, 35));
              for (let i = 0; i < burstCount; i++) {
                const angle = (i / burstCount) * Math.PI * 2;
                const vel = randomRange(60, 200);
                r.burstParticles.push({
                  x: r.x,
                  y: r.y,
                  vx: Math.cos(angle) * vel,
                  vy: Math.sin(angle) * vel,
                  life: randomRange(600, 1200),
                  born: elapsed,
                  color: r.color,
                  size: randomRange(3, 8),
                });
              }
            }
          } else {
            // Draw burst particles
            for (const bp of r.burstParticles) {
              const bAge = elapsed - bp.born;
              if (bAge > bp.life) continue;
              const bt = bAge / 1000;
              const bx = bp.x + bp.vx * bt;
              const by = bp.y + bp.vy * bt + 0.5 * 80 * bt * bt;
              const alpha = 1 - bAge / bp.life;
              ctx.globalAlpha = alpha;
              ctx.fillStyle = bp.color;
              ctx.beginPath();
              ctx.arc(bx, by, bp.size, 0, Math.PI * 2);
              ctx.fill();
            }
          }
        }
      }

      ctx.globalAlpha = 1;
      animFrameRef.current = requestAnimationFrame(animate);
    }

    animFrameRef.current = requestAnimationFrame(animate);
  }, [columnRef, onComplete, personColor, personName]);

  useEffect(() => {
    if (prefersReducedMotion) {
      // Reduced motion: show banner only, skip particles
      const banner = bannerRef.current;
      if (banner) {
        setTimeout(() => {
          banner.style.opacity = '1';
          banner.style.transform = 'translateY(0)';
        }, 100);
        setTimeout(() => {
          banner.style.opacity = '0';
          banner.style.transform = 'translateY(-20px)';
        }, 2800);
      }
      playSound();
      const timeout = setTimeout(() => {
        if (onComplete) onComplete();
      }, 5000);
      return () => clearTimeout(timeout);
    }

    runAnimation();

    const cleanup = setTimeout(() => {
      if (animFrameRef.current) {
        cancelAnimationFrame(animFrameRef.current);
      }
    }, 3200);

    return () => {
      clearTimeout(cleanup);
      if (animFrameRef.current) {
        cancelAnimationFrame(animFrameRef.current);
      }
    };
  }, [prefersReducedMotion, runAnimation, onComplete]);

  return (
    <>
      {/* Column flash overlay */}
      <div
        ref={flashRef}
        className="absolute inset-0 rounded-2xl pointer-events-none"
        style={{
          background: '#fff',
          opacity: 0,
          zIndex: 98,
          transition: 'opacity 300ms ease-out',
        }}
      />

      {/* Canvas for particles */}
      {!prefersReducedMotion && (
        <canvas
          ref={canvasRef}
          className="absolute inset-0 pointer-events-none"
          style={{ zIndex: 100 }}
        />
      )}

      {/* Celebration banner */}
      <div
        ref={bannerRef}
        className="absolute top-2 left-2 right-2 pointer-events-none flex flex-col items-center gap-1 py-3 px-4 rounded-xl text-white text-center"
        style={{
          background: personColor,
          zIndex: 101,
          opacity: 0,
          transform: 'translateY(-20px)',
          transition: 'opacity 400ms ease-out, transform 400ms ease-out',
        }}
      >
        <span className="font-bold text-base leading-tight">
          כל הכבוד {personName}! 🎉
        </span>
        <span className="text-sm opacity-90">
          השלמת את כל המטלות!
        </span>
      </div>
    </>
  );
}
