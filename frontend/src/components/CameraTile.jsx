import { useState, useEffect, useRef } from 'react';
import useStore from '../store/index.js';
import t from '../i18n/he.json';

// A request that neither loads nor errors (camera half-up, go2rtc still
// waiting on RTSP) must not freeze the loop — count it as a failure.
const FRAME_TIMEOUT_MS = 15000;
const MAX_BACKOFF_MS = 30000;
// A stream that hasn't started by then (H.265, camera down) falls back to snapshots.
const VIDEO_START_TIMEOUT_MS = 12000;

export const snapshotUrl = (cameraId, quality = 'sub') =>
  `/api/cameras/${encodeURIComponent(cameraId)}/snapshot.jpg?quality=${quality}&t=${Date.now()}`;

function useDocumentHidden() {
  const [hidden, setHidden] = useState(() => document.hidden);
  useEffect(() => {
    const onChange = () => setHidden(document.hidden);
    document.addEventListener('visibilitychange', onChange);
    return () => document.removeEventListener('visibilitychange', onChange);
  }, []);
  return hidden;
}

export function LiveVideo({ cameraId, onFail, onPlaying, quality = 'main', fit = 'contain' }) {
  const ref = useRef(null);
  useEffect(() => {
    const video = ref.current;
    const timer = setTimeout(onFail, VIDEO_START_TIMEOUT_MS);
    const started = () => { clearTimeout(timer); onPlaying?.(); };
    video?.addEventListener('playing', started);
    return () => {
      clearTimeout(timer);
      video?.removeEventListener('playing', started);
      // Detach the source so the browser actually drops the stream connection.
      if (video) {
        video.removeAttribute('src');
        video.load();
      }
    };
    // onFail/onPlaying are stable for the life of this stream.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return (
    <video
      ref={ref}
      src={`/api/cameras/${encodeURIComponent(cameraId)}/stream.mp4?quality=${quality}`}
      autoPlay
      muted
      playsInline
      onError={onFail}
      className={`absolute inset-0 w-full h-full ${fit === 'contain' ? 'object-contain' : 'object-cover'}`}
    />
  );
}

export function CctvIcon({ className = 'w-6 h-6' }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
      strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden="true">
      <path d="M16.75 12h3.63a1 1 0 0 1 .9 1.45l-2.04 4.07a1 1 0 0 1-1.7.13l-2.13-2.97" />
      <path d="M17.1 9.05a1 1 0 0 1 .45 1.34l-3.1 6.21a1 1 0 0 1-1.35.45L3.6 12.3a2.92 2.92 0 0 1-1.3-3.91L3.7 5.6a2.92 2.92 0 0 1 3.9-1.3z" />
      <path d="M2 19h3.76a2 2 0 0 0 1.8-1.1L9 15" />
      <path d="M2 21v-4" />
      <path d="M7 9h.01" />
    </svg>
  );
}

export function CameraOffIcon({ className = 'w-10 h-10' }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"
      strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden="true">
      <line x1="2" y1="2" x2="22" y2="22" />
      <path d="M7 7H4a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h16" />
      <path d="M9.5 4h5L17 7h3a2 2 0 0 1 2 2v7.5" />
      <path d="M14.12 15.12A3 3 0 1 1 9.88 10.88" />
    </svg>
  );
}

// ─── Grid geometry (shared by the Cameras tab and the screensaver) ──────────
// 16:9 cells, as large as will fit: each column is the smaller of an even
// share of the container's width and the width that an even share of its
// height allows. Needs `container-type: size` on the parent (cq units), so no
// JS measuring and no layout thrash. Portrait reshapes via `pt:` variables.

export function cameraGridVars(n) {
  if (n <= 1) return '[--cols:1] [--rows:1]';
  if (n === 2) return '[--cols:2] [--rows:1] pt:[--cols:1] pt:[--rows:2]';
  if (n <= 4) return '[--cols:2] [--rows:2]';
  if (n <= 6) return '[--cols:3] [--rows:2] pt:[--cols:2] pt:[--rows:3]';
  return '[--cols:3] pt:[--cols:2]'; // scrolls
}

export function cameraGridStyle(n, gap) {
  const share = `calc((100cqw - (var(--cols) - 1) * ${gap}px) / var(--cols))`;
  const col = n > 6
    ? 'minmax(0, 1fr)'
    : `min(${share}, calc((100cqh - (var(--rows) - 1) * ${gap}px) / var(--rows) * 16 / 9))`;
  return { gridTemplateColumns: `repeat(var(--cols), ${col})`, gap };
}

/**
 * Self-refreshing camera snapshot.
 *
 * Two stacked <img> buffers: the next frame loads (and decodes) in the hidden
 * one and is swapped in only then, so the picture never flashes blank. The
 * next request is scheduled only once the previous one settles, so a tile
 * never has more than one fetch in flight — a slow camera slows its own tile
 * down instead of piling requests onto the Pi. Polling stops while `paused`
 * or the document is hidden, and resumes with a fresh frame.
 *
 * Key it by camera id: a different camera is a different tile.
 * `children` may be a function of the status: 'loading' | 'live' | 'stale' | 'offline'.
 */
