'use strict';

const express = require('express');
const os = require('os');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { spawn } = require('child_process');
const router = express.Router();

// External binaries used to turn a YouTube video into a raw MP3 audio stream
// that dumb audio-only cast targets (e.g. Google Nest Mini) can play directly.
// Both must be on PATH on the Raspberry Pi (installed by scripts/setup.sh) or
// overridden via env vars.
const YTDLP_BIN = process.env.YTDLP_PATH || 'yt-dlp';
const FFMPEG_BIN = process.env.FFMPEG_PATH || 'ffmpeg';

// On-disk MP3 cache. Pre-converting the next track here means casting the next
// song starts instantly (no yt-dlp/ffmpeg spin-up latency), and cached files
// are seekable (support HTTP Range) so the progress bar can scrub.
const CACHE_DIR = path.join(__dirname, '..', 'cache', 'audio');
const CACHE_MAX_FILES = 40;
const MIN_CACHED_BYTES = 16 * 1024;
const warmJobs = new Map(); // videoId -> Promise (in-flight conversions)

function cachePath(id) { return path.join(CACHE_DIR, `${id}.mp3`); }
function partPath(id) { return path.join(CACHE_DIR, `${id}.mp3.part`); }

function ensureCacheDir() {
  try { fs.mkdirSync(CACHE_DIR, { recursive: true }); } catch { /* ignore */ }
}

function isCached(id) {
  try {
    const st = fs.statSync(cachePath(id));
    return st.isFile() && st.size >= MIN_CACHED_BYTES;
  } catch { return false; }
}

// Keep the newest CACHE_MAX_FILES tracks; delete the rest (simple disk LRU).
function pruneCache() {
  try {
    const files = fs.readdirSync(CACHE_DIR).filter((f) => f.endsWith('.mp3'));
    if (files.length <= CACHE_MAX_FILES) return;
    const stats = files
      .map((f) => ({ f, t: fs.statSync(path.join(CACHE_DIR, f)).mtimeMs }))
      .sort((a, b) => a.t - b.t);
    for (const { f } of stats.slice(0, files.length - CACHE_MAX_FILES)) {
      try { fs.unlinkSync(path.join(CACHE_DIR, f)); } catch { /* ignore */ }
    }
  } catch { /* ignore */ }
}

// Fully download + transcode a track to the on-disk cache. De-duplicates
// concurrent requests for the same id via warmJobs. Resolves with the cached
// file path.
function transcodeToFile(id, logger) {
  if (isCached(id)) return Promise.resolve(cachePath(id));
  if (warmJobs.has(id)) return warmJobs.get(id);

  ensureCacheDir();
  const src = `https://www.youtube.com/watch?v=${id}`;
  const out = partPath(id);

  const job = new Promise((resolve, reject) => {
    const ytdlp = spawn(
      YTDLP_BIN,
      ['-q', '--no-warnings', '--no-playlist', '-f', 'bestaudio/best', '-o', '-', src],
      { stdio: ['ignore', 'pipe', 'pipe'] }
    );
    const ffmpeg = spawn(
      FFMPEG_BIN,
      ['-hide_banner', '-loglevel', 'error', '-i', 'pipe:0', '-vn', '-acodec', 'libmp3lame', '-b:a', '192k', '-f', 'mp3', '-y', out],
      { stdio: ['pipe', 'pipe', 'ignore'] }
    );
    let errMsg = '';
    ytdlp.on('error', (e) => { errMsg = e.message; try { ffmpeg.kill('SIGKILL'); } catch { /* */ } });
    ffmpeg.on('error', (e) => { errMsg = e.message; try { ytdlp.kill('SIGKILL'); } catch { /* */ } });
    ytdlp.stderr.on('data', (d) => logger?.debug('[music] warm yt-dlp: %s', String(d).trim()));
    ytdlp.stdout.pipe(ffmpeg.stdin);
    ffmpeg.stdin.on('error', () => { /* yt-dlp ended early; ignore EPIPE */ });
    ffmpeg.on('close', (code) => {
      let ok = code === 0;
      try { ok = ok && fs.statSync(out).size >= MIN_CACHED_BYTES; } catch { ok = false; }
      if (ok) {
        try {
          fs.renameSync(out, cachePath(id));
          pruneCache();
          resolve(cachePath(id));
          return;
        } catch (e) { reject(e); return; }
      }
      try { fs.unlinkSync(out); } catch { /* ignore */ }
      reject(new Error(errMsg || `conversion failed (code ${code})`));
    });
  }).finally(() => warmJobs.delete(id));

  warmJobs.set(id, job);
  return job;
}

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

