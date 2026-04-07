import { useState, useEffect, useCallback, useRef } from 'react';
import t from '../../i18n/he.json';
import useStore from '../../store/index.js';
import useSettings from '../../hooks/useSettings.js';
import useAuth from '../../hooks/useAuth.js';
import { fetchApi } from '../../hooks/useApi.js';
import WifiPopup from '../WifiPopup.jsx';

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
          className={`absolute top-0.5 w-5 h-5 rounded-full bg-white shadow-sm
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
                   [&::-webkit-slider-thumb]:shadow-sm
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

function LocationSection() {
  const { settings, updateSettings } = useSettings();
  const { setSettings } = useStore();
  const debouncedSave = useDebouncedSave(updateSettings);

  return (
    <Section title={t.settings.location}>
      <div className="flex flex-col gap-4">
        <InputRow
          label={t.settings.city}
          placeholder={t.settings.cityPlaceholder}
          value={settings.location || ''}
          onChange={(e) => {
            setSettings({ location: e.target.value });
            debouncedSave({ location: e.target.value });
          }}
        />
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
      </div>
    </Section>
  );
}

// ─── Section: Google Accounts ────────────────────────────────────────────────

function GoogleSection() {
  const {
    startGoogleAuth,
    getGoogleAccounts,
    removeGoogleAccount,
    isAuthenticating,
    provider,
  } = useAuth();
  const [accounts, setAccounts] = useState([]);
  const [loadingAccounts, setLoadingAccounts] = useState(true);
  const addToast = useStore((s) => s.addToast);

  // Load accounts on mount
  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoadingAccounts(true);
      const list = await getGoogleAccounts();
      if (!cancelled) {
        setAccounts(list);
        setLoadingAccounts(false);
      }
    }
    load();
    return () => { cancelled = true; };
  }, [getGoogleAccounts]);

  const handleAdd = useCallback(() => {
    startGoogleAuth(async () => {
      // Refresh accounts list after successful auth
      const list = await getGoogleAccounts();
      setAccounts(list);
      addToast('success', t.settings.accountAdded);
    });
  }, [startGoogleAuth, getGoogleAccounts, addToast]);

  const handleRemove = useCallback(
    async (email) => {
      const ok = await removeGoogleAccount(email);
      if (ok) {
        setAccounts((prev) => prev.filter((a) => a.email !== email));
        addToast('success', t.settings.accountRemoved);
      } else {
        addToast('error', t.settings.accountRemoveFailed);
      }
    },
    [removeGoogleAccount, addToast]
  );

  return (
    <Section title={t.settings.googleAccounts}>
      <div className="flex flex-col gap-4">
        <Btn
          variant="primary"
          icon={isAuthenticating && provider === 'google' ? <Spinner /> : <PlusIcon />}
          onClick={handleAdd}
          disabled={isAuthenticating}
        >
          {t.settings.addAccount}
        </Btn>

        {loadingAccounts ? (
          <div className="flex items-center gap-2 text-sm text-tm">
            <Spinner className="w-4 h-4" />
            {t.common.loading}
          </div>
        ) : accounts.length === 0 ? (
          <p className="text-sm text-tm">{t.settings.linkedAccounts}: &mdash;</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {accounts.map((acc) => (
              <li key={acc.email}
                className="flex items-center justify-between bg-s2 border border-bd rounded-xl px-4 py-3">
                <span className="text-sm text-tp">{acc.email}</span>
                <Btn variant="danger" icon={<TrashIcon />} onClick={() => handleRemove(acc.email)}>
                  {t.settings.removeAccount}
                </Btn>
              </li>
            ))}
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
  const connections = useStore((s) => s.connections);
  const {
    startSpotifyAuth,
    removeSpotifyAccount,
    isAuthenticating,
    provider,
  } = useAuth();
  const addToast = useStore((s) => s.addToast);
  const isConnected = connections.spotify === 'connected';

  const handleConnect = useCallback(() => {
    startSpotifyAuth(() => {
      addToast('success', t.settings.spotifyConnected);
    });
  }, [startSpotifyAuth, addToast]);

  const handleDisconnect = useCallback(async () => {
    const ok = await removeSpotifyAccount();
    if (ok) {
      addToast('success', t.settings.spotifyDisconnected);
    } else {
      addToast('error', t.settings.spotifyDisconnectFailed);
    }
  }, [removeSpotifyAccount, addToast]);

  return (
    <Section title={t.settings.spotify}>
      {isConnected ? (
        <div className="flex items-center justify-between bg-s2 border border-bd rounded-xl px-4 py-3">
          <div className="flex flex-col gap-0.5">
            <span className="text-sm font-medium text-tp">{t.settings.connectedAs}</span>
            <span className="text-xs text-ts">Spotify</span>
          </div>
          <Btn variant="danger" onClick={handleDisconnect}>{t.settings.disconnectSpotify}</Btn>
        </div>
      ) : (
        <Btn
          variant="primary"
          icon={isAuthenticating && provider === 'spotify' ? <Spinner /> : <LinkIcon />}
          onClick={handleConnect}
          disabled={isAuthenticating}
        >
          {t.settings.connectSpotify}
        </Btn>
      )}
    </Section>
  );
}

// ─── Section: News ───────────────────────────────────────────────────────────

function NewsSection() {
  const { settings, updateSettings } = useSettings();
  const { setSettings } = useStore();

  const ynet = settings.newsYnet !== false; // default true
  const now14 = settings.newsNow14 === true; // default false

  return (
    <Section title={t.settings.news}>
      <div className="flex flex-col divide-y divide-bd">
        <ToggleRow
          label={t.settings.sourceYnet}
          checked={ynet}
          onChange={(val) => {
            setSettings({ newsYnet: val });
            updateSettings({ newsYnet: val });
          }}
        />
        <ToggleRow
          label={t.settings.sourceNow14}
          checked={now14}
          onChange={(val) => {
            setSettings({ newsNow14: val });
            updateSettings({ newsNow14: val });
          }}
        />
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
  const cleanup = settings.taskCleanupInterval || '7';

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
        <SelectRow
          label={t.settings.cleanupInterval}
          value={cleanup}
          onChange={(e) => {
            setSettings({ taskCleanupInterval: e.target.value });
            updateSettings({ taskCleanupInterval: e.target.value });
          }}
          options={[
            { value: 'never', label: t.settings.cleanupNever },
            { value: '7',     label: t.settings.cleanup7 },
            { value: '30',    label: t.settings.cleanup30 },
          ]}
        />
      </div>
    </Section>
  );
}

// ─── Section: Display ────────────────────────────────────────────────────────

function DisplaySection() {
  const { settings, updateSettings } = useSettings();
  const { setSettings, toggleDarkMode } = useStore();

  const idleMin = settings.idleTimeout || 10;
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
                  className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-all
                               duration-[var(--dur-fast)]
                               ${settings.temperatureUnit === unit
                                 ? 'bg-acc text-white shadow-sm'
                                 : 'text-ts hover:text-tp'}`}
                >
                  {unit === 'celsius' ? t.weather.celsius : t.weather.fahrenheit}
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
          <ToggleRow
            label={t.settings.darkMode}
            checked={settings.darkMode === true}
            onChange={() => {
              toggleDarkMode();
              updateSettings({ darkMode: !settings.darkMode });
            }}
          />
        </div>
      </div>
    </Section>
  );
}

