import { useRef, useCallback, useState } from 'react';
import t from '../../i18n/he.json';
import useMusic from '../../hooks/useMusic.js';
import OnScreenKeyboard from '../OnScreenKeyboard.jsx';

function formatTime(seconds) {
  if (!seconds || seconds < 0) return '0:00';
  const total = Math.floor(seconds);
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${s.toString().padStart(2, '0')}`;
}

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
      {volume > 0 && <path d="M15.54 8.46a5 5 0 0 1 0 7.07" />}
      {volume > 40 && <path d="M19.07 4.93a10 10 0 0 1 0 14.14" />}
      {volume === 0 && (
        <>
          <line x1="23" y1="9" x2="17" y2="15" />
          <line x1="17" y1="9" x2="23" y2="15" />
        </>
      )}
    </svg>
  );
}

function SearchIcon({ className = 'w-5 h-5' }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
      strokeLinecap="round" strokeLinejoin="round" className={className}>
      <circle cx="11" cy="11" r="7" />
      <line x1="21" y1="21" x2="16.65" y2="16.65" />
    </svg>
  );
}

function PlusIcon({ className = 'w-5 h-5' }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
      strokeLinecap="round" strokeLinejoin="round" className={className}>
      <line x1="12" y1="5" x2="12" y2="19" />
      <line x1="5" y1="12" x2="19" y2="12" />
    </svg>
  );
}

function CloseIcon({ className = 'w-4 h-4' }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
      strokeLinecap="round" strokeLinejoin="round" className={className}>
      <line x1="18" y1="6" x2="6" y2="18" />
      <line x1="6" y1="6" x2="18" y2="18" />
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

function ProgressBar({ progress, duration, onSeek }) {
  const barRef = useRef(null);

  const handleClick = useCallback(
    (e) => {
      if (!barRef.current || !duration) return;
      const rect = barRef.current.getBoundingClientRect();
      const ratio = 1 - (e.clientX - rect.left) / rect.width;
      onSeek(Math.max(0, Math.min(1, ratio)) * duration);
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
          className="h-full rounded-full transition-[width] duration-500 ease-linear"
          style={{ width: `${Math.min(100, pct)}%`, backgroundColor: 'var(--acc)' }}
        />
      </div>
      <div className="flex justify-between" dir="rtl">
        <span className="font-mono text-xs text-ts">{formatTime(progress)}</span>
        <span className="font-mono text-xs text-ts">{formatTime(duration)}</span>
      </div>
    </div>
  );
}

function VolumeSlider({ volume, onChange }) {
  return (
    <div className="w-full flex items-center gap-3" dir="rtl">
      <SpeakerIcon className="w-5 h-5 text-ts shrink-0" volume={volume} />
      <div className="flex-1 relative">
        <input
          type="range"
          min="0"
          max="100"
          value={volume}
          onChange={(e) => onChange(Number(e.target.value))}
          dir="rtl"
          className="music-volume-slider w-full"
          style={{ '--fill-pct': `${volume}%` }}
        />
      </div>
      <span className="font-mono text-xs text-ts w-8 text-left shrink-0">{volume}%</span>
    </div>
  );
}

const THUMB_FALLBACKS = ['hqdefault', 'mqdefault', 'default'];

function TrackThumb({ videoId }) {
  const [level, setLevel] = useState(0);
  const src = videoId
    ? `https://i.ytimg.com/vi/${videoId}/${THUMB_FALLBACKS[level] || 'default'}.jpg`
    : null;

  if (!src || level >= THUMB_FALLBACKS.length) {
    return (
      <div
        className="w-12 h-12 rounded-xl overflow-hidden shrink-0 flex items-center justify-center"
        style={{ background: 'linear-gradient(135deg, #6b62e0 0%, #2ab58a 100%)' }}
      >
        <MusicNoteIcon className="w-5 h-5 text-white/50" />
      </div>
    );
  }

  return (
    <div className="w-12 h-12 rounded-xl overflow-hidden shrink-0 bg-s2">
      <img
        src={src}
        alt=""
        className="w-full h-full object-cover"
        referrerPolicy="no-referrer"
        draggable={false}
        onError={() => setLevel((n) => n + 1)}
      />
    </div>
  );
}

