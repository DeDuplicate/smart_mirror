import { useEffect, useRef, useState, useCallback } from 'react';
import { io } from 'socket.io-client';
import './styles/global.css';
import useStore from './store/index.js';
import t from './i18n/he.json';
import TopBar from './components/TopBar.jsx';
import TabBar from './components/TabBar.jsx';
import ToastContainer from './components/ToastContainer.jsx';
import ConfirmDialog from './components/ConfirmDialog.jsx';
import OAuthOverlay from './components/OAuthOverlay.jsx';
import CalendarPage from './components/pages/CalendarPage.jsx';
import TasksPage from './components/pages/TasksPage.jsx';
import HomePage from './components/pages/HomePage.jsx';
import MusicPage from './components/pages/MusicPage.jsx';
import NewsPage from './components/pages/NewsPage.jsx';
import SettingsPage from './components/pages/SettingsPage.jsx';
import useAuth from './hooks/useAuth.js';
import useHealth from './hooks/useHealth.js';

// ─── Socket.io singleton ─────────────────────────────────────────────────────

let socket = null;

function getSocket() {
  if (!socket) {
    socket = io('/', {
      path: '/socket.io',
      transports: ['websocket', 'polling'],
      reconnectionAttempts: Infinity,
      reconnectionDelay: 2000,
    });
  }
  return socket;
}

// ─── Page registry ──────────────────────────────────────────────────────────

const PAGES = [
  CalendarPage,
  TasksPage,
  HomePage,
  MusicPage,
  NewsPage,
  SettingsPage,
];

// ─── Tab Content with transition ─────────────────────────────────────────────

function TabContent() {
  const activeTab = useStore((s) => s.activeTab);
  const previousTab = useStore((s) => s.previousTab);
  const [displayedTab, setDisplayedTab] = useState(activeTab);
  const [animClass, setAnimClass] = useState('');
  const contentRef = useRef(null);

  useEffect(() => {
    if (activeTab === displayedTab) return;

    // Determine slide direction based on tab index
    const goingForward = activeTab > previousTab;
    const exitClass = goingForward ? 'tab-exit' : 'tab-exit-reverse';
    const enterClass = goingForward ? 'tab-enter' : 'tab-enter-reverse';

    // Start exit animation
    setAnimClass(exitClass);

    const exitTimer = setTimeout(() => {
      setDisplayedTab(activeTab);
      setAnimClass(enterClass);

      const enterTimer = setTimeout(() => {
        setAnimClass('');
      }, 250);

      return () => clearTimeout(enterTimer);
    }, 150);

    return () => clearTimeout(exitTimer);
  }, [activeTab, displayedTab, previousTab]);

  const ActivePage = PAGES[displayedTab] || PAGES[0];

  return (
    <main
      ref={contentRef}
      className={`flex-1 overflow-hidden relative ${animClass}`}
    >
      <ActivePage />
    </main>
  );
}

// ─── Setup Wizard ────────────────────────────────────────────────────────────

// ─── Calendar color options ──────────────────────────────────────────────────

const CALENDAR_COLORS = [
  { key: 'mint', bg: 'var(--mint-bg)', dot: 'var(--mint-d)', label: t.calendarColors.mint },
  { key: 'lavender', bg: 'var(--lav-bg)', dot: 'var(--lav-d)', label: t.calendarColors.lavender },
  { key: 'coral', bg: 'var(--coral-bg)', dot: 'var(--coral-d)', label: t.calendarColors.coral },
  { key: 'gold', bg: 'var(--gold-bg)', dot: 'var(--gold-d)', label: t.calendarColors.gold },
];

// ─── Google Account Card (shown after linking) ──────────────────────────────

