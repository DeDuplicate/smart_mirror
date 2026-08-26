'use strict';

const { Router } = require('express');
const cheerio = require('cheerio');
const router = Router();

const NEWS_CACHE_TTL_MS = 30 * 60 * 1000; // 30 minutes

// Full browser User-Agent — some feeds (Globes) 403 non-browser clients.
const BROWSER_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
  '(KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';

// Default RSS / JSON feed sources. The `news_sources` config key (array of
// source ids) filters this list; unset/empty means all sources on.
// `category` is a hint for single-topic sources (always sport/tech/finance).
const DEFAULT_SOURCES = [
  {
    id: 'ynet',
    name: 'Ynet',
    url: 'https://www.ynet.co.il/Integration/StoryRss2.xml',
    type: 'rss',
  },
  {
    id: 'now14',
    name: 'ערוץ 14',
    url: 'https://www.now14.co.il/feed/',
    type: 'rss',
  },
  {
    id: 'tgspot',
    name: 'TGSpot',
    url: 'https://www.tgspot.co.il/feed/',
    type: 'rss',
    category: 'tech',
  },
  {
    id: 'geektime',
    name: 'גיקטיים',
    url: 'https://www.geektime.co.il/feed/',
    type: 'rss',
    category: 'tech',
  },
  {
    id: 'gadgety',
    name: "גאדג'טי",
    url: 'https://www.gadgety.co.il/feed/',
    type: 'rss',
    category: 'tech',
  },
  {
    id: 'hwzone',
    name: 'HWZone',
    url: 'https://hwzone.co.il/feed/',
    type: 'rss',
    category: 'tech',
  },
  {
    id: 'one',
    name: 'ONE',
    url: 'https://www.one.co.il/rss',
    type: 'rss',
    category: 'sport',
  },
  {
    id: 'globes',
    name: 'גלובס',
    url: 'https://www.globes.co.il/webservice/rss/rssfeeder.asmx/FeederNode?iID=1725',
    type: 'rss',
    category: 'finance',
  },
  {
    id: 'themarker',
    name: 'TheMarker',
    url: 'https://www.themarker.com/srv/tm-all-articles',
    type: 'rss',
    category: 'finance',
  },
];

// Sport5 and Calcalist were investigated (user-requested sources) but have no
// working public RSS feed as of this writing: sport5.co.il's feed endpoints
// return HTTP 500 (server-side error, feed generator appears discontinued),
// and calcalist.co.il returns HTTP 403 on every RSS path even with a full
// browser User-Agent (bot-blocked at the edge). Sport1 is covered instead by
// the 'one' source above (One/Sport1 share the same network + RSS feed).

// ---------------------------------------------------------------------------
// Cache helpers
// ---------------------------------------------------------------------------
function getCached(db, key, maxAgeMs) {
  const row = db.prepare('SELECT data, fetched_at FROM cache WHERE key = ?').get(key);
  if (!row) return null;
  if (Date.now() - row.fetched_at > maxAgeMs) return null;
  try {
    return JSON.parse(row.data);
  } catch {
    return null;
  }
}

function setCache(db, key, data) {
  db.prepare(
    'INSERT OR REPLACE INTO cache (key, data, fetched_at) VALUES (?, ?, ?)'
  ).run(key, JSON.stringify(data), Date.now());
}