function TrackRow({ track, isCurrent, onPlay, onQueue, showQueueAction }) {
  return (
    <div
      className={`flex items-center gap-3 w-full px-3 py-2.5 rounded-xl
                  transition-all duration-[var(--dur-fast)]
                  ${isCurrent ? 'border-r-[3px] border-r-acc bg-s2/60' : 'hover:bg-s2'}`}
    >
      <button
        onClick={onPlay}
        className="ripple flex items-center gap-3 flex-1 min-h-[56px] min-w-0 text-right active:scale-[0.98]"
      >
        <TrackThumb videoId={track.id} />
        <div className="flex-1 min-w-0">
          <p className={`text-sm font-medium truncate ${isCurrent ? 'text-acc' : 'text-tp'}`}>
            {track.title}
          </p>
          <p className="text-xs text-ts truncate">{track.artist}</p>
        </div>
        <span className="font-mono text-xs text-tm shrink-0">
          {track.duration || formatTime(track.durationSeconds)}
        </span>
      </button>
      {showQueueAction && (
        <button
          onClick={onQueue}
          title={t.music.addToQueue}
          className="ripple w-14 h-14 flex items-center justify-center rounded-xl text-ts hover:text-tp hover:bg-s2"
        >
          <PlusIcon />
          <span className="sr-only">{t.music.addToQueue}</span>
        </button>
      )}
    </div>
  );
}

function ControlButton({ children, onClick, size = 56, active = false, primary = false, label }) {
  const bgClass = primary
    ? 'bg-acc text-white shadow-raised hover:bg-acc/90'
    : active
      ? 'bg-s2 text-acc'
      : 'bg-s2 text-ts hover:text-tp';

  return (
    <button
      onClick={onClick}
      title={label}
      className={`ripple flex items-center justify-center rounded-full
                  active:scale-95 transition-all duration-[var(--dur-fast)] ${bgClass}`}
      style={{ width: size, height: size }}
    >
      {children}
    </button>
  );
}

function SpeakerIconBtn({ className = 'w-5 h-5' }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
      strokeLinecap="round" strokeLinejoin="round" className={className}>
      <rect x="4" y="3" width="16" height="18" rx="2" />
      <circle cx="12" cy="14" r="3" />
      <path d="M12 7h.01" />
    </svg>
  );
}

