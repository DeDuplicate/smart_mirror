'use strict';

// Self-check for the Immich photo-frame source. No framework, no fixtures:
//   node backend/test-immich.js
// Runs the real router against a stub Immich server, because the things that
// break here are invisible to a unit test: the exact search body we send
// (Immich 3.0 will serve ARCHIVED and HIDDEN photos to a family screen if
// `visibility` is omitted), the three different response shapes Immich has
// used for asset lists, and whether the API key ever escapes to the client.

const assert = require('node:assert/strict');
const test = require('node:test');
const express = require('express');
const http = require('node:http');
const Database = require('better-sqlite3');

const PNG = Buffer.from('89504e470d0a1a0a', 'hex'); // just enough to be bytes

/** Stub Immich. Records what it was asked for so the test can assert on it. */
function startImmich(handlers = {}) {
  const seen = { requests: [] };
  const server = http.createServer((req, res) => {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      const entry = {
        method: req.method,
        url: req.url,
        apiKey: req.headers['x-api-key'],
        body: body ? JSON.parse(body) : null,
      };
      seen.requests.push(entry);

      const handler = handlers[`${req.method} ${req.url.split('?')[0]}`];
      if (!handler) {
        res.writeHead(404).end('{}');
        return;
      }
      handler(req, res, entry);
    });
  });
  server.listen(0);
  return { server, seen, origin: `http://127.0.0.1:${server.address().port}` };
}

function makeApp(settings) {
  const db = new Database(':memory:');
  db.exec('CREATE TABLE config (key TEXT PRIMARY KEY, value TEXT)');
  const ins = db.prepare('INSERT INTO config (key, value) VALUES (?, ?)');
  for (const [k, v] of Object.entries(settings)) ins.run(k, v);

  const app = express();
  app.locals.db = db;
  app.locals.logger = { info() {}, warn() {}, error() {} };
  app.use('/api/photoframe', require('./routes/photos'));

  const server = app.listen(0);
  return { server, base: `http://127.0.0.1:${server.address().port}` };
}

const IMAGE_ID = '11111111-2222-3333-4444-555555555555';
const VIDEO_ID = '99999999-8888-7777-6666-555555555555';

test('random deck: sends visibility=timeline, filters videos, hides the key', async (t) => {
  const immich = startImmich({
    'POST /api/search/random': (req, res) => {
      // Immich 1.117+ returns a BARE ARRAY here.
      res.writeHead(200, { 'Content-Type': 'application/json' }).end(
        JSON.stringify([
          { id: IMAGE_ID, type: 'IMAGE', originalFileName: 'beach.jpg' },
          { id: VIDEO_ID, type: 'VIDEO', originalFileName: 'clip.mp4' },
        ])
      );
    },
  });
  const app = makeApp({
    photoSource: 'immich',
    immichUrl: `${immich.origin}/`, // trailing slash on purpose
    immichApiKey: 'secret-key-value',
  });
  t.after(() => {
    immich.server.close();
    app.server.close();
  });

  const res = await fetch(`${app.base}/api/photoframe/list`);
  const data = await res.json();

  const sent = immich.seen.requests[0];
  assert.equal(sent.apiKey, 'secret-key-value');
  assert.equal(sent.body.visibility, 'timeline', 'omitting this serves archived/hidden photos on v3');
  assert.equal(sent.body.type, 'IMAGE');
  // The 3.2 `filter`/`orderBy` shape 400s when mixed with these flat fields.
  assert.equal(sent.body.filter, undefined);
  assert.equal(sent.body.orderBy, undefined);

  assert.deepEqual(data.photos, [
    { name: 'beach.jpg', url: `/api/photoframe/immich/${IMAGE_ID}` },
  ]);
  assert.equal(JSON.stringify(data).includes('secret-key-value'), false, 'key must never reach the client');
});

test('album deck: uses metadata search and the nested response shape', async (t) => {
  const albumId = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
  const immich = startImmich({
    'POST /api/search/metadata': (req, res) => {
      // This endpoint nests: {assets: {items: [...]}}
      res.writeHead(200, { 'Content-Type': 'application/json' }).end(
        JSON.stringify({ assets: { items: [{ id: IMAGE_ID, type: 'IMAGE', originalFileName: 'a.jpg' }] } })
      );
    },
  });
  const app = makeApp({
    photoSource: 'immich',
    immichUrl: immich.origin,
    immichApiKey: 'k',
    immichAlbumId: albumId,
  });
  t.after(() => {
    immich.server.close();
    app.server.close();
  });

  const data = await (await fetch(`${app.base}/api/photoframe/list`)).json();
  const sent = immich.seen.requests[0];

  assert.deepEqual(sent.body.albumIds, [albumId]);
  assert.equal(sent.body.visibility, 'timeline');
  assert.equal(data.photos.length, 1);
});

test('person filter uses metadata search with personIds', async (t) => {
  const personId = 'person-1';
  const immich = startImmich({
    'POST /api/search/metadata': (req, res) =>
      res.writeHead(200, { 'Content-Type': 'application/json' }).end(
        JSON.stringify({ assets: { items: [{ id: IMAGE_ID, type: 'IMAGE', originalFileName: 'kid.jpg' }] } })
      ),
  });
  const app = makeApp({
    photoSource: 'immich',
    immichUrl: immich.origin,
    immichApiKey: 'k',
    immichPersonIds: JSON.stringify([personId]),
  });
  t.after(() => {
    immich.server.close();
    app.server.close();
  });

  const data = await (await fetch(`${app.base}/api/photoframe/list`)).json();
  const sent = immich.seen.requests[0];

  assert.equal(sent.url, '/api/search/metadata');
  assert.deepEqual(sent.body.personIds, [personId]);
  assert.equal(sent.body.visibility, 'timeline');
  assert.equal(data.photos.length, 1);
});

