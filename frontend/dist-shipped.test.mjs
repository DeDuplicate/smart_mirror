// Self-check for the shipped frontend bundle.
//
// frontend/dist is committed on purpose: the mirror is a 1GB Pi 2, and running
// `vite build` on it spiked memory hard enough to exhaust CMA, kill Chromium's
// GPU process and drop the display into software rendering — an update that
// visibly degraded the screen it was updating. The updater therefore only
// builds when dist is absent (backend/routes/system.js, needsBuild()).
//
// That makes a tracked, self-consistent dist load-bearing. If it silently
// stops being tracked, every update quietly goes back to building on-device.
//
// Run: node dist-shipped.test.mjs   (from frontend/)
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const frontendDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.join(frontendDir, '..');
const indexPath = path.join(frontendDir, 'dist', 'index.html');

// ── The bundle exists at all ──
assert.ok(existsSync(indexPath), 'frontend/dist/index.html is missing — run `npx vite build`');

// ── ...and git actually carries it, which is the part that can rot silently ──
const tracked = execFileSync('git', ['ls-files', 'frontend/dist'], {
  cwd: repoRoot,
  encoding: 'utf8',
})
  .trim()
  .split('\n')
  .filter(Boolean);

assert.ok(
  tracked.includes('frontend/dist/index.html'),
  'frontend/dist/index.html is not tracked — check the !frontend/dist/ rule in .gitignore'
);
assert.ok(tracked.length > 10, `dist looks partially tracked (${tracked.length} files)`);

// ── The entry the shell points at must exist and be tracked too. A dist that
//    references a bundle nobody committed serves a white screen. ──
const html = readFileSync(indexPath, 'utf8');
const entry = html.match(/assets\/(index-[A-Za-z0-9_-]+\.js)/)?.[1];
assert.ok(entry, 'index.html does not reference an index-*.js bundle');
assert.ok(
  existsSync(path.join(frontendDir, 'dist', 'assets', entry)),
  `index.html references ${entry}, which is not in dist/`
);
assert.ok(
  tracked.includes(`frontend/dist/assets/${entry}`),
  `index.html references ${entry}, which is not tracked — rebuild and stage dist`
);

// ── Every asset the shell references must be tracked, not just the entry ──
for (const ref of html.match(/assets\/[A-Za-z0-9._-]+/g) || []) {
  assert.ok(
    tracked.includes(`frontend/dist/${ref}`),
    `index.html references ${ref}, which is not tracked`
  );
}

console.log(`dist-shipped: all checks passed (${tracked.length} files, entry ${entry})`);
