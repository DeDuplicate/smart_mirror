import { useCallback, useEffect, useRef, useState } from 'react';

let apiPromise = null;

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

export default function useYoutubePlayer({ onEnded, onError, initialVolume = 70 } = {}) {
  const playerRef = useRef(null);
  const containerNodeRef = useRef(null);
  const volumeRef = useRef(Math.round(initialVolume));
  const onEndedRef = useRef(onEnded);
  const onErrorRef = useRef(onError);
  const [ready, setReady] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [position, setPosition] = useState(0);
  const [duration, setDuration] = useState(0);

  useEffect(() => { onEndedRef.current = onEnded; }, [onEnded]);
  useEffect(() => { onErrorRef.current = onError; }, [onError]);

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
      setReady(false);
      setPlaying(false);
    };
  }, []);

  useEffect(() => {
    const timer = setInterval(() => {
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
    try {
      if (autoplay && player.loadVideoById) player.loadVideoById(videoId);
      else if (player.cueVideoById) player.cueVideoById(videoId);
      fitPlayer(player);
      applyVolume(player, volumeRef.current);
      window.setTimeout(() => applyVolume(player, volumeRef.current), 150);
    } catch (err) {
      console.error('[music] load failed:', err);
    }
  }, []);

  const play = useCallback(() => {
    try { playerRef.current?.playVideo?.(); } catch { /* ignore */ }
  }, []);

  const pause = useCallback(() => {
    try { playerRef.current?.pauseVideo?.(); } catch { /* ignore */ }
  }, []);

  const seek = useCallback((seconds) => {
    try {
      playerRef.current?.seekTo?.(seconds, true);
      setPosition(seconds);
    } catch { /* ignore */ }
  }, []);

  const setVolume = useCallback((value) => {
    volumeRef.current = Math.round(value);
    applyVolume(playerRef.current, volumeRef.current);
  }, []);

  return {
    containerRef,
    ready,
    playing,
    position,
    duration,
    load,
    play,
    pause,
    seek,
    setVolume,
  };
}