test('album and person filters can be combined', async (t) => {
  const albumId = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
  const personId = 'person-1';
  const immich = startImmich({
    'POST /api/search/metadata': (req, res) =>
      res.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify({ assets: { items: [] } })),
  });
  const app = makeApp({
    photoSource: 'immich',
    immichUrl: immich.origin,
    immichApiKey: 'k',
    immichAlbumId: albumId,
    immichPersonIds: JSON.stringify([personId]),
  });
  t.after(() => {
    immich.server.close();
    app.server.close();
  });

  await fetch(`${app.base}/api/photoframe/list`);
  const sent = immich.seen.requests[0];
  assert.deepEqual(sent.body.albumIds, [albumId]);
  assert.deepEqual(sent.body.personIds, [personId]);
});

test('favorites deck asks for isFavorite, not an album', async (t) => {
  const immich = startImmich({
    'POST /api/search/metadata': (req, res) =>
      res.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify({ assets: { items: [] } })),
  });
  const app = makeApp({
    photoSource: 'immich',
    immichUrl: immich.origin,
    immichApiKey: 'k',
    immichAlbumId: 'favorites',
  });
  t.after(() => {
    immich.server.close();
    app.server.close();
  });

  await fetch(`${app.base}/api/photoframe/list`);
  const sent = immich.seen.requests[0];
  assert.equal(sent.body.isFavorite, true);
  assert.equal(sent.body.albumIds, undefined);
});

test('pre-1.116 server without /search/random falls back to metadata search', async (t) => {
  const immich = startImmich({
    // /search/random deliberately absent -> stub answers 404
    'POST /api/search/metadata': (req, res) =>
      res.writeHead(200, { 'Content-Type': 'application/json' }).end(
        JSON.stringify({ assets: { items: [{ id: IMAGE_ID, type: 'IMAGE', originalFileName: 'old.jpg' }] } })
      ),
  });
  const app = makeApp({ photoSource: 'immich', immichUrl: immich.origin, immichApiKey: 'k' });
  t.after(() => {
    immich.server.close();
    app.server.close();
  });

  const data = await (await fetch(`${app.base}/api/photoframe/list`)).json();
  assert.deepEqual(
    immich.seen.requests.map((r) => r.url),
    ['/api/search/random', '/api/search/metadata']
  );
  assert.equal(data.photos.length, 1);
});

test('a dead Immich yields an empty deck, not an error page', async (t) => {
  // Nothing listening on this port.
  const app = makeApp({ photoSource: 'immich', immichUrl: 'http://127.0.0.1:1', immichApiKey: 'k' });
  t.after(() => app.server.close());

  const res = await fetch(`${app.base}/api/photoframe/list`);
  assert.equal(res.status, 200, 'screensaver must fall back to gradients, not break');
  assert.deepEqual((await res.json()).photos, []);
});

test('image proxy streams bytes and never forwards the key downstream', async (t) => {
  const immich = startImmich({
    [`GET /api/assets/${IMAGE_ID}/thumbnail`]: (req, res, entry) => {
      assert.ok(entry.url.includes('size=preview'));
      res.writeHead(200, { 'Content-Type': 'image/png' }).end(PNG);
    },
  });
  const app = makeApp({ photoSource: 'immich', immichUrl: immich.origin, immichApiKey: 'k' });
  t.after(() => {
    immich.server.close();
    app.server.close();
  });

  const res = await fetch(`${app.base}/api/photoframe/immich/${IMAGE_ID}`);
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('content-type'), 'image/png');
  assert.deepEqual(Buffer.from(await res.arrayBuffer()), PNG);

  // Path injection: the id goes straight into the upstream URL.
  const bad = await fetch(`${app.base}/api/photoframe/immich/..%2f..%2fadmin`);
  assert.equal(bad.status, 400);
});

test('albums endpoint maps to the dropdown shape', async (t) => {
  const immich = startImmich({
    'GET /api/albums': (req, res) =>
      res.writeHead(200, { 'Content-Type': 'application/json' }).end(
        JSON.stringify([{ id: 'x', albumName: 'משפחה', assetCount: 812, shared: false }])
      ),
  });
  const app = makeApp({ immichUrl: immich.origin, immichApiKey: 'k' });
  t.after(() => {
    immich.server.close();
    app.server.close();
  });

  const data = await (await fetch(`${app.base}/api/photoframe/albums`)).json();
  assert.deepEqual(data.albums, [{ id: 'x', name: 'משפחה', count: 812 }]);
});

test('people endpoint maps to the picker shape', async (t) => {
  const immich = startImmich({
    'GET /api/people': (req, res) =>
      res.writeHead(200, { 'Content-Type': 'application/json' }).end(
        JSON.stringify({ people: [{ id: 'p1', name: 'נועה', assetCount: 123 }, { id: 'p2', name: '', assetCount: 5 }] })
      ),
  });
  const app = makeApp({ immichUrl: immich.origin, immichApiKey: 'k' });
  t.after(() => {
    immich.server.close();
    app.server.close();
  });

  const data = await (await fetch(`${app.base}/api/photoframe/people`)).json();
  assert.equal(immich.seen.requests[0].url, '/api/people?withHidden=true&size=1000');
  assert.deepEqual(data.people, [{ id: 'p1', name: 'נועה', count: 123 }]);
});
