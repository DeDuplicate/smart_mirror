'use strict';

const express = require('express');
const os = require('os');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { spawn } = require('child_process');
const router = express.Router();

// External binaries used to turn a YouTube video into an audio file that
// audio-only cast targets (e.g. Google Nest Mini) can play directly.
// Both must be on PATH on the Raspberry Pi (installed by scripts/setup.sh) or
// overridden via env vars.
const YTDLP_BIN = process.env.YTDLP_PATH || 'yt-dlp';
const FFMPEG_BIN = process.env.FFMPEG_PATH || 'ffmpeg';

// On-disk audio cache. Converting before casting is not an optimisation here,
// it is required: a Cast receiver abandons a source it has to wait on, so the
// file must be complete before play_media is issued. Cached files are also
// seekable (support HTTP Range) so the progress bar can scrub.
const CACHE_DIR = path.join(__dirname, '..', 'cache', 'audio');
const CACHE_MAX_FILES = 40;
const MIN_CACHED_BYTES = 16 * 1024;
const warmJobs = new Map(); // videoId -> Promise (in-flight conversions)
// Negative cache for failed conversions. Without it, a client polling prewarm
// for an unconvertible track (e.g. an unavailable video) re-triggers a full
// yt-dlp+ffmpeg cycle on every poll — on a Pi 2 that pins all 4 cores forever.
const failedJobs = new Map(); // videoId -> failure timestamp
const FAIL_TTL_MS = 5 * 60 * 1000;

function recentlyFailed(id) {
  const at = failedJobs.get(id);
  if (!at) return false;
  if (Date.now() - at > FAIL_TTL_MS) {
    failedJobs.delete(id);
    return false;
  }
  return true;
}

// Prefer m4a: it is a stream copy, not a re-encode.
//
// YouTube itag 140 is already LC-AAC in an MP4 container, which is exactly
// `audio/mp4; codecs="mp4a.40.2"` in Google's supported-media table. So the
// track can be remuxed rather than transcoded. Measured on the Pi 2 for one
// 3:21 track:
//
//   remux  -c:a copy -> m4a     3.3s
//   encode libmp3lame 160k     37.7s
//   encode libmp3lame 192k     56.7s
//
// Verified on the actual Nest Mini, not just from the docs: 25s of playback
// reported 24.8s elapsed for both m4a and mp3.
//
// The earlier conclusion that "the Nest refuses AAC" was wrong in an important
// way. It refuses *bare ADTS* (`audio/aac`), which appears nowhere in Google's
// table — AAC is only ever listed inside MP4. Remuxing the same audio into an
// MP4 box plays perfectly. Do not collapse those two cases again.
//
// mp3 stays as the fallback for sources that are not AAC (yt-dlp hands back
// Opus/WebM when no m4a format exists), and for cast links issued before this.
//
// Both are served by res.sendFile, which sets Content-Type from the extension
// and handles Content-Length and Range. Cast needs that: the receiver probes
// near the end of an MP4 hunting for the `moov` atom, so the remux also passes
// -movflags +faststart to put moov up front.
const CACHE_FORMATS = [
  { ext: 'm4a', mime: 'audio/mp4' },
  { ext: 'mp3', mime: 'audio/mpeg' },
];
const CACHE_EXT_RE = /\.(m4a|aac|mp3)$/i;

function cachePath(id, ext = 'mp3') { return path.join(CACHE_DIR, `${id}.${ext}`); }
function partPath(id, ext = 'mp3') { return path.join(CACHE_DIR, `${id}.${ext}.part`); }

function ensureCacheDir() {
  try { fs.mkdirSync(CACHE_DIR, { recursive: true }); } catch { /* ignore */ }
}

/** The cached file for `id` in the most preferred available format, or null. */
function cachedFile(id) {
  for (const { ext, mime } of CACHE_FORMATS) {
    try {
      const p = cachePath(id, ext);
      const st = fs.statSync(p);
      if (st.isFile() && st.size >= MIN_CACHED_BYTES) return { path: p, ext, mime };
    } catch { /* try the next format */ }
  }
  return null;
}

