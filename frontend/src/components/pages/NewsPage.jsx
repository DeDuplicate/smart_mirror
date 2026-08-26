import { useState, useEffect, useCallback } from 'react';
import t from '../../i18n/he.json';
import { NewsSkeleton } from '../Skeleton.jsx';
import ConnectionBanner from '../ConnectionBanner.jsx';
import useNews from '../../hooks/useNews.js';
import usePullToRefresh from '../../hooks/usePullToRefresh.js';

// ─── Reading model ──────────────────────────────────────────────────────────
// This screen is a 1920x1080 wall panel read from 2-4 m away, operated by a
// finger on an IR frame. Two consequences drive every size below:
//
//  1. TYPE IS DISTANCE-CALIBRATED. The HIG's 17pt body default describes a
//     handheld at ~30 cm. At ~2.5 m the same angular size needs roughly 3x,
//     so body copy in the reading view is 22px/1.8 and the smallest text on
//     the page is 15px — never the 11-12px of a phone UI.
//  2. IMAGES ONLY WHERE THEY RESOLVE. A 64px thumbnail is a smudge at 2.5 m,
//     so photography is concentrated in the lead and second stories, where it
//     is 200-1800px wide, and the rail is purely typographic. (Design
//     Guideline — Images: scale artwork so important visual content remains
//     visible.)
//
// Text never sits on top of a photograph here. Headlines live on opaque
// surfaces, so contrast is a known quantity instead of a property of whatever
// the newsroom published today. (Design Guideline — Color > Inclusive color:
// "insufficient contrast can cause icons and text to blend with the
// background and make content hard to read.")

// ─── Icons ──────────────────────────────────────────────────────────────────

function RefreshIcon({ className = 'w-6 h-6' }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
      strokeLinecap="round" strokeLinejoin="round" className={className}>
      <polyline points="23 4 23 10 17 10" />
      <polyline points="1 20 1 14 7 14" />
      <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15" />
    </svg>
  );
}

function CloseIcon({ className = 'w-7 h-7' }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
      strokeLinecap="round" strokeLinejoin="round" className={className}>
      <line x1="18" y1="6" x2="6" y2="18" />
      <line x1="6" y1="6" x2="18" y2="18" />
    </svg>
  );
}

function AlertIcon({ className = 'w-6 h-6' }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
      strokeLinecap="round" strokeLinejoin="round" className={className}>
      <circle cx="12" cy="12" r="9" />
      <line x1="12" y1="7.5" x2="12" y2="13" />
      <line x1="12" y1="16.5" x2="12" y2="16.5" />
    </svg>
  );
}

// 120x120 illustration — not an interface icon, so it sets its own stroke.
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

// ─── Category tokens ────────────────────────────────────────────────────────
// Pastel plate + `text-tp` label. The pastel-d foreground on pastel-bg pairing
// this replaces measured 2.6:1-4.0:1, below the 4.5:1 floor; `text-tp` on the
// same plates measures 11.3:1-13.5:1 light and 9.8:1-12.7:1 dark. Theme-aware
// Tailwind utilities, so no inline var() and no hex anywhere on this screen.

const CATEGORY_PLATE = {
  news: { className: 'bg-coral', bg: 'var(--coral-bg)' },
  sport: { className: 'bg-mint', bg: 'var(--mint-bg)' },
  tech: { className: 'bg-lav', bg: 'var(--lav-bg)' },
  finance: { className: 'bg-gold', bg: 'var(--gold-bg)' },
  entertainment: { className: 'bg-lav', bg: 'var(--lav-bg)' },
};

function categoryPlate(category) {
  return CATEGORY_PLATE[category] || CATEGORY_PLATE.news;
}

function categoryPlateClass(category) {
  return categoryPlate(category).className;
}

function categoryPlateBg(category) {
  return categoryPlate(category).bg;
}

function categoryLabel(category) {
  return t.news.categories[category] || t.news.categories.news;
}

