import React, { Suspense, useEffect, useRef, useState } from 'react';
import { io } from 'socket.io-client';
import useStore, { UPDATE_INITIATOR_KEY, TAB_INDEX, isCameraEnabled } from './store/index.js';
import { TABS } from './components/TabBar.jsx';
import { MusicProvider } from './context/MusicContext.jsx';
import ToastContainer from './components/ToastContainer.jsx';
import ConfirmDialog from './components/ConfirmDialog.jsx';
import ShoppingListPopup, { useShoppingListCount } from './components/ShoppingListPopup.jsx';
import WeatherIcon from './components/WeatherIcon.jsx';
import useWeather from './hooks/useWeather.js';
import useAutoTheme from './hooks/useAutoTheme.js';
import useHealth from './hooks/useHealth.js';
import { applyTheme, normalizeThemeMode, resolveIsDark } from './theme.js';
import t from './i18n/he.json';

// Same order as TAB_INDEX / the kiosk's tab bar.
const PAGES = [
  React.lazy(() => import('./components/pages/CalendarPage.jsx')),
  React.lazy(() => import('./components/pages/TasksPage.jsx')),
  React.lazy(() => import('./components/pages/ChoresPage.jsx')),
  React.lazy(() => import('./components/pages/SchoolPage.jsx')),
  React.lazy(() => import('./components/pages/HomePage.jsx')),
  React.lazy(() => import('./components/pages/MusicPage.jsx')),
  React.lazy(() => import('./components/pages/AlarmsPage.jsx')),
  React.lazy(() => import('./components/pages/NewsPage.jsx')),
  React.lazy(() => import('./components/pages/CamerasPage.jsx')),
  React.lazy(() => import('./components/pages/SettingsPage.jsx')),
];

const TAB_KEY = 'phoneTab';

// The kiosk reaches Settings through the gear in its top bar, so it is not in TABS; on the
// phone it is the last tab (index 9 = TAB_INDEX.settings).
const SETTINGS_TAB = {
  label: t.tabs.settings,
  icon: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="w-6 h-6">
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 11-2.83 2.83l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 01-4 0v-.09a1.65 1.65 0 00-1-1.51 1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 11-2.83-2.83l.06-.06a1.65 1.65 0 00.33-1.82 1.65 1.65 0 00-1.51-1H3a2 2 0 010-4h.09a1.65 1.65 0 001.51-1 1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 112.83-2.83l.06.06a1.65 1.65 0 001.82.33h.01a1.65 1.65 0 001-1.51V3a2 2 0 014 0v.09a1.65 1.65 0 001 1.51h.01a1.65 1.65 0 001.82-.33l.06-.06a2 2 0 112.83 2.83l-.06.06a1.65 1.65 0 00-.33 1.82v.01a1.65 1.65 0 001.51 1H21a2 2 0 010 4h-.09a1.65 1.65 0 00-1.51 1z" />
    </svg>
  ),
};
const PHONE_TABS = [...TABS, SETTINGS_TAB];

function useClock() {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 15_000);
    return () => clearInterval(id);
  }, []);
  return now;
}

function ShoppingButton() {
  const isConfigured = useStore((s) => ['connected', 'degraded'].includes(s.connections.ha));
  const [open, setOpen] = useState(false);
  const anchorRef = useRef(null);
  const count = useShoppingListCount();
  if (!isConfigured) return null;
  return (
    <div className="relative">
      <button
        ref={anchorRef}
        onClick={() => setOpen((v) => !v)}
        className="relative flex items-center justify-center w-11 h-11 rounded-xl text-ts active:scale-95"
        aria-label={t.shoppingList.title}
      >
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="w-6 h-6">
          <path d="M6 2L3 6v14a2 2 0 002 2h14a2 2 0 002-2V6l-3-4z" />
          <line x1="3" y1="6" x2="21" y2="6" />
          <path d="M16 10a4 4 0 01-8 0" />
        </svg>
        {count > 0 && (
          <span className="absolute top-0.5 right-0.5 min-w-[18px] h-[18px] rounded-full bg-acc text-white text-[10px] font-bold flex items-center justify-center px-1 leading-none">
            {count}
          </span>
        )}
      </button>
      <ShoppingListPopup visible={open} onClose={() => setOpen(false)} anchorRef={anchorRef} />
    </div>
  );
}

function Header() {
  const now = useClock();
  const weather = useStore((s) => s.weather.current);
  const unit = useStore((s) => s.settings.temperatureUnit) === 'fahrenheit' ? t.weather.fahrenheit : t.weather.celsius;
  const time = now.toLocaleTimeString('he-IL', { hour: '2-digit', minute: '2-digit', hour12: false });
  const date = now.toLocaleDateString('he-IL', { weekday: 'long', day: 'numeric', month: 'long' });
  return (
    <header className="flex items-center justify-between gap-3 px-4 h-14 shrink-0 bg-surf border-b border-bd">
      <div className="flex flex-col leading-tight min-w-0">
        <span className="text-xl font-bold text-tp font-mono">{time}</span>
        <span className="text-xs text-ts truncate">{date}</span>
      </div>
      <div className="flex items-center gap-1 shrink-0 text-tp">
        <ShoppingButton />
        <WeatherIcon code={weather.code} size={28} />
        <span className="text-lg font-semibold">{weather.temp != null ? `${Math.round(weather.temp)}${unit}` : '—'}</span>
      </div>
    </header>
  );
}

