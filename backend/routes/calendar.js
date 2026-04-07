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
// ICS parsing helpers
// ---------------------------------------------------------------------------

/** Unfold ICS lines (lines starting with space/tab are continuations). */
function unfoldIcs(raw) {
  return raw.replace(/\r\n[ \t]/g, '').replace(/\r\n/g, '\n').replace(/\r/g, '\n');
}

/** Extract VEVENT blocks from ICS text. */
function extractVEvents(icsText) {
  const unfolded = unfoldIcs(icsText);
  const events = [];
  const blocks = unfolded.split('BEGIN:VEVENT');
  for (let i = 1; i < blocks.length; i++) {
    const endIdx = blocks[i].indexOf('END:VEVENT');
    if (endIdx === -1) continue;
    events.push(blocks[i].substring(0, endIdx));
  }
  return events;
}

/** Get a property value from a VEVENT block. Handles params like DTSTART;VALUE=DATE:20250101 */
function getProp(block, name) {
  const lines = block.split('\n');
  for (const line of lines) {
    // Match NAME:value or NAME;params:value
    if (line.startsWith(name + ':') || line.startsWith(name + ';')) {
      const colonIdx = line.indexOf(':');
      if (colonIdx === -1) continue;
      return line.substring(colonIdx + 1).trim();
    }
  }
  return null;
}

/** Get the raw line for a property (including params). */
function getPropLine(block, name) {
  const lines = block.split('\n');
  for (const line of lines) {
    if (line.startsWith(name + ':') || line.startsWith(name + ';')) {
      return line.trim();
    }
  }
  return null;
}

/**
 * Parse an ICS date/datetime string.
 * Formats: 20250101 (date), 20250101T120000 (local), 20250101T120000Z (UTC)
 */
function parseIcsDate(val) {
  if (!val) return null;
  // Strip TZID prefix if present (we treat as local)
  const clean = val.replace(/^TZID=[^:]*:/, '');
  if (clean.length === 8) {
    // All-day date: YYYYMMDD
    const y = clean.substring(0, 4);
    const m = clean.substring(4, 6);
    const d = clean.substring(6, 8);
    return { date: `${y}-${m}-${d}`, allDay: true };
  }
  // Datetime: YYYYMMDDTHHMMSS or YYYYMMDDTHHMMSSZ
  const y = clean.substring(0, 4);
  const mo = clean.substring(4, 6);
  const d = clean.substring(6, 8);
  const h = clean.substring(9, 11);
  const mi = clean.substring(11, 13);
  const s = clean.substring(13, 15);
  const isUtc = clean.endsWith('Z');
  const iso = `${y}-${mo}-${d}T${h}:${mi}:${s}${isUtc ? 'Z' : ''}`;
  return { date: iso, allDay: false };
}

/** Unescape ICS text values. */
function unescapeIcs(val) {
  if (!val) return '';
  return val
    .replace(/\\n/gi, '\n')
    .replace(/\\,/g, ',')
    .replace(/\\;/g, ';')
    .replace(/\\\\/g, '\\');
}

/**
 * Simple RRULE expansion for DAILY, WEEKLY, MONTHLY, YEARLY.
 * Expands occurrences of a base event within [rangeStart, rangeEnd].
 * Returns an array of { start, end } date pairs.
 */