function isCached(id) { return cachedFile(id) !== null; }

// Keep the newest CACHE_MAX_FILES tracks; delete the rest (simple disk LRU).
function pruneCache() {
  try {
    const files = fs.readdirSync(CACHE_DIR).filter((f) => CACHE_EXT_RE.test(f));
    if (files.length <= CACHE_MAX_FILES) return;
    const stats = files
      .map((f) => ({ f, t: fs.statSync(path.join(CACHE_DIR, f)).mtimeMs }))
      .sort((a, b) => a.t - b.t);
    for (const { f } of stats.slice(0, files.length - CACHE_MAX_FILES)) {
      try { fs.unlinkSync(path.join(CACHE_DIR, f)); } catch { /* ignore */ }
    }
  } catch { /* ignore */ }
}

// How to fetch the source for each container, and how to turn it into `out`.
//
// Both download to a real file rather than piping yt-dlp into ffmpeg. The pipe
// looked cheaper because the two stages overlap, but it cannot work for m4a:
// -movflags +faststart rewrites the file to move `moov` to the front, and a
// pipe is not seekable. Measurement also showed the overlap was worth little
// on this hardware — the two processes just contended for the same cores.
const FORMAT_PLANS = {
  // A stream copy. `140` is YouTube's 128k LC-AAC in MP4; asking for it by
  // itag skips yt-dlp's format sorting, which otherwise prefers Opus/WebM
  // (measured: `bestaudio/best` returns Opus) and would force a real re-encode
  // since Cast publishes no Opus media type.
  m4a: {
    format: '140/bestaudio[ext=m4a]',
    ffmpeg: (input, out) => [
      '-hide_banner', '-loglevel', 'error', '-i', input, '-vn',
      '-c:a', 'copy', '-movflags', '+faststart', '-f', 'mp4', '-y', out,
    ],
  },
  // Fallback for sources with no AAC/m4a format at all. -compression_level 7
  // is LAME quality 7: markedly faster than the default on an ARMv7 core and
  // inaudible on a smart speaker. 160k over 192k for the same reason.
  mp3: {
    format: 'bestaudio/best',
    ffmpeg: (input, out) => [
      '-hide_banner', '-loglevel', 'error', '-i', input, '-vn',
      '-acodec', 'libmp3lame', '-b:a', '160k', '-compression_level', '7',
      '-f', 'mp3', '-y', out,
    ],
  },
};

/** Run a child process to completion. Rejects with its stderr tail. */
function run(bin, args, logger, tag) {
  return new Promise((resolve, reject) => {
    const child = spawn(bin, args, { stdio: ['ignore', 'ignore', 'pipe'] });
    let stderr = '';
    child.on('error', (e) => reject(e));
    child.stderr.on('data', (d) => {
      const s = String(d);
      stderr = (stderr + s).slice(-500);
      logger?.debug('[music] %s: %s', tag, s.trim());
    });
    child.on('close', (code) => {
      if (code === 0) return resolve();
      reject(new Error(`${tag} exited ${code}${stderr ? `: ${stderr.trim()}` : ''}`));
    });
  });
}

// Warm yt-dlp daemon (backend/bin/yt-dlp-daemon.py, started by PM2). On a
// Pi 2, spawning the yt-dlp CLI costs ~3.8s of Python startup plus ~5s of
// imports and regex compilation *per track*; a warm in-process download is
// 4-6s total. The daemon also matters for correctness: extract_info returns
// nsig-unsolved URLs that googlevideo throttles to ~32KB/s, while
// ydl.download() solves nsig in-process and downloads at full LAN speed.
// Optional — any failure falls back to spawning the CLI.
const YTDLP_DAEMON_URL = process.env.YTDLP_DAEMON_URL || 'http://127.0.0.1:5055';
const YTDLP_DAEMON_TIMEOUT_MS = 180 * 1000;

