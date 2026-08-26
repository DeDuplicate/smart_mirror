import { useState, useEffect, useCallback } from 'react';
import t from '../../i18n/he.json';
import { NewsSkeleton } from '../Skeleton.jsx';
import ConnectionBanner from '../ConnectionBanner.jsx';
import useNews from '../../hooks/useNews.js';
import usePullToRefresh from '../../hooks/usePullToRefresh.js';

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

function ChevronLeftIcon({ className = 'w-5 h-5' }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
      strokeLinecap="round" strokeLinejoin="round" className={className}>
      <polyline points="15 18 9 12 15 6" />
    </svg>
  );
}

function NewspaperGlyph({ className = 'w-7 h-7' }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
      strokeLinecap="round" strokeLinejoin="round" className={className}>
      <path d="M4 22h16a2 2 0 0 0 2-2V4a2 2 0 0 0-2-2H8a2 2 0 0 0-2 2v16a2 2 0 0 1-2 2Zm0 0a2 2 0 0 1-2-2v-9c0-1.1.9-2 2-2h2" />
      <path d="M18 14h-8" />
      <path d="M15 18h-5" />
      <path d="M10 6h8v4h-8V6Z" />
    </svg>
  );
}

// ─── Category Styles ────────────────────────────────────────────────────────
// Pastel token pairs from the design system (see global.css), mapped by
// category and applied via inline var() so both light and dark themes resolve.

const CATEGORY_STYLES = {
  news:          { bg: 'var(--coral-bg)', fg: 'var(--coral-d)' },
  sport:         { bg: 'var(--mint-bg)',  fg: 'var(--mint-d)' },
  tech:          { bg: 'var(--lav-bg)',   fg: 'var(--lav-d)' },
  finance:       { bg: 'var(--gold-bg)',  fg: 'var(--gold-d)' },
  entertainment: { bg: 'var(--lav-bg)',   fg: 'var(--lav-d)' },
};

function getCategoryStyle(category) {
  return CATEGORY_STYLES[category] || CATEGORY_STYLES.news;
}

function getCategoryLabel(category) {
  return t.news.categories[category] || t.news.categories.news;
}

// Hero gradient per category — pastel-d into pastel-bg. A dark scrim is
// layered on top at render time so white text stays legible in both themes.
function categoryGradient(category) {
  const { bg, fg } = getCategoryStyle(category);
  return { background: `linear-gradient(135deg, ${fg} 0%, ${bg} 100%)` };
}

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
  const { bg, fg } = getCategoryStyle(category);
  const sizeClass = size === 'lg'
    ? 'px-3 py-1 text-xs font-semibold'
    : 'px-2.5 py-0.5 text-[11px] font-medium';

  return (
    <span
      className={`inline-block self-start rounded-full ${sizeClass}`}
      style={{ backgroundColor: bg, color: fg }}
    >
      {getCategoryLabel(category)}
    </span>
  );
}

// ─── Article Blocks ─────────────────────────────────────────────────────────
// Renders the article body as an ordered sequence of text/image blocks so
// in-article photos appear at their original position, not just as a single
// title image (per explicit user request). Falls back to a flat text blob
// for sources where structural extraction wasn't available (e.g. mock data).

function ArticleImageBlock({ src, caption }) {
  const [failed, setFailed] = useState(false);
  if (failed) return null;
  return (
    <figure className="m-0">
      <img
        src={src}
        alt={caption || ''}
        className="w-full rounded-xl"
        loading="lazy"
        onError={() => setFailed(true)}
      />
      {caption && (
        <figcaption className="mt-1.5 text-ts text-xs leading-snug">{caption}</figcaption>
      )}
    </figure>
  );
}

