import { useCallback, useEffect, useRef, useState } from 'react';

let apiPromise = null;

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

export default function useYoutubePlayer({ onEnded, onError } = {}) {
  const containerRef = useRef(null);
  const playerRef = useRef(null);
  const onEndedRef = useRef(onEnded);
  const onErrorRef = useRef(onError);
  const [ready, setReady] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [position, setPosition] = useState(0);
  const [duration, setDuration] = useState(0);

  useEffect(() => { onEndedRef.current = onEnded; }, [onEnded]);
  useEffect(() => { onErrorRef.current = onError; }, [onError]);

  useEffect(() => {
    let cancelled = false;

    loadYouTubeApi()
      .then((YT) => {
        if (cancelled || !containerRef.current || playerRef.current) return;
        const host = document.createElement('div');
        host.style.width = '100%';
        host.style.height = '100%';
        containerRef.current.replaceChildren(host);
        playerRef.current = new YT.Player(host, {
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
            origin: window.location.origin,
          },
          events: {
            onReady: () => {
              if (!cancelled) setReady(true);
            },
            onStateChange: (event) => {
              const state = event.data;
              if (state === YT.PlayerState.ENDED) {
                setPlaying(false);
                onEndedRef.current?.();
              } else if (state === YT.PlayerState.PLAYING) {
                setPlaying(true);
                try {
                  setDuration(playerRef.current?.getDuration?.() || 0);
                } catch { /* ignore */ }
              } else if (state === YT.PlayerState.PAUSED) {
                setPlaying(false);
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
    try { playerRef.current?.setVolume?.(Math.round(value)); } catch { /* ignore */ }
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
