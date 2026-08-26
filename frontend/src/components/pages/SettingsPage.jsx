import { useState, useEffect, useCallback, useRef } from 'react';
import t from '../../i18n/he.json';
import useStore from '../../store/index.js';
import useSettings from '../../hooks/useSettings.js';
import useAuth from '../../hooks/useAuth.js';
import { fetchApi } from '../../hooks/useApi.js';
import WifiPopup from '../WifiPopup.jsx';
import OAuthOverlay from '../OAuthOverlay.jsx';

// ─── Icons ──────────────────────────────────────────────────────────────────

function PlusIcon({ className = 'w-4 h-4' }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"
      strokeLinecap="round" strokeLinejoin="round" className={className}>
      <line x1="12" y1="5" x2="12" y2="19" />
      <line x1="5" y1="12" x2="19" y2="12" />
    </svg>
  );
}

function TrashIcon({ className = 'w-4 h-4' }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
      strokeLinecap="round" strokeLinejoin="round" className={className}>
      <polyline points="3 6 5 6 21 6" />
      <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
      <path d="M10 11v6M14 11v6" />
      <path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2" />
    </svg>
  );
}

function LinkIcon({ className = 'w-4 h-4' }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
      strokeLinecap="round" strokeLinejoin="round" className={className}>
      <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
      <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
    </svg>
  );
}

function WifiIcon({ className = 'w-4 h-4' }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
      strokeLinecap="round" strokeLinejoin="round" className={className}>
      <path d="M5 12.55a11 11 0 0 1 14.08 0" />
      <path d="M1.42 9a16 16 0 0 1 21.16 0" />
      <path d="M8.53 16.11a6 6 0 0 1 6.95 0" />
      <line x1="12" y1="20" x2="12.01" y2="20" />
    </svg>
  );
}

function RefreshIcon({ className = 'w-4 h-4' }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
      strokeLinecap="round" strokeLinejoin="round" className={className}>
      <polyline points="23 4 23 10 17 10" />
      <polyline points="1 20 1 14 7 14" />
      <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15" />
    </svg>
  );
}

function PowerIcon({ className = 'w-4 h-4' }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
      strokeLinecap="round" strokeLinejoin="round" className={className}>
      <path d="M18.36 6.64a9 9 0 1 1-12.73 0" />
      <line x1="12" y1="2" x2="12" y2="12" />
    </svg>
  );
}

function SaveIcon({ className = 'w-4 h-4' }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
      strokeLinecap="round" strokeLinejoin="round" className={className}>
      <path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z" />
      <polyline points="17 21 17 13 7 13 7 21" />
      <polyline points="7 3 7 8 15 8" />
    </svg>
  );
}

function Spinner({ className = 'w-4 h-4' }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" className={`${className} animate-spin`}>
      <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" opacity="0.25" />
      <path d="M12 2a10 10 0 0 1 10 10" stroke="currentColor" strokeWidth="3"
        strokeLinecap="round" />
    </svg>
  );
}

function UploadIcon({ className = 'w-4 h-4' }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
      strokeLinecap="round" strokeLinejoin="round" className={className}>
      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
      <polyline points="17 8 12 3 7 8" />
      <line x1="12" y1="3" x2="12" y2="15" />
    </svg>
  );
}

// ─── Shared UI Primitives ────────────────────────────────────────────────────

/** Section card wrapper */
function Section({ title, children }) {
  return (
    <div className="bg-surf border border-bd rounded-2xl p-6 mb-4">
      <h2 className="text-lg font-semibold text-tp mb-4">{title}</h2>
      {children}
    </div>
  );
}

/** Labelled text / password input */
function InputRow({ label, type = 'text', placeholder = '', value, onChange, className = '' }) {
  return (
    <div className={`flex flex-col gap-1.5 ${className}`}>
      {label && <label className="text-sm font-medium text-ts">{label}</label>}
      <input
        type={type}
        placeholder={placeholder}
        value={value}
        onChange={onChange}
        className="bg-s2 border border-bd rounded-xl p-3 text-tp text-sm
                   placeholder:text-tm focus:outline-none focus:border-acc
                   transition-colors duration-[var(--dur-fast)] w-full"
        dir="auto"
      />
    </div>
  );
}

/** Labelled select */
function SelectRow({ label, value, onChange, options, className = '' }) {
  return (
    <div className={`flex flex-col gap-1.5 ${className}`}>
      {label && <label className="text-sm font-medium text-ts">{label}</label>}
      <div className="relative">
        <select
          value={value}
          onChange={onChange}
          className="bg-s2 border border-bd rounded-xl p-3 text-tp text-sm
                     focus:outline-none focus:border-acc appearance-none
                     transition-colors duration-[var(--dur-fast)] w-full pe-8"
        >
          {options.map((o) => (
            <option key={o.value} value={o.value}>{o.label}</option>
          ))}
        </select>
        {/* Chevron indicator */}
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
          className="absolute end-3 top-1/2 -translate-y-1/2 w-4 h-4 text-tm pointer-events-none">
          <polyline points="6 9 12 15 18 9" />
        </svg>
      </div>
    </div>
  );
}

/** Toggle switch row (label left, switch right) */
function ToggleRow({ label, checked, onChange }) {
  return (
    <div className="flex items-center justify-between py-2.5">
      <span className="text-sm text-tp">{label}</span>
      <button
        role="switch"
        aria-checked={checked}
        onClick={() => onChange(!checked)}
        className={`relative w-12 h-6 rounded-full shrink-0 transition-colors
                    duration-[var(--dur-fast)] focus:outline-none
                    ${checked ? 'bg-acc' : 'bg-bd'}`}
      >
        <span
          className={`absolute top-0.5 w-5 h-5 rounded-full bg-white shadow-card
                      transition-transform duration-[var(--dur-fast)]
                      ${checked ? 'translate-x-[-26px]' : 'translate-x-[-2px]'}`}
          style={{ right: 0 }}
        />
      </button>
    </div>
  );
}

/** Slider with current value readout */
function SliderRow({ label, min, max, step = 1, value, onChange, unit = '' }) {
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between">
        <label className="text-sm font-medium text-ts">{label}</label>
        <span className="text-sm text-tp font-semibold tabular-nums">
          {value}{unit}
        </span>
      </div>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={onChange}
        style={{ direction: 'ltr' }}
        className="w-full h-2 rounded-full bg-bd appearance-none cursor-pointer
                   [&::-webkit-slider-thumb]:appearance-none
                   [&::-webkit-slider-thumb]:w-5
                   [&::-webkit-slider-thumb]:h-5
                   [&::-webkit-slider-thumb]:rounded-full
                   [&::-webkit-slider-thumb]:bg-acc
                   [&::-webkit-slider-thumb]:shadow-card
                   [&::-webkit-slider-thumb]:cursor-pointer"
      />
    </div>
  );
}

