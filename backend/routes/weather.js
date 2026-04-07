'use strict';

const { Router } = require('express');
const router = Router();

const OPEN_METEO_API = 'https://api.open-meteo.com/v1/forecast';
const CACHE_TTL_MS = 10 * 60 * 1000; // 10 minutes

// ---------------------------------------------------------------------------
// WMO Weather Code → description + icon
// ---------------------------------------------------------------------------
const WMO_CODES = {
  0:  { description: 'Clear sky',                    icon: '☀️' },
  1:  { description: 'Mainly clear',                 icon: '🌤️' },
  2:  { description: 'Partly cloudy',                icon: '⛅' },
  3:  { description: 'Overcast',                     icon: '☁️' },
  45: { description: 'Foggy',                        icon: '🌫️' },
  48: { description: 'Depositing rime fog',           icon: '🌫️' },
  51: { description: 'Light drizzle',                icon: '🌧️' },
  53: { description: 'Moderate drizzle',             icon: '🌧️' },
  55: { description: 'Dense drizzle',                icon: '🌧️' },
  56: { description: 'Light freezing drizzle',       icon: '🌧️' },
  57: { description: 'Dense freezing drizzle',       icon: '🌧️' },
  61: { description: 'Slight rain',                  icon: '🌧️' },
  63: { description: 'Moderate rain',                icon: '🌧️' },
  65: { description: 'Heavy rain',                   icon: '🌧️' },
  66: { description: 'Light freezing rain',          icon: '🌧️' },
  67: { description: 'Heavy freezing rain',          icon: '🌧️' },
  71: { description: 'Slight snowfall',              icon: '❄️' },
  73: { description: 'Moderate snowfall',            icon: '❄️' },
  75: { description: 'Heavy snowfall',               icon: '❄️' },
  77: { description: 'Snow grains',                  icon: '❄️' },
  80: { description: 'Slight rain showers',          icon: '🌦️' },
  81: { description: 'Moderate rain showers',        icon: '🌦️' },
  82: { description: 'Violent rain showers',         icon: '🌦️' },
  85: { description: 'Slight snow showers',          icon: '❄️' },
  86: { description: 'Heavy snow showers',           icon: '❄️' },
  95: { description: 'Thunderstorm',                 icon: '⛈️' },
  96: { description: 'Thunderstorm with slight hail',icon: '⛈️' },
  99: { description: 'Thunderstorm with heavy hail', icon: '⛈️' },
};

function wmoDescription(code) {
  return WMO_CODES[code]?.description ?? 'Unknown';
}

function wmoIcon(code) {
  return WMO_CODES[code]?.icon ?? '🌤️';
}

// ---------------------------------------------------------------------------
// Cache helpers — always read/write raw rows so stale data is accessible
// ---------------------------------------------------------------------------

/**
 * Returns { data, isStale } where data is null if nothing cached.
 * isStale is true when the row exists but is past TTL.
 */
function getCacheRow(db, key) {
  const row = db.prepare('SELECT data, fetched_at FROM cache WHERE key = ?').get(key);
  if (!row) return { data: null, isStale: false };
  try {
    const data = JSON.parse(row.data);
    const isStale = Date.now() - row.fetched_at > CACHE_TTL_MS;
    return { data, isStale };
  } catch {
    return { data: null, isStale: false };
  }
}

function setCache(db, key, data) {
  db.prepare(
    'INSERT OR REPLACE INTO cache (key, data, fetched_at) VALUES (?, ?, ?)'
  ).run(key, JSON.stringify(data), Date.now());
}

// ---------------------------------------------------------------------------
// Shape raw Open-Meteo response into the canonical response object
// ---------------------------------------------------------------------------
function shapeResponse(raw, lat, lon, units) {
  const cur = raw.current ?? {};
  const daily = raw.daily ?? {};

  return {
    location: { lat, lon, timezone: raw.timezone ?? 'auto' },
    units: units === 'fahrenheit' ? 'F' : 'C',
    current: {
      // Names aligned with store's setWeather() expectations
      temp:        cur.temperature_2m       ?? null,
      feelsLike:   cur.apparent_temperature ?? null,
      humidity:    cur.relative_humidity_2m ?? null,
      wind:        cur.wind_speed_10m       ?? null,
      code:        cur.weather_code         ?? null,
      description: wmoDescription(cur.weather_code),
      icon:        wmoIcon(cur.weather_code),
      // Extra fields (nice-to-have for future UI)
      windDirection: cur.wind_direction_10m ?? null,
      pressure:      cur.pressure_msl       ?? null,
      cloudCover:    cur.cloud_cover        ?? null,
      isDay:         cur.is_day === 1,
    },
    daily: (daily.time ?? []).map((date, i) => {
      const code = daily.weather_code?.[i] ?? null;
      // Day-of-week name (short English) derived from the date string
      const dayName = date
        ? new Date(date + 'T12:00:00Z').toLocaleDateString('en-US', { weekday: 'short', timeZone: 'UTC' })
        : '';
      return {
        date,
        dayName,
        // Names aligned with WeatherPopup expectations (day.code, day.high, day.low)
        code,
        high:        daily.temperature_2m_max?.[i] ?? null,
        low:         daily.temperature_2m_min?.[i] ?? null,
        description: wmoDescription(code),
        icon:        wmoIcon(code),
        // Extra fields
        feelsLikeMax:             daily.apparent_temperature_max?.[i]       ?? null,
        feelsLikeMin:             daily.apparent_temperature_min?.[i]       ?? null,
        sunrise:                  daily.sunrise?.[i]                        ?? null,
        sunset:                   daily.sunset?.[i]                         ?? null,
        precipitation:            daily.precipitation_sum?.[i]              ?? null,
        precipitationProbability: daily.precipitation_probability_max?.[i]  ?? null,
        windSpeedMax:             daily.wind_speed_10m_max?.[i]             ?? null,
      };
    }),
    lastUpdated: Date.now(),
  };
}