function expandRRule(rruleLine, baseStart, baseEnd, rangeStart, rangeEnd) {
  if (!rruleLine) return [];

  const props = {};
  rruleLine.split(';').forEach((part) => {
    const [k, v] = part.split('=');
    if (k && v) props[k.toUpperCase()] = v;
  });

  const freq = props.FREQ;
  if (!freq) return [];

  const count = props.COUNT ? parseInt(props.COUNT, 10) : null;
  const until = props.UNTIL ? parseIcsDate(props.UNTIL) : null;
  const interval = props.INTERVAL ? parseInt(props.INTERVAL, 10) : 1;
  const byDay = props.BYDAY ? props.BYDAY.split(',') : null;

  const maxOccurrences = count || 365; // safety limit
  const untilDate = until ? new Date(until.date) : new Date(rangeEnd);
  if (untilDate > new Date(rangeEnd)) untilDate.setTime(new Date(rangeEnd).getTime());

  const rangeStartDate = new Date(rangeStart);
  const rangeEndDate = new Date(rangeEnd);

  const bStart = new Date(baseStart);
  const bEnd = new Date(baseEnd);
  const duration = bEnd.getTime() - bStart.getTime();

  const results = [];
  const DAY_MAP = { SU: 0, MO: 1, TU: 2, WE: 3, TH: 4, FR: 5, SA: 6 };

  let current = new Date(bStart);
  let occCount = 0;

  for (let safety = 0; safety < 3650 && occCount < maxOccurrences; safety++) {
    if (current > untilDate) break;

    let include = true;

    // BYDAY filtering for WEEKLY
    if (freq === 'WEEKLY' && byDay) {
      const dayAbbr = Object.keys(DAY_MAP).find((k) => DAY_MAP[k] === current.getDay());
      if (!byDay.includes(dayAbbr)) include = false;
    }

    if (include) {
      const occStart = new Date(current);
      const occEnd = new Date(current.getTime() + duration);

      // Check if occurrence overlaps with range
      if (occEnd >= rangeStartDate && occStart <= rangeEndDate) {
        results.push({
          start: occStart.toISOString(),
          end: occEnd.toISOString(),
        });
      }
      occCount++;
    }

    // Advance to next occurrence
    if (freq === 'DAILY') {
      current.setDate(current.getDate() + (byDay ? 1 : interval));
    } else if (freq === 'WEEKLY') {
      if (byDay) {
        // Move day by day to check BYDAY
        current.setDate(current.getDate() + 1);
      } else {
        current.setDate(current.getDate() + 7 * interval);
      }
    } else if (freq === 'MONTHLY') {
      current.setMonth(current.getMonth() + interval);
    } else if (freq === 'YEARLY') {
      current.setFullYear(current.getFullYear() + interval);
    } else {
      break; // unsupported frequency
    }
  }

  return results;
}

/**
 * Parse a full ICS feed and return normalized event objects.
 * @param {string} icsText  Raw ICS content
 * @param {string} calName  Calendar display name
 * @param {string} color    Calendar color key
 * @param {string} rangeStart  ISO date range start
 * @param {string} rangeEnd    ISO date range end
 */