/** Generic action button */
function Btn({ onClick, children, variant = 'default', icon, className = '', disabled = false }) {
  const variants = {
    default:  'bg-s2 text-ts border border-bd hover:bg-bd',
    primary:  'bg-acc text-white hover:bg-acc/90',
    danger:   'bg-coral/20 text-coral-d hover:bg-coral/40',
    success:  'bg-mint/30 text-mint-d hover:bg-mint/60',
  };
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={`ripple inline-flex items-center gap-2 px-4 min-h-[44px] rounded-xl
                  font-medium text-sm active:scale-95 transition-all duration-[var(--dur-fast)]
                  disabled:opacity-50 disabled:active:scale-100
                  ${variants[variant]} ${className}`}
    >
      {icon}
      {children}
    </button>
  );
}

// ─── Debounce helper for settings saves ─────────────────────────────────────

function useDebouncedSave(updateSettings, delay = 800) {
  const timerRef = useRef(null);

  return useCallback(
    (obj) => {
      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = setTimeout(() => {
        updateSettings(obj);
      }, delay);
    },
    [updateSettings, delay]
  );
}

// ─── Section: Profile ────────────────────────────────────────────────────────

function ProfileSection() {
  const { settings, updateSettings } = useSettings();
  const { setSettings } = useStore();
  const debouncedSave = useDebouncedSave(updateSettings);

  const greetingStyle = settings.greetingStyle || 'casual';

  return (
    <Section title={t.settings.profile}>
      <div className="flex flex-col gap-4">
        <InputRow
          label={t.settings.name}
          placeholder={t.settings.namePlaceholder}
          value={settings.userName || ''}
          onChange={(e) => {
            setSettings({ userName: e.target.value });
            debouncedSave({ userName: e.target.value });
          }}
        />
        <SelectRow
          label={t.settings.greetingStyle}
          value={greetingStyle}
          onChange={(e) => {
            setSettings({ greetingStyle: e.target.value });
            updateSettings({ greetingStyle: e.target.value });
          }}
          options={[
            { value: 'casual',  label: t.settings.greetingCasual },
            { value: 'formal',  label: t.settings.greetingFormal },
          ]}
        />
      </div>
    </Section>
  );
}

// ─── Section: Location ───────────────────────────────────────────────────────

function SearchIcon({ className = 'w-4 h-4' }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
      strokeLinecap="round" strokeLinejoin="round" className={className}>
      <circle cx="11" cy="11" r="8" />
      <line x1="21" y1="21" x2="16.65" y2="16.65" />
    </svg>
  );
}

function PinIcon({ className = 'w-4 h-4' }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
      strokeLinecap="round" strokeLinejoin="round" className={className}>
      <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z" />
      <circle cx="12" cy="10" r="3" />
    </svg>
  );
}

/** City search-as-you-type with a results dropdown, backed by the Open-Meteo
 * geocoding proxy at /api/weather/geocode. Selecting a result saves
 * location + latitude + longitude together so weather always matches what
 * the user actually picked (previously the free-text "city" field did
 * nothing — weather only ever read latitude/longitude, which had to be
 * hand-entered separately with no way to verify they matched the city). */
function CitySearchBox({ onSelect }) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState([]);
  const [searching, setSearching] = useState(false);
  const [open, setOpen] = useState(false);
  const debounceRef = useRef(null);
  const boxRef = useRef(null);

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    const trimmed = query.trim();
    if (trimmed.length < 2) {
      setResults([]);
      setSearching(false);
      return;
    }
    setSearching(true);
    debounceRef.current = setTimeout(async () => {
      try {
        const data = await fetchApi(`/api/weather/geocode?q=${encodeURIComponent(trimmed)}`);
        setResults(data?.results || []);
      } catch {
        setResults([]);
      } finally {
        setSearching(false);
      }
    }, 400);
    return () => clearTimeout(debounceRef.current);
  }, [query]);

  // Close dropdown on click outside
  useEffect(() => {
    if (!open) return;
    function handleClick(e) {
      if (boxRef.current && !boxRef.current.contains(e.target)) setOpen(false);
    }
    document.addEventListener('pointerdown', handleClick);
    return () => document.removeEventListener('pointerdown', handleClick);
  }, [open]);

  return (
    <div ref={boxRef} className="relative flex flex-col gap-1.5">
      <label className="text-sm font-medium text-ts">{t.settings.city}</label>
      <div className="relative">
        <input
          type="text"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          placeholder={t.settings.citySearchPlaceholder}
          className="bg-s2 border border-bd rounded-xl p-3 ps-10 text-tp text-sm
                     placeholder:text-tm focus:outline-none focus:border-acc
                     transition-colors duration-[var(--dur-fast)] w-full"
          dir="auto"
        />
        <SearchIcon className="absolute start-3 top-1/2 -translate-y-1/2 w-4 h-4 text-tm pointer-events-none" />
      </div>

      {open && (searching || results.length > 0 || query.trim().length >= 2) && (
        <div className="absolute top-full inset-x-0 mt-1 z-10 bg-surf border border-bd rounded-xl
                        shadow-popover max-h-64 overflow-y-auto">
          {searching ? (
            <div className="px-4 py-3 text-sm text-tm">{t.settings.citySearching}</div>
          ) : results.length === 0 ? (
            <div className="px-4 py-3 text-sm text-tm">{t.settings.cityNoResults}</div>
          ) : (
            results.map((r) => (
              <button
                key={r.id}
                onClick={() => {
                  onSelect(r);
                  setQuery('');
                  setResults([]);
                  setOpen(false);
                }}
                className="w-full flex items-center gap-3 px-4 py-2.5 text-right hover:bg-s2
                           transition-colors active:scale-[0.98]"
              >
                <PinIcon className="w-4 h-4 text-acc shrink-0" />
                <div className="flex flex-col min-w-0">
                  <span className="text-sm text-tp truncate">{r.name}</span>
                  <span className="text-xs text-tm truncate">
                    {[r.admin1, r.country].filter(Boolean).join(', ')}
                  </span>
                </div>
              </button>
            ))
          )}
        </div>
      )}
    </div>
  );
}