function ArticleBlocks({ blocks, fallbackText, skipImageSrc }) {
  if (!Array.isArray(blocks) || blocks.length === 0) {
    return (
      <div className="text-tp text-base leading-relaxed whitespace-pre-line">
        {fallbackText}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      {blocks.map((block, i) => {
        if (block.type === 'image') {
          if (skipImageSrc && block.src === skipImageSrc) return null;
          return <ArticleImageBlock key={i} src={block.src} caption={block.caption} />;
        }
        return (
          <p key={i} className="text-tp text-base leading-relaxed whitespace-pre-line">
            {block.value}
          </p>
        );
      })}
    </div>
  );
}

// ─── Article Overlay ────────────────────────────────────────────────────────

function ArticleOverlay({ article, fullArticle, fullArticleLoading, onClose }) {
  const [visible, setVisible] = useState(false);
  const [heroImageFailed, setHeroImageFailed] = useState(false);

  // Trigger slide-up on mount
  useEffect(() => {
    requestAnimationFrame(() => setVisible(true));
  }, []);

  const handleClose = useCallback(() => {
    setVisible(false);
    // Wait for animation to complete before unmounting
    setTimeout(onClose, 400);
  }, [onClose]);

  // Prefer the full-article's extracted image (og:image, more reliable) over
  // the RSS-provided one, since it becomes available once loaded.
  const heroImage = !heroImageFailed ? (fullArticle?.image || article.image || null) : null;

  return (
    <div className="fixed inset-0 z-50 flex">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/40 transition-opacity"
        style={{
          opacity: visible ? 1 : 0,
          transitionDuration: 'var(--dur-slow)',
        }}
        onClick={handleClose}
      />

      {/* Slide-in panel — anchored to the physical left edge of the screen
          regardless of RTL/LTR text direction (per explicit user request),
          so it always uses literal left-0 / translateX, not logical start. */}
      <div
        className="absolute top-0 left-0 h-full w-[92%] max-w-[640px] bg-surf rounded-e-3xl shadow-modal
                   flex flex-col overflow-hidden transition-transform"
        style={{
          transform: visible ? 'translateX(0)' : 'translateX(-100%)',
          transitionDuration: 'var(--dur-slow)',
          transitionTimingFunction: 'var(--ease)',
        }}
      >
        {/* Hero header — article image if available, else category gradient */}
        <div
          className="relative h-[220px] shrink-0"
          style={heroImage ? undefined : categoryGradient(article.category)}
        >
          {heroImage && (
            <img
              src={heroImage}
              alt=""
              className="absolute inset-0 w-full h-full object-cover"
              onError={() => setHeroImageFailed(true)}
            />
          )}
          <div
            className="absolute inset-0"
            style={{
              background: 'linear-gradient(to top, rgba(0,0,0,0.68) 40%, rgba(0,0,0,0.05) 100%)',
            }}
          />
          <div className="absolute bottom-0 inset-x-0 p-7 flex flex-col gap-2.5">
            <CategoryBadge category={article.category} size="lg" />
            <h2 className="text-2xl font-bold text-white leading-tight">
              {article.title}
            </h2>
            <div className="flex items-center gap-2 text-white/70 text-sm">
              <span>{article.source}</span>
              <span>·</span>
              <span>{formatRelativeTime(article.publishedAt)}</span>
            </div>
          </div>

          {/* Close button — circular control, 56px touch target */}
          <button
            onClick={handleClose}
            className="absolute top-4 end-4 w-14 h-14 rounded-full bg-black/30
                       flex items-center justify-center text-white
                       hover:bg-black/50 active:scale-95 transition-all
                       duration-[var(--dur-fast)]"
            aria-label={t.news.overlay.close}
          >
            <CloseIcon className="w-6 h-6" />
          </button>
        </div>

        {/* Scrollable body */}
        <div
          className="flex-1 overflow-y-auto p-7"
          style={{ scrollbarWidth: 'thin' }}
        >
          {fullArticleLoading && (
            <div className="flex flex-col gap-3" aria-label={t.news.overlay.loading}>
              <div className="skeleton h-4 w-full" />
              <div className="skeleton h-4 w-[90%]" />
              <div className="skeleton h-4 w-[95%]" />
              <div className="skeleton h-4 w-[80%]" />
              <div className="skeleton h-4 w-full mt-4" />
              <div className="skeleton h-4 w-[85%]" />
            </div>
          )}

          {!fullArticleLoading && fullArticle && (
            <ArticleBlocks
              blocks={fullArticle.blocks}
              fallbackText={fullArticle.content || article.description}
              skipImageSrc={heroImage}
            />
          )}

          {!fullArticleLoading && !fullArticle && (
            <div className="text-tp text-base leading-relaxed">
              {article.description}
            </div>
          )}
        </div>

        {/* Footer — single button spanning the sheet: surface-tier press */}
        <div className="shrink-0 border-t border-bd p-4">
          <button
            onClick={handleClose}
            className="w-full min-h-[56px] rounded-xl bg-s2 text-ts font-medium
                       hover:bg-bd active:scale-[0.98] transition-all duration-[var(--dur-fast)]"
          >
            {t.news.overlay.close}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Unread Dot ─────────────────────────────────────────────────────────────
// Convey "unread" via a dot AND a font-weight/color shift (never color alone),
// per accessibility guidance for color-blind and low-vision users.

function UnreadDot({ className = 'w-2 h-2' }) {
  return (
    <span
      className={`inline-block shrink-0 rounded-full bg-acc ${className}`}
      aria-hidden="true"
    />
  );
}

// ─── Featured Card (hero) ───────────────────────────────────────────────────

function FeaturedCard({ article, unread, onClick }) {
  const [imageFailed, setImageFailed] = useState(false);
  const showImage = article.image && !imageFailed;

  return (
    <div
      role="button"
      tabIndex={0}
      aria-label={`${t.news.featured}: ${article.title}`}
      onClick={() => onClick(article)}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onClick(article);
        }
      }}
      className="group shrink-0 relative rounded-3xl overflow-hidden h-[340px]
                 cursor-pointer select-none
                 shadow-card hover:shadow-raised active:scale-[0.98]
                 transition-all duration-[var(--dur-normal)]"
      style={showImage ? undefined : categoryGradient(article.category)}
    >
      {showImage && (
        <img
          src={article.image}
          alt=""
          className="absolute inset-0 w-full h-full object-cover"
          onError={() => setImageFailed(true)}
        />
      )}

      {/* Legibility scrim */}
      <div
        className="absolute inset-0"
        style={{
          background: 'linear-gradient(to top, rgba(0,0,0,0.74) 45%, rgba(0,0,0,0.08) 100%)',
        }}
      />

      {/* Decorative oversized glyph, anchored to the end corner */}
      <NewspaperGlyph className="absolute top-6 end-7 w-16 h-16 text-white/25" />

      {/* Text content anchored to bottom */}
      <div className="absolute bottom-0 inset-x-0 p-7 flex flex-col gap-2.5">
        <div className="flex items-center gap-3">
          <CategoryBadge category={article.category} size="lg" />
          {unread && <UnreadDot className="w-2.5 h-2.5" />}
          <span className="text-white/70 text-sm font-medium tracking-wide">
            {t.news.featured}
          </span>
        </div>
        <h2 className={`text-2xl leading-tight line-clamp-2 ${unread ? 'font-bold text-white' : 'font-medium text-white/85'}`}>
          {unread && <span className="sr-only">{t.news.unreadAria}. </span>}
          {article.title}
        </h2>
        {article.description && (
          <p className="text-white/80 text-[15px] leading-relaxed line-clamp-2 max-w-3xl">
            {article.description}
          </p>
        )}
        <div className="flex items-center gap-2 text-white/70 text-sm">
          <span>{article.source}</span>
          <span>·</span>
          <span>{formatRelativeTime(article.publishedAt)}</span>
        </div>
      </div>
    </div>
  );
}

