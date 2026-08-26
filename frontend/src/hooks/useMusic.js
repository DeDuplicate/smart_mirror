import { useState, useEffect, useCallback, useRef } from 'react';

// ─── Dev Mode ─────────────────────────────────────────────────────────────

const isDev =
  typeof import.meta !== 'undefined' &&
  import.meta.env &&
  import.meta.env.DEV;

// ─── Mock Data ────────────────────────────────────────────────────────────

const MOCK_TRACK = {
  name: 'שיר ישראלי',
  artist: 'אריק איינשטיין',
  album: 'שירים שבלב',
  albumArt: null,
  duration: 225000, // 3:45
  progress: 67000,  // 1:07
};

const MOCK_QUEUE = [
  { id: 'q1', uri: 'spotify:track:mock1', name: 'שיר ישראלי', artist: 'אריק איינשטיין', album: 'שירים שבלב', albumArt: null, duration: 225000 },
  { id: 'q2', uri: 'spotify:track:mock2', name: 'עוד', artist: 'עידן רייכל', album: 'ממעמקים', albumArt: null, duration: 248000 },
  { id: 'q3', uri: 'spotify:track:mock3', name: 'יש לי סיבה', artist: 'שלמה ארצי', album: 'מופע חי', albumArt: null, duration: 312000 },
  { id: 'q4', uri: 'spotify:track:mock4', name: 'תמיד עולה', artist: 'עברי לידר', album: 'לצאת מפה', albumArt: null, duration: 195000 },
  { id: 'q5', uri: 'spotify:track:mock5', name: 'הכל פתוח', artist: 'אסף אמדורסקי', album: 'פסקול', albumArt: null, duration: 274000 },
];

const MOCK_STATE = {
  isPlaying: true,
  currentTrack: MOCK_TRACK,
  queue: MOCK_QUEUE,
  volume: 65,
  shuffle: false,
  repeat: 'off', // 'off' | 'context' | 'track'
};

// ─── API Helper ───────────────────────────────────────────────────────────