function LocationSection() {
  const { settings, updateSettings } = useSettings();
  const { setSettings, addToast } = useStore();
  const debouncedSave = useDebouncedSave(updateSettings);

  const hasCoords = settings.latitude && settings.longitude;

  const handleSelectCity = useCallback((r) => {
    const patch = {
      location: r.name,
      locationAdmin: r.admin1 || '',
      locationCountry: r.country || '',
      latitude: r.latitude,
      longitude: r.longitude,
    };
    setSettings(patch);
    updateSettings(patch);
    addToast('success', `${t.settings.citySelected}: ${r.name}`);
  }, [setSettings, updateSettings, addToast]);

  return (
    <Section title={t.settings.location}>
      <div className="flex flex-col gap-4">
        <CitySearchBox onSelect={handleSelectCity} />

        {/* Clear confirmation of what's currently configured, so the user
            can verify the picker resolved the correct city. */}
        <div className={`flex items-center gap-3 px-4 py-3 rounded-xl border
                          ${hasCoords ? 'bg-[var(--mint-bg)] border-transparent' : 'bg-s2 border-bd'}`}>
          <PinIcon className={`w-5 h-5 shrink-0 ${hasCoords ? 'text-[var(--mint-d)]' : 'text-tm'}`} />
          {hasCoords ? (
            <div className="flex flex-col min-w-0">
              <span className="text-xs text-tm">{t.settings.cityCurrentlySet}</span>
              <span className="text-sm font-semibold text-tp truncate">
                {settings.location}
                {(settings.locationAdmin || settings.locationCountry) && (
                  <span className="font-normal text-ts">
                    {' — '}
                    {[settings.locationAdmin, settings.locationCountry].filter(Boolean).join(', ')}
                  </span>
                )}
              </span>
              <span className="text-xs text-tm tabular-nums" style={{ direction: 'ltr', textAlign: 'right' }}>
                {Number(settings.latitude).toFixed(4)}, {Number(settings.longitude).toFixed(4)}
              </span>
            </div>
          ) : (
            <span className="text-sm text-tm">{t.settings.cityNotSet}</span>
          )}
        </div>

        <div className="flex gap-3">
          <InputRow
            label={t.settings.latitude}
            placeholder="31.7683"
            value={settings.latitude || ''}
            onChange={(e) => {
              setSettings({ latitude: e.target.value });
              debouncedSave({ latitude: e.target.value });
            }}
            className="flex-1"
          />
          <InputRow
            label={t.settings.longitude}
            placeholder="35.2137"
            value={settings.longitude || ''}
            onChange={(e) => {
              setSettings({ longitude: e.target.value });
              debouncedSave({ longitude: e.target.value });
            }}
            className="flex-1"
          />
        </div>
        <span className="text-xs text-tm -mt-2">{t.settings.cityCoordsHint}</span>
      </div>
    </Section>
  );
}


// ─── Section: ICS Calendar URLs ─────────────────────────────────────────────

const ICS_COLOR_OPTIONS = [
  { value: 'mint',  label: t.calendarColors.mint,     hex: '#2a9d7f' },
  { value: 'lav',   label: t.calendarColors.lavender,  hex: '#5b52cc' },
  { value: 'coral', label: t.calendarColors.coral,     hex: '#c95454' },
  { value: 'gold',  label: t.calendarColors.gold,      hex: '#b07c10' },
];

