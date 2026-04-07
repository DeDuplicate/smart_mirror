'use strict';

const fs = require('fs');
const path = require('path');

const MIGRATIONS_DIR = path.join(__dirname, 'migrations');

/**
 * Return the current schema version stored in the DB (0 if none).
 */
function getCurrentVersion(db) {
  try {
    const row = db
      .prepare(
        "SELECT name FROM sqlite_master WHERE type='table' AND name='schema_version'"
      )
      .get();
    if (!row) return 0;

    const versionRow = db
      .prepare('SELECT MAX(version) AS version FROM schema_version')
      .get();
    return versionRow && versionRow.version ? versionRow.version : 0;
  } catch {
    return 0;
  }
}

/**
 * Discover migration files sorted by their numeric prefix.
 * Expected format: 001_name.sql, 002_name.sql, ...
 */
function discoverMigrations() {
  if (!fs.existsSync(MIGRATIONS_DIR)) return [];

  return fs
    .readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith('.sql'))
    .sort()
    .map((filename) => {
      const match = filename.match(/^(\d+)/);
      if (!match) return null;
      return {
        version: parseInt(match[1], 10),
        filename,
        filepath: path.join(MIGRATIONS_DIR, filename),
      };
    })
    .filter(Boolean);
}

/**
 * Run all unapplied migrations in order, each inside its own transaction.
 *
 * @param {import('better-sqlite3').Database} db
 * @param {object} [logger] - Optional pino logger
 * @returns {number} Number of migrations applied
 */
function runMigrations(db, logger) {
  const log = logger || console;
  const currentVersion = getCurrentVersion(db);
  const migrations = discoverMigrations().filter(
    (m) => m.version > currentVersion
  );

  if (migrations.length === 0) {
    if (log.info) {
      log.info('Database schema is up to date (version %d)', currentVersion);
    }
    return 0;
  }

  let applied = 0;

  for (const migration of migrations) {
    const sql = fs.readFileSync(migration.filepath, 'utf-8');

    const runInTransaction = db.transaction(() => {
      db.exec(sql);
      // Ensure schema_version table exists before updating
      db.exec(
        'CREATE TABLE IF NOT EXISTS schema_version (version INTEGER)'
      );
      db.prepare('DELETE FROM schema_version').run();
      db.prepare('INSERT INTO schema_version (version) VALUES (?)').run(
        migration.version
      );
    });

    try {
      runInTransaction();
      applied++;
      if (log.info) {
        log.info(
          'Applied migration %s (version %d)',
          migration.filename,
          migration.version
        );
      }
    } catch (err) {
      const msg = `Migration ${migration.filename} failed: ${err.message}`;
      if (log.error) {
        log.error(msg);
      }
      throw err;
    }
  }

  return applied;
}

module.exports = { runMigrations };