function GoogleAccountCard({ account, colorMap, onColorChange }) {
  const selectedColor = colorMap[account.email] || 'mint';

  return (
    <div className="bg-s2 border border-bd rounded-xl p-4 flex flex-col gap-3">
      {/* Account email + badge */}
      <div className="flex items-center gap-3">
        {/* Google icon */}
        <div className="w-10 h-10 rounded-full bg-acc/10 flex items-center justify-center shrink-0">
          <svg viewBox="0 0 24 24" className="w-5 h-5" fill="none">
            <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 01-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z" fill="#4285F4"/>
            <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/>
            <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18A10.96 10.96 0 001 12c0 1.77.42 3.45 1.18 4.93l3.66-2.84z" fill="#FBBC05"/>
            <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/>
          </svg>
        </div>

        <div className="flex-1 min-w-0">
          <p className="text-tp font-medium text-sm truncate">{account.email}</p>
        </div>

        {/* Connected badge */}
        <span className="shrink-0 px-3 py-1 rounded-full text-xs font-semibold"
          style={{ backgroundColor: 'var(--mint-bg)', color: 'var(--mint-d)' }}>
          {t.setup.connected}
        </span>
      </div>

      {/* Calendar color picker */}
      <div className="flex items-center gap-3 pt-2 border-t border-bd">
        <span className="text-xs text-ts font-medium shrink-0">
          {t.setup.calendarColor}
        </span>
        <div className="flex gap-2">
          {CALENDAR_COLORS.map((c) => (
            <button
              key={c.key}
              onClick={() => onColorChange(account.email, c.key)}
              className="w-[44px] h-[44px] rounded-xl flex items-center justify-center
                         border-2 transition-all active:scale-95"
              style={{
                backgroundColor: c.bg,
                borderColor: selectedColor === c.key ? c.dot : 'transparent',
              }}
              title={c.label}
            >
              {selectedColor === c.key && (
                <svg viewBox="0 0 24 24" fill="none" stroke={c.dot} strokeWidth="3"
                     strokeLinecap="round" strokeLinejoin="round" className="w-5 h-5">
                  <path d="M20 6L9 17l-5-5" />
                </svg>
              )}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

// ─── Setup Wizard ────────────────────────────────────────────────────────────

function SetupWizard({ onComplete }) {
  const [step, setStep] = useState(0);
  const setSettings = useStore((s) => s.setSettings);
  const markSetupComplete = useStore((s) => s.markSetupComplete);
  const [name, setName] = useState('');
  const [location, setLocation] = useState('');

  // Google auth state
  const auth = useAuth();
  const [googleAccounts, setGoogleAccounts] = useState([]);
  const [calendarColors, setCalendarColors] = useState({});

  const steps = [
    t.setup.welcome,
    t.setup.name,
    t.setup.location,
    t.setup.googleAccount,
    t.setup.smartHome,
    t.setup.spotify,
    t.setup.newsSources,
    t.setup.finish,
  ];

  // Load existing Google accounts on mount and when step changes to 3
  useEffect(() => {
    if (step === 3) {
      auth.getGoogleAccounts().then((accounts) => {
        setGoogleAccounts(accounts);
      });
    }
  }, [step]);

  const handleGoogleConnect = () => {
    auth.startGoogleAuth((data) => {
      // On success, refresh accounts list
      auth.getGoogleAccounts().then((accounts) => {
        setGoogleAccounts(accounts);
      });
    });
  };

  const handleCalendarColorChange = (email, color) => {
    setCalendarColors((prev) => ({ ...prev, [email]: color }));
  };

  const handleFinish = useCallback(() => {
    setSettings({
      userName: name,
      location,
      firstRun: false,
      calendarColors: calendarColors,
    });
    markSetupComplete();
    if (onComplete) onComplete();
  }, [name, location, calendarColors, setSettings, markSetupComplete, onComplete]);

  const handleNext = () => {
    if (step === steps.length - 1) {
      handleFinish();
    } else {
      setStep((s) => s + 1);
    }
  };

  const handleBack = () => {
    if (step > 0) setStep((s) => s - 1);
  };

  return (
    <div className="fixed inset-0 z-[100] bg-bg flex items-center justify-center">
      <div className="bg-surf rounded-3xl shadow-2xl p-10 w-[600px] min-h-[400px] flex flex-col">
        {/* Progress */}
        <div className="flex gap-1.5 mb-8">
          {steps.map((_, i) => (
            <div
              key={i}
              className={`h-1 flex-1 rounded-full transition-colors duration-[var(--dur-normal)] ${
                i <= step ? 'bg-acc' : 'bg-bd'
              }`}
            />
          ))}
        </div>

        {/* Content area */}
        <div className="flex-1 flex flex-col justify-center">
          {step === 0 && (
            <div className="text-center">
              <h1 className="text-4xl font-bold text-tp mb-3">
                {t.setup.welcome}
              </h1>
              <p className="text-ts text-lg">{t.setup.welcomeSubtitle}</p>
            </div>
          )}

          {step === 1 && (
            <div>
              <h2 className="text-2xl font-semibold text-tp mb-6">
                {t.setup.name}
              </h2>
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder={t.setup.namePlaceholder}
                className="w-full px-5 py-3.5 rounded-xl bg-s2 border border-bd text-tp
                           placeholder:text-tm focus:outline-none focus:border-acc
                           transition-colors duration-[var(--dur-fast)] text-lg"
                autoFocus
                dir="rtl"
              />
            </div>
          )}

          {step === 2 && (
            <div>
              <h2 className="text-2xl font-semibold text-tp mb-6">
                {t.setup.location}
              </h2>
              <input
                type="text"
                value={location}
                onChange={(e) => setLocation(e.target.value)}
                placeholder={t.setup.locationPlaceholder}
                className="w-full px-5 py-3.5 rounded-xl bg-s2 border border-bd text-tp
                           placeholder:text-tm focus:outline-none focus:border-acc
                           transition-colors duration-[var(--dur-fast)] text-lg"
                autoFocus
                dir="rtl"
              />
            </div>
          )}

          {step === 3 && (
            <div>
              <h2 className="text-2xl font-semibold text-tp mb-3">
                {t.setup.googleAccount}
              </h2>
              <p className="text-ts mb-6">{t.setup.googleAccountDesc}</p>

              {/* Linked accounts list */}
              {googleAccounts.length > 0 && (
                <div className="flex flex-col gap-3 mb-5">
                  {googleAccounts.map((account) => (
                    <GoogleAccountCard
                      key={account.email}
                      account={account}
                      colorMap={calendarColors}
                      onColorChange={handleCalendarColorChange}
                    />
                  ))}
                </div>
              )}

              {/* Auth error */}
              {auth.error && (
                <div className="mb-4 px-4 py-3 rounded-xl text-sm font-medium"
                     style={{ backgroundColor: 'var(--coral-bg)', color: 'var(--coral-d)' }}>
                  {t.setup.authError}: {auth.error}
                </div>
              )}

              {/* Connect / Add another button */}
              <button
                onClick={handleGoogleConnect}
                disabled={auth.isAuthenticating}
                className="px-6 min-h-[56px] bg-acc text-white rounded-xl font-medium
                           hover:bg-acc/90 active:scale-95 transition-all
                           disabled:opacity-50 disabled:cursor-not-allowed
                           flex items-center gap-3"
                style={{ transitionDuration: 'var(--dur-fast)' }}
              >
                {/* Google icon */}
                <svg viewBox="0 0 24 24" className="w-5 h-5 shrink-0" fill="none">
                  <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 01-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z" fill="#fff" fillOpacity="0.9"/>
                  <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#fff" fillOpacity="0.7"/>
                  <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18A10.96 10.96 0 001 12c0 1.77.42 3.45 1.18 4.93l3.66-2.84z" fill="#fff" fillOpacity="0.6"/>
                  <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#fff" fillOpacity="0.8"/>
                </svg>
                <span>
                  {googleAccounts.length > 0
                    ? t.setup.addAnotherAccount
                    : t.setup.connectGoogle}
                </span>
              </button>
            </div>
          )}

          {step === 4 && (
            <div>
              <h2 className="text-2xl font-semibold text-tp mb-3">
                {t.setup.smartHome}
              </h2>
              <p className="text-ts mb-6">{t.setup.smartHomeDesc}</p>
              <button className="px-6 min-h-[56px] bg-acc text-white rounded-xl font-medium
                                 hover:bg-acc/90 active:scale-95 transition-all"
                      style={{ transitionDuration: 'var(--dur-fast)' }}>
                {t.setup.connect}
              </button>
            </div>
          )}

          {step === 5 && (
            <div>
              <h2 className="text-2xl font-semibold text-tp mb-3">
                {t.setup.spotify}
              </h2>
              <p className="text-ts mb-6">{t.setup.spotifyDesc}</p>
              <button className="px-6 min-h-[56px] bg-acc text-white rounded-xl font-medium
                                 hover:bg-acc/90 active:scale-95 transition-all"
                      style={{ transitionDuration: 'var(--dur-fast)' }}>
                {t.setup.connect}
              </button>
            </div>
          )}

          {step === 6 && (
            <div>
              <h2 className="text-2xl font-semibold text-tp mb-3">
                {t.setup.newsSources}
              </h2>
              <p className="text-ts mb-6">{t.setup.newsSourcesDesc}</p>
              {/* News source checkboxes would go here */}
              <div className="text-tm text-sm">{t.errors.configureInSettings}</div>
            </div>
          )}

          {step === 7 && (
            <div className="text-center">
              <h2 className="text-3xl font-bold text-tp mb-3">
                {t.setup.finish}
              </h2>
              <p className="text-ts text-lg">{t.setup.finishDesc}</p>
            </div>
          )}
        </div>

        {/* Navigation */}
        <div className="flex items-center justify-between mt-8 pt-6 border-t border-bd">
          <button
            onClick={handleBack}
            disabled={step === 0}
            className={`px-5 py-2.5 rounded-xl font-medium transition-all duration-[var(--dur-fast)]
              ${step === 0
                ? 'text-tm cursor-not-allowed'
                : 'text-ts hover:bg-s2 active:scale-95'
              }
            `}
          >
            {t.common.back}
          </button>

          <div className="flex gap-3">
            {step > 2 && step < 7 && (
              <button
                onClick={handleNext}
                className="px-5 py-2.5 text-ts hover:bg-s2 rounded-xl font-medium
                           active:scale-95 transition-all duration-[var(--dur-fast)]"
              >
                {t.setup.skip}
              </button>
            )}
            <button
              onClick={handleNext}
              className="px-6 py-2.5 bg-acc text-white rounded-xl font-medium
                         hover:bg-acc/90 active:scale-95 transition-all duration-[var(--dur-fast)]"
            >
              {step === steps.length - 1 ? t.setup.letsStart : t.common.next}
            </button>
          </div>
        </div>
      </div>

      {/* OAuth Overlay (rendered inside the wizard when authenticating) */}
      {auth.isAuthenticating && auth.authUrl && (
        <OAuthOverlay
          provider={auth.provider}
          authUrl={auth.authUrl}
          onSuccess={(data) => {
            // Refresh accounts list
            auth.getGoogleAccounts().then((accounts) => {
              setGoogleAccounts(accounts);
            });
          }}
          onClose={auth.cancelAuth}
        />
      )}
    </div>
  );
}

// ─── App ─────────────────────────────────────────────────────────────────────

export default function App() {
  const setSettings = useStore((s) => s.setSettings);
  const markSettingsLoaded = useStore((s) => s.markSettingsLoaded);
  const setWeather = useStore((s) => s.setWeather);
  const setConnectionStatus = useStore((s) => s.setConnectionStatus);
  const setAllConnectionStatuses = useStore((s) => s.setAllConnectionStatuses);
  const addToast = useStore((s) => s.addToast);
  const settingsLoaded = useStore((s) => s.settings.loaded);
  const firstRun = useStore((s) => s.settings.firstRun);
  const [showWizard, setShowWizard] = useState(false);

  // ── Health polling ──
  useHealth();

  // ── Fetch initial settings from backend ──
  useEffect(() => {
    fetch('/api/settings')
      .then((res) => {
        if (!res.ok) throw new Error('Settings fetch failed');
        return res.json();
      })
      .then((data) => {
        setSettings({ ...data, loaded: true });
        if (data.firstRun !== false) {
          setShowWizard(true);
        }
      })
      .catch(() => {
        // If backend is unavailable, mark as loaded with defaults (firstRun=true)
        markSettingsLoaded();
        setShowWizard(true);
      });
  }, [setSettings, markSettingsLoaded]);

  // ── Socket.io connection for real-time updates ──
  useEffect(() => {
    const sock = getSocket();

    sock.on('connect', () => {
      setConnectionStatus('wifi', 'connected');
    });

    sock.on('disconnect', () => {
      setConnectionStatus('wifi', 'degraded');
    });

    sock.on('weather:update', (data) => {
      setWeather(data);
    });

    sock.on('connections:status', (statuses) => {
      setAllConnectionStatuses(statuses);
    });

    sock.on('settings:update', (data) => {
      setSettings(data);
    });

    sock.on('toast', ({ type, message }) => {
      addToast(type, message);
    });

    return () => {
      sock.off('connect');
      sock.off('disconnect');
      sock.off('weather:update');
      sock.off('connections:status');
      sock.off('settings:update');
      sock.off('toast');
    };
  }, [setWeather, setConnectionStatus, setAllConnectionStatuses, setSettings, addToast]);

  // ── Wizard complete handler ──
  const handleWizardComplete = useCallback(() => {
    setShowWizard(false);
    // Persist settings to backend
    const { userName, location, calendarColors } = useStore.getState().settings;
    fetch('/api/settings', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userName, location, calendarColors, firstRun: false }),
    }).catch(() => {
      // Silently fail - settings will be saved on next opportunity
    });
  }, []);

  // Show nothing until settings are loaded
  if (!settingsLoaded && !showWizard) {
    return (
      <div className="w-[1920px] h-[1080px] flex items-center justify-center bg-bg">
        <div className="skeleton w-32 h-8" />
      </div>
    );
  }

  return (
    <div className="w-[1920px] h-[1080px] flex flex-col bg-bg overflow-hidden">
      {/* Setup Wizard overlay */}
      {showWizard && <SetupWizard onComplete={handleWizardComplete} />}

      {/* Main layout */}
      <TopBar />
      <TabBar />
      <TabContent />

      {/* Overlays */}
      <ToastContainer />
      <ConfirmDialog />
    </div>
  );
}