async function musicApi(path, options = {}) {
  const res = await fetch(`/api/music${path}`, {
    headers: { 'Content-Type': 'application/json' },
    ...options,
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Music API ${res.status}: ${text}`);
  }
  if (res.status === 204) return null;
  return res.json();
}

// ─── Parse Spotify state response ─────────────────────────────────────────

function parseSpotifyState(data) {
  if (!data || !data.item) {
    return { isPlaying: false, currentTrack: null, volume: 50, shuffle: false, repeat: 'off' };
  }

  const item = data.item;
  return {
    isPlaying: data.is_playing ?? false,
    currentTrack: {
      name: item.name || '',
      artist: (item.artists || []).map((a) => a.name).join(', '),
      album: item.album?.name || '',
      albumArt: item.album?.images?.[0]?.url || null,
      duration: item.duration_ms || 0,
      progress: data.progress_ms || 0,
    },
    volume: data.device?.volume_percent ?? 50,
    shuffle: data.shuffle_state ?? false,
    repeat: data.repeat_state ?? 'off',
  };
}

function parseSpotifyQueue(data) {
  if (!data || !data.queue) return [];
  return data.queue.slice(0, 20).map((item, i) => ({
    id: item.id || `q-${i}`,
    uri: item.uri || null,
    name: item.name || '',
    artist: (item.artists || []).map((a) => a.name).join(', '),
    album: item.album?.name || '',
    albumArt: item.album?.images?.[item.album?.images?.length - 1]?.url || null,
    duration: item.duration_ms || 0,
  }));
}

// ─── Hook ─────────────────────────────────────────────────────────────────

const POLL_INTERVAL = 3000;

export default function useMusic(active = true) {
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTrack, setCurrentTrack] = useState(null);
  const [queue, setQueue] = useState([]);
  const [volume, setVolumeState] = useState(50);
  const [shuffle, setShuffle] = useState(false);
  const [repeat, setRepeat] = useState('off');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [connected, setConnected] = useState(false);

  const mountedRef = useRef(true);
  const intervalRef = useRef(null);
  const volumeTimerRef = useRef(null);
  const progressTimerRef = useRef(null);

  // ── Progress tick (updates progress locally between polls) ────────────
  useEffect(() => {
    if (isPlaying && currentTrack) {
      progressTimerRef.current = setInterval(() => {
        setCurrentTrack((prev) => {
          if (!prev) return prev;
          const next = prev.progress + 1000;
          if (next > prev.duration) return prev;
          return { ...prev, progress: next };
        });
      }, 1000);
    }
    return () => {
      if (progressTimerRef.current) clearInterval(progressTimerRef.current);
    };
  }, [isPlaying, currentTrack?.name]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Apply full state ──────────────────────────────────────────────────
  const applyState = useCallback((state) => {
    setIsPlaying(state.isPlaying);
    setCurrentTrack(state.currentTrack);
    setVolumeState(state.volume);
    setShuffle(state.shuffle);
    setRepeat(state.repeat);
    setConnected(true);
  }, []);

  // ── Fetch state from API ──────────────────────────────────────────────
  const fetchState = useCallback(async () => {
    try {
      if (isDev) {
        if (loading) await new Promise((r) => setTimeout(r, 600));
        applyState(MOCK_STATE);
        setQueue(MOCK_QUEUE);
        setError(null);
      } else {
        const [stateData, queueData] = await Promise.all([
          musicApi('/state'),
          musicApi('/queue'),
        ]);
        if (!mountedRef.current) return;
        const parsed = parseSpotifyState(stateData);
        applyState(parsed);
        setQueue(parseSpotifyQueue(queueData));
        setError(null);
      }
    } catch (err) {
      if (!mountedRef.current) return;
      // In dev, fall back to mock on error
      if (isDev) {
        applyState(MOCK_STATE);
        setQueue(MOCK_QUEUE);
        setError(null);
      } else {
        setError(err.message);
      }
    } finally {
      if (mountedRef.current) setLoading(false);
    }
  }, [applyState]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Polling ───────────────────────────────────────────────────────────
  useEffect(() => {
    mountedRef.current = true;

    if (!active) {
      setLoading(true);
      return () => { mountedRef.current = false; };
    }

    fetchState();

    intervalRef.current = setInterval(fetchState, POLL_INTERVAL);

    return () => {
      mountedRef.current = false;
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [active, fetchState]);

  // ── Socket.io listener ────────────────────────────────────────────────
  useEffect(() => {
    // Import socket.io-client dynamically to avoid issues in tests
    let sock = null;
    try {
      // Attempt to find existing socket on window (set by App.jsx singleton)
      // or listen via global event
      const handler = (e) => {
        if (e.detail && mountedRef.current) {
          const parsed = parseSpotifyState(e.detail);
          applyState(parsed);
        }
      };
      window.addEventListener('music:state', handler);
      return () => window.removeEventListener('music:state', handler);
    } catch {
      // Socket not available, rely on polling
    }
  }, [applyState]);

  // ── Controls ──────────────────────────────────────────────────────────

  const play = useCallback(async () => {
    setIsPlaying(true);
    if (!isDev) {
      try { await musicApi('/play', { method: 'POST' }); } catch { /* ignore */ }
    }
  }, []);

  const pause = useCallback(async () => {
    setIsPlaying(false);
    if (!isDev) {
      try { await musicApi('/pause', { method: 'POST' }); } catch { /* ignore */ }
    }
  }, []);

  const next = useCallback(async () => {
    if (!isDev) {
      try { await musicApi('/next', { method: 'POST' }); } catch { /* ignore */ }
    }
    // Refetch state after skip
    setTimeout(fetchState, 500);
  }, [fetchState]);

  const prev = useCallback(async () => {
    if (!isDev) {
      try { await musicApi('/prev', { method: 'POST' }); } catch { /* ignore */ }
    }
    setTimeout(fetchState, 500);
  }, [fetchState]);

  // Play one specific track immediately (tap-to-play from the queue).
  // Spotify's Web API has no "jump to this queue item" endpoint, so the
  // backend replaces current playback with just this track's URI — see
  // backend/routes/music.js POST /play-track for details.
  const playTrack = useCallback(
    async (track) => {
      if (!track) return;

      // Optimistic update: show the tapped track as "now playing" right away
      setCurrentTrack({
        name: track.name,
        artist: track.artist,
        album: track.album,
        albumArt: track.albumArt,
        duration: track.duration,
        progress: 0,
      });
      setIsPlaying(true);

      // Dev mode / mock queue has no real Spotify track to start — the
      // optimistic UI update above is all we can (and need to) do locally.
      if (isDev || !track.uri) return;

      try {
        await musicApi('/play-track', {
          method: 'POST',
          body: JSON.stringify({ uri: track.uri }),
        });
      } catch {
        /* ignore — reconciled by the refetch below / next poll */
      }
      // Spotify needs a moment to propagate the change; reconcile with
      // the real state shortly after instead of trusting the optimistic guess.
      setTimeout(fetchState, 700);
    },
    [fetchState]
  );

  const setVolume = useCallback((v) => {
    const clamped = Math.max(0, Math.min(100, Math.round(v)));
    setVolumeState(clamped);

    // Debounce the API call
    if (volumeTimerRef.current) clearTimeout(volumeTimerRef.current);
    volumeTimerRef.current = setTimeout(async () => {
      if (!isDev) {
        try {
          await musicApi('/volume', {
            method: 'POST',
            body: JSON.stringify({ volume_percent: clamped }),
          });
        } catch { /* ignore */ }
      }
    }, 300);
  }, []);

  const toggleShuffle = useCallback(async () => {
    const newState = !shuffle;
    setShuffle(newState);
    if (!isDev) {
      try {
        await musicApi('/shuffle', {
          method: 'POST',
          body: JSON.stringify({ state: newState }),
        });
      } catch { /* ignore */ }
    }
  }, [shuffle]);

  const toggleRepeat = useCallback(async () => {
    // Cycle: off -> context -> track -> off
    const next = repeat === 'off' ? 'context' : repeat === 'context' ? 'track' : 'off';
    setRepeat(next);
    if (!isDev) {
      try {
        await musicApi('/repeat', {
          method: 'POST',
          body: JSON.stringify({ state: next }),
        });
      } catch { /* ignore */ }
    }
  }, [repeat]);

  const seekTo = useCallback(async (positionMs) => {
    // Update local progress immediately
    setCurrentTrack((prev) => prev ? { ...prev, progress: positionMs } : prev);
    if (!isDev) {
      try {
        await musicApi('/seek', {
          method: 'POST',
          body: JSON.stringify({ position_ms: Math.round(positionMs) }),
        });
      } catch { /* ignore */ }
    }
  }, []);

  // ── Cleanup volume debounce timer ─────────────────────────────────────
  useEffect(() => {
    return () => {
      if (volumeTimerRef.current) clearTimeout(volumeTimerRef.current);
    };
  }, []);

  return {
    isPlaying,
    currentTrack,
    queue,
    volume,
    shuffle,
    repeat,
    loading,
    error,
    connected,
    notPlaying: connected && !currentTrack,
    play,
    pause,
    next,
    prev,
    playTrack,
    setVolume,
    toggleShuffle,
    toggleRepeat,
    seekTo,
    refetch: fetchState,
  };
}
