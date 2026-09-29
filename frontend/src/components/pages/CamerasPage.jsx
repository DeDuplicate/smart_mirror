import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import useStore, { TAB_INDEX, isCameraEnabled } from '../../store/index.js';
import t from '../../i18n/he.json';
import { fetchApi } from '../../hooks/useApi.js';
import { SkeletonBlock } from '../Skeleton.jsx';
import CameraTile, { CctvIcon, LiveVideo, cameraGridVars, cameraGridStyle } from '../CameraTile.jsx';
import { CameraEventIcon, EVENT_TINT, objectLabel } from '../CameraEventOverlay.jsx';

const GAP = 16;
const RECENT_MS = 2 * 60 * 1000; // "motion/face recently" badge window
// A stream that never starts (codec the Pi can't decode, NVR refusing a
// second viewer) gives no error event — fall back after this long.

const STATUS = {
  live: { label: t.cameras.live, dot: 'var(--acc2)' },
  stale: { label: t.cameras.stale, dot: 'var(--amber)' },
  offline: { label: t.cameras.offline, dot: 'var(--coral-d)' },
};

const TEXT_SHADOW = '0 1px 2px rgba(0,0,0,0.8), 0 0 12px rgba(0,0,0,0.5)';

function useNow(ms) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), ms);
    return () => clearInterval(id);
  }, [ms]);
  return now;
}

function StatusChip({ status }) {
  const s = STATUS[status];
  if (!s) return null;
  return (
    <span className="inline-flex items-center gap-1.5 px-3 h-8 rounded-full bg-black/50 text-white text-sm font-semibold">
      <span className="w-2 h-2 rounded-full" style={{ backgroundColor: s.dot }} />
      {s.label}
    </span>
  );
}

function EventBadge({ event, now }) {
  const tint = EVENT_TINT[event.type] || EVENT_TINT.motion;
  const what = event.type === 'face' && event.subLabel
    ? event.subLabel
    : event.type !== 'motion' && event.label ? objectLabel(event.label) : t.cameras.badgeMotion;
  const min = Math.floor((now - event.ts) / 60000);
  const ago = min < 1 ? t.cameras.justNow : t.cameras.minutesAgo.replace('{n}', String(min));
  return (
    <span
      className="inline-flex items-center gap-1.5 ps-2 pe-3 h-8 rounded-full text-sm font-semibold"
      style={{ backgroundColor: tint.bg, color: tint.fg }}
    >
      <CameraEventIcon type={event.type} className="w-4 h-4" />
      {what}
      <span className="font-normal opacity-80">· {ago}</span>
    </span>
  );
}

function ChevronIcon({ dir, className = 'w-8 h-8' }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2"
      strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden="true">
      <polyline points={dir === 'left' ? '15 18 9 12 15 6' : '9 18 15 12 9 6'} />
    </svg>
  );
}

// ─── Grid tile ───────────────────────────────────────────────────────────────

function GridTile({ camera, event, now, snapSec, paused, onOpen }) {
  return (
    <button
      type="button"
      onClick={onOpen}
      aria-label={camera.name}
      className="relative aspect-video rounded-[28px] overflow-hidden text-start shadow-card
                 active:scale-[0.985] transition-transform duration-[var(--dur-fast)]
                 focus-visible:outline focus-visible:outline-2 focus-visible:outline-acc"
    >
      <CameraTile cameraId={camera.id} intervalSec={snapSec} paused={paused} className="absolute inset-0">
        {(status) => (
          <>
            <div className="absolute top-3 start-3 flex items-center gap-2">
              <StatusChip status={status} />
            </div>
            {event && (
              <div className="absolute top-3 end-3">
                <EventBadge event={event} now={now} />
              </div>
            )}
            <div className="absolute inset-x-0 bottom-0 px-5 pb-4 pt-12 bg-gradient-to-t from-black/55 to-transparent">
              <span className="block text-white text-xl pt:text-2xl font-semibold truncate" style={{ textShadow: TEXT_SHADOW }}>
                {camera.name}
              </span>
            </div>
          </>
        )}
      </CameraTile>
    </button>
  );
}

// ─── Fullscreen viewer ───────────────────────────────────────────────────────