function IcsCalendarSection() {
  const { settings, updateSettings } = useSettings();
  const { setSettings } = useStore();
  const addToast = useStore((s) => s.addToast);

  const [newUrl, setNewUrl] = useState('');
  const [newName, setNewName] = useState('');
  const [newColor, setNewColor] = useState('mint');

  const icsUrls = Array.isArray(settings.calendarIcsUrls) ? settings.calendarIcsUrls : [];

  const handleAdd = useCallback(() => {
    if (!newUrl.trim()) {
      addToast('warning', t.settings.calendarUrlRequired);
      return;
    }
    const entry = {
      url: newUrl.trim(),
      name: newName.trim() || 'Calendar',
      color: newColor,
      id: 'ics_' + Date.now(),
    };
    const updated = [...icsUrls, entry];
    setSettings({ calendarIcsUrls: updated });
    updateSettings({ calendarIcsUrls: updated });
    setNewUrl('');
    setNewName('');
    setNewColor('mint');
    addToast('success', t.settings.calendarAdded);
  }, [newUrl, newName, newColor, icsUrls, setSettings, updateSettings, addToast]);

  const handleRemove = useCallback(
    (id) => {
      const updated = icsUrls.filter((c) => c.id !== id);
      setSettings({ calendarIcsUrls: updated });
      updateSettings({ calendarIcsUrls: updated });
      addToast('success', t.settings.calendarRemoved);
    },
    [icsUrls, setSettings, updateSettings, addToast]
  );

  return (
    <Section title={t.settings.calendarUrls}>
      <div className="flex flex-col gap-4">
        {/* Instructions */}
        <p className="text-xs text-[var(--tm)] leading-relaxed">
          {t.settings.calendarIcsInstructions}
        </p>

        {/* Add form */}
        <div className="flex flex-col gap-3 p-4 bg-[var(--s2)] border border-[var(--bd)] rounded-xl">
          <input
            type="url"
            value={newUrl}
            onChange={(e) => setNewUrl(e.target.value)}
            placeholder={t.settings.calendarUrlPlaceholder}
            className="w-full h-11 px-4 rounded-xl bg-[var(--bg)] border border-[var(--bd)] text-[var(--tp)] text-sm
                       placeholder:text-[var(--tm)] focus:outline-none focus:border-[var(--acc)]"
            dir="ltr"
          />
          <div className="flex gap-3">
            <input
              type="text"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              placeholder={t.settings.calendarNamePlaceholder}
              className="flex-1 h-11 px-4 rounded-xl bg-[var(--bg)] border border-[var(--bd)] text-[var(--tp)] text-sm
                         placeholder:text-[var(--tm)] focus:outline-none focus:border-[var(--acc)]"
              dir="rtl"
            />
            {/* Color picker as colored buttons */}
            <div className="flex items-center gap-1.5 shrink-0">
              {ICS_COLOR_OPTIONS.map((c) => (
                <button
                  key={c.value}
                  onClick={() => setNewColor(c.value)}
                  title={c.label}
                  className={`w-8 h-8 rounded-full border-2 transition-all duration-150
                              ${newColor === c.value
                                ? 'border-[var(--tp)] scale-110'
                                : 'border-transparent opacity-60 hover:opacity-100'}`}
                  style={{ backgroundColor: c.hex }}
                />
              ))}
            </div>
          </div>
          <Btn variant="primary" onClick={handleAdd} disabled={!newUrl.trim()}>
            <PlusIcon className="w-4 h-4" />
            {t.settings.addCalendarUrl}
          </Btn>
        </div>

        {/* List of configured calendars */}
        {icsUrls.length === 0 ? (
          <p className="text-sm text-[var(--tm)]">{t.settings.noCalendarsConfigured}</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {icsUrls.map((cal) => {
              const colorHex = ICS_COLOR_OPTIONS.find((c) => c.value === cal.color)?.hex || '#888';
              return (
                <li
                  key={cal.id}
                  className="flex items-center gap-3 bg-[var(--s2)] border border-[var(--bd)] rounded-xl px-4 py-3"
                >
                  <div
                    className="w-3 h-3 rounded-full shrink-0"
                    style={{ backgroundColor: colorHex }}
                  />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-[var(--tp)] truncate">{cal.name}</p>
                    <p className="text-xs text-[var(--tm)] truncate" dir="ltr">{cal.url}</p>
                  </div>
                  <Btn variant="danger" icon={<TrashIcon />} onClick={() => handleRemove(cal.id)}>
                    {t.settings.removeCalendar}
                  </Btn>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </Section>
  );
}

// ─── Section: Home Assistant ─────────────────────────────────────────────────

function HomeAssistantSection() {
  const { settings, updateSettings } = useSettings();
  const { setSettings } = useStore();
  const addToast = useStore((s) => s.addToast);
  const [testing, setTesting] = useState(false);
  const debouncedSave = useDebouncedSave(updateSettings);

  const handleTest = useCallback(async () => {
    setTesting(true);
    try {
      await fetchApi('/api/ha/states');
      addToast('success', t.settings.haConnectionOk);
    } catch {
      addToast('error', t.settings.haConnectionFail);
    } finally {
      setTesting(false);
    }
  }, [addToast]);

  return (
    <Section title={t.settings.smartHome}>
      <div className="flex flex-col gap-4">
        <InputRow
          label={t.settings.haUrl}
          placeholder="http://homeassistant.local:8123"
          value={settings.haHost || ''}
          onChange={(e) => {
            setSettings({ haHost: e.target.value });
            debouncedSave({ haHost: e.target.value });
          }}
        />
        <InputRow
          label={t.settings.haToken}
          type="password"
          placeholder="eyJ..."
          value={settings.haToken || ''}
          onChange={(e) => {
            setSettings({ haToken: e.target.value });
            debouncedSave({ haToken: e.target.value });
          }}
        />
        <Btn icon={testing ? <Spinner /> : <LinkIcon />} onClick={handleTest} disabled={testing}>
          {t.settings.testConnection}
        </Btn>
      </div>
    </Section>
  );
}

// ─── Section: Spotify ────────────────────────────────────────────────────────

function SpotifySection() {
  return (
    <Section title={t.settings.spotify}>
      <div className="flex items-start gap-3 bg-s2 border border-bd rounded-xl px-4 py-4">
        <div
          className="w-12 h-12 rounded-full flex items-center justify-center shrink-0"
          style={{ backgroundColor: 'var(--mint-bg)' }}
        >
          <svg viewBox="0 0 24 24" fill="currentColor" className="w-6 h-6" style={{ color: 'var(--mint-d)' }}>
            <path d="M12 3v10.55A4 4 0 1 0 14 17V7h4V3h-6z" />
          </svg>
        </div>
        <div className="flex flex-col gap-1 min-w-0">
          <p className="text-sm font-medium text-tp">{t.music.youtubeMusic}</p>
          <p className="text-xs text-ts leading-relaxed">{t.settings.spotifySetupHint}</p>
        </div>
      </div>
    </Section>
  );
}

// ─── Section: News ───────────────────────────────────────────────────────────

function NewsSection() {
  const { settings, updateSettings } = useSettings();
  const addToast = useStore((s) => s.addToast);
  const [catalog, setCatalog] = useState(null); // null = loading; [{id, name, category}] from backend
  const [loadError, setLoadError] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetchApi('/api/news/sources')
      .then((res) => {
        if (cancelled) return;
        setCatalog(Array.isArray(res?.sources) ? res.sources : []);
      })
      .catch(() => {
        if (cancelled) return;
        setCatalog([]);
        setLoadError(true);
      });
    return () => { cancelled = true; };
  }, []);

  // Selected source ids: settings.news_sources (array) is authoritative —
  // the exact config key backend/routes/news.js's resolveSources() reads.
  // Unset/empty means ALL sources on (same default as the backend); the
  // explicit id list is persisted in full, including when all are selected.
  const allIds = (catalog || []).map((s) => s.id);
  const saved = Array.isArray(settings.news_sources) ? settings.news_sources : [];
  const selected = saved.length > 0 ? allIds.filter((id) => saved.includes(id)) : allIds;

  const toggleSource = useCallback((id) => {
    const isOn = selected.includes(id);
    // An empty array means "all on" to the backend, so the last selected
    // source can't be turned off — at least one source must stay selected.
    if (isOn && selected.length === 1) {
      addToast('error', t.settings.newsSourcesEmptyError);
      return;
    }
    const next = isOn ? selected.filter((s) => s !== id) : [...selected, id];
    updateSettings({ news_sources: next });
  }, [selected, updateSettings, addToast]);

  const categoryLabel = (category) =>
    (category && t.news.categories[category]) || t.news.categories.news;

  return (
    <Section title={t.settings.news}>
      <p className="text-xs text-tm mb-3">{t.settings.newsSourcesDesc}</p>
      {catalog === null && (
        <div className="flex flex-col gap-2">
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="skeleton h-14 w-full rounded-xl" />
          ))}
        </div>
      )}
      {catalog !== null && loadError && (
        <p className="text-sm text-coral-d">{t.settings.newsSourcesLoadError}</p>
      )}
      {catalog !== null && !loadError && (
        <div className="flex flex-col gap-2">
          {catalog.map((src) => {
            const isOn = selected.includes(src.id);
            return (
              <button
                key={src.id}
                role="checkbox"
                aria-checked={isOn}
                onClick={() => toggleSource(src.id)}
                className={`flex items-center gap-3 min-h-[56px] px-4 rounded-xl border
                            transition-all duration-[var(--dur-fast)] active:scale-95
                            ${isOn
                              ? 'border-acc bg-s2 shadow-card'
                              : 'border-bd bg-s2'}`}
              >
                <span
                  className={`w-6 h-6 rounded-full flex items-center justify-center shrink-0
                              transition-colors duration-[var(--dur-fast)]
                              ${isOn ? 'bg-acc' : 'border-2 border-bd'}`}
                >
                  {isOn && (
                    <svg viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.5"
                      strokeLinecap="round" strokeLinejoin="round" className="w-3.5 h-3.5">
                      <polyline points="20 6 9 17 4 12" />
                    </svg>
                  )}
                </span>
                <span className="flex-1 text-start text-sm font-medium text-tp">{src.name}</span>
                <span className="text-xs text-tm">{categoryLabel(src.category)}</span>
              </button>
            );
          })}
        </div>
      )}
    </Section>
  );
}

// ─── Section: Family / Chores People ────────────────────────────────────────

const PERSON_COLORS = ['#2a9d7f', '#5b52cc', '#c95454', '#b07c10', '#e06262', '#4a90d9', '#7b61ff', '#d4a017'];

function FamilySection() {
  const [people, setPeople] = useState([]);
  const [newName, setNewName] = useState('');
  const addToast = useStore((s) => s.addToast);

  // Persist to both localStorage (so the Chores tab's sync seed converges)
  // and the backend DB (source of truth for chores).
  const persistLocal = useCallback((updated) => {
    try { localStorage.setItem('chores_people', JSON.stringify(updated)); } catch { /* ignore */ }
  }, []);

  // Initial load: seed from localStorage if present, otherwise read the DB.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const stored = JSON.parse(localStorage.getItem('chores_people') || '[]');
        if (stored.length > 0) {
          const syncParam = encodeURIComponent(JSON.stringify(
            stored.map((p) => ({ id: p.id, name: p.name, color: p.color }))
          ));
          const data = await fetchApi(`/api/tasks/people?sync=${syncParam}`);
          if (!cancelled) setPeople(data.map(({ id, name, color }) => ({ id, name, color })));
        } else {
          const data = await fetchApi('/api/tasks/people');
          if (!cancelled) {
            const mapped = data.map(({ id, name, color }) => ({ id, name, color }));
            setPeople(mapped);
            persistLocal(mapped);
          }
        }
      } catch { /* keep whatever we have */ }
    })();
    return () => { cancelled = true; };
  }, [persistLocal]);

  const addPerson = useCallback(async () => {
    if (!newName.trim()) return;
    const color = PERSON_COLORS[people.length % PERSON_COLORS.length];
    try {
      const created = await fetchApi('/api/tasks/people', {
        method: 'POST',
        body: JSON.stringify({ name: newName.trim(), color }),
      });
      const updated = [...people, { id: created.id, name: created.name, color: created.color }];
      setPeople(updated);
      persistLocal(updated);
      setNewName('');
      addToast('success', `${created.name} נוסף/ה`);
    } catch {
      addToast('error', 'שמירת בן המשפחה נכשלה');
    }
  }, [newName, people, persistLocal, addToast]);

  const removePerson = useCallback(async (id) => {
    const updated = people.filter(p => p.id !== id);
    setPeople(updated);
    persistLocal(updated);
    try {
      await fetchApi(`/api/tasks/people/${id}`, { method: 'DELETE' });
    } catch {
      addToast('error', 'מחיקת בן המשפחה נכשלה');
    }
  }, [people, persistLocal, addToast]);

  return (
    <Section title="בני המשפחה (מטלות)">
      <p className="text-xs text-[var(--tm)] mb-3">הוסף את בני המשפחה שיופיעו בלשונית מטלות</p>

      {/* Current people list */}
      <div className="flex flex-col gap-2 mb-4">
        {people.map((p) => (
          <div key={p.id} className="flex items-center gap-3 p-2 rounded-xl bg-[var(--s2)]">
            <div
              className="w-10 h-10 rounded-full flex items-center justify-center text-white font-bold text-sm shrink-0"
              style={{ backgroundColor: p.color }}
            >
              {p.name.charAt(0)}
            </div>
            <span className="flex-1 text-sm font-medium text-[var(--tp)]">{p.name}</span>
            <div
              className="w-4 h-4 rounded-full"
              style={{ backgroundColor: p.color }}
              title={p.color}
            />
            <button
              onClick={() => removePerson(p.id)}
              className="text-[var(--tm)] hover:text-[var(--coral-d)] transition-colors p-1"
            >
              <TrashIcon />
            </button>
          </div>
        ))}
        {people.length === 0 && (
          <p className="text-sm text-[var(--tm)] text-center py-3">אין בני משפחה — הוסף אחד למטה</p>
        )}
      </div>

      {/* Add new person */}
      <div className="flex gap-2">
        <input
          type="text"
          value={newName}
          onChange={(e) => setNewName(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && addPerson()}
          placeholder="שם..."
          className="flex-1 h-11 px-4 rounded-xl bg-[var(--s2)] border border-[var(--bd)] text-[var(--tp)] text-sm placeholder:text-[var(--tm)] focus:outline-none focus:border-[var(--acc)]"
          dir="rtl"
        />
        <Btn variant="primary" onClick={addPerson} disabled={!newName.trim()}>
          <PlusIcon className="w-4 h-4" />
          הוסף
        </Btn>
      </div>
    </Section>
  );
}