function parseDurationText(text) {
  if (!text) return 0;
  const parts = String(text).split(':').map((n) => Number(n) || 0);
  if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
  if (parts.length === 2) return parts[0] * 60 + parts[1];
  return 0;
}

function walkMusicItems(node, out = []) {
  if (!node || typeof node !== 'object') return out;
  if (Array.isArray(node)) {
    node.forEach((item) => walkMusicItems(item, out));
    return out;
  }

  const item = node.musicResponsiveListItemRenderer;
  if (item) {
    const videoId = item.playlistItemData?.videoId
      || item.overlay?.musicItemThumbnailOverlayRenderer?.content?.musicPlayButtonRenderer?.playNavigationEndpoint?.watchEndpoint?.videoId;
    const columns = item.flexColumns || [];
    const texts = columns.map((col) => {
      const runs = col.musicResponsiveListItemFlexColumnRenderer?.text?.runs || [];
      return runs.map((r) => r.text).join('');
    }).filter(Boolean);
    if (videoId && texts[0]) {
      const meta = (texts[1] || '').split(/\s*[•·|]\s*/).map((s) => s.trim()).filter(Boolean);
      const durationText = meta.find((part) => /^\d+:\d{2}(?::\d{2})?$/.test(part)) || '';
      const artist = meta.find((part) => part !== durationText && part !== texts[0]) || meta[0] || '';
      const album = meta.find((part) => part !== artist && part !== durationText && part !== texts[0]) || '';
      const seconds = parseDurationText(durationText);
      out.push({
        id: videoId,
        title: texts[0],
        artist,
        album,
        duration: durationText || formatDuration(seconds),
        durationSeconds: seconds,
        imageUrl: thumbnailFromVideoId(videoId),
        source: 'youtube',
      });
    }
    return out;
  }

  if (node.videoRenderer?.videoId) {
    const v = node.videoRenderer;
    const seconds = parseDurationText(v.lengthText?.simpleText);
    out.push({
      id: v.videoId,
      title: v.title?.runs?.map((r) => r.text).join('') || v.title?.simpleText || '',
      artist: v.ownerText?.runs?.[0]?.text || v.shortBylineText?.runs?.[0]?.text || '',
      album: '',
      duration: v.lengthText?.simpleText || formatDuration(seconds),
      durationSeconds: seconds,
      imageUrl: thumbnailFromVideoId(v.videoId),
      source: 'youtube',
    });
    return out;
  }

  Object.values(node).forEach((value) => walkMusicItems(value, out));
  return out;
}

const YTM_CLIENT = {
  clientName: 'WEB_REMIX',
  clientVersion: '1.20240124.01.00',
  hl: 'he',
  gl: 'IL',
};
const YTM_FILTER_SONGS = 'EgWKAQIIAWoKEAMQBBAJEAoQBQ%3D%3D';
const YTM_FILTER_PLAYLISTS = 'EgWKAQIoAWoKEAMQBBAJEAoQBQ%3D%3D';
const YTM_FILTER_ALBUMS = 'EgWKAQIYAWoKEAMQBBAJEAoQBQ%3D%3D';

