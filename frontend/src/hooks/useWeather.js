import { useEffect, useRef } from 'react';
import { fetchApi } from './useApi.js';
import useStore from '../store/index.js';

const POLL_MS = 10 * 60 * 1000;
const CACHE_KEY = 'weather_last';

function buildUrl(source, units, lat, lon) {
  if (source === 'ims') return `/api/weather/ims?units=${units}`;
  const params = new URLSearchParams({ units });
  if (lat) params.set('lat', lat);
  if (lon) params.set('lon', lon);
  return `/api/weather?${params}`;
}

function readCache() {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return parsed?.current ? parsed : null;
  } catch {
    return null;
  }
}

function writeCache(data) {
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify(data));
  } catch {
    // ignore quota
  }
}

export default function useWeather() {
  const setWeather = useStore((s) => s.setWeather);
  const weatherSource = useStore((s) => s.settings.weatherSource) || 'openmeteo';
  const temperatureUnit = useStore((s) => s.settings.temperatureUnit) || 'celsius';
  const lat = useStore((s) => s.settings.latitude);
  const lon = useStore((s) => s.settings.longitude);

  const failCount = useRef(0);

  useEffect(() => {
    const cached = readCache();
    if (cached && useStore.getState().weather.current.temp == null) {
      setWeather(cached);
    }

    let cancelled = false;
    let timer;

    async function load() {
      const units = temperatureUnit === 'fahrenheit' ? 'F' : 'C';
      const primary = weatherSource === 'ims' ? 'ims' : 'openmeteo';
      const fallback = primary === 'ims' ? 'openmeteo' : 'ims';

      try {
        let data = null;
        try {
          data = await fetchApi(buildUrl(primary, units, lat, lon));
        } catch {
          data = await fetchApi(buildUrl(fallback, units, lat, lon));
        }
        if (cancelled) return;
        if (!data?.current) throw new Error('empty weather');
        setWeather(data);
        writeCache(data);
        failCount.current = 0;
        timer = setTimeout(load, POLL_MS);
      } catch {
        if (cancelled) return;
        failCount.current += 1;
        timer = setTimeout(load, Math.min(15_000 * failCount.current, 60_000));
      }
    }

    load();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [weatherSource, temperatureUnit, lat, lon, setWeather]);
}