function CameraViewer({ camera, count, liveVideo, onPrev, onNext, onClose }) {
  const [videoFailed, setVideoFailed] = useState(false);
  const useVideo = liveVideo && !videoFailed;

  // Portaled to #root: <main> carries a transform during the tab slide-in,
  // which would otherwise pin this fixed layer inside the page area.
  return createPortal(
    <div
      data-no-swipe
      dir="rtl"
      className="fixed inset-0 z-[25] bg-black animate-fade-in select-none"
      role="dialog"
      aria-modal="true"
      aria-label={camera.name}
    >
      {useVideo ? (
        <LiveVideo cameraId={camera.id} onFail={() => setVideoFailed(true)} />
      ) : (
        <CameraTile cameraId={camera.id} intervalSec={1} quality="main" fit="contain" className="absolute inset-0 !bg-black">
          {(status) => (
            <div className="absolute bottom-8 start-8 pt:bottom-12">
              <StatusChip status={status} />
            </div>
          )}
        </CameraTile>
      )}

      {/* Header: close + name (start), playback mode (end) */}
      <div className="absolute top-0 inset-x-0 flex items-center gap-4 px-6 pt-6 pt:px-8 pt:pt-10">
        <button
          type="button"
          onClick={onClose}
          aria-label={t.cameras.close}
          className="w-16 h-16 rounded-full bg-white/15 text-white flex items-center justify-center shrink-0
                     active:scale-90 transition-transform duration-[var(--dur-fast)]"
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2"
            strokeLinecap="round" className="w-7 h-7" aria-hidden="true">
            <line x1="18" y1="6" x2="6" y2="18" />
            <line x1="6" y1="6" x2="18" y2="18" />
          </svg>
        </button>
        <h2 className="flex-1 min-w-0 text-white text-3xl font-bold truncate" style={{ textShadow: TEXT_SHADOW }}>
          {camera.name}
        </h2>
        <span className="shrink-0 px-4 h-10 inline-flex items-center rounded-full bg-black/50 text-white/85 text-base font-medium">
          {useVideo ? t.cameras.liveVideo : t.cameras.snapshotMode}
        </span>
      </div>

      {videoFailed && (
        <div className="absolute top-28 inset-x-0 flex justify-center px-8 pointer-events-none pt:top-36">
          <span className="max-w-[900px] px-5 py-3 rounded-2xl bg-black/65 text-white/90 text-base text-center">
            {t.cameras.videoFallback}
          </span>
        </div>
      )}

      {count > 1 && (
        <>
          {/* RTL: previous sits on the right (start), next on the left (end). */}
          <button
            type="button"
            onClick={onPrev}
            aria-label={t.cameras.prev}
            className="absolute top-1/2 -translate-y-1/2 start-6 w-[72px] h-[72px] rounded-full bg-white/15 text-white
                       flex items-center justify-center active:scale-90 transition-transform duration-[var(--dur-fast)]"
          >
            <ChevronIcon dir="right" />
          </button>
          <button
            type="button"
            onClick={onNext}
            aria-label={t.cameras.next}
            className="absolute top-1/2 -translate-y-1/2 end-6 w-[72px] h-[72px] rounded-full bg-white/15 text-white
                       flex items-center justify-center active:scale-90 transition-transform duration-[var(--dur-fast)]"
          >
            <ChevronIcon dir="left" />
          </button>
        </>
      )}
    </div>,
    document.getElementById('root') || document.body
  );
}

// ─── States ──────────────────────────────────────────────────────────────────

function CamerasSkeleton() {
  return (
    <div className="flex flex-col h-full p-6 gap-5 pt:p-8">
      <SkeletonBlock width="220px" height="32px" />
      <div className="flex-1 min-h-0 [container-type:size]">
        <div className={`grid h-full place-content-center ${cameraGridVars(4)}`} style={cameraGridStyle(4, GAP)}>
          {Array.from({ length: 4 }).map((_, i) => (
            <SkeletonBlock key={i} height="auto" borderRadius="28px" className="aspect-video" />
          ))}
        </div>
      </div>
    </div>
  );
}

function CamerasEmpty() {
  const setActiveTab = useStore((s) => s.setActiveTab);
  return (
    <div className="flex flex-col items-center justify-center h-full gap-5 px-10 text-center">
      <div className="w-28 h-28 rounded-[32px] bg-lav text-acc flex items-center justify-center mb-2">
        <CctvIcon className="w-14 h-14" />
      </div>
      <p className="text-2xl pt:text-3xl font-bold text-tp">{t.cameras.emptyTitle}</p>
      <p className="text-lg text-ts max-w-[560px]">{t.cameras.emptyHint}</p>
      <button
        type="button"
        onClick={() => setActiveTab(TAB_INDEX.settings)}
        className="ripple mt-2 px-8 min-h-[60px] rounded-2xl bg-acc text-white text-lg font-semibold
                   hover:bg-acc/90 active:scale-95 transition-transform duration-[var(--dur-fast)]"
      >
        {t.cameras.goToSettings}
      </button>
    </div>
  );
}

