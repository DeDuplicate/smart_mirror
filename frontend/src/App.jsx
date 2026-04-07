import { useEffect, useRef, useState, useCallback } from 'react';
import { io } from 'socket.io-client';
import './styles/global.css';
import useStore from './store/index.js';
import t from './i18n/he.json';
import TopBar from './components/TopBar.jsx';
import TabBar from './components/TabBar.jsx';
import ToastContainer from './components/ToastContainer.jsx';
import ConfirmDialog from './components/ConfirmDialog.jsx';
import CalendarPage from './components/pages/CalendarPage.jsx';
import TasksPage from './components/pages/TasksPage.jsx';
import HomePage from './components/pages/HomePage.jsx';
import MusicPage from './components/pages/MusicPage.jsx';
import NewsPage from './components/pages/NewsPage.jsx';
import SettingsPage from './components/pages/SettingsPage.jsx';

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

function SetupWizard({ onComplete }) {
  const [step, setStep] = useState(0);
  const setSettings = useStore((s) => s.setSettings);
  const markSetupComplete = useStore((s) => s.markSetupComplete);
  const [name, setName] = useState('');
  const [location, setLocation] = useState('');

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

  const handleFinish = useCallback(() => {
    setSettings({ userName: name, location, firstRun: false });
    markSetupComplete();
    if (onComplete) onComplete();
  }, [name, location, setSettings, markSetupComplete, onComplete]);

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
              <button className="px-6 py-3 bg-acc text-white rounded-xl font-medium
                                 hover:bg-acc/90 active:scale-95 transition-all">
                {t.setup.connect}
              </button>
            </div>
          )}

          {step === 4 && (
            <div>
              <h2 className="text-2xl font-semibold text-tp mb-3">
                {t.setup.smartHome}
              </h2>
              <p className="text-ts mb-6">{t.setup.smartHomeDesc}</p>
              <button className="px-6 py-3 bg-acc text-white rounded-xl font-medium
                                 hover:bg-acc/90 active:scale-95 transition-all">
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
              <button className="px-6 py-3 bg-acc text-white rounded-xl font-medium
                                 hover:bg-acc/90 active:scale-95 transition-all">
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
    const { userName, location } = useStore.getState().settings;
    fetch('/api/settings', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userName, location, firstRun: false }),
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
