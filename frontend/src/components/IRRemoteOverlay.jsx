import { useCallback, useEffect, useState } from 'react';
import { fetchApi } from '../hooks/useApi.js';
import useStore from '../store/index.js';
import t from '../i18n/he.json';

// ─── SVG Icons ──────────────────────────────────────────────────────────────

function CloseIcon({ className = 'w-5 h-5' }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
      strokeLinecap="round" strokeLinejoin="round" className={className}>
      <line x1="18" y1="6" x2="6" y2="18" />
      <line x1="6" y1="6" x2="18" y2="18" />
    </svg>
  );
}

// ─── Remote Button ──────────────────────────────────────────────────────────

// Arrow glyphs (▲◀▶▼) aren't announced meaningfully by screen readers, so
// icon-only remote buttons need an explicit Hebrew aria-label per command.
const COMMAND_LABELS = {
  up: t.home.arrowUp,
  down: t.home.arrowDown,
  left: t.home.arrowLeft,
  right: t.home.arrowRight,
};

/**
 * One key. `onPress(command)` decides what pressing means (see IRRemoteOverlay),
 * so the same key serves a plain IR blaster and a script-driven remote.
 * `broken` dims the key and puts a dot on it: it is still pressable, because
 * the press is what explains why it does nothing.
 */
function RemoteButton({ label, command, onPress, size = 'md', variant = 'default', className = '', ariaLabel, broken = false }) {
  // Every remote key is a primary touch target on the IR frame, so each size
  // keeps a >=56x56px hit area regardless of how small its glyph/label is.
  const sizeClasses = {
    sm: 'min-w-[56px] min-h-[56px] w-14 text-xs pt:w-full pt:min-h-[80px] pt:text-lg',
    md: 'min-w-[56px] min-h-[56px] w-16 text-sm pt:w-24 pt:min-h-[96px] pt:text-xl',
    lg: 'min-w-[56px] min-h-[56px] w-20 text-base pt:min-h-[88px] pt:text-xl',
  };

  const variantClasses = {
    default: 'bg-s2 text-tp hover:bg-bd border border-bd',
    accent: 'bg-acc text-white hover:bg-acc/90',
    // The border matters: coral-bg is a dark wash in the dark theme and the key
    // would otherwise read as loose red text.
    danger: 'bg-coral-bg text-coral-d border border-coral-d/50 hover:opacity-80',
    center: 'bg-acc2 text-white hover:bg-acc2/90 rounded-full w-16 h-16 text-sm font-bold pt:w-28 pt:h-28 pt:text-xl',
  };

  return (
    <button
      onClick={() => onPress(command)}
      aria-label={ariaLabel || COMMAND_LABELS[command] || (typeof label === 'string' ? label : command)}
      className={`relative flex items-center justify-center rounded-xl font-medium
                  transition-all duration-[var(--dur-fast)] active:scale-95 select-none
                  ${sizeClasses[size] || sizeClasses.md}
                  ${variantClasses[variant] || variantClasses.default}
                  ${broken ? 'opacity-50' : ''}
                  ${className}`}
    >
      {label}
      {broken && (
        <span aria-hidden="true" className="absolute top-1.5 end-1.5 w-2 h-2 rounded-full bg-coral-d" />
      )}
    </button>
  );
}

// ─── Arrow Pad ──────────────────────────────────────────────────────────────

function ArrowPad({ press, isBroken }) {
  const key = (command, label, extra = {}) => (
    <RemoteButton label={label} command={command} onPress={press} broken={isBroken(command)} {...extra} />
  );
  return (
    // dir=ltr: the page is RTL, which would put the "left" key on the right of OK.
    // A direction pad is physical, not a line of text.
    <div dir="ltr" className="grid grid-cols-3 grid-rows-3 gap-1.5 pt:gap-4 place-items-center w-fit mx-auto">
      <div />
      {key('up', '▲')}
      <div />

      {key('left', '◀')}
      {key('ok', t.home.ok, { variant: 'center' })}
      {key('right', '▶')}

      <div />
      {key('down', '▼')}
      <div />
    </div>
  );
}

// ─── IR Remote Overlay ──────────────────────────────────────────────────────

/**
 * `scripts` (optional) maps a key to the HA script that performs it - used by
 * the living-room TV, whose commands live in scripts that carry the device name
 * and repeat timing. Without it, keys are sent as plain commands to the blaster.
 */