// ─── Time formatting ────────────────────────────────────────────────────────
// The rail is a departures board: same-day stories get a clock reading, older
// ones a day.month stamp. Built by hand rather than via Intl so the Pi renders
// identical glyph widths regardless of installed locale data.

function pad2(n) {
  return String(n).padStart(2, '0');
}

function formatStamp(isoDate) {
  if (!isoDate) return '—';
  const then = new Date(isoDate);
  if (Number.isNaN(then.getTime())) return '—';
  if (Date.now() - then.getTime() < 86400000) {
    return `${pad2(then.getHours())}:${pad2(then.getMinutes())}`;
  }
  return `${pad2(then.getDate())}.${pad2(then.getMonth() + 1)}`;
}

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

function prefersReducedMotion() {
  return (
    typeof window !== 'undefined' &&
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches
  );
}

// ─── Shared bits ────────────────────────────────────────────────────────────

function CategoryChip({ category, size = 'sm' }) {
  const sizeClass = size === 'lg' ? 'h-9 px-4 text-[17px]' : 'h-7 px-3 text-[14px]';
  return (
    <span
      className={`inline-flex items-center shrink-0 rounded-full font-semibold text-tp
                  ${categoryPlateClass(category)} ${sizeClass}`}
      style={{ color: 'var(--tp)', backgroundColor: categoryPlateBg(category) }}
    >
      {categoryLabel(category)}
    </span>
  );
}

// A hairline standing in for the "·" that used to separate metadata. The old
// separator was `text-tm` — 2.05:1 on white, illegible at 2.5 m — and a rule
// is what a separator actually is. (Design Guideline — Layout > Best
// practices: use separator lines to separate information into distinct areas.)
function MetaRule() {
  return <span className="w-px h-4 shrink-0 bg-bd" aria-hidden="true" />;
}

// Read state is carried three ways so it never depends on colour alone: a
// filled-vs-hollow node (shape), the headline's weight, and screen-reader
// text. (Design Guideline — Accessibility > Vision: "Offer visual indicators,
// like distinct shapes or icons, in addition to color.")
function ReadNode({ unread, className = 'w-3 h-3' }) {
  return (
    <span
      className={`inline-block shrink-0 rounded-full ${className}
                  ${unread ? 'bg-acc' : 'border-2 border-tm'}`}
      aria-hidden="true"
    />
  );
}

// ─── Story card (lead + seconds) ────────────────────────────────────────────
// One component, two compositions: the lead stacks a full-bleed banner over a
// wide headline; a second story sets a portrait plate beside its headline.
// Both keep every word on an opaque surface.

const STORY_VARIANTS = {
  lead: {
    shell: 'flex-col',
    plate: 'flex-1 min-h-0 w-full',
    plateLabel: 'text-[34px]',
    // The body takes its natural height so the banner absorbs every spare
    // pixel — a hero photo earns the leftover space, dead air does not.
    body: 'shrink-0 p-7 gap-3',
    title: 'text-[40px] leading-[1.15] line-clamp-2',
    meta: 'text-[16px]',
    chipSize: 'lg',
  },
  second: {
    shell: 'flex-row',
    plate: 'w-[220px] h-full shrink-0',
    plateLabel: 'text-[20px]',
    body: 'flex-1 p-5 gap-2',
    title: 'text-[23px] leading-[1.3] line-clamp-3',
    meta: 'text-[15px]',
    chipSize: 'sm',
  },
};

