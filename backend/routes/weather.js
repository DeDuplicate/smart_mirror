'use strict';

const { Router } = require('express');
const router = Router();

const OPEN_METEO_API = 'https://api.open-meteo.com/v1/forecast';
const IMS_BASE = 'https://ims.gov.il/he';
const CACHE_TTL_MS = 10 * 60 * 1000; // 10 minutes
const IMS_LOCATIONS_CACHE_TTL_MS = 24 * 60 * 60 * 1000;

let imsLocationsCache = { fetchedAt: 0, locations: [] };

function getConfigValue(db, key) {
  try {
    const row = db.prepare('SELECT value FROM config WHERE key = ?').get(key);
    if (!row || row.value == null) return '';
    try {
      const parsed = JSON.parse(row.value);
      return typeof parsed === 'string' ? parsed : String(row.value);
    } catch {
      return String(row.value);
    }
  } catch {
    return '';
  }
}

function parseCoord(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function convertTemp(value, fromUnit, toUnit) {
  if (value == null) return null;
  const temp = Number(value);
  if (!Number.isFinite(temp)) return null;
  if (fromUnit === toUnit) return temp;
  return toUnit === 'fahrenheit'
    ? (temp * 9 / 5) + 32
    : (temp - 32) * 5 / 9;
}

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
  1010: 3,   // sandstorms
  1020: 95,  // thunderstorms
  1060: 73,  // snow
  1070: 71,  // light snow
  1080: 67,  // sleet
  1140: 61,  // rainy
  1160: 45,  // fog
  1220: 2,   // partly cloudy
  1230: 3,   // cloudy
  1250: 0,   // clear
  1260: 1,   // windy
  1270: 2,   // muggy
  1300: 45,  // frost
  1310: 0,   // hot
  1320: 1,   // cold
  1510: 65,  // stormy
  1520: 75,  // heavy snow
  1530: 51,  // partly cloudy, possible rain
  1540: 51,  // cloudy, possible rain
  1560: 51,  // cloudy, light rain
  1570: 3,   // dust
  1580: 0,   // extremely hot
  1590: 1,   // extremely cold
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
  const numeric = Number(condition);
  if (Number.isFinite(numeric)) return IMS_TO_WMO[numeric] ?? 2;
  return IMS_TO_WMO[String(condition).toLowerCase()] ?? 2;
}

function wmoDescription(code) {
  return WMO_CODES[code]?.description ?? 'Unknown';
}

function wmoIcon(code) {
  return WMO_CODES[code]?.icon ?? '🌤️';
}