function parseIcsFeed(icsText, calName, color, rangeStart, rangeEnd) {
  const vevents = extractVEvents(icsText);
  const events = [];

  for (const block of vevents) {
    const uid = getProp(block, 'UID') || `ics-${Date.now()}-${Math.random()}`;
    const summary = unescapeIcs(getProp(block, 'SUMMARY')) || '(No title)';
    const description = unescapeIcs(getProp(block, 'DESCRIPTION')) || '';
    const location = unescapeIcs(getProp(block, 'LOCATION')) || '';

    const dtStartLine = getPropLine(block, 'DTSTART');
    const dtEndLine = getPropLine(block, 'DTEND');
    const rruleProp = getProp(block, 'RRULE');

    // Parse the value after the last colon
    const dtStartVal = dtStartLine ? dtStartLine.substring(dtStartLine.indexOf(':') + 1).trim() : null;
    const dtEndVal = dtEndLine ? dtEndLine.substring(dtEndLine.indexOf(':') + 1).trim() : null;

    const parsedStart = parseIcsDate(dtStartVal);
    if (!parsedStart) continue; // skip events without a start date

    const parsedEnd = dtEndVal ? parseIcsDate(dtEndVal) : parsedStart;
    const allDay = parsedStart.allDay;

    if (rruleProp) {
      // Expand recurring events
      const occurrences = expandRRule(
        rruleProp,
        parsedStart.date,
        parsedEnd.date,
        rangeStart,
        rangeEnd
      );
      for (let i = 0; i < occurrences.length; i++) {
        events.push({
          id: `${uid}_${i}`,
          title: summary,
          summary,
          description,
          location,
          start: allDay ? occurrences[i].start.split('T')[0] : occurrences[i].start,
          end: allDay ? occurrences[i].end.split('T')[0] : occurrences[i].end,
          allDay,
          calendar: calName,
          color,
          source: 'ics',
        });
      }
    } else {
      // Single event — check if it falls within range
      const evStart = new Date(parsedStart.date);
      const evEnd = new Date(parsedEnd.date);
      const rStart = new Date(rangeStart);
      const rEnd = new Date(rangeEnd);

      if (evEnd >= rStart && evStart <= rEnd) {
        events.push({
          id: uid,
          title: summary,
          summary,
          description,
          location,
          start: parsedStart.date,
          end: parsedEnd.date,
          allDay,
          calendar: calName,
          color,
          source: 'ics',
        });
      }
    }
  }

  return events;
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

// ---------------------------------------------------------------------------
// GET /api/calendar/ics?start=&end=
// Fetches configured ICS URLs, parses events, returns merged list
// ---------------------------------------------------------------------------
router.get('/ics', async (req, res) => {
  const db = req.app.locals.db;
  const logger = req.app.locals.logger;

  const start = req.query.start || new Date().toISOString().split('T')[0];
  const end =
    req.query.end ||
    new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];

  // Read ICS URLs from settings
  let icsUrls = [];
  try {
    const row = db.prepare("SELECT value FROM config WHERE key = 'calendarIcsUrls'").get();
    if (row) {
      icsUrls = JSON.parse(row.value);
    }
  } catch (err) {
    logger.warn('Failed to read calendarIcsUrls setting: %s', err.message);
  }

  if (!Array.isArray(icsUrls) || icsUrls.length === 0) {
    return res.json({ events: [], source: 'ics', message: 'No ICS calendars configured' });
  }

  const cacheKey = `ics:${start}:${end}`;

  // Check cache (5 min)
  const cached = getCached(db, cacheKey, 5 * 60 * 1000);
  if (cached) {
    // Background revalidation
    fetchAllIcsEvents(logger, icsUrls, start, end)
      .then((events) => setCache(db, cacheKey, events))
      .catch((err) => logger.error('ICS background revalidation failed: %s', err.message));
    return res.json({ events: cached, source: 'ics-cache' });
  }

  // No cache — fetch synchronously
  try {
    const events = await fetchAllIcsEvents(logger, icsUrls, start, end);
    setCache(db, cacheKey, events);
    res.json({ events, source: 'ics' });
  } catch (err) {
    logger.error('ICS fetch error: %s', err.message);
    res.status(502).json({ error: 'Failed to fetch ICS calendar events' });
  }
});

/**
 * Fetch and parse all configured ICS feeds, merge into a sorted event list.
 */
async function fetchAllIcsEvents(logger, icsUrls, start, end) {
  const results = await Promise.allSettled(
    icsUrls.map(async (cal) => {
      const response = await fetch(cal.url, {
        headers: { 'User-Agent': 'SmartMirror/1.0' },
        signal: AbortSignal.timeout(15000),
      });
      if (!response.ok) {
        throw new Error(`ICS fetch ${cal.name} HTTP ${response.status}`);
      }
      const text = await response.text();
      return parseIcsFeed(text, cal.name || 'Calendar', cal.color || 'mint', start, end);
    })
  );

  const merged = [];
  for (const result of results) {
    if (result.status === 'fulfilled') {
      merged.push(...result.value);
    } else {
      logger.warn('ICS feed fetch failed: %s', result.reason.message);
    }
  }

  // Sort by start time
  merged.sort((a, b) => new Date(a.start) - new Date(b.start));
  return merged;
}

module.exports = router;