function StoryCard({ article, unread, variant, onClick }) {
  const v = STORY_VARIANTS[variant];
  const isLead = variant === 'lead';
  const [imageFailed, setImageFailed] = useState(false);
  const hasImage = Boolean(article.image) && !imageFailed;

  const activate = () => onClick(article);

  return (
    <div
      role="button"
      tabIndex={0}
      aria-label={`${isLead ? t.news.featured : t.news.openArticle}: ${article.title}`}
      onClick={activate}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          activate();
        }
      }}
      className={`flex overflow-hidden rounded-2xl bg-surf border border-bd cursor-pointer
                  select-none shadow-card hover:shadow-raised active:scale-[0.98]
                  transition-all duration-[var(--dur-normal)] ${v.shell}`}
    >
      {hasImage ? (
        <div className={`overflow-hidden bg-s2 ${v.plate}`}>
          <img
            src={article.image}
            alt=""
            loading="lazy"
            className="w-full h-full object-cover"
            onError={() => setImageFailed(true)}
          />
        </div>
      ) : (
        // No photo: the plate becomes a flat category field. It names the
        // section, so the chip below is suppressed — one label, one job.
        <div
          className={`flex items-end p-6 ${v.plate} ${categoryPlateClass(article.category)}`}
          style={{ backgroundColor: categoryPlateBg(article.category) }}
        >
          <span className={`font-bold text-tp ${v.plateLabel}`}>
            {categoryLabel(article.category)}
          </span>
        </div>
      )}

      <div className={`min-w-0 flex flex-col ${v.body}`}>
        {(hasImage || isLead) && (
          <div className="flex items-center gap-3">
            {hasImage && <CategoryChip category={article.category} size={v.chipSize} />}
            {isLead && (
              <span className="text-[16px] font-semibold text-ts">{t.news.featured}</span>
            )}
            <ReadNode unread={unread} className={isLead ? 'w-3.5 h-3.5' : 'w-3 h-3'} />
          </div>
        )}

        <h2 className={`${v.title} ${unread ? 'font-bold text-tp' : 'font-semibold text-ts'}`}>
          {unread && <span className="sr-only">{t.news.unreadAria}. </span>}
          {article.title}
        </h2>

        {isLead && article.description && (
          <p className="text-[20px] leading-[1.55] text-ts line-clamp-2 max-w-[860px]">
            {article.description}
          </p>
        )}

        <div className={`mt-auto flex items-center gap-3 text-ts ${v.meta}`}>
          <span className="font-semibold">{article.source}</span>
          <MetaRule />
          <span>{formatRelativeTime(article.publishedAt)}</span>
        </div>
      </div>
    </div>
  );
}

// ─── Timeline row ───────────────────────────────────────────────────────────
// A repeated item in a scrolling list, so: rounded-xl, hairline border,
// surface-tier press. 92px tall and full rail width — far past the 56px
// minimum touch target.

function TimelineRow({ article, unread, onClick }) {
  const activate = () => onClick(article);

  return (
    <div
      role="button"
      tabIndex={0}
      aria-label={`${t.news.openArticle}: ${article.title}`}
      onClick={activate}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          activate();
        }
      }}
      className="shrink-0 flex items-center gap-4 min-h-[92px] p-3 rounded-xl bg-surf
                 border border-bd cursor-pointer select-none shadow-card
                 hover:shadow-raised active:scale-[0.98]
                 transition-all duration-[var(--dur-fast)]"
    >
      <span
        dir="ltr"
        className="w-[62px] shrink-0 text-center font-mono tabular-nums text-[17px] text-ts"
      >
        {formatStamp(article.publishedAt)}
      </span>

      <ReadNode unread={unread} />

      <div className="flex-1 min-w-0 flex flex-col gap-1">
        <h3
          className={`text-[19px] leading-[1.35] line-clamp-2
                      ${unread ? 'font-bold text-tp' : 'font-medium text-ts'}`}
        >
          {unread && <span className="sr-only">{t.news.unreadAria}. </span>}
          {article.title}
        </h3>
        <span className="text-[15px] text-ts">{article.source}</span>
      </div>
    </div>
  );
}

// ─── Reading view ───────────────────────────────────────────────────────────

const ARTICLE_TITLE_ID = 'news-article-title';

// A live aggregation can return 250+ items. Nobody scans 250 headlines from a
// sofa, and 250 rows of DOM is real work for the Pi's compositor, so the rail
// holds the freshest slice and the count reports exactly what it holds.
const RAIL_LIMIT = 40;

