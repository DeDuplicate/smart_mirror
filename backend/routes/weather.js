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

// ---------------------------------------------------------------------------
// IMS condition → WMO code mapping
// ---------------------------------------------------------------------------
const IMS_TO_WMO = {
  'clear-night':    0,
  'sunny':          0,
  'clear':          0,
  'partlycloudy':   2,
  'partly-cloudy':  2,
  'cloudy':         3,
  'overcast':       3,
  'fog':            45,
  'hail':           99,
  'lightning':      95,
  'lightning-rainy': 96,
  'pouring':        65,
  'rainy':          61,
  'snowy':          73,
  'snowy-rainy':    67,
  'windy':          1,
  'windy-variant':  1,
  'exceptional':    3,
};

function imsConditionToWmo(condition) {
  if (!condition) return null;
  return IMS_TO_WMO[condition.toLowerCase()] ?? 2;
}

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
// GET /api/weather/geocode?q=<city name> — city search for the Settings
// location picker. Proxies Open-Meteo's free geocoding API (no key needed)
// so the frontend can resolve a typed city name to real coordinates instead
// of the user having to hand-enter latitude/longitude.
// ---------------------------------------------------------------------------
const GEOCODE_API = 'https://geocoding-api.open-meteo.com/v1/search';
const GEOCODE_CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24h — city coordinates don't change
const geocodeCache = new Map();

router.get('/geocode', async (req, res) => {
  const logger = req.app.locals.logger;
  const query = (req.query.q || '').toString().trim();

  if (query.length < 2) {
    return res.json({ results: [] });
  }

  const cacheKey = query.toLowerCase();
  const cached = geocodeCache.get(cacheKey);
  if (cached && Date.now() - cached.time < GEOCODE_CACHE_TTL_MS) {
    return res.json({ results: cached.results });
  }

  try {
    const params = new URLSearchParams({
      name: query,
      count: '8',
      language: 'he',
      format: 'json',
    });
    const response = await fetch(`${GEOCODE_API}?${params}`);
    if (!response.ok) {
      const text = await response.text();
      throw new Error(`Open-Meteo geocoding ${response.status}: ${text}`);
    }
    const data = await response.json();
    const results = (data.results || []).map((r) => ({
      id: r.id,
      name: r.name,
      admin1: r.admin1 || null,
      country: r.country || null,
      countryCode: r.country_code || null,
      latitude: r.latitude,
      longitude: r.longitude,
      timezone: r.timezone || null,
    }));

    geocodeCache.set(cacheKey, { results, time: Date.now() });
    res.json({ results });
  } catch (err) {
    logger.error('Geocode search error: %s', err.message);
    res.status(502).json({ error: err.message });
  }
});

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
  // A failed cache read must not reject out of this async handler (Express 4
  // does not catch that, and Node >=15 kills the process) — degrade to a
  // cache miss and fetch fresh data instead.
  let cached = null;
  let isStale = false;
  try {
    ({ data: cached, isStale } = getCacheRow(db, cacheKey));
  } catch (err) {
    logger.error('Weather cache read error: %s', err.message);
  }

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

