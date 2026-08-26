import { useCallback, useEffect, useRef, useState } from 'react';
import { fetchApi } from './useApi.js';
import useStore from '../store/index.js';
import t from '../i18n/he.json';
import useYoutubePlayer from './useYoutubePlayer.js';

const QUEUE_KEY = 'smartMirror.music.queue';
const VOLUME_KEY = 'smartMirror.music.volume';
const INDEX_KEY = 'smartMirror.music.index';
const OUTPUT_KEY = 'smartMirror.music.output';

const DEFAULT_MIXES = [
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

function classifyPlayer(entity) {
  const id = entity.entity_id || '';
  const name = entity.attributes?.friendly_name || id;
  const deviceClass = entity.attributes?.device_class || '';
  const blob = `${id} ${name} ${deviceClass}`.toLowerCase();
  const google = /googlehome|google_home|nestmini|nest_mini|nest_hub|nest_audio|chromecast|\bnest\b/.test(blob);
  const speaker = deviceClass === 'speaker'
    || /nestmini|nest_mini|googlehome|nest_audio|home mini|minispeaker/.test(blob);
  const tv = deviceClass === 'tv' || /tv|shield|mibox|mi_box|android_tv|stb|xiaomi|nest_hub/.test(blob);
  return {
    id,
    name,
    state: entity.state,
    kind: speaker ? 'speaker' : tv ? 'tv' : 'other',
    google,
    audioOnly: speaker && !tv,
    available: entity.state !== 'unavailable' && entity.state !== 'unknown',
  };
}

function cleanMusicText(value) {
  return String(value || '')
    .split('|')[0]
    .replace(/\s*[-–—]\s*(official|lyrics|audio|video).*$/i, '')
    .trim();
}

function assistantPlayCommands(track, speakerName) {
  const title = cleanMusicText(track.title) || track.title;
  const artist = cleanMusicText(track.artist);
  const onDevice = speakerName || 'Living Room';
  return [
    artist
      ? `Play ${title} by ${artist} on YouTube Music on ${onDevice}`
      : `Play ${title} on YouTube Music on ${onDevice}`,
    `Play ${title} on YouTube Music on ${onDevice}`,
    artist ? `Play ${title} by ${artist} on ${onDevice}` : `Play ${title} on ${onDevice}`,
    `נגן ${title} ביוטיוב מיוזיק ב${onDevice}`,
  ];
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function haService(domain, service, body) {
  return fetchApi(`/api/ha/services/${domain}/${service}`, {
    method: 'POST',
    body: JSON.stringify(body),
  });
}

async function stopCast(entityId) {
  if (!entityId || entityId === 'local') return;
  try {
    await haService('media_player', 'media_stop', { entity_id: entityId });
  } catch {
    try {
      await haService('media_player', 'media_pause', { entity_id: entityId });
    } catch { /* ignore */ }
  }
}

async function speakerState(entityId) {
  const data = await fetchApi('/api/ha/states');
  return (data.states || []).find((item) => item.entity_id === entityId) || null;
}

async function waitUntilPlaying(entityId) {
  for (let i = 0; i < 6; i += 1) {
    await sleep(800);
    const ent = await speakerState(entityId);
    if (ent?.state === 'playing') return true;
  }
  return false;
}

async function castViaStream(track, entityId) {
  const data = await fetchApi(`/api/music/cast-url/${track.id}`);
  const url = data?.url;
  if (!url) throw new Error('no stream url');
  await haService('media_player', 'play_media', {
    entity_id: entityId,
    media_content_id: url,
    media_content_type: 'music',
    extra: {
      metadata: {
        metadataType: 3,
        title: cleanMusicText(track.title) || track.title,
        artist: cleanMusicText(track.artist) || undefined,
        images: track.imageUrl ? [{ url: track.imageUrl }] : undefined,
      },
    },
  });
}

async function castTrack(track, speaker) {
  const entityId = typeof speaker === 'string' ? speaker : speaker?.id;
  const name = typeof speaker === 'string' ? speaker : speaker?.name || entityId;
  const audioOnly = typeof speaker === 'object'
    ? speaker.audioOnly
    : /nestmini|googlehome|nest_audio/.test(String(entityId));

  try {
    await haService('media_player', 'volume_mute', { entity_id: entityId, is_volume_muted: false });
  } catch { /* optional */ }

  if (audioOnly) {
    try { await haService('media_player', 'media_stop', { entity_id: entityId }); } catch { /* optional */ }
    await sleep(400);

    // Primary: self-hosted yt-dlp MP3 stream. Nest Mini / Google Home speakers
    // cannot render the YouTube app, but they play a plain MP3 URL directly.
    try {
      await castViaStream(track, entityId);
      return;
    } catch (streamErr) {
      // Fall back to the Google Assistant voice command below.
    }

    let lastErr;
    for (const command of assistantPlayCommands(track, name)) {
      try {
        await haService('google_assistant_sdk', 'send_text_command', { command });
        if (await waitUntilPlaying(entityId)) return;
      } catch (err) {
        lastErr = err;
      }
    }
    throw lastErr || new Error('assistant cast failed');
  }

  const payloads = [
    { media_content_type: 'cast', media_content_id: JSON.stringify({ app_name: 'youtube', media_id: track.id }) },
    { media_content_type: 'video/youtube', media_content_id: track.id },
    { media_content_type: 'cast', media_content_id: `https://www.youtube.com/watch?v=${track.id}` },
    { media_content_type: 'music', media_content_id: `https://music.youtube.com/watch?v=${track.id}` },
  ];
  let lastErr;
  for (const extra of payloads) {
    try {
      await haService('media_player', 'play_media', { entity_id: entityId, ...extra });
      return;
    } catch (err) {
      lastErr = err;
    }
  }

  // Final fallback for video-capable targets: the transcoded MP3 stream.
  try {
    await castViaStream(track, entityId);
    return;
  } catch (streamErr) {
    lastErr = streamErr;
  }
  throw lastErr || new Error('cast failed');
}

function loadJson(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch {
    return fallback;
  }
}

function persist(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch { /* quota */ }
}

export default function useMusic() {
  const addToast = useStore((s) => s.addToast);

  const [queue, setQueue] = useState(() => loadJson(QUEUE_KEY, []));
  const [currentIndex, setCurrentIndex] = useState(() => {
    const saved = Number(localStorage.getItem(INDEX_KEY));
    return Number.isFinite(saved) ? saved : -1;
  });
  const [volume, setVolumeState] = useState(() => {
    const saved = Number(localStorage.getItem(VOLUME_KEY));
    return Number.isFinite(saved) ? saved : 70;
  });
  const [shuffle, setShuffle] = useState(false);
  const [repeat, setRepeat] = useState('off');
  const [searchQuery, setSearchQuery] = useState('');
  const [results, setResults] = useState([]);
  const [playlists, setPlaylists] = useState([]);
  const [suggestions, setSuggestions] = useState([]);
  const [searching, setSearching] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [searchError, setSearchError] = useState(null);
  const [searchPage, setSearchPage] = useState(1);
  const [searchContinuation, setSearchContinuation] = useState(null);
  const [hasMore, setHasMore] = useState(false);
  const [recommended, setRecommended] = useState({ mixes: DEFAULT_MIXES, tracks: [] });
  const [recommendedLoading, setRecommendedLoading] = useState(true);
  const [outputId, setOutputIdState] = useState(() => {
    try { return localStorage.getItem(OUTPUT_KEY) || 'local'; } catch { return 'local'; }
  });
  const [speakers, setSpeakers] = useState([]);
  const [castPlaying, setCastPlaying] = useState(false);
  const [castPosition, setCastPosition] = useState(0);
  const [castDuration, setCastDuration] = useState(0);
  // Anchor for interpolating cast position between HA polls:
  // { position (s), at (ms epoch when that position was current), playing }
  const castAnchorRef = useRef({ position: 0, at: 0, playing: false });

  const searchTimer = useRef(null);
  const suggestTimer = useRef(null);
  const queueRef = useRef(queue);
  const indexRef = useRef(currentIndex);
  const repeatRef = useRef(repeat);
  const shuffleRef = useRef(shuffle);
  const playIndexRef = useRef(() => {});
  const playTrackRef = useRef(() => {});
  const outputRef = useRef(outputId);
  const playlistRestRef = useRef([]);
  const speakersRef = useRef([]);
  const handleEndedRef = useRef(() => {});
  // Tracks cast playback lifecycle so we can auto-advance when the speaker
  // finishes a track: { id: current track id, sawPlaying: has it started }.
  const castEndGuardRef = useRef({ id: null, sawPlaying: false });

  useEffect(() => { queueRef.current = queue; persist(QUEUE_KEY, queue); }, [queue]);
  useEffect(() => {
    indexRef.current = currentIndex;
    try { localStorage.setItem(INDEX_KEY, String(currentIndex)); } catch { /* ignore */ }
  }, [currentIndex]);
  useEffect(() => { repeatRef.current = repeat; }, [repeat]);
  useEffect(() => { shuffleRef.current = shuffle; }, [shuffle]);
  useEffect(() => { outputRef.current = outputId; }, [outputId]);
  useEffect(() => { speakersRef.current = speakers; }, [speakers]);

  const currentTrack = currentIndex >= 0 ? queue[currentIndex] || null : null;

  const handleEnded = useCallback(() => {
    const list = queueRef.current;
    const idx = indexRef.current;
    const mode = repeatRef.current;

    if (mode === 'one' && list[idx]?.id) {
      playIndexRef.current(idx, list);
      return;
    }

    if (shuffleRef.current && list.length > 1) {
      let nextIdx = Math.floor(Math.random() * list.length);
      if (nextIdx === idx) nextIdx = (nextIdx + 1) % list.length;
      playIndexRef.current(nextIdx, list);
      return;
    }

    if (idx < list.length - 1) {
      playIndexRef.current(idx + 1, list);
      return;
    }

    if (mode === 'all' && list.length) {
      playIndexRef.current(0, list);
      return;
    }

    const upcoming = playlistRestRef.current.shift();
    if (upcoming?.id) {
      playTrackRef.current?.(upcoming);
      return;
    }

    const last = list[idx];
    if (last?.id) {
      fetchApi(`/api/music/related/${last.id}`).then((data) => {
        const related = (data.tracks || []).filter((item) => !list.some((q) => q.id === item.id));
        if (!related.length) return;
        const nextTrack = related[0];
        const updated = [...list, nextTrack];
        setQueue(updated);
        queueRef.current = updated;
        playIndexRef.current(updated.length - 1, updated);
      }).catch(() => {});
    }
  }, []);

  const handleError = useCallback(() => {
    addToast('error', t.music.playbackError);
    const list = queueRef.current;
    const idx = indexRef.current;
    if (idx < list.length - 1) playIndexRef.current(idx + 1, list);
  }, [addToast, t.music.playbackError]);

  const player = useYoutubePlayer({
    onEnded: handleEnded,
    onError: handleError,
    initialVolume: volume,
  });
  const playerRef = useRef(player);
  useEffect(() => { playerRef.current = player; }, [player]);
  useEffect(() => { handleEndedRef.current = handleEnded; }, [handleEnded]);

  const playIndex = useCallback((index, list = queueRef.current) => {
    if (index < 0 || index >= list.length) return;
    setCurrentIndex(index);
    const track = list[index];
    if (!track?.id) return;
    if (outputRef.current && outputRef.current !== 'local') {
      try { playerRef.current.pause?.(); } catch { /* ignore */ }
      const speaker = speakersRef.current.find((item) => item.id === outputRef.current)
        || { id: outputRef.current, name: outputRef.current, audioOnly: /nestmini|googlehome|nest_audio/.test(outputRef.current) };
      castTrack(track, speaker)
        .then(() => setCastPlaying(true))
        .catch(() => {
          addToast('error', t.music.castYoutubeBlocked);
          setOutputIdState('local');
          outputRef.current = 'local';
          setCastPlaying(false);
          playerRef.current.load?.(track.id, true);
        });
      return;
    }
    playerRef.current.load(track.id, true);
  }, [addToast]);

  useEffect(() => { playIndexRef.current = playIndex; }, [playIndex]);

  useEffect(() => {
    if (player.ready) player.setVolume(volume);
  }, [player.ready, player.setVolume, volume]);

  useEffect(() => {
    if (player.ready && currentTrack?.id) {
      player.load(currentTrack.id, false);
    }
    // cue restored track once the iframe is ready
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [player.ready]);

  const search = useCallback(async (query) => {
    if (query !== undefined) setSearchQuery(query);
    const q = String(query ?? '').trim();
    if (!q) {
      setResults([]);
      setPlaylists([]);
      setSuggestions([]);
      setSearchError(null);
      setSearching(false);
      setHasMore(false);
      setSearchContinuation(null);
      setSearchPage(1);
      return;
    }
    setSearching(true);
    setSearchError(null);
    try {
      const data = await fetchApi(`/api/music/search?q=${encodeURIComponent(q)}`);
      setResults(data.tracks || []);
      setPlaylists(data.playlists || []);
      setSearchContinuation(data.continuation || null);
      setSearchPage(data.page || 1);
      setHasMore(Boolean(data.continuation) || (data.tracks || []).length >= 8);
    } catch (err) {
      console.error('[music] search failed:', err);
      setSearchError(err.message);
      setResults([]);
      setPlaylists([]);
      setHasMore(false);
      addToast('error', t.music.searchError);
    } finally {
      setSearching(false);
    }
  }, [addToast, t.music.searchError]);

  const loadMore = useCallback(async () => {
    const q = String(searchQuery || '').trim();
    if (!q || loadingMore || searching || !hasMore) return;
    setLoadingMore(true);
    try {
      const nextPage = searchPage + 1;
      const params = new URLSearchParams({ q, page: String(nextPage) });
      if (searchContinuation) params.set('continuation', searchContinuation);
      const data = await fetchApi(`/api/music/search?${params.toString()}`);
      const extra = data.tracks || [];
      setResults((prev) => {
        const seen = new Set(prev.map((item) => item.id));
        return [...prev, ...extra.filter((item) => !seen.has(item.id))];
      });
      setSearchContinuation(data.continuation || null);
      setSearchPage(data.page || nextPage);
      setHasMore(Boolean(data.continuation) || extra.length >= 8);
    } catch (err) {
      console.error('[music] load more failed:', err);
      setHasMore(false);
    } finally {
      setLoadingMore(false);
    }
  }, [searchQuery, loadingMore, searching, hasMore, searchPage, searchContinuation]);

  const suggest = useCallback((query) => {
    const q = String(query || '').trim();
    if (suggestTimer.current) clearTimeout(suggestTimer.current);
    if (!q) {
      setSuggestions([]);
      return;
    }
    suggestTimer.current = setTimeout(async () => {
      try {
        const data = await fetchApi(`/api/music/suggest?q=${encodeURIComponent(q)}`);
        setSuggestions(data.suggestions || []);
      } catch {
        setSuggestions([]);
      }
    }, 200);
  }, []);

  const debounceSearch = useCallback((query) => {
    setSearchQuery(query);
    suggest(query);
    if (searchTimer.current) clearTimeout(searchTimer.current);
    searchTimer.current = setTimeout(() => search(query), 400);
  }, [search, suggest]);

  const playTrack = useCallback((track, extras = []) => {
    setQueue((prev) => {
      const existing = prev.findIndex((item) => item.id === track.id);
      if (existing >= 0) {
        queueRef.current = prev;
        playIndex(existing, prev);
        return prev;
      }
      const next = [
        ...prev,
        track,
        ...extras.filter((item) => item.id !== track.id && !prev.some((p) => p.id === item.id)),
      ];
      queueRef.current = next;
      playIndex(next.findIndex((item) => item.id === track.id), next);
      return next;
    });
  }, [playIndex]);

  useEffect(() => { playTrackRef.current = playTrack; }, [playTrack]);

  const openPlaylist = useCallback(async (playlist) => {
    setSearching(true);
    try {
      const data = await fetchApi(`/api/music/playlist/${encodeURIComponent(playlist.id)}`);
      const tracks = data.tracks || [];
      if (!tracks.length) {
        addToast('error', t.music.noResults);
        return;
      }
      setResults(tracks);
      setPlaylists([]);
      setHasMore(false);
      playlistRestRef.current = tracks.slice(1);
      playTrack(tracks[0]);
    } catch (err) {
      console.error('[music] playlist failed:', err);
      addToast('error', t.music.searchError);
    } finally {
      setSearching(false);
    }
  }, [addToast, playTrack]);

  const addToQueue = useCallback((track) => {
    setQueue((prev) => {
      if (prev.some((item) => item.id === track.id)) return prev;
      return [...prev, track];
    });
    addToast('success', t.music.addedToQueue);
  }, [addToast, t.music.addedToQueue]);

  const removeFromQueue = useCallback((index) => {
    const list = queueRef.current;
    const wasCurrent = index === indexRef.current;
    const next = list.filter((_, i) => i !== index);
    let nextIndex = indexRef.current;
    if (index < nextIndex) nextIndex -= 1;
    else if (index === nextIndex) nextIndex = next.length ? Math.min(nextIndex, next.length - 1) : -1;
    setQueue(next);
    queueRef.current = next;
    setCurrentIndex(nextIndex);
    if (wasCurrent) {
      if (nextIndex >= 0) playIndex(nextIndex, next);
      else {
        try { playerRef.current.pause?.(); } catch { /* ignore */ }
        setCastPlaying(false);
      }
    }
  }, [playIndex]);

  const clearQueue = useCallback(() => {
    setQueue([]);
    setCurrentIndex(-1);
    player.pause();
  }, [player]);

  const loadRecommended = useCallback(async () => {
    setRecommendedLoading(true);
    try {
      const data = await fetchApi('/api/music/recommended');
      setRecommended({
        mixes: data.mixes?.length ? data.mixes : DEFAULT_MIXES,
        tracks: data.tracks || [],
      });
      return (data.tracks || []).length;
    } catch {
      setRecommended((prev) => ({ mixes: prev.mixes.length ? prev.mixes : DEFAULT_MIXES, tracks: prev.tracks }));
      return -1;
    } finally {
      setRecommendedLoading(false);
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      for (let i = 0; i < 3 && !cancelled; i += 1) {
        const count = await loadRecommended();
        if (cancelled || count > 0) return;
        await new Promise((resolve) => setTimeout(resolve, 1500 * (i + 1)));
      }
    })();
    return () => { cancelled = true; };
  }, [loadRecommended]);

  const loadSpeakers = useCallback(async () => {
    try {
      const data = await fetchApi('/api/ha/states');
      const players = (data.states || [])
        .filter((e) => e.entity_id?.startsWith('media_player.'))
        .map(classifyPlayer)
        .sort((a, b) => {
          if (a.kind === 'speaker' && b.kind !== 'speaker') return -1;
          if (b.kind === 'speaker' && a.kind !== 'speaker') return 1;
          if (a.available !== b.available) return a.available ? -1 : 1;
          return a.name.localeCompare(b.name, 'he');
        });
      setSpeakers(players);
    } catch {
      setSpeakers([]);
    }
  }, []);

  useEffect(() => { loadSpeakers(); }, [loadSpeakers]);

  // While casting to an external speaker the local YouTube player is paused, so
  // its position/duration are stale. Poll the HA media_player every few seconds
  // for media_position / media_duration and interpolate between polls with a
  // local ticker so the progress bar advances smoothly.
  useEffect(() => {
    if (outputId === 'local') {
      castAnchorRef.current = { position: 0, at: 0, playing: false };
      setCastPosition(0);
      setCastDuration(0);
      return undefined;
    }

    let cancelled = false;

    const poll = async () => {
      try {
        const data = await fetchApi(`/api/ha/state/${encodeURIComponent(outputId)}`);
        const st = data?.state;
        if (!st || cancelled) return;
        const attr = st.attributes || {};
        const playing = st.state === 'playing';
        const parsedAt = attr.media_position_updated_at
          ? Date.parse(attr.media_position_updated_at)
          : Date.now();
        castAnchorRef.current = {
          position: Number(attr.media_position) || 0,
          at: Number.isFinite(parsedAt) ? parsedAt : Date.now(),
          playing,
        };
        setCastPlaying(playing);
        const dur = Number(attr.media_duration) || 0;
        if (dur > 0) setCastDuration(dur);

        // Auto-advance: the local player's onEnded never fires while casting.
        // Google Cast reports state 'idle' (sometimes 'off'/'standby') once a
        // track finishes. Only advance after we've actually observed the track
        // playing, so the initial idle/stop before playback doesn't skip it.
        const curId = queueRef.current[indexRef.current]?.id || null;
        const guard = castEndGuardRef.current;
        if (guard.id !== curId) {
          castEndGuardRef.current = { id: curId, sawPlaying: false };
        }
        if (playing) {
          castEndGuardRef.current.sawPlaying = true;
        } else if (
          castEndGuardRef.current.sawPlaying &&
          (st.state === 'idle' || st.state === 'off' || st.state === 'standby')
        ) {
          castEndGuardRef.current = { id: curId, sawPlaying: false };
          handleEndedRef.current?.();
        }
      } catch {
        /* transient — keep interpolating from the last anchor */
      }
    };

    poll();
    const pollTimer = setInterval(poll, 2000);
    const ticker = setInterval(() => {
      const a = castAnchorRef.current;
      if (!a.at) return;
      const extra = a.playing ? (Date.now() - a.at) / 1000 : 0;
      setCastPosition(a.position + extra);
    }, 500);

    return () => {
      cancelled = true;
      clearInterval(pollTimer);
      clearInterval(ticker);
    };
  }, [outputId]);

  // Reset the interpolated position immediately when the casting track changes
  // so the bar doesn't briefly show the previous track's elapsed time.
  useEffect(() => {
    if (outputRef.current !== 'local') {
      castAnchorRef.current = { position: 0, at: Date.now(), playing: true };
      setCastPosition(0);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentIndex]);

  // Pre-convert the next queued track on the server while casting, so that when
  // it starts it plays instantly instead of waiting for yt-dlp/ffmpeg spin-up.
  useEffect(() => {
    if (outputId === 'local') return;
    const nextTrack = queue[currentIndex + 1];
    if (nextTrack?.id) {
      fetchApi(`/api/music/prewarm/${nextTrack.id}`, { method: 'POST' }).catch(() => {});
    }
  }, [currentIndex, outputId, queue]);

  const setOutputId = useCallback((id) => {
    const prev = outputRef.current;
    const next = id || 'local';
    setOutputIdState(next);
    outputRef.current = next;
    try { localStorage.setItem(OUTPUT_KEY, next); } catch { /* ignore */ }

    if (prev && prev !== 'local' && prev !== next) {
      stopCast(prev);
    }

    if (next !== 'local') {
      try { playerRef.current.pause?.(); } catch { /* ignore */ }
      const track = queueRef.current[indexRef.current];
      if (track?.id) {
        const speaker = speakersRef.current.find((item) => item.id === next)
          || { id: next, name: next, audioOnly: /nestmini|googlehome|nest_audio/.test(next) };
        castTrack(track, speaker)
          .then(() => setCastPlaying(true))
          .catch(() => {
            addToast('error', t.music.castYoutubeBlocked);
            stopCast(next);
            setOutputIdState('local');
            outputRef.current = 'local';
            setCastPlaying(false);
            playerRef.current.load?.(track.id, true);
          });
      }
    } else {
      setCastPlaying(false);
      const track = queueRef.current[indexRef.current];
      if (track?.id) playerRef.current.load?.(track.id, true);
    }
  }, [addToast]);

  const playPause = useCallback(() => {
    if (!currentTrack) return;
    if (outputRef.current && outputRef.current !== 'local') {
      const playing = castPlaying;
      // Freeze/resume the interpolation anchor immediately so the progress bar
      // reacts without waiting for the next HA poll.
      const a = castAnchorRef.current;
      const frozen = a.playing ? a.position + (Date.now() - a.at) / 1000 : a.position;
      castAnchorRef.current = { position: frozen, at: Date.now(), playing: !playing };
      fetchApi(`/api/ha/services/media_player/${playing ? 'media_pause' : 'media_play'}`, {
        method: 'POST',
        body: JSON.stringify({ entity_id: outputRef.current }),
      })
        .then(() => setCastPlaying(!playing))
        .catch(() => addToast('error', t.music.castError));
      return;
    }
    if (player.playing) player.pause();
    else player.play();
  }, [currentTrack, player, castPlaying, addToast]);

  const next = useCallback(() => {
    const list = queueRef.current;
    const idx = indexRef.current;
    if (shuffleRef.current && list.length > 1) {
      let n = Math.floor(Math.random() * list.length);
      if (n === idx) n = (n + 1) % list.length;
      playIndex(n, list);
      return;
    }
    if (idx < list.length - 1) playIndex(idx + 1, list);
    else if (playlistRestRef.current.length) playTrack(playlistRestRef.current.shift());
    else if (repeatRef.current === 'all' && list.length) playIndex(0, list);
  }, [playIndex, playTrack]);

  const previous = useCallback(() => {
    if (player.position > 3) {
      player.seek(0);
      return;
    }
    const list = queueRef.current;
    const idx = indexRef.current;
    if (idx > 0) playIndex(idx - 1, list);
    else player.seek(0);
  }, [playIndex, player]);

  const seek = useCallback((seconds) => {
    if (outputRef.current && outputRef.current !== 'local') {
      const target = Math.max(0, seconds);
      castAnchorRef.current = {
        position: target,
        at: Date.now(),
        playing: castAnchorRef.current.playing,
      };
      setCastPosition(target);
      fetchApi('/api/ha/services/media_player/media_seek', {
        method: 'POST',
        body: JSON.stringify({ entity_id: outputRef.current, seek_position: target }),
      }).catch(() => {});
      return;
    }
    player.seek(seconds);
  }, [player]);

  const setVolume = useCallback((value) => {
    const v = Math.max(0, Math.min(100, Number(value) || 0));
    setVolumeState(v);
    player.setVolume(v);
    try { localStorage.setItem(VOLUME_KEY, String(v)); } catch { /* ignore */ }
    if (outputRef.current && outputRef.current !== 'local') {
      fetchApi('/api/ha/services/media_player/volume_set', {
        method: 'POST',
        body: JSON.stringify({ entity_id: outputRef.current, volume_level: v / 100 }),
      }).catch(() => {});
    }
  }, [player]);

  const toggleShuffle = useCallback(() => setShuffle((s) => !s), []);
  const toggleRepeat = useCallback(() => {
    setRepeat((r) => (r === 'off' ? 'all' : r === 'all' ? 'one' : 'off'));
  }, []);

  return {
    currentTrack,
    queue,
    currentIndex,
    isPlaying: outputId !== 'local' ? castPlaying : player.playing,
    position: outputId !== 'local' ? castPosition : player.position,
    duration: outputId !== 'local'
      ? (castDuration || currentTrack?.durationSeconds || 0)
      : (player.duration || currentTrack?.durationSeconds || 0),
    volume,
    shuffle,
    repeat,
    searchQuery,
    results,
    playlists,
    suggestions,
    searching,
    loadingMore,
    hasMore,
    searchError,
    recommended,
    recommendedLoading,
    outputId,
    speakers,
    playerReady: player.ready,
    playerContainerRef: player.containerRef,
    resume: player.play,
    search,
    debounceSearch,
    loadRecommended,
    loadMore,
    openPlaylist,
    setSearchQuery,
    loadSpeakers,
    setOutputId,
    playTrack,
    addToQueue,
    removeFromQueue,
    clearQueue,
    playPause,
    next,
    previous,
    seek,
    setVolume,
    toggleShuffle,
    toggleRepeat,
    playIndex,
  };
}
