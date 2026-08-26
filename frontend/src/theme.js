const DEFAULT_LAT = 31.7683;
const DEFAULT_LON = 35.2137;
export const THEME_MODES = ['auto', 'dark', 'light'];

const THEME_RGB = {
  light: {
    bg: '244 245 247',
    surf: '255 255 255',
    s2: '240 241 245',
    bd: '232 233 240',
    tp: '26 28 46',
    ts: '103 107 133',
    tm: '176 180 204',
    acc: '107 98 224',
    acc2: '42 181 138',
    'mint-bg': '184 237 224',
    'mint-d': '42 157 127',
    'lav-bg': '212 207 255',
    'lav-d': '91 82 204',
    'coral-bg': '255 200 200',
    'coral-d': '201 84 84',
    'gold-bg': '255 228 160',
    'gold-d': '176 124 16',
  },
  dark: {
    bg: '15 16 25',
    surf: '26 27 46',
    s2: '34 36 58',
    bd: '78 82 122',
    tp: '232 233 240',
    ts: '155 159 192',
    tm: '93 96 128',
    acc: '139 130 240',
    acc2: '61 217 160',
    'mint-bg': '26 61 53',
    'mint-d': '61 217 160',
    'lav-bg': '37 32 70',
    'lav-d': '139 130 240',
    'coral-bg': '61 26 26',
    'coral-d': '255 136 136',
    'gold-bg': '61 45 10',
    'gold-d': '255 192 64',
  },
};

export function applyTheme(isDark) {
  const root = document.documentElement;
  const tokens = isDark ? THEME_RGB.dark : THEME_RGB.light;
  for (const [key, value] of Object.entries(tokens)) {
    root.style.setProperty(`--${key}-rgb`, value);
  }
  root.classList.toggle('dark', !!isDark);
  if (isDark) root.dataset.theme = 'dark';
  else delete root.dataset.theme;
  root.style.colorScheme = isDark ? 'dark' : 'light';
}

export function normalizeThemeMode(themeMode, darkMode) {
  if (themeMode === 'auto' || themeMode === 'light' || themeMode === 'dark') return themeMode;
  if (darkMode === true) return 'dark';
  if (darkMode === false) return 'light';
  return 'auto';
}

export function nextThemeMode(current) {
  const idx = THEME_MODES.indexOf(current);
  return THEME_MODES[(idx + 1) % THEME_MODES.length];
}

function parseSunInstant(value) {
  if (!value) return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** NOAA-style sunrise/sunset for a local calendar day. */
export function computeSunTimes(date, lat, lon) {
  const toRad = (deg) => (deg * Math.PI) / 180;
  const start = Date.UTC(date.getFullYear(), date.getMonth(), date.getDate());
  const dayOfYear = Math.round((start - Date.UTC(date.getFullYear(), 0, 0)) / 86400000);
  const gamma = ((2 * Math.PI) / 365) * (dayOfYear - 1 + (12 - lon / 15) / 24);
  const eqTime =
    229.18 *
    (0.000075 +
      0.001868 * Math.cos(gamma) -
      0.032077 * Math.sin(gamma) -
      0.014615 * Math.cos(2 * gamma) -
      0.040849 * Math.sin(2 * gamma));
  const decl =
    0.006918 -
    0.399912 * Math.cos(gamma) +
    0.070257 * Math.sin(gamma) -
    0.006758 * Math.cos(2 * gamma) +
    0.000907 * Math.sin(gamma * 2) -
    0.002697 * Math.cos(3 * gamma) +
    0.00148 * Math.sin(3 * gamma);
  const latR = toRad(lat);
  const cosHa =
    Math.cos(toRad(90.833)) / (Math.cos(latR) * Math.cos(decl)) -
    Math.tan(latR) * Math.tan(decl);
  if (!Number.isFinite(cosHa) || cosHa > 1 || cosHa < -1) return null;
  const ha = (Math.acos(cosHa) * 180) / Math.PI;
  return {
    sunrise: new Date(start + (720 - 4 * (lon + ha) - eqTime) * 60000),
    sunset: new Date(start + (720 - 4 * (lon - ha) - eqTime) * 60000),
  };
}

export function getSunTimes({ daily, lat, lon, now = new Date() } = {}) {
  const today = daily?.find((day) => {
    const key = String(day?.date || '').slice(0, 10);
    if (!key) return false;
    return (
      key ===
      `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`
    );
  }) || daily?.[0];

  const sunrise = parseSunInstant(today?.sunrise);
  const sunset = parseSunInstant(today?.sunset);
  if (sunrise && sunset) return { sunrise, sunset };

  const parsedLat = Number(lat);
  const parsedLon = Number(lon);
  const useLat = Number.isFinite(parsedLat) ? parsedLat : DEFAULT_LAT;
  const useLon = Number.isFinite(parsedLon) ? parsedLon : DEFAULT_LON;
  return (
    computeSunTimes(now, useLat, useLon) || {
      sunrise: new Date(now.getFullYear(), now.getMonth(), now.getDate(), 6, 0, 0),
      sunset: new Date(now.getFullYear(), now.getMonth(), now.getDate(), 18, 30, 0),
    }
  );
}

export function isNightNow({ daily, isDay, lat, lon, now = new Date() } = {}) {
  const { sunrise, sunset } = getSunTimes({ daily, lat, lon, now });
  if (sunrise && sunset) return now < sunrise || now >= sunset;
  if (typeof isDay === 'boolean') return !isDay;
  const hour = now.getHours();
  return hour < 6 || hour >= 19;
}

export function resolveIsDark({ themeMode, daily, isDay, lat, lon, now } = {}) {
  if (themeMode === 'dark') return true;
  if (themeMode === 'light') return false;
  return isNightNow({ daily, isDay, lat, lon, now });
}

export function msUntilNextSunEvent({ daily, lat, lon, now = new Date() } = {}) {
  const { sunrise, sunset } = getSunTimes({ daily, lat, lon, now });
  const upcoming = [sunrise, sunset]
    .filter((d) => d && d > now)
    .sort((a, b) => a - b)[0];
  if (upcoming) return upcoming.getTime() - now.getTime();
  const tomorrow = new Date(now);
  tomorrow.setDate(tomorrow.getDate() + 1);
  const next = getSunTimes({ daily, lat, lon, now: tomorrow });
  const first = next.sunrise > now ? next.sunrise : next.sunset;
  return Math.max(60_000, first.getTime() - now.getTime());
}