// ─── Section: Tasks ──────────────────────────────────────────────────────────

function TasksSection() {
  const { settings, updateSettings } = useSettings();
  const { setSettings } = useStore();
  const debouncedSave = useDebouncedSave(updateSettings);

  const col1 = settings.taskCol1 || t.tasks.todo;
  const col2 = settings.taskCol2 || t.tasks.inProgress;
  const col3 = settings.taskCol3 || t.tasks.done;

  return (
    <Section title={t.settings.tasks}>
      <div className="flex flex-col gap-4">
        <p className="text-sm font-medium text-ts -mb-1">{t.settings.columnNames}</p>
        <div className="flex gap-3">
          <InputRow
            label="1"
            value={col1}
            onChange={(e) => {
              setSettings({ taskCol1: e.target.value });
              debouncedSave({ taskCol1: e.target.value });
            }}
            className="flex-1"
          />
          <InputRow
            label="2"
            value={col2}
            onChange={(e) => {
              setSettings({ taskCol2: e.target.value });
              debouncedSave({ taskCol2: e.target.value });
            }}
            className="flex-1"
          />
          <InputRow
            label="3"
            value={col3}
            onChange={(e) => {
              setSettings({ taskCol3: e.target.value });
              debouncedSave({ taskCol3: e.target.value });
            }}
            className="flex-1"
          />
        </div>
      </div>
    </Section>
  );
}

// ─── Section: Display ────────────────────────────────────────────────────────

