'use strict';

const fs = require('fs');
const path = require('path');
const http = require('http');
const crypto = require('crypto');

// ---------------------------------------------------------------------------
// 1. Load environment
// ---------------------------------------------------------------------------
require('dotenv').config({ path: path.join(__dirname, '.env') });

// ---------------------------------------------------------------------------
// 2. Pino logger with file rotation
// ---------------------------------------------------------------------------
const pino = require('pino');

const logsDir = path.join(__dirname, 'logs');
if (!fs.existsSync(logsDir)) fs.mkdirSync(logsDir, { recursive: true });

const transports = pino.transport({
  targets: [
    // Pretty console output in dev
    ...(process.env.NODE_ENV !== 'production'
      ? [
          {
            target: 'pino-pretty',
            options: { colorize: true, translateTime: 'SYS:standard' },
            level: 'debug',
          },
        ]
      : []),
    // Rotating file transport — 7 day retention
    {
      target: 'pino/file',
      options: { destination: path.join(logsDir, 'app.log'), mkdir: true },
      level: 'info',
    },
  ],
});

const logger = pino({ level: 'debug' }, transports);

// ---------------------------------------------------------------------------
// 3. Startup validation
// ---------------------------------------------------------------------------
const envPath = path.join(__dirname, '.env');
if (!fs.existsSync(envPath)) {
  logger.warn('.env file not found — using defaults / environment variables');
}

const REQUIRED_VARS = [];
const OPTIONAL_VARS = [
  'SPOTIFY_CLIENT_ID',
  'SPOTIFY_CLIENT_SECRET',
  'HA_HOST',
  'HA_TOKEN',
];

for (const v of REQUIRED_VARS) {
  if (!process.env[v]) {
    logger.error('Missing required env var: %s — exiting', v);
    process.exit(1);
  }
}
for (const v of OPTIONAL_VARS) {
  if (!process.env[v]) {
    logger.warn('Optional env var %s is not set — related features will be disabled', v);
  }
}

// ---------------------------------------------------------------------------
// 4. SQLite initialisation
// ---------------------------------------------------------------------------
const Database = require('better-sqlite3');

const dbPath = path.join(__dirname, 'db', 'smart-mirror.db');
const db = new Database(dbPath);

db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

logger.info('SQLite database opened at %s', dbPath);

// ---------------------------------------------------------------------------
// 5. Run pending migrations
// ---------------------------------------------------------------------------
const { runMigrations } = require('./db/migrate');
runMigrations(db, logger);

// Hydrate Spotify credentials from the settings table when .env is empty
// so Settings-saved Client ID / Secret work without a process restart.
try {
  const { getSpotifyCredentials } = require('./routes/auth');
  const creds = getSpotifyCredentials(db);
  if (creds.clientId && !process.env.SPOTIFY_CLIENT_ID) {
    process.env.SPOTIFY_CLIENT_ID = creds.clientId;
  }
  if (creds.clientSecret && !process.env.SPOTIFY_CLIENT_SECRET) {
    process.env.SPOTIFY_CLIENT_SECRET = creds.clientSecret;
  }
} catch (err) {
  logger.warn('Could not hydrate Spotify credentials from settings: %s', err.message);
}

// ---------------------------------------------------------------------------
// 6. Express application
// ---------------------------------------------------------------------------
const express = require('express');
const cors = require('cors');

const app = express();

app.use(express.json({ limit: '2mb' })); // generous limit for base64 avatar uploads

// CORS — allow localhost:3000 in dev, same-origin in production
const isDev = process.env.NODE_ENV !== 'production';
app.use(
  cors(
    isDev
      ? { origin: ['http://localhost:3000', 'http://127.0.0.1:3000'], credentials: true }
      : { origin: false }
  )
);

// ---------------------------------------------------------------------------
// 7. API security middleware
// ---------------------------------------------------------------------------
// Generate a bearer token on first run and persist it in the config table.
function getOrCreateApiToken() {
  const row = db.prepare("SELECT value FROM config WHERE key = 'api_token'").get();
  if (row) return row.value;

  const token = crypto.randomBytes(32).toString('hex');
  db.prepare("INSERT INTO config (key, value) VALUES ('api_token', ?)").run(token);
  logger.info('Generated new API bearer token (stored in config table)');
  return token;
}

const API_TOKEN = getOrCreateApiToken();

// Music streaming routes expose a helper to verify the HMAC signature carried
// by public MP3 stream URLs (fetched by cast devices that cannot send the
// bearer token). Loaded here so authMiddleware can grant those requests.
const musicRoutes = require('./routes/music');

function authMiddleware(req, res, next) {
  // Bypass for localhost / loopback
  const ip = req.ip || req.connection.remoteAddress || '';
  if (
    ip === '127.0.0.1' ||
    ip === '::1' ||
    ip === '::ffff:127.0.0.1' ||
    ip === 'localhost'
  ) {
    return next();
  }

  // Bypass for signed music stream URLs. These are fetched directly by Google
  // Cast / Nest devices over the LAN and cannot carry the bearer token, so they
  // are protected by an HMAC signature of the video id instead.
  const streamMatch = req.path.match(/^\/music\/stream\/([a-zA-Z0-9_-]{11})\.mp3$/);
  if (streamMatch && musicRoutes.verifyStreamToken(API_TOKEN, streamMatch[1], req.query.token)) {
    return next();
  }

  const header = req.headers.authorization;
  if (!header || !header.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Missing or invalid Authorization header' });
  }
  const token = header.slice(7);
  if (token !== API_TOKEN) {
    return res.status(403).json({ error: 'Invalid API token' });
  }
  next();
}