// ---------------------------------------------------------------------------
// GET /api/weather/ims — fetch weather from HA IMS entity
// ---------------------------------------------------------------------------
router.get('/ims', async (req, res) => {
  const db     = req.app.locals.db;
  const logger = req.app.locals.logger;

  const units = (req.query.units || 'C').toUpperCase() === 'F' ? 'fahrenheit' : 'celsius';
  const cacheKey = `weather:ims:${units}`;

  // Check cache — see the note in GET / above: a throw here would reject out
  // of this async handler and take down the process.
  let cached = null;
  let isStale = false;
  try {
    ({ data: cached, isStale } = getCacheRow(db, cacheKey));
  } catch (err) {
    logger.error('IMS weather cache read error: %s', err.message);
  }

  if (cached && !isStale) {
    return res.json({ ...cached, source: 'cache' });
  }

  try {
    // Fetch from HA entity weather.ims_weather
    const haHost = process.env.HA_HOST || 'http://homeassistant.local:8123';
    const haToken = process.env.HA_TOKEN;

    if (!haToken) {
      throw new Error('HA_TOKEN not configured');
    }

    const entityId = 'weather.ims_weather';
    const response = await fetch(
      `${haHost.replace(/\/+$/, '')}/api/states/${entityId}`,
      {
        headers: {
          Authorization: `Bearer ${haToken}`,
          'Content-Type': 'application/json',
        },
      }
    );

    if (!response.ok) {
      throw new Error(`HA API ${response.status}`);
    }

    const state = await response.json();
    const attrs = state.attributes || {};
    const condition = state.state; // e.g. "sunny", "partlycloudy", "rainy"
    const wmoCode = imsConditionToWmo(condition);

    let temp = attrs.temperature ?? null;
    let feelsLike = attrs.apparent_temperature ?? attrs.temperature ?? null;

    // Convert C → F if needed
    if (units === 'fahrenheit' && temp != null) {
      temp = Math.round(temp * 9 / 5 + 32);
      if (feelsLike != null) feelsLike = Math.round(feelsLike * 9 / 5 + 32);
    }

    // Modern HA (2024.6+) no longer exposes a `forecast` attribute on the
    // weather entity's state — it must be fetched via the weather.get_forecasts
    // service call (with return_response). Fetch it separately; if it fails,
    // fall back to an empty forecast rather than failing the whole request,
    // since current conditions are still valid and useful on their own.
    let rawForecast = [];
    try {
      const forecastResponse = await fetch(
        `${haHost.replace(/\/+$/, '')}/api/services/weather/get_forecasts?return_response`,
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${haToken}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ entity_id: entityId, type: 'daily' }),
        }
      );
      if (forecastResponse.ok) {
        const forecastData = await forecastResponse.json();
        rawForecast = forecastData?.service_response?.[entityId]?.forecast || [];
      } else {
        logger.warn('IMS forecast service call failed: HA API %s', forecastResponse.status);
      }
    } catch (forecastErr) {
      logger.warn('IMS forecast service call error: %s', forecastErr.message);
    }

    // Build forecast from the weather.get_forecasts service response
    const forecast = rawForecast.slice(0, 7).map((day, i) => {
      const dayCode = imsConditionToWmo(day.condition);
      let high = day.temperature ?? null;
      let low = day.templow ?? null;
      if (units === 'fahrenheit') {
        if (high != null) high = Math.round(high * 9 / 5 + 32);
        if (low != null) low = Math.round(low * 9 / 5 + 32);
      }
      const dateStr = day.datetime ? day.datetime.split('T')[0] : '';
      const dayName = dateStr
        ? new Date(dateStr + 'T12:00:00Z').toLocaleDateString('en-US', { weekday: 'short', timeZone: 'UTC' })
        : '';
      return {
        date: dateStr,
        dayName,
        code: dayCode,
        high,
        low,
        description: wmoDescription(dayCode),
        icon: wmoIcon(dayCode),
        precipitation: day.precipitation ?? null,
        precipitationProbability: day.precipitation_probability ?? null,
        windSpeedMax: day.wind_speed ?? null,
      };
    });

    const shaped = {
      location: { lat: attrs.latitude ?? null, lon: attrs.longitude ?? null, timezone: 'Asia/Jerusalem' },
      units: units === 'fahrenheit' ? 'F' : 'C',
      current: {
        temp,
        feelsLike,
        humidity: attrs.humidity ?? null,
        wind: attrs.wind_speed ?? null,
        code: wmoCode,
        description: wmoDescription(wmoCode),
        icon: wmoIcon(wmoCode),
        windDirection: attrs.wind_bearing ?? null,
        pressure: attrs.pressure ?? null,
        cloudCover: null,
        isDay: true,
      },
      daily: forecast,
      lastUpdated: Date.now(),
    };

    setCache(db, cacheKey, shaped);
    return res.json({ ...shaped, source: 'ims' });

  } catch (err) {
    logger.error('IMS weather fetch error: %s', err.message);

    // Fall back to cached data
    if (cached) {
      return res.json({ ...cached, source: 'stale-cache', warning: 'IMS unavailable; showing cached data' });
    }

    return res.status(502).json({ error: 'Failed to fetch IMS weather data' });
  }
});

module.exports = router;
