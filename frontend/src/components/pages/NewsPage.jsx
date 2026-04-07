import { useState, useEffect, useCallback } from 'react';
import t from '../../i18n/he.json';
import { NewsSkeleton } from '../Skeleton.jsx';
import useNews from '../../hooks/useNews.js';

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

function CloseIcon({ className = 'w-5 h-5' }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
      strokeLinecap="round" strokeLinejoin="round" className={className}>
      <line x1="18" y1="6" x2="6" y2="18" />
      <line x1="6" y1="6" x2="18" y2="18" />
    </svg>
  );
}

// ─── Category Styles ────────────────────────────────────────────────────────

const CATEGORY_STYLES = {
  news:          { bg: 'bg-coral',   text: 'text-coral-d', label: t.news.categories.news },
  sport:         { bg: 'bg-[#b8ede0]', text: 'text-mint-d',  label: t.news.categories.sport },
  tech:          { bg: 'bg-[#d4cfff]', text: 'text-lav-d',   label: t.news.categories.tech },
  finance:       { bg: 'bg-gold',    text: 'text-gold-d',  label: t.news.categories.finance },
  entertainment: { bg: 'bg-[#e8d0ff]', text: 'text-[#7b44b0]', label: t.news.categories.entertainment },
};

function getCategoryStyle(category) {
  return CATEGORY_STYLES[category] || CATEGORY_STYLES.news;
}

// ─── Gradient Backgrounds ───────────────────────────────────────────────────

const GRADIENT_BG = [
  'from-coral-d/40 to-coral/60',
  'from-mint-d/40 to-mint/60',
  'from-lav-d/40 to-lav/60',
  'from-gold-d/40 to-gold/60',
  'from-acc/40 to-lav/60',
];

// ─── Relative Time ──────────────────────────────────────────────────────────

function formatRelativeTime(isoDate) {
  if (!isoDate) return t.news.justNow;

  const now = Date.now();
  const then = new Date(isoDate).getTime();
  const diffMs = now - then;
  const diffMin = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMs / 3600000);
  const diffDays = Math.floor(diffMs / 86400000);

  if (diffMin < 1) return t.news.justNow;
  if (diffMin < 60) return t.news.relativeTime.minutesAgo.replace('{n}', diffMin);
  if (diffHours === 1) return t.news.relativeTime.hourAgo;
  if (diffHours < 24) return t.news.relativeTime.hoursAgo.replace('{n}', diffHours);
  if (diffDays === 1) return t.news.relativeTime.yesterday;
  return t.news.relativeTime.daysAgo.replace('{n}', diffDays);
}

// ─── Category Badge ─────────────────────────────────────────────────────────

function CategoryBadge({ category, size = 'sm' }) {
  const style = getCategoryStyle(category);
  const sizeClass = size === 'lg'
    ? 'px-3 py-1 text-xs font-semibold'
    : 'px-2.5 py-0.5 text-[11px] font-medium';

  return (
    <span className={`inline-block self-start rounded-full ${sizeClass} ${style.bg} ${style.text}`}>
      {style.label}
    </span>
  );
}

// ─── Article Overlay ────────────────────────────────────────────────────────

