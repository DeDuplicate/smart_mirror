'use strict';

const express = require('express');
const router = express.Router();

const FETCH_TIMEOUT_MS = 8000;
const SEARCH_CACHE_TTL_MS = 5 * 60 * 1000;
const SUGGEST_CACHE_TTL_MS = 10 * 60 * 1000;
const RELATED_CACHE_TTL_MS = 10 * 60 * 1000;

const INVIDIOUS_INSTANCES = [
  'https://yewtu.be',
  'https://invidious.flokinet.to',
  'https://inv.nadeko.net',
  'https://invidious.privacyredirect.com',
  'https://inv.tux.pizza',
];

const PIPED_INSTANCES = [
  'https://pipedapi.kavin.rocks',
  'https://pipedapi.adminforge.de',
];

const searchCache = new Map();
const suggestCache = new Map();
const relatedCache = new Map();

function cacheGet(map, key, ttl) {
  const entry = map.get(key);
  if (!entry) return null;
  if (Date.now() - entry.at > ttl) {
    map.delete(key);
    return null;
  }
  return entry.value;
}

function cacheSet(map, key, value, max = 80) {
  map.set(key, { at: Date.now(), value });
  if (map.size > max) {
    const oldest = map.keys().next().value;
    map.delete(oldest);
  }
}

async function fetchJson(url) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: {
        Accept: 'application/json',
        'User-Agent': 'SmartMirror/1.0',
      },
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}

function formatDuration(seconds) {
  const total = Math.max(0, Math.floor(Number(seconds) || 0));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  return `${m}:${String(s).padStart(2, '0')}`;
}

function thumbnailFromVideoId(videoId) {
  return `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`;
}

function normalizeInvidiousVideo(item) {
  const videoId = item.videoId || item.videoID;
  if (!videoId) return null;
  const length = item.lengthSeconds ?? item.length ?? 0;
  return {
    id: videoId,
    title: item.title || '',
    artist: item.author || item.uploaderName || item.authorName || '',
    album: '',
    duration: formatDuration(length),
    durationSeconds: Number(length) || 0,
    imageUrl: thumbnailFromVideoId(videoId),
    source: 'youtube',
  };
}

function normalizePipedItem(item) {
  if (!item || (item.type && item.type !== 'stream' && item.type !== 'video')) return null;
  const rawUrl = item.url || item.id || '';
  const match = String(rawUrl).match(/(?:v=|\/watch\?v=|youtu\.be\/)?([a-zA-Z0-9_-]{11})/);
  const videoId = item.id && item.id.length === 11 ? item.id : match?.[1];
  if (!videoId) return null;
  return {
    id: videoId,
    title: item.title || '',
    artist: item.uploaderName || item.uploader || '',
    album: '',
    duration: item.duration
      ? (typeof item.duration === 'number' ? formatDuration(item.duration) : String(item.duration))
      : formatDuration(0),
    durationSeconds: typeof item.duration === 'number' ? item.duration : 0,
    imageUrl: thumbnailFromVideoId(videoId),
    source: 'youtube',
  };
}

async function searchInvidious(query) {
  let lastError;
  for (const base of INVIDIOUS_INSTANCES) {
    try {
      const data = await fetchJson(
        `${base}/api/v1/search?q=${encodeURIComponent(query)}&type=video&sort_by=relevance`
      );
      const items = Array.isArray(data) ? data : data?.items || [];
      const tracks = items.map(normalizeInvidiousVideo).filter(Boolean);
      if (tracks.length) return tracks;
    } catch (err) {
      lastError = err;
    }
  }
  throw lastError || new Error('Invidious search failed');
}

async function searchPiped(query) {
  let lastError;
  for (const base of PIPED_INSTANCES) {
    try {
      const data = await fetchJson(
        `${base}/search?q=${encodeURIComponent(query)}&filter=videos`
      );
      const items = Array.isArray(data) ? data : data?.items || [];
      const tracks = items.map(normalizePipedItem).filter(Boolean);
      if (tracks.length) return tracks;
    } catch (err) {
      lastError = err;
    }
  }
  throw lastError || new Error('Piped search failed');
}

function walkVideoRenderers(node, out = []) {
  if (!node || typeof node !== 'object') return out;
  if (Array.isArray(node)) {
    node.forEach((item) => walkVideoRenderers(item, out));
    return out;
  }
  if (node.videoRenderer?.videoId) {
    const v = node.videoRenderer;
    out.push({
      id: v.videoId,
      title: v.title?.runs?.map((r) => r.text).join('') || v.title?.simpleText || '',
      artist: v.ownerText?.runs?.[0]?.text || v.shortBylineText?.runs?.[0]?.text || '',
      album: '',
      duration: v.lengthText?.simpleText || formatDuration(0),
      durationSeconds: 0,
      imageUrl: thumbnailFromVideoId(v.videoId),
      source: 'youtube',
    });
    return out;
  }
  Object.values(node).forEach((value) => walkVideoRenderers(value, out));
  return out;
}

