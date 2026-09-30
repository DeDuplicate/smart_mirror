'use strict';

// Run with: node --test backend/test-sonos.js
//
// There is no real Sonos on the dev network, so this stands up a fake
// household - three speakers as separate local UPnP/SOAP servers - and drives
// the adapter through the REAL @svrooij/sonos library against it. That proves
// the wiring (which speaker each command reaches, how state is mapped); it
// cannot prove how a physical speaker behaves.
const assert = require('node:assert/strict');
const http = require('node:http');
const test = require('node:test');
const sonos = require('./routes/sonos');
const { parseHms, toHms, parseHosts, haState } = sonos._test;

const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const soap = (service, action, inner = '') =>
  `<?xml version="1.0"?><s:Envelope xmlns:s="http://schemas.xmlsoap.org/soap/envelope/" s:encodingStyle="http://schemas.xmlsoap.org/soap/encoding/"><s:Body><u:${action}Response xmlns:u="urn:schemas-upnp-org:service:${service}:1">${inner}</u:${action}Response></s:Body></s:Envelope>`;

const DIDL = `<DIDL-Lite xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:upnp="urn:schemas-upnp-org:metadata-1-0/upnp/" xmlns:r="urn:schemas-rinconnetworks-com:metadata-1-0/" xmlns="urn:schemas-upnp-org:metadata-1-0/DIDL-Lite/"><item id="-1" parentID="-1" restricted="true"><res protocolInfo="http-get:*:audio/mp4:*" duration="0:03:47">http://lan/song.m4a</res><dc:title>Song Name</dc:title><upnp:class>object.item.audioItem.musicTrack</upnp:class></item></DIDL-Lite>`;

/** One fake speaker. `topology` is only consulted when it is asked for one. */
function fakeSpeaker({ transport = 'PLAYING', volume = 35, topology } = {}) {
  const calls = [];
  const server = http.createServer((req, res) => {
    let body = '';
    req.on('data', (c) => { body += c; });
    req.on('end', () => {
      const [, service, action] = /service:(\w+):1#(\w+)/.exec(req.headers.soapaction || '') || [];
      calls.push({ action, body });
      let inner = '';
      if (action === 'GetZoneGroupState') {
        inner = `<ZoneGroupState>${esc(topology())}</ZoneGroupState>`;
      } else if (action === 'GetTransportInfo') {
        inner = `<CurrentTransportState>${transport}</CurrentTransportState><CurrentTransportStatus>OK</CurrentTransportStatus><CurrentSpeed>1</CurrentSpeed>`;
      } else if (action === 'GetPositionInfo') {
        inner = `<Track>1</Track><TrackDuration>0:03:47</TrackDuration><TrackMetaData>${esc(DIDL)}</TrackMetaData><TrackURI>http://lan/song.m4a</TrackURI><RelTime>0:01:23</RelTime><AbsTime>NOT_IMPLEMENTED</AbsTime><RelCount>2147483647</RelCount><AbsCount>2147483647</AbsCount>`;
      } else if (action === 'GetVolume') {
        inner = `<CurrentVolume>${volume}</CurrentVolume>`;
      }
      res.writeHead(200, { 'Content-Type': 'text/xml; charset="utf-8"' });
      res.end(soap(service || 'AVTransport', action || 'Unknown', inner));
    });
  });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve({
    port: server.address().port, calls, server, close: () => new Promise((r) => server.close(r)),
  })));
}

const member = (uuid, name, port, invisible = 0) =>
  `<ZoneGroupMember UUID="${uuid}" Location="http://127.0.0.1:${port}/xml/device_description.xml" ZoneName="${name}" Icon="x-rincon-roomicon:living" Invisible="${invisible}" SoftwareVersion="80.1" SWGen="2"/>`;

