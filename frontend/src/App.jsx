import React, { useEffect, useRef, useState, useCallback, Suspense } from 'react';
import { io } from 'socket.io-client';
import './styles/global.css';
import useStore from './store/index.js';
import t from './i18n/he.json';
import TopBar from './components/TopBar.jsx';
import TabBar from './components/TabBar.jsx';
import { MusicProvider } from './context/MusicContext.jsx';
import ToastContainer from './components/ToastContainer.jsx';
import ConfirmDialog from './components/ConfirmDialog.jsx';
import SplashScreen from './components/SplashScreen.jsx';
import { fetchApi } from './hooks/useApi.js';
import useHealth from './hooks/useHealth.js';
import useIdleDetection from './hooks/useIdleDetection.js';
import useDisplaySchedule from './hooks/useDisplaySchedule.js';
import useRippleEffect from './hooks/useRippleEffect.js';
import useAutoTheme from './hooks/useAutoTheme.js';
import useWeather from './hooks/useWeather.js';
import Screensaver from './components/Screensaver.jsx';
import { applyTheme, normalizeThemeMode, resolveIsDark } from './theme.js';

// ─── Lazy-loaded tab pages (code-split per tab) ────────────────────────────
const CalendarPage = React.lazy(() => import('./components/pages/CalendarPage.jsx'));
const TasksPage    = React.lazy(() => import('./components/pages/TasksPage.jsx'));
const ChoresPage   = React.lazy(() => import('./components/pages/ChoresPage.jsx'));
const HomePage     = React.lazy(() => import('./components/pages/HomePage.jsx'));
const MusicPage    = React.lazy(() => import('./components/pages/MusicPage.jsx'));
const NewsPage     = React.lazy(() => import('./components/pages/NewsPage.jsx'));
const SettingsPage = React.lazy(() => import('./components/pages/SettingsPage.jsx'));

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
  ChoresPage,
  HomePage,
  MusicPage,
  NewsPage,
  SettingsPage,
];

// ─── Tab Content with transition ─────────────────────────────────────────────

