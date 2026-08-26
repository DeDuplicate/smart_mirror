import { useState, useEffect, useCallback, useRef } from 'react';
import { fetchApi } from './useApi.js';
import useStore from '../store/index.js';

// ─── useSettings Hook ──────────────────────────────────────────────────────

export default function useSettings() {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const { settings, setSettings, markSettingsLoaded } = useStore();
  const mountedRef = useRef(true);

  // Fetch all settings on mount — but only once per app session. Every
  // Settings section mounts its own useSettings() instance; without this
  // guard each one fires its own GET (redundant load) and a section that
  // remounts (e.g. tab switch away/back) while another section's debounced
  // save is still pending can clobber it with stale data.
  useEffect(() => {
    mountedRef.current = true;
    let cancelled = false;

    if (useStore.getState().settings.loaded) {
      setLoading(false);
      return () => {
        cancelled = true;
        mountedRef.current = false;
      };
    }

    async function load() {
      try {
        setLoading(true);
        const data = await fetchApi('/api/settings');
        if (cancelled) return;
        if (data?.settings) {
          setSettings(data.settings);
          markSettingsLoaded();
        }
        setError(null);
      } catch (err) {
        if (!cancelled) setError(err);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    load();

    return () => {
      cancelled = true;
      mountedRef.current = false;
    };
  }, [setSettings, markSettingsLoaded]);

  // Update a single setting
  const updateSetting = useCallback(
    async (key, value) => {
      // Optimistic local update
      setSettings({ [key]: value });

      try {
        await fetchApi(`/api/settings/${encodeURIComponent(key)}`, {
          method: 'PUT',
          body: JSON.stringify({ value }),
        });
        return true;
      } catch (err) {
        setError(err);
        return false;
      }
    },
    [setSettings]
  );

  // Bulk update settings
  const updateSettings = useCallback(
    async (obj) => {
      // Optimistic local update
      setSettings(obj);

      try {
        await fetchApi('/api/settings', {
          method: 'PUT',
          body: JSON.stringify(obj),
        });
        return true;
      } catch (err) {
        setError(err);
        return false;
      }
    },
    [setSettings]
  );

  return {
    settings,
    loading,
    error,
    updateSetting,
    updateSettings,
  };
}
