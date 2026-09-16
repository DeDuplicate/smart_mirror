'use strict';

// Self-check for the photo-frame listing. No framework, no fixtures:
//   node backend/test-photos.js
// Covers what would silently empty the frame: non-image files slipping in,
// subfolder albums being missed, the depth cap, and junk dotfiles (.DS_Store,
// Synology's @eaDir thumbnails) showing up as "photos".

const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { walkPhotos, resolveSubdir, parseShares, isValidSmbHost, PHOTO_ROOT, mergeSettledAssets } = require('./routes/photos');

function makeTree() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'photo-frame-'));
  const write = (rel) => {
    const abs = path.join(root, rel);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, '');
  };
  write('beach.JPG');          // upper-case extension still counts
  write('README.md');          // the committed readme must not become a slide
  write('notes.txt');
  write('.DS_Store');
  write('trips/eilat.jpeg');
  write('trips/2024/snow.webp');
  write('trips/2024/deep/deeper/too-far.png'); // depth 4 > PHOTO_MAX_DEPTH
  return root;
}

test('lists only images, walks albums, skips junk and over-deep dirs', async () => {
  const root = makeTree();
  try {
    const found = (await walkPhotos(root)).sort();
    assert.deepEqual(found, ['beach.JPG', 'trips/2024/snow.webp', 'trips/eilat.jpeg']);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('missing directory rejects with ENOENT so the route falls back to gradients', async () => {
  await assert.rejects(
    () => walkPhotos(path.join(os.tmpdir(), 'no-such-photo-dir-xyz')),
    (err) => err.code === 'ENOENT'
  );
});

// The folder picker hands back whatever the user tapped, so this is the guard
// that keeps a crafted path from reading outside the photo directory.
test('resolveSubdir confines the folder picker to the photo directory', () => {
  assert.equal(resolveSubdir(''), PHOTO_ROOT);
  assert.equal(resolveSubdir('nas/trips'), path.join(PHOTO_ROOT, 'nas', 'trips'));
  assert.equal(resolveSubdir('/nas'), path.join(PHOTO_ROOT, 'nas')); // leading slash is not absolute
  // Express has already percent-decoded req.query by the time we see it, so
  // these are the shapes that actually arrive from a crafted request.
  const backslashes = String.raw`..\..\windows`; // a Windows-style traversal
  for (const evil of ['..', '../..', 'nas/../../etc', '../../../etc/passwd', backslashes]) {
    assert.equal(resolveSubdir(evil), null, `should reject ${evil}`);
  }
});

// smbclient --grepable output. The admin shares are the interesting case:
// every NAS offers IPC$/print$ and neither is ever a photo share.
test('parseShares keeps disk shares and drops admin shares and printers', () => {
  const stdout = [
    'Disk|photos|Family photos',
    'Disk|media|',
    'Disk|IPC$|IPC Service (nas)',
    'Disk|print$|Printer Drivers',
    'Printer|HP_LaserJet|office printer',
    'IPC|IPC$|IPC Service',
    '',
    'garbage line with no pipes',
  ].join('\n');

  assert.deepEqual(parseShares(stdout), [
    { name: 'photos', comment: 'Family photos' },
    { name: 'media', comment: '' },
  ]);
});

test('isValidSmbHost rejects anything smbclient would read as a flag', () => {
  for (const good of ['nas', 'nas.local', '192.168.1.50', 'my-nas-01']) {
    assert.equal(isValidSmbHost(good), true, `should accept ${good}`);
  }
  for (const bad of ['-L', '--option', '', 'nas;rm -rf /', 'nas/share', '//nas', 'nas ']) {
    assert.equal(isValidSmbHost(bad), false, `should reject ${JSON.stringify(bad)}`);
  }
});

// ─── Immich per-person fan-out ───────────────────────────────────────────────
// Immich's personIds is an AND, so selecting four family members asked for
// photos containing all four at once and returned nothing at all. The fan-out
// queries each person separately; this is what merges the results.

const ok = (value) => ({ status: 'fulfilled', value });
const bad = (reason) => ({ status: 'rejected', reason });

test('mergeSettledAssets unions people rather than intersecting them', () => {
  const merged = mergeSettledAssets([
    ok([{ id: 'a' }, { id: 'b' }]),
    ok([{ id: 'c' }]),
  ]);
  assert.deepEqual(merged.map((a) => a.id), ['a', 'b', 'c']);
});

test('mergeSettledAssets shows a shared photo once, not once per person', () => {
  // A family photo comes back from every selected person's query.
  const merged = mergeSettledAssets([
    ok([{ id: 'shared' }, { id: 'only-mum' }]),
    ok([{ id: 'shared' }, { id: 'only-dad' }]),
    ok([{ id: 'shared' }]),
  ]);
  assert.deepEqual(merged.map((a) => a.id), ['shared', 'only-mum', 'only-dad']);
});

test('mergeSettledAssets keeps going when one person fails', () => {
  // Three people still make a slideshow; blanking the frame would be worse.
  const merged = mergeSettledAssets([
    ok([{ id: 'a' }]),
    bad(new Error('Immich 500')),
    ok([{ id: 'b' }]),
  ]);
  assert.deepEqual(merged.map((a) => a.id), ['a', 'b']);
});

test('mergeSettledAssets rethrows when every query failed', () => {
  // All failing is the server being down, not an empty library. It has to
  // surface so /list reports 'unreachable' instead of a silent blank frame.
  assert.throws(
    () => mergeSettledAssets([bad(new Error('Immich 401')), bad(new Error('Immich 401'))]),
    /Immich 401/
  );
});

test('mergeSettledAssets tolerates an empty or malformed result', () => {
  assert.deepEqual(mergeSettledAssets([ok([]), ok(undefined), ok([{ id: 'a' }, null])]),
    [{ id: 'a' }]);
});