test('pure helpers', () => {
  assert.equal(parseHms('0:03:47'), 227);
  assert.equal(parseHms('NOT_IMPLEMENTED'), 0);
  assert.equal(toHms(83), '0:01:23');
  assert.equal(toHms(3725.4), '1:02:05');
  assert.deepEqual(parseHosts('192.168.1.5, sonos.lan:1401;bad host!'), [
    { host: '192.168.1.5', port: 1400 }, { host: 'sonos.lan', port: 1401 }, { host: 'bad', port: 1400 },
  ]);
  assert.deepEqual(parseHosts(''), []);

  const room = { id: 'sonos:X', name: 'Den', groupSize: 1 };
  const pos = { RelTime: '0:00:10', TrackDuration: '0:01:00', TrackMetaData: { Title: 'T' }, TrackURI: 'u' };
  const st = (s) => haState(room, { CurrentTransportState: s }, pos, { CurrentVolume: 40 }, 0).state;
  assert.equal(st('PLAYING'), 'playing');
  assert.equal(st('PAUSED_PLAYBACK'), 'paused');
  assert.equal(st('STOPPED'), 'idle'); // what the frontend waits for to auto-advance
  assert.equal(st('TRANSITIONING'), 'buffering'); // the load gap must not look like the end
  assert.equal(haState(room, { CurrentTransportState: 'PLAYING' }, pos, { CurrentVolume: 40 }, 0).attributes.volume_level, 0.4);
});

