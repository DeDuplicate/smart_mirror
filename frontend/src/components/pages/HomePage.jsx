import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import t from '../../i18n/he.json';
import useStore from '../../store/index.js';
import { HomeSkeleton } from '../Skeleton.jsx';
import useHomeAssistant from '../../hooks/useHomeAssistant.js';
import IRRemoteOverlay from '../IRRemoteOverlay.jsx';
import ACControlPopup from '../ACControlPopup.jsx';

// ─── SVG Icons ─────────────────────────────────────────────────────────────

function BulbIcon({ className = 'w-8 h-8' }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"
      strokeLinecap="round" strokeLinejoin="round" className={className}>
      <path d="M9 18h6" />
      <path d="M10 22h4" />
      <path d="M12 2a7 7 0 0 0-4 12.7V17h8v-2.3A7 7 0 0 0 12 2z" />
    </svg>
  );
}

function SnowflakeIcon({ className = 'w-8 h-8' }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"
      strokeLinecap="round" strokeLinejoin="round" className={className}>
      <line x1="12" y1="2" x2="12" y2="22" />
      <path d="M20 12H4" />
      <path d="m6 6 12 12" />
      <path d="m18 6-12 12" />
      <path d="m8 2 4 4 4-4" />
      <path d="m8 22 4-4 4 4" />
      <path d="m2 8 4 4-4 4" />
      <path d="m22 8-4 4 4 4" />
    </svg>
  );
}

function FlameIcon({ className = 'w-8 h-8' }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"
      strokeLinecap="round" strokeLinejoin="round" className={className}>
      <path d="M12 22c4-3.5 7-7.5 7-11a7 7 0 0 0-14 0c0 3.5 3 7.5 7 11z" />
      <path d="M12 22c-1.5-1.3-2.5-3-2.5-5a2.5 2.5 0 0 1 5 0c0 2-1 3.7-2.5 5z" />
    </svg>
  );
}

function PowerIcon({ className = 'w-8 h-8' }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"
      strokeLinecap="round" strokeLinejoin="round" className={className}>
      <path d="M18.36 6.64A9 9 0 1 1 5.64 6.64" />
      <line x1="12" y1="2" x2="12" y2="12" />
    </svg>
  );
}

function TvIcon({ className = 'w-8 h-8' }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"
      strokeLinecap="round" strokeLinejoin="round" className={className}>
      <rect x="2" y="3" width="20" height="14" rx="2" />
      <line x1="8" y1="21" x2="16" y2="21" />
      <line x1="12" y1="17" x2="12" y2="21" />
    </svg>
  );
}

function SpeakerIcon({ className = 'w-8 h-8' }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"
      strokeLinecap="round" strokeLinejoin="round" className={className}>
      <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" />
      <path d="M15.54 8.46a5 5 0 0 1 0 7.07" />
      <path d="M19.07 4.93a10 10 0 0 1 0 14.14" />
    </svg>
  );
}

function GateIcon({ className = 'w-8 h-8' }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"
      strokeLinecap="round" strokeLinejoin="round" className={className}>
      <path d="M3 21V8l9-5 9 5v13" />
      <path d="M9 21V12h6v9" />
      <path d="M3 8h18" />
    </svg>
  );
}

function LockIcon({ className = 'w-8 h-8' }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"
      strokeLinecap="round" strokeLinejoin="round" className={className}>
      <rect x="3" y="11" width="18" height="11" rx="2" />
      <path d="M7 11V7a5 5 0 0 1 10 0v4" />
      <circle cx="12" cy="16" r="1" />
    </svg>
  );
}

function UnlockedIcon({ className = 'w-8 h-8' }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"
      strokeLinecap="round" strokeLinejoin="round" className={className}>
      <rect x="3" y="11" width="18" height="11" rx="2" />
      <path d="M7 11V7a5 5 0 0 1 9.9-1" />
      <circle cx="12" cy="16" r="1" />
    </svg>
  );
}

function FanIcon({ className = 'w-8 h-8' }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"
      strokeLinecap="round" strokeLinejoin="round" className={className}>
      <path d="M12 12c-2-3-6-4-6-8a6 6 0 0 1 12 0c0 4-4 5-6 8z" />
      <path d="M12 12c3 2 4 6 8 6a6 6 0 0 0 0-12c-4 0-5 4-8 6z" />
      <path d="M12 12c2 3 6 4 6 8a6 6 0 0 1-12 0c0-4 4-5 6-8z" />
      <path d="M12 12c-3-2-4-6-8-6a6 6 0 0 0 0 12c4 0 5-4 8-6z" />
      <circle cx="12" cy="12" r="2" fill="currentColor" />
    </svg>
  );
}

function LightningBoltIcon({ className = 'w-8 h-8' }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"
      strokeLinecap="round" strokeLinejoin="round" className={className}>
      <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" />
    </svg>
  );
}

function CurtainIcon({ className = 'w-8 h-8' }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"
      strokeLinecap="round" strokeLinejoin="round" className={className}>
      <path d="M2 2h20v2H2z" />
      <path d="M4 4v16c3-2 4-6 4-8s1-6 4-8" />
      <path d="M20 4v16c-3-2-4-6-4-8s-1-6-4-8" />
      <line x1="2" y1="20" x2="4" y2="20" />
      <line x1="20" y1="20" x2="22" y2="20" />
    </svg>
  );
}