function TabContent() {
  const activeTab = useStore((s) => s.activeTab);
  const previousTab = useStore((s) => s.previousTab);
  const setActiveTab = useStore((s) => s.setActiveTab);
  const [displayedTab, setDisplayedTab] = useState(activeTab);
  const [animClass, setAnimClass] = useState('');
  const contentRef = useRef(null);
  const touchRef = useRef({ startX: 0, startY: 0 });

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

  // ── Swipe detection for tab navigation ──
  const handleTouchStart = useCallback((e) => {
    const touch = e.touches[0];
    touchRef.current = { startX: touch.clientX, startY: touch.clientY };
  }, []);

  const handleTouchEnd = useCallback((e) => {
    const touch = e.changedTouches[0];
    const dx = touch.clientX - touchRef.current.startX;
    const dy = Math.abs(touch.clientY - touchRef.current.startY);

    // Minimum 50px horizontal, max 30px vertical deviation
    if (Math.abs(dx) < 50 || dy > 30) return;

    const current = useStore.getState().activeTab;
    if (dx < 0 && current < PAGES.length - 1) {
      // Swipe left -> next tab
      setActiveTab(current + 1);
    } else if (dx > 0 && current > 0) {
      // Swipe right -> previous tab
      setActiveTab(current - 1);
    }
  }, [setActiveTab]);

  const ActivePage = PAGES[displayedTab] || PAGES[0];

  return (
    <main
      ref={contentRef}
      className={`flex-1 overflow-hidden relative ${animClass}`}
      onTouchStart={handleTouchStart}
      onTouchEnd={handleTouchEnd}
    >
      <Suspense fallback={<SplashScreen />}>
        <ActivePage />
      </Suspense>
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

  // Home Assistant state
  const [haHost, setHaHost] = useState('');
  const [haToken, setHaToken] = useState('');
  const [haTesting, setHaTesting] = useState(false);
  const [haTestResult, setHaTestResult] = useState(null); // 'ok' | 'fail' | null
  const [haEntities, setHaEntities] = useState(null); // { domain: [...] }
  const [haEntityCount, setHaEntityCount] = useState(0);

  // News sources state — dynamic catalog from backend, not hardcoded, so the
  // wizard and Settings' NewsSection both reflect the same real source list
  // and both write to the same `news_sources` config key.
  const [sourceCatalog, setSourceCatalog] = useState([]);
  const [selectedSources, setSelectedSources] = useState(null); // null = not loaded yet

  useEffect(() => {
    if (step === 5 && sourceCatalog.length === 0) {
      fetch('/api/news/sources')
        .then((res) => res.json())
        .then((data) => {
          setSourceCatalog(data.sources || []);
          setSelectedSources((prev) => prev ?? data.enabled ?? (data.sources || []).map((s) => s.id));
        })
        .catch(() => {});
    }
  }, [step, sourceCatalog.length]);

  const toggleWizardSource = (id, checked) => {
    setSelectedSources((prev) => {
      const base = prev || sourceCatalog.map((s) => s.id);
      return checked ? Array.from(new Set([...base, id])) : base.filter((s) => s !== id);
    });
  };

  const steps = [
    t.setup.welcome,
    t.setup.name,
    t.setup.location,
    t.setup.smartHome,
    t.setup.spotify,
    t.setup.newsSources,
    t.setup.finish,
  ];

  const handleFinish = useCallback(() => {
    const patch = {
      userName: name,
      location,
      firstRun: false,
      news_sources: selectedSources || sourceCatalog.map((s) => s.id),
    };
    // Only include HA settings if the user filled them in
    if (haHost) patch.haHost = haHost;
    if (haToken) patch.haToken = haToken;

    setSettings(patch);
    markSetupComplete();
    if (onComplete) onComplete();
  }, [name, location, haHost, haToken, selectedSources, sourceCatalog, setSettings, markSetupComplete, onComplete]);

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
      <div className="bg-surf rounded-2xl shadow-modal p-10 w-[600px] min-h-[400px] flex flex-col">
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
                {t.setup.smartHome}
              </h2>
              <p className="text-ts mb-6">{t.setup.smartHomeDesc}</p>

              <div className="flex flex-col gap-4">
                {/* Host URL input */}
                <div>
                  <label className="block text-sm font-medium text-ts mb-1.5" dir="rtl">
                    {t.settings.haUrl}
                  </label>
                  <input
                    type="text"
                    value={haHost}
                    onChange={(e) => { setHaHost(e.target.value); setHaTestResult(null); setHaEntities(null); }}
                    placeholder="http://homeassistant.local:8123"
                    className="w-full px-5 py-3 rounded-xl bg-s2 border border-bd text-tp
                               placeholder:text-tm focus:outline-none focus:border-acc
                               transition-colors duration-[var(--dur-fast)] text-sm"
                    dir="ltr"
                  />
                </div>

                {/* Token input (password type) */}
                <div>
                  <label className="block text-sm font-medium text-ts mb-1.5" dir="rtl">
                    {t.settings.haToken}
                  </label>
                  <input
                    type="password"
                    value={haToken}
                    onChange={(e) => { setHaToken(e.target.value); setHaTestResult(null); setHaEntities(null); }}
                    placeholder="eyJ..."
                    className="w-full px-5 py-3 rounded-xl bg-s2 border border-bd text-tp
                               placeholder:text-tm focus:outline-none focus:border-acc
                               transition-colors duration-[var(--dur-fast)] text-sm"
                    dir="ltr"
                  />
                </div>

                {/* Test Connection button */}
                <button
                  onClick={async () => {
                    if (!haHost || !haToken) return;
                    setHaTesting(true);
                    setHaTestResult(null);
                    setHaEntities(null);
                    try {
                      // Save HA settings first so the backend can use them
                      await fetchApi('/api/settings', {
                        method: 'PUT',
                        body: JSON.stringify({ haHost, haToken }),
                      });
                      // Test the connection
                      const data = await fetchApi('/api/ha/states');
                      setHaTestResult('ok');
                      // Fetch entity discovery
                      try {
                        const entData = await fetchApi('/api/ha/entities');
                        setHaEntities(entData.entities || {});
                        setHaEntityCount(entData.total || 0);
                      } catch {
                        // entities fetch failed but connection is OK
                      }
                    } catch {
                      setHaTestResult('fail');
                    } finally {
                      setHaTesting(false);
                    }
                  }}
                  disabled={haTesting || !haHost || !haToken}
                  className="px-6 min-h-[48px] bg-acc text-white rounded-xl font-medium
                             hover:bg-acc/90 active:scale-95 transition-all
                             disabled:opacity-50 disabled:cursor-not-allowed
                             flex items-center gap-2 self-start"
                  style={{ transitionDuration: 'var(--dur-fast)' }}
                >
                  {haTesting ? (
                    <svg className="w-5 h-5 animate-spin" viewBox="0 0 24 24" fill="none">
                      <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" strokeDasharray="31.4 31.4" strokeLinecap="round" />
                    </svg>
                  ) : (
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
                      strokeLinecap="round" strokeLinejoin="round" className="w-5 h-5">
                      <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
                      <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
                    </svg>
                  )}
                  <span>{t.settings.testConnection}</span>
                </button>

                {/* Test result feedback */}
                {haTestResult === 'ok' && (
                  <div className="px-4 py-3 rounded-xl text-sm font-medium"
                       style={{ backgroundColor: 'var(--mint-bg)', color: 'var(--mint-d)' }}>
                    {t.settings.haConnectionOk}
                  </div>
                )}
                {haTestResult === 'fail' && (
                  <div className="px-4 py-3 rounded-xl text-sm font-medium"
                       style={{ backgroundColor: 'var(--coral-bg)', color: 'var(--coral-d)' }}>
                    {t.settings.haConnectionFail}
                  </div>
                )}

                {/* Entity auto-discovery list */}
                {haEntities && Object.keys(haEntities).length > 0 && (
                  <div className="mt-2">
                    <p className="text-sm text-ts mb-2 font-medium" dir="rtl">
                      {haEntityCount} entities
                    </p>
                    <div className="bg-s2 border border-bd rounded-xl p-3 max-h-[160px] overflow-y-auto
                                    flex flex-wrap gap-2">
                      {Object.entries(haEntities).map(([domain, entities]) => (
                        <span
                          key={domain}
                          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full
                                     text-xs font-medium bg-acc/10 text-acc"
                        >
                          {domain}
                          <span className="text-acc/60">({entities.length})</span>
                        </span>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}

          {step === 4 && (
            <div>
              <h2 className="text-2xl font-semibold text-tp mb-3">
                {t.setup.spotify}
              </h2>
              <p className="text-ts mb-6">{t.setup.spotifyDesc}</p>
              <div className="flex items-center gap-3 bg-s2 border border-bd rounded-xl px-5 py-4">
                <div className="w-10 h-10 rounded-full flex items-center justify-center shrink-0"
                     style={{ backgroundColor: 'var(--mint-bg)' }}>
                  <svg viewBox="0 0 24 24" fill="currentColor" className="w-5 h-5" style={{ color: 'var(--mint-d)' }}>
                    <path d="M12 3v10.55A4 4 0 1 0 14 17V7h4V3h-6z" />
                  </svg>
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-tp font-medium text-sm">{t.music.youtubeMusic}</p>
                  <p className="text-ts text-xs mt-0.5">{t.music.searchHint}</p>
                </div>
                <span className="shrink-0 px-3 py-1 rounded-full text-xs font-semibold"
                  style={{ backgroundColor: 'var(--mint-bg)', color: 'var(--mint-d)' }}>
                  {t.setup.connected}
                </span>
              </div>
            </div>
          )}

          {step === 5 && (
            <div>
              <h2 className="text-2xl font-semibold text-tp mb-3">
                {t.setup.newsSources}
              </h2>
              <p className="text-ts mb-6">{t.setup.newsSourcesDesc}</p>

              <div className="flex flex-col divide-y divide-bd bg-s2 border border-bd rounded-xl overflow-hidden max-h-[280px] overflow-y-auto">
                {sourceCatalog.length === 0 && (
                  <div className="px-5 py-4 text-sm text-ts">{t.common.loading}</div>
                )}
                {sourceCatalog.map((src) => {
                  const checked = (selectedSources || []).includes(src.id);
                  return (
                    <label
                      key={src.id}
                      className="flex items-center justify-between px-5 py-4 cursor-pointer
                                  hover:bg-surf transition-colors duration-[var(--dur-fast)]"
                    >
                      <span className="text-tp font-medium text-sm">{src.name}</span>
                      <div className="relative">
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={(e) => toggleWizardSource(src.id, e.target.checked)}
                          className="sr-only peer"
                        />
                        <div className="w-11 h-6 rounded-full bg-bd peer-checked:bg-acc
                                        transition-colors duration-[var(--dur-fast)]" />
                        <div className="absolute top-0.5 left-0.5 w-5 h-5 rounded-full bg-white shadow-card
                                        peer-checked:translate-x-5 transition-transform duration-[var(--dur-fast)]" />
                      </div>
                    </label>
                  );
                })}
              </div>
            </div>
          )}

          {step === 6 && (
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
            {step > 2 && step < 6 && (
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
  const screensaverStyle = useStore((s) => s.settings.screensaverStyle) || 'clock';
  const [showWizard, setShowWizard] = useState(false);
  const [isOffline, setIsOffline] = useState(!navigator.onLine);

  useRippleEffect();
  useAutoTheme();
  useWeather();

  // ── Offline / online detection ──
  useEffect(() => {
    const goOffline = () => setIsOffline(true);
    const goOnline  = () => setIsOffline(false);
    window.addEventListener('offline', goOffline);
    window.addEventListener('online',  goOnline);
    return () => {
      window.removeEventListener('offline', goOffline);
      window.removeEventListener('online',  goOnline);
    };
  }, []);

  // ── Multi-resolution scale ──
  useEffect(() => {
    function updateScale() {
      const root = document.getElementById('root');
      if (!root) return;
      root.style.setProperty('--app-scale-x', String(window.innerWidth / 1920));
      root.style.setProperty('--app-scale-y', String(window.innerHeight / 1080));
    }
    updateScale();
    window.addEventListener('resize', updateScale);
    return () => window.removeEventListener('resize', updateScale);
  }, []);

  // ── Global error handlers — surface unhandled errors as toasts ──
  useEffect(() => {
    // Patterns we don't want to surface (non-actionable noise)
    const IGNORED = [
      /ResizeObserver loop/i,
      /Network request failed/i,
      /Failed to fetch/i,
      /Load failed/i,
      /timeout.*home.?assistant/i,
      /home.?assistant.*timeout/i,
    ];

    function shouldIgnore(msg) {
      if (!msg) return true;
      return IGNORED.some((re) => re.test(msg));
    }

    function handleError(event) {
      const msg = event?.message || String(event);
      if (shouldIgnore(msg)) return;
      addToast('error', msg);
    }

    function handleRejection(event) {
      const msg =
        event?.reason?.message ||
        (typeof event?.reason === 'string' ? event.reason : null);
      if (shouldIgnore(msg)) return;
      addToast('error', msg || t.errors.noConnection);
    }

    window.addEventListener('error', handleError);
    window.addEventListener('unhandledrejection', handleRejection);

    return () => {
      window.removeEventListener('error', handleError);
      window.removeEventListener('unhandledrejection', handleRejection);
    };
  }, [addToast]);

  // ── Health polling ──
  useHealth();

  // After a same-window OAuth redirect (kiosk / popup-blocked), land back
  // here with ?spotify=linked and restore the settings tab.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const spotify = params.get('spotify');
    if (!spotify) return;

    if (spotify === 'linked') {
      useStore.getState().setConnectionStatus('spotify', 'connected');
      useStore.getState().setActiveTab(6);
      useStore.getState().addToast('success', t.settings.spotifyConnected);
    }

    params.delete('spotify');
    const next = `${window.location.pathname}${params.toString() ? `?${params}` : ''}${window.location.hash}`;
    window.history.replaceState({}, '', next);
  }, []);

  // ── Idle detection & display schedule ──
  const { isIdle, resetIdle } = useIdleDetection();
  const { isSleeping, wakeTemporarily } = useDisplaySchedule();

  // Show screensaver when idle or sleeping (but not during wizard)
  const showScreensaver = !showWizard && (isIdle || isSleeping);

  const handleScreensaverDismiss = useCallback(() => {
    resetIdle();
    if (isSleeping) wakeTemporarily();
  }, [resetIdle, isSleeping, wakeTemporarily]);

  // ── Fetch initial settings from backend ──
  useEffect(() => {
    fetch('/api/settings')
      .then((res) => {
        if (!res.ok) throw new Error('Settings fetch failed');
        return res.json();
      })
      .then((body) => {
        // The API wraps the payload as { settings: {...} } — unwrap it. This
        // was previously read as the raw response, so `data.firstRun` was
        // always undefined and the onboarding wizard reopened on every load.
        let data = body.settings || {};
        const themeMode = normalizeThemeMode(data.themeMode, data.darkMode);
        const darkMode = resolveIsDark({
          themeMode,
          lat: data.latitude,
          lon: data.longitude,
        });
        data = { ...data, themeMode, darkMode };

        setSettings({ ...data, loaded: true });
        applyTheme(darkMode);
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

    const applySettingsPatch = (data) => {
      if (!data || typeof data !== 'object') return;
      const current = useStore.getState().settings;
      const next = { ...current, ...data };
      const themeMode = normalizeThemeMode(next.themeMode, next.darkMode);
      const darkMode = resolveIsDark({
        themeMode,
        daily: useStore.getState().weather.daily,
        isDay: useStore.getState().weather.current.isDay,
        lat: next.latitude,
        lon: next.longitude,
      });
      setSettings({ ...data, themeMode, darkMode });
      applyTheme(darkMode);
    };
    sock.on('settings:update', applySettingsPatch);
    sock.on('settings:updated', applySettingsPatch);

    sock.on('toast', ({ type, message }) => {
      addToast(type, message);
    });

    return () => {
      sock.off('connect');
      sock.off('disconnect');
      sock.off('weather:update');
      sock.off('connections:status');
      sock.off('settings:update');
      sock.off('settings:updated');
      sock.off('toast');
    };
  }, [setWeather, setConnectionStatus, setAllConnectionStatuses, setSettings, addToast]);

  // ── Socket.io heartbeat every 15 seconds ──
  useEffect(() => {
    const sock = getSocket();
    const interval = setInterval(() => {
      sock.emit('heartbeat');
    }, 15000);
    return () => clearInterval(interval);
  }, []);

  // ── Wizard complete handler ──
  const handleWizardComplete = useCallback(() => {
    setShowWizard(false);
    // Persist settings to backend
    const s = useStore.getState().settings;
    const payload = {
      userName: s.userName,
      location: s.location,
      firstRun: false,
    };
    // Include HA settings if configured
    if (s.haHost) payload.haHost = s.haHost;
    if (s.haToken) payload.haToken = s.haToken;
    // Include news source preferences
    if (s.news_sources !== undefined) payload.news_sources = s.news_sources;

    fetch('/api/settings', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
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
    <div className="w-[1920px] h-[1080px] flex flex-col bg-bg overflow-hidden relative">
      {/* Setup Wizard overlay */}
      {showWizard && <SetupWizard onComplete={handleWizardComplete} />}

      {/* Offline indicator */}
      {isOffline && (
        <div
          className="absolute top-0 left-0 right-0 z-50 flex items-center justify-center gap-2
                     bg-red-600/90 text-white text-sm font-semibold py-1 px-4"
          style={{ height: '28px' }}
        >
          <span
            className="inline-block w-2 h-2 rounded-full bg-white shrink-0"
            style={{ boxShadow: '0 0 6px 2px rgba(255,255,255,0.7)' }}
          />
          {t.errors?.noConnection ?? 'אין חיבור לרשת'}
        </div>
      )}

      {/* Main layout */}
      <MusicProvider>
        <TopBar />
        <TabBar />
        <TabContent />
      </MusicProvider>

      {/* Screensaver */}
      {showScreensaver && (
        <Screensaver
          style={screensaverStyle}
          onDismiss={handleScreensaverDismiss}
        />
      )}

      {/* Overlays */}
      <ToastContainer />
      <ConfirmDialog />
    </div>
  );
}