test('a fake household: rooms, state, and commands reach the right speaker', async (t) => {
  const topology = () => `<ZoneGroupState><ZoneGroups>
    <ZoneGroup Coordinator="RINCON_LIVING" ID="RINCON_LIVING:1">${member('RINCON_LIVING', 'Living Room', living.port)}${member('RINCON_KITCHEN', 'Kitchen', kitchen.port)}</ZoneGroup>
    <ZoneGroup Coordinator="RINCON_BED" ID="RINCON_BED:2">${member('RINCON_BED', 'Bedroom', bedroom.port)}${member('RINCON_SUB', 'Bedroom', bedroom.port, 1)}</ZoneGroup>
  </ZoneGroups><VanishedDevices/></ZoneGroupState>`;
  const living = await fakeSpeaker({ topology });
  const kitchen = await fakeSpeaker({ transport: 'PLAYING', volume: 20, topology });
  const bedroom = await fakeSpeaker({ transport: 'STOPPED', volume: 10, topology });
  t.after(() => Promise.all([living.close(), kitchen.close(), bedroom.close()]));

  // Seed by address, exactly like the Settings field: no SSDP involved.
  sonos.init({
    db: { prepare: () => ({ get: () => ({ value: JSON.stringify(`127.0.0.1:${living.port}`) }) }) },
    logger: { info() {}, debug() {}, error() {} },
  });
  const rooms = await sonos.scan();

  await t.test('scan(): three rooms, bonded sub hidden, groups sized', () => {
    assert.deepEqual([...rooms.values()].map((r) => [r.name, r.groupSize]).sort(), [['Bedroom', 1], ['Kitchen', 2], ['Living Room', 2]]);
    const k = rooms.get('sonos:RINCON_KITCHEN');
    assert.equal(k.coordinator.port, living.port, 'Kitchen is grouped under Living Room');
  });

  await t.test('players(): HA-shaped, Sonos-classified', async () => {
    const list = await sonos.players();
    const byName = Object.fromEntries(list.map((p) => [p.attributes.friendly_name, p]));
    assert.equal(list.length, 3);
    assert.equal(byName['Living Room'].state, 'playing');
    assert.equal(byName.Bedroom.state, 'idle');
    assert.equal(byName['Living Room'].manufacturer, 'Sonos');
    assert.match(byName['Living Room'].model, /Sonos/); // matches the frontend's speaker regex
    assert.equal(byName['Living Room'].attributes.media_duration, 227);
    assert.equal(byName['Living Room'].attributes.media_position, 83);
    assert.equal(byName['Living Room'].attributes.media_title, 'Song Name');
    // Volume is per room, read from the room itself, not its coordinator.
    assert.equal(byName.Kitchen.attributes.volume_level, 0.2);
    assert.equal(byName['Living Room'].attributes.volume_level, 0.35);
  });

  await t.test('play_media on a NON-coordinator goes to the coordinator', async () => {
    [living, kitchen, bedroom].forEach((s) => { s.calls.length = 0; });
    await sonos.act('play_media', { entity_id: 'sonos:RINCON_KITCHEN', media_content_id: 'http://192.168.1.9:3001/api/music/stream/abc.m4a?token=t' });
    const actions = (s) => s.calls.map((c) => c.action);
    assert.deepEqual(actions(living), ['SetAVTransportURI', 'Play']);
    assert.deepEqual(actions(kitchen), [], 'a slave would answer UPnP error 701');
    assert.match(living.calls[0].body, /CurrentURI>http:\/\/192\.168\.1\.9:3001\/api\/music\/stream\/abc\.m4a\?token=t</);
  });

  await t.test('transport, seek and volume', async () => {
    [living, kitchen, bedroom].forEach((s) => { s.calls.length = 0; });
    await sonos.act('media_pause', { entity_id: 'sonos:RINCON_KITCHEN' });
    await sonos.act('media_seek', { entity_id: 'sonos:RINCON_LIVING', seek_position: 83 });
    await sonos.act('volume_set', { entity_id: 'sonos:RINCON_KITCHEN', volume_level: 0.5 });
    await sonos.act('volume_mute', { entity_id: 'sonos:RINCON_KITCHEN', is_volume_muted: false });
    await sonos.act('media_stop', { entity_id: 'sonos:RINCON_BED' });
    assert.deepEqual(living.calls.map((c) => c.action), ['Pause', 'Seek']);
    assert.match(living.calls[1].body, /<Target>0:01:23</);
    assert.deepEqual(kitchen.calls.map((c) => c.action), ['SetVolume', 'SetMute']); // volume stays per room
    assert.match(kitchen.calls[0].body, /<DesiredVolume>50</);
    assert.deepEqual(bedroom.calls.map((c) => c.action), ['Stop']);
  });

  await t.test('rejects what it cannot do, instead of pretending', async () => {
    await assert.rejects(sonos.act('play_media', { entity_id: 'sonos:RINCON_LIVING', media_content_id: 'file:///etc/passwd' }), /http\(s\)/);
    await assert.rejects(sonos.act('eject', { entity_id: 'sonos:RINCON_LIVING' }), /unsupported/);
    await assert.rejects(sonos.act('media_play', { entity_id: 'sonos:NOPE' }), /unknown/);
  });

  await t.test('through the real /api/ha routes, with Home Assistant NOT configured', async (t2) => {
    delete process.env.HA_TOKEN;
    const express = require('express');
    const app = express();
    app.use(express.json());
    app.locals.logger = { info() {}, warn() {}, error() {} };
    app.use('/api/ha', require('./routes/homeassistant'));
    const server = app.listen(0, '127.0.0.1');
    await new Promise((r) => server.once('listening', r));
    t2.after(() => new Promise((r) => server.close(r)));
    const base = `http://127.0.0.1:${server.address().port}/api/ha`;
    const call = (path, body) => fetch(base + path, body
      ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }
      : undefined);

    const list = await (await call('/media-players')).json();
    assert.deepEqual(list.players.map((p) => p.entity_id).sort(), ['sonos:RINCON_BED', 'sonos:RINCON_KITCHEN', 'sonos:RINCON_LIVING']);

    const one = await (await call(`/state/${encodeURIComponent('sonos:RINCON_LIVING')}`)).json();
    assert.equal(one.state.state, 'playing');
    assert.equal((await call('/state/sonos%3ANOPE')).status, 404);

    living.calls.length = 0;
    const ok = await call('/services/media_player/media_pause', { entity_id: 'sonos:RINCON_KITCHEN' });
    assert.equal(ok.status, 200);
    assert.deepEqual(living.calls.map((c) => c.action), ['Pause']);

    assert.equal((await call('/services/media_player/eject', { entity_id: 'sonos:RINCON_KITCHEN' })).status, 502);
    // Anything that is not Sonos still needs Home Assistant, exactly as before.
    assert.equal((await call('/services/media_player/media_pause', { entity_id: 'media_player.nest' })).status, 503);
    assert.equal((await call('/state/media_player.nest')).status, 503);
  });

  await t.test('an unreachable speaker reports unavailable, fast', async () => {
    await bedroom.close();
    const started = Date.now();
    const st = await sonos.state('sonos:RINCON_BED');
    assert.equal(st.state, 'unavailable');
    assert.ok(Date.now() - started < 5000);
    bedroom.close = async () => {}; // already closed; keep t.after happy
  });
});
