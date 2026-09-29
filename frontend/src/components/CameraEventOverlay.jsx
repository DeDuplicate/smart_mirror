import { useCallback, useEffect, useRef, useState } from 'react';
import useStore, { TAB_INDEX, isCameraEnabled } from '../store/index.js';
import t from '../i18n/he.json';
import CameraTile from './CameraTile.jsx';
import { SCREENSAVER_INTERACTIVE_ATTR } from '../hooks/useIdleDetection.js';

const ALL_TYPES = ['motion', 'object', 'face'];
const DISMISS_MS = 20000;
const MAX_CARDS = 3;

// ─── Shared event helpers (also used by the Cameras tab and the screensaver) ──

export const objectLabel = (label) => t.cameras.labels[label] || label || '';

export function cameraEventTitle(ev) {
  const name = ev.cameraName || '';
  if (ev.type === 'face' && ev.subLabel) {
    return t.cameras.faceIn.replace('{subLabel}', ev.subLabel).replace('{name}', name);
  }
  if ((ev.type === 'object' || ev.type === 'face') && ev.label) {
    return t.cameras.objectIn.replace('{label}', objectLabel(ev.label)).replace('{name}', name);
  }
  return t.cameras.motionIn.replace('{name}', name);
}

export function formatEventTime(ts) {
  const d = new Date(ts);
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleTimeString('he-IL', { hour: '2-digit', minute: '2-digit' });
}

/** Popup settings gate — the screensaver spotlight honours the same switches. */
export function shouldPopCameraEvent(ev, settings) {
  if (!ev || settings.cameraEventPopup === false) return false;
  const types = Array.isArray(settings.cameraEventTypes) ? settings.cameraEventTypes : ALL_TYPES;
  return types.includes(ev.type);
}

/** Cameras tab, fullscreen on this camera. False if it isn't an enabled camera. */
export function openCameraFullscreen(cameraId) {
  const s = useStore.getState();
  if (!s.cameras.some((c) => isCameraEnabled(c) && c.id === cameraId)) return false;
  s.setCameraFocus(cameraId);
  s.setActiveTab(TAB_INDEX.cameras);
  return true;
}

export const EVENT_TINT = {
  motion: { bg: 'var(--gold-bg)', fg: 'var(--gold-d)' },
  object: { bg: 'var(--coral-bg)', fg: 'var(--coral-d)' },
  face: { bg: 'var(--lav-bg)', fg: 'var(--lav-d)' },
};

export function CameraEventIcon({ type, className = 'w-6 h-6' }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
      strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden="true">
      {type === 'face' ? (
        <>
          <path d="M3 7V5a2 2 0 0 1 2-2h2" />
          <path d="M17 3h2a2 2 0 0 1 2 2v2" />
          <path d="M21 17v2a2 2 0 0 1-2 2h-2" />
          <path d="M7 21H5a2 2 0 0 1-2-2v-2" />
          <path d="M8 14s1.5 2 4 2 4-2 4-2" />
          <path d="M9 9h.01" />
          <path d="M15 9h.01" />
        </>
      ) : type === 'object' ? (
        <>
          <path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7Z" />
          <circle cx="12" cy="12" r="3" />
        </>
      ) : (
        <path d="M22 12h-4l-3 9L9 3l-3 9H2" />
      )}
    </svg>
  );
}

export function EventIconBadge({ type, size = 48 }) {
  const tint = EVENT_TINT[type] || EVENT_TINT.motion;
  return (
    <span
      className="rounded-full flex items-center justify-center shrink-0"
      style={{ width: size, height: size, backgroundColor: tint.bg, color: tint.fg }}
    >
      <CameraEventIcon type={type} className={size >= 48 ? 'w-6 h-6' : 'w-5 h-5'} />
    </span>
  );
}

function CloseIcon({ className = 'w-6 h-6' }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2"
      strokeLinecap="round" className={className} aria-hidden="true">
      <line x1="18" y1="6" x2="6" y2="18" />
      <line x1="6" y1="6" x2="18" y2="18" />
    </svg>
  );
}

/** Countdown hairline — one composited transform animation, no re-renders. */
function DismissBar() {
  const ref = useRef(null);
  useEffect(() => {
    const anim = ref.current?.animate?.(
      [{ transform: 'scaleX(1)' }, { transform: 'scaleX(0)' }],
      { duration: DISMISS_MS, easing: 'linear', fill: 'forwards' }
    );
    return () => anim?.cancel();
  }, []);
  return <div ref={ref} className="absolute bottom-0 inset-x-0 h-1 bg-acc/60 origin-right" />;
}

// Touching the close button must neither wake the screensaver nor count as
// activity; touching the card itself does wake it (and opens the camera).
const interactive = { [SCREENSAVER_INTERACTIVE_ATTR]: '' };

// ─── Overlay ─────────────────────────────────────────────────────────────────

/**
 * Global camera-event popup. Newest event gets a card with its snapshot, then
 * a live snapshot loop of that camera; up to two older ones queue beneath as
 * compact rows with a still thumbnail (one live tile at a time on the Pi).
 * z-[45]: above the screensaver (z-30), below toasts and the alarm/reminder
 * overlays (z-50/z-60), and non-modal, so it never blocks an alarm.
 */