function RemoteControlIcon({ className = 'w-8 h-8' }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"
      strokeLinecap="round" strokeLinejoin="round" className={className}>
      <rect x="6" y="2" width="12" height="20" rx="3" />
      <circle cx="12" cy="8" r="2" />
      <line x1="10" y1="13" x2="14" y2="13" />
      <line x1="10" y1="16" x2="14" y2="16" />
    </svg>
  );
}

function SunriseIcon({ className = 'w-5 h-5' }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
      strokeLinecap="round" strokeLinejoin="round" className={className}>
      <path d="M17 18a5 5 0 0 0-10 0" />
      <line x1="12" y1="9" x2="12" y2="2" />
      <line x1="4.22" y1="10.22" x2="5.64" y2="11.64" />
      <line x1="1" y1="18" x2="3" y2="18" />
      <line x1="21" y1="18" x2="23" y2="18" />
      <line x1="18.36" y1="11.64" x2="19.78" y2="10.22" />
      <line x1="23" y1="22" x2="1" y2="22" />
      <polyline points="8 6 12 2 16 6" />
    </svg>
  );
}

function MovieIcon({ className = 'w-5 h-5' }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
      strokeLinecap="round" strokeLinejoin="round" className={className}>
      <rect x="2" y="2" width="20" height="20" rx="2.18" />
      <line x1="7" y1="2" x2="7" y2="22" />
      <line x1="17" y1="2" x2="17" y2="22" />
      <line x1="2" y1="12" x2="22" y2="12" />
      <line x1="2" y1="7" x2="7" y2="7" />
      <line x1="2" y1="17" x2="7" y2="17" />
      <line x1="17" y1="7" x2="22" y2="7" />
      <line x1="17" y1="17" x2="22" y2="17" />
    </svg>
  );
}

function MoonIcon({ className = 'w-5 h-5' }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
      strokeLinecap="round" strokeLinejoin="round" className={className}>
      <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
    </svg>
  );
}

function DoorIcon({ className = 'w-5 h-5' }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
      strokeLinecap="round" strokeLinejoin="round" className={className}>
      <path d="M18 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V4a2 2 0 0 0-2-2z" />
      <line x1="14" y1="12" x2="14" y2="12.01" />
    </svg>
  );
}

function HomeIllustration() {
  return (
    <svg viewBox="0 0 120 120" fill="none" className="w-28 h-28 text-tm">
      <rect x="20" y="50" width="80" height="55" rx="12" stroke="currentColor" strokeWidth="2.5" />
      <path d="M10 55L60 18l50 37" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
      <rect x="45" y="72" width="30" height="33" rx="4" stroke="currentColor" strokeWidth="2" />
      <circle cx="60" cy="88" r="3" fill="currentColor" opacity="0.4" />
    </svg>
  );
}

function SettingsIcon({ className = 'w-5 h-5' }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
      strokeLinecap="round" strokeLinejoin="round" className={className}>
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65
        1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0
        9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0
        4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65
        0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65
        0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0
        1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0
        1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
    </svg>
  );
}

function CloseIcon({ className = 'w-5 h-5' }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
      strokeLinecap="round" strokeLinejoin="round" className={className}>
      <line x1="18" y1="6" x2="6" y2="18" />
      <line x1="6" y1="6" x2="18" y2="18" />
    </svg>
  );
}

// ─── Entity Helpers ────────────────────────────────────────────────────────

function getDomain(entityId) {
  return entityId.split('.')[0];
}

function getEntityIcon(entity) {
  const domain = getDomain(entity.entity_id);
  switch (domain) {
    case 'light':
      return <BulbIcon />;
    case 'climate': {
      const isHeating = entity.state === 'heat' ||
        entity.attributes?.hvac_action === 'heating';
      return isHeating ? <FlameIcon /> : <SnowflakeIcon />;
    }
    case 'switch':
    case 'input_boolean':
      return <PowerIcon />;
    case 'media_player': {
      const name = (entity.attributes?.friendly_name || '').toLowerCase();
      const isTv = name.includes('tv') || name.includes('טלוויזיה') ||
        entity.attributes?.device_class === 'tv';
      return isTv ? <TvIcon /> : <SpeakerIcon />;
    }
    case 'cover':
      return <GateIcon />;
    case 'lock':
      return entity.state === 'locked' ? <LockIcon /> : <UnlockedIcon />;
    case 'fan':
      return <FanIcon />;
    default:
      return <PowerIcon />;
  }
}

function isEntityOn(entity) {
  const domain = getDomain(entity.entity_id);
  switch (domain) {
    case 'lock':
      return entity.state === 'unlocked';
    case 'cover':
      return entity.state === 'open';
    case 'climate':
      return entity.state !== 'off';
    case 'media_player':
      return entity.state === 'on' || entity.state === 'playing' || entity.state === 'paused';
    default:
      return entity.state === 'on';
  }
}