async function ytmPost(path, body) {
  const res = await fetch(`https://music.youtube.com/youtubei/v1/${path}?prettyPrint=false`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
      'User-Agent': 'Mozilla/5.0',
      Origin: 'https://music.youtube.com',
      Referer: 'https://music.youtube.com/',
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

function findContinuation(node, found = { value: null }) {
  if (!node || typeof node !== 'object' || found.value) return found.value;
  if (node.nextContinuationData?.continuation) {
    found.value = node.nextContinuationData.continuation;
    return found.value;
  }
  if (Array.isArray(node)) {
    node.forEach((item) => findContinuation(item, found));
  } else {
    Object.values(node).forEach((value) => findContinuation(value, found));
  }
  return found.value;
}

function playlistThumb(item, playlistId) {
  const thumbs = item.thumbnail?.musicThumbnailRenderer?.thumbnail?.thumbnails
    || item.thumbnail?.thumbnails
    || [];
  return thumbs[thumbs.length - 1]?.url || (playlistId ? thumbnailFromVideoId(playlistId) : '');
}

function walkPlaylists(node, out = []) {
  if (!node || typeof node !== 'object') return out;
  if (Array.isArray(node)) {
    node.forEach((item) => walkPlaylists(item, out));
    return out;
  }

  const item = node.musicResponsiveListItemRenderer || node.playlistRenderer;
  if (item) {
    const overlayId = item.overlay?.musicItemThumbnailOverlayRenderer
      ?.content?.musicPlayButtonRenderer?.playNavigationEndpoint
      ?.watchPlaylistEndpoint?.playlistId
      || item.playlistItemData?.playlistId
      || '';
    const browseId = item.navigationEndpoint?.browseEndpoint?.browseId
      || item.playlistId
      || '';
    const playlistId = String(overlayId || browseId).replace(/^VL/, '');
    const isList = browseId.startsWith('VL')
      || browseId.startsWith('PL')
      || browseId.startsWith('MPRE')
      || Boolean(item.playlistId);
    if (playlistId && isList) {
      const columns = item.flexColumns || [];
      const texts = columns.map((col) => {
        const runs = col.musicResponsiveListItemFlexColumnRenderer?.text?.runs || [];
        return runs.map((r) => r.text).join('');
      }).filter(Boolean);
      const title = texts[0] || item.title?.simpleText || item.title || '';
      const meta = (texts[1] || '').split(/\s*[•·|]\s*/).map((s) => s.trim()).filter(Boolean);
      const countPart = meta.find((part) => /\d/.test(part)) || '';
      out.push({
        id: playlistId,
        title,
        artist: meta[0] || item.author || '',
        videoCount: Number(String(countPart).replace(/\D/g, '')) || item.videoCount || 0,
        imageUrl: playlistThumb(item, playlistId),
        type: 'playlist',
      });
      return out;
    }
  }

  Object.values(node).forEach((value) => walkPlaylists(value, out));
  return out;
}

function normalizeInvidiousPlaylist(item) {
  const id = item.playlistId || item.playlistID;
  if (!id) return null;
  return {
    id,
    title: item.title || '',
    artist: item.author || item.uploaderName || '',
    videoCount: Number(item.videoCount) || 0,
    imageUrl: item.playlistThumbnail || thumbnailFromVideoId(id),
    type: 'playlist',
  };
}

async function searchYoutubeMusic(query, { continuation, filter } = {}) {
  const body = continuation
    ? { context: { client: YTM_CLIENT }, continuation }
    : { context: { client: YTM_CLIENT }, query, params: filter || YTM_FILTER_SONGS };
  const data = await ytmPost('search', body);
  const tracks = walkMusicItems(data);
  const playlists = walkPlaylists(data);
  return {
    tracks,
    playlists,
    continuation: findContinuation(data),
  };
}

async function searchPlaylists(query) {
  try {
    const [lists, albums] = await Promise.allSettled([
      searchYoutubeMusic(query, { filter: YTM_FILTER_PLAYLISTS }),
      searchYoutubeMusic(query, { filter: YTM_FILTER_ALBUMS }),
    ]);
    const merged = [
      ...(lists.status === 'fulfilled' ? lists.value.playlists : []),
      ...(albums.status === 'fulfilled' ? albums.value.playlists : []),
    ];
    const seen = new Set();
    const unique = merged.filter((item) => {
      if (!item.id || seen.has(item.id)) return false;
      seen.add(item.id);
      return true;
    });
    if (unique.length) return unique.slice(0, 12);
  } catch { /* fallback */ }

  let lastError;
  for (const base of INVIDIOUS_INSTANCES) {
    try {
      const data = await fetchJson(
        `${base}/api/v1/search?q=${encodeURIComponent(query)}&type=playlist`
      );
      const items = Array.isArray(data) ? data : [];
      const playlists = items.map(normalizeInvidiousPlaylist).filter(Boolean);
      if (playlists.length) return playlists.slice(0, 12);
    } catch (err) {
      lastError = err;
    }
  }
  if (lastError) throw lastError;
  return [];
}

async function getPlaylistTracks(playlistId) {
  const id = String(playlistId || '').replace(/^VL/, '');
  const browseId = id.startsWith('PL') ? `VL${id}` : id;

  const ytm = (async () => {
    const data = await ytmPost('browse', {
      context: { client: YTM_CLIENT },
      browseId,
    });
    const tracks = walkMusicItems(data);
    if (!tracks.length) throw new Error('empty');
    return tracks;
  })();

  const invidious = INVIDIOUS_INSTANCES.map(async (base) => {
    const data = await fetchJson(`${base}/api/v1/playlists/${encodeURIComponent(id)}`);
    const videos = data?.videos || data?.latestVideos || [];
    const tracks = videos.map(normalizeInvidiousVideo).filter(Boolean);
    if (!tracks.length) throw new Error('empty');
    return tracks;
  });

  try {
    return await Promise.any([ytm, ...invidious]);
  } catch {
    throw new Error('Playlist empty');
  }
}

const JUNK_TITLE = /ראיון|חדשות|מסיבת עיתונאים|trailer|interview|news|shorts?|reaction|reels/i;

function scoreTrack(track, query) {
  const q = query.toLowerCase();
  const title = (track.title || '').toLowerCase();
  const artist = (track.artist || '').toLowerCase();
  const hay = `${title} ${artist}`;
  let score = 0;

  if (artist.includes(q) || q.split(/\s+/).every((w) => artist.includes(w))) score += 40;
  if (title.includes(q)) score += 25;
  q.split(/\s+/).filter(Boolean).forEach((word) => {
    if (hay.includes(word)) score += 8;
  });
  if (JUNK_TITLE.test(title)) score -= 50;
  if (track.durationSeconds > 0 && track.durationSeconds < 75) score -= 30;
  if (track.durationSeconds > 15 * 60) score -= 20;
  if (track.durationSeconds >= 120 && track.durationSeconds <= 8 * 60) score += 10;
  if (/official|topic|עידן|vevo/i.test(artist)) score += 6;
  return score;
}

function rankTracks(tracks, query) {
  const seen = new Set();
  return tracks
    .filter((track) => {
      if (!track?.id || seen.has(track.id)) return false;
      seen.add(track.id);
      return scoreTrack(track, query) > -20;
    })
    .sort((a, b) => scoreTrack(b, query) - scoreTrack(a, query))
    .slice(0, 30);
}

async function searchMusic(query, { page = 1, continuation } = {}) {
  if (continuation) {
    const more = await searchYoutubeMusic(query, { continuation });
    return {
      tracks: rankTracks(more.tracks, query),
      playlists: [],
      continuation: more.continuation || null,
      page,
    };
  }

  if (page > 1) {
    const extra = await searchInvidiousPaged(query, page);
    return {
      tracks: rankTracks(extra, query),
      playlists: [],
      continuation: null,
      page,
    };
  }

  const attempts = [
    () => searchYoutubeMusic(query),
    () => searchYoutubeMusic(`${query} שירים`),
    async () => ({ tracks: await searchInnertube(`${query} official audio`), playlists: [], continuation: null }),
    async () => ({ tracks: await searchInvidious(`${query} שירים`), playlists: [], continuation: null }),
    async () => ({ tracks: await searchInvidious(query), playlists: [], continuation: null }),
    async () => ({ tracks: await searchPiped(query), playlists: [], continuation: null }),
    async () => ({ tracks: await searchInnertube(query), playlists: [], continuation: null }),
  ];

  const collected = [];
  let nextContinuation = null;
  for (const attempt of attempts) {
    try {
      const result = await attempt();
      const tracks = Array.isArray(result) ? result : result.tracks || [];
      collected.push(...tracks);
      if (!nextContinuation && result?.continuation) nextContinuation = result.continuation;
      if (rankTracks(collected, query).length >= 12) break;
    } catch { /* try next source */ }
  }

  let playlists = [];
  try {
    playlists = await searchPlaylists(query);
  } catch { /* optional */ }

  const ranked = rankTracks(collected, query);
  if (!ranked.length && !playlists.length) throw new Error('No music results');
  return { tracks: ranked, playlists, continuation: nextContinuation, page: 1 };
}

async function searchInvidiousPaged(query, page) {
  let lastError;
  for (const base of INVIDIOUS_INSTANCES) {
    try {
      const data = await fetchJson(
        `${base}/api/v1/search?q=${encodeURIComponent(query)}&type=video&page=${page}&sort_by=relevance`
      );
      const items = Array.isArray(data) ? data : data?.items || [];
      const tracks = items.map(normalizeInvidiousVideo).filter(Boolean);
      if (tracks.length) return tracks;
    } catch (err) {
      lastError = err;
    }
  }
  throw lastError || new Error('Paged search failed');
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
  const page = Math.max(1, Number(req.query.page) || 1);
  const continuation = String(req.query.continuation || '').trim();
  if (!query) return res.json({ tracks: [], playlists: [] });

  const cacheKey = `ytm3:${query.toLowerCase()}:${page}:${continuation.slice(0, 24)}`;
  const cached = cacheGet(searchCache, cacheKey, SEARCH_CACHE_TTL_MS);
  if (cached) return res.json({ ...cached, cached: true });

  try {
    const result = await searchMusic(query, { page, continuation: continuation || undefined });
    cacheSet(searchCache, cacheKey, result);
    res.json(result);
  } catch (err) {
    console.error('[music] search failed:', err.message);
    res.status(502).json({ error: 'search_failed', message: err.message, tracks: [], playlists: [] });
  }
});

router.get('/playlist/:id', async (req, res) => {
  const playlistId = String(req.params.id || '').trim();
  if (!playlistId) return res.status(400).json({ error: 'invalid_id', tracks: [] });

  const cached = cacheGet(relatedCache, `pl:${playlistId}`, RELATED_CACHE_TTL_MS);
  if (cached) return res.json({ tracks: cached, cached: true });

  try {
    const tracks = await getPlaylistTracks(playlistId);
    cacheSet(relatedCache, `pl:${playlistId}`, tracks);
    res.json({ tracks });
  } catch (err) {
    console.error('[music] playlist failed:', err.message);
    res.status(502).json({ error: 'playlist_failed', message: err.message, tracks: [] });
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
  { id: 'focus', title: 'ריכוז', query: 'focus instrumental music', color: '#3d7ea6' },
  { id: 'workout', title: 'אימון', query: 'workout hits', color: '#e07a3d' },
  { id: 'romance', title: 'רומנטי', query: 'שירי אהבה ישראלים', color: '#c45c8a' },
  { id: 'charts', title: 'מצעדים', query: 'israel top hits this week', color: '#5b4fd6' },
];

async function trendingMusic() {
  const queries = ['להיטים ישראלים', 'שירי ארץ ישראל', 'best music mix'];
  try {
    const ytm = await searchYoutubeMusic(queries[0]);
    if (ytm.tracks.length) return ytm.tracks.slice(0, 16);
  } catch { /* fallback */ }
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

// ---------------------------------------------------------------------------
// yt-dlp audio streaming — lets audio-only Google Cast targets (Nest Mini,
// Google Home) play a YouTube track. Those devices cannot render the YouTube
// app when cast from Home Assistant; they only accept a plain HTTP audio URL.
// We therefore expose a self-hosted endpoint that pulls the best audio with
// yt-dlp and transcodes it to MP3 on the fly with ffmpeg.
//
// The stream URL is fetched directly by the cast device over the LAN, so it
// cannot carry the API bearer token. Instead it is protected by a short HMAC
// signature (see signStreamToken) derived from the server's api_token. The
// auth bypass for this route lives in backend/server.js.
// ---------------------------------------------------------------------------

const STREAM_SECRET_FALLBACK = 'smart-mirror-stream';

function getApiSecret(req) {
  try {
    const row = req.app.locals.db.prepare("SELECT value FROM config WHERE key = 'api_token'").get();
    if (row && row.value) return row.value;
  } catch { /* db unavailable — fall through */ }
  return STREAM_SECRET_FALLBACK;
}

function signStreamToken(secret, id) {
  return crypto
    .createHmac('sha256', secret || STREAM_SECRET_FALLBACK)
    .update(String(id))
    .digest('hex')
    .slice(0, 24);
}

function verifyStreamToken(secret, id, token) {
  if (!token) return false;
  const expected = signStreamToken(secret, id);
  const a = Buffer.from(expected);
  const b = Buffer.from(String(token));
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

function detectLanIp() {
  const ifaces = os.networkInterfaces();
  for (const name of Object.keys(ifaces)) {
    for (const net of ifaces[name] || []) {
      if (net.family === 'IPv4' && !net.internal) return net.address;
    }
  }
  return null;
}

// GET /api/music/cast-url/:id — authenticated (localhost/bearer). Returns an
// absolute, LAN-reachable, signed MP3 stream URL for the given video id that
// can be handed to Home Assistant's media_player.play_media.
router.get('/cast-url/:id', (req, res) => {
  const id = String(req.params.id || '').trim();
  if (!/^[a-zA-Z0-9_-]{11}$/.test(id)) {
    return res.status(400).json({ error: 'invalid_id' });
  }
  const host = process.env.STREAM_HOST || detectLanIp();
  if (!host) {
    return res.status(500).json({ error: 'no_lan_ip', message: 'Could not determine LAN IP for cast URL' });
  }
  const port = parseInt(process.env.PORT, 10) || 3001;
  const token = signStreamToken(getApiSecret(req), id);
  const url = `http://${host}:${port}/api/music/stream/${id}.mp3?token=${token}`;
  res.json({ url });
});

// POST /api/music/prewarm/:id — authenticated. Pre-converts a track to the
// on-disk MP3 cache so a later cast starts instantly. Used to warm the *next*
// queued song while the current one is playing. Fire-and-forget: returns
// immediately with the warming status.
router.post('/prewarm/:id', (req, res) => {
  const id = String(req.params.id || '').trim();
  if (!/^[a-zA-Z0-9_-]{11}$/.test(id)) {
    return res.status(400).json({ error: 'invalid_id' });
  }
  if (isCached(id)) return res.json({ status: 'ready' });

  const logger = req.app.locals.logger;
  transcodeToFile(id, logger).catch((err) => {
    logger?.warn('[music] prewarm failed for %s: %s', id, err.message);
  });
  res.json({ status: 'warming' });
});

// GET /api/music/stream/:file — public (signed) MP3 stream fetched by the cast
// device. :file is "<videoId>.mp3". If the track is already in the on-disk
// cache it's served as a static (seekable, Range-capable) file for instant
// start; otherwise it's transcoded live via yt-dlp | ffmpeg.
router.get('/stream/:file', (req, res) => {
  const file = String(req.params.file || '');
  const id = file.replace(/\.mp3$/i, '');
  if (!/^[a-zA-Z0-9_-]{11}$/.test(id)) {
    return res.status(400).end();
  }
  if (!verifyStreamToken(getApiSecret(req), id, req.query.token)) {
    return res.status(403).end();
  }

  const logger = req.app.locals.logger;

  // Fast path: pre-converted file. res.sendFile handles Content-Type,
  // Content-Length, and HTTP Range (seeking) automatically.
  if (isCached(id)) {
    return res.sendFile(cachePath(id), { headers: { 'Cache-Control': 'no-store' } }, (err) => {
      if (err && !res.headersSent) res.status(500).end();
    });
  }

  const sourceUrl = `https://www.youtube.com/watch?v=${id}`;

  res.setHeader('Content-Type', 'audio/mpeg');
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Accept-Ranges', 'none');

  // yt-dlp: grab the best audio-only stream and write it to stdout.
  const ytdlp = spawn(
    YTDLP_BIN,
    ['-q', '--no-warnings', '--no-playlist', '-f', 'bestaudio/best', '-o', '-', sourceUrl],
    { stdio: ['ignore', 'pipe', 'pipe'] }
  );

  // ffmpeg: transcode whatever container yt-dlp produced into a raw MP3 stream.
  const ffmpeg = spawn(
    FFMPEG_BIN,
    ['-hide_banner', '-loglevel', 'error', '-i', 'pipe:0', '-vn', '-acodec', 'libmp3lame', '-b:a', '192k', '-f', 'mp3', 'pipe:1'],
    { stdio: ['pipe', 'pipe', 'pipe'] }
  );

  let finished = false;
  const cleanup = () => {
    if (finished) return;
    finished = true;
    try { ytdlp.kill('SIGKILL'); } catch { /* already gone */ }
    try { ffmpeg.kill('SIGKILL'); } catch { /* already gone */ }
  };

  ytdlp.on('error', (err) => {
    logger?.error('[music] yt-dlp spawn failed: %s', err.message);
    if (!res.headersSent) res.status(502).end();
    cleanup();
  });
  ffmpeg.on('error', (err) => {
    logger?.error('[music] ffmpeg spawn failed: %s', err.message);
    if (!res.headersSent) res.status(502).end();
    cleanup();
  });

  ytdlp.stderr.on('data', (d) => logger?.debug('[music] yt-dlp: %s', String(d).trim()));
  ffmpeg.stderr.on('data', (d) => logger?.debug('[music] ffmpeg: %s', String(d).trim()));

  ytdlp.stdout.pipe(ffmpeg.stdin);
  ffmpeg.stdout.pipe(res);

  ffmpeg.stdin.on('error', () => { /* yt-dlp closed early; ignore EPIPE */ });
  ffmpeg.on('close', cleanup);
  ytdlp.on('close', (code) => {
    if (code && code !== 0) logger?.warn('[music] yt-dlp exited with code %d for %s', code, id);
  });

  req.on('close', cleanup);
  res.on('close', cleanup);
});

router.signStreamToken = signStreamToken;
router.verifyStreamToken = verifyStreamToken;

module.exports = router;
