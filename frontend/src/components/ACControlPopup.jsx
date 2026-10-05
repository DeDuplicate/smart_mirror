import { useState, useEffect, useRef, useCallback } from 'react';
import useStore from '../store/index.js';
import {
  acModes, acTemps, acFans, findAcPreset, acDefaultSelection, acSelectMode, acStepTemp,
} from '../hooks/homeModel.js';
import t from '../i18n/he.json';

// The popup offers exactly the presets Home Assistant has for this room (see
// GET /api/ha/ac-presets): the modes, the temperatures each mode has and the fan
// speeds for that combination. It used to guess script names from a temperature
// dial, so nearly every press called a script that did not exist.

// ─── Icons ─────────────────────────────────────────────────────────────────

function SnowflakeIcon({ className = 'w-5 h-5' }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
      strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden="true">
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
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
      strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden="true">
      <path d="M12 22c4-3.5 7-7.5 7-11a7 7 0 0 0-14 0c0 3.5 3 7.5 7 11z" />
      <path d="M12 22c-1.5-1.3-2.5-3-2.5-5a2.5 2.5 0 0 1 5 0c0 2-1 3.7-2.5 5z" />
    </svg>
  );
}

function CloseIcon({ className = 'w-5 h-5' }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
      strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden="true">
      <line x1="18" y1="6" x2="6" y2="18" />
      <line x1="6" y1="6" x2="18" y2="18" />
    </svg>
  );
}

function PowerIcon({ className = 'w-5 h-5' }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
      strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden="true">
      <path d="M18.36 6.64A9 9 0 1 1 5.64 6.64" />
      <line x1="12" y1="2" x2="12" y2="12" />
    </svg>
  );
}

function StepIcon({ up, className = 'w-6 h-6' }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
      strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden="true">
      <line x1="5" y1="12" x2="19" y2="12" />
      {up && <line x1="12" y1="5" x2="12" y2="19" />}
    </svg>
  );
}

// ─── Labels ────────────────────────────────────────────────────────────────

const MODE_LABEL = { cold: t.home.acCool, heat: t.home.acHeat };
const MODE_ICON = { cold: SnowflakeIcon, heat: FlameIcon };
const FAN_LABEL = { low: t.home.acFanLow, mid: t.home.acFanMid, high: t.home.acFanHigh, auto: t.home.auto };
const MONO = { fontFamily: "'DM Mono', monospace" };

const modeLabel = (mode) => MODE_LABEL[mode] || mode;
const fanLabel = (fan) => FAN_LABEL[fan] || fan;
const describe = (sel) => `${modeLabel(sel.mode)} ${sel.temp}° · ${fanLabel(sel.fan)}`;

// What was last sent from this screen. IR is one-way, so this is a memory of the
// press, not a reading of the air conditioner - the popup says so by wording it
// "last sent" and never "is on".
const lastKey = (remote) => `smartMirror.ac.last.${remote}`;
function readLast(remote) {
  try { return localStorage.getItem(lastKey(remote)) || ''; } catch { return ''; }
}
function writeLast(remote, text) {
  try { localStorage.setItem(lastKey(remote), text); } catch { /* private mode */ }
}

// ─── Segmented control ─────────────────────────────────────────────────────

