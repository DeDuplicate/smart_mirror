import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import useMusic from '../hooks/useMusic.js';

// Persistent iframe host. Never reparent or shrink the player — YouTube
// pauses when the iframe is moved or becomes 1–2px. Dock by CSS only,
// in #root's unscaled 1920×1080 space (not viewport coords).

const MusicContext = createContext(null);
const STAGE = 400;

function measureInRoot(el) {
  const root = document.getElementById('root');
  if (!el || !root) return null;
  const box = el.getBoundingClientRect();
  const rootBox = root.getBoundingClientRect();
  const sx = rootBox.width / 1920 || 1;
  const sy = rootBox.height / 1080 || 1;
  return {
    top: (box.top - rootBox.top) / sy,
    left: (box.left - rootBox.left) / sx,
    width: box.width / sx,
    height: box.height / sy,
    radius: 24,
  };
}

export function useMusicContext() {
  const ctx = useContext(MusicContext);
  if (!ctx) throw new Error('useMusicContext must be used within a MusicProvider');
  return ctx;
}

export function MusicProvider({ children }) {
  const music = useMusic();
  const [dock, setDock] = useState(null);
  const dockOwnerRef = useRef(null);
  const resumeAfterHide = useRef(false);
  const playingRef = useRef(false);
  playingRef.current = Boolean(music.isPlaying);

  const registerDock = useCallback((ownerId, elOrRect, extra = {}) => {
    dockOwnerRef.current = ownerId;
    const rect = elOrRect && typeof elOrRect.getBoundingClientRect === 'function'
      ? measureInRoot(elOrRect)
      : elOrRect;
    if (!rect) return;
    setDock({ ...rect, hidden: Boolean(extra.hidden) });
  }, []);

  const unregisterDock = useCallback((ownerId) => {
    if (dockOwnerRef.current !== ownerId) return;
    resumeAfterHide.current = playingRef.current;
    dockOwnerRef.current = null;
    setDock(null);
  }, []);

  useEffect(() => {
    if (dock || !resumeAfterHide.current) return undefined;
    resumeAfterHide.current = false;
    const timer = window.setTimeout(() => music.resume?.(), 80);
    return () => window.clearTimeout(timer);
  }, [dock, music]);

  const value = useMemo(() => ({
    ...music,
    registerDock,
    unregisterDock,
  }), [music, registerDock, unregisterDock]);

  const visible = dock && !dock.hidden;
  const style = visible
    ? {
        position: 'absolute',
        top: dock.top,
        left: dock.left,
        width: dock.width,
        height: dock.height,
        borderRadius: dock.radius || 24,
        overflow: 'hidden',
        zIndex: 5,
        pointerEvents: 'none',
      }
    : {
        position: 'absolute',
        top: 0,
        left: -STAGE - 80,
        width: STAGE,
        height: STAGE,
        overflow: 'hidden',
        opacity: 0.01,
        pointerEvents: 'none',
        zIndex: 0,
      };

  return (
    <MusicContext.Provider value={value}>
      {children}
      <div aria-hidden="true" style={style}>
        <div ref={music.playerContainerRef} className="w-full h-full" />
      </div>
    </MusicContext.Provider>
  );
}

export default MusicContext;
