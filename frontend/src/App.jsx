import React, { useEffect, useRef, useState, useCallback, Suspense } from 'react';
import { io } from 'socket.io-client';
import './styles/global.css';
import useStore from './store/index.js';
import t from './i18n/he.json';
import TopBar from './components/TopBar.jsx';
import TabBar from './components/TabBar.jsx';
import ToastContainer from './components/ToastContainer.jsx';
import ConfirmDialog from './components/ConfirmDialog.jsx';
import OAuthOverlay from './components/OAuthOverlay.jsx';
import SplashScreen from './components/SplashScreen.jsx';
import useAuth from './hooks/useAuth.js';
import { fetchApi } from './hooks/useApi.js';
import useHealth from './hooks/useHealth.js';
import useIdleDetection from './hooks/useIdleDetection.js';
import useDisplaySchedule from './hooks/useDisplaySchedule.js';
import Screensaver from './components/Screensaver.jsx';

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

  // Home Assistant state
  const [haHost, setHaHost] = useState('');
  const [haToken, setHaToken] = useState('');
  const [haTesting, setHaTesting] = useState(false);
  const [haTestResult, setHaTestResult] = useState(null); // 'ok' | 'fail' | null
  const [haEntities, setHaEntities] = useState(null); // { domain: [...] }
  const [haEntityCount, setHaEntityCount] = useState(0);

  // Spotify state
  const [spotifyConnected, setSpotifyConnected] = useState(false);

  // News sources state
  const [newsYnet, setNewsYnet] = useState(true);
  const [newsNow14, setNewsNow14] = useState(false);

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
    const patch = {
      userName: name,
      location,
      firstRun: false,
      calendarColors: calendarColors,
      newsYnet,
      newsNow14,
    };
    // Only include HA settings if the user filled them in
    if (haHost) patch.haHost = haHost;
    if (haToken) patch.haToken = haToken;

    setSettings(patch);
    markSetupComplete();
    if (onComplete) onComplete();
  }, [name, location, calendarColors, haHost, haToken, newsYnet, newsNow14, setSettings, markSetupComplete, onComplete]);

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
                          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg
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

          {step === 5 && (
            <div>
              <h2 className="text-2xl font-semibold text-tp mb-3">
                {t.setup.spotify}
              </h2>
              <p className="text-ts mb-6">{t.setup.spotifyDesc}</p>

              {spotifyConnected ? (
                <div className="flex items-center gap-3 bg-s2 border border-bd rounded-xl px-5 py-4">
                  {/* Spotify icon */}
                  <div className="w-10 h-10 rounded-full flex items-center justify-center shrink-0"
                       style={{ backgroundColor: 'var(--mint-bg)' }}>
                    <svg viewBox="0 0 24 24" className="w-5 h-5" style={{ color: 'var(--mint-d)' }}>
                      <path fill="currentColor" d="M12 0C5.4 0 0 5.4 0 12s5.4 12 12 12 12-5.4 12-12S18.66 0 12 0zm5.521 17.34c-.24.359-.66.48-1.021.24-2.82-1.74-6.36-2.101-10.561-1.141-.418.122-.779-.179-.899-.539-.12-.421.18-.78.54-.9 4.56-1.021 8.52-.6 11.64 1.32.42.18.479.659.301 1.02zm1.44-3.3c-.301.42-.841.6-1.262.3-3.239-1.98-8.159-2.58-11.939-1.38-.479.12-1.02-.12-1.14-.6-.12-.48.12-1.021.6-1.141C9.6 9.9 15 10.561 18.72 12.84c.361.181.54.78.241 1.2zm.12-3.36C15.24 8.4 8.82 8.16 5.16 9.301c-.6.179-1.2-.181-1.38-.721-.18-.601.18-1.2.72-1.381 4.26-1.26 11.28-1.02 15.721 1.621.539.3.719 1.02.419 1.56-.299.421-1.02.599-1.559.3z"/>
                    </svg>
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-tp font-medium text-sm">{t.settings.spotify}</p>
                  </div>
                  <span className="shrink-0 px-3 py-1 rounded-full text-xs font-semibold"
                    style={{ backgroundColor: 'var(--mint-bg)', color: 'var(--mint-d)' }}>
                    {t.setup.connected}
                  </span>
                </div>
              ) : (
                <div className="flex flex-col gap-3">
                  {/* Auth error */}
                  {auth.error && auth.provider === 'spotify' && (
                    <div className="px-4 py-3 rounded-xl text-sm font-medium"
                         style={{ backgroundColor: 'var(--coral-bg)', color: 'var(--coral-d)' }}>
                      {t.setup.authError}: {auth.error}
                    </div>
                  )}

                  <button
                    onClick={() => {
                      auth.startSpotifyAuth(() => {
                        setSpotifyConnected(true);
                      });
                    }}
                    disabled={auth.isAuthenticating}
                    className="px-6 min-h-[56px] bg-acc text-white rounded-xl font-medium
                               hover:bg-acc/90 active:scale-95 transition-all
                               disabled:opacity-50 disabled:cursor-not-allowed
                               flex items-center gap-3 self-start"
                    style={{ transitionDuration: 'var(--dur-fast)' }}
                  >
                    {auth.isAuthenticating && auth.provider === 'spotify' ? (
                      <svg className="w-5 h-5 animate-spin" viewBox="0 0 24 24" fill="none">
                        <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" strokeDasharray="31.4 31.4" strokeLinecap="round" />
                      </svg>
                    ) : (
                      <svg viewBox="0 0 24 24" className="w-5 h-5 shrink-0">
                        <path fill="currentColor" d="M12 0C5.4 0 0 5.4 0 12s5.4 12 12 12 12-5.4 12-12S18.66 0 12 0zm5.521 17.34c-.24.359-.66.48-1.021.24-2.82-1.74-6.36-2.101-10.561-1.141-.418.122-.779-.179-.899-.539-.12-.421.18-.78.54-.9 4.56-1.021 8.52-.6 11.64 1.32.42.18.479.659.301 1.02zm1.44-3.3c-.301.42-.841.6-1.262.3-3.239-1.98-8.159-2.58-11.939-1.38-.479.12-1.02-.12-1.14-.6-.12-.48.12-1.021.6-1.141C9.6 9.9 15 10.561 18.72 12.84c.361.181.54.78.241 1.2zm.12-3.36C15.24 8.4 8.82 8.16 5.16 9.301c-.6.179-1.2-.181-1.38-.721-.18-.601.18-1.2.72-1.381 4.26-1.26 11.28-1.02 15.721 1.621.539.3.719 1.02.419 1.56-.299.421-1.02.599-1.559.3z"/>
                      </svg>
                    )}
                    <span>{t.settings.connectSpotify}</span>
                  </button>
                </div>
              )}
            </div>
          )}

          {step === 6 && (
            <div>
              <h2 className="text-2xl font-semibold text-tp mb-3">
                {t.setup.newsSources}
              </h2>
              <p className="text-ts mb-6">{t.setup.newsSourcesDesc}</p>

              <div className="flex flex-col divide-y divide-bd bg-s2 border border-bd rounded-xl overflow-hidden">
                {/* Ynet toggle */}
                <label className="flex items-center justify-between px-5 py-4 cursor-pointer
                                  hover:bg-surf transition-colors duration-[var(--dur-fast)]">
                  <span className="text-tp font-medium text-sm">{t.settings.sourceYnet}</span>
                  <div className="relative">
                    <input
                      type="checkbox"
                      checked={newsYnet}
                      onChange={(e) => setNewsYnet(e.target.checked)}
                      className="sr-only peer"
                    />
                    <div className="w-11 h-6 rounded-full bg-bd peer-checked:bg-acc
                                    transition-colors duration-[var(--dur-fast)]" />
                    <div className="absolute top-0.5 left-0.5 w-5 h-5 rounded-full bg-white shadow
                                    peer-checked:translate-x-5 transition-transform duration-[var(--dur-fast)]" />
                  </div>
                </label>

                {/* Channel 14 toggle */}
                <label className="flex items-center justify-between px-5 py-4 cursor-pointer
                                  hover:bg-surf transition-colors duration-[var(--dur-fast)]">
                  <span className="text-tp font-medium text-sm">{t.settings.sourceNow14}</span>
                  <div className="relative">
                    <input
                      type="checkbox"
                      checked={newsNow14}
                      onChange={(e) => setNewsNow14(e.target.checked)}
                      className="sr-only peer"
                    />
                    <div className="w-11 h-6 rounded-full bg-bd peer-checked:bg-acc
                                    transition-colors duration-[var(--dur-fast)]" />
                    <div className="absolute top-0.5 left-0.5 w-5 h-5 rounded-full bg-white shadow
                                    peer-checked:translate-x-5 transition-transform duration-[var(--dur-fast)]" />
                  </div>
                </label>
              </div>
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
  const screensaverStyle = useStore((s) => s.settings.screensaverStyle) || 'clock';
  const [showWizard, setShowWizard] = useState(false);

  // ── Multi-resolution scale ──
  useEffect(() => {
    function updateScale() {
      const sx = window.innerWidth / 1920;
      const sy = window.innerHeight / 1080;
      const scale = Math.min(sx, sy);
      document.getElementById('root')?.style.setProperty('--app-scale', String(scale));
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
      .then((data) => {
        // If darkMode has never been set, auto-detect from system preference
        let { darkMode } = data;
        if (darkMode == null) {
          darkMode = window.matchMedia('(prefers-color-scheme: dark)').matches;
          data = { ...data, darkMode };
        }

        setSettings({ ...data, loaded: true });
        // Apply dark mode theme before first paint
        if (darkMode) {
          document.documentElement.dataset.theme = 'dark';
        } else {
          delete document.documentElement.dataset.theme;
        }
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

  // ── Socket.io heartbeat every 15 seconds ──
  useEffect(() => {
    const sock = getSocket();
    const interval = setInterval(() => {
      sock.emit('heartbeat');
    }, 15000);
    return () => clearInterval(interval);
  }, []);

  // ── Weather polling (respects weatherSource setting) ──
  const weatherSource = useStore((s) => s.settings.weatherSource) || 'openmeteo';
  const temperatureUnit = useStore((s) => s.settings.temperatureUnit) || 'celsius';

  useEffect(() => {
    if (!settingsLoaded) return;
    let mounted = true;

    async function fetchWeather() {
      try {
        const units = temperatureUnit === 'fahrenheit' ? 'F' : 'C';
        let url;
        if (weatherSource === 'ims') {
          url = `/api/weather/ims?units=${units}`;
        } else {
          url = `/api/weather?units=${units}`;
        }
        const data = await fetchApi(url);
        if (!mounted) return;
        if (data?.current) {
          setWeather(data);
        }
      } catch {
        // Silently fail — weather will update on next poll
      }
    }

    fetchWeather();
    const interval = setInterval(fetchWeather, 10 * 60 * 1000); // 10 minutes

    return () => {
      mounted = false;
      clearInterval(interval);
    };
  }, [settingsLoaded, weatherSource, temperatureUnit, setWeather]);

  // ── Wizard complete handler ──
  const handleWizardComplete = useCallback(() => {
    setShowWizard(false);
    // Persist settings to backend
    const s = useStore.getState().settings;
    const payload = {
      userName: s.userName,
      location: s.location,
      calendarColors: s.calendarColors,
      firstRun: false,
    };
    // Include HA settings if configured
    if (s.haHost) payload.haHost = s.haHost;
    if (s.haToken) payload.haToken = s.haToken;
    // Include news source preferences
    if (s.newsYnet !== undefined) payload.newsYnet = s.newsYnet;
    if (s.newsNow14 !== undefined) payload.newsNow14 = s.newsNow14;

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
    <div className="w-[1920px] h-[1080px] flex flex-col bg-bg overflow-hidden">
      {/* Setup Wizard overlay */}
      {showWizard && <SetupWizard onComplete={handleWizardComplete} />}

      {/* Main layout */}
      <TopBar />
      <TabBar />
      <TabContent />

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