function Segmented({ label, options, value, onChange }) {
  return (
    <div>
      <span className="block text-sm pt:text-base font-semibold text-ts mb-2 pt:mb-3">{label}</span>
      <div className="flex gap-2 pt:gap-3" role="radiogroup" aria-label={label}>
        {options.map((o) => {
          const selected = o.value === value;
          const Icon = o.icon;
          return (
            <button
              key={o.value}
              role="radio"
              aria-checked={selected}
              onClick={() => onChange(o.value)}
              className={`ripple flex-1 flex items-center justify-center gap-2 min-h-[56px] pt:min-h-[80px]
                          rounded-xl border text-base pt:text-xl font-medium
                          active:scale-95 transition-all duration-[var(--dur-fast)]
                          ${selected ? 'bg-acc text-white border-transparent' : 'bg-s2 text-tp border-bd hover:bg-bd'}`}
            >
              {Icon && <Icon className="w-5 h-5" />}
              {o.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}

// ─── ACControlPopup ───────────────────────────────────────────────────────

/**
 * `room` = { name, remote }; `presets` = that blaster's entry from
 * /api/ha/ac-presets: { off: 'script.x' | null, on: [{ mode, temp, fan, script }] }.
 */
export default function ACControlPopup({ visible, room, presets, onClose, callService }) {
  const addToast = useStore((s) => s.addToast);
  const popupRef = useRef(null);
  const sentTimerRef = useRef(null);

  const [sel, setSel] = useState(null);
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(null); // 'on' | 'off' for a moment after a press
  const [last, setLast] = useState('');

  // Start from the first preset HA has, and re-read what was last sent for this room.
  useEffect(() => {
    if (!visible || !room) return;
    setSel(acDefaultSelection(presets));
    setLast(readLast(room.remote));
    setSent(null);
  }, [visible, room, presets]);

  useEffect(() => () => clearTimeout(sentTimerRef.current), []);

  useEffect(() => {
    if (!visible) return undefined;
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [visible, onClose]);

  const send = useCallback(async (kind) => {
    const preset = kind === 'off' ? { script: presets?.off } : findAcPreset(presets, sel || {});
    if (!preset?.script || !callService) return;
    setSending(true);
    try {
      await callService('script', 'turn_on', { entity_id: preset.script });
      const text = kind === 'off' ? t.home.acOff : describe(sel);
      writeLast(room.remote, text);
      setLast(text);
      setSent(kind);
      clearTimeout(sentTimerRef.current);
      sentTimerRef.current = setTimeout(() => setSent(null), 1200);
    } catch {
      addToast('error', t.home.acSendFailed);
    } finally {
      setSending(false);
    }
  }, [presets, sel, callService, room, addToast]);

  if (!visible || !room) return null;

  const modes = acModes(presets);
  const temps = sel ? acTemps(presets, sel.mode) : [];
  const fans = sel ? acFans(presets, sel.mode, sel.temp) : [];
  const hasPresets = Boolean(sel);
  const hasOff = Boolean(presets?.off);
  const canStep = temps.length > 1;
  const idx = sel ? temps.indexOf(sel.temp) : -1;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div
        ref={popupRef}
        className="bg-surf border border-bd rounded-2xl shadow-modal w-[440px] pt:w-[760px] max-h-[92vh] overflow-y-auto
                   p-6 pt:p-10 flex flex-col gap-5 pt:gap-8 animate-popup-in"
        dir="rtl"
        role="dialog"
        aria-label={t.home.acRoomTitle.replace('{room}', room.name)}
      >
        {/* Header */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            {sel && (() => { const Icon = MODE_ICON[sel.mode] || SnowflakeIcon; return <Icon className="w-7 h-7 pt:w-9 pt:h-9 text-lav-d" />; })()}
            <h3 className="text-xl pt:text-3xl font-bold text-tp">{t.home.acRoomTitle.replace('{room}', room.name)}</h3>
          </div>
          <button
            onClick={onClose}
            aria-label={t.common.close}
            className="min-w-[56px] min-h-[56px] rounded-full flex items-center justify-center text-tm
                       hover:bg-s2 transition-colors active:scale-95"
          >
            <CloseIcon className="w-5 h-5" />
          </button>
        </div>

        {!hasPresets && (
          <p className="text-base pt:text-xl text-ts leading-relaxed">{t.home.acNoPresets}</p>
        )}

        {hasPresets && (
          <>
            {modes.length > 1 && (
              <Segmented
                label={t.home.acMode}
                value={sel.mode}
                onChange={(mode) => setSel(acSelectMode(presets, sel, mode))}
                options={modes.map((m) => ({ value: m, label: modeLabel(m), icon: MODE_ICON[m] }))}
              />
            )}

            {/* Temperature: a stepper only when this mode really has more than one */}
            <div>
              <span className="block text-sm pt:text-base font-semibold text-ts mb-2 pt:mb-3">{t.home.acTemp}</span>
              {/* dir=ltr: a stepper is a number line, colder on the left, like the gauges. */}
              <div dir="ltr" className="flex items-center justify-center gap-4 pt:gap-8">
                {canStep && (
                  <button
                    onClick={() => setSel(acStepTemp(presets, sel, -1))}
                    disabled={idx <= 0}
                    aria-label={t.home.acTempDown}
                    className="ripple min-w-[56px] min-h-[56px] pt:min-w-[88px] pt:min-h-[88px] rounded-full bg-s2 border border-bd
                               flex items-center justify-center text-tp active:scale-95 disabled:opacity-40
                               disabled:active:scale-100 transition-all duration-[var(--dur-fast)]"
                  >
                    <StepIcon />
                  </button>
                )}
                <div className="flex items-baseline tabular-nums text-tp" dir="ltr" style={MONO} aria-live="polite">
                  <span className="text-7xl pt:text-8xl font-medium leading-none">{sel.temp}</span>
                  <span className="text-3xl pt:text-5xl text-ts ms-1">°C</span>
                </div>
                {canStep && (
                  <button
                    onClick={() => setSel(acStepTemp(presets, sel, +1))}
                    disabled={idx >= temps.length - 1}
                    aria-label={t.home.acTempUp}
                    className="ripple min-w-[56px] min-h-[56px] pt:min-w-[88px] pt:min-h-[88px] rounded-full bg-s2 border border-bd
                               flex items-center justify-center text-tp active:scale-95 disabled:opacity-40
                               disabled:active:scale-100 transition-all duration-[var(--dur-fast)]"
                  >
                    <StepIcon up />
                  </button>
                )}
              </div>
              {!canStep && (
                <p className="text-xs pt:text-base text-tm text-center mt-2">{t.home.acOnlyTemp}</p>
              )}
            </div>

            {fans.length > 0 && (
              <Segmented
                label={t.home.acFanSpeed}
                value={sel.fan}
                onChange={(fan) => setSel({ ...sel, fan })}
                options={fans.map((f) => ({ value: f, label: fanLabel(f) }))}
              />
            )}
          </>
        )}

        {/* Actions */}
        <div className="flex gap-3 pt:gap-4">
          {hasPresets && (
            <button
              onClick={() => send('on')}
              disabled={sending}
              className={`ripple flex-1 flex items-center justify-center gap-2 min-h-[56px] pt:min-h-[88px] rounded-xl
                          text-base pt:text-xl font-semibold active:scale-95 disabled:opacity-50 disabled:active:scale-100
                          transition-colors duration-[var(--dur-fast)]
                          ${sent === 'on' ? 'bg-acc2 text-white' : 'bg-acc text-white hover:bg-acc/90'}`}
            >
              <PowerIcon />
              {sent === 'on' ? t.home.acSent : (sending ? t.home.acSending : t.home.acTurnOn)}
            </button>
          )}
          {hasOff && (
            <button
              onClick={() => send('off')}
              disabled={sending}
              className={`ripple flex-1 flex items-center justify-center gap-2 min-h-[56px] pt:min-h-[88px] rounded-xl
                          border text-base pt:text-xl font-semibold active:scale-95 disabled:opacity-50 disabled:active:scale-100
                          transition-colors duration-[var(--dur-fast)]
                          ${sent === 'off' ? 'bg-acc2 text-white border-transparent' : 'bg-coral-bg text-coral-d border-coral-d/50 hover:opacity-80'}`}
            >
              <PowerIcon />
              {sent === 'off' ? t.home.acSent : t.home.acTurnOff}
            </button>
          )}
        </div>

        {last && (
          <p className="text-sm pt:text-lg text-ts text-center -mt-1">
            {t.home.acLastSent.replace('{what}', last)}
          </p>
        )}
      </div>
    </div>
  );
}
