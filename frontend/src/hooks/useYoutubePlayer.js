import { useCallback, useEffect, useRef, useState } from 'react';
import { IS_PHONE } from '../phone.js';

let apiPromise = null;

// YouTube refuses to embed label-owned music (error 150, also 101 and 153) in a page that was
// opened by IP address, like http://192.168.1.186:3000 from a phone. The same video plays from
// localhost (the mirror) and from a hostname such as smartmirror.local. On the phone those
// tracks fall back to the mirror's own audio stream, played in a plain <audio> element.
const EMBED_BLOCKED = new Set([101, 150, 153]);
// 1 sample of silence. Playing it inside the tap that starts a song "unlocks" the element, so
// iOS lets it start the real stream later, after the Pi has finished converting the track.
const SILENCE = 'data:audio/wav;base64,UklGRiUAAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YQEAAACA';

function disableCaptions(player) {
  if (!player) return;
  try { player.unloadModule?.('captions'); } catch { /* ignore */ }
  try { player.unloadModule?.('cc'); } catch { /* ignore */ }
  try { player.setOption?.('captions', 'track', {}); } catch { /* ignore */ }
}

function fitPlayer(player) {
  if (!player) return;
  try {
    const iframe = player.getIframe?.();
    if (!iframe) return;
    iframe.style.cssText = 'width:100%;height:100%;border:0;display:block;';
    iframe.setAttribute('width', '100%');
    iframe.setAttribute('height', '100%');
    iframe.setAttribute('referrerpolicy', 'strict-origin-when-cross-origin');
  } catch { /* ignore */ }
}

function applyVolume(player, volume) {
  if (!player) return;
  try { player.setVolume?.(Math.round(volume)); } catch { /* ignore */ }
}

function loadYouTubeApi() {
  if (window.YT?.Player) return Promise.resolve(window.YT);
  if (apiPromise) return apiPromise;

  apiPromise = new Promise((resolve, reject) => {
    const existing = document.querySelector('script[data-yt-iframe-api]');
    if (!existing) {
      const tag = document.createElement('script');
      tag.src = 'https://www.youtube.com/iframe_api';
      tag.async = true;
      tag.dataset.ytIframeApi = 'true';
      tag.onerror = () => reject(new Error('YouTube IFrame API failed to load'));
      document.head.appendChild(tag);
    }

    const prev = window.onYouTubeIframeAPIReady;
    window.onYouTubeIframeAPIReady = () => {
      if (typeof prev === 'function') prev();
      resolve(window.YT);
    };

    if (window.YT?.Player) resolve(window.YT);
  });

  return apiPromise;
}

