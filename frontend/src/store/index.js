import { create } from 'zustand';
import {
  applyTheme,
  nextThemeMode,
  normalizeThemeMode,
  resolveIsDark,
} from '../theme.js';

// Settings slider is 1–30 minutes. Legacy values were stored as seconds
// (e.g. 300). Convert those so the hook and UI stay in sync.
export function normalizeIdleMinutes(value) {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return 5;
  if (n > 30) return Math.min(30, Math.max(1, Math.round(n / 60)));
  return Math.min(30, Math.max(1, Math.round(n)));
}

// ─── Tab Slice ───────────────────────────────────────────────────────────────

const tabSlice = (set) => ({
  activeTab: 0,
  previousTab: -1,
  setActiveTab: (index) =>
    set((state) => ({
      previousTab: state.activeTab,
      activeTab: index,
    })),
});

// ─── Toast Slice ─────────────────────────────────────────────────────────────

let toastId = 0;

const toastSlice = (set, get) => ({
  toasts: [],
  addToast: (type, message, duration = 4000) => {
    const id = ++toastId;
    set((state) => ({
      toasts: [...state.toasts, { id, type, message, exiting: false }],
    }));
    // Auto-dismiss after duration
    setTimeout(() => {
      // Mark as exiting for animation
      set((state) => ({
        toasts: state.toasts.map((t) =>
          t.id === id ? { ...t, exiting: true } : t
        ),
      }));
      // Remove after exit animation completes
      setTimeout(() => {
        set((state) => ({
          toasts: state.toasts.filter((t) => t.id !== id),
        }));
      }, 250);
    }, duration);
    return id;
  },
  removeToast: (id) => {
    set((state) => ({
      toasts: state.toasts.map((t) =>
        t.id === id ? { ...t, exiting: true } : t
      ),
    }));
    setTimeout(() => {
      set((state) => ({
        toasts: state.toasts.filter((t) => t.id !== id),
      }));
    }, 250);
  },
});

// ─── Confirm Dialog Slice ────────────────────────────────────────────────────

const confirmSlice = (set) => ({
  confirm: {
    isOpen: false,
    title: '',
    message: '',
    onConfirm: null,
  },
  showConfirm: ({ title, message, onConfirm }) =>
    set({
      confirm: {
        isOpen: true,
        title,
        message,
        onConfirm,
      },
    }),
  hideConfirm: () =>
    set({
      confirm: {
        isOpen: false,
        title: '',
        message: '',
        onConfirm: null,
      },
    }),
});

// ─── Settings Slice ──────────────────────────────────────────────────────────

const settingsSlice = (set, get) => ({
  settings: {
    userName: '',
    location: '',
    temperatureUnit: 'celsius',
    showWeekend: true,
    idleTimeout: 5,
    screensaverStyle: 'clock',
    weatherSource: 'openmeteo',
    displaySchedule: { wake: '06:00', sleep: '23:00' },
    themeMode: 'auto',
    darkMode: false,
    loaded: false,
    firstRun: true,
  },
  setSettings: (patch) =>
    set((state) => {
      const settings = { ...state.settings, ...patch };
      if ('idleTimeout' in patch || settings.idleTimeout != null) {
        settings.idleTimeout = normalizeIdleMinutes(settings.idleTimeout);
      }
      if ('themeMode' in patch || 'darkMode' in patch) {
        const themeMode = normalizeThemeMode(settings.themeMode, settings.darkMode);
        const darkMode = resolveIsDark({
          themeMode,
          daily: state.weather.daily,
          isDay: state.weather.current.isDay,
          lat: settings.latitude,
          lon: settings.longitude,
        });
        applyTheme(darkMode);
        settings.themeMode = themeMode;
        settings.darkMode = darkMode;
      }
      return { settings };
    }),
  markSettingsLoaded: () =>
    set((state) => ({
      settings: { ...state.settings, loaded: true },
    })),
  markSetupComplete: () =>
    set((state) => ({
      settings: { ...state.settings, firstRun: false },
    })),
  setDarkMode: (next) =>
    set((state) => {
      const isDark = !!next;
      if (state.settings.darkMode === isDark) return state;
      applyTheme(isDark);
      return { settings: { ...state.settings, darkMode: isDark } };
    }),
  setThemeMode: (mode) =>
    set((state) => {
      const themeMode = normalizeThemeMode(mode, state.settings.darkMode);
      const isDark = resolveIsDark({
        themeMode,
        daily: state.weather.daily,
        isDay: state.weather.current.isDay,
        lat: state.settings.latitude,
        lon: state.settings.longitude,
      });
      applyTheme(isDark);
      return { settings: { ...state.settings, themeMode, darkMode: isDark } };
    }),
  cycleThemeMode: () => {
    const current = normalizeThemeMode(
      get().settings.themeMode,
      get().settings.darkMode
    );
    const next = nextThemeMode(current);
    get().setThemeMode(next);
    return next;
  },
  toggleDarkMode: () => {
    const next = get().settings.darkMode ? 'light' : 'dark';
    get().setThemeMode(next);
    return next;
  },
});

// ─── Weather Slice ───────────────────────────────────────────────────────────

const weatherSlice = (set) => ({
  weather: {
    current: {
      temp: null,
      code: null,
      humidity: null,
      wind: null,
      feelsLike: null,
      isDay: null,
    },
    daily: [],
    lastUpdated: null,
  },
  setWeather: (data) =>
    set({
      weather: {
        current: {
          temp: data.current?.temp ?? null,
          code: data.current?.code ?? null,
          humidity: data.current?.humidity ?? null,
          wind: data.current?.wind ?? null,
          feelsLike: data.current?.feelsLike ?? null,
          isDay: typeof data.current?.isDay === 'boolean' ? data.current.isDay : null,
        },
        daily: data.daily ?? [],
        lastUpdated: Date.now(),
      },
    }),
});

// ─── Connection Status Slice ─────────────────────────────────────────────────

const connectionSlice = (set) => ({
  connections: {
    ha: 'not_configured',
    spotify: 'not_configured',
    wifi: 'not_configured',
  },
  setConnectionStatus: (service, status) =>
    set((state) => ({
      connections: {
        ...state.connections,
        [service]: status,
      },
    })),
  setAllConnectionStatuses: (statuses) =>
    set((state) => ({
      connections: {
        ...state.connections,
        ...statuses,
      },
    })),
});

// ─── Combined Store ──────────────────────────────────────────────────────────

const useStore = create((...args) => ({
  ...tabSlice(...args),
  ...toastSlice(...args),
  ...confirmSlice(...args),
  ...settingsSlice(...args),
  ...weatherSlice(...args),
  ...connectionSlice(...args),
}));

export default useStore;
