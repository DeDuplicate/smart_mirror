/**
 * WeatherIcon — animated SVG/CSS weather visualization based on WMO code.
 *
 * Props:
 *   code     – WMO weather code (number)
 *   size     – icon size in px (default 48)
 *   animate  – enable animations (default true)
 */

// ─── Condition resolver ────────────────────────────────────────────────────

function getCondition(code) {
  if (code === 0) return 'clear';
  if (code >= 1 && code <= 3) return 'partly-cloudy';
  if (code >= 45 && code <= 48) return 'fog';
  if (code >= 51 && code <= 55) return 'drizzle';
  if (code >= 56 && code <= 67) return 'rain';
  if (code >= 71 && code <= 77) return 'snow';
  if (code >= 80 && code <= 82) return 'showers';
  if (code >= 95 && code <= 99) return 'thunderstorm';
  return 'partly-cloudy';
}

// ─── SVG sub-elements ──────────────────────────────────────────────────────

function Sun({ cx, cy, r, raysR, animate }) {
  return (
    <g>
      {/* Rays — rotating group */}
      <g
        style={
          animate
            ? {
                transformOrigin: `${cx}px ${cy}px`,
                animation: 'weatherSunRotate 20s linear infinite',
                willChange: 'transform',
              }
            : undefined
        }
      >
        {[0, 45, 90, 135, 180, 225, 270, 315].map((angle) => (
          <line
            key={angle}
            x1={cx}
            y1={cy - raysR + 2}
            x2={cx}
            y2={cy - raysR - 3}
            stroke="#FBBF24"
            strokeWidth="2"
            strokeLinecap="round"
            transform={`rotate(${angle} ${cx} ${cy})`}
          />
        ))}
      </g>
      {/* Core */}
      <circle cx={cx} cy={cy} r={r} fill="#FBBF24" />
    </g>
  );
}

function Cloud({ x, y, scale, fill, animate, delay }) {
  const style = animate
    ? {
        animation: `weatherCloudDrift 8s ease-in-out ${delay || '0s'} infinite alternate`,
        willChange: 'transform',
      }
    : undefined;

  return (
    <g transform={`translate(${x}, ${y}) scale(${scale})`} style={style}>
      <path
        d="M8 22 C4 22 0 19 0 15 C0 11 3 8 7 8 C8 4 12 1 17 1 C22 1 26 5 26 10 C30 10 33 13 33 17 C33 21 30 22 28 22 Z"
        fill={fill || '#CBD5E1'}
      />
    </g>
  );
}

function RainDrops({ x, y, count, heavy, animate }) {
  const drops = [];
  for (let i = 0; i < count; i++) {
    const dx = x + i * 5;
    const delayVal = (i * 0.15).toFixed(2);
    drops.push(
      <line
        key={i}
        x1={dx}
        y1={y}
        x2={dx - 1}
        y2={y + (heavy ? 6 : 4)}
        stroke="#60A5FA"
        strokeWidth={heavy ? 1.8 : 1.2}
        strokeLinecap="round"
        style={
          animate
            ? {
                animation: `weatherRainFall 0.6s linear ${delayVal}s infinite`,
                willChange: 'transform',
              }
            : undefined
        }
      />
    );
  }
  return <g>{drops}</g>;
}

function SnowFlakes({ x, y, count, animate }) {
  const flakes = [];
  for (let i = 0; i < count; i++) {
    const dx = x + i * 6;
    const delayVal = (i * 0.4).toFixed(2);
    flakes.push(
      <circle
        key={i}
        cx={dx}
        cy={y}
        r={1.5}
        fill="#E2E8F0"
        style={
          animate
            ? {
                animation: `weatherSnowFall 2s ease-in-out ${delayVal}s infinite`,
                willChange: 'transform',
              }
            : undefined
        }
      />
    );
  }
  return <g>{flakes}</g>;
}

function Lightning({ x, y, animate }) {
  return (
    <polygon
      points={`${x},${y} ${x - 3},${y + 8} ${x + 1},${y + 7} ${x - 2},${y + 14} ${x + 5},${y + 5} ${x + 1},${y + 6} ${x + 4},${y}`}
      fill="#FDE047"
      style={
        animate
          ? {
              animation: 'weatherLightning 3s linear infinite',
              willChange: 'opacity',
            }
          : { opacity: 0.8 }
      }
    />
  );
}