// ---------------------------------------------------------------------------
// Charset-aware body decoding
// ---------------------------------------------------------------------------
// fetch()'s response.text() always decodes as UTF-8, which mangles (mojibake)
// content actually served in a legacy Hebrew charset (windows-1255 /
// ISO-8859-8 are still common on Israeli news sites). Detect the real charset
// from the Content-Type header first, falling back to a <meta charset> /
// <?xml encoding?> sniff in the raw bytes, and only then decode.
function detectCharset(contentTypeHeader, rawBytes) {
  if (contentTypeHeader) {
    const m = /charset=([^;]+)/i.exec(contentTypeHeader);
    if (m) return m[1].trim().toLowerCase().replace(/["']/g, '');
  }
  // Sniff the first ~2KB as latin1 (byte-safe) to find a declared charset
  // without committing to a decoding yet.
  const head = Buffer.from(rawBytes.slice(0, 2048)).toString('latin1');
  const metaMatch =
    /<meta[^>]+charset=["']?([a-z0-9\-_]+)/i.exec(head) ||
    /<\?xml[^>]+encoding=["']([a-z0-9\-_]+)["']/i.exec(head);
  if (metaMatch) return metaMatch[1].trim().toLowerCase();
  return 'utf-8';
}

async function fetchDecodedText(url, options) {
  const response = await fetch(url, options);
  if (!response.ok) {
    const err = new Error(`HTTP ${response.status}`);
    err.status = response.status;
    throw err;
  }
  const buf = await response.arrayBuffer();
  const bytes = new Uint8Array(buf);
  let charset = detectCharset(response.headers.get('content-type'), bytes);
  // Normalize a couple of common aliases TextDecoder may not recognize as-is.
  if (charset === 'iso-8859-8-i') charset = 'iso-8859-8';
  let text;
  try {
    text = new TextDecoder(charset).decode(bytes);
  } catch {
    text = new TextDecoder('utf-8').decode(bytes);
  }
  return text;
}

// ---------------------------------------------------------------------------
// HTML entity decoding (named + numeric) — feeds/pages routinely contain
// escaped quotes/ampersands (e.g. &#034;, &quot;, &amp;) that must be
// rendered as real characters, not left as raw entity text.
// ---------------------------------------------------------------------------
const NAMED_ENTITIES = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ',
};

function decodeEntities(str) {
  if (!str) return str;
  return str
    .replace(/&#x([0-9a-fA-F]+);/g, (_, hex) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, dec) => String.fromCodePoint(parseInt(dec, 10)))
    .replace(/&([a-zA-Z]+);/g, (m, name) => NAMED_ENTITIES[name.toLowerCase()] ?? m);
}

// ---------------------------------------------------------------------------
// Minimal RSS XML parser (no external dependency)
// ---------------------------------------------------------------------------
function parseRSSItems(xml) {
  const items = [];
  const itemRegex = /<item>([\s\S]*?)<\/item>/gi;
  let match;

  while ((match = itemRegex.exec(xml)) !== null) {
    const block = match[1];
    const get = (tag) => {
      const m = block.match(
        new RegExp('<' + tag + '[^>]*>(?:<!\\[CDATA\\[)?(.*?)(?:\\]\\]>)?<\\/' + tag + '>', 's')
      );
      return m ? m[1].trim() : '';
    };

    const rawDescription = get('description');

    // Lead image: prefer standard RSS/media-namespace image tags, falling
    // back to the first <img> embedded in the description HTML, then in
    // content:encoded (WordPress feeds like now14/geektime/gadgety only
    // carry the lead image inside the full-content blob).
    let image =
      /<enclosure[^>]+url=["']([^"']+)["'][^>]*type=["']image\/[^"']*["']/i.exec(block)?.[1] ||
      /<media:content[^>]+url=["']([^"']+)["'][^>]*medium=["']image["']/i.exec(block)?.[1] ||
      /<media:content[^>]+url=["']([^"']+)["']/i.exec(block)?.[1] ||
      /<media:thumbnail[^>]+url=["']([^"']+)["']/i.exec(block)?.[1] ||
      /<img[^>]+src=["']([^"']+)["']/i.exec(rawDescription)?.[1] ||
      /<img[^>]+src=["']([^"']+)["']/i.exec(get('content:encoded'))?.[1] ||
      null;

    items.push({
      title: decodeEntities(get('title')),
      link: get('link'),
      description: decodeEntities(rawDescription.replace(/<[^>]+>/g, '')).slice(0, 300),
      pubDate: get('pubDate'),
      image,
    });
  }
  return items;
}


// ---------------------------------------------------------------------------
// GET /api/news - headlines from configured sources
// ---------------------------------------------------------------------------
// Read the `news_sources` config key (array of source ids) and filter
// DEFAULT_SOURCES to the selection. Unset/empty/invalid means ALL sources on.
// Returns the filtered list plus a stable key identifying the selection, so
// the headlines cache is only reused while it matches the current selection.
function resolveSources(db) {
  try {
    const row = db.prepare("SELECT value FROM config WHERE key = 'news_sources'").get();
    if (row) {
      const parsed = JSON.parse(row.value);
      if (Array.isArray(parsed) && parsed.length > 0) {
        // Tolerate both plain id strings and legacy {id, ...} objects.
        const ids = parsed
          .map((entry) => (typeof entry === 'string' ? entry : entry && entry.id))
          .filter(Boolean);
        const filtered = DEFAULT_SOURCES.filter((s) => ids.includes(s.id));
        if (filtered.length > 0) {
          return { sources: filtered, selectionKey: ids.slice().sort().join(',') };
        }
      }
    }
  } catch {
    // fall through to all sources
  }
  return { sources: DEFAULT_SOURCES, selectionKey: 'all' };
}

// ---------------------------------------------------------------------------
// GET /api/news/sources - catalog of available sources + current selection,
// for the Settings news-source picker (Section requires knowing both what
// exists and what's currently enabled, without duplicating DEFAULT_SOURCES
// in the frontend).
// ---------------------------------------------------------------------------
router.get('/sources', (req, res) => {
  const db = req.app.locals.db;
  let enabled = null; // null = all enabled (no selection saved yet)
  try {
    const row = db.prepare("SELECT value FROM config WHERE key = 'news_sources'").get();
    if (row) {
      const parsed = JSON.parse(row.value);
      if (Array.isArray(parsed)) {
        enabled = parsed.map((e) => (typeof e === 'string' ? e : e && e.id)).filter(Boolean);
      }
    }
  } catch {
    // treat as "all enabled"
  }
  res.json({
    sources: DEFAULT_SOURCES.map((s) => ({ id: s.id, name: s.name, category: s.category || null })),
    enabled: enabled === null ? DEFAULT_SOURCES.map((s) => s.id) : enabled,
  });
});

router.get('/', async (req, res) => {
  const db = req.app.locals.db;
  const logger = req.app.locals.logger;

  const { sources, selectionKey } = resolveSources(db);

  const cacheKey = 'news:headlines';
  const selectionCacheKey = 'news:headlines:selection';
  try {
    const cached = getCached(db, cacheKey, NEWS_CACHE_TTL_MS);
    const cachedSelection = getCached(db, selectionCacheKey, NEWS_CACHE_TTL_MS);
    if (cached && cachedSelection === selectionKey) {
      return res.json({ articles: cached, source: 'cache' });
    }
  } catch (err) {
    // A failed cache read must not reject out of this async handler (Express 4
    // does not catch that, and Node >=15 kills the process) — just log and
    // continue on to fetch fresh data.
    logger.error('News cache read error: %s', err.message);
  }

  try {
    const results = await Promise.allSettled(
      sources.map(async (src) => {
        let text;
        try {
          text = await fetchDecodedText(src.url, {
            headers: { 'User-Agent': BROWSER_UA },
          });
        } catch (fetchErr) {
          throw new Error(src.id + ': ' + fetchErr.message);
        }
        const items = parseRSSItems(text);
        return items.map((item, idx) => ({
          id: src.id + '-' + idx + '-' + Date.now(),
          source: src.name,
          sourceId: src.id,
          category: src.category || null,
          title: item.title,
          description: item.description,
          image: item.image,
          url: item.link,
          publishedAt: item.pubDate ? new Date(item.pubDate).toISOString() : null,
        }));
      })
    );

    const articles = [];
    for (const result of results) {
      if (result.status === 'fulfilled') {
        articles.push(...result.value);
      } else {
        logger.warn('News source fetch failed: %s', result.reason.message);
      }
    }

    // Sort by date descending
    articles.sort((a, b) => {
      if (!a.publishedAt) return 1;
      if (!b.publishedAt) return -1;
      return new Date(b.publishedAt) - new Date(a.publishedAt);
    });

    setCache(db, cacheKey, articles);
    setCache(db, selectionCacheKey, selectionKey);
    res.json({ articles, source: 'api' });
  } catch (err) {
    logger.error('News fetch error: %s', err.message);
    res.status(502).json({ error: 'Failed to fetch news' });
  }
});

// ---------------------------------------------------------------------------
// Full-article extraction — structural (ordered text/image blocks), noise-
// filtered (no photographer credits, comment counts, bylines, or related-
// article teasers), per explicit user request.
// ---------------------------------------------------------------------------

// Class-token prefixes of containers that never hold real article body
// content (comments, related/teaser widgets, share bars, bylines, credits) —
// removed wholesale before walking for text/image blocks. Matched per class
// *token* (prefix), not as a raw substring: substring matching removed the
// entire <body> on tgspot, whose class list contains "pcsshare-below-content".
const NOISE_CLASS_PREFIXES = [
  'comment', 'talkback', 'related', 'more-on-subject', 'moreonsubject',
  'recommend', 'tags', 'share', 'social', 'newsletter', 'byline', 'author',
  'credit', 'yarpp', // YARPP = WordPress "yet another related posts" widget
];

function isNoiseContainer(el) {
  const cls = (el.attribs && el.attribs.class) || '';
  if (!cls) return false;
  const tokens = cls.toLowerCase().split(/\s+/);
  return tokens.some((tok) => NOISE_CLASS_PREFIXES.some((p) => tok.startsWith(p)));
}

function removeNoiseContainers($) {
  $('figcaption').remove();
  $('[class]').filter((_, el) => isNoiseContainer(el)).remove();
}

// Lines that slip past the container removal above (plain text noise not
// wrapped in an identifiable widget) — dropped by pattern match instead.
const NOISE_LINE_PATTERNS = [
  /^צילום\s*:/, // photo credit, e.g. "צילום: שאטרסטוק"
  /^\d+\s*תגובות\s*\d*$/, // comment counter, e.g. "0 תגובות 0"
  /^כתבו תגובה$/, // "write a comment" prompt
  // Byline + relative timestamp, e.g. "אפרת ברינר לפני 5 דקות" — a short
  // name-only line (no sentence punctuation) ending in a relative time.
  /^[\w\u0590-\u05FF"'.]{1,20}(\s+[\w\u0590-\u05FF"'.]{1,20}){0,3}\s+לפני\s+\d+\s+(דקה|דקות|שעה|שעות|יום|ימים)\s*$/,
];

function isNoiseLine(line) {
  return NOISE_LINE_PATTERNS.some((re) => re.test(line));
}

// Candidate selectors for the main article-body container, ordered from most
// to least specific. Different sites use different CMSs (custom SSR,
// WordPress, Next.js CSS modules with hashed class suffixes) so we match on
// class *substrings* rather than exact names.
const ARTICLE_CONTAINER_SELECTORS = [
  '[class*="articleContent" i]', '[class*="article-content" i]',
  '[class*="articleBody" i]', '[class*="article-body" i]',
  '[class*="entry-content" i]', '[class*="post-content" i]',
  '[class*="ssr-body" i]', // ONE (one.co.il) article body wrapper
  'article',
];

function findArticleContainer($) {
  for (const selector of ARTICLE_CONTAINER_SELECTORS) {
    const el = $(selector).first();
    if (el.length && el.text().trim().length > 200) return el;
  }
  return null;
}

// Try the JSON-LD NewsArticle schema first — when a site includes
// `articleBody`, it's already clean plain text with zero bylines/credits/
// comment widgets (verified live on Ynet), which is more reliable than any
// HTML-scraping heuristic.
function extractJsonLdArticle($) {
  let result = null;
  $('script[type="application/ld+json"]').each((_, el) => {
    if (result) return;
    let data;
    try {
      data = JSON.parse($(el).contents().text());
    } catch {
      return;
    }
    const candidates = Array.isArray(data?.['@graph']) ? data['@graph'] : [data];
    const article = candidates.find((c) => {
      const type = c?.['@type'];
      return type === 'NewsArticle' || (Array.isArray(type) && type.includes('NewsArticle'));
    });
    if (article?.articleBody) {
      const img = Array.isArray(article.image)
        ? article.image[0]?.url || article.image[0]
        : article.image?.url || article.image;
      result = { text: article.articleBody, image: img || null };
    }
  });
  return result;
}

// DOM-walk fallback for sites without a usable JSON-LD articleBody: extract
// ordered {type: 'text'|'image', ...} blocks from the article container so
// in-body photos can be rendered at their original position (not just a
// single hero image), while dropping noise lines/containers.
function isIconSrc(src) {
  // data-URI placeholders (lazy-loaders), svg icons, Next.js static chrome
  if (src.startsWith('data:') || /\.svg(\?|$)/i.test(src) || src.includes('/_next/static/')) return true;
  // WordPress's "thumbnail" image size (commonly named -150x150 in the
  // filename) is used for related-post/widget cards, never for full-width
  // in-article photos — treat as noise rather than a real content image.
  const dims = /-(\d+)x(\d+)\.\w+(?:\?|$)/.exec(src);
  if (dims && Number(dims[1]) <= 200 && Number(dims[2]) <= 200) return true;
  return false;
}

function extractDomBlocks($, container, baseUrl) {
  const blocks = [];
  const seenImageSrc = new Set();

  container.find('p, img').each((_, el) => {
    const $el = $(el);
    const tag = el.tagName?.toLowerCase();

    if (tag === 'img') {
      // Prefer lazy-load attributes over src — lazy-loaders put a data-URI
      // placeholder in src and the real photo in data-src/data-lazy-src.
      let src = $el.attr('data-src') || $el.attr('data-lazy-src') || $el.attr('src');
      // Skip UI chrome (gallery nav/maximize/counter icons served as <img>,
      // e.g. Next.js /_next/static/media/*.svg) — only real photos wanted.
      if (!src || isIconSrc(src)) return;
      // Resolve relative/protocol-relative URLs against the article URL so
      // the frontend can load them directly.
      try {
        src = new URL(src, baseUrl).href;
      } catch {
        return;
      }
      if (seenImageSrc.has(src)) return;
      seenImageSrc.add(src);
      // Caption: alt text only, kept separate from body text — photo credits
      // and other noise lines are never emitted as captions.
      let caption = decodeEntities($el.attr('alt') || '').replace(/\s+/g, ' ').trim();
      if (!caption || isNoiseLine(caption)) caption = null;
      blocks.push({ type: 'image', src, caption });
      return;
    }

    const text = decodeEntities($el.text()).replace(/\s+/g, ' ').trim();
    if (!text || isNoiseLine(text)) return;
    blocks.push({ type: 'text', value: text });
  });

  return blocks;
}

async function extractArticle(url) {
  const html = await fetchDecodedText(url, {
    headers: {
      'User-Agent': BROWSER_UA,
      Accept: 'text/html',
    },
  });

  const $ = cheerio.load(html);

  // Extract JSON-LD before stripping <script> tags (it lives in one).
  const jsonLd = extractJsonLdArticle($);
  const metaImage =
    $('meta[property="og:image"]').attr('content') ||
    $('meta[name="twitter:image"]').attr('content') ||
    null;
  const image = jsonLd?.image || metaImage || null;

  $('script, style, nav, header, footer, iframe, noscript').remove();

  // DOM walk: ordered text/image blocks with in-body photos at their
  // original position.
  removeNoiseContainers($);
  const container = findArticleContainer($);
  const domBlocks = container ? extractDomBlocks($, container, url) : [];

  // Prefer the DOM walk when it yields real article text (keeps in-body
  // images interleaved). JSON-LD articleBody wins only when the DOM walk
  // found no usable paragraphs — e.g. Ynet, where the body is client-side
  // rendered and the DOM walk sees nothing but the hero image.
  const domTextBlocks = domBlocks.filter((b) => b.type === 'text').length;
  if (jsonLd?.text && domTextBlocks < 2) {
    const blocks = jsonLd.text
      .split(/\n+/)
      .map((line) => decodeEntities(line).replace(/\s+/g, ' ').trim())
      .filter((line) => line && !isNoiseLine(line))
      .map((line) => ({ type: 'text', value: line }));
    return {
      image,
      blocks: blocks.length ? blocks : [{ type: 'text', value: jsonLd.text }],
      content: jsonLd.text.slice(0, 5000),
    };
  }

  const blocks = domBlocks;

  const content = blocks
    .filter((b) => b.type === 'text')
    .map((b) => b.value)
    .join(' ')
    .slice(0, 5000);

  return { image, blocks, content };
}

// ---------------------------------------------------------------------------
// GET /api/news/:id/full - full article text (readability extraction)
// ---------------------------------------------------------------------------
router.get('/:id/full', async (req, res) => {
  const db = req.app.locals.db;
  const logger = req.app.locals.logger;

  const articleId = req.params.id;
  const articleCacheKey = 'news:article:' + articleId;

  // Check cache
  const cached = getCached(db, articleCacheKey, NEWS_CACHE_TTL_MS);
  if (cached) {
    return res.json({ article: cached, source: 'cache' });
  }

  // Try to find the article URL from the headlines cache
  const headlinesRow = db.prepare("SELECT data FROM cache WHERE key = 'news:headlines'").get();
  if (!headlinesRow) {
    return res.status(404).json({ error: 'Article not found - headlines not cached' });
  }

  let articles;
  try {
    articles = JSON.parse(headlinesRow.data);
  } catch {
    return res.status(500).json({ error: 'Failed to parse cached headlines' });
  }

  const article = articles.find((a) => a.id === articleId);
  if (!article || !article.url) {
    return res.status(404).json({ error: 'Article not found' });
  }

  try {
    const { image, blocks, content } = await extractArticle(article.url);

    const fullArticle = {
      ...article,
      image: image || article.image || null,
      blocks,
      content,
      extractedAt: Date.now(),
    };

    setCache(db, articleCacheKey, fullArticle);
    res.json({ article: fullArticle, source: 'api' });
  } catch (err) {
    logger.error('Article extraction error: %s', err.message);
    res.status(502).json({ error: 'Failed to extract article content' });
  }
});

module.exports = router;
// Exported for isolated testing (feed parsing / extraction verification).
module.exports.parseRSSItems = parseRSSItems;
module.exports.extractArticle = extractArticle;
module.exports.DEFAULT_SOURCES = DEFAULT_SOURCES;
module.exports.resolveSources = resolveSources;
