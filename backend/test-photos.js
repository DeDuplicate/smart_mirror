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

// ─── Picture browser (kid avatars) ──────────────────────────────────────────

const express = require('express');
const photos = require('./routes/photos');

test('listFolder shows one level: its pictures and subfolders, no junk, sorted', async () => {
  const root = makeTree();
  const top = await photos.listFolder(root, '');
  assert.deepEqual(top.photos.map((p) => p.name), ['beach.JPG']);
  assert.deepEqual(top.folders.map((f) => f.name), ['trips']);
  assert.equal(top.folders[0].path, 'trips');
  const trips = await photos.listFolder(path.join(root, 'trips'), 'trips');
  assert.deepEqual(trips.photos, [{ name: 'eilat.jpeg', path: 'trips/eilat.jpeg' }]);
  assert.deepEqual(trips.folders.map((f) => f.path), ['trips/2024']);
});

test('listFolder numbers sort naturally (IMG2 before IMG10)', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'photo-sort-'));
  for (const n of ['IMG10.jpg', 'IMG2.jpg', 'IMG1.jpg']) fs.writeFileSync(path.join(root, n), '');
  const { photos: listed } = await photos.listFolder(root, '');
  assert.deepEqual(listed.map((p) => p.name), ['IMG1.jpg', 'IMG2.jpg', 'IMG10.jpg']);
});

// A minimal JPEG header: SOI, then an APP1 "Exif" segment holding one IFD0 entry.
function jpegWithOrientation(value, littleEndian = true) {
  const tiff = Buffer.alloc(8 + 2 + 12 + 4);
  const w16 = (o, v) => (littleEndian ? tiff.writeUInt16LE(v, o) : tiff.writeUInt16BE(v, o));
  const w32 = (o, v) => (littleEndian ? tiff.writeUInt32LE(v, o) : tiff.writeUInt32BE(v, o));
  tiff.write(littleEndian ? 'II' : 'MM', 0, 'latin1');
  w16(2, 42);
  w32(4, 8);          // IFD0 right after the header
  w16(8, 1);          // one entry
  w16(10, 0x0112);    // Orientation
  w16(12, 3);         // SHORT
  w32(14, 1);         // count
  w16(18, value);
  const body = Buffer.concat([Buffer.from('Exif\0\0', 'latin1'), tiff]);
  const len = Buffer.alloc(2);
  len.writeUInt16BE(body.length + 2);
  return Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe1]), len, body, Buffer.from([0xff, 0xda, 0, 2])]);
}

test('parseExifOrientation reads the tag in either byte order', () => {
  for (const v of [1, 3, 6, 8]) {
    assert.equal(photos.parseExifOrientation(jpegWithOrientation(v, true)), v, `LE ${v}`);
    assert.equal(photos.parseExifOrientation(jpegWithOrientation(v, false)), v, `BE ${v}`);
  }
});

test('parseExifOrientation says null rather than guessing', () => {
  assert.equal(photos.parseExifOrientation(Buffer.from('not a jpeg at all')), null);
  assert.equal(photos.parseExifOrientation(Buffer.from([0xff, 0xd8, 0xff, 0xda, 0, 2])), null, 'no EXIF before the image data');
  assert.equal(photos.parseExifOrientation(jpegWithOrientation(9)), null, 'out of range');
  assert.equal(photos.parseExifOrientation(jpegWithOrientation(0)), null, 'out of range');
  const cut = jpegWithOrientation(6).subarray(0, 20);
  assert.equal(photos.parseExifOrientation(cut), null, 'truncated header');
});

test('thumbKey changes when the file or the size does, and only then', () => {
  const stat = { mtimeMs: 1000, size: 5 };
  const a = photos.thumbKey('thumb', 'a/b.jpg', stat);
  assert.equal(a, photos.thumbKey('thumb', 'a/b.jpg', { ...stat }), 'stable');
  assert.notEqual(a, photos.thumbKey('medium', 'a/b.jpg', stat), 'size name');
  assert.notEqual(a, photos.thumbKey('thumb', 'a/b.jpg', { mtimeMs: 2000, size: 5 }), 'edited file');
  assert.notEqual(a, photos.thumbKey('thumb', 'a/c.jpg', stat), 'path');
});

test('immichBrowseBody pages newest first and keeps the visibility guard', () => {
  const first = photos.immichBrowseBody('', '', '');
  assert.equal(first.size, 60);
  assert.equal(first.order, 'desc');
  assert.equal(first.visibility, 'timeline');
  assert.equal(first.type, 'IMAGE');
  assert.equal('page' in first, false);
  const later = photos.immichBrowseBody('11111111-1111-1111-1111-111111111111', '22222222-2222-2222-2222-222222222222', '3');
  assert.deepEqual(later.albumIds, ['11111111-1111-1111-1111-111111111111']);
  assert.deepEqual(later.personIds, ['22222222-2222-2222-2222-222222222222']);
  assert.equal(later.page, 3);
  assert.equal(photos.immichBrowseBody('favorites', '', '').isFavorite, true);
});

test('picture browser routes stay inside the photo directory', async (t) => {
  const app = express();
  app.locals.logger = { info() {}, warn() {}, error() {} };
  app.locals.db = { prepare: () => ({ get: () => undefined }) };
  app.use('/api/photoframe', photos);
  const server = app.listen(0);
  t.after(() => server.close());
  const base = `http://127.0.0.1:${server.address().port}/api/photoframe`;
  const status = async (url) => (await fetch(base + url)).status;

  assert.equal(await status('/browse/local?path=../..'), 400, 'browse outside');
  assert.equal(await status('/thumb?path=../../etc/passwd.jpg'), 400, 'thumb outside');
  assert.equal(await status('/thumb'), 400, 'no path');
  assert.equal(await status('/thumb?path=notes.txt'), 400, 'not a picture');
  assert.equal(await status('/thumb?path=missing-photo.jpg'), 404, 'picture that is not there');
  assert.equal(await status('/browse/immich?albumId=nope'), 400, 'bad album id');
  assert.equal(await status('/browse/immich?personId=../x'), 400, 'bad person id');
  assert.equal(await status('/browse/immich?page=abc'), 400, 'bad page');
  assert.equal(await status('/people/not-a-uuid/face'), 400, 'bad person id for a face');
});