function ArticleFigure({ src, caption }) {
  const [failed, setFailed] = useState(false);
  if (failed) return null;
  return (
    <figure className="m-0 flex flex-col gap-2">
      <img
        src={src}
        alt={caption || ''}
        loading="lazy"
        className="w-full rounded-xl bg-s2"
        onError={() => setFailed(true)}
      />
      {caption && (
        <figcaption className="text-[17px] leading-[1.5] text-ts">{caption}</figcaption>
      )}
    </figure>
  );
}

// Body copy: 22px at 1.8 leading across an ~856px measure — about 78
// characters per line, inside the comfortable range, and legible from across
// the room. (Design Guideline — Layout > Guides and safe areas: "restrict the
// width of text for optimal readability.")
function ArticleBody({ blocks, fallbackText, skipImageSrc }) {
  const paragraph = 'text-[22px] leading-[1.8] text-tp whitespace-pre-line';

  if (!Array.isArray(blocks) || blocks.length === 0) {
    return <p className={paragraph}>{fallbackText}</p>;
  }

  return (
    <div className="flex flex-col gap-7">
      {blocks.map((block, i) => {
        if (block.type === 'image') {
          if (skipImageSrc && block.src === skipImageSrc) return null;
          return <ArticleFigure key={i} src={block.src} caption={block.caption} />;
        }
        return (
          <p key={i} className={paragraph}>
            {block.value}
          </p>
        );
      })}
    </div>
  );
}

function ArticleBodySkeleton() {
  return (
    <div
      className="flex flex-col gap-7"
      role="status"
      aria-busy="true"
      aria-label={t.news.overlay.loading}
    >
      <div className="skeleton h-[300px] w-full rounded-3xl" />
      {[['100%', '96%', '88%', '62%'], ['100%', '92%', '70%']].map((group, g) => (
        <div key={g} className="flex flex-col gap-3">
          {group.map((w, i) => (
            <div key={i} className="skeleton h-[26px]" style={{ width: w }} />
          ))}
        </div>
      ))}
    </div>
  );
}

// Extraction failed: say what happened and offer the way forward, rather than
// silently showing a two-line summary under a full-size headline. (Design
// Guideline — Feedback > Best practices: "Show people when a command can't be
// carried out and help them understand why.")
function ExtractionNotice({ onRetry }) {
  return (
    <div className="flex items-start gap-4 rounded-2xl bg-s2 border border-bd p-6">
      <AlertIcon className="w-6 h-6 mt-1 shrink-0 text-ts" />
      <div className="flex-1 flex flex-col items-start gap-5">
        <p className="text-[19px] leading-[1.6] text-tp">{t.news.overlay.unavailable}</p>
        <button
          onClick={onRetry}
          className="ripple min-h-[56px] px-7 rounded-xl bg-acc text-white text-[19px] font-bold
                     hover:bg-acc/90 active:scale-95 transition-all duration-[var(--dur-fast)]"
        >
          {t.news.overlay.retry}
        </button>
      </div>
    </div>
  );
}

