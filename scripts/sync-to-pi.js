#!/usr/bin/env node
'use strict';

/**
 * Auto-sync: watches for file changes and deploys to Raspberry Pi.
 *
 * Usage:
 *   node scripts/sync-to-pi.js              # watch mode (continuous)
 *   node scripts/sync-to-pi.js --once       # one-shot deploy
 *   node scripts/sync-to-pi.js --rebuild    # deploy + rebuild frontend + restart PM2
 *
 * Env overrides:
 *   PI_HOST=192.168.1.96  PI_USER=mirror
 */

const { execFileSync } = require('child_process');
const path = require('path');
const fs = require('fs');

const PI_HOST = process.env.PI_HOST || '192.168.1.96';
const PI_USER = process.env.PI_USER || 'mirror';
const PI_DIR = process.env.PI_DIR || '/home/mirror/smart-mirror';
const ROOT = path.resolve(__dirname, '..');

const SSH_OPTS = ['-o', 'StrictHostKeyChecking=no', '-o', 'ConnectTimeout=5'];

function ssh(cmd) {
  return execFileSync('ssh', [...SSH_OPTS, `${PI_USER}@${PI_HOST}`, cmd], { stdio: 'pipe' }).toString().trim();
}

function scpFile(local, remote) {
  execFileSync('scp', [...SSH_OPTS, local, `${PI_USER}@${PI_HOST}:${remote}`], { stdio: 'pipe' });
}

// Paths relative to project root that we watch and sync
const WATCH_DIRS = ['frontend/src', 'backend/routes', 'backend/db'];
const IGNORE = [/node_modules/, /\.git/, /dist/, /\.env/, /\.db$/];

function shouldSync(filePath) {
  const rel = path.relative(ROOT, filePath).replace(/\\/g, '/');
  if (IGNORE.some((re) => re.test(rel))) return false;
  if (!WATCH_DIRS.some((d) => rel.startsWith(d))) return false;
  return true;
}

function syncFile(filePath) {
  const rel = path.relative(ROOT, filePath).replace(/\\/g, '/');
  const remoteDir = path.posix.dirname(`${PI_DIR}/${rel}`);

  try {
    ssh(`mkdir -p "${remoteDir}"`);
    scpFile(filePath, `${PI_DIR}/${rel}`);
    console.log(`  \u2713 ${rel}`);
    return rel;
  } catch (err) {
    console.error(`  \u2717 ${rel}: ${err.message}`);
    return null;
  }
}

function rebuildFrontend() {
  console.log('\n  Rebuilding frontend on Pi...');
  try {
    const out = ssh(`cd ${PI_DIR}/frontend && npx vite build 2>&1 | tail -3`);
    console.log(`  ${out}`);
  } catch (err) {
    console.error('  Build failed:', err.message);
  }
}

function restartPM2() {
  console.log('  Restarting PM2...');
  try {
    ssh('pm2 restart all 2>&1 | tail -1');
    console.log('  \u2713 PM2 restarted');
  } catch (err) {
    console.error('  Restart failed:', err.message);
  }
}

// ── One-shot deploy ──────────────────────────────────────────────────────────

function deployAll() {
  console.log(`Deploying to ${PI_USER}@${PI_HOST}:${PI_DIR}...\n`);

  let count = 0;
  let hasFrontend = false;
  let hasBackend = false;

  function walkDir(dir) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (!IGNORE.some((re) => re.test(entry.name))) walkDir(full);
      } else if (shouldSync(full)) {
        const synced = syncFile(full);
        if (synced) {
          count++;
          if (synced.startsWith('frontend/')) hasFrontend = true;
          if (synced.startsWith('backend/')) hasBackend = true;
        }
      }
    }
  }

  for (const d of WATCH_DIRS) {
    const full = path.join(ROOT, d);
    if (fs.existsSync(full)) walkDir(full);
  }

  console.log(`\nSynced ${count} files.`);
  return { hasFrontend, hasBackend };
}

// ── Watch mode ───────────────────────────────────────────────────────────────

function watchMode() {
  console.log(`Watching for changes... (syncing to ${PI_USER}@${PI_HOST})\n`);
  console.log('Press Ctrl+C to stop.\n');

  let pending = new Set();
  let timer = null;

  function flush() {
    if (pending.size === 0) return;

    const files = [...pending];
    pending = new Set();

    console.log(`\n[${new Date().toLocaleTimeString()}] Syncing ${files.length} file(s)...`);

    let hasFrontend = false;
    let hasBackend = false;

    for (const f of files) {
      const synced = syncFile(f);
      if (synced) {
        if (synced.startsWith('frontend/')) hasFrontend = true;
        if (synced.startsWith('backend/')) hasBackend = true;
      }
    }

    if (hasFrontend) rebuildFrontend();
    if (hasBackend || hasFrontend) restartPM2();

    console.log('\nWaiting for changes...');
  }

  // Use fs.watch recursively
  for (const d of WATCH_DIRS) {
    const full = path.join(ROOT, d);
    if (!fs.existsSync(full)) continue;

    fs.watch(full, { recursive: true }, (_eventType, filename) => {
      if (!filename) return;
      const filePath = path.join(full, filename);

      try {
        if (fs.statSync(filePath).isDirectory()) return;
      } catch {
        return;
      }
      if (!shouldSync(filePath)) return;

      pending.add(filePath);
      if (timer) clearTimeout(timer);
      timer = setTimeout(flush, 1000);
    });
  }

  console.log('Waiting for changes...');
}

// ── Main ─────────────────────────────────────────────────────────────────────

const args = process.argv.slice(2);

if (args.includes('--once') || args.includes('--rebuild')) {
  const { hasFrontend, hasBackend } = deployAll();
  if (args.includes('--rebuild') || hasFrontend) {
    rebuildFrontend();
    restartPM2();
  } else if (hasBackend) {
    restartPM2();
  }
} else {
  watchMode();
}
