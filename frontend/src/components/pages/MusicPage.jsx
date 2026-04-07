import { useRef, useCallback } from 'react';
import t from '../../i18n/he.json';
import useStore from '../../store/index.js';
import useMusic from '../../hooks/useMusic.js';
import { MusicSkeleton } from '../Skeleton.jsx';

// ─── Helpers ───────────────────────────────────────────────────────────────

function formatTime(ms) {
  if (!ms || ms < 0) return '0:00';
  const totalSeconds = Math.floor(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${seconds.toString().padStart(2, '0')}`;
}

// ─── Icons ─────────────────────────────────────────────────────────────────

function PlayIcon({ className = 'w-7 h-7' }) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" className={className}>
      <polygon points="6 3 20 12 6 21 6 3" />
    </svg>
  );
}

function PauseIcon({ className = 'w-7 h-7' }) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" className={className}>
      <rect x="5" y="3" width="5" height="18" rx="1" />
      <rect x="14" y="3" width="5" height="18" rx="1" />
    </svg>
  );
}

function SkipNextIcon({ className = 'w-6 h-6' }) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" className={className}>
      <polygon points="5 4 15 12 5 20 5 4" />
      <rect x="17" y="4" width="2.5" height="16" rx="1" />
    </svg>
  );
}

function SkipPrevIcon({ className = 'w-6 h-6' }) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" className={className}>
      <polygon points="19 4 9 12 19 20 19 4" />
      <rect x="4.5" y="4" width="2.5" height="16" rx="1" />
    </svg>
  );
}

function ShuffleIcon({ className = 'w-5 h-5' }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
      strokeLinecap="round" strokeLinejoin="round" className={className}>
      <polyline points="16 3 21 3 21 8" />
      <line x1="4" y1="20" x2="21" y2="3" />
      <polyline points="21 16 21 21 16 21" />
      <line x1="15" y1="15" x2="21" y2="21" />
      <line x1="4" y1="4" x2="9" y2="9" />
    </svg>
  );
}

function RepeatIcon({ className = 'w-5 h-5' }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
      strokeLinecap="round" strokeLinejoin="round" className={className}>
      <polyline points="17 1 21 5 17 9" />
      <path d="M3 11V9a4 4 0 0 1 4-4h14" />
      <polyline points="7 23 3 19 7 15" />
      <path d="M21 13v2a4 4 0 0 1-4 4H3" />
    </svg>
  );
}

function RepeatOneIcon({ className = 'w-5 h-5' }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
      strokeLinecap="round" strokeLinejoin="round" className={className}>
      <polyline points="17 1 21 5 17 9" />
      <path d="M3 11V9a4 4 0 0 1 4-4h14" />
      <polyline points="7 23 3 19 7 15" />
      <path d="M21 13v2a4 4 0 0 1-4 4H3" />
      <text x="12" y="14.5" textAnchor="middle" fill="currentColor" stroke="none"
        fontSize="8" fontWeight="bold" fontFamily="sans-serif">1</text>
    </svg>
  );
}

function SpeakerIcon({ className = 'w-5 h-5', volume = 50 }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
      strokeLinecap="round" strokeLinejoin="round" className={className}>
      <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" fill="currentColor" stroke="none" />
      {volume > 0 && (
        <path d="M15.54 8.46a5 5 0 0 1 0 7.07" />
      )}
      {volume > 40 && (
        <path d="M19.07 4.93a10 10 0 0 1 0 14.14" />
      )}
      {volume === 0 && (
        <>
          <line x1="23" y1="9" x2="17" y2="15" />
          <line x1="17" y1="9" x2="23" y2="15" />
        </>
      )}
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

function MusicNoteIcon({ className = 'w-20 h-20' }) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" className={className}>
      <path d="M12 3v10.55A4 4 0 1 0 14 17V7h4V3h-6z" />
    </svg>
  );
}

// ─── Album Art ─────────────────────────────────────────────────────────────

function AlbumArt({ src, size = 400 }) {
  if (src) {
    return (
      <div
        className="rounded-3xl overflow-hidden shadow-lg"
        style={{ width: size, height: size }}
      >
        <img
          src={src}
          alt=""
          className="w-full h-full object-cover"
          draggable={false}
        />
      </div>
    );
  }

  // Gradient fallback
  return (
    <div
      className="rounded-3xl overflow-hidden shadow-lg flex items-center justify-center"
      style={{
        width: size,
        height: size,
        background: 'linear-gradient(135deg, #6b62e0 0%, #2ab58a 100%)',
      }}
    >
      <MusicNoteIcon className="w-24 h-24 text-white/40" />
    </div>
  );
}

// ─── Progress Bar ──────────────────────────────────────────────────────────

function ProgressBar({ progress, duration, onSeek }) {
  const barRef = useRef(null);

  const handleClick = useCallback(
    (e) => {
      if (!barRef.current || !duration) return;
      const rect = barRef.current.getBoundingClientRect();
      // RTL: clicking right side = beginning, left side = end
      const ratio = 1 - (e.clientX - rect.left) / rect.width;
      const clampedRatio = Math.max(0, Math.min(1, ratio));
      onSeek(clampedRatio * duration);
    },
    [duration, onSeek]
  );

  const pct = duration > 0 ? (progress / duration) * 100 : 0;

  return (
    <div className="w-full flex flex-col gap-1.5">
      <div
        ref={barRef}
        className="w-full h-2 bg-s2 rounded-full cursor-pointer overflow-hidden"
        onClick={handleClick}
        dir="rtl"
      >
        <div
          className="h-full rounded-full transition-[width] duration-1000 ease-linear"
          style={{
            width: `${Math.min(100, pct)}%`,
            backgroundColor: 'var(--acc)',
          }}
        />
      </div>
      <div className="flex justify-between" dir="rtl">
        <span className="font-mono text-xs text-ts">{formatTime(progress)}</span>
        <span className="font-mono text-xs text-ts">{formatTime(duration)}</span>
      </div>
    </div>
  );
}

// ─── Volume Slider ─────────────────────────────────────────────────────────

function VolumeSlider({ volume, onChange }) {
  const sliderRef = useRef(null);

  return (
    <div className="w-full flex items-center gap-3" dir="rtl">
      <SpeakerIcon className="w-5 h-5 text-ts shrink-0" volume={volume} />
      <div className="flex-1 relative">
        <input
          ref={sliderRef}
          type="range"
          min="0"
          max="100"
          value={volume}
          onChange={(e) => onChange(Number(e.target.value))}
          dir="rtl"
          className="music-volume-slider w-full"
          style={{
            '--fill-pct': `${volume}%`,
          }}
        />
      </div>
      <span className="font-mono text-xs text-ts w-8 text-left shrink-0">{volume}%</span>
    </div>
  );
}

// ─── Queue Item ────────────────────────────────────────────────────────────

function QueueItem({ track, isCurrent, onTap }) {
  return (
    <button
      onClick={onTap}
      className={`ripple flex items-center gap-3 w-full px-3 py-2.5 rounded-xl
                  text-right transition-all duration-[var(--dur-fast)]
                  hover:bg-s2 active:scale-[0.98]
                  ${isCurrent ? 'border-r-[3px] border-r-acc bg-s2/60' : ''}`}
    >
      {/* Album art thumbnail */}
      <div className="w-12 h-12 rounded-lg overflow-hidden shrink-0 bg-s2">
        {track.albumArt ? (
          <img src={track.albumArt} alt="" className="w-full h-full object-cover" />
        ) : (
          <div
            className="w-full h-full flex items-center justify-center"
            style={{ background: 'linear-gradient(135deg, #6b62e0 0%, #2ab58a 100%)' }}
          >
            <MusicNoteIcon className="w-5 h-5 text-white/50" />
          </div>
        )}
      </div>

      {/* Track info */}
      <div className="flex-1 min-w-0">
        <p className={`text-sm font-medium truncate ${isCurrent ? 'text-acc' : 'text-tp'}`}>
          {track.name}
        </p>
        <p className="text-xs text-ts truncate">{track.artist}</p>
      </div>

      {/* Duration */}
      <span className="font-mono text-xs text-tm shrink-0">
        {formatTime(track.duration)}
      </span>
    </button>
  );
}

// ─── Control Button ────────────────────────────────────────────────────────

function ControlButton({ children, onClick, size = 56, active = false, primary = false, label }) {
  const bgClass = primary
    ? 'bg-acc text-white shadow-md hover:bg-acc/90'
    : active
      ? 'bg-s2 text-acc'
      : 'bg-s2 text-ts hover:text-tp';

  return (
    <button
      onClick={onClick}
      title={label}
      className={`ripple flex items-center justify-center rounded-full
                  active:scale-90 transition-all duration-[var(--dur-fast)] ${bgClass}`}
      style={{ width: size, height: size }}
    >
      {children}
    </button>
  );
}

// ─── MusicPage ─────────────────────────────────────────────────────────────

export default function MusicPage() {
  const activeTab = useStore((s) => s.activeTab);
  const spotifyStatus = useStore((s) => s.connections.spotify);
  const setActiveTab = useStore((s) => s.setActiveTab);
  const addToast = useStore((s) => s.addToast);

  const isMusicTab = activeTab === 3;
  const isConfigured = spotifyStatus === 'connected';

  const {
    isPlaying,
    currentTrack,
    queue,
    volume,
    shuffle,
    repeat,
    loading,
    notPlaying,
    play,
    pause,
    next,
    prev,
    setVolume,
    toggleShuffle,
    toggleRepeat,
    seekTo,
  } = useMusic(isMusicTab && isConfigured);

  const handleQueueTap = useCallback(() => {
    addToast('info', t.music.comingSoon);
  }, [addToast]);

  // ── Loading ───────────────────────────────────────────────────────────
  if (isConfigured && loading) {
    return <MusicSkeleton />;
  }

  // ── Not configured ────────────────────────────────────────────────────
  if (!isConfigured) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-5">
        <MusicIllustration />
        <p className="text-tm text-lg">{t.music.configureInSettings}</p>
        <button
          onClick={() => setActiveTab(6)}
          className="ripple flex items-center gap-2 px-6 min-h-[56px] rounded-xl bg-acc text-white
                     font-medium hover:bg-acc/90 active:scale-95 transition-all duration-[var(--dur-fast)]"
        >
          <SettingsIcon />
          <span>{t.music.goToSettings}</span>
        </button>
      </div>
    );
  }

  // ── Connected but nothing playing ─────────────────────────────────────
  if (notPlaying) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-4">
        <MusicNoteIcon className="w-24 h-24 text-tm/40" />
        <p className="text-tm text-lg">{t.music.noActiveMusic}</p>
      </div>
    );
  }

  // ── Active playback ───────────────────────────────────────────────────
  const track = currentTrack || { name: '---', artist: '---', album: '', albumArt: null, duration: 0, progress: 0 };

  return (
    <div className="flex h-full overflow-hidden p-6 gap-8">
      {/* ── Left Side: Now Playing (60%) ── */}
      <div className="flex flex-col items-center gap-4 flex-[6] min-w-0">
        {/* Album Art */}
        <AlbumArt src={track.albumArt} size={400} />

        {/* Progress Bar */}
        <div className="w-[400px]">
          <ProgressBar
            progress={track.progress}
            duration={track.duration}
            onSeek={seekTo}
          />
        </div>

        {/* Track Info */}
        <div className="text-center w-[400px]">
          <h2 className="text-xl font-semibold text-tp truncate" style={{ fontWeight: 600 }}>
            {track.name}
          </h2>
          <p className="text-lg text-ts mt-0.5 truncate" style={{ fontWeight: 400 }}>
            {track.artist}
          </p>
          {track.album && (
            <p className="text-sm text-tm mt-0.5 truncate" style={{ fontWeight: 300 }}>
              {track.album}
            </p>
          )}
        </div>

        {/* Controls Row */}
        <div className="flex items-center gap-4 mt-1">
          <ControlButton
            onClick={toggleShuffle}
            active={shuffle}
            label={t.music.shuffle}
          >
            <ShuffleIcon className="w-5 h-5" />
          </ControlButton>

          <ControlButton
            onClick={prev}
            label={t.music.prev}
          >
            <SkipPrevIcon className="w-6 h-6" />
          </ControlButton>

          <ControlButton
            onClick={isPlaying ? pause : play}
            primary
            size={72}
            label={isPlaying ? t.music.pause : t.music.play}
          >
            {isPlaying ? (
              <PauseIcon className="w-8 h-8" />
            ) : (
              <PlayIcon className="w-8 h-8" />
            )}
          </ControlButton>

          <ControlButton
            onClick={next}
            label={t.music.next}
          >
            <SkipNextIcon className="w-6 h-6" />
          </ControlButton>

          <ControlButton
            onClick={toggleRepeat}
            active={repeat !== 'off'}
            label={t.music.repeat}
          >
            {repeat === 'track' ? (
              <RepeatOneIcon className="w-5 h-5" />
            ) : (
              <RepeatIcon className="w-5 h-5" />
            )}
          </ControlButton>
        </div>

        {/* Volume Slider */}
        <div className="w-[360px] mt-1">
          <VolumeSlider volume={volume} onChange={setVolume} />
        </div>
      </div>

      {/* ── Right Side: Queue (40%) ── */}
      <div className="flex flex-col flex-[4] min-w-0 overflow-hidden">
        <h3 className="text-base font-semibold text-tp mb-3 shrink-0 text-right">
          {t.music.queue}
        </h3>

        <div className="flex-1 overflow-y-auto flex flex-col gap-1 pe-1
                        scrollbar-thin scrollbar-thumb-bd scrollbar-track-transparent">
          {queue.length > 0 ? (
            queue.map((item, i) => (
              <QueueItem
                key={item.id}
                track={item}
                isCurrent={i === 0 && currentTrack?.name === item.name}
                onTap={handleQueueTap}
              />
            ))
          ) : (
            <div className="flex items-center justify-center flex-1 border-2 border-dashed border-bd rounded-2xl">
              <span className="text-tm text-sm">{t.music.noActiveMusic}</span>
            </div>
          )}
        </div>
      </div>

      {/* ── Inline style for volume slider ── */}
      <style>{`
        .music-volume-slider {
          -webkit-appearance: none;
          appearance: none;
          height: 8px;
          border-radius: 9999px;
          background: linear-gradient(
            to left,
            var(--acc) 0%,
            var(--acc) var(--fill-pct, 50%),
            var(--s2) var(--fill-pct, 50%),
            var(--s2) 100%
          );
          outline: none;
          cursor: pointer;
        }
        .music-volume-slider::-webkit-slider-thumb {
          -webkit-appearance: none;
          appearance: none;
          width: 20px;
          height: 20px;
          border-radius: 50%;
          background: var(--acc);
          border: 3px solid white;
          box-shadow: 0 1px 4px rgba(0,0,0,0.15);
          cursor: pointer;
          transition: transform 150ms ease;
        }
        .music-volume-slider::-webkit-slider-thumb:hover {
          transform: scale(1.15);
        }
        .music-volume-slider::-webkit-slider-thumb:active {
          transform: scale(0.95);
        }
        .music-volume-slider::-moz-range-thumb {
          width: 20px;
          height: 20px;
          border-radius: 50%;
          background: var(--acc);
          border: 3px solid white;
          box-shadow: 0 1px 4px rgba(0,0,0,0.15);
          cursor: pointer;
        }
        .music-volume-slider::-moz-range-track {
          height: 8px;
          border-radius: 9999px;
          background: transparent;
        }
      `}</style>
    </div>
  );
}