function DisplaySection() {
  const { settings, updateSettings } = useSettings();
  const { setSettings, setThemeMode } = useStore();

  const idleMin = settings.idleTimeout || 5;
  const brightness = settings.brightnessDefault || 80;
  const screensaver = settings.screensaverStyle || 'clock';
  const hebrewCal = settings.hebrewCalendar === true;

  return (
    <Section title={t.settings.display}>
      <div className="flex flex-col gap-5">
        <SliderRow
          label={t.settings.idleTimeout}
          min={1} max={30}
          value={idleMin}
          onChange={(e) => {
            const val = Number(e.target.value);
            setSettings({ idleTimeout: val });
            updateSettings({ idleTimeout: val });
          }}
          unit={` ${t.settings.idleTimeoutMin}`}
        />
        <SliderRow
          label={t.settings.brightness}
          min={10} max={100} step={5}
          value={brightness}
          onChange={(e) => {
            const val = Number(e.target.value);
            setSettings({ brightnessDefault: val });
            updateSettings({ brightnessDefault: val });
          }}
          unit="%"
        />
        <SelectRow
          label={t.settings.screensaverStyle}
          value={screensaver}
          onChange={(e) => {
            setSettings({ screensaverStyle: e.target.value });
            updateSettings({ screensaverStyle: e.target.value });
          }}
          options={[
            { value: 'clock',     label: t.settings.screensaverClock },
            { value: 'slideshow', label: t.settings.screensaverSlideshow },
          ]}
        />

        <div className="flex flex-col divide-y divide-bd">
          {/* Temperature unit toggle — segmented control */}
          <div className="flex items-center justify-between py-2.5">
            <span className="text-sm text-tp">{t.settings.temperatureUnit}</span>
            <div className="flex items-center gap-1 bg-s2 border border-bd rounded-xl p-1">
              {['celsius', 'fahrenheit'].map((unit) => (
                <button
                  key={unit}
                  onClick={() => {
                    setSettings({ temperatureUnit: unit });
                    updateSettings({ temperatureUnit: unit });
                  }}
                  className={`px-3 py-1.5 rounded-full text-sm font-medium transition-all
                               duration-[var(--dur-fast)]
                               ${settings.temperatureUnit === unit
                                 ? 'bg-acc text-white shadow-card'
                                 : 'text-ts hover:text-tp'}`}
                >
                  {unit === 'celsius' ? t.weather.celsius : t.weather.fahrenheit}
                </button>
              ))}
            </div>
          </div>

          {/* Weather source toggle — segmented control */}
          <div className="flex items-center justify-between py-2.5">
            <span className="text-sm text-tp">{t.settings.weatherSource}</span>
            <div className="flex items-center gap-1 bg-s2 border border-bd rounded-xl p-1">
              {[
                { value: 'openmeteo', label: t.settings.weatherOpenMeteo },
                { value: 'ims', label: t.settings.weatherIMS },
              ].map((src) => (
                <button
                  key={src.value}
                  onClick={() => {
                    setSettings({ weatherSource: src.value });
                    updateSettings({ weatherSource: src.value });
                  }}
                  className={`px-3 py-1.5 rounded-full text-sm font-medium transition-all
                               duration-[var(--dur-fast)]
                               ${(settings.weatherSource || 'openmeteo') === src.value
                                 ? 'bg-acc text-white shadow-card'
                                 : 'text-ts hover:text-tp'}`}
                >
                  {src.label}
                </button>
              ))}
            </div>
          </div>

          <ToggleRow
            label={t.settings.showWeekend}
            checked={settings.showWeekend !== false}
            onChange={(val) => {
              setSettings({ showWeekend: val });
              updateSettings({ showWeekend: val });
            }}
          />
          <ToggleRow
            label={t.settings.hebrewCalendar}
            checked={hebrewCal}
            onChange={(val) => {
              setSettings({ hebrewCalendar: val });
              updateSettings({ hebrewCalendar: val });
            }}
          />
          <div className="flex items-center justify-between py-2.5">
            <div className="flex flex-col gap-0.5">
              <span className="text-sm text-tp">{t.settings.themeCycle}</span>
              <span className="text-xs text-tm">{t.settings.themeAutoHint}</span>
            </div>
            <div className="flex items-center gap-1 bg-s2 border border-bd rounded-xl p-1">
              {[
                { value: 'auto', label: t.settings.themeAuto },
                { value: 'light', label: t.settings.lightMode },
                { value: 'dark', label: t.settings.darkMode },
              ].map((opt) => (
                <button
                  key={opt.value}
                  onClick={() => {
                    setThemeMode(opt.value);
                    updateSettings({ themeMode: opt.value });
                  }}
                  className={`px-3 min-h-[44px] rounded-xl text-sm font-medium transition-all
                               duration-[var(--dur-fast)] active:scale-95
                               ${(settings.themeMode || 'auto') === opt.value
                                 ? 'bg-acc text-white shadow-card'
                                 : 'text-ts hover:text-tp'}`}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>
    </Section>
  );
}

// ─── Section: System ─────────────────────────────────────────────────────────

// Poll the health endpoint until the backend responds again (used after an
// update, where PM2 restarts the process and may drop the HTTP connection).
const HEALTH_POLL_INTERVAL = 3_000;
const HEALTH_POLL_MAX_ATTEMPTS = 60; // up to ~3 minutes

function waitForBackend() {
  return new Promise((resolve) => {
    let attempts = 0;
    const poll = async () => {
      attempts += 1;
      try {
        await fetchApi('/api/system/health');
        resolve(true);
      } catch {
        if (attempts >= HEALTH_POLL_MAX_ATTEMPTS) {
          resolve(false);
        } else {
          setTimeout(poll, HEALTH_POLL_INTERVAL);
        }
      }
    };
    // First poll immediately — the backend may never have gone down
    poll();
  });
}

function SystemSection() {
  const addToast = useStore((s) => s.addToast);
  const showConfirm = useStore((s) => s.showConfirm);
  const [version, setVersion] = useState('...');
  const [lastBackup, setLastBackup] = useState(null);
  const [checking, setChecking] = useState(false);
  const [backingUp, setBackingUp] = useState(false);
  const [restarting, setRestarting] = useState(false);
  const [resetting, setResetting] = useState(false);
  const [restoringBackup, setRestoringBackup] = useState(false);
  const restoreInputRef = useRef(null);
  const [updateInfo, setUpdateInfo] = useState(null);
  const [updating, setUpdating] = useState(false);
  // Ref guard so double-clicks can't start a second install while a confirm
  // dialog or an in-flight update is active
  const updatingRef = useRef(false);

  // Fetch version on mount
  useEffect(() => {
    let cancelled = false;
    fetchApi('/api/system/version')
      .then((data) => {
        if (!cancelled && data?.version) setVersion(data.version);
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, []);

  const runCheckUpdate = useCallback(async () => {
    const data = await fetchApi('/api/system/check-update');
    setUpdateInfo(data?.updateAvailable ? data : null);
    return data;
  }, []);

  const handleCheckUpdates = useCallback(async () => {
    if (updatingRef.current) return;
    setChecking(true);
    try {
      const data = await runCheckUpdate();
      if (data?.updateAvailable) {
        addToast('info', t.settings.updateAvailable);
      } else if (data?.error) {
        addToast('error', t.settings.updateCheckFailed);
      } else {
        addToast('success', t.settings.upToDate);
      }
    } catch {
      addToast('error', t.settings.updateCheckFailed);
    } finally {
      setChecking(false);
    }
  }, [addToast, runCheckUpdate]);

  const handleInstallUpdate = useCallback(() => {
    if (updatingRef.current) return;
    showConfirm({
      title: t.settings.installUpdateTitle,
      message: t.settings.installUpdateConfirm,
      onConfirm: async () => {
        if (updatingRef.current) return;
        updatingRef.current = true;
        setUpdating(true);
        try {
          let installFailed = false;
          try {
            const res = await fetchApi('/api/system/update', { method: 'POST' });
            if (!res?.success) installFailed = true;
          } catch {
            // Connection dropped — expected when PM2 restarts the backend
            // mid-response. Fall through and wait for it to come back.
          }

          if (installFailed) {
            addToast('error', t.settings.updateFailed);
            return;
          }

          const backOnline = await waitForBackend();
          if (!backOnline) {
            addToast('error', t.settings.updateFailed);
            return;
          }

          try {
            const data = await runCheckUpdate();
            if (data?.updateAvailable) {
              addToast('error', t.settings.updateNotApplied);
            } else {
              addToast('success', t.settings.updateSuccess);
            }
          } catch {
            addToast('error', t.settings.updateCheckFailed);
          }
        } finally {
          updatingRef.current = false;
          setUpdating(false);
        }
      },
    });
  }, [showConfirm, addToast, runCheckUpdate]);

  const handleRestart = useCallback(() => {
    showConfirm({
      title: t.settings.restartApp,
      message: t.settings.restartConfirm,
      onConfirm: async () => {
        setRestarting(true);
        try {
          await fetchApi('/api/system/restart', { method: 'POST' });
          addToast('info', t.settings.restartingApp);
        } catch {
          addToast('error', t.settings.restartFailed);
        } finally {
          setRestarting(false);
        }
      },
    });
  }, [showConfirm, addToast]);

  const handleRestartPi = useCallback(() => {
    showConfirm({
      title: t.settings.restartPi,
      message: t.settings.restartPiConfirm,
      onConfirm: async () => {
        try {
          await fetchApi('/api/system/reboot', { method: 'POST' });
          addToast('info', t.settings.restartingPi);
        } catch {
          addToast('error', t.settings.restartFailed);
        }
      },
    });
  }, [showConfirm, addToast]);

  const handleBackup = useCallback(async () => {
    setBackingUp(true);
    try {
      const data = await fetchApi('/api/system/backup', { method: 'POST' });
      if (data?.date || data?.timestamp) {
        const when = data.date ? new Date(data.date) : new Date();
        setLastBackup(when.toLocaleString('he-IL'));
      }
      // Download the freshly created backup to the browser. Best-effort — the
      // server-side backup already succeeded, so a download failure isn't fatal.
      if (data?.file) {
        try {
          const token = localStorage.getItem('auth_token');
          const res = await fetch(`/api/system/backup/download/${encodeURIComponent(data.file)}`, {
            headers: token ? { Authorization: `******` } : {},
          });
          if (res.ok) {
            const blob = await res.blob();
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = data.file;
            document.body.appendChild(a);
            a.click();
            a.remove();
            URL.revokeObjectURL(url);
          }
        } catch {
          /* download is best-effort */
        }
      }
      addToast('success', t.settings.backupSuccess);
    } catch {
      addToast('error', t.settings.backupFailed);
    } finally {
      setBackingUp(false);
    }
  }, [addToast]);

  const handleResetDevice = useCallback(() => {
    showConfirm({
      title: t.settings.resetDeviceTitle,
      message: t.settings.resetDeviceConfirm,
      onConfirm: async () => {
        setResetting(true);
        try {
          await fetchApi('/api/system/reset', { method: 'POST' });
          addToast('success', t.settings.resetSuccess);
          // Clear client-side state (queues, family, cached prefs) so the device
          // truly returns to a first-run state, then reload into the fresh app.
          try { localStorage.clear(); } catch { /* ignore */ }
          setTimeout(() => window.location.reload(), 1200);
        } catch {
          addToast('error', t.settings.resetFailed);
          setResetting(false);
        }
      },
    });
  }, [showConfirm, addToast]);

  const handleRestoreFile = useCallback((e) => {
    const file = e.target.files?.[0];
    // Reset the input so selecting the same file again re-triggers onChange.
    e.target.value = '';
    if (!file) return;
    showConfirm({
      title: t.settings.restoreTitle,
      message: t.settings.restoreConfirm,
      onConfirm: async () => {
        setRestoringBackup(true);
        try {
          const token = localStorage.getItem('auth_token');
          const res = await fetch('/api/system/restore', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/octet-stream',
              ...(token ? { Authorization: `******` } : {}),
            },
            body: file,
          });
          if (!res.ok) {
            const txt = await res.text().catch(() => '');
            throw new Error(txt || res.statusText);
          }
          addToast('success', t.settings.restoreSuccess);
          // Client-side caches now reference the old data — clear and reload.
          try { localStorage.clear(); } catch { /* ignore */ }
          setTimeout(() => window.location.reload(), 1200);
        } catch {
          addToast('error', t.settings.restoreFailed);
          setRestoringBackup(false);
        }
      },
    });
  }, [showConfirm, addToast]);

  return (
    <Section title={t.settings.system}>
      <div className="flex flex-col gap-4">
        {/* Version display */}
        <div className="flex items-center justify-between bg-s2 border border-bd rounded-xl px-4 py-3">
          <span className="text-sm text-ts">{t.settings.version}</span>
          <span className="text-sm font-semibold text-tp font-mono">{version}</span>
        </div>

        {/* Update available notice + install action */}
        {(updateInfo?.updateAvailable || updating) && (
          <div className="flex items-center justify-between bg-acc/10 border border-acc/30 rounded-xl px-4 py-3">
            <span className="text-sm font-medium text-tp">
              {updating
                ? t.settings.updatingSystem
                : `${t.settings.updateAvailable}${updateInfo?.behindBy > 0 ? ` · ${updateInfo.behindBy} ${t.settings.commitsBehind}` : ''}`}
            </span>
            <Btn
              variant="primary"
              icon={updating ? <Spinner /> : <RefreshIcon />}
              onClick={handleInstallUpdate}
              disabled={updating || checking}
            >
              {updating ? t.settings.updatingSystem : t.settings.installUpdate}
            </Btn>
          </div>
        )}

        {/* Action buttons */}
        <div className="flex flex-wrap gap-3">
          <Btn
            icon={checking ? <Spinner /> : <RefreshIcon />}
            onClick={handleCheckUpdates}
            disabled={checking || updating}
          >
            {t.settings.checkUpdates}
          </Btn>
          <Btn
            icon={restarting ? <Spinner /> : <PowerIcon />}
            onClick={handleRestart}
            disabled={restarting}
          >
            {t.settings.restartApp}
          </Btn>
          <Btn icon={<PowerIcon />} variant="danger" onClick={handleRestartPi}>
            {t.settings.restartPi}
          </Btn>
          <Btn
            icon={backingUp ? <Spinner /> : <SaveIcon />}
            variant="success"
            onClick={handleBackup}
            disabled={backingUp}
          >
            {t.settings.backupNow}
          </Btn>
          <input
            ref={restoreInputRef}
            type="file"
            accept=".db,.sqlite,application/octet-stream"
            onChange={handleRestoreFile}
            className="hidden"
          />
          <Btn
            icon={restoringBackup ? <Spinner /> : <UploadIcon />}
            onClick={() => restoreInputRef.current?.click()}
            disabled={restoringBackup}
          >
            {t.settings.restoreBackup}
          </Btn>
          <Btn
            icon={resetting ? <Spinner /> : <TrashIcon />}
            variant="danger"
            onClick={handleResetDevice}
            disabled={resetting}
          >
            {t.settings.resetDevice}
          </Btn>
        </div>

        {/* Last backup timestamp */}
        <p className="text-xs text-tm">
          {t.settings.lastBackup}: {lastBackup ?? t.settings.never}
        </p>
      </div>
    </Section>
  );
}

// ─── Section: Log Viewer ────────────────────────────────────────────────────

function LogViewerSection() {
  const [logs, setLogs] = useState([]);
  const [level, setLevel] = useState('all');
  const [loadingLogs, setLoadingLogs] = useState(false);
  const [error, setError] = useState(null);

  const fetchLogs = useCallback(async () => {
    setLoadingLogs(true);
    setError(null);
    try {
      const params = new URLSearchParams({ lines: '50' });
      if (level !== 'all') params.set('level', level);
      const data = await fetchApi(`/api/system/logs?${params}`);
      setLogs(data?.entries || []);
    } catch {
      setError(t.logs.loadError);
    } finally {
      setLoadingLogs(false);
    }
  }, [level]);

  useEffect(() => {
    fetchLogs();
  }, [fetchLogs]);

  const LEVEL_NAMES = { 10: 'TRACE', 20: 'DEBUG', 30: 'INFO', 40: 'WARN', 50: 'ERROR', 60: 'FATAL' };

  const formatEntry = (entry) => {
    const ts = entry.time ? new Date(entry.time).toLocaleTimeString('he-IL') : '';
    const lvl = LEVEL_NAMES[entry.level] || 'INFO';
    const msg = entry.msg || entry.message || JSON.stringify(entry);
    return `[${ts}] ${lvl}: ${msg}`;
  };

  return (
    <Section title={t.logs.viewLogs}>
      <div className="flex flex-col gap-3">
        <div className="flex items-center gap-3">
          <SelectRow
            label={t.logs.levelFilter}
            value={level}
            onChange={(e) => setLevel(e.target.value)}
            options={[
              { value: 'all',   label: t.logs.all },
              { value: 'error', label: t.logs.error },
              { value: 'warn',  label: t.logs.warn },
              { value: 'info',  label: t.logs.info },
            ]}
            className="flex-1"
          />
          <Btn
            icon={loadingLogs ? <Spinner /> : <RefreshIcon />}
            onClick={fetchLogs}
            disabled={loadingLogs}
            className="self-end"
          >
            {t.logs.refresh}
          </Btn>
        </div>

        {error && (
          <p className="text-sm text-coral-d">{error}</p>
        )}

        <textarea
          readOnly
          value={logs.length > 0 ? logs.map(formatEntry).join('\n') : t.logs.noLogs}
          className="w-full h-[240px] bg-s2 border border-bd rounded-xl p-3 text-xs text-tp
                     font-mono resize-none focus:outline-none"
          style={{ fontFamily: "'DM Mono', monospace", direction: 'ltr' }}
        />
      </div>
    </Section>
  );
}

// ─── Section: Wi-Fi ──────────────────────────────────────────────────────────

function WifiSection() {
  const [wifiOpen, setWifiOpen] = useState(false);
  const btnRef = useRef(null);

  return (
    <Section title={t.settings.wifi}>
      <div className="relative">
        <div ref={btnRef}>
          <Btn icon={<WifiIcon />} onClick={() => setWifiOpen(true)}>
            {t.settings.openWifi}
          </Btn>
        </div>
        <WifiPopup
          visible={wifiOpen}
          onClose={() => setWifiOpen(false)}
          anchorRef={btnRef}
        />
      </div>
    </Section>
  );
}

// ─── Section: About ──────────────────────────────────────────────────────────

function AboutSection() {
  const [info, setInfo] = useState({
    version: '...',
    ip: '...',
    uptime: '...',
    buildDate: '...',
  });

  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        const [versionData, healthData] = await Promise.all([
          fetchApi('/api/system/version').catch(() => null),
          fetchApi('/api/system/health').catch(() => null),
        ]);

        if (cancelled) return;

        const uptimeSec = healthData?.uptime || 0;
        const days = Math.floor(uptimeSec / 86400);
        const hours = Math.floor((uptimeSec % 86400) / 3600);
        const uptimeStr = days > 0
          ? `${days} ${t.settings.days}, ${hours} ${t.settings.hours}`
          : `${hours} ${t.settings.hours}`;

        // Extract IP from health or use fallback
        const ip = healthData?.ip || healthData?.network?.ip || '---';

        setInfo({
          version: versionData?.version || '---',
          ip,
          uptime: uptimeStr,
          buildDate: versionData?.buildDate || new Date().toLocaleDateString('he-IL'),
        });
      } catch {
        // Silently fail, keep placeholders
      }
    }

    load();
    return () => { cancelled = true; };
  }, []);

  const rows = [
    { label: t.settings.version,   value: info.version },
    { label: t.settings.ipAddress, value: info.ip },
    { label: t.settings.uptime,    value: info.uptime },
    { label: t.settings.buildDate, value: info.buildDate },
  ];

  return (
    <Section title={t.settings.about}>
      <div className="flex flex-col divide-y divide-bd">
        {rows.map(({ label, value }) => (
          <div key={label} className="flex items-center justify-between py-2.5">
            <span className="text-sm text-ts">{label}</span>
            <span className="text-sm font-medium text-tp font-mono">{value}</span>
          </div>
        ))}
      </div>
    </Section>
  );
}

// ─── SettingsPage ─────────────────────────────────────────────────────────────

export default function SettingsPage() {
  return (
    <div
      className="h-full overflow-y-auto px-8 py-6"
      style={{ scrollbarWidth: 'thin' }}
    >
      <h1 className="text-2xl font-bold text-tp mb-6">{t.tabs.settings}</h1>

      {/* Two-column masonry-style grid */}
      <div className="grid grid-cols-2 gap-x-6 items-start">
        {/* Column A (right in RTL — rendered first) */}
        <div>
          <ProfileSection />
          <LocationSection />
          <HomeAssistantSection />
          <NewsSection />
          <DisplaySection />
          <WifiSection />
        </div>

        {/* Column B (left in RTL) */}
        <div>
          <IcsCalendarSection />
          <SpotifySection />
          <FamilySection />
          <TasksSection />
          <SystemSection />
          <LogViewerSection />
          <AboutSection />
        </div>
      </div>
    </div>
  );
}