// ---------------------------------------------------------------------------
// Background fetch-and-cache (fire-and-forget for stale-while-revalidate)
// ---------------------------------------------------------------------------
async function backgroundRefresh(db, logger, cacheKey, params) {
  try {
    const response = await fetch(`${OPEN_METEO_API}?${params}`);
    if (!response.ok) {
      const text = await response.text();
      throw new Error(`Open-Meteo ${response.status}: ${text}`);
    }
    const raw = await response.json();
    const shaped = shapeResponse(
      raw,
      parseFloat(params.get('latitude')),
      parseFloat(params.get('longitude')),
      params.get('temperature_unit')
    );
    setCache(db, cacheKey, shaped);
    logger.debug('Background weather refresh complete for key=%s', cacheKey);
  } catch (err) {
    logger.warn('Background weather refresh failed for key=%s: %s', cacheKey, err.message);
  }
}

// ---------------------------------------------------------------------------
// GET /api/weather?lat=&lon=&units=C|F
// ---------------------------------------------------------------------------
router.get('/', async (req, res) => {
  const db     = req.app.locals.db;
  const logger = req.app.locals.logger;

  // Defaults: Netanya, Israel
  const lat   = parseFloat(req.query.lat) || 32.33;
  const lon   = parseFloat(req.query.lon) || 34.86;
  const units = (req.query.units || 'C').toUpperCase() === 'F' ? 'fahrenheit' : 'celsius';

  const cacheKey = `weather:${lat}:${lon}:${units}`;

  // Build the Open-Meteo query params (reused for background refresh too)
  const params = new URLSearchParams({
    latitude:           lat.toString(),
    longitude:          lon.toString(),
    current: [
      'temperature_2m',
      'relative_humidity_2m',
      'apparent_temperature',
      'weather_code',
      'wind_speed_10m',
      'wind_direction_10m',
      'pressure_msl',
      'cloud_cover',
      'is_day',
    ].join(','),
    daily: [
      'weather_code',
      'temperature_2m_max',
      'temperature_2m_min',
      'apparent_temperature_max',
      'apparent_temperature_min',
      'sunrise',
      'sunset',
      'precipitation_sum',
      'precipitation_probability_max',
      'wind_speed_10m_max',
    ].join(','),
    temperature_unit:   units,
    wind_speed_unit:    'kmh',
    precipitation_unit: 'mm',
    timezone:           'auto',
    forecast_days:      '5',
  });

  // ── Check cache ────────────────────────────────────────────────────────────
  const { data: cached, isStale } = getCacheRow(db, cacheKey);

  if (cached && !isStale) {
    // Fresh cache hit — return immediately
    return res.json({ ...cached, source: 'cache' });
  }

  if (cached && isStale) {
    // Stale-while-revalidate: return stale data immediately, refresh in background
    logger.debug('Returning stale weather cache for key=%s; triggering background refresh', cacheKey);
    res.json({ ...cached, source: 'stale-cache' });
    // Fire-and-forget — do not await
    backgroundRefresh(db, logger, cacheKey, params).catch(() => {});
    return;
  }

  // ── No cache at all — fetch synchronously ─────────────────────────────────
  try {
    const response = await fetch(`${OPEN_METEO_API}?${params}`);
    if (!response.ok) {
      const text = await response.text();
      throw new Error(`Open-Meteo API ${response.status}: ${text}`);
    }

    const raw    = await response.json();
    const result = shapeResponse(raw, lat, lon, units);

    setCache(db, cacheKey, result);
    return res.json({ ...result, source: 'api' });

  } catch (err) {
    logger.error('Weather fetch error: %s', err.message);

    // Last-resort: return any stale data with a warning flag
    if (cached) {
      return res.json({ ...cached, source: 'stale-cache', warning: 'Open-Meteo unavailable; showing cached data' });
    }

    return res.status(502).json({ error: 'Failed to fetch weather data and no cached data available' });
  }
});

module.exports = router;