export default function IRRemoteOverlay({ entityId, roomName, scripts, onClose }) {
  const addToast = useStore((s) => s.addToast);
  // script id -> { ok, missing } for scripts whose definition HA lets us read.
  const [health, setHealth] = useState({});

  useEffect(() => {
    if (!scripts) return undefined;
    let cancelled = false;
    fetchApi(`/api/ha/script-health?ids=${encodeURIComponent(Object.values(scripts).join(','))}`)
      .then((res) => { if (!cancelled) setHealth(res?.scripts || {}); })
      .catch(() => { /* no health info: keys just work or fail like any other */ });
    return () => { cancelled = true; };
  }, [scripts]);

  const scriptFor = (command) => (scripts ? scripts[command] : null);
  const isBroken = (command) => {
    const id = scriptFor(command);
    return Boolean(id && health[id] && health[id].ok === false);
  };

  const press = useCallback(async (command) => {
    try {
      if (scripts) {
        const id = scripts[command];
        if (!id) return;
        const h = health[id];
        if (h && h.ok === false) {
          // HA would answer 200 and fail silently; say what is actually wrong.
          addToast('error', t.home.remoteBroken.replace('{entity}', h.missing?.[0] || ''));
          return;
        }
        // turn_on returns at once; calling the script as a service would block
        // for as long as its repeats and delays take.
        await fetchApi('/api/ha/services/script/turn_on', {
          method: 'POST',
          body: JSON.stringify({ entity_id: id }),
        });
        return;
      }
      await fetchApi(`/api/ha/remote/${encodeURIComponent(entityId)}/command`, {
        method: 'POST',
        body: JSON.stringify({ command }),
      });
    } catch (err) {
      console.error('Remote command failed:', err);
    }
  }, [scripts, health, entityId, addToast]);

  // Which keys exist: every key for a plain blaster, only the mapped ones for a
  // script remote (an unmapped key would be a button that can never work).
  const has = (command) => !scripts || Boolean(scripts[command]);
  const key = (command, label, props = {}) => (has(command) ? (
    <RemoteButton label={label} command={command} onPress={press} broken={isBroken(command)} {...props} />
  ) : <div />);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center"
      style={{ backgroundColor: 'rgba(0,0,0,0.5)' }}
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div
        className="bg-surf border border-bd rounded-2xl shadow-modal p-6 w-[380px] pt:w-[680px] pt:p-10 max-h-[90vh] overflow-y-auto"
        style={{ animation: 'popupIn 250ms var(--ease) forwards' }}
        dir="rtl"
      >
        {/* Header */}
        <div className="flex items-center justify-between mb-5 pt:mb-8">
          <h3 className="text-lg pt:text-2xl font-bold text-tp">
            {t.home.remote} {roomName}
          </h3>
          <button
            onClick={onClose}
            aria-label={t.common.close}
            className="min-w-[56px] min-h-[56px] rounded-full flex items-center justify-center text-tm
                       hover:bg-s2 transition-colors active:scale-95"
          >
            <CloseIcon className="w-5 h-5" />
          </button>
        </div>

        {/* Power row */}
        <div className="flex justify-center mb-4 pt:mb-8">
          {key('power', t.home.power, { variant: 'danger', size: 'lg', className: 'w-full' })}
        </div>

        {/* Volume / source rows */}
        <div className="grid grid-cols-3 gap-2 mb-4 pt:gap-4 pt:mb-10 place-items-center">
          {key('volume_up', t.home.volUp, { size: 'sm' })}
          {key('mute', t.home.mute, { size: 'sm' })}
          {scripts
            ? key('source', t.home.inputSource, { size: 'sm' })
            : key('channel_up', t.home.chUp, { size: 'sm' })}
          {key('volume_down', t.home.volDown, { size: 'sm' })}
          {scripts
            ? key('hdmi', t.home.remoteHdmi, { size: 'sm' })
            : key('source', t.home.inputSource, { size: 'sm' })}
          {scripts
            ? key('exit', t.home.remoteExit, { size: 'sm' })
            : key('channel_down', t.home.chDown, { size: 'sm' })}
        </div>

        {/* Arrow pad */}
        <div className="mb-4 pt:mb-10">
          <ArrowPad press={press} isBroken={isBroken} />
        </div>

        {/* Bottom row */}
        <div className="flex justify-center gap-3 pt:gap-6">
          {key('back', t.home.backBtn)}
          {!scripts && key('home', t.home.homeBtn, { variant: 'accent' })}
          {key('menu', t.home.menuBtn)}
        </div>
      </div>
    </div>
  );
}