export default function MusicPage() {
  const [keyboardOpen, setKeyboardOpen] = useState(false);
  const [panel, setPanel] = useState('recommended');
  const [speakerOpen, setSpeakerOpen] = useState(false);
  const {
    currentTrack,
    queue,
    currentIndex,
    isPlaying,
    position,
    duration,
    volume,
    shuffle,
    repeat,
    searchQuery,
    results,
    suggestions,
    searching,
    recommended,
    outputId,
    speakers,
    playerContainerRef,
    search,
    debounceSearch,
    setSearchQuery,
    playTrack,
    addToQueue,
    playPause,
    next,
    previous,
    seek,
    setVolume,
    toggleShuffle,
    toggleRepeat,
    playIndex,
    loadSpeakers,
    setOutputId,
  } = useMusic();

  const handleSearchChange = useCallback((value) => {
    debounceSearch(value);
    setPanel('results');
  }, [debounceSearch]);

  const handleKeyboardInput = useCallback((char) => {
    handleSearchChange((searchQuery || '') + char);
  }, [handleSearchChange, searchQuery]);

  const handleKeyboardBackspace = useCallback(() => {
    handleSearchChange((searchQuery || '').slice(0, -1));
  }, [handleSearchChange, searchQuery]);

  const handleKeyboardEnter = useCallback(() => {
    setKeyboardOpen(false);
    setPanel('results');
    search(searchQuery);
  }, [search, searchQuery]);

  const handlePlayTrack = useCallback((item) => {
    playTrack(item);
  }, [playTrack]);

  const handleOpenMix = useCallback((mix) => {
    setSearchQuery(mix.query);
    setPanel('results');
    search(mix.query);
  }, [search, setSearchQuery]);

  const handleOpenSpeakers = useCallback(() => {
    setSpeakerOpen(true);
    loadSpeakers();
  }, [loadSpeakers]);

  const track = currentTrack || { title: t.music.noActiveMusic, artist: t.music.searchHint, imageUrl: null };

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <div className="px-6 pt-4 pb-2 shrink-0">
        <button
          type="button"
          onClick={() => setKeyboardOpen(true)}
          className="ripple w-full min-h-[56px] px-4 rounded-2xl bg-s2 border border-bd
                     flex items-center gap-3 text-right"
        >
          <SearchIcon className="w-5 h-5 text-ts shrink-0" />
          <span className={`flex-1 text-base ${searchQuery ? 'text-tp' : 'text-tm'}`}>
            {searchQuery || t.music.searchPlaceholder}
          </span>
          {searchQuery && (
            <span
              role="button"
              onClick={(e) => {
                e.stopPropagation();
                setSearchQuery('');
                debounceSearch('');
                setPanel('recommended');
              }}
              className="w-10 h-10 flex items-center justify-center rounded-full text-ts hover:bg-s1"
            >
              <CloseIcon />
            </span>
          )}
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              handleOpenSpeakers();
            }}
            title={t.music.chooseSpeaker}
            className={`w-12 h-12 flex items-center justify-center rounded-xl shrink-0
                        ${outputId !== 'local' ? 'text-acc bg-acc/10' : 'text-ts hover:bg-s1'}`}
          >
            <SpeakerIconBtn />
          </button>
        </button>
        {suggestions.length > 0 && keyboardOpen && (
          <div className="flex flex-wrap gap-2 mt-2">
            {suggestions.map((item) => (
              <button
                key={item}
                onClick={() => {
                  setSearchQuery(item);
                  setPanel('results');
                  search(item);
                  setKeyboardOpen(false);
                }}
                className="ripple min-h-[44px] px-4 rounded-full bg-s2 text-sm text-tp border border-bd"
              >
                {item}
              </button>
            ))}
          </div>
        )}
      </div>

      <div className="flex flex-1 overflow-hidden p-6 pt-3 gap-8">
        <div className="flex flex-col items-center gap-4 flex-[6] min-w-0">
          <div
            className="rounded-3xl overflow-hidden shadow-raised bg-s2 relative"
            style={{ width: 400, height: 400 }}
          >
            <div ref={playerContainerRef} className="absolute inset-0" />
            {!currentTrack && (
              <div
                className="absolute inset-0 flex items-center justify-center"
                style={{ background: 'linear-gradient(135deg, #6b62e0 0%, #2ab58a 100%)' }}
              >
                <MusicNoteIcon className="w-24 h-24 text-white/40" />
              </div>
            )}
          </div>

          <div className="w-[400px]">
            <ProgressBar progress={position} duration={duration} onSeek={seek} />
          </div>

          <div className="text-center w-[400px]">
            <h2 className="text-xl font-semibold text-tp truncate">{track.title}</h2>
            <p className="text-lg text-ts mt-0.5 truncate">{track.artist}</p>
            {outputId !== 'local' && (
              <p className="text-xs text-acc mt-1 truncate">
                {t.music.castingTo}{' '}
                {speakers.find((s) => s.id === outputId)?.name || outputId}
              </p>
            )}
          </div>

          <div className="flex items-center gap-4 mt-1">
            <ControlButton onClick={toggleShuffle} active={shuffle} label={t.music.shuffle}>
              <ShuffleIcon className="w-5 h-5" />
            </ControlButton>
            <ControlButton onClick={previous} label={t.music.prev}>
              <SkipPrevIcon className="w-6 h-6" />
            </ControlButton>
            <ControlButton
              onClick={playPause}
              primary
              size={72}
              label={isPlaying ? t.music.pause : t.music.play}
            >
              {isPlaying ? <PauseIcon className="w-8 h-8" /> : <PlayIcon className="w-8 h-8" />}
            </ControlButton>
            <ControlButton onClick={next} label={t.music.next}>
              <SkipNextIcon className="w-6 h-6" />
            </ControlButton>
            <ControlButton
              onClick={toggleRepeat}
              active={repeat !== 'off'}
              label={repeat === 'one' ? t.music.repeatOne : t.music.repeatAll}
            >
              {repeat === 'one' ? <RepeatOneIcon className="w-5 h-5" /> : <RepeatIcon className="w-5 h-5" />}
            </ControlButton>
          </div>

          <div className="w-[360px] mt-1">
            <VolumeSlider volume={volume} onChange={setVolume} />
          </div>
        </div>

        <div className="flex flex-col flex-[4] min-w-0 overflow-hidden">
          <div className="flex items-center gap-2 mb-3 shrink-0">
            {[
              ['recommended', t.music.recommended],
              ['results', t.music.results],
              ['queue', t.music.queue],
            ].map(([id, label]) => (
              <button
                key={id}
                onClick={() => setPanel(id)}
                className={`ripple min-h-[44px] px-4 rounded-full text-sm font-medium
                            ${panel === id ? 'bg-acc text-white' : 'bg-s2 text-ts'}`}
              >
                {label}
                {id === 'results' && searching ? ' …' : ''}
              </button>
            ))}
          </div>
          <div className="flex-1 overflow-y-auto flex flex-col gap-1 pe-1
                          scrollbar-thin scrollbar-thumb-bd scrollbar-track-transparent">
            {panel === 'results' && (
              results.length ? (
                results.map((item) => (
                  <TrackRow
                    key={item.id}
                    track={item}
                    isCurrent={currentTrack?.id === item.id}
                    onPlay={() => handlePlayTrack(item)}
                    onQueue={() => addToQueue(item)}
                    showQueueAction
                  />
                ))
              ) : (
                <div className="flex items-center justify-center flex-1 border-2 border-dashed border-bd rounded-2xl">
                  <span className="text-tm text-sm">
                    {searching ? t.common.loading : t.music.noResults}
                  </span>
                </div>
              )
            )}

            {panel === 'queue' && (
              queue.length ? (
                queue.map((item, i) => (
                  <TrackRow
                    key={`${item.id}-${i}`}
                    track={item}
                    isCurrent={i === currentIndex}
                    onPlay={() => playIndex(i)}
                  />
                ))
              ) : (
                <div className="flex items-center justify-center flex-1 border-2 border-dashed border-bd rounded-2xl">
                  <span className="text-tm text-sm">{t.music.searchHint}</span>
                </div>
              )
            )}

            {panel === 'recommended' && (
              <div className="flex flex-col gap-4">
                <div>
                  <h4 className="text-sm font-semibold text-ts mb-2 text-right">{t.music.mixes}</h4>
                  <div className="grid grid-cols-2 gap-2">
                    {(recommended.mixes || []).map((mix) => (
                      <button
                        key={mix.id}
                        onClick={() => handleOpenMix(mix)}
                        className="ripple min-h-[72px] rounded-2xl px-4 py-3 text-right text-white font-semibold"
                        style={{ background: mix.color || '#6b62e0' }}
                      >
                        {mix.title}
                      </button>
                    ))}
                  </div>
                </div>
                <div>
                  <h4 className="text-sm font-semibold text-ts mb-2 text-right">{t.music.trending}</h4>
                  {(recommended.tracks || []).map((item) => (
                    <TrackRow
                      key={item.id}
                      track={item}
                      isCurrent={currentTrack?.id === item.id}
                      onPlay={() => handlePlayTrack(item)}
                      onQueue={() => addToQueue(item)}
                      showQueueAction
                    />
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      {speakerOpen && (
        <div className="fixed inset-0 z-50 flex items-end justify-center">
          <div className="absolute inset-0 bg-tp/20" onClick={() => setSpeakerOpen(false)} />
          <div className="relative w-full max-w-[560px] bg-s1 border border-bd rounded-t-3xl p-5 mb-0">
            <h3 className="text-lg font-semibold text-tp mb-4 text-right">{t.music.chooseSpeaker}</h3>
            <button
              onClick={() => { setOutputId('local'); setSpeakerOpen(false); }}
              className={`ripple w-full min-h-[56px] px-4 mb-2 rounded-xl text-right
                          ${outputId === 'local' ? 'bg-acc/10 text-acc border border-acc' : 'bg-s2 text-tp'}`}
            >
              {t.music.thisScreen}
            </button>
            {speakers.length ? speakers.map((speaker) => (
              <button
                key={speaker.id}
                onClick={() => { setOutputId(speaker.id); setSpeakerOpen(false); }}
                className={`ripple w-full min-h-[56px] px-4 mb-2 rounded-xl text-right
                            ${outputId === speaker.id ? 'bg-acc/10 text-acc border border-acc' : 'bg-s2 text-tp'}`}
              >
                <span className="block font-medium">{speaker.name}</span>
                <span className="block text-xs text-ts">{speaker.state}</span>
              </button>
            )) : (
              <p className="text-sm text-tm text-right py-3">{t.music.noSpeakers}</p>
            )}
          </div>
        </div>
      )}

      <OnScreenKeyboard
        visible={keyboardOpen}
        onInput={handleKeyboardInput}
        onBackspace={handleKeyboardBackspace}
        onEnter={handleKeyboardEnter}
        onClose={() => setKeyboardOpen(false)}
      />

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
          box-shadow: var(--elev-card);
          cursor: pointer;
        }
        .music-volume-slider::-moz-range-thumb {
          width: 20px;
          height: 20px;
          border-radius: 50%;
          background: var(--acc);
          border: 3px solid white;
          cursor: pointer;
        }
      `}</style>
    </div>
  );
}