function hebrewDayName(date) {
  if (!date) return '';
  return new Date(`${date}T12:00:00Z`).toLocaleDateString('he-IL', {
    weekday: 'short',
    timeZone: 'UTC',
  });
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

async function fetchJson(url) {
  const response = await fetch(url, { signal: AbortSignal.timeout(10000) });
  if (!response.ok) {
    const text = await response.text().catch(() => '');
    throw new Error(`${url} ${response.status}: ${text || response.statusText}`);
  }
  return response.json();
}

function num(value) {
  if (value == null || value === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

async function getImsLocations() {
  if (
    imsLocationsCache.locations.length > 0
    && Date.now() - imsLocationsCache.fetchedAt < IMS_LOCATIONS_CACHE_TTL_MS
  ) {
    return imsLocationsCache.locations;
  }

  const data = await fetchJson(`${IMS_BASE}/locations_info`);
  const locations = Object.values(data?.data || {})
    .map((location) => ({
      id: String(location.lid),
      name: location.name,
      lat: num(location.lat),
      lon: num(location.lon),
    }))
    .filter((location) => location.id && Number.isFinite(location.lat) && Number.isFinite(location.lon));

  imsLocationsCache = { fetchedAt: Date.now(), locations };
  return locations;
}

async function nearestImsLocation(lat, lon) {
  const locations = await getImsLocations();
  if (locations.length === 0) throw new Error('IMS locations list is empty');

  let best = locations[0];
  let bestDistance = Infinity;
  for (const location of locations) {
    const dLat = location.lat - lat;
    const dLon = location.lon - lon;
    const distance = dLat * dLat + dLon * dLon;
    if (distance < bestDistance) {
      best = location;
      bestDistance = distance;
    }
  }
  return best;
}

function shapeImsCurrent(current, location, units) {
  const code = imsConditionToWmo(current.weather_code);
  const celsius = 'celsius';
  const temp = convertTemp(current.precise_temperature ?? current.temperature, celsius, units);
  const feelsLike = convertTemp(current.feels_like ?? current.wind_chill ?? current.temperature, celsius, units);
  const hour = Number(current.forecast_hour ?? String(current.forecast_time || '').slice(11, 13));

  return {
    temp,
    feelsLike,
    humidity: num(current.relative_humidity),
    wind: num(current.wind_speed),
    code,
    description: wmoDescription(code),
    icon: wmoIcon(code),
    windDirection: null,
    pressure: null,
    cloudCover: null,
    isDay: Number.isFinite(hour) ? hour >= 6 && hour < 19 : null,
    updatedAt: current.modified || current.forecast_time || null,
    locationName: location.name,
  };
}

function shapeImsForecast(forecastData, units) {
  return Object.entries(forecastData || {}).slice(0, 5).map(([date, day]) => {
    const daily = day?.daily || {};
    const code = imsConditionToWmo(daily.weather_code);
    const hours = Object.values(day?.hourly || {});

    return {
      date,
      dayName: hebrewDayName(date),
      code,
      high: convertTemp(daily.maximum_temperature, 'celsius', units),
      low: convertTemp(daily.minimum_temperature, 'celsius', units),
      description: wmoDescription(code),
      icon: wmoIcon(code),
      precipitation: hours.reduce((sum, hour) => sum + (num(hour.rain) || 0), 0),
      precipitationProbability: Math.max(...hours.map((hour) => num(hour.rain_chance) || 0), 0),
      windSpeedMax: Math.max(...hours.map((hour) => num(hour.wind_speed) || 0), 0),
      uviMax: num(daily.maximum_uvi),
    };
  });
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
      isDay:         typeof cur.is_day === 'number' ? cur.is_day === 1 : null,
    },
    daily: (daily.time ?? []).map((date, i) => {
      const code = daily.weather_code?.[i] ?? null;
      return {
        date,
        dayName: hebrewDayName(date),
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
  const lat   = parseCoord(req.query.lat, 32.33);
  const lon   = parseCoord(req.query.lon, 34.86);
  const units = (req.query.units || 'C').toUpperCase() === 'F' ? 'fahrenheit' : 'celsius';

  const cacheKey = `weather:v2:${lat}:${lon}:${units}`;

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
// GET /api/weather/ims?lat=&lon=&units=C|F — direct IMS public forecast API
// ---------------------------------------------------------------------------
router.get('/ims', async (req, res) => {
  const db     = req.app.locals.db;
  const logger = req.app.locals.logger;

  const units = (req.query.units || 'C').toUpperCase() === 'F' ? 'fahrenheit' : 'celsius';
  const lat = parseCoord(req.query.lat, parseCoord(getConfigValue(db, 'latitude'), 32.33));
  const lon = parseCoord(req.query.lon, parseCoord(getConfigValue(db, 'longitude'), 34.86));

  let imsLocation;
  try {
    imsLocation = await nearestImsLocation(lat, lon);
  } catch (err) {
    logger.error('IMS location lookup error: %s', err.message);
    return res.status(502).json({ error: 'Failed to resolve IMS location' });
  }

  const cacheKey = `weather:ims:v2:${imsLocation.id}:${units}`;
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
    const [currentRaw, forecastRaw] = await Promise.all([
      fetchJson(`${IMS_BASE}/now_analysis/${imsLocation.id}`),
      fetchJson(`${IMS_BASE}/full_forecast_data/${imsLocation.id}`),
    ]);

    const current = currentRaw?.data?.[imsLocation.id];
    if (!current) throw new Error(`IMS current data missing for location ${imsLocation.id}`);

    const shaped = {
      location: {
        lat: imsLocation.lat,
        lon: imsLocation.lon,
        timezone: 'Asia/Jerusalem',
        id: imsLocation.id,
        name: imsLocation.name,
        requested: { lat, lon },
      },
      units: units === 'fahrenheit' ? 'F' : 'C',
      current: shapeImsCurrent(current, imsLocation, units),
      daily: shapeImsForecast(forecastRaw?.data, units),
      lastUpdated: Date.now(),
    };

    setCache(db, cacheKey, shaped);
    return res.json({ ...shaped, source: 'ims-direct' });

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