export default function useYoutubePlayer({ onEnded, onError, onEmbedBlocked, initialVolume = 70 } = {}) {
  const playerRef = useRef(null);
  const containerNodeRef = useRef(null);
  const volumeRef = useRef(Math.round(initialVolume));
  const onEndedRef = useRef(onEnded);
  const onErrorRef = useRef(onError);
  const onEmbedBlockedRef = useRef(onEmbedBlocked);
  const audioRef = useRef(null);
  const audioModeRef = useRef(false);
  const videoIdRef = useRef(null);
  const [ready, setReady] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [position, setPosition] = useState(0);
  const [duration, setDuration] = useState(0);
  // True from the moment YouTube refuses a track until the next one loads, so the page can hide
  // the iframe (it shows "This video is unavailable") while the mirror's audio plays instead.
  const [audioFallback, setAudioFallback] = useState(false);

  useEffect(() => { onEndedRef.current = onEnded; }, [onEnded]);
  useEffect(() => { onErrorRef.current = onError; }, [onError]);
  useEffect(() => { onEmbedBlockedRef.current = onEmbedBlocked; }, [onEmbedBlocked]);

  const getAudio = useCallback(() => {
    if (audioRef.current) return audioRef.current;
    const a = new Audio();
    a.preload = 'auto';
    const live = (fn) => () => { if (audioModeRef.current) fn(a); };
    a.addEventListener('play', live(() => setPlaying(true)));
    a.addEventListener('pause', live(() => setPlaying(false)));
    a.addEventListener('durationchange', live(() => setDuration(a.duration || 0)));
    a.addEventListener('ended', live(() => { setPlaying(false); onEndedRef.current?.(); }));
    a.addEventListener('error', live(() => { setPlaying(false); onErrorRef.current?.('audio'); }));
    audioRef.current = a;
    return a;
  }, []);

  const playAudio = useCallback(async (id) => {
    setAudioFallback(true);
    let url;
    try {
      // Waits for the Pi to convert the track; gives up quietly once the user has picked another one.
      url = await onEmbedBlockedRef.current(id, () => videoIdRef.current === id);
    } catch (err) {
      if (videoIdRef.current !== id) return; // abandoned: nothing to report, and the next track owns the state now
      setAudioFallback(false);
      throw err;
    }
    if (videoIdRef.current !== id) return; // the user picked something else meanwhile
    const a = getAudio();
    audioModeRef.current = true;
    setPosition(0);
    setDuration(0);
    a.src = url;
    a.volume = Math.min(1, Math.max(0, volumeRef.current / 100));
    try {
      await a.play();
    } catch (err) {
      audioModeRef.current = false;
      setAudioFallback(false);
      throw err;
    }
  }, [getAudio]);

  // Persistent host lives in MusicProvider. Never reparent the iframe —
  // moving it (or shrinking it to 2px) makes YouTube pause.
  const containerRef = useCallback((node) => {
    containerNodeRef.current = node;
  }, []);

  useEffect(() => {
    let cancelled = false;
    let volumeTimer = 0;

    const syncVolume = (player) => {
      applyVolume(player, volumeRef.current);
      window.clearTimeout(volumeTimer);
      volumeTimer = window.setTimeout(() => applyVolume(player, volumeRef.current), 150);
    };

    loadYouTubeApi()
      .then((YT) => {
        if (cancelled || playerRef.current || !containerNodeRef.current) return;
        const mount = document.createElement('div');
        mount.style.cssText = 'width:100%;height:100%;';
        containerNodeRef.current.replaceChildren(mount);
        playerRef.current = new YT.Player(mount, {
          width: '100%',
          height: '100%',
          playerVars: {
            autoplay: 1,
            controls: 0,
            disablekb: 1,
            fs: 0,
            modestbranding: 1,
            rel: 0,
            playsinline: 1,
            cc_load_policy: 0,
            iv_load_policy: 3,
            origin: window.location.origin,
            widget_referrer: window.location.href,
          },
          events: {
            onReady: (event) => {
              disableCaptions(event.target);
              fitPlayer(event.target);
              syncVolume(event.target);
              if (!cancelled) setReady(true);
            },
            onStateChange: (event) => {
              const state = event.data;
              if (state === YT.PlayerState.ENDED) {
                setPlaying(false);
                onEndedRef.current?.();
              } else if (state === YT.PlayerState.PLAYING) {
                disableCaptions(event.target);
                fitPlayer(event.target);
                syncVolume(event.target);
                setPlaying(true);
                try {
                  setDuration(playerRef.current?.getDuration?.() || 0);
                } catch { /* ignore */ }
              } else if (state === YT.PlayerState.PAUSED) {
                setPlaying(false);
              } else if (state === YT.PlayerState.CUED) {
                syncVolume(event.target);
              }
            },
            onError: (event) => {
              setPlaying(false);
              const id = videoIdRef.current;
              if (IS_PHONE && EMBED_BLOCKED.has(event.data) && id && onEmbedBlockedRef.current) {
                playAudio(id).catch(() => onErrorRef.current?.(event.data));
                return;
              }
              onErrorRef.current?.(event.data);
            },
          },
        });
      })
      .catch((err) => {
        console.error('[music] YouTube API:', err);
        onErrorRef.current?.(err);
      });

    return () => {
      cancelled = true;
      window.clearTimeout(volumeTimer);
      try { playerRef.current?.destroy?.(); } catch { /* ignore */ }
      playerRef.current = null;
      audioModeRef.current = false;
      audioRef.current?.pause();
      setReady(false);
      setPlaying(false);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const timer = setInterval(() => {
      if (audioModeRef.current && audioRef.current) {
        setPosition(audioRef.current.currentTime || 0);
        return;
      }
      const player = playerRef.current;
      if (!player?.getCurrentTime) return;
      try {
        setPosition(player.getCurrentTime() || 0);
        const d = player.getDuration?.() || 0;
        if (d) setDuration(d);
      } catch { /* player not ready */ }
    }, 500);
    return () => clearInterval(timer);
  }, []);

  const load = useCallback((videoId, autoplay = true) => {
    const player = playerRef.current;
    if (!player || !videoId) return;
    videoIdRef.current = videoId;
    setAudioFallback(false);
    if (audioModeRef.current) {
      audioModeRef.current = false;
      audioRef.current?.pause();
    }
    if (IS_PHONE && autoplay && !audioRef.current) {
      const a = getAudio();
      a.src = SILENCE;
      a.play().catch(() => {});
    }
    try {
      if (autoplay && player.loadVideoById) player.loadVideoById(videoId);
      else if (player.cueVideoById) player.cueVideoById(videoId);
      fitPlayer(player);
      applyVolume(player, volumeRef.current);
      window.setTimeout(() => applyVolume(player, volumeRef.current), 150);
    } catch (err) {
      console.error('[music] load failed:', err);
    }
  }, [getAudio]);

  const play = useCallback(() => {
    if (audioModeRef.current) { audioRef.current?.play().catch(() => {}); return; }
    try { playerRef.current?.playVideo?.(); } catch { /* ignore */ }
  }, []);

  const pause = useCallback(() => {
    if (audioModeRef.current) { audioRef.current?.pause(); return; }
    try { playerRef.current?.pauseVideo?.(); } catch { /* ignore */ }
  }, []);

  const seek = useCallback((seconds) => {
    if (audioModeRef.current && audioRef.current) {
      audioRef.current.currentTime = seconds;
      setPosition(seconds);
      return;
    }
    try {
      playerRef.current?.seekTo?.(seconds, true);
      setPosition(seconds);
    } catch { /* ignore */ }
  }, []);

  const setVolume = useCallback((value) => {
    volumeRef.current = Math.round(value);
    applyVolume(playerRef.current, volumeRef.current);
    if (audioRef.current) audioRef.current.volume = Math.min(1, Math.max(0, volumeRef.current / 100));
  }, []);

  return {
    containerRef,
    ready,
    playing,
    position,
    duration,
    audioFallback,
    load,
    play,
    pause,
    seek,
    setVolume,
  };
}