function NavBar({ active, onSelect }) {
  const hasCameras = useStore((s) => s.cameras.some(isCameraEnabled));
  const navRef = useRef(null);
  const activeRef = useRef(null);
  // Centre the active tab by scrolling only this strip (scrollIntoView also scrolled the whole app sideways).
  useEffect(() => {
    const nav = navRef.current;
    const el = activeRef.current;
    if (!nav || !el) return;
    const a = el.getBoundingClientRect();
    const b = nav.getBoundingClientRect();
    nav.scrollBy({ left: a.left + a.width / 2 - (b.left + b.width / 2) });
  }, [active]);
  return (
    <nav
      ref={navRef}
      className="flex shrink-0 overflow-x-auto bg-surf border-t border-bd px-1 pb-[env(safe-area-inset-bottom)]"
      role="tablist"
      style={{ scrollbarWidth: 'none' }}
    >
      {PHONE_TABS.map((tab, i) => {
        if (i === TAB_INDEX.cameras && !hasCameras) return null;
        const on = i === active;
        return (
          <button
            key={i}
            ref={on ? activeRef : null}
            role="tab"
            aria-selected={on}
            onClick={() => onSelect(i)}
            className={`flex flex-col items-center justify-center gap-0.5 shrink-0 min-w-[68px] h-16 px-2 rounded-xl text-[11px] leading-tight select-none
                        ${on ? 'text-acc font-bold bg-lav' : 'text-ts font-medium'}`}
          >
            {tab.icon}
            <span className="max-w-full truncate">{tab.label}</span>
          </button>
        );
      })}
    </nav>
  );
}

// The phone shows every page the kiosk has, so it can be used to look at and control the
// house. It leaves out what the kiosk does on its own (alarms and reminders ringing, the
// screensaver, idle and sleep schedule, touch calibration), so opening it on a phone never
// makes the mirror or the phone make noise. Music is the one page that plays: here it plays
// on the phone, or casts to a speaker like it does on the mirror.
export default function PhoneApp() {
  const setSettings = useStore((s) => s.setSettings);
  const [ready, setReady] = useState(false);
  const [tab, setTab] = useState(() => {
    try {
      const n = Number(localStorage.getItem(TAB_KEY));
      return n >= 0 && n < PAGES.length ? n : 0;
    } catch {
      return 0;
    }
  });

  useWeather();
  useAutoTheme();
  useHealth();

  useEffect(() => {
    fetch('/api/settings')
      .then((res) => (res.ok ? res.json() : Promise.reject(new Error('settings'))))
      .then((body) => {
        const data = body.settings || {};
        const themeMode = normalizeThemeMode(data.themeMode, data.darkMode);
        const darkMode = resolveIsDark({ themeMode, lat: data.latitude, lon: data.longitude });
        setSettings({ ...data, themeMode, darkMode, loaded: true });
        applyTheme(darkMode);
      })
      .catch(() => {})
      .finally(() => setReady(true));
  }, [setSettings]);

  // The Cameras tab appears once a camera is enabled, and a phone left open must pick up an
  // update like the kiosk does (reload on the reconnect that follows the restart).
  useEffect(() => {
    const sock = io('/', { path: '/socket.io', transports: ['websocket', 'polling'], reconnectionAttempts: Infinity, reconnectionDelay: 2000 });
    let reloadOnReconnect = false;
    sock.on('connect', () => {
      useStore.getState().loadCameras();
      if (reloadOnReconnect) window.location.reload();
    });
    sock.on('cameras:updated', () => useStore.getState().loadCameras());
    sock.on('settings:updated', (data) => {
      if (!data || typeof data !== 'object') return;
      const next = { ...useStore.getState().settings, ...data };
      const themeMode = normalizeThemeMode(next.themeMode, next.darkMode);
      setSettings({ ...data, themeMode, darkMode: resolveIsDark({ themeMode, lat: next.latitude, lon: next.longitude }) });
    });
    sock.on('toast', ({ type, message }) => useStore.getState().addToast(type, message));
    sock.on('system:updated', () => {
      let initiated = false;
      try {
        initiated = sessionStorage.getItem(UPDATE_INITIATOR_KEY) === '1';
      } catch {
        // storage blocked: treat as not the initiator and reload
      }
      reloadOnReconnect = !initiated;
    });
    return () => sock.disconnect();
  }, [setSettings]);

  const select = (i) => {
    setTab(i);
    try {
      localStorage.setItem(TAB_KEY, String(i));
    } catch {
      // private mode
    }
  };
  const Page = PAGES[tab] || PAGES[0];

  return (
    <div className="w-full h-full flex flex-col bg-bg overflow-clip relative">
      <Header />
      <MusicProvider>
        <main className="flex-1 overflow-hidden relative min-h-0">
          {ready && (
            <Suspense fallback={<div className="skeleton w-32 h-8 m-6" />}>
              <Page />
            </Suspense>
          )}
        </main>
      </MusicProvider>
      <NavBar active={tab} onSelect={select} />
      <ToastContainer />
      <ConfirmDialog />
    </div>
  );
}