function getStatusText(entity) {
  const domain = getDomain(entity.entity_id);
  const on = isEntityOn(entity);

  switch (domain) {
    case 'light': {
      if (!on) return t.home.off;
      const brightness = entity.attributes?.brightness;
      if (brightness != null) {
        const pct = Math.round((brightness / 255) * 100);
        return `${t.home.on} ${pct}%`;
      }
      return t.home.on;
    }
    case 'climate': {
      if (entity.state === 'off') return t.home.climateOff;
      const temp = entity.attributes?.temperature;
      const modes = {
        cool: t.home.cooling,
        heat: t.home.heating,
        auto: t.home.auto,
        fan_only: t.home.fanOnly,
      };
      const modeText = modes[entity.state] || entity.state;
      return temp ? `${temp}°C / ${modeText}` : modeText;
    }
    case 'cover': {
      const pos = entity.attributes?.current_position;
      if (entity.state === 'closed') return t.home.closed;
      if (pos != null && pos > 0) return `${t.home.open} ${pos}%`;
      return entity.state === 'open' ? t.home.open : t.home.closed;
    }
    case 'lock':
      return entity.state === 'locked' ? t.home.locked : t.home.unlocked;
    case 'media_player':
      return on ? t.home.playing : t.home.off;
    case 'fan':
      return on ? t.home.active : t.home.inactive;
    case 'switch':
    case 'input_boolean':
      return on ? t.home.active : t.home.inactive;
    default:
      return on ? t.home.on : t.home.off;
  }
}

function hasLongPressPopup(entityId) {
  const domain = getDomain(entityId);
  return ['light', 'climate', 'media_player', 'cover'].includes(domain);
}

// ─── Debounce helper ───────────────────────────────────────────────────────

function useDebouncedCallback(fn, delay) {
  const timerRef = useRef(null);
  const fnRef = useRef(fn);
  fnRef.current = fn;

  return useCallback(
    (...args) => {
      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = setTimeout(() => fnRef.current(...args), delay);
    },
    [delay]
  );
}

// ─── Device Tile ───────────────────────────────────────────────────────────

function DeviceTile({ entity, onToggle, onLongPress, offline }) {
  const domain = getDomain(entity.entity_id);
  const on = isEntityOn(entity);
  const pressTimerRef = useRef(null);
  const pressedRef = useRef(false);
  const [pressing, setPressing] = useState(false);
  const [justToggled, setJustToggled] = useState(false);

  const handlePressStart = useCallback(
    (e) => {
      e.preventDefault();
      pressedRef.current = true;
      setPressing(true);

      if (hasLongPressPopup(entity.entity_id)) {
        pressTimerRef.current = setTimeout(() => {
          if (pressedRef.current) {
            pressedRef.current = false;
            setPressing(false);
            onLongPress(entity);
          }
        }, 300);
      }
    },
    [entity, onLongPress]
  );

  const handlePressEnd = useCallback(
    (e) => {
      e.preventDefault();
      if (!pressedRef.current) {
        setPressing(false);
        return;
      }
      pressedRef.current = false;
      setPressing(false);

      if (pressTimerRef.current) {
        clearTimeout(pressTimerRef.current);
        pressTimerRef.current = null;
      }

      // Short tap -> toggle
      onToggle(entity.entity_id, domain);
      setJustToggled(true);
      setTimeout(() => setJustToggled(false), 400);
    },
    [entity.entity_id, domain, onToggle]
  );

  const handlePressCancel = useCallback(() => {
    pressedRef.current = false;
    setPressing(false);
    if (pressTimerRef.current) {
      clearTimeout(pressTimerRef.current);
      pressTimerRef.current = null;
    }
  }, []);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (pressTimerRef.current) clearTimeout(pressTimerRef.current);
    };
  }, []);

  const borderColor = on
    ? 'border-acc2'
    : 'border-bd';

  const toggleBorderStyle = justToggled
    ? { borderColor: 'var(--acc2)', transition: 'border-color 400ms ease' }
    : {};

  return (
    <div
      className={`relative card flex flex-col items-center justify-center gap-2.5
                   rounded-[20px] cursor-pointer select-none overflow-hidden
                   border-2 ${borderColor}
                   transition-all duration-[var(--dur-fast)]
                   ${pressing ? 'scale-[0.97]' : 'scale-100'}
                   hover:shadow-md`}
      style={{
        minHeight: '140px',
        minWidth: '180px',
        ...toggleBorderStyle,
      }}
      onPointerDown={handlePressStart}
      onPointerUp={handlePressEnd}
      onPointerLeave={handlePressCancel}
      onPointerCancel={handlePressCancel}
      onContextMenu={(e) => e.preventDefault()}
    >
      {/* Offline badge */}
      {offline && (
        <div className="absolute top-2 left-2 px-2 py-0.5 rounded-full text-[10px]
                        font-semibold bg-coral/20 text-coral-d">
          {t.home.notConnected}
        </div>
      )}

      {/* Icon */}
      <div
        className={`w-12 h-12 rounded-full flex items-center justify-center transition-colors duration-[var(--dur-fast)]
          ${on ? 'bg-acc2/15 text-acc2' : 'bg-s2 text-tm'}`}
      >
        {getEntityIcon(entity)}
      </div>

      {/* Label */}
      <span className="text-sm font-medium text-tp text-center leading-tight px-2 line-clamp-1">
        {entity.attributes?.friendly_name || entity.entity_id}
      </span>

      {/* Status */}
      <span className={`text-xs font-medium ${on ? 'text-acc2' : 'text-tm'}`}>
        {getStatusText(entity)}
      </span>
    </div>
  );
}

// ─── Control Popup — Slider ────────────────────────────────────────────────

