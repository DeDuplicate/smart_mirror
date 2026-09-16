// Self-check for the post-update reload arbitration.
//
// Mirrors the logic wired into App.jsx's socket handlers: 'system:updated'
// arms a reload, the next 'connect' consumes it, and the tab that started the
// update opts out because it shows its own prompt instead. Getting this wrong
// is not visible in a build — it shows up as a wall-mounted screen silently
// running last week's bundle.
//
// Run: node updateReload.test.mjs
import assert from 'node:assert/strict';

const { UPDATE_INITIATOR_KEY } = await import('./index.js');

// ── Stand-in for the two App.jsx handlers ──
function makeTab({ storageThrows = false } = {}) {
  let stored = null;
  const sessionStorage = {
    getItem: () => { if (storageThrows) throw new Error('blocked'); return stored; },
    setItem: (_k, v) => { if (storageThrows) throw new Error('blocked'); stored = v; },
    removeItem: () => { if (storageThrows) throw new Error('blocked'); stored = null; },
  };
  let reloadOnReconnect = false;
  let reloads = 0;

  return {
    sessionStorage,
    startUpdate() {
      try { sessionStorage.setItem(UPDATE_INITIATOR_KEY, '1'); } catch {}
    },
    finishUpdate() {
      try { sessionStorage.removeItem(UPDATE_INITIATOR_KEY); } catch {}
    },
    onUpdated() {
      let initiated = false;
      try { initiated = sessionStorage.getItem(UPDATE_INITIATOR_KEY) === '1'; } catch {}
      reloadOnReconnect = !initiated;
    },
    onConnect() {
      if (reloadOnReconnect) { reloadOnReconnect = false; reloads++; }
    },
    get reloads() { return reloads; },
  };
}

// ── A bystander tab (the kiosk, updated from a phone) reloads ──
const kiosk = makeTab();
kiosk.onUpdated();
kiosk.onConnect();
assert.equal(kiosk.reloads, 1, 'a tab that did not start the update must reload');

// ── The initiating tab does not: its prompt owns the decision ──
const initiator = makeTab();
initiator.startUpdate();
initiator.onUpdated();
initiator.onConnect();
assert.equal(initiator.reloads, 0, 'initiator must not race its own prompt');

// ── ...and once released, it behaves like any other tab next time ──
initiator.finishUpdate();
initiator.onUpdated();
initiator.onConnect();
assert.equal(initiator.reloads, 1, 'stale initiator flag would strand this tab forever');

// ── A reconnect with no update pending must not reload ──
const idle = makeTab();
idle.onConnect();
idle.onConnect();
assert.equal(idle.reloads, 0, 'ordinary wifi blips must not reload the mirror');

// ── The reload is consumed once, not on every later reconnect ──
const flapping = makeTab();
flapping.onUpdated();
flapping.onConnect();
flapping.onConnect();
flapping.onConnect();
assert.equal(flapping.reloads, 1, 'armed reload must fire exactly once');

// ── Blocked storage falls back to reloading, never to staying stale ──
const noStorage = makeTab({ storageThrows: true });
noStorage.startUpdate();
noStorage.onUpdated();
noStorage.onConnect();
assert.equal(noStorage.reloads, 1, 'unreadable storage must fail toward a fresh page');

console.log('updateReload: all checks passed');
