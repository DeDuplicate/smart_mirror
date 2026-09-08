import { useEffect, useRef } from 'react';
import { fetchApi } from './useApi.js';
import useStore from '../store/index.js';

const POLL_MS = 10 * 60 * 1000;
const CACHE_TTL_MS = POLL_MS;

function buildUrl(source, units, lat, lon) {
  const params = new URLSearchParams({ units });
  if (lat !== '' && lat != null) params.set('lat', lat);
  if (lon !== '' && lon != null) params.set('lon', lon);
  if (source === 'ims') return `/api/weather/ims?${params}`;
  return `/api/weather?${params}`;
}

function cacheKey(source, units, lat, lon) {
  return [
    'weather_last',
    'v2',
    source,
    units,
    lat !== '' && lat != null ? lat : 'default',
    lon !== '' && lon != null ? lon : 'default',
  ].join(':');
}

function readCache(key) {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed?.data?.current) return null;
    return Date.now() - parsed.savedAt < CACHE_TTL_MS ? parsed.data : null;
  } catch {
    return null;
  }
}

function writeCache(key, data) {
  try {
    localStorage.setItem(key, JSON.stringify({ savedAt: Date.now(), data }));
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
  const settingsLoaded = useStore((s) => s.settings.loaded);

  const failCount = useRef(0);

  useEffect(() => {
    if (!settingsLoaded) return undefined;

    const units = temperatureUnit === 'fahrenheit' ? 'F' : 'C';
    const source = weatherSource === 'ims' ? 'ims' : 'openmeteo';
    const key = cacheKey(source, units, lat, lon);
    const cached = readCache(key);
    if (cached) {
      setWeather(cached);
    } else {
      setWeather({ current: {}, daily: [] });
    }

    let cancelled = false;
    let timer;

    async function load() {
      try {
        const data = await fetchApi(buildUrl(source, units, lat, lon));
        if (cancelled) return;
        if (!data?.current) throw new Error('empty weather');
        setWeather(data);
        if (data.source === 'stale-cache') {
          timer = setTimeout(load, 5_000);
          return;
        }
        writeCache(key, data);
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
  }, [weatherSource, temperatureUnit, lat, lon, settingsLoaded, setWeather]);
}