// ─── Page ────────────────────────────────────────────────────────────────────

export default function CamerasPage() {
  const allCameras = useStore((s) => s.cameras);
  const loaded = useStore((s) => s.camerasLoaded);
  const engine = useStore((s) => s.camerasEngine);
  const events = useStore((s) => s.cameraEvents);
  const focus = useStore((s) => s.cameraFocus);
  const screensaverActive = useStore((s) => s.screensaverActive);
  const snapSec = useStore((s) => s.settings.cameraSnapshotSec) || 3;
  const liveVideo = useStore((s) => s.settings.cameraLiveVideo) === true;
  const [viewerId, setViewerId] = useState(null);
  const now = useNow(20000);

  const cameras = useMemo(() => allCameras.filter(isCameraEnabled), [allCameras]);
  const viewerIndex = cameras.findIndex((c) => c.id === viewerId);

  // History for the badges; live events keep arriving via the store.
  useEffect(() => {
    fetchApi('/api/cameras/events/recent')
      .then((d) => useStore.getState().mergeCameraEvents(Array.isArray(d) ? d : d?.events || []))
      .catch(() => {});
  }, []);

  // Opened from an event popup / the screensaver spotlight.
  useEffect(() => {
    if (focus && cameras.some((c) => c.id === focus)) {
      setViewerId(focus);
      useStore.getState().setCameraFocus(null);
    }
  }, [focus, cameras]);

  // The screensaver coming up closes the viewer so a live stream doesn't run
  // unseen. Only on the rising edge: a tap on the screensaver opens the
  // viewer while it is still fading out.
  const ssWas = useRef(screensaverActive);
  useEffect(() => {
    if (screensaverActive && !ssWas.current) setViewerId(null);
    ssWas.current = screensaverActive;
  }, [screensaverActive]);

  const recentByCam = useMemo(() => {
    const map = {};
    for (const e of events) {
      if (now - e.ts < RECENT_MS && !map[e.cameraId]) map[e.cameraId] = e; // newest first
    }
    return map;
  }, [events, now]);

  if (!loaded) return <CamerasSkeleton />;
  if (cameras.length === 0) return <CamerasEmpty />;

  const n = cameras.length;
  const scroll = n > 6;
  const step = (d) => setViewerId(cameras[(viewerIndex + d + n) % n].id);

  return (
    <div className="flex flex-col h-full p-6 gap-5 pt:p-8 pt:gap-6">
      <div className="flex items-center gap-3 px-1">
        <h2 className="text-lg pt:text-xl font-bold text-tp">{t.cameras.title}</h2>
        <span className="text-sm font-medium text-ts">{t.cameras.count.replace('{n}', String(n))}</span>
        {engine && !engine.running && (
          <span
            className="ms-auto inline-flex items-center gap-2 px-3 h-8 rounded-full text-sm font-medium truncate max-w-[60%]"
            style={{ backgroundColor: 'var(--coral-bg)', color: 'var(--coral-d)' }}
            title={engine.error || ''}
          >
            {t.cameras.engineDown}
            {engine.error ? ` - ${engine.error}` : ''}
          </span>
        )}
      </div>

      <div className={`flex-1 min-h-0 [container-type:size] ${scroll ? 'overflow-y-auto' : ''}`}>
        <div
          className={`grid ${scroll ? '' : 'h-full place-content-center'} ${cameraGridVars(n)}`}
          style={cameraGridStyle(n, GAP)}
        >
          {cameras.map((cam) => (
            <GridTile
              key={cam.id}
              camera={cam}
              event={recentByCam[cam.id]}
              now={now}
              snapSec={snapSec}
              // Nothing polls behind the viewer or the screensaver.
              paused={viewerIndex >= 0 || screensaverActive}
              onOpen={() => setViewerId(cam.id)}
            />
          ))}
        </div>
      </div>

      {viewerIndex >= 0 && (
        <CameraViewer
          key={cameras[viewerIndex].id}
          camera={cameras[viewerIndex]}
          count={n}
          liveVideo={liveVideo}
          onPrev={() => step(-1)}
          onNext={() => step(1)}
          onClose={() => setViewerId(null)}
        />
      )}
    </div>
  );
}
