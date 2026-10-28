import { useEffect, useState } from 'react';
import useStore from './store/index.js';
import SettingsPage from './components/pages/SettingsPage.jsx';
import ToastContainer from './components/ToastContainer.jsx';
import ConfirmDialog from './components/ConfirmDialog.jsx';
import { applyTheme, normalizeThemeMode, resolveIsDark } from './theme.js';

// The phone is for setting things up, so it is only the Settings page. It leaves
// out everything the kiosk does on its own (alarms and reminders ringing,
// screensaver, idle and sleep schedule, celebrations, socket events), so opening
// it on a phone never makes noise or changes what the mirror shows.
export default function PhoneApp() {
  const setSettings = useStore((s) => s.setSettings);
  const [ready, setReady] = useState(false);

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

  return (
    <div className="w-full h-full flex flex-col bg-bg overflow-hidden relative">
      {ready ? <SettingsPage /> : <div className="skeleton w-32 h-8 m-6" />}
      <ToastContainer />
      <ConfirmDialog />
    </div>
  );
}
