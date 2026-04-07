import { useState, useEffect } from 'react';
import t from '../../i18n/he.json';
import useStore from '../../store/index.js';
import { MusicSkeleton } from '../Skeleton.jsx';

// ─── Icons ──────────────────────────────────────────────────────────────────

function PlayIcon({ className = 'w-7 h-7' }) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" className={className}>
      <polygon points="5 3 19 12 5 21 5 3" />
    </svg>
  );
}

function SkipIcon({ className = 'w-5 h-5', flip = false }) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" className={className}
      style={flip ? { transform: 'scaleX(-1)' } : undefined}>
      <polygon points="5 4 15 12 5 20 5 4" />
      <line x1="19" y1="5" x2="19" y2="19" stroke="currentColor" strokeWidth="2" />
    </svg>
  );
}

function MusicIllustration() {
  return (
    <svg viewBox="0 0 120 120" fill="none" className="w-28 h-28 text-tm">
      <circle cx="60" cy="60" r="45" stroke="currentColor" strokeWidth="2" />
      <circle cx="60" cy="60" r="20" stroke="currentColor" strokeWidth="2" />
      <circle cx="60" cy="60" r="5" fill="currentColor" opacity="0.3" />
      <path d="M60 15V5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
      <path d="M60 115V105" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
      <path d="M15 60H5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
      <path d="M115 60H105" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}

function SettingsIcon({ className = 'w-5 h-5' }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
      strokeLinecap="round" strokeLinejoin="round" className={className}>
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65
        1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0
        9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0
        4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65
        0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65
        0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0
        1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0
        1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
    </svg>
  );
}

// ─── MusicPage ──────────────────────────────────────────────────────────────

export default function MusicPage() {
  const [loading, setLoading] = useState(true);
  const spotifyStatus = useStore((s) => s.connections.spotify);
  const setActiveTab = useStore((s) => s.setActiveTab);
  const [isPlaying] = useState(false);

  useEffect(() => {
    const timer = setTimeout(() => setLoading(false), 1000);
    return () => clearTimeout(timer);
  }, []);

  if (loading) return <MusicSkeleton />;

  const isConfigured = spotifyStatus === 'connected';

  // Not configured state
  if (!isConfigured) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-5">
        <MusicIllustration />
        <p className="text-tm text-lg">{t.music.configureInSettings}</p>
        <button
          onClick={() => setActiveTab(5)}
          className="ripple flex items-center gap-2 px-6 min-h-[56px] rounded-xl bg-acc text-white
                     font-medium hover:bg-acc/90 active:scale-95 transition-all duration-[var(--dur-fast)]"
        >
          <SettingsIcon />
          <span>{t.music.connect}</span>
        </button>
      </div>
    );
  }

  // Connected but nothing playing
  if (!isPlaying) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-4">
        <MusicIllustration />
        <p className="text-tm text-lg">{t.empty.noMusic}</p>
      </div>
    );
  }

  // Active playback layout (placeholder structure)
  return (
    <div className="flex h-full overflow-hidden p-6 gap-8">
      {/* Left: Now playing */}
      <div className="flex flex-col items-center gap-5 w-[400px] shrink-0">
        {/* Album art placeholder */}
        <div className="w-[300px] h-[300px] rounded-3xl bg-s2 border border-bd flex items-center justify-center">
          <span className="text-6xl text-tm">🎵</span>
        </div>

        {/* Track info */}
        <div className="text-center">
          <h2 className="text-xl font-semibold text-tp">{t.music.nowPlaying}</h2>
          <p className="text-sm text-ts mt-1">---</p>
        </div>

        {/* Playback controls */}
        <div className="flex items-center gap-5">
          <button
            className="ripple flex items-center justify-center w-12 h-12 rounded-full
                       text-ts hover:bg-s2 hover:text-tp active:scale-90
                       transition-all duration-[var(--dur-fast)]"
          >
            <SkipIcon flip />
          </button>
          <button
            className="ripple flex items-center justify-center w-14 h-14 rounded-full
                       bg-acc text-white shadow-md hover:bg-acc/90 active:scale-90
                       transition-all duration-[var(--dur-fast)]"
          >
            <PlayIcon />
          </button>
          <button
            className="ripple flex items-center justify-center w-12 h-12 rounded-full
                       text-ts hover:bg-s2 hover:text-tp active:scale-90
                       transition-all duration-[var(--dur-fast)]"
          >
            <SkipIcon />
          </button>
        </div>

        {/* Volume slider */}
        <div className="w-[280px] flex items-center gap-3">
          <span className="text-xs text-ts">{t.music.volume}</span>
          <div className="flex-1 h-2 bg-s2 rounded-full overflow-hidden">
            <div className="h-full w-2/3 bg-acc rounded-full" />
          </div>
        </div>
      </div>

      {/* Right: Queue */}
      <div className="flex-1 flex flex-col overflow-hidden">
        <h3 className="text-base font-semibold text-tp mb-4 shrink-0">{t.music.queue}</h3>
        <div className="flex-1 overflow-y-auto flex flex-col gap-2">
          {/* Empty queue placeholder */}
          <div className="flex items-center justify-center flex-1 border-2 border-dashed border-bd rounded-2xl">
            <span className="text-tm text-sm">{t.empty.noMusic}</span>
          </div>
        </div>
      </div>
    </div>
  );
}