async function searchInnertube(query) {
  const data = await fetch('https://www.youtube.com/youtubei/v1/search?prettyPrint=false', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
      'User-Agent': 'Mozilla/5.0',
    },
    body: JSON.stringify({
      context: {
        client: {
          clientName: 'WEB',
          clientVersion: '2.20240101.00.00',
          hl: 'he',
          gl: 'IL',
        },
      },
      query,
      params: 'EgIQAQ%3D%3D',
    }),
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  }).then((res) => {
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.json();
  });

  const tracks = walkVideoRenderers(data);
  if (!tracks.length) throw new Error('Innertube returned no videos');
  return tracks;
}

async function relatedInvidious(videoId) {
  let lastError;
  for (const base of INVIDIOUS_INSTANCES) {
    try {
      const data = await fetchJson(`${base}/api/v1/videos/${encodeURIComponent(videoId)}`);
      const recs = data?.recommendedVideos || data?.recommended || [];
      const tracks = recs.map(normalizeInvidiousVideo).filter(Boolean);
      if (tracks.length) return tracks;
    } catch (err) {
      lastError = err;
    }
  }
  throw lastError || new Error('Related lookup failed');
}

router.get('/search', async (req, res) => {
  const query = String(req.query.q || '').trim();
  if (!query) return res.json({ tracks: [] });

  const cached = cacheGet(searchCache, query.toLowerCase(), SEARCH_CACHE_TTL_MS);
  if (cached) return res.json({ tracks: cached, cached: true });

  try {
    let tracks;
    try {
      tracks = await searchInvidious(query);
    } catch {
      try {
        tracks = await searchPiped(query);
      } catch {
        tracks = await searchInnertube(query);
      }
    }
    cacheSet(searchCache, query.toLowerCase(), tracks);
    res.json({ tracks });
  } catch (err) {
    console.error('[music] search failed:', err.message);
    res.status(502).json({ error: 'search_failed', message: err.message, tracks: [] });
  }
});

router.get('/suggest', async (req, res) => {
  const query = String(req.query.q || '').trim();
  if (!query) return res.json({ suggestions: [] });

  const cached = cacheGet(suggestCache, query.toLowerCase(), SUGGEST_CACHE_TTL_MS);
  if (cached) return res.json({ suggestions: cached, cached: true });

  try {
    const data = await fetchJson(
      `https://suggestqueries.google.com/complete/search?client=firefox&ds=yt&q=${encodeURIComponent(query)}`
    );
    const suggestions = Array.isArray(data?.[1]) ? data[1].map(String).slice(0, 8) : [];
    cacheSet(suggestCache, query.toLowerCase(), suggestions);
    res.json({ suggestions });
  } catch (err) {
    console.error('[music] suggest failed:', err.message);
    res.json({ suggestions: [] });
  }
});

const MIXES = [
  { id: 'israeli', title: 'להיטים ישראלים', query: 'להיטים ישראלים', color: '#6b62e0' },
  { id: 'kids', title: 'שירי ילדים', query: 'שירי ילדים ישראלים', color: '#2ab58a' },
  { id: 'calm', title: 'רגוע', query: 'מוזיקה שקטה רגועה', color: '#4c8dff' },
  { id: 'party', title: 'מסיבה', query: 'שירי מסיבה להיטים', color: '#e06b8a' },
  { id: 'classics', title: 'קלאסיקות עבריות', query: 'שירי ארץ ישראל', color: '#c9a227' },
  { id: 'english', title: 'Pop Hits', query: 'best pop hits', color: '#9b6bde' },
];

async function trendingMusic() {
  const queries = ['להיטים ישראלים', 'שירי ארץ ישראל', 'best music mix'];
  for (const query of queries) {
    try {
      const tracks = await searchInvidious(query);
      if (tracks.length) return tracks.slice(0, 16);
    } catch { /* try next query */ }
  }
  return searchInnertube(queries[0]);
}

router.get('/recommended', async (req, res) => {
  try {
    const tracks = await trendingMusic();
    res.json({ mixes: MIXES, tracks: tracks.slice(0, 16) });
  } catch (err) {
    console.error('[music] recommended failed:', err.message);
    res.json({ mixes: MIXES, tracks: [] });
  }
});

router.get('/related/:id', async (req, res) => {
  const videoId = String(req.params.id || '').trim();
  if (!/^[a-zA-Z0-9_-]{11}$/.test(videoId)) {
    return res.status(400).json({ error: 'invalid_id', tracks: [] });
  }

  const cached = cacheGet(relatedCache, videoId, RELATED_CACHE_TTL_MS);
  if (cached) return res.json({ tracks: cached, cached: true });

  try {
    const tracks = await relatedInvidious(videoId);
    cacheSet(relatedCache, videoId, tracks);
    res.json({ tracks });
  } catch (err) {
    console.error('[music] related failed:', err.message);
    res.json({ tracks: [] });
  }
});

module.exports = router;
