import { useEffect } from 'react';
import useStore from '../store/index.js';
import { msUntilNextSunEvent, resolveIsDark } from '../theme.js';

export default function useAutoTheme() {
  const themeMode = useStore((s) => s.settings.themeMode || 'auto');
  const setDarkMode = useStore((s) => s.setDarkMode);
  const daily = useStore((s) => s.weather.daily);
  const isDay = useStore((s) => s.weather.current.isDay);
  const lat = useStore((s) => s.settings.latitude);
  const lon = useStore((s) => s.settings.longitude);

  useEffect(() => {
    const apply = () => {
      setDarkMode(resolveIsDark({ themeMode, daily, isDay, lat, lon }));
    };

    apply();
    const poll = setInterval(apply, 30_000);
    let sunTimer = null;

    if (themeMode === 'auto') {
      const wait = Math.min(msUntilNextSunEvent({ daily, lat, lon }) + 750, 6 * 60 * 60 * 1000);
      sunTimer = setTimeout(apply, wait);
    }

    return () => {
      clearInterval(poll);
      if (sunTimer) clearTimeout(sunTimer);
    };
  }, [themeMode, daily, isDay, lat, lon, setDarkMode]);
}