// ─── Headline Row ───────────────────────────────────────────────────────────
// A repeated item in a scrolling list is a row, not a surface: rounded-xl,
// hairline border at rest, raised elevation on hover, surface-tier press.

function HeadlineThumb({ image, bg, fg }) {
  const [failed, setFailed] = useState(false);
  if (image && !failed) {
    return (
      <img
        src={image}
        alt=""
        className="w-full h-full object-cover"
        onError={() => setFailed(true)}
      />
    );
  }
  return <NewspaperGlyph className="w-7 h-7" />;
}

function HeadlineRow({ article, unread, onClick }) {
  const { bg, fg } = getCategoryStyle(article.category);

  return (
    <div
      role="button"
      tabIndex={0}
      aria-label={`${t.news.openArticle}: ${article.title}`}
      onClick={() => onClick(article)}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onClick(article);
        }
      }}
      className="flex items-center gap-4 rounded-xl bg-surf border border-bd p-3
                 min-h-[88px] cursor-pointer select-none
                 hover:shadow-raised hover:border-ts/40 active:scale-[0.98]
                 transition-all duration-[var(--dur-fast)]"
    >
      {/* Media thumb — article image if available, else category glyph */}
      <div
        className={`w-[64px] h-[64px] shrink-0 rounded-xl flex items-center justify-center overflow-hidden ${unread ? '' : 'opacity-60'}`}
        style={{ backgroundColor: bg, color: fg }}
      >
        <HeadlineThumb image={article.image} bg={bg} fg={fg} />
      </div>

      {/* Text */}
      <div className="flex-1 min-w-0 flex flex-col gap-1">
        <div className="flex items-center gap-2">
          <h3 className={`text-[15px] leading-snug line-clamp-2 ${unread ? 'font-semibold text-tp' : 'font-normal text-ts'}`}>
            {unread && <span className="sr-only">{t.news.unreadAria}. </span>}
            {article.title}
          </h3>
          {unread && <UnreadDot />}
        </div>
        <div className="flex items-center gap-1.5 text-xs text-ts">
          <span className="font-medium" style={{ color: fg }}>
            {getCategoryLabel(article.category)}
          </span>
          <span className="text-tm">·</span>
          <span>{article.source}</span>
          <span className="text-tm">·</span>
          <span>{formatRelativeTime(article.publishedAt)}</span>
        </div>
      </div>

      {/* Forward affordance — points left in RTL */}
      <ChevronLeftIcon className="w-5 h-5 shrink-0 text-tm me-1" aria-hidden="true" />
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
    isRead,
    markAsRead,
  } = useNews();

  const [selectedArticle, setSelectedArticle] = useState(null);

  // Pull to refresh
  const { pullDistance, isPulling, bind: pullBind } = usePullToRefresh(refresh);

  const handleArticleClick = useCallback(
    (article) => {
      setSelectedArticle(article);
      fetchFullArticle(article.id);
      markAsRead(article.id);
    },
    [fetchFullArticle, markAsRead]
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
      <div className="flex flex-col h-full">
        {error && (
          <ConnectionBanner
            integration={t.news.banner.title}
            message={t.news.banner.degraded}
            onAction={refresh}
          />
        )}
        <div className="flex-1 flex flex-col items-center justify-center gap-5">
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
      </div>
    );
  }

  // ─── Populated layout ──────────────────────────────────────────────────

  const featured = articles[0];
  const headlines = articles.slice(1);

  return (
    <>
      <div
        className="flex flex-col h-full overflow-y-auto p-6 gap-5"
        style={{ scrollbarWidth: 'thin' }}
        {...pullBind}
      >
        {/* Pull-to-refresh indicator */}
        {isPulling && (
          <div
            className="shrink-0 flex items-center justify-center overflow-hidden transition-all duration-[var(--dur-fast)]"
            style={{ height: `${pullDistance}px`, marginTop: `-${pullDistance}px`, transform: `translateY(${pullDistance}px)` }}
          >
            <div
              className={`w-6 h-6 border-2 border-acc border-t-transparent rounded-full
                ${pullDistance > 24 ? 'pull-refresh-spinner' : ''}`}
            />
          </div>
        )}

        {/* Degraded feeds banner */}
        {error && (
          <ConnectionBanner
            integration={t.news.banner.title}
            message={t.news.banner.degraded}
            onAction={refresh}
          />
        )}

        {/* Featured headline hero */}
        <FeaturedCard article={featured} unread={!isRead(featured.id)} onClick={handleArticleClick} />

        {/* Headline list */}
        {headlines.length > 0 && (
          <section className="flex flex-col gap-3">
            <h2 className="text-sm font-semibold text-ts px-1">{t.news.headlines}</h2>
            {headlines.map((article) => (
              <HeadlineRow
                key={article.id}
                article={article}
                unread={!isRead(article.id)}
                onClick={handleArticleClick}
              />
            ))}
          </section>
        )}
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