function PopupSlider({ value, min, max, step = 1, label, suffix = '', onChange }) {
  const trackRef = useRef(null);
  const [localVal, setLocalVal] = useState(value);
  const debouncedChange = useDebouncedCallback(onChange, 300);

  useEffect(() => {
    setLocalVal(value);
  }, [value]);

  const pct = ((localVal - min) / (max - min)) * 100;

  const handleMove = useCallback(
    (clientY) => {
      if (!trackRef.current) return;
      const rect = trackRef.current.getBoundingClientRect();
      // Inverted: top = max, bottom = min
      let ratio = 1 - (clientY - rect.top) / rect.height;
      ratio = Math.max(0, Math.min(1, ratio));
      const raw = min + ratio * (max - min);
      const snapped = Math.round(raw / step) * step;
      const clamped = Math.max(min, Math.min(max, snapped));
      setLocalVal(clamped);
      debouncedChange(clamped);
    },
    [min, max, step, debouncedChange]
  );

  const handlePointerDown = useCallback(
    (e) => {
      e.preventDefault();
      e.target.setPointerCapture(e.pointerId);
      handleMove(e.clientY);
    },
    [handleMove]
  );

  const handlePointerMove = useCallback(
    (e) => {
      if (e.buttons === 0) return;
      handleMove(e.clientY);
    },
    [handleMove]
  );

  return (
    <div className="flex flex-col items-center gap-2">
      <span className="text-xs font-semibold text-ts">{label}</span>
      <div className="flex items-center gap-3">
        <div
          ref={trackRef}
          className="relative w-12 h-48 rounded-full bg-s2 cursor-pointer overflow-hidden"
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
        >
          {/* Fill from bottom */}
          <div
            className="absolute bottom-0 left-0 right-0 rounded-full transition-[height] duration-75"
            style={{
              height: `${pct}%`,
              background: 'var(--acc2)',
              opacity: 0.85,
            }}
          />
          {/* Thumb indicator */}
          <div
            className="absolute left-1/2 -translate-x-1/2 w-8 h-3 rounded-full bg-white shadow-md
                       transition-[bottom] duration-75"
            style={{ bottom: `calc(${pct}% - 6px)` }}
          />
        </div>
        <span className="text-lg font-bold text-tp w-14 text-center tabular-nums">
          {suffix === '°C' ? `${localVal}${suffix}` : `${localVal}${suffix}`}
        </span>
      </div>
    </div>
  );
}

// ─── Climate Mode Selector ─────────────────────────────────────────────────