/**
 * Download a track's audio to `outBase + ".<ext>"` via the warm daemon.
 * Returns the actual file path. Throws if the daemon is down or errors.
 */
async function downloadViaDaemon(id, outBase) {
  const res = await fetch(`${YTDLP_DAEMON_URL}/download`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ id, out: outBase }),
    signal: AbortSignal.timeout(YTDLP_DAEMON_TIMEOUT_MS),
  });
  const data = await res.json().catch(() => null);
  if (!res.ok || !data?.ok || !data.path) {
    throw new Error(data?.error || `daemon HTTP ${res.status}`);
  }
  return data.path;
}

/** True if an MP4 file has its `moov` atom before `mdat` (faststart). */
function isFaststart(filePath) {
  try {
    const fd = fs.openSync(filePath, 'r');
    const head = Buffer.alloc(64 * 1024);
    const n = fs.readSync(fd, head, 0, head.length, 0);
    fs.closeSync(fd);
    const moov = head.subarray(0, n).indexOf('moov');
    const mdat = head.subarray(0, n).indexOf('mdat');
    return moov > 0 && (mdat === -1 || moov < mdat);
  } catch {
    return false;
  }
}

async function convertOnce(id, format, logger) {
  const plan = FORMAT_PLANS[format.ext];
  if (!plan) throw new Error(`no conversion plan for .${format.ext}`);

  const src = `https://www.youtube.com/watch?v=${id}`;
  const out = partPath(id, format.ext);
  // Downloaded bytes land here; ffmpeg probes the container by content, so the
  // extension of this scratch file does not matter.
  const dl = `${out}.src`;

  // The daemon may produce a different extension than the bare `.src` scratch
  // name (e.g. `.src.m4a`); declared before the try so `finally` can see it.
  let dlActual = dl;
  try {
    try {
      dlActual = await downloadViaDaemon(id, dl);
    } catch (daemonErr) {
      logger?.debug('[music] yt-dlp daemon unavailable (%s), spawning CLI', daemonErr.message);
      await run(YTDLP_BIN, [
        '-q', '--no-warnings', '--no-playlist',
        '-f', plan.format,
        '-o', dl, src,
      ], logger, 'yt-dlp');
    }

    // yt-dlp's FixupM4a postprocessor already writes moov-at-front (verified:
    // moov at offset 32 on cached files), so the usual case needs no ffmpeg
    // pass at all — "conversion" is just the download. Remux only if the file
    // is NOT faststart, because a Cast receiver probes for moov early and an
    // end-of-file moov costs it an extra Range round-trip.
    if (format.ext === 'm4a' && isFaststart(dlActual)) {
      fs.renameSync(dlActual, out);
    } else {
      await run(FFMPEG_BIN, plan.ffmpeg(dlActual, out), logger, 'ffmpeg');
    }

    let size = 0;
    try { size = fs.statSync(out).size; } catch { /* missing below */ }
    if (size < MIN_CACHED_BYTES) throw new Error(`output too small (${size} bytes)`);

    fs.renameSync(out, cachePath(id, format.ext));
    pruneCache();
    return cachePath(id, format.ext);
  } catch (err) {
    try { fs.unlinkSync(out); } catch { /* ignore */ }
    throw err;
  } finally {
    // The daemon may have produced a different extension than the bare `.src`
    // scratch name (e.g. `.src.m4a`); remove whichever exists.
    try { fs.unlinkSync(dlActual); } catch { /* ignore */ }
    try { fs.unlinkSync(dl); } catch { /* ignore */ }
  }
}

