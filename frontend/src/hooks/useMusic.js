import { useCallback, useEffect, useRef, useState } from 'react';
import { fetchApi } from './useApi.js';
import useStore from '../store/index.js';
import t from '../i18n/he.json';
import useYoutubePlayer from './useYoutubePlayer.js';

const QUEUE_KEY = 'smartMirror.music.queue';
const VOLUME_KEY = 'smartMirror.music.volume';
const INDEX_KEY = 'smartMirror.music.index';
const OUTPUT_KEY = 'smartMirror.music.output';

async function castTrack(track, entityId) {
  const payloads = [
    { media_content_type: 'video/youtube', media_content_id: track.id },
    { media_content_type: 'cast', media_content_id: `https://www.youtube.com/watch?v=${track.id}` },
  ];
  let lastErr;
  for (const extra of payloads) {
    try {
      await fetchApi('/api/ha/services/media_player/play_media', {
        method: 'POST',
        body: JSON.stringify({ entity_id: entityId, ...extra }),
      });
      return;
    } catch (err) {
      lastErr = err;
    }
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
  const [suggestions, setSuggestions] = useState([]);
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState(null);
  const [recommended, setRecommended] = useState({ mixes: [], tracks: [] });
  const [outputId, setOutputIdState] = useState(() => {
    try { return localStorage.getItem(OUTPUT_KEY) || 'local'; } catch { return 'local'; }
  });
  const [speakers, setSpeakers] = useState([]);
  const [castPlaying, setCastPlaying] = useState(false);

  const searchTimer = useRef(null);
  const suggestTimer = useRef(null);
  const queueRef = useRef(queue);
  const indexRef = useRef(currentIndex);
  const repeatRef = useRef(repeat);
  const shuffleRef = useRef(shuffle);
  const playIndexRef = useRef(() => {});
  const outputRef = useRef(outputId);

  useEffect(() => { queueRef.current = queue; persist(QUEUE_KEY, queue); }, [queue]);
  useEffect(() => {
    indexRef.current = currentIndex;
    try { localStorage.setItem(INDEX_KEY, String(currentIndex)); } catch { /* ignore */ }
  }, [currentIndex]);
  useEffect(() => { repeatRef.current = repeat; }, [repeat]);
  useEffect(() => { shuffleRef.current = shuffle; }, [shuffle]);
  useEffect(() => { outputRef.current = outputId; }, [outputId]);

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

  const player = useYoutubePlayer({ onEnded: handleEnded, onError: handleError });
  const playerRef = useRef(player);
  useEffect(() => { playerRef.current = player; }, [player]);

  const playIndex = useCallback((index, list = queueRef.current) => {
    if (index < 0 || index >= list.length) return;
    setCurrentIndex(index);
    const track = list[index];
    if (!track?.id) return;
    if (outputRef.current && outputRef.current !== 'local') {
      try { playerRef.current.pause?.(); } catch { /* ignore */ }
      castTrack(track, outputRef.current)
        .then(() => setCastPlaying(true))
        .catch(() => addToast('error', t.music.castError));
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
      setSuggestions([]);
      setSearchError(null);
      setSearching(false);
      return;
    }
    setSearching(true);
    setSearchError(null);
    try {
      const data = await fetchApi(`/api/music/search?q=${encodeURIComponent(q)}`);
      setResults(data.tracks || []);
    } catch (err) {
      console.error('[music] search failed:', err);
      setSearchError(err.message);
      setResults([]);
      addToast('error', t.music.searchError);
    } finally {
      setSearching(false);
    }
  }, [addToast, t.music.searchError]);

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

  const addToQueue = useCallback((track) => {
    setQueue((prev) => {
      if (prev.some((item) => item.id === track.id)) return prev;
      return [...prev, track];
    });
    addToast('success', t.music.addedToQueue);
  }, [addToast, t.music.addedToQueue]);

  const removeFromQueue = useCallback((index) => {
    setQueue((prev) => {
      const next = prev.filter((_, i) => i !== index);
      setCurrentIndex((cur) => {
        if (index < cur) return cur - 1;
        if (index === cur) return next.length ? Math.min(cur, next.length - 1) : -1;
        return cur;
      });
      return next;
    });
  }, []);

  const clearQueue = useCallback(() => {
    setQueue([]);
    setCurrentIndex(-1);
    player.pause();
  }, [player]);

  const loadRecommended = useCallback(async () => {
    try {
      const data = await fetchApi('/api/music/recommended');
      setRecommended({ mixes: data.mixes || [], tracks: data.tracks || [] });
    } catch {
      setRecommended({ mixes: [], tracks: [] });
    }
  }, []);

  useEffect(() => { loadRecommended(); }, [loadRecommended]);

  const loadSpeakers = useCallback(async () => {
    try {
      const data = await fetchApi('/api/ha/states');
      setSpeakers(
        (data.states || [])
          .filter((e) => e.entity_id?.startsWith('media_player.'))
          .map((e) => ({
            id: e.entity_id,
            name: e.attributes?.friendly_name || e.entity_id,
            state: e.state,
          }))
      );
    } catch {
      setSpeakers([]);
    }
  }, []);

  const setOutputId = useCallback((id) => {
    setOutputIdState(id || 'local');
    outputRef.current = id || 'local';
    try { localStorage.setItem(OUTPUT_KEY, id || 'local'); } catch { /* ignore */ }
    if (id && id !== 'local') {
      try { playerRef.current.pause?.(); } catch { /* ignore */ }
      const track = queueRef.current[indexRef.current];
      if (track?.id) {
        castTrack(track, id)
          .then(() => setCastPlaying(true))
          .catch(() => addToast('error', t.music.castError));
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
    else if (repeatRef.current === 'all' && list.length) playIndex(0, list);
  }, [playIndex]);

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

  const seek = useCallback((seconds) => player.seek(seconds), [player]);

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
    position: player.position,
    duration: player.duration || currentTrack?.durationSeconds || 0,
    volume,
    shuffle,
    repeat,
    searchQuery,
    results,
    suggestions,
    searching,
    searchError,
    recommended,
    outputId,
    speakers,
    playerReady: player.ready,
    playerContainerRef: player.containerRef,
    search,
    debounceSearch,
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
