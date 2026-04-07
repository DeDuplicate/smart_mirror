'use strict';

const { Router } = require('express');
const router = Router();

const { getValidGoogleToken, getAccountsByProvider } = require('./auth');

const GOOGLE_CALENDAR_API = 'https://www.googleapis.com/calendar/v3';

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
// GET /api/calendar/events?start=&end=
// ---------------------------------------------------------------------------
router.get('/events', async (req, res) => {
  const db = req.app.locals.db;
  const logger = req.app.locals.logger;

  const start = req.query.start || new Date().toISOString();
  const end =
    req.query.end ||
    new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();

  const cacheKey = `calendar:${start}:${end}`;

  // Stale-while-revalidate: return cached if available (max 5 min)
  const cached = getCached(db, cacheKey, 5 * 60 * 1000);

  // Get linked Google accounts
  const accounts = getAccountsByProvider(db, 'google');
  if (accounts.length === 0 && !cached) {
    return res.json({ events: [], source: 'none', message: 'No Google accounts linked' });
  }

  // If we have a cache hit, return it immediately and revalidate in the background
  if (cached) {
    // Fire off background revalidation (don't await)
    revalidateCalendar(db, logger, accounts, start, end, cacheKey).catch((err) =>
      logger.error('Background calendar revalidation failed: %s', err.message)
    );
    return res.json({ events: cached, source: 'cache' });
  }

  // No cache — fetch synchronously
  try {
    const events = await fetchAllCalendarEvents(db, logger, accounts, start, end);
    setCache(db, cacheKey, events);
    res.json({ events, source: 'api' });
  } catch (err) {
    logger.error('Calendar fetch error: %s', err.message);
    res.status(502).json({ error: 'Failed to fetch calendar events' });
  }
});

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------
async function fetchEventsForAccount(db, logger, email, start, end) {
  const token = await getValidGoogleToken(db, email, logger);

  const params = new URLSearchParams({
    timeMin: start,
    timeMax: end,
    singleEvents: 'true',
    orderBy: 'startTime',
    maxResults: '250',
  });

  const url = `${GOOGLE_CALENDAR_API}/calendars/primary/events?${params}`;
  const response = await fetch(url, {
    headers: { Authorization: `Bearer ${token}` },
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Google Calendar API (${email}) ${response.status}: ${text}`);
  }

  const data = await response.json();
  return (data.items || []).map((item) => ({
    id: item.id,
    summary: item.summary || '(No title)',
    description: item.description || '',
    location: item.location || '',
    start: item.start?.dateTime || item.start?.date,
    end: item.end?.dateTime || item.end?.date,
    allDay: !!item.start?.date,
    account: email,
    htmlLink: item.htmlLink,
    status: item.status,
    colorId: item.colorId,
  }));
}

async function fetchAllCalendarEvents(db, logger, accounts, start, end) {
  const results = await Promise.allSettled(
    accounts.map((acct) => fetchEventsForAccount(db, logger, acct.email, start, end))
  );

  const merged = [];
  for (const result of results) {
    if (result.status === 'fulfilled') {
      merged.push(...result.value);
    } else {
      logger.warn('Calendar fetch for an account failed: %s', result.reason.message);
    }
  }

  // Sort by start time
  merged.sort((a, b) => new Date(a.start) - new Date(b.start));
  return merged;
}

async function revalidateCalendar(db, logger, accounts, start, end, cacheKey) {
  const events = await fetchAllCalendarEvents(db, logger, accounts, start, end);
  setCache(db, cacheKey, events);
  logger.debug('Calendar cache revalidated for key %s', cacheKey);
}

module.exports = router;