function ArticleOverlay({ article, fullArticle, fullArticleLoading, onClose }) {
  const [visible, setVisible] = useState(false);

  // Trigger slide-up on mount
  useEffect(() => {
    requestAnimationFrame(() => setVisible(true));
  }, []);

  const handleClose = useCallback(() => {
    setVisible(false);
    // Wait for animation to complete before unmounting
    setTimeout(onClose, 400);
  }, [onClose]);

  const catStyle = getCategoryStyle(article.category);

  return (
    <div className="fixed inset-0 z-50 flex flex-col">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/40 transition-opacity"
        style={{
          opacity: visible ? 1 : 0,
          transitionDuration: 'var(--dur-slow)',
        }}
        onClick={handleClose}
      />

      {/* Slide-up panel */}
      <div
        className="absolute bottom-0 inset-x-0 bg-surf rounded-t-[24px] shadow-2xl
                   flex flex-col overflow-hidden transition-transform"
        style={{
          maxHeight: '85%',
          transform: visible ? 'translateY(0)' : 'translateY(100%)',
          transitionDuration: 'var(--dur-slow)',
          transitionTimingFunction: 'var(--ease)',
        }}
      >
        {/* Header with gradient */}
        <div className={`relative h-[180px] shrink-0 bg-gradient-to-br ${GRADIENT_BG[0]}`}>
          <div
            className="absolute inset-0"
            style={{
              background: 'linear-gradient(to top, rgba(0,0,0,0.65) 40%, rgba(0,0,0,0.05) 100%)',
            }}
          />
          <div className="absolute bottom-0 inset-x-0 p-6 flex flex-col gap-2">
            <CategoryBadge category={article.category} size="lg" />
            <h2 className="text-xl font-bold text-white leading-tight">
              {article.title}
            </h2>
            <div className="flex items-center gap-2 text-white/70 text-sm">
              <span>{article.source}</span>
              <span>·</span>
              <span>{formatRelativeTime(article.publishedAt)}</span>
            </div>
          </div>

          {/* Close button */}
          <button
            onClick={handleClose}
            className="absolute top-4 left-4 w-10 h-10 rounded-full bg-black/30
                       flex items-center justify-center text-white
                       hover:bg-black/50 active:scale-95 transition-all
                       duration-[var(--dur-fast)]"
            aria-label={t.news.overlay.close}
          >
            <CloseIcon />
          </button>
        </div>

        {/* Scrollable body */}
        <div
          className="flex-1 overflow-y-auto p-6"
          style={{ scrollbarWidth: 'thin' }}
        >
          {fullArticleLoading && (
            <div className="flex flex-col gap-3">
              <div className="skeleton h-4 w-full rounded" />
              <div className="skeleton h-4 w-[90%] rounded" />
              <div className="skeleton h-4 w-[95%] rounded" />
              <div className="skeleton h-4 w-[80%] rounded" />
              <div className="skeleton h-4 w-full rounded mt-4" />
              <div className="skeleton h-4 w-[85%] rounded" />
            </div>
          )}

          {!fullArticleLoading && fullArticle && (
            <div className="text-tp text-[15px] leading-relaxed whitespace-pre-line">
              {fullArticle.content || article.description}
            </div>
          )}

          {!fullArticleLoading && !fullArticle && (
            <div className="text-tp text-[15px] leading-relaxed">
              {article.description}
            </div>
          )}
        </div>

        {/* Bottom close bar */}
        <div className="shrink-0 border-t border-bd p-4 flex justify-center">
          <button
            onClick={handleClose}
            className="ripple px-8 min-h-[48px] rounded-xl bg-s2 text-ts font-medium
                       hover:bg-bd active:scale-95 transition-all duration-[var(--dur-fast)]"
          >
            {t.news.overlay.close}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Featured Card ──────────────────────────────────────────────────────────

function FeaturedCard({ article, onClick }) {
  return (
    <div
      onClick={() => onClick(article)}
      className="shrink-0 relative rounded-[20px] overflow-hidden h-[280px] cursor-pointer
                 hover:shadow-xl transition-shadow duration-[var(--dur-normal)]"
      style={{ boxShadow: '0 4px 24px rgba(0,0,0,0.08)' }}
    >
      {/* Background gradient */}
      <div className={`absolute inset-0 bg-gradient-to-br ${GRADIENT_BG[0]}`} />

      {/* Bottom gradient overlay for text legibility */}
      <div
        className="absolute inset-0"
        style={{
          background: 'linear-gradient(to top, rgba(0,0,0,0.72) 45%, rgba(0,0,0,0.08) 100%)',
        }}
      />

      {/* Text content anchored to bottom */}
      <div className="absolute bottom-0 inset-x-0 p-6 flex flex-col gap-2">
        <CategoryBadge category={article.category} size="lg" />
        <h2 className="text-xl font-bold text-white leading-tight line-clamp-2">
          {article.title}
        </h2>
        <div className="flex items-center gap-2 text-white/70 text-sm">
          <span>{article.source}</span>
          <span>·</span>
          <span>{formatRelativeTime(article.publishedAt)}</span>
        </div>
      </div>
    </div>
  );
}

// ─── News Card ──────────────────────────────────────────────────────────────

function NewsCard({ article, index, onClick }) {
  const gradientIdx = (index + 1) % GRADIENT_BG.length;

  return (
    <div
      onClick={() => onClick(article)}
      className="bg-surf border border-bd rounded-2xl overflow-hidden flex cursor-pointer
                 hover:shadow-md transition-shadow duration-[var(--dur-fast)]"
    >
      {/* Image placeholder */}
      <div className={`w-[140px] shrink-0 bg-gradient-to-br ${GRADIENT_BG[gradientIdx]}`} />

      {/* Content */}
      <div className="flex-1 flex flex-col justify-center p-4 gap-2 min-w-0">
        <CategoryBadge category={article.category} />
        <h3 className="text-sm font-semibold text-tp leading-snug line-clamp-2">
          {article.title}
        </h3>
        <div className="flex items-center gap-1.5 text-xs text-tm">
          <span>{article.source}</span>
          <span>·</span>
          <span>{formatRelativeTime(article.publishedAt)}</span>
        </div>
      </div>
    </div>
  );
}

// ─── NewsPage ───────────────────────────────────────────────────────────────

export default function NewsPage() {
  const {
    articles,
    loading,
    error,
    refresh,
    fetchFullArticle,
    fullArticle,
    fullArticleLoading,
    clearFullArticle,
  } = useNews();

  const [selectedArticle, setSelectedArticle] = useState(null);

  const handleArticleClick = useCallback(
    (article) => {
      setSelectedArticle(article);
      fetchFullArticle(article.id);
    },
    [fetchFullArticle]
  );

  const handleOverlayClose = useCallback(() => {
    setSelectedArticle(null);
    clearFullArticle();
  }, [clearFullArticle]);

  // ─── Loading state ─────────────────────────────────────────────────────
  if (loading) return <NewsSkeleton />;

  // ─── Empty state ───────────────────────────────────────────────────────
  if (!articles || articles.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-5">
        <NewspaperIcon className="w-28 h-28 text-tm" />
        <p className="text-tm text-lg">{t.empty.noNews}</p>
        <button
          onClick={refresh}
          className="ripple flex items-center gap-2 px-6 min-h-[56px] rounded-xl bg-acc text-white
                     font-medium hover:bg-acc/90 active:scale-95 transition-all duration-[var(--dur-fast)]"
        >
          <RefreshIcon />
          <span>{t.news.refresh}</span>
        </button>
      </div>
    );
  }

  // ─── Populated layout ──────────────────────────────────────────────────

  const featured = articles[0];
  const grid = articles.slice(1, 5);

  return (
    <>
      <div
        className="flex flex-col h-full overflow-y-auto p-6 gap-5"
        style={{ scrollbarWidth: 'thin' }}
      >
        {/* Featured headline card */}
        <FeaturedCard article={featured} onClick={handleArticleClick} />

        {/* 2x2 news cards grid */}
        <div className="grid grid-cols-2 gap-4" style={{ minHeight: '360px' }}>
          {grid.map((article, i) => (
            <NewsCard
              key={article.id}
              article={article}
              index={i}
              onClick={handleArticleClick}
            />
          ))}
        </div>
      </div>

      {/* Full article overlay */}
      {selectedArticle && (
        <ArticleOverlay
          article={selectedArticle}
          fullArticle={fullArticle}
          fullArticleLoading={fullArticleLoading}
          onClose={handleOverlayClose}
        />
      )}
    </>
  );
}
