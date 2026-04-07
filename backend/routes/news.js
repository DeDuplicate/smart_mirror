'use strict';

const { Router } = require('express');
const router = Router();

const NEWS_CACHE_TTL_MS = 30 * 60 * 1000; // 30 minutes

// Default RSS / JSON feed sources (can be overridden via settings)
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
];

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

    items.push({
      title: get('title'),
      link: get('link'),
      description: get('description').replace(/<[^>]+>/g, '').slice(0, 300),
      pubDate: get('pubDate'),
    });
  }
  return items;
}

// ---------------------------------------------------------------------------
// GET /api/news - headlines from configured sources
// ---------------------------------------------------------------------------
router.get('/', async (req, res) => {
  const db = req.app.locals.db;
  const logger = req.app.locals.logger;

  const cacheKey = 'news:headlines';
  const cached = getCached(db, cacheKey, NEWS_CACHE_TTL_MS);
  if (cached) {
    return res.json({ articles: cached, source: 'cache' });
  }

  // Determine sources from settings or use defaults
  let sources = DEFAULT_SOURCES;
  try {
    const row = db.prepare("SELECT value FROM config WHERE key = 'news_sources'").get();
    if (row) {
      sources = JSON.parse(row.value);
    }
  } catch {
    // use defaults
  }

  try {
    const results = await Promise.allSettled(
      sources.map(async (src) => {
        const response = await fetch(src.url, {
          headers: { 'User-Agent': 'SmartMirror/1.0' },
        });
        if (!response.ok) {
          throw new Error(src.id + ': ' + response.status);
        }
        const text = await response.text();
        const items = parseRSSItems(text);
        return items.map((item, idx) => ({
          id: src.id + '-' + idx + '-' + Date.now(),
          source: src.name,
          sourceId: src.id,
          title: item.title,
          description: item.description,
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
    res.json({ articles, source: 'api' });
  } catch (err) {
    logger.error('News fetch error: %s', err.message);
    res.status(502).json({ error: 'Failed to fetch news' });
  }
});

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
    const response = await fetch(article.url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; SmartMirror/1.0)',
        Accept: 'text/html',
      },
    });

    if (!response.ok) {
      throw new Error('Article fetch ' + response.status);
    }

    const html = await response.text();

    // Simple readability extraction: find the largest text block
    // Strip scripts, styles, nav, header, footer
    let text = html
      .replace(/<script[\s\S]*?<\/script>/gi, '')
      .replace(/<style[\s\S]*?<\/style>/gi, '')
      .replace(/<nav[\s\S]*?<\/nav>/gi, '')
      .replace(/<header[\s\S]*?<\/header>/gi, '')
      .replace(/<footer[\s\S]*?<\/footer>/gi, '');

    // Try to extract from <article> tag first
    const articleMatch = text.match(/<article[\s\S]*?>([\s\S]*?)<\/article>/i);
    if (articleMatch) {
      text = articleMatch[1];
    }

    // Strip remaining tags and clean up whitespace
    text = text
      .replace(/<[^>]+>/g, ' ')
      .replace(/&nbsp;/g, ' ')
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'")
      .replace(/\s+/g, ' ')
      .trim();

    // Take a reasonable chunk (first ~5000 chars)
    const content = text.slice(0, 5000);

    const fullArticle = {
      ...article,
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
