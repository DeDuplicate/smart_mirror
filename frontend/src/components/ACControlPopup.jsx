import { useState, useEffect, useRef, useCallback } from 'react';
import t from '../i18n/he.json';

// ─── Icons ─────────────────────────────────────────────────────────────────

function SnowflakeIcon({ className = 'w-5 h-5' }) {
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

function FlameIcon({ className = 'w-5 h-5' }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"
      strokeLinecap="round" strokeLinejoin="round" className={className}>
      <path d="M12 22c4-3.5 7-7.5 7-11a7 7 0 0 0-14 0c0 3.5 3 7.5 7 11z" />
      <path d="M12 22c-1.5-1.3-2.5-3-2.5-5a2.5 2.5 0 0 1 5 0c0 2-1 3.7-2.5 5z" />
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

function PowerIcon({ className = 'w-5 h-5' }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
      strokeLinecap="round" strokeLinejoin="round" className={className}>
      <path d="M18.36 6.64A9 9 0 1 1 5.64 6.64" />
      <line x1="12" y1="2" x2="12" y2="12" />
    </svg>
  );
}

// ─── Temperature Range ─────────────────────────────────────────────────────

const TEMPS = [];
for (let i = 18; i <= 30; i++) TEMPS.push(i);

const MODES = [
  { key: 'cool', label: t.home.acCool, icon: SnowflakeIcon },
  { key: 'heat', label: t.home.acHeat, icon: FlameIcon },
];

const SPEEDS = [
  { key: 'low', label: t.home.acFanLow },
  { key: 'mid', label: t.home.acFanMid },
  { key: 'high', label: t.home.acFanHigh },
];

// ─── ACControlPopup ───────────────────────────────────────────────────────

export default function ACControlPopup({ visible, onClose, callService }) {
  const popupRef = useRef(null);
  const tempScrollRef = useRef(null);

  const [isOn, setIsOn] = useState(false);
  const [mode, setMode] = useState('cool');
  const [temp, setTemp] = useState(24);
  const [speed, setSpeed] = useState('low');
  const [sending, setSending] = useState(false);

  // Close on click outside
  useEffect(() => {
    if (!visible) return;
    function handleClickOutside(e) {
      if (popupRef.current && !popupRef.current.contains(e.target)) {
        onClose();
      }
    }
    const timer = setTimeout(() => {
      document.addEventListener('pointerdown', handleClickOutside);
    }, 50);
    return () => {
      clearTimeout(timer);
      document.removeEventListener('pointerdown', handleClickOutside);
    };
  }, [visible, onClose]);

  // Close on Escape
  useEffect(() => {
    if (!visible) return;
    function handleKey(e) {
      if (e.key === 'Escape') onClose();
    }
    document.addEventListener('keydown', handleKey);
    return () => document.removeEventListener('keydown', handleKey);
  }, [visible, onClose]);

  // Scroll to selected temp on open
  useEffect(() => {
    if (visible && tempScrollRef.current) {
      const selected = tempScrollRef.current.querySelector('[data-selected="true"]');
      if (selected) {
        selected.scrollIntoView({ inline: 'center', behavior: 'smooth' });
      }
    }
  }, [visible]);

  // Build script entity_id and call it
  const sendCommand = useCallback(async () => {
    if (!callService) return;
    setSending(true);
    try {
      if (!isOn) {
        // Turn off: call script.aircon_off if exists, or a generic off script
        await callService('script', 'turn_on', { entity_id: 'script.aircon_off' });
      } else {
        // Pattern: script.aircon_{mode}_{temp}_{speed} for cool
        // or script.aircon_heat_{temp}_{speed} for heat
        let entityId;
        if (mode === 'heat') {
          entityId = `script.aircon_heat_${temp}_${speed}`;
        } else {
          entityId = `script.aircon_${temp}_${speed}_on`;
        }
        await callService('script', 'turn_on', { entity_id: entityId });
      }
    } catch (err) {
      console.error('AC command failed:', err);
    } finally {
      setSending(false);
    }
  }, [callService, isOn, mode, temp, speed]);

  // Auto-send when toggling on/off
  const handleToggle = useCallback(() => {
    const next = !isOn;
    setIsOn(next);
    // Defer command to next tick so state is updated
    setTimeout(async () => {
      if (!callService) return;
      setSending(true);
      try {
        if (!next) {
          await callService('script', 'turn_on', { entity_id: 'script.aircon_off' });
        } else {
          let entityId;
          if (mode === 'heat') {
            entityId = `script.aircon_heat_${temp}_${speed}`;
          } else {
            entityId = `script.aircon_${temp}_${speed}_on`;
          }
          await callService('script', 'turn_on', { entity_id: entityId });
        }
      } catch (err) {
        console.error('AC command failed:', err);
      } finally {
        setSending(false);
      }
    }, 0);
  }, [isOn, callService, mode, temp, speed]);

  // Send command when changing settings while AC is on
  useEffect(() => {
    if (isOn && !sending) {
      const timer = setTimeout(() => {
        sendCommand();
      }, 600);
      return () => clearTimeout(timer);
    }
  }, [mode, temp, speed]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!visible) return null;

  const modeIcon = mode === 'heat' ? FlameIcon : SnowflakeIcon;
  const ModeDisplayIcon = modeIcon;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 backdrop-blur-sm">
      <div
        ref={popupRef}
        className="bg-surf border border-bd rounded-2xl shadow-2xl w-[420px] max-h-[90vh] overflow-hidden
                   animate-popup-in"
        dir="rtl"
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 pt-4 pb-2">
          <div className="flex items-center gap-2">
            <ModeDisplayIcon className="w-6 h-6 text-acc2" />
            <span className="text-base font-semibold text-tp">{t.home.acControl}</span>
          </div>
          <button
            onClick={onClose}
            className="w-8 h-8 rounded-full flex items-center justify-center text-tm hover:bg-s2
                       transition-colors active:scale-90"
          >
            <CloseIcon className="w-4 h-4" />
          </button>
        </div>

        {/* Status bar */}
        <div className="px-5 pb-3">
          <div className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-medium
            ${isOn ? 'bg-acc2/15 text-acc2' : 'bg-s2 text-tm'}`}>
            <span className={`w-2 h-2 rounded-full ${isOn ? 'bg-acc2' : 'bg-tm'}`} />
            {isOn ? `${t.home.acOn} - ${temp}°C ${mode === 'heat' ? t.home.acHeat : t.home.acCool}` : t.home.acOff}
          </div>
        </div>

        {/* On/Off toggle */}
        <div className="px-5 pb-4">
          <button
            onClick={handleToggle}
            disabled={sending}
            className={`w-full flex items-center justify-center gap-2 py-3 rounded-xl font-medium text-sm
              transition-all duration-[var(--dur-fast)] active:scale-[0.98]
              ${isOn
                ? 'bg-coral/20 text-coral-d hover:bg-coral/30'
                : 'bg-acc2/15 text-acc2 hover:bg-acc2/25'
              }
              disabled:opacity-50`}
          >
            <PowerIcon className="w-5 h-5" />
            {sending ? t.home.acSending : (isOn ? t.home.acTurnOff : t.home.acTurnOn)}
          </button>
        </div>

        {/* Temperature selector (horizontal scroll) */}
        <div className="px-5 pb-4">
          <span className="text-xs font-semibold text-ts block mb-2">{t.home.acTemp}</span>
          <div
            ref={tempScrollRef}
            className="flex gap-1.5 overflow-x-auto pb-2 scrollbar-hide"
            style={{ scrollbarWidth: 'none' }}
          >
            {TEMPS.map((t_val) => (
              <button
                key={t_val}
                data-selected={temp === t_val}
                onClick={() => setTemp(t_val)}
                disabled={!isOn}
                className={`shrink-0 w-11 h-11 rounded-xl text-sm font-bold
                  transition-all duration-[var(--dur-fast)] active:scale-95
                  ${temp === t_val
                    ? 'bg-acc2 text-white shadow-sm'
                    : 'bg-s2 text-ts hover:bg-bd'
                  }
                  disabled:opacity-40 disabled:cursor-not-allowed`}
              >
                {t_val}°
              </button>
            ))}
          </div>
        </div>

        {/* Mode toggle */}
        <div className="px-5 pb-4">
          <span className="text-xs font-semibold text-ts block mb-2">{t.home.acMode}</span>
          <div className="flex gap-2">
            {MODES.map((m) => {
              const Icon = m.icon;
              return (
                <button
                  key={m.key}
                  onClick={() => setMode(m.key)}
                  disabled={!isOn}
                  className={`flex-1 flex items-center justify-center gap-2 py-2.5 rounded-xl text-sm font-medium
                    transition-all duration-[var(--dur-fast)] active:scale-95
                    ${mode === m.key
                      ? 'bg-acc2 text-white shadow-sm'
                      : 'bg-s2 text-ts hover:bg-bd'
                    }
                    disabled:opacity-40 disabled:cursor-not-allowed`}
                >
                  <Icon className="w-4 h-4" />
                  {m.label}
                </button>
              );
            })}
          </div>
        </div>

        {/* Fan speed */}
        <div className="px-5 pb-5">
          <span className="text-xs font-semibold text-ts block mb-2">{t.home.acFanSpeed}</span>
          <div className="flex gap-2">
            {SPEEDS.map((s) => (
              <button
                key={s.key}
                onClick={() => setSpeed(s.key)}
                disabled={!isOn}
                className={`flex-1 py-2.5 rounded-xl text-sm font-medium
                  transition-all duration-[var(--dur-fast)] active:scale-95
                  ${speed === s.key
                    ? 'bg-acc text-white shadow-sm'
                    : 'bg-s2 text-ts hover:bg-bd'
                  }
                  disabled:opacity-40 disabled:cursor-not-allowed`}
              >
                {s.label}
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