// ─── Section: System ─────────────────────────────────────────────────────────

function SystemSection() {
  const addToast = useStore((s) => s.addToast);
  const showConfirm = useStore((s) => s.showConfirm);
  const [version, setVersion] = useState('...');
  const [lastBackup, setLastBackup] = useState(null);
  const [checking, setChecking] = useState(false);
  const [backingUp, setBackingUp] = useState(false);
  const [restarting, setRestarting] = useState(false);

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

  const handleCheckUpdates = useCallback(async () => {
    setChecking(true);
    try {
      const data = await fetchApi('/api/system/check-update');
      if (data?.updateAvailable) {
        addToast('info', `${t.settings.updateAvailable}: v${data.latestVersion}`);
      } else {
        addToast('success', t.settings.upToDate);
      }
    } catch {
      addToast('error', t.settings.updateCheckFailed);
    } finally {
      setChecking(false);
    }
  }, [addToast]);

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
      if (data?.timestamp) {
        setLastBackup(new Date(data.timestamp).toLocaleString('he-IL'));
      }
      addToast('success', t.settings.backupSuccess);
    } catch {
      addToast('error', t.settings.backupFailed);
    } finally {
      setBackingUp(false);
    }
  }, [addToast]);

  return (
    <Section title={t.settings.system}>
      <div className="flex flex-col gap-4">
        {/* Version display */}
        <div className="flex items-center justify-between bg-s2 border border-bd rounded-xl px-4 py-3">
          <span className="text-sm text-ts">{t.settings.version}</span>
          <span className="text-sm font-semibold text-tp font-mono">{version}</span>
        </div>

        {/* Action buttons */}
        <div className="flex flex-wrap gap-3">
          <Btn
            icon={checking ? <Spinner /> : <RefreshIcon />}
            onClick={handleCheckUpdates}
            disabled={checking}
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
          <GoogleSection />
          <SpotifySection />
          <TasksSection />
          <SystemSection />
          <LogViewerSection />
          <AboutSection />
        </div>
      </div>
    </div>
  );
}