function ClimateModeSelector({ currentMode, modes, onChange }) {
  const modeLabels = {
    off: t.home.climateOff,
    cool: t.home.climateCool,
    heat: t.home.climateHeat,
    auto: t.home.climateAuto,
    fan_only: t.home.climateFan,
  };

  const availableModes = modes || ['off', 'cool', 'heat', 'auto', 'fan_only'];

  return (
    <div className="flex flex-col items-center gap-2">
      <span className="text-xs font-semibold text-ts">{t.home.mode}</span>
      <div className="flex flex-wrap gap-1.5 justify-center">
        {availableModes.map((mode) => (
          <button
            key={mode}
            onClick={() => onChange(mode)}
            className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all duration-[var(--dur-fast)]
              active:scale-95 ${
              currentMode === mode
                ? 'bg-acc2 text-white'
                : 'bg-s2 text-ts hover:bg-bd'
            }`}
          >
            {modeLabels[mode] || mode}
          </button>
        ))}
      </div>
    </div>
  );
}

// ─── Control Popup ─────────────────────────────────────────────────────────

function ControlPopup({ entity, anchorRect, onClose, ha }) {
  const domain = getDomain(entity.entity_id);
  const popupRef = useRef(null);

  // Position near the tile
  const style = useMemo(() => {
    if (!anchorRect) return {};
    const popupW = 220;
    const popupH = 320;
    let left = anchorRect.left + anchorRect.width / 2 - popupW / 2;
    let top = anchorRect.top - popupH - 12;

    // Keep within screen
    if (left < 16) left = 16;
    if (left + popupW > window.innerWidth - 16) left = window.innerWidth - 16 - popupW;
    if (top < 16) {
      top = anchorRect.bottom + 12;
    }
    if (top + popupH > window.innerHeight - 16) {
      top = window.innerHeight - 16 - popupH;
    }

    return {
      position: 'fixed',
      left: `${left}px`,
      top: `${top}px`,
      width: `${popupW}px`,
      zIndex: 50,
    };
  }, [anchorRect]);

  // Close on click outside
  useEffect(() => {
    function handleClickOutside(e) {
      if (popupRef.current && !popupRef.current.contains(e.target)) {
        onClose();
      }
    }
    // Small delay so the popup creation click doesn't immediately close it
    const timer = setTimeout(() => {
      document.addEventListener('pointerdown', handleClickOutside);
    }, 50);
    return () => {
      clearTimeout(timer);
      document.removeEventListener('pointerdown', handleClickOutside);
    };
  }, [onClose]);

  // Close on Escape
  useEffect(() => {
    function handleKey(e) {
      if (e.key === 'Escape') onClose();
    }
    document.addEventListener('keydown', handleKey);
    return () => document.removeEventListener('keydown', handleKey);
  }, [onClose]);

  const renderContent = () => {
    switch (domain) {
      case 'light': {
        const brightness = entity.attributes?.brightness;
        const brightnessPct = brightness != null ? Math.round((brightness / 255) * 100) : 100;
        const hasColorTemp = entity.attributes?.color_temp != null &&
          entity.attributes?.min_mireds != null;

        return (
          <div className="flex gap-5 items-start justify-center p-4">
            <PopupSlider
              value={brightnessPct}
              min={0}
              max={100}
              step={1}
              label={t.home.brightness}
              suffix="%"
              onChange={(val) => ha.setBrightness(entity.entity_id, val)}
            />
            {hasColorTemp && (
              <PopupSlider
                value={entity.attributes.color_temp}
                min={entity.attributes.min_mireds || 153}
                max={entity.attributes.max_mireds || 500}
                step={10}
                label={t.home.colorTemp}
                suffix=""
                onChange={(val) => ha.setColorTemp(entity.entity_id, val)}
              />
            )}
          </div>
        );
      }

      case 'climate': {
        const temp = entity.attributes?.temperature || 24;
        const minTemp = entity.attributes?.min_temp || 16;
        const maxTemp = entity.attributes?.max_temp || 30;
        return (
          <div className="flex flex-col items-center gap-4 p-4">
            <PopupSlider
              value={temp}
              min={minTemp}
              max={maxTemp}
              step={0.5}
              label={t.home.targetTemp}
              suffix="°C"
              onChange={(val) => ha.setTemperature(entity.entity_id, val)}
            />
            <ClimateModeSelector
              currentMode={entity.state}
              modes={entity.attributes?.hvac_modes}
              onChange={(mode) => ha.setHvacMode(entity.entity_id, mode)}
            />
          </div>
        );
      }

      case 'media_player': {
        const vol = Math.round((entity.attributes?.volume_level || 0) * 100);
        return (
          <div className="flex items-start justify-center p-4">
            <PopupSlider
              value={vol}
              min={0}
              max={100}
              step={1}
              label={t.home.volume}
              suffix="%"
              onChange={(val) => ha.setVolume(entity.entity_id, val)}
            />
          </div>
        );
      }

      case 'cover': {
        const pos = entity.attributes?.current_position ?? 0;
        return (
          <div className="flex items-start justify-center p-4">
            <PopupSlider
              value={pos}
              min={0}
              max={100}
              step={1}
              label={t.home.position}
              suffix="%"
              onChange={(val) => ha.setCoverPosition(entity.entity_id, val)}
            />
          </div>
        );
      }

      default:
        return null;
    }
  };

  return (
    <div
      ref={popupRef}
      className="bg-surf border border-bd rounded-2xl shadow-2xl animate-popup-in"
      style={style}
      dir="rtl"
    >
      {/* Header */}
      <div className="flex items-center justify-between px-4 pt-3 pb-1">
        <span className="text-sm font-semibold text-tp">
          {entity.attributes?.friendly_name || entity.entity_id}
        </span>
        <button
          onClick={onClose}
          className="w-7 h-7 rounded-full flex items-center justify-center text-tm hover:bg-s2
                     transition-colors active:scale-90"
        >
          <CloseIcon className="w-4 h-4" />
        </button>
      </div>

      {renderContent()}
    </div>
  );
}

// ─── Scene Buttons ─────────────────────────────────────────────────────────

const SCENE_CONFIG = [
  { key: 'morning', icon: SunriseIcon, label: t.home.sceneMorning, entityId: 'scene.good_morning' },
  { key: 'movie', icon: MovieIcon, label: t.home.sceneMovie, entityId: 'scene.movie_mode' },
  { key: 'night', icon: MoonIcon, label: t.home.sceneNight, entityId: 'scene.good_night' },
  { key: 'leaving', icon: DoorIcon, label: t.home.sceneLeaving, entityId: 'scene.leaving_home', confirm: true },
];

function SceneButton({ config, onActivate }) {
  const [pulsing, setPulsing] = useState(false);
  const Icon = config.icon;

  const handleClick = useCallback(() => {
    onActivate(config);
    if (!config.confirm) {
      setPulsing(true);
      setTimeout(() => setPulsing(false), 600);
    }
  }, [config, onActivate]);

  return (
    <button
      onClick={handleClick}
      className={`ripple flex-1 flex items-center justify-center gap-3 min-h-[56px]
                  rounded-xl bg-surf border border-bd text-sm font-medium text-tp
                  hover:bg-s2 active:scale-95 transition-all duration-[var(--dur-fast)]
                  ${pulsing ? 'animate-scene-pulse' : ''}`}
    >
      <Icon className="w-5 h-5" />
      <span>{config.label}</span>
    </button>
  );
}

// ─── Electricity Monitor Tile (Feature 1) ─────────────────────────────────

function ElectricityTile({ allStates }) {
  const sensor = allStates.find((e) => e.entity_id === 'sensor.2_power_meter');
  const watts = sensor ? parseFloat(sensor.state) : null;
  const isValid = watts !== null && !isNaN(watts);

  const color = !isValid ? 'text-tm'
    : watts < 500 ? 'text-[#2ab58a]'
    : watts <= 2000 ? 'text-[#e0a630]'
    : 'text-[#c95454]';

  const borderColor = !isValid ? 'border-bd'
    : watts < 500 ? 'border-[#2ab58a]'
    : watts <= 2000 ? 'border-[#e0a630]'
    : 'border-[#c95454]';

  return (
    <div
      className={`relative card flex flex-col items-center justify-center gap-2.5
                   rounded-[20px] select-none overflow-hidden
                   border-2 ${borderColor}
                   transition-all duration-[var(--dur-fast)]`}
      style={{ minHeight: '140px', minWidth: '180px' }}
    >
      <div className={`w-12 h-12 rounded-full flex items-center justify-center ${color}`}
        style={{ backgroundColor: isValid && watts >= 500 ? (watts > 2000 ? 'rgba(201,84,84,0.15)' : 'rgba(224,166,48,0.15)') : 'rgba(42,181,138,0.15)' }}
      >
        <LightningBoltIcon />
      </div>
      <span className={`text-2xl font-bold tabular-nums ${color}`}
        style={{ fontFamily: "'DM Mono', monospace" }}
      >
        {isValid ? `${Math.round(watts)}W` : '--'}
      </span>
      <span className="text-xs font-medium text-ts">{t.home.electricityConsumption}</span>
    </div>
  );
}

// ─── Smart Curtain Tile (Feature 2) ───────────────────────────────────────

function CurtainTile({ allStates, ha, onLongPress }) {
  const entity = allStates.find((e) => e.entity_id === 'cover.smart_curtain_robot_curtain');
  const pressTimerRef = useRef(null);
  const pressedRef = useRef(false);
  const [pressing, setPressing] = useState(false);

  if (!entity) return null;

  const pos = entity.attributes?.current_position;
  const isClosed = entity.state === 'closed';
  const isOpen = entity.state === 'open';
  const statusText = isClosed ? t.home.curtainClosed
    : (pos != null && pos > 0 && pos < 100) ? `${pos}%`
    : t.home.curtainOpen;

  const borderColor = isOpen ? 'border-acc2' : 'border-bd';

  const handlePressStart = (e) => {
    e.preventDefault();
    pressedRef.current = true;
    setPressing(true);
    pressTimerRef.current = setTimeout(() => {
      if (pressedRef.current) {
        pressedRef.current = false;
        setPressing(false);
        onLongPress(entity);
      }
    }, 300);
  };

  const handlePressEnd = (e) => {
    e.preventDefault();
    if (!pressedRef.current) {
      setPressing(false);
      return;
    }
    pressedRef.current = false;
    setPressing(false);
    if (pressTimerRef.current) {
      clearTimeout(pressTimerRef.current);
      pressTimerRef.current = null;
    }
    // Short tap: toggle open/close
    if (isClosed) {
      ha.callService('cover', 'open_cover', { entity_id: entity.entity_id });
    } else {
      ha.callService('cover', 'close_cover', { entity_id: entity.entity_id });
    }
  };

  const handlePressCancel = () => {
    pressedRef.current = false;
    setPressing(false);
    if (pressTimerRef.current) {
      clearTimeout(pressTimerRef.current);
      pressTimerRef.current = null;
    }
  };

  return (
    <div
      className={`relative card flex flex-col items-center justify-center gap-2.5
                   rounded-[20px] cursor-pointer select-none overflow-hidden
                   border-2 ${borderColor}
                   transition-all duration-[var(--dur-fast)]
                   ${pressing ? 'scale-[0.97]' : 'scale-100'}
                   hover:shadow-md`}
      style={{ minHeight: '140px', minWidth: '180px' }}
      onPointerDown={handlePressStart}
      onPointerUp={handlePressEnd}
      onPointerLeave={handlePressCancel}
      onPointerCancel={handlePressCancel}
      onContextMenu={(e) => e.preventDefault()}
    >
      <div className={`w-12 h-12 rounded-full flex items-center justify-center transition-colors duration-[var(--dur-fast)]
        ${isOpen ? 'bg-acc2/15 text-acc2' : 'bg-s2 text-tm'}`}>
        <CurtainIcon />
      </div>
      <span className="text-sm font-medium text-tp text-center leading-tight px-2 line-clamp-1">
        {t.home.curtain}
      </span>
      <span className={`text-xs font-medium ${isOpen ? 'text-acc2' : 'text-tm'}`}>
        {statusText}
      </span>
    </div>
  );
}

// ─── Curtain Control Popup (Feature 2) ────────────────────────────────────

function CurtainPopup({ entity, anchorRect, onClose, ha }) {
  const popupRef = useRef(null);

  const style = useMemo(() => {
    if (!anchorRect) return {};
    const popupW = 260;
    const popupH = 360;
    let left = anchorRect.left + anchorRect.width / 2 - popupW / 2;
    let top = anchorRect.top - popupH - 12;
    if (left < 16) left = 16;
    if (left + popupW > window.innerWidth - 16) left = window.innerWidth - 16 - popupW;
    if (top < 16) top = anchorRect.bottom + 12;
    if (top + popupH > window.innerHeight - 16) top = window.innerHeight - 16 - popupH;
    return { position: 'fixed', left: `${left}px`, top: `${top}px`, width: `${popupW}px`, zIndex: 50 };
  }, [anchorRect]);

  useEffect(() => {
    function handleClickOutside(e) {
      if (popupRef.current && !popupRef.current.contains(e.target)) onClose();
    }
    const timer = setTimeout(() => document.addEventListener('pointerdown', handleClickOutside), 50);
    return () => { clearTimeout(timer); document.removeEventListener('pointerdown', handleClickOutside); };
  }, [onClose]);

  useEffect(() => {
    function handleKey(e) { if (e.key === 'Escape') onClose(); }
    document.addEventListener('keydown', handleKey);
    return () => document.removeEventListener('keydown', handleKey);
  }, [onClose]);

  const pos = entity.attributes?.current_position ?? 0;

  return (
    <div ref={popupRef} className="bg-surf border border-bd rounded-2xl shadow-2xl animate-popup-in" style={style} dir="rtl">
      <div className="flex items-center justify-between px-4 pt-3 pb-1">
        <span className="text-sm font-semibold text-tp">{t.home.curtain}</span>
        <button onClick={onClose} className="w-7 h-7 rounded-full flex items-center justify-center text-tm hover:bg-s2 transition-colors active:scale-90">
          <CloseIcon className="w-4 h-4" />
        </button>
      </div>

      <div className="flex flex-col items-center gap-4 p-4">
        {/* Position slider */}
        <PopupSlider
          value={pos}
          min={0}
          max={100}
          step={1}
          label={t.home.position}
          suffix="%"
          onChange={(val) => ha.setCoverPosition(entity.entity_id, val)}
        />

        {/* Quick buttons */}
        <div className="flex gap-2 w-full">
          <button
            onClick={() => ha.callService('cover', 'open_cover', { entity_id: entity.entity_id })}
            className="flex-1 px-3 py-2.5 rounded-xl text-xs font-medium bg-acc2 text-white
                       hover:bg-acc2/90 active:scale-95 transition-all duration-[var(--dur-fast)]"
          >
            {t.home.openCurtain}
          </button>
          <button
            onClick={() => ha.setCoverPosition(entity.entity_id, 50)}
            className="flex-1 px-3 py-2.5 rounded-xl text-xs font-medium bg-s2 text-tp
                       hover:bg-bd active:scale-95 transition-all duration-[var(--dur-fast)]"
          >
            {t.home.halfPosition}
          </button>
          <button
            onClick={() => ha.callService('cover', 'close_cover', { entity_id: entity.entity_id })}
            className="flex-1 px-3 py-2.5 rounded-xl text-xs font-medium bg-s2 text-tp
                       hover:bg-bd active:scale-95 transition-all duration-[var(--dur-fast)]"
          >
            {t.home.closeCurtain}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── IR Remote Tile (Feature 3) ───────────────────────────────────────────

function IRRemoteTile({ entityId, label, onTap }) {
  return (
    <div
      className="relative card flex flex-col items-center justify-center gap-2.5
                 rounded-[20px] cursor-pointer select-none overflow-hidden
                 border-2 border-bd hover:shadow-md
                 transition-all duration-[var(--dur-fast)] active:scale-[0.97]"
      style={{ minHeight: '140px', minWidth: '180px' }}
      onClick={() => onTap(entityId)}
    >
      <div className="w-12 h-12 rounded-full flex items-center justify-center bg-lav-bg/50 text-lav-d">
        <RemoteControlIcon />
      </div>
      <span className="text-sm font-medium text-tp text-center leading-tight px-2 line-clamp-1">
        {label}
      </span>
      <span className="text-xs font-medium text-ts">{t.home.irRemote}</span>
    </div>
  );
}

// ─── HomePage ──────────────────────────────────────────────────────────────

export default function HomePage() {
  const haStatus = useStore((s) => s.connections.ha);
  const setActiveTab = useStore((s) => s.setActiveTab);
  const addToast = useStore((s) => s.addToast);
  const showConfirm = useStore((s) => s.showConfirm);

  const ha = useHomeAssistant();
  const { entities, allStates, loading, connected } = ha;

  const [popup, setPopup] = useState(null); // { entity, rect }
  const [acPopupOpen, setAcPopupOpen] = useState(false);
  const [curtainPopup, setCurtainPopup] = useState(null); // { entity, rect }
  const [irOverlay, setIrOverlay] = useState(null); // { entityId, roomName }

  const isConfigured = haStatus === 'connected' || haStatus === 'degraded';

  // ── Not configured state ──────────────────────────────────────────────────

  if (!isConfigured && entities.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-5">
        <HomeIllustration />
        <p className="text-tm text-lg">{t.empty.notConfigured}</p>
        <button
          onClick={() => setActiveTab(6)}
          className="ripple flex items-center gap-2 px-6 min-h-[56px] rounded-xl bg-acc text-white
                     font-medium hover:bg-acc/90 active:scale-95 transition-all duration-[var(--dur-fast)]"
        >
          <SettingsIcon />
          <span>{t.home.configureInSettings}</span>
        </button>
      </div>
    );
  }

  // ── Loading state ─────────────────────────────────────────────────────────

  if (loading && entities.length === 0) {
    return <HomeSkeleton />;
  }

  // ── Handlers ──────────────────────────────────────────────────────────────

  const handleToggle = (entityId, domain) => {
    if (domain === 'lock') {
      showConfirm({
        title: t.home.confirmLock,
        message: t.home.confirmLockMessage,
        onConfirm: () => ha.toggleEntity(entityId),
      });
    } else {
      ha.toggleEntity(entityId);
    }
  };

  const handleLongPress = (entity) => {
    // Find the tile element to anchor the popup
    const tileEl = document.querySelector(`[data-entity-id="${entity.entity_id}"]`);
    const rect = tileEl ? tileEl.getBoundingClientRect() : null;
    setPopup({ entity, rect });
  };

  const handleCurtainLongPress = (entity) => {
    const tileEl = document.querySelector(`[data-entity-id="curtain-tile"]`);
    const rect = tileEl ? tileEl.getBoundingClientRect() : null;
    setCurtainPopup({ entity, rect });
  };

  // ── IR Remote config ──
  const IR_REMOTES = [
    { entityId: 'remote.wifi_ir_master_bedroom', label: t.home.irRemoteMaster },
    { entityId: 'remote.wifi_ir_childrens_room', label: t.home.irRemoteChildren },
  ];

  const handleIRTap = (entityId) => {
    const remote = IR_REMOTES.find((r) => r.entityId === entityId);
    setIrOverlay({ entityId, roomName: remote?.label || entityId });
  };

  const handleSceneActivate = (config) => {
    if (config.confirm) {
      showConfirm({
        title: t.home.confirmLeaving,
        message: t.home.confirmLeavingMessage,
        onConfirm: () => {
          ha.activateScene(config.entityId);
          addToast('success', t.home.sceneActivated);
        },
      });
    } else {
      ha.activateScene(config.entityId);
      addToast('success', t.home.sceneActivated);
    }
  };

  const offline = !connected && isConfigured;

  // ── Main content ──────────────────────────────────────────────────────────

  return (
    <div className="flex flex-col h-full overflow-hidden p-6 gap-5" dir="rtl">
      {/* Device tiles grid */}
      <div className="flex-1 grid grid-cols-5 grid-rows-2 gap-4 overflow-y-auto">
        {/* AC Control tile — spans 2 columns */}
        <div
          className="col-span-2 card flex flex-col items-center justify-center gap-2.5
                     rounded-[20px] cursor-pointer select-none overflow-hidden
                     border-2 border-bd hover:shadow-md
                     transition-all duration-[var(--dur-fast)]
                     hover:border-acc2 active:scale-[0.97]"
          style={{ minHeight: '140px' }}
          onClick={() => setAcPopupOpen(true)}
        >
          <div className="w-12 h-12 rounded-full flex items-center justify-center bg-s2 text-tm">
            <SnowflakeIcon />
          </div>
          <span className="text-sm font-medium text-tp text-center leading-tight px-2">
            {t.home.ac}
          </span>
          <span className="text-xs font-medium text-tm">
            {t.home.acControl}
          </span>
        </div>

        {/* Regular device tiles (up to 4, since AC=2cols + 4 special tiles = 10) */}
        {entities.slice(0, 4).map((entity) => (
          <div key={entity.entity_id} data-entity-id={entity.entity_id}>
            <DeviceTile
              entity={entity}
              onToggle={handleToggle}
              onLongPress={handleLongPress}
              offline={offline}
            />
          </div>
        ))}

        {/* Electricity Monitor tile */}
        <div key="electricity-tile">
          <ElectricityTile allStates={allStates || []} />
        </div>

        {/* Smart Curtain tile */}
        <div key="curtain-tile" data-entity-id="curtain-tile">
          <CurtainTile allStates={allStates || []} ha={ha} onLongPress={handleCurtainLongPress} />
        </div>

        {/* IR Remote tiles */}
        {IR_REMOTES.map((remote) => (
          <div key={remote.entityId}>
            <IRRemoteTile
              entityId={remote.entityId}
              label={remote.label}
              onTap={handleIRTap}
            />
          </div>
        ))}

        {/* Fill remaining tiles if fewer entities */}
        {entities.length < 4 &&
          Array.from({ length: 4 - entities.length }).map((_, i) => (
            <div
              key={`empty-${i}`}
              className="card flex flex-col items-center justify-center gap-2
                         rounded-[20px] border-2 border-dashed border-bd
                         min-h-[140px] min-w-[180px] opacity-30"
            >
              <div className="w-10 h-10 rounded-full bg-s2 flex items-center justify-center">
                <span className="text-tm text-lg">+</span>
              </div>
            </div>
          ))}
      </div>

      {/* Scene buttons */}
      <div className="flex gap-4 shrink-0">
        {SCENE_CONFIG.map((scene) => (
          <SceneButton
            key={scene.key}
            config={scene}
            onActivate={handleSceneActivate}
          />
        ))}
      </div>

      {/* Control popup (lights, climate, media, cover) */}
      {popup && (
        <ControlPopup
          entity={popup.entity}
          anchorRect={popup.rect}
          onClose={() => setPopup(null)}
          ha={ha}
        />
      )}

      {/* AC Control popup */}
      <ACControlPopup
        visible={acPopupOpen}
        onClose={() => setAcPopupOpen(false)}
        callService={ha.callService}
      />

      {/* Curtain popup */}
      {curtainPopup && (
        <CurtainPopup
          entity={curtainPopup.entity}
          anchorRect={curtainPopup.rect}
          onClose={() => setCurtainPopup(null)}
          ha={ha}
        />
      )}

      {/* IR Remote overlay */}
      {irOverlay && (
        <IRRemoteOverlay
          entityId={irOverlay.entityId}
          roomName={irOverlay.roomName}
          onClose={() => setIrOverlay(null)}
        />
      )}
    </div>
  );
}
