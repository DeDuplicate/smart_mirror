import { useState } from 'react';
import t from '../../i18n/he.json';
import useStore from '../../store/index.js';

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
function Btn({ onClick, children, variant = 'default', icon, className = '' }) {
  const variants = {
    default:  'bg-s2 text-ts border border-bd hover:bg-bd',
    primary:  'bg-acc text-white hover:bg-acc/90',
    danger:   'bg-coral/20 text-coral-d hover:bg-coral/40',
    success:  'bg-mint/30 text-mint-d hover:bg-mint/60',
  };
  return (
    <button
      onClick={onClick}
      className={`ripple inline-flex items-center gap-2 px-4 min-h-[44px] rounded-xl
                  font-medium text-sm active:scale-95 transition-all duration-[var(--dur-fast)]
                  ${variants[variant]} ${className}`}
    >
      {icon}
      {children}
    </button>
  );
}

// ─── Section: Profile ────────────────────────────────────────────────────────

function ProfileSection() {
  const { settings, setSettings } = useStore();
  const [greetingStyle, setGreetingStyle] = useState('casual');

  return (
    <Section title={t.settings.profile}>
      <div className="flex flex-col gap-4">
        <InputRow
          label={t.settings.name}
          placeholder={t.settings.namePlaceholder}
          value={settings.userName}
          onChange={(e) => setSettings({ userName: e.target.value })}
        />
        <SelectRow
          label={t.settings.greetingStyle}
          value={greetingStyle}
          onChange={(e) => setGreetingStyle(e.target.value)}
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
  const { settings, setSettings } = useStore();
  const [lat, setLat] = useState('');
  const [lon, setLon] = useState('');

  return (
    <Section title={t.settings.location}>
      <div className="flex flex-col gap-4">
        <InputRow
          label={t.settings.city}
          placeholder={t.settings.cityPlaceholder}
          value={settings.location}
          onChange={(e) => setSettings({ location: e.target.value })}
        />
        <div className="flex gap-3">
          <InputRow
            label={t.settings.latitude}
            placeholder="31.7683"
            value={lat}
            onChange={(e) => setLat(e.target.value)}
            className="flex-1"
          />
          <InputRow
            label={t.settings.longitude}
            placeholder="35.2137"
            value={lon}
            onChange={(e) => setLon(e.target.value)}
            className="flex-1"
          />
        </div>
      </div>
    </Section>
  );
}

// ─── Section: Google Accounts ────────────────────────────────────────────────

function GoogleSection() {
  const [accounts] = useState([]);

  return (
    <Section title={t.settings.googleAccounts}>
      <div className="flex flex-col gap-4">
        <Btn variant="primary" icon={<PlusIcon />}>
          {t.settings.addAccount}
        </Btn>

        {accounts.length === 0 ? (
          <p className="text-sm text-tm">{t.settings.linkedAccounts}: —</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {accounts.map((acc, i) => (
              <li key={i}
                className="flex items-center justify-between bg-s2 border border-bd rounded-xl px-4 py-3">
                <span className="text-sm text-tp">{acc.email}</span>
                <Btn variant="danger" icon={<TrashIcon />}>
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
  const [haUrl, setHaUrl]     = useState('');
  const [haToken, setHaToken] = useState('');

  return (
    <Section title={t.settings.smartHome}>
      <div className="flex flex-col gap-4">
        <InputRow
          label={t.settings.haUrl}
          placeholder="http://homeassistant.local:8123"
          value={haUrl}
          onChange={(e) => setHaUrl(e.target.value)}
        />
        <InputRow
          label={t.settings.haToken}
          type="password"
          placeholder="eyJ..."
          value={haToken}
          onChange={(e) => setHaToken(e.target.value)}
        />
        <Btn icon={<LinkIcon />}>
          {t.settings.testConnection}
        </Btn>
      </div>
    </Section>
  );
}

// ─── Section: Spotify ────────────────────────────────────────────────────────

function SpotifySection() {
  const connections = useStore((s) => s.connections);
  const isConnected = connections.spotify === 'connected';

  return (
    <Section title={t.settings.spotify}>
      {isConnected ? (
        <div className="flex items-center justify-between bg-s2 border border-bd rounded-xl px-4 py-3">
          <div className="flex flex-col gap-0.5">
            <span className="text-sm font-medium text-tp">{t.settings.connectedAs}</span>
            <span className="text-xs text-ts">@username</span>
          </div>
          <Btn variant="danger">{t.settings.disconnectSpotify}</Btn>
        </div>
      ) : (
        <Btn variant="primary" icon={<LinkIcon />}>
          {t.settings.connectSpotify}
        </Btn>
      )}
    </Section>
  );
}

// ─── Section: News ───────────────────────────────────────────────────────────

function NewsSection() {
  const [ynet, setYnet]         = useState(true);
  const [haaretz, setHaaretz]   = useState(false);

  return (
    <Section title={t.settings.news}>
      <div className="flex flex-col divide-y divide-bd">
        <ToggleRow label={t.settings.sourceYnet}    checked={ynet}    onChange={setYnet} />
        <ToggleRow label={t.settings.sourceHaaretz} checked={haaretz} onChange={setHaaretz} />
      </div>
    </Section>
  );
}

// ─── Section: Tasks ──────────────────────────────────────────────────────────

function TasksSection() {
  const [col1, setCol1]       = useState(t.tasks.todo);
  const [col2, setCol2]       = useState(t.tasks.inProgress);
  const [col3, setCol3]       = useState(t.tasks.done);
  const [cleanup, setCleanup] = useState('7');

  return (
    <Section title={t.settings.tasks}>
      <div className="flex flex-col gap-4">
        <p className="text-sm font-medium text-ts -mb-1">{t.settings.columnNames}</p>
        <div className="flex gap-3">
          <InputRow label="1" value={col1} onChange={(e) => setCol1(e.target.value)} className="flex-1" />
          <InputRow label="2" value={col2} onChange={(e) => setCol2(e.target.value)} className="flex-1" />
          <InputRow label="3" value={col3} onChange={(e) => setCol3(e.target.value)} className="flex-1" />
        </div>
        <SelectRow
          label={t.settings.cleanupInterval}
          value={cleanup}
          onChange={(e) => setCleanup(e.target.value)}
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
  const { settings, setSettings } = useStore();
  const [idleMin, setIdleMin]       = useState(10);
  const [brightness, setBrightness] = useState(80);
  const [screensaver, setScreensaver] = useState('clock');
  const [hebrewCal, setHebrewCal]   = useState(false);

  return (
    <Section title={t.settings.display}>
      <div className="flex flex-col gap-5">
        <SliderRow
          label={t.settings.idleTimeout}
          min={1} max={30}
          value={idleMin}
          onChange={(e) => setIdleMin(Number(e.target.value))}
          unit={` ${t.settings.idleTimeoutMin}`}
        />
        <SliderRow
          label={t.settings.brightness}
          min={10} max={100} step={5}
          value={brightness}
          onChange={(e) => setBrightness(Number(e.target.value))}
          unit="%"
        />
        <SelectRow
          label={t.settings.screensaverStyle}
          value={screensaver}
          onChange={(e) => setScreensaver(e.target.value)}
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
                  onClick={() => setSettings({ temperatureUnit: unit })}
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
            checked={settings.showWeekend}
            onChange={(val) => setSettings({ showWeekend: val })}
          />
          <ToggleRow
            label={t.settings.hebrewCalendar}
            checked={hebrewCal}
            onChange={setHebrewCal}
          />
        </div>
      </div>
    </Section>
  );
}

// ─── Section: System ─────────────────────────────────────────────────────────

function SystemSection() {
  const lastBackup = null;

  return (
    <Section title={t.settings.system}>
      <div className="flex flex-col gap-4">
        {/* Version display */}
        <div className="flex items-center justify-between bg-s2 border border-bd rounded-xl px-4 py-3">
          <span className="text-sm text-ts">{t.settings.version}</span>
          <span className="text-sm font-semibold text-tp font-mono">1.0.0</span>
        </div>

        {/* Action buttons */}
        <div className="flex flex-wrap gap-3">
          <Btn icon={<RefreshIcon />}>{t.settings.checkUpdates}</Btn>
          <Btn icon={<PowerIcon />}>{t.settings.restartApp}</Btn>
          <Btn icon={<PowerIcon />} variant="danger">{t.settings.restartPi}</Btn>
          <Btn icon={<SaveIcon />}  variant="success">{t.settings.backupNow}</Btn>
        </div>

        {/* Last backup timestamp */}
        <p className="text-xs text-tm">
          {t.settings.lastBackup}: {lastBackup ?? t.settings.never}
        </p>
      </div>
    </Section>
  );
}

// ─── Section: Wi-Fi ──────────────────────────────────────────────────────────

function WifiSection() {
  return (
    <Section title={t.settings.wifi}>
      <Btn icon={<WifiIcon />}>{t.settings.openWifi}</Btn>
    </Section>
  );
}

// ─── Section: About ──────────────────────────────────────────────────────────

function AboutSection() {
  const rows = [
    { label: t.settings.version,   value: '1.0.0' },
    { label: t.settings.ipAddress, value: '192.168.1.100' },
    { label: t.settings.uptime,    value: '3 ימים, 4 שעות' },
    { label: t.settings.buildDate, value: '07/04/2026' },
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
          <AboutSection />
        </div>
      </div>
    </div>
  );
}