export default function CameraTile({
  cameraId,
  intervalSec = 3,
  quality = 'sub',
  initialSrc = null,
  paused = false,
  fit = 'cover',
  className = '',
  children,
}) {
  const [srcs, setSrcs] = useState([null, null]);
  const [front, setFront] = useState(0);
  const [status, setStatus] = useState('loading');
  const loop = useRef({ front: 0, inFlight: false, lastOk: 0, fails: 0, timer: 0, active: false }).current;
  const fn = useRef({});
  const hidden = useDocumentHidden();
  // Settings > Cameras > live video: every tile streams instead of polling
  // snapshots (meant for a PC — the Pi 2 can't decode video). A failed stream
  // drops this tile back to snapshots.
  const liveSetting = useStore((s) => s.settings.cameraLiveVideo) === true;
  const [videoFailed, setVideoFailed] = useState(false);
  const live = liveSetting && !videoFailed && !paused && !hidden;
  const active = !paused && !hidden && !live;
  const intervalMs = Math.max(1, Number(intervalSec) || 3) * 1000;
  const staleMs = Math.max(3 * intervalMs, 10000);

  // Refreshed every render so timers always see the current props.
  fn.current.request = (url = snapshotUrl(cameraId, quality)) => {
    clearTimeout(loop.timer);
    loop.inFlight = true;
    const back = 1 - loop.front;
    setSrcs((prev) => (back === 0 ? [url, prev[1]] : [prev[0], url]));
    loop.timer = setTimeout(() => fn.current.settle(back, false), FRAME_TIMEOUT_MS);
  };

  fn.current.settle = (buffer, ok) => {
    // The front buffer's own events, and anything after a timeout, are noise.
    if (buffer === loop.front || !loop.inFlight) return;
    clearTimeout(loop.timer);
    loop.inFlight = false;
    const now = Date.now();
    if (ok) {
      loop.front = buffer;
      loop.lastOk = now;
      loop.fails = 0;
      setFront(buffer);
      setStatus('live');
    } else {
      loop.fails += 1;
      // Dropping the src also aborts a hung request.
      setSrcs((prev) => (buffer === 0 ? [null, prev[1]] : [prev[0], null]));
      if (loop.lastOk) setStatus(now - loop.lastOk > staleMs ? 'stale' : 'live');
      else if (loop.fails >= 2) setStatus('offline');
    }
    if (!loop.active) return;
    // First failure retries fast (covers a missing event snapshot); then back off.
    const delay = ok
      ? intervalMs
      : loop.fails === 1 ? 500 : Math.min(MAX_BACKOFF_MS, intervalMs * 2 ** Math.min(loop.fails, 4));
    loop.timer = setTimeout(() => fn.current.request(), delay);
  };

  useEffect(() => {
    loop.active = active;
    if (!active) {
      // An in-flight request keeps its watchdog; it just won't schedule another.
      if (!loop.inFlight) clearTimeout(loop.timer);
      return;
    }
    if (!loop.inFlight) fn.current.request(!loop.lastOk && initialSrc ? initialSrc : undefined);
    // initialSrc only matters for the very first frame.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active]);

  useEffect(() => () => {
    loop.active = false;
    loop.inFlight = false;
    clearTimeout(loop.timer);
  }, [loop]);

  const onLoad = (i) => (e) => {
    // decode() first so the swap never paints an undecoded (blank) frame.
    const img = e.currentTarget;
    (img.decode ? img.decode() : Promise.resolve())
      .catch(() => {})
      .then(() => fn.current.settle(i, true));
  };

  return (
    // `relative` only as a default: Tailwind emits .relative after .absolute, so
    // hardcoding it beat a caller's `absolute inset-0` and collapsed the tile to 0px.
    <div className={`${/\b(absolute|fixed)\b/.test(className) ? '' : 'relative'} overflow-hidden bg-[#0b0b12] ${className}`}>
      {live && (
        <LiveVideo
          key={cameraId}
          cameraId={cameraId}
          quality={quality}
          fit={fit}
          onPlaying={() => setStatus('live')}
          onFail={() => setVideoFailed(true)}
        />
      )}
      {!live && srcs.map((src, i) =>
        src ? (
          <img
            key={i}
            src={src}
            alt=""
            draggable={false}
            onLoad={onLoad(i)}
            onError={() => fn.current.settle(i, false)}
            className={`absolute inset-0 w-full h-full ${fit === 'contain' ? 'object-contain' : 'object-cover'}`}
            style={{ opacity: i === front ? 1 : 0 }}
          />
        ) : null
      )}

      {status === 'loading' && <div className="skeleton absolute inset-0 opacity-40" style={{ borderRadius: 0 }} />}

      {status === 'offline' && (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 text-white/55">
          <CameraOffIcon className="w-12 h-12" />
          <span className="text-base font-medium">{t.cameras.noImage}</span>
        </div>
      )}

      {typeof children === 'function' ? children(status) : children}
    </div>
  );
}
