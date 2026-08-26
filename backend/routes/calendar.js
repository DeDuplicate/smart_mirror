'use strict';

const { Router } = require('express');
const router = Router();

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

  // Check cache (5 min). A throw here would reject out of this async handler,
  // which Express 4 does not catch and Node >=15 treats as fatal — degrade to
  // a cache miss instead.
  let cached = null;
  try {
    cached = getCached(db, cacheKey, 5 * 60 * 1000);
  } catch (err) {
    logger.error('ICS cache read error: %s', err.message);
  }

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

// ---------------------------------------------------------------------------
// Local editable events (SQLite)
// ---------------------------------------------------------------------------

const VALID_COLORS = new Set(['mint', 'lav', 'coral', 'gold']);

function normalizeColor(value) {
  if (value === 'lavender') return 'lav';
  return VALID_COLORS.has(value) ? value : 'mint';
}

function rowToLocalEvent(row) {
  return {
    id: row.id,
    title: row.title,
    summary: row.title,
    description: row.description || '',
    location: row.location || '',
    start: row.start,
    end: row.end,
    allDay: row.all_day === 1,
    calendar: 'local',
    color: normalizeColor(row.color),
    source: 'local',
  };
}

function parseEventInstant(value, allDay, endOfDay) {
  const raw = String(value || '');
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
    return new Date(`${raw}T${endOfDay ? '23:59:59' : '00:00:00'}`);
  }
  const d = new Date(raw);
  return Number.isNaN(d.getTime()) ? null : d;
}

function eventOverlapsRange(ev, rangeStart, rangeEnd) {
  const start = parseEventInstant(ev.start, ev.allDay, false);
  let end = parseEventInstant(ev.end || ev.start, ev.allDay, true);
  if (!start) return false;
  if (!end || end < start) {
    end = new Date(start);
    if (ev.allDay) end.setDate(end.getDate() + 1);
    else end.setHours(end.getHours() + 1);
  }
  return end >= rangeStart && start <= rangeEnd;
}

function validateEventBody(body, { partial = false } = {}) {
  const out = {};

  if (body.title !== undefined || !partial) {
    const title = String(body.title || '').trim();
    if (!title) return { error: 'Title is required' };
    out.title = title;
  }
  if (body.description !== undefined || !partial) {
    out.description = String(body.description || '');
  }
  if (body.location !== undefined || !partial) {
    out.location = String(body.location || '');
  }
  if (body.color !== undefined || !partial) {
    out.color = normalizeColor(body.color);
  }
  if (body.allDay !== undefined || body.all_day !== undefined || !partial) {
    out.allDay = !!(body.allDay ?? body.all_day);
  }
  if (body.start !== undefined || !partial) {
    const start = String(body.start || '').trim();
    if (!start) return { error: 'Start is required' };
    out.start = start;
  }
  if (body.end !== undefined || !partial) {
    out.end = String(body.end || body.start || '').trim();
  }

  return { value: out };
}

function emitCalendarUpdated(req) {
  const io = req.app.locals.io;
  if (io) io.emit('calendar:updated');
}

// GET /api/calendar/events?start=&end=
router.get('/events', (req, res) => {
  const db = req.app.locals.db;
  const logger = req.app.locals.logger;

  try {
    const rangeStart = req.query.start ? new Date(req.query.start) : new Date(0);
    const rangeEnd = req.query.end
      ? new Date(req.query.end)
      : new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
    if (Number.isNaN(rangeStart.getTime()) || Number.isNaN(rangeEnd.getTime())) {
      return res.status(400).json({ error: 'Invalid start or end' });
    }

    const rows = db.prepare('SELECT * FROM calendar_events').all();
    const events = rows
      .map(rowToLocalEvent)
      .filter((ev) => eventOverlapsRange(ev, rangeStart, rangeEnd))
      .sort((a, b) => new Date(a.start) - new Date(b.start));

    res.json({ events, source: 'local' });
  } catch (err) {
    logger.error('Local calendar fetch error: %s', err.message);
    res.status(500).json({ error: 'Failed to fetch local calendar events' });
  }
});

// POST /api/calendar/events
router.post('/events', (req, res) => {
  const db = req.app.locals.db;
  const logger = req.app.locals.logger;
  const parsed = validateEventBody(req.body || {});
  if (parsed.error) return res.status(400).json({ error: parsed.error });

  try {
    const id = `ev_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const ev = parsed.value;
    db.prepare(
      `INSERT INTO calendar_events
         (id, title, description, location, start, end, all_day, color)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      id,
      ev.title,
      ev.description,
      ev.location,
      ev.start,
      ev.end || ev.start,
      ev.allDay ? 1 : 0,
      ev.color
    );

    const row = db.prepare('SELECT * FROM calendar_events WHERE id = ?').get(id);
    logger.info('Calendar event created: %s', id);
    emitCalendarUpdated(req);
    res.status(201).json(rowToLocalEvent(row));
  } catch (err) {
    logger.error('Calendar event create error: %s', err.message);
    res.status(500).json({ error: 'Failed to create event' });
  }
});

// PATCH /api/calendar/events/:id
router.patch('/events/:id', (req, res) => {
  const db = req.app.locals.db;
  const logger = req.app.locals.logger;
  const id = req.params.id;

  const existing = db.prepare('SELECT * FROM calendar_events WHERE id = ?').get(id);
  if (!existing) return res.status(404).json({ error: 'Event not found' });

  const parsed = validateEventBody(req.body || {}, { partial: true });
  if (parsed.error) return res.status(400).json({ error: parsed.error });

  try {
    const next = {
      title: parsed.value.title !== undefined ? parsed.value.title : existing.title,
      description:
        parsed.value.description !== undefined ? parsed.value.description : existing.description,
      location: parsed.value.location !== undefined ? parsed.value.location : existing.location,
      start: parsed.value.start !== undefined ? parsed.value.start : existing.start,
      end: parsed.value.end !== undefined ? parsed.value.end : existing.end,
      allDay:
        parsed.value.allDay !== undefined ? parsed.value.allDay : existing.all_day === 1,
      color: parsed.value.color !== undefined ? parsed.value.color : existing.color,
    };

    db.prepare(
      `UPDATE calendar_events
          SET title = ?, description = ?, location = ?, start = ?, end = ?,
              all_day = ?, color = ?, updated_at = datetime('now')
        WHERE id = ?`
    ).run(
      next.title,
      next.description,
      next.location,
      next.start,
      next.end || next.start,
      next.allDay ? 1 : 0,
      next.color,
      id
    );

    const row = db.prepare('SELECT * FROM calendar_events WHERE id = ?').get(id);
    logger.info('Calendar event updated: %s', id);
    emitCalendarUpdated(req);
    res.json(rowToLocalEvent(row));
  } catch (err) {
    logger.error('Calendar event update error: %s', err.message);
    res.status(500).json({ error: 'Failed to update event' });
  }
});

// DELETE /api/calendar/events/:id
router.delete('/events/:id', (req, res) => {
  const db = req.app.locals.db;
  const logger = req.app.locals.logger;
  const id = req.params.id;

  try {
    const result = db.prepare('DELETE FROM calendar_events WHERE id = ?').run(id);
    if (result.changes === 0) return res.status(404).json({ error: 'Event not found' });
    logger.info('Calendar event deleted: %s', id);
    emitCalendarUpdated(req);
    res.json({ ok: true });
  } catch (err) {
    logger.error('Calendar event delete error: %s', err.message);
    res.status(500).json({ error: 'Failed to delete event' });
  }
});

module.exports = router;
