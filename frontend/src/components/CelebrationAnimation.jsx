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
    const particleCount = Math.floor(randomRange(150, 200));
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
        life: randomRange(2000, 4000),
        born: 0,
        type: isEmoji ? 'emoji' : 'confetti',
        char: isEmoji ? PARTICLE_CHARS[Math.floor(Math.random() * PARTICLE_CHARS.length)] : null,
        color: isEmoji ? null : CONFETTI_COLORS[Math.floor(Math.random() * CONFETTI_COLORS.length)],
        size: isEmoji ? randomRange(20, 36) : randomRange(6, 14),
        rotation: randomRange(0, Math.PI * 2),
        rotSpeed: randomRange(-5, 5),
      });
    }

    // ── Continuous firework rockets (spawn in waves) ─────────────────
    const rockets = [];
    let nextRocketTime = 200;
    function spawnRocket() {
      const startX = randomRange(rect.width * 0.05, rect.width * 0.95);
      const targetY = randomRange(rect.height * 0.08, rect.height * 0.45);
      rockets.push({
        x: startX,
        y: rect.height,
        targetY,
        startY: rect.height,
        speed: randomRange(300, 600),
        launched: true,
        launchTime: 0,
        exploded: false,
        explodeTime: 0,
        burstParticles: [],
        color: CONFETTI_COLORS[Math.floor(Math.random() * CONFETTI_COLORS.length)],
        burstColor2: CONFETTI_COLORS[Math.floor(Math.random() * CONFETTI_COLORS.length)],
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
      }, 7000);
    }

    // ── Play sound ─────────────────────────────────────────────────────
    playSound();

    // ── Animation loop ─────────────────────────────────────────────────
    startTimeRef.current = performance.now();

    function animate(now) {
      const elapsed = now - startTimeRef.current;
      if (elapsed > 8000) {
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        canvas.style.opacity = '0';
        if (onComplete) onComplete();
        return;
      }

      ctx.clearRect(0, 0, canvas.width, canvas.height);

      // Fade out everything in the last 1.5 seconds
      if (elapsed > 6500) {
        const fadeAlpha = 1 - (elapsed - 6500) / 1500;
        ctx.globalAlpha = Math.max(0, fadeAlpha);
      }

      // Draw particles (0-5000ms)
      if (elapsed < 5000) {
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

      // Spawn new rockets continuously (every 300-500ms for 6 seconds)
      if (elapsed > nextRocketTime && elapsed < 6500) {
        spawnRocket();
        // Spawn 1-3 rockets at a time for cluster effect
        if (Math.random() > 0.5) spawnRocket();
        if (Math.random() > 0.7) spawnRocket();
        nextRocketTime = elapsed + randomRange(250, 500);
        // Set launch time for new rockets
        for (const r of rockets) {
          if (r.launchTime === 0) r.launchTime = elapsed;
        }
      }

      // Draw all rockets
      for (const r of rockets) {
        if (r.launchTime === 0) continue;
        const rocketAge = elapsed - r.launchTime;

        if (!r.exploded) {
          // Rising
          const progress = Math.min(rocketAge / 500, 1);
          r.y = r.startY - (r.startY - r.targetY) * progress;

          // Draw rocket trail (glowing)
          ctx.globalAlpha = 0.9;
          ctx.strokeStyle = r.color;
          ctx.lineWidth = 3;
          ctx.shadowColor = r.color;
          ctx.shadowBlur = 8;
          ctx.beginPath();
          ctx.moveTo(r.x, r.y);
          ctx.lineTo(r.x, r.y + 30);
          ctx.stroke();
          ctx.shadowBlur = 0;

          // Rocket head (bright white)
          ctx.fillStyle = '#fff';
          ctx.beginPath();
          ctx.arc(r.x, r.y, 4, 0, Math.PI * 2);
          ctx.fill();

          if (progress >= 1) {
            r.exploded = true;
            r.explodeTime = elapsed;
            // Multi-color burst with ring + sparkle pattern
            const burstCount = Math.floor(randomRange(25, 45));
            const colors = [r.color, r.burstColor2, '#FFD700', '#fff'];
            for (let i = 0; i < burstCount; i++) {
              const angle = (i / burstCount) * Math.PI * 2 + randomRange(-0.2, 0.2);
              const vel = randomRange(80, 250);
              r.burstParticles.push({
                x: r.x,
                y: r.y,
                vx: Math.cos(angle) * vel,
                vy: Math.sin(angle) * vel,
                life: randomRange(800, 1500),
                born: elapsed,
                color: colors[Math.floor(Math.random() * colors.length)],
                size: randomRange(3, 9),
                isSparkle: Math.random() > 0.6,
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
            const by = bp.y + bp.vy * bt + 0.5 * 60 * bt * bt;
            const alpha = Math.max(0, 1 - bAge / bp.life);
            ctx.globalAlpha = alpha;

            if (bp.isSparkle) {
              // Sparkle: draw a small star/cross
              ctx.strokeStyle = bp.color;
              ctx.lineWidth = 1.5;
              ctx.beginPath();
              ctx.moveTo(bx - bp.size, by);
              ctx.lineTo(bx + bp.size, by);
              ctx.moveTo(bx, by - bp.size);
              ctx.lineTo(bx, by + bp.size);
              ctx.stroke();
            } else {
              // Circle
              ctx.fillStyle = bp.color;
              ctx.shadowColor = bp.color;
              ctx.shadowBlur = 4;
              ctx.beginPath();
              ctx.arc(bx, by, bp.size, 0, Math.PI * 2);
              ctx.fill();
              ctx.shadowBlur = 0;
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
      }, 8000);
      return () => clearTimeout(timeout);
    }

    runAnimation();

    // Safety cleanup — must match the animation total duration (8s) + buffer
    const cleanup = setTimeout(() => {
      if (animFrameRef.current) {
        cancelAnimationFrame(animFrameRef.current);
      }
      // Force clear canvas
      const canvas = canvasRef.current;
      if (canvas) {
        const ctx = canvas.getContext('2d');
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        canvas.style.opacity = '0';
      }
      if (onComplete) onComplete();
    }, 8500);

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
