// Self-check for the confirm dialog slice's three-button support.
// The post-update prompt ("reload app" / "reboot Pi" / "later") is the only
// caller that passes onAlt, so the thing worth pinning down is that a plain
// two-button confirm opened afterwards does NOT inherit that third handler.
// Run: node confirmSlice.test.mjs
import assert from 'node:assert/strict';

const { default: useStore } = await import('./index.js');

const { showConfirm, hideConfirm } = useStore.getState();
const confirm = () => useStore.getState().confirm;

// ── Closed by default ──
assert.equal(confirm().isOpen, false);
assert.equal(confirm().onAlt, null);

// ── Three-button form: labels and alt handler are carried through ──
let picked = null;
showConfirm({
  title: 't',
  message: 'm',
  confirmLabel: 'reload',
  altLabel: 'reboot',
  cancelLabel: 'later',
  onConfirm: () => { picked = 'reload'; },
  onAlt: () => { picked = 'reboot'; },
});
assert.equal(confirm().isOpen, true);
assert.equal(confirm().confirmLabel, 'reload');
assert.equal(confirm().altLabel, 'reboot');
assert.equal(confirm().cancelLabel, 'later');
confirm().onAlt();
assert.equal(picked, 'reboot', 'onAlt must invoke the alt action, not confirm');

// ── hideConfirm clears every field ──
hideConfirm();
assert.equal(confirm().isOpen, false);
assert.equal(confirm().onAlt, null);
assert.equal(confirm().altLabel, '');
assert.equal(confirm().confirmLabel, '');

// ── A later two-button confirm must not resurrect the third button ──
showConfirm({ title: 't2', message: 'm2', onConfirm: () => {} });
assert.equal(confirm().onAlt, null, 'stale onAlt leaked into a 2-button confirm');
assert.equal(confirm().altLabel, '');
assert.equal(confirm().confirmLabel, '', 'stale label would mislabel the confirm button');

console.log('confirmSlice: all checks passed');
