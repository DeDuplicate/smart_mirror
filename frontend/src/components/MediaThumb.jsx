import { useState, useRef, useEffect } from 'react';

// Ordered largest-first: a 404 on hqdefault still leaves mqdefault/default,
// which YouTube generates for every video.
const THUMB_FALLBACKS = ['hqdefault', 'mqdefault', 'default'];
const RETRY_MS = 1500;

function MusicNoteIcon({ className = 'w-5 h-5' }) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" className={className}>
      <path d="M12 3v10.55A4 4 0 1 0 14 17V7h4V3h-6z" />
    </svg>
  );
}

/**
 * Artwork that survives a failed load. A browser never re-requests a broken
 * <img> on its own, so one miss leaves Chrome's broken-image glyph on screen
 * for as long as the element lives — which is how the alarm overlay ends up
 * showing a torn-paper icon instead of the playlist cover: it paints the
 * instant the panel wakes, often a beat before the WiFi is back.
 *
 * So: retry the given URL once, then step down the ytimg sizes when a video
 * id is known, and only then fall back to the gradient note. Playlist covers
 * (yt3.ggpht.com) have no size ladder — the retry is all they get.
 *
 * `className` carries the box size and rounding, e.g. "w-32 h-32 rounded-2xl".
 */
export default function MediaThumb({
  videoId,
  imageUrl,
  className = 'w-12 h-12 rounded-xl',
  iconClassName = 'w-5 h-5',
}) {
  // -1 = the URL we were handed, 0.. = an index into THUMB_FALLBACKS.
  const [level, setLevel] = useState(imageUrl ? -1 : 0);
  const [retry, setRetry] = useState(0);
  const timer = useRef(null);

  useEffect(() => () => clearTimeout(timer.current), []);

  const base = level < 0
    ? imageUrl
    : (videoId ? `https://i.ytimg.com/vi/${videoId}/${THUMB_FALLBACKS[level] || 'default'}.jpg` : null);
  // Cache-bust the retry: a failed response can be negatively cached, and the
  // same URL would come straight back from the cache without touching the net.
  const src = base && retry ? `${base}${base.includes('?') ? '&' : '?'}r=${retry}` : base;

  const handleError = () => {
    if (level < 0 && retry === 0) {
      timer.current = setTimeout(() => setRetry(1), RETRY_MS);
      return;
    }
    setRetry(0);
    setLevel((n) => (n < 0 && videoId ? 0 : n + 1));
  };

  if (!src || level >= THUMB_FALLBACKS.length) {
    return (
      <div
        className={`${className} overflow-hidden shrink-0 flex items-center justify-center`}
        style={{ background: 'linear-gradient(135deg, #6b62e0 0%, #2ab58a 100%)' }}
      >
        <MusicNoteIcon className={`${iconClassName} text-white/50`} />
      </div>
    );
  }

  return (
    <div className={`${className} overflow-hidden shrink-0 bg-s2`}>
      <img
        src={src}
        alt=""
        className="w-full h-full object-cover"
        referrerPolicy="no-referrer"
        draggable={false}
        onError={handleError}
      />
    </div>
  );
}