// Fully download + transcode a track to the on-disk cache. De-duplicates
// concurrent requests for the same id via warmJobs. Resolves with the cached
// file path. Walks CACHE_FORMATS in order, so m4a (a stream copy) is tried
// first and mp3 (a real encode) only if the source has no AAC track.
function transcodeToFile(id, logger) {
  const hit = cachedFile(id);
  if (hit) return Promise.resolve(hit.path);
  if (warmJobs.has(id)) return warmJobs.get(id);

  ensureCacheDir();

  const job = (async () => {
    let lastErr;
    for (const format of CACHE_FORMATS) {
      try {
        return await convertOnce(id, format, logger);
      } catch (err) {
        lastErr = err;
        logger?.warn('[music] %s conversion failed for %s: %s', format.ext, id, err.message);
      }
    }
    failedJobs.set(id, Date.now());
    throw lastErr || new Error('conversion failed');
  })().finally(() => warmJobs.delete(id));

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
  // Advertise the extension we actually hold, so res.sendFile reports the
  // matching Content-Type. Hardcoding .mp3 here would hand the Nest an m4a
  // labelled audio/mpeg. Falls back to the preferred format for a track that
  // is not cached yet — the live path below encodes mp3.
  const ext = cachedFile(id)?.ext || 'mp3';
  const url = `http://${host}:${port}/api/music/stream/${id}.${ext}?token=${token}`;
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
  // A recent failure is sticky for FAIL_TTL_MS so polling clients back off
  // instead of restarting a doomed conversion every few seconds.
  if (recentlyFailed(id)) return res.json({ status: 'error' });

  const logger = req.app.locals.logger;
  transcodeToFile(id, logger).catch((err) => {
    logger?.warn('[music] prewarm failed for %s: %s', id, err.message);
  });
  res.json({ status: 'warming' });
});

// GET /api/music/stream/:file — public (signed) audio stream fetched by the
// cast device. :file is "<videoId>.m4a" (".mp3" for a non-AAC source or an
// older link; ".aac" only for defunct links). If the track is in the on-disk
// cache it's served as a static (seekable, Range-capable) file for instant
// start; otherwise it's produced live via yt-dlp | ffmpeg.
//
// The extension in the path selects nothing — res.sendFile below reports the
// Content-Type of whichever file is actually on disk, so the header always
// describes the real bytes even if the cache changed format since the URL was
// issued.
router.get('/stream/:file', (req, res) => {
  const file = String(req.params.file || '');
  const id = file.replace(CACHE_EXT_RE, '');
  if (!/^[a-zA-Z0-9_-]{11}$/.test(id)) {
    return res.status(400).end();
  }
  if (!verifyStreamToken(getApiSecret(req), id, req.query.token)) {
    return res.status(403).end();
  }

  const logger = req.app.locals.logger;

  // Fast path: pre-converted file. res.sendFile handles Content-Type,
  // Content-Length, and HTTP Range (seeking) automatically.
  const hit = cachedFile(id);
  if (hit) {
    return res.sendFile(hit.path, { headers: { 'Cache-Control': 'no-store' } }, (err) => {
      if (err && !res.headersSent) res.status(500).end();
    });
  }

  const sourceUrl = `https://www.youtube.com/watch?v=${id}`;

  // Live path — a last resort. Encoding MP3 on a Pi 2 only reaches ~1.9x
  // realtime, and a Cast receiver may abandon the stream waiting for data.
  // Prewarm the track (POST /api/music/prewarm/:id) so casts are served from
  // the on-disk cache by res.sendFile above, which starts instantly.
  //
  // This path stays mp3 even though the cache prefers m4a. An MP4 box needs a
  // seekable output to place `moov`, which a response stream is not, and the
  // streamable alternative (bare ADTS) is the one container a Nest Mini really
  // does refuse — Google publishes no `audio/aac` media type. So: m4a when we
  // can write a file, mp3 when we can only stream.
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
    ['-hide_banner', '-loglevel', 'error', '-i', 'pipe:0', '-vn',
     '-acodec', 'libmp3lame', '-b:a', '160k', '-compression_level', '7',
     '-f', 'mp3', 'pipe:1'],
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
