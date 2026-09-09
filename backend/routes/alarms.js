'use strict';

const express = require('express');
const crypto = require('crypto');
const router = express.Router();

// ---------------------------------------------------------------------------
// Alarm clock. The backend owns the schedule (authoritative clock, survives
// frontend reloads); the kiosk frontend owns playback — when an alarm fires,
// every connected client gets 'alarm:trigger' over socket.io and the mirror
// casts the chosen song/playlist to the chosen speakers (see AlarmOverlay).
// ---------------------------------------------------------------------------

const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

function rowToAlarm(row) {
  return {
    ...row,
    enabled: Boolean(row.enabled),
    days: JSON.parse(row.days || '[]'),
    speakers: JSON.parse(row.speakers || '[]'),
  };
}

function validAlarm(body) {
  const errors = [];
  if (!TIME_RE.test(String(body.time || ''))) errors.push('time must be HH:MM');
  if (!Array.isArray(body.days) || body.days.some((d) => !Number.isInteger(d) || d < 0 || d > 6)) {
    errors.push('days must be an array of 0-6');
  }
  if (!Array.isArray(body.speakers) || !body.speakers.length) errors.push('pick at least one speaker');
  if (!['track', 'playlist'].includes(body.media_type)) errors.push('media_type must be track|playlist');
  if (!body.media_id || typeof body.media_id !== 'string') errors.push('media_id required');
  if (body.volume != null && (!Number.isInteger(body.volume) || body.volume < 0 || body.volume > 100)) {
    errors.push('volume must be 0-100');
  }
  return errors;
}

router.get('/', (req, res) => {
  const rows = req.app.locals.db
    .prepare('SELECT * FROM alarms ORDER BY time ASC')
    .all();
  res.json({ alarms: rows.map(rowToAlarm) });
});

router.post('/', (req, res) => {
  const errors = validAlarm(req.body || {});
  if (errors.length) return res.status(400).json({ error: 'invalid_alarm', message: errors.join('; ') });

  const b = req.body;
  const id = crypto.randomUUID();
  req.app.locals.db.prepare(`
    INSERT INTO alarms (id, label, time, days, enabled, speakers, media_type, media_id, media_title, media_artist, media_image, volume)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id,
    String(b.label || ''),
    b.time,
    JSON.stringify(b.days),
    b.enabled === false ? 0 : 1,
    JSON.stringify(b.speakers),
    b.media_type,
    b.media_id,
    String(b.media_title || ''),
    String(b.media_artist || ''),
    String(b.media_image || ''),
    b.volume == null ? null : b.volume
  );
  req.app.locals.io?.emit('alarms:changed');
  res.status(201).json({ id });
});

router.put('/:id', (req, res) => {
  const db = req.app.locals.db;
  const existing = db.prepare('SELECT id FROM alarms WHERE id = ?').get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'not_found' });

  const errors = validAlarm(req.body || {});
  if (errors.length) return res.status(400).json({ error: 'invalid_alarm', message: errors.join('; ') });

  const b = req.body;
  db.prepare(`
    UPDATE alarms SET label = ?, time = ?, days = ?, enabled = ?, speakers = ?,
      media_type = ?, media_id = ?, media_title = ?, media_artist = ?, media_image = ?, volume = ?,
      last_fired = NULL
    WHERE id = ?
  `).run(
    String(b.label || ''),
    b.time,
    JSON.stringify(b.days),
    b.enabled === false ? 0 : 1,
    JSON.stringify(b.speakers),
    b.media_type,
    b.media_id,
    String(b.media_title || ''),
    String(b.media_artist || ''),
    String(b.media_image || ''),
    b.volume == null ? null : b.volume,
    req.params.id
  );
  req.app.locals.io?.emit('alarms:changed');
  res.json({ ok: true });
});

router.delete('/:id', (req, res) => {
  req.app.locals.db.prepare('DELETE FROM alarms WHERE id = ?').run(req.params.id);
  req.app.locals.io?.emit('alarms:changed');
  res.json({ ok: true });
});

// ---------------------------------------------------------------------------
// Scheduler. Checks every 15s; fires an alarm when the local HH:MM matches,
// the day is selected (empty days = every day), and it has not fired this
// minute. last_fired also makes a missed-then-late start (reboot) not fire
// stale alarms: we only fire on an exact current-minute match.
// ---------------------------------------------------------------------------
function startScheduler(io, db, logger) {
  const enabled = db.prepare('SELECT * FROM alarms WHERE enabled = 1');
  const markFired = db.prepare('UPDATE alarms SET last_fired = ? WHERE id = ?');

  const tick = () => {
    try {
      const now = new Date();
      const hhmm = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
      const day = now.getDay();
      const minuteStamp = now.toISOString().slice(0, 16);

      for (const row of enabled.all()) {
        if (row.time !== hhmm) continue;
        const days = JSON.parse(row.days || '[]');
        if (days.length && !days.includes(day)) continue;
        if (row.last_fired === minuteStamp) continue;
        markFired.run(minuteStamp, row.id);
        logger?.info('[alarms] firing %s (%s %s)', row.id, row.time, row.label || row.media_title);
        io.emit('alarm:trigger', rowToAlarm(row));
      }
    } catch (err) {
      logger?.warn('[alarms] scheduler tick failed: %s', err.message);
    }
  };

  setInterval(tick, 15000);
  logger?.info('[alarms] scheduler started');
}

router.startScheduler = startScheduler;

module.exports = router;
