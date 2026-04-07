import { useState, useEffect } from 'react';
import t from '../../i18n/he.json';
import { NewsSkeleton } from '../Skeleton.jsx';
import useStore from '../../store/index.js';

// ─── Icons ──────────────────────────────────────────────────────────────────

function RefreshIcon({ className = 'w-5 h-5' }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
      strokeLinecap="round" strokeLinejoin="round" className={className}>
      <polyline points="23 4 23 10 17 10" />
      <polyline points="1 20 1 14 7 14" />
      <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15" />
    </svg>
  );
}

function NewspaperIcon({ className = 'w-28 h-28' }) {
  return (
    <svg viewBox="0 0 120 120" fill="none" className={className}>
      <rect x="15" y="20" width="90" height="80" rx="12" stroke="currentColor" strokeWidth="2.5" />
      <rect x="25" y="32" width="50" height="28" rx="6" stroke="currentColor" strokeWidth="2" />
      <line x1="25" y1="72" x2="95" y2="72" stroke="currentColor" strokeWidth="1.5" opacity="0.5" />
      <line x1="25" y1="82" x2="85" y2="82" stroke="currentColor" strokeWidth="1.5" opacity="0.5" />
      <line x1="80" y1="36" x2="93" y2="36" stroke="currentColor" strokeWidth="1.5" opacity="0.4" />
      <line x1="80" y1="44" x2="93" y2="44" stroke="currentColor" strokeWidth="1.5" opacity="0.4" />
      <line x1="80" y1="52" x2="93" y2="52" stroke="currentColor" strokeWidth="1.5" opacity="0.4" />
    </svg>
  );
}

function SettingsIcon({ className = 'w-5 h-5' }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
      strokeLinecap="round" strokeLinejoin="round" className={className}>
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06
               a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09
               A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83
               l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09
               A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83
               l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09
               a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83
               l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09
               a1.65 1.65 0 0 0-1.51 1z" />
    </svg>
  );
}

// ─── Category badge colors ───────────────────────────────────────────────────

const CATEGORY_COLORS = [
  'bg-lav text-lav-d',
  'bg-mint text-mint-d',
  'bg-coral text-coral-d',
  'bg-gold text-gold-d',
];

// ─── Placeholder gradient backgrounds for image areas ───────────────────────

const GRADIENT_BG = [
  'from-lav to-acc/30',
  'from-mint to-acc2/30',
  'from-coral to-coral-d/30',
  'from-gold to-gold-d/30',
];

// ─── NewsPage ────────────────────────────────────────────────────────────────

export default function NewsPage() {
  const [loading, setLoading] = useState(true);
  const [articles] = useState([]);
  const connections = useStore((s) => s.connections);
  const setActiveTab = useStore((s) => s.setActiveTab);

  useEffect(() => {
    const timer = setTimeout(() => setLoading(false), 1500);
    return () => clearTimeout(timer);
  }, []);

  if (loading) return <NewsSkeleton />;

  // Not configured state
  const isConfigured = connections.google !== 'not_configured' || articles.length > 0;

  if (!isConfigured) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-5">
        <NewspaperIcon className="w-28 h-28 text-tm" />
        <p className="text-tm text-lg">{t.errors.configureInSettings}</p>
        <button
          onClick={() => setActiveTab(5)}
          className="ripple flex items-center gap-2 px-6 min-h-[56px] rounded-xl bg-s2
                     text-ts font-medium hover:bg-bd active:scale-95 transition-all
                     duration-[var(--dur-fast)]"
        >
          <SettingsIcon />
          <span>{t.tabs.settings}</span>
        </button>
      </div>
    );
  }

  // Empty state (configured but no articles fetched)
  if (articles.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-5">
        <NewspaperIcon className="w-28 h-28 text-tm" />
        <p className="text-tm text-lg">{t.empty.noNews}</p>
        <button
          className="ripple flex items-center gap-2 px-6 min-h-[56px] rounded-xl bg-acc text-white
                     font-medium hover:bg-acc/90 active:scale-95 transition-all duration-[var(--dur-fast)]"
        >
          <RefreshIcon />
          <span>{t.news.refresh}</span>
        </button>
      </div>
    );
  }

  // ─── Populated layout ────────────────────────────────────────────────────

  const featured = articles[0];
  const grid = articles.slice(1, 5);

  return (
    <div className="flex flex-col h-full overflow-y-auto p-6 gap-5"
      style={{ scrollbarWidth: 'thin' }}>

      {/* Featured headline card — full width, tall, gradient overlay for text */}
      <div
        className="shrink-0 relative rounded-[20px] overflow-hidden h-[240px] cursor-pointer
                   hover:shadow-xl transition-shadow duration-[var(--dur-normal)]"
        style={{ boxShadow: '0 4px 24px rgba(0,0,0,0.08)' }}
      >
        {/* Background gradient image placeholder */}
        <div
          className={`absolute inset-0 bg-gradient-to-br ${GRADIENT_BG[0]}`}
        />

        {/* Bottom gradient overlay for text legibility */}
        <div
          className="absolute inset-0"
          style={{
            background: 'linear-gradient(to top, rgba(0,0,0,0.72) 45%, rgba(0,0,0,0.08) 100%)',
          }}
        />

        {/* Text content anchored to bottom */}
        <div className="absolute bottom-0 inset-x-0 p-6 flex flex-col gap-2">
          <span
            className={`inline-block self-start px-3 py-1 rounded-full text-xs font-semibold
                        ${CATEGORY_COLORS[0]}`}
          >
            {featured.category ?? t.news.category}
          </span>
          <h2 className="text-xl font-bold text-white leading-tight line-clamp-2">
            {featured.title ?? t.news.featured}
          </h2>
          <div className="flex items-center gap-2 text-white/70 text-sm">
            <span>{featured.source ?? 'ynet'}</span>
            <span>·</span>
            <span>{t.news.justNow}</span>
          </div>
        </div>
      </div>

      {/* 2×2 news cards grid */}
      <div className="grid grid-cols-2 gap-4" style={{ minHeight: '360px' }}>
        {(grid.length > 0 ? grid : Array.from({ length: 4 })).map((article, i) => (
          <div
            key={i}
            className="bg-surf border border-bd rounded-2xl overflow-hidden flex cursor-pointer
                       hover:shadow-md transition-shadow duration-[var(--dur-fast)]"
          >
            {/* Image placeholder */}
            <div className={`w-[140px] shrink-0 bg-gradient-to-br ${GRADIENT_BG[(i + 1) % 4]}`} />

            {/* Content */}
            <div className="flex-1 flex flex-col justify-center p-4 gap-2 min-w-0">
              <span
                className={`inline-block self-start px-2.5 py-0.5 rounded-full text-xs font-medium
                            ${CATEGORY_COLORS[(i + 1) % 4]}`}
              >
                {article?.category ?? t.news.category}
              </span>
              <h3 className="text-sm font-semibold text-tp leading-snug line-clamp-2">
                {article?.title ?? `${t.news.featured} ${i + 1}`}
              </h3>
              <div className="flex items-center gap-1.5 text-xs text-tm">
                <span>{article?.source ?? 'ynet'}</span>
                <span>·</span>
                <span>{(i + 1) * 12} {t.news.minutesAgo}</span>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
