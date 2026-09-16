// Self-check for the service worker's cache-strategy routing.
//
// This is the logic that pinned the mirror to whichever build was installed
// first: HTML served cache-first meant index.html — the one filename that
// never changes — kept pointing at an old content-hashed bundle, so updates
// applied on disk and reloads kept showing the old app. A regression here is
// invisible in a build and invisible in any testing that hard-reloads,
// because a hard reload bypasses the worker entirely.
//
// Run: node sw.test.mjs   (from frontend/)
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
import path from 'node:path';

const swPath = path.join(path.dirname(fileURLToPath(import.meta.url)), 'public', 'sw.js');
const src = readFileSync(swPath, 'utf8');

// ── Run the real worker in a sandbox with the bits it touches at load ──
const listeners = {};
const sandbox = {
  self: {
    addEventListener: (evt, fn) => { listeners[evt] = fn; },
    location: { origin: 'http://mirror' },
    skipWaiting: () => {},
    clients: { claim: () => {} },
  },
  caches: { open: async () => ({}), keys: async () => [], delete: async () => {} },
  URL,
  Response,
  fetch: async () => { throw new Error('offline'); },
};
sandbox.self.self = sandbox.self;
vm.createContext(sandbox);
vm.runInContext(src, sandbox, { filename: 'sw.js' });

const { isHtml, CACHE_NAME } = sandbox;
assert.equal(typeof isHtml, 'function', 'sw.js must expose the routing predicate');

const nav = (p) => [{ mode: 'navigate' }, new URL(`http://mirror${p}`)];
const sub = (p) => [{ mode: 'no-cors' }, new URL(`http://mirror${p}`)];

// ── Anything resolving to index.html must be network-first ──
assert.equal(isHtml(...nav('/')), true, 'kiosk reload must not be served cache-first');
assert.equal(isHtml(...nav('/settings')), true, 'deep link must not be served cache-first');
assert.equal(isHtml(...sub('/')), true, 'bare root is the shell whatever the mode');
assert.equal(isHtml(...sub('/index.html')), true, 'explicit index.html is the shell');

// ── Content-hashed assets stay cache-first: their names change per build ──
assert.equal(isHtml(...sub('/assets/index-CCcUvJ1m.js')), false);
assert.equal(isHtml(...sub('/assets/Heebo-Variable-CXdlclQD.woff2')), false);
assert.equal(isHtml(...sub('/favicon.svg')), false);
assert.equal(isHtml(...sub('/manifest.json')), false);

// ── The cache name must not be the one that shipped the stale shell ──
assert.notEqual(
  CACHE_NAME,
  'smart-mirror-v1',
  'activate() evicts by name mismatch, so v1 must be renamed to purge the stale index.html'
);

// ── activate() must still delete non-matching caches, or the rename is inert ──
assert.match(src, /filter\(\(key\) => key !== CACHE_NAME\)/);

// ── A navigation must never be answered with a JSON error body ──
assert.match(
  src,
  /if \(request\.mode === 'navigate'\)[\s\S]*?cache\.match\('\/'\)/,
  'offline navigation must fall back to the cached shell, not an API error object'
);

console.log('sw: all checks passed');
