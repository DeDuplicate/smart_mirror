import { create } from 'zustand';

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

const settingsSlice = (set) => ({
  settings: {
    userName: '',
    location: '',
    temperatureUnit: 'celsius',
    showWeekend: true,
    idleTimeout: 300,
    screensaverStyle: 'clock',
    weatherSource: 'openmeteo',
    displaySchedule: { wake: '06:00', sleep: '23:00' },
    darkMode: false,
    loaded: false,
    firstRun: true,
  },
  setSettings: (patch) =>
    set((state) => ({
      settings: { ...state.settings, ...patch },
    })),
  markSettingsLoaded: () =>
    set((state) => ({
      settings: { ...state.settings, loaded: true },
    })),
  markSetupComplete: () =>
    set((state) => ({
      settings: { ...state.settings, firstRun: false },
    })),
  toggleDarkMode: () =>
    set((state) => {
      const next = !state.settings.darkMode;
      if (next) {
        document.documentElement.dataset.theme = 'dark';
      } else {
        delete document.documentElement.dataset.theme;
      }
      return { settings: { ...state.settings, darkMode: next } };
    }),
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
        },
        daily: data.daily ?? [],
        lastUpdated: Date.now(),
      },
    }),
});

// ─── Connection Status Slice ─────────────────────────────────────────────────

const connectionSlice = (set) => ({
  connections: {
    google: 'not_configured',
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