app.use('/api', authMiddleware);

// ---------------------------------------------------------------------------
// 8. Make db and logger available to route handlers
// ---------------------------------------------------------------------------
app.locals.db = db;
app.locals.logger = logger;

// ---------------------------------------------------------------------------
// 9. Mount route files
// ---------------------------------------------------------------------------
const homeAssistantRoutes = require('./routes/homeassistant');

app.use('/api/auth', require('./routes/auth'));
app.use('/api/calendar', require('./routes/calendar'));
app.use('/api/tasks', require('./routes/tasks'));
app.use('/api/weather', require('./routes/weather'));
app.use('/api/ha', homeAssistantRoutes);
app.use('/api/music', musicRoutes);
app.use('/api/news', require('./routes/news'));
app.use('/api/wifi', require('./routes/wifi'));
app.use('/api/settings', require('./routes/settings'));
app.use('/api/system', require('./routes/system'));
app.use('/api/quotes', require('./routes/quotes'));

// ---------------------------------------------------------------------------
// 10. HTTP server + Socket.io
// ---------------------------------------------------------------------------
const server = http.createServer(app);
const { Server: SocketIOServer } = require('socket.io');

const io = new SocketIOServer(server, {
  cors: isDev
    ? { origin: ['http://localhost:3000', 'http://127.0.0.1:3000'], credentials: true }
    : {},
});

// Expose io so route handlers can emit events
app.locals.io = io;

// Start the Home Assistant WebSocket relay now that io exists — forwards
// HA state_changed events to connected Socket.io clients as 'ha:state_changed'.
// Uses the same HA_HOST/HA_TOKEN env vars as the /api/ha routes (see getHAConfig
// in routes/homeassistant.js).
homeAssistantRoutes.setupHAWebSocketRelay(io, logger);

io.on('connection', (socket) => {
  logger.info('Socket.io client connected: %s', socket.id);

  // Heartbeat: client sends "ping", server replies "pong"
  socket.on('heartbeat', (cb) => {
    if (typeof cb === 'function') cb({ ts: Date.now() });
  });

  socket.on('disconnect', (reason) => {
    logger.info('Socket.io client disconnected: %s (%s)', socket.id, reason);
  });
});

// ---------------------------------------------------------------------------
// 11. Log rotation cleanup (delete logs older than 7 days, check daily)
// ---------------------------------------------------------------------------
const cron = require('node-cron');

cron.schedule('0 3 * * *', () => {
  try {
    const now = Date.now();
    const SEVEN_DAYS = 7 * 24 * 60 * 60 * 1000;
    const files = fs.readdirSync(logsDir);
    for (const file of files) {
      const fp = path.join(logsDir, file);
      const stat = fs.statSync(fp);
      if (now - stat.mtimeMs > SEVEN_DAYS) {
        fs.unlinkSync(fp);
        logger.info('Deleted old log file: %s', file);
      }
    }
  } catch (err) {
    logger.error('Log rotation cleanup failed: %s', err.message);
  }
});

// ---------------------------------------------------------------------------
// 12. Graceful shutdown
// ---------------------------------------------------------------------------
function shutdown(signal) {
  logger.info('Received %s — shutting down gracefully', signal);

  homeAssistantRoutes.closeHAWebSocket();

  server.close(() => {
    logger.info('HTTP server closed');
    try {
      db.close();
      logger.info('SQLite database closed');
    } catch {
      // already closed
    }
    logger.flush();
    process.exit(0);
  });

  // Force-exit after 10 s if something is stuck
  setTimeout(() => {
    logger.warn('Forcing exit after timeout');
    process.exit(1);
  }, 10_000).unref();
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

// ---------------------------------------------------------------------------
// 12b. Global crash safety net
// ---------------------------------------------------------------------------
// A rejected promise that nobody attached a .catch() to (e.g. a stray async
// DB call in a route handler) terminates the process on Node >=15. Express 4
// does not catch async route-handler rejections on its own, so a single bad
// query could otherwise take down the whole kiosk display. Log it and keep
// the server alive — the offending request handler should still be fixed to
// respond with its own error, but the process itself must not die for this.
process.on('unhandledRejection', (reason) => {
  const err = reason instanceof Error ? reason : new Error(String(reason));
  logger.error({ err, stack: err.stack }, 'Unhandled promise rejection — continuing (not exiting)');
});

// An uncaughtException means the process is in an undefined state (Node's
// own guidance). Log everything we can, attempt a best-effort synchronous
// cleanup, then exit so PM2 can cleanly restart the process.
process.on('uncaughtException', (err) => {
  logger.fatal({ err, stack: err && err.stack }, 'Uncaught exception — process state is undefined, exiting for PM2 restart');

  try {
    db.close();
  } catch {
    // already closed / corrupted — nothing more we can do
  }

  logger.flush();
  process.exit(1);
});

// ---------------------------------------------------------------------------
// 13. Start listening
// ---------------------------------------------------------------------------
const PORT = parseInt(process.env.PORT, 10) || 3001;

server.listen(PORT, () => {
  logger.info('Smart Mirror backend listening on port %d (%s)', PORT, process.env.NODE_ENV || 'development');

  // PM2 ready signal
  if (typeof process.send === 'function') {
    process.send('ready');
  }
});