// ─── Scene compositions ────────────────────────────────────────────────────

function ClearScene({ animate }) {
  return (
    <svg viewBox="0 0 48 48" fill="none" xmlns="http://www.w3.org/2000/svg">
      <Sun cx={24} cy={24} r={9} raysR={17} animate={animate} />
    </svg>
  );
}

function PartlyCloudyScene({ animate }) {
  return (
    <svg viewBox="0 0 48 48" fill="none" xmlns="http://www.w3.org/2000/svg">
      <Sun cx={18} cy={16} r={7} raysR={13} animate={animate} />
      <Cloud x={10} y={16} scale={0.85} animate={animate} delay="0s" />
    </svg>
  );
}

function FogScene({ animate }) {
  const layers = [
    { y: 14, opacity: 0.35, delay: '0s' },
    { y: 22, opacity: 0.5, delay: '1s' },
    { y: 30, opacity: 0.3, delay: '2s' },
  ];
  return (
    <svg viewBox="0 0 48 48" fill="none" xmlns="http://www.w3.org/2000/svg">
      {layers.map((l, i) => (
        <rect
          key={i}
          x={4}
          y={l.y}
          width={40}
          height={4}
          rx={2}
          fill="#94A3B8"
          opacity={l.opacity}
          style={
            animate
              ? {
                  animation: `weatherCloudDrift 8s ease-in-out ${l.delay} infinite alternate`,
                  willChange: 'transform',
                }
              : undefined
          }
        />
      ))}
    </svg>
  );
}

function DrizzleScene({ animate }) {
  return (
    <svg viewBox="0 0 48 48" fill="none" xmlns="http://www.w3.org/2000/svg">
      <Cloud x={7} y={6} scale={0.95} animate={animate} delay="0s" />
      <RainDrops x={14} y={30} count={4} heavy={false} animate={animate} />
    </svg>
  );
}

function RainScene({ animate }) {
  return (
    <svg viewBox="0 0 48 48" fill="none" xmlns="http://www.w3.org/2000/svg">
      <Cloud x={7} y={4} scale={1} fill="#94A3B8" animate={animate} delay="0s" />
      <RainDrops x={12} y={28} count={5} heavy animate={animate} />
    </svg>
  );
}

function SnowScene({ animate }) {
  return (
    <svg viewBox="0 0 48 48" fill="none" xmlns="http://www.w3.org/2000/svg">
      <Cloud x={7} y={4} scale={1} animate={animate} delay="0s" />
      <SnowFlakes x={12} y={30} count={5} animate={animate} />
    </svg>
  );
}

function ShowersScene({ animate }) {
  return (
    <svg viewBox="0 0 48 48" fill="none" xmlns="http://www.w3.org/2000/svg">
      {/* Peeking sun behind cloud */}
      <Sun cx={36} cy={12} r={5} raysR={9} animate={animate} />
      <Cloud x={4} y={8} scale={0.9} animate={animate} delay="0s" />
      <RainDrops x={12} y={30} count={4} heavy={false} animate={animate} />
    </svg>
  );
}

function ThunderstormScene({ animate }) {
  return (
    <svg viewBox="0 0 48 48" fill="none" xmlns="http://www.w3.org/2000/svg">
      <Cloud x={7} y={4} scale={1} fill="#64748B" animate={animate} delay="0s" />
      <RainDrops x={12} y={28} count={4} heavy animate={animate} />
      <Lightning x={24} y={26} animate={animate} />
    </svg>
  );
}

// ─── Main component ────────────────────────────────────────────────────────

const SCENES = {
  clear: ClearScene,
  'partly-cloudy': PartlyCloudyScene,
  fog: FogScene,
  drizzle: DrizzleScene,
  rain: RainScene,
  snow: SnowScene,
  showers: ShowersScene,
  thunderstorm: ThunderstormScene,
};

export default function WeatherIcon({ code, size = 48, animate = true }) {
  const condition = getCondition(code);
  const Scene = SCENES[condition] || PartlyCloudyScene;

  return (
    <span
      className="inline-flex items-center justify-center shrink-0"
      style={{ width: size, height: size }}
      role="img"
      aria-label={condition}
    >
      <Scene animate={animate} />
    </span>
  );
}