// A centred reading pane rather than an edge-anchored panel: it needs no
// physical-direction anchoring (so it stays correct under RTL), it can hold a
// proper reading measure, and the dimmed surround puts the article in sole
// focus.
function ArticleOverlay({ article, fullArticle, fullArticleLoading, onClose, onRetry }) {
  const [reduced] = useState(prefersReducedMotion);
  const [visible, setVisible] = useState(reduced);
  const [heroFailed, setHeroFailed] = useState(false);

  useEffect(() => {
    if (!reduced) requestAnimationFrame(() => setVisible(true));
  }, [reduced]);

  const handleClose = useCallback(() => {
    if (reduced) {
      onClose();
      return;
    }
    setVisible(false);
    setTimeout(onClose, 250);
  }, [onClose, reduced]);

  // Dismiss with an explicit action from the keyboard too, alongside the two
  // on-screen close controls and the backdrop.
  useEffect(() => {
    const onKeyDown = (e) => {
      if (e.key === 'Escape') handleClose();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [handleClose]);

  // Prefer the extracted og:image once it arrives — it is more reliable than
  // the RSS enclosure.
  const heroImage = heroFailed ? null : fullArticle?.image || article.image || null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-12">
      <div
        className="absolute inset-0 bg-black/50 transition-opacity"
        style={{ opacity: visible ? 1 : 0, transitionDuration: 'var(--dur-normal)' }}
        onClick={handleClose}
      />

      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={ARTICLE_TITLE_ID}
        className="relative w-full max-w-[1240px] h-full flex flex-col overflow-hidden
                   rounded-2xl bg-surf text-tp shadow-modal transition-[opacity,transform]"
        style={{
          opacity: visible ? 1 : 0,
          transform: visible ? 'translateY(0)' : 'translateY(32px)',
          transitionDuration: 'var(--dur-normal)',
          transitionTimingFunction: 'var(--ease-out)',
        }}
      >
        {/* Masthead — stays put while the article scrolls, so the source and
            the way out are always available. */}
        <header className="shrink-0 flex items-center gap-4 px-8 py-4 border-b border-bd">
          <CategoryChip category={article.category} size="lg" />
          <span className="text-[17px] font-semibold text-tp truncate">{article.source}</span>
          <MetaRule />
          <span className="text-[17px] text-ts shrink-0">
            {formatRelativeTime(article.publishedAt)}
          </span>
          <button
            onClick={handleClose}
            aria-label={t.news.overlay.close}
            className="ms-auto w-[56px] h-[56px] shrink-0 flex items-center justify-center
                       rounded-full bg-s2 text-tp hover:bg-bd active:scale-95
                       transition-all duration-[var(--dur-fast)]"
          >
            <CloseIcon />
          </button>
        </header>

        <div className="flex-1 overflow-y-auto" style={{ scrollbarWidth: 'thin' }}>
          <div className="mx-auto w-full max-w-[920px] px-8 py-10 flex flex-col gap-8">
            <h1
              id={ARTICLE_TITLE_ID}
              className="text-[38px] leading-[1.2] font-bold text-tp"
            >
              {article.title}
            </h1>

            {article.description && (
              <p className="text-[23px] leading-[1.6] text-ts">{article.description}</p>
            )}

            {heroImage && (
              <img
                src={heroImage}
                alt=""
                className="w-full rounded-3xl bg-s2"
                onError={() => setHeroFailed(true)}
              />
            )}

            <div className="h-px bg-bd" />

            {fullArticleLoading && <ArticleBodySkeleton />}

            {!fullArticleLoading && fullArticle && (
              <ArticleBody
                blocks={fullArticle.blocks}
                fallbackText={fullArticle.content || article.description}
                skipImageSrc={heroImage}
              />
            )}

            {!fullArticleLoading && !fullArticle && <ExtractionNotice onRetry={onRetry} />}

            {/* End of the read: a full-measure button, so surface-tier press. */}
            <button
              onClick={handleClose}
              className="w-full min-h-[64px] mt-2 rounded-xl bg-s2 border border-bd
                         text-[19px] font-semibold text-tp hover:bg-bd active:scale-[0.98]
                         transition-all duration-[var(--dur-fast)]"
            >
              {t.news.overlay.close}
            </button>
          </div>
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
    isRead,
    markAsRead,
  } = useNews();

  const [selectedArticle, setSelectedArticle] = useState(null);

  // Bound to the rail, the one scrolling region on the page.
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

  const handleRetryFullArticle = useCallback(() => {
    if (selectedArticle) fetchFullArticle(selectedArticle.id);
  }, [fetchFullArticle, selectedArticle]);

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
        <div className="flex-1 flex items-center justify-center p-6">
          <div
            className="flex flex-col items-center gap-6 max-w-[720px] px-16 py-14
                       rounded-2xl bg-surf border border-bd shadow-card"
          >
            <NewspaperIcon className="w-28 h-28 text-tm" />
            <p className="text-[26px] font-bold text-tp text-center">{t.empty.noNews}</p>
            <p className="text-[19px] leading-[1.6] text-ts text-center">
              {t.news.emptyHint}
            </p>
            <button
              onClick={refresh}
              className="ripple flex items-center gap-3 px-8 min-h-[64px] rounded-xl bg-acc
                         text-white text-[19px] font-bold hover:bg-acc/90 active:scale-95
                         transition-all duration-[var(--dur-fast)]"
            >
              <RefreshIcon />
              <span>{t.news.refresh}</span>
            </button>
          </div>
        </div>
      </div>
    );
  }

  // ─── Front page ────────────────────────────────────────────────────────
  // Lead, two seconds, and the rest as a timeline. Only the rail scrolls, so
  // a touch drag anywhere on the panel has one unambiguous meaning.

  const lead = articles[0];
  const seconds = articles.slice(1, 3);
  const rail = articles.slice(3, 3 + RAIL_LIMIT);

  return (
    <>
      <div className="flex flex-col h-full">
        {error && (
          <ConnectionBanner
            integration={t.news.banner.title}
            message={t.news.banner.degraded}
            onAction={refresh}
          />
        )}

        <div className="flex-1 min-h-0 flex gap-6 p-6">
          {/* Front page */}
          <div className="flex-1 min-w-0 flex flex-col gap-6">
            <StoryCard
              article={lead}
              unread={!isRead(lead.id)}
              variant="lead"
              onClick={handleArticleClick}
            />

            {seconds.length > 0 && (
              <div className="h-[280px] shrink-0 flex gap-6">
                {seconds.map((article) => (
                  <div key={article.id} className="flex-1 min-w-0 flex">
                    <StoryCard
                      article={article}
                      unread={!isRead(article.id)}
                      variant="second"
                      onClick={handleArticleClick}
                    />
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Timeline rail */}
          {rail.length > 0 && (
            <section
              className="w-[620px] shrink-0 flex flex-col overflow-hidden
                         rounded-2xl bg-s2 border border-bd"
            >
              <header className="shrink-0 flex items-center gap-3 px-4 py-3 border-b border-bd">
                <h2 className="text-[19px] font-bold text-tp">{t.news.headlines}</h2>
                <span
                  dir="ltr"
                  className="inline-flex items-center justify-center min-w-[38px] h-7 px-2
                             rounded-full bg-surf border border-bd font-mono tabular-nums
                             text-[15px] text-ts"
                >
                  {rail.length}
                </span>
                {/* An on-screen equivalent for pull-to-refresh, which is
                    otherwise the only way to reload and is undiscoverable.
                    (Design Guideline — Accessibility > Mobility: "Offer
                    alternatives to gestures.") */}
                <button
                  onClick={refresh}
                  aria-label={t.news.refresh}
                  className="ms-auto w-[56px] h-[56px] shrink-0 flex items-center justify-center
                             rounded-full text-tp hover:bg-surf active:scale-95
                             transition-all duration-[var(--dur-fast)]"
                >
                  <RefreshIcon />
                </button>
              </header>

              <div
                className="flex-1 overflow-y-auto p-3 flex flex-col gap-2"
                style={{ scrollbarWidth: 'thin' }}
                {...pullBind}
              >
                {isPulling && (
                  <div
                    className="shrink-0 flex items-center justify-center overflow-hidden
                               transition-all duration-[var(--dur-fast)]"
                    style={{
                      height: `${pullDistance}px`,
                      marginTop: `-${pullDistance}px`,
                      transform: `translateY(${pullDistance}px)`,
                    }}
                  >
                    <div
                      className={`w-6 h-6 border-2 border-acc border-t-transparent rounded-full
                        ${pullDistance > 24 ? 'pull-refresh-spinner' : ''}`}
                    />
                  </div>
                )}

                {rail.map((article) => (
                  <TimelineRow
                    key={article.id}
                    article={article}
                    unread={!isRead(article.id)}
                    onClick={handleArticleClick}
                  />
                ))}
              </div>
            </section>
          )}
        </div>
      </div>

      {selectedArticle && (
        <ArticleOverlay
          article={selectedArticle}
          fullArticle={fullArticle}
          fullArticleLoading={fullArticleLoading}
          onClose={handleOverlayClose}
          onRetry={handleRetryFullArticle}
        />
      )}
    </>
  );
}