export default function CameraEventOverlay() {
  const lastEvent = useStore((s) => s.lastCameraEvent);
  const snapSec = useStore((s) => s.settings.cameraSnapshotSec) || 3;
  const [cards, setCards] = useState([]); // newest first
  const timers = useRef(new Map());

  const dismiss = useCallback((id) => {
    clearTimeout(timers.current.get(id));
    timers.current.delete(id);
    setCards((list) => list.filter((e) => e.id !== id));
  }, []);

  useEffect(() => {
    if (!lastEvent) return;
    const s = useStore.getState();
    if (!shouldPopCameraEvent(lastEvent, s.settings)) return;
    // The cameras screensaver spotlights the camera itself instead.
    if (s.screensaverActive && s.settings.screensaverStyle === 'cameras' && s.cameras.some(isCameraEnabled)) return;

    // Same id again = Frigate upgraded an object to a recognised face:
    // replace the card and restart its clock.
    clearTimeout(timers.current.get(lastEvent.id));
    timers.current.set(lastEvent.id, setTimeout(() => dismiss(lastEvent.id), DISMISS_MS));
    setCards((list) => [lastEvent, ...list.filter((e) => e.id !== lastEvent.id)].slice(0, MAX_CARDS));
  }, [lastEvent, dismiss]);

  useEffect(() => () => timers.current.forEach(clearTimeout), []);

  if (!cards.length) return null;

  const open = (ev) => {
    openCameraFullscreen(ev.cameraId);
    dismiss(ev.id);
  };

  const [lead, ...rest] = cards;

  return (
    <div
      dir="rtl"
      className="fixed z-[45] top-[88px] end-6 w-[560px] flex flex-col gap-3 pointer-events-none
                 pt:top-auto pt:bottom-10 pt:inset-x-10 pt:w-auto pt:gap-4"
    >
      <div
        key={`${lead.id}-${lead.ts}`}
        role="alert"
        className="pointer-events-auto relative animate-popup-in origin-top overflow-hidden
                   rounded-[28px] bg-surf border border-bd shadow-modal pt:rounded-[36px]"
      >
        <button
          type="button"
          onClick={() => open(lead)}
          className="block w-full text-start active:scale-[0.99] transition-transform duration-[var(--dur-fast)]"
        >
          <CameraTile
            key={lead.cameraId}
            cameraId={lead.cameraId}
            initialSrc={lead.snapshotUrl}
            intervalSec={snapSec}
            className="w-full aspect-video"
          />
          <div className="flex items-center gap-4 px-5 py-4 pt:px-7 pt:py-6">
            <EventIconBadge type={lead.type} />
            <div className="flex-1 min-w-0">
              <p className="text-xl pt:text-2xl font-bold text-tp truncate">{cameraEventTitle(lead)}</p>
              <p className="text-sm pt:text-base text-ts mt-0.5">
                <span dir="ltr">{formatEventTime(lead.ts)}</span>
                <span className="text-tm"> · </span>
                {t.cameras.tapToView}
              </p>
            </div>
          </div>
        </button>

        <button
          type="button"
          {...interactive}
          onClick={() => dismiss(lead.id)}
          aria-label={t.cameras.close}
          className="absolute top-3 end-3 w-14 h-14 rounded-full flex items-center justify-center
                     bg-black/45 text-white active:scale-90 transition-transform duration-[var(--dur-fast)]"
        >
          <CloseIcon />
        </button>
        <DismissBar />
      </div>

      {rest.map((ev) => (
        <div
          key={`${ev.id}-${ev.ts}`}
          className="pointer-events-auto relative flex items-center animate-fade-in
                     rounded-2xl bg-surf border border-bd shadow-popover"
        >
          <button
            type="button"
            onClick={() => open(ev)}
            className="flex-1 min-w-0 flex items-center gap-3 p-2 ps-2 pe-3 min-h-[72px] text-start
                       active:scale-[0.99] transition-transform duration-[var(--dur-fast)]"
          >
            {ev.snapshotUrl ? (
              <img src={ev.snapshotUrl} alt="" draggable={false}
                className="w-24 aspect-video rounded-xl object-cover bg-[#0b0b12] shrink-0" />
            ) : (
              <EventIconBadge type={ev.type} size={40} />
            )}
            <div className="min-w-0">
              <p className="text-base font-semibold text-tp truncate">{cameraEventTitle(ev)}</p>
              <p className="text-xs text-ts"><span dir="ltr">{formatEventTime(ev.ts)}</span></p>
            </div>
          </button>
          <button
            type="button"
            {...interactive}
            onClick={() => dismiss(ev.id)}
            aria-label={t.cameras.close}
            className="w-14 h-14 me-1 rounded-full flex items-center justify-center shrink-0 text-ts
                       hover:bg-s2 active:scale-90 transition-transform duration-[var(--dur-fast)]"
          >
            <CloseIcon className="w-5 h-5" />
          </button>
        </div>
      ))}
    </div>
  );
}
