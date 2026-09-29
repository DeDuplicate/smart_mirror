'use strict';

// Self-check for camera source URLs and password handling. No framework:
//   node backend/test-cameras.js
// Covers what would leak or break silently: a password with URL-special
// characters corrupting the source URL, a password reaching an API response,
// and a masked '***' being saved over the real password.

const assert = require('node:assert/strict');
const { sourcesFor, streamPlan, normalize, toPublic, maskUrl, keepUrlPassword } =
  require('./routes/cameras')._internals;

const base = { id: 'c1', host: '192.168.1.20', username: 'admin', password: 'p@ss:w/rd#1', channel: 2 };
const AUTH = 'admin:p%40ss%3Aw%2Frd%231@';

// --- composition per kind (user/pass URL-encoded) ---------------------------
assert.deepEqual(sourcesFor({ ...base, kind: 'hikvision', httpPort: 8080 }), {
  main: `rtsp://${AUTH}192.168.1.20:554/Streaming/Channels/201`,
  sub: `rtsp://${AUTH}192.168.1.20:554/Streaming/Channels/202`,
  snap: `http://${AUTH}192.168.1.20:8080/ISAPI/Streaming/channels/201/picture`,
});
assert.deepEqual(sourcesFor({ ...base, kind: 'dahua', port: 5554 }), {
  main: `rtsp://${AUTH}192.168.1.20:5554/cam/realmonitor?channel=2&subtype=0`,
  sub: `rtsp://${AUTH}192.168.1.20:5554/cam/realmonitor?channel=2&subtype=1`,
  snap: `http://${AUTH}192.168.1.20:80/cgi-bin/snapshot.cgi?channel=2`,
});
assert.deepEqual(sourcesFor({ ...base, kind: 'dvrip' }), { // 0-based channel
  main: `dvrip://${AUTH}192.168.1.20:34567?channel=1&subtype=0`,
  sub: `dvrip://${AUTH}192.168.1.20:34567?channel=1&subtype=1`,
});
assert.deepEqual(sourcesFor({ ...base, kind: 'onvif', port: 2020 }), {
  main: `onvif://${AUTH}192.168.1.20:2020`,
  sub: `onvif://${AUTH}192.168.1.20:2020?subtype=1`,
  snap: `onvif://${AUTH}192.168.1.20:2020?subtype=1&snapshot`,
});
assert.deepEqual(sourcesFor({ ...base, kind: 'frigate', frigateCamera: 'front_door' }, 'http://10.0.0.5:5000'), {
  main: 'rtsp://10.0.0.5:8554/front_door',
  snap: 'http://10.0.0.5:5000/api/front_door/latest.jpg?height=720',
});
assert.equal(sourcesFor({ ...base, kind: 'frigate', frigateCamera: 'x' }, ''), null, 'frigate needs frigateUrl');
assert.deepEqual(sourcesFor({ ...base, kind: 'onvif', username: '', password: 'x' }).main, 'onvif://192.168.1.20:80');

// rtsp kind: sub = main -> one go2rtc stream, not two connections.
const rtspPlan = streamPlan({ id: 'c2', kind: 'rtsp', source: 'rtsp://u:p@cam/live' });
assert.deepEqual(rtspPlan.streams, { c2: 'rtsp://u:p@cam/live' });
assert.deepEqual(rtspPlan.names, { main: 'c2', sub: 'c2', snap: null });
const hikPlan = streamPlan({ ...base, kind: 'hikvision' });
assert.deepEqual(Object.keys(hikPlan.streams), ['c1', 'c1_sub', 'c1_snap']);
assert.deepEqual(streamPlan({ id: 'c3', kind: 'http', source: 'http://x/snap.jpg' }).names, { main: 'c3', sub: 'c3', snap: 'c3' });

// --- masking ----------------------------------------------------------------
assert.equal(maskUrl('rtsp://admin:secret@cam:554/x'), 'rtsp://admin:***@cam:554/x');
assert.equal(maskUrl('rtsp://admin:se@cret@cam/x'), 'rtsp://admin:***@cam/x', 'last @ ends userinfo, as in Go');
assert.equal(maskUrl('rtsp://admin@cam/x'), 'rtsp://admin@cam/x');
assert.equal(maskUrl('rtsp://cam/x?user=a@b'), 'rtsp://cam/x?user=a@b', '@ in the query is not userinfo');
assert.equal(maskUrl(''), '');

const pub = toPublic({ ...base, kind: 'rtsp', source: 'rtsp://admin:secret@cam/x', port: null, httpPort: null, frigateCamera: '', motionEntity: '', enabled: true, sort: 0 });
assert.equal(pub.password, undefined);
assert.equal(pub.passwordSet, true);
assert.equal(pub.source, 'rtsp://admin:***@cam/x');
assert.ok(!JSON.stringify(pub).includes('secret') && !JSON.stringify(pub).includes('p@ss'));

// --- keep-on-update -----------------------------------------------------------
assert.equal(keepUrlPassword('rtsp://admin:***@cam2/x', 'rtsp://admin:secret@cam/x'), 'rtsp://admin:secret@cam2/x');
assert.equal(keepUrlPassword('rtsp://admin:new@cam/x', 'rtsp://admin:secret@cam/x'), 'rtsp://admin:new@cam/x');
assert.equal(keepUrlPassword('rtsp://admin:***@cam/x', 'rtsp://cam/x'), 'rtsp://admin@cam/x', 'nothing stored -> drop the mask');

const stored = { ...base, kind: 'hikvision', name: 'Door', port: null, httpPort: null, source: '', frigateCamera: '', motionEntity: '', enabled: true, sort: 0 };
for (const password of [undefined, null, '', '***']) {
  assert.equal(normalize({ ...toPublic(stored), password }, stored).cam.password, base.password, `keeps on ${password}`);
}
assert.equal(normalize({ password: 'changed' }, stored).cam.password, 'changed');
assert.equal(normalize({ enabled: false }, stored).cam.enabled, false, 'partial update merges');

const storedRtsp = { ...stored, kind: 'rtsp', source: 'rtsp://admin:secret@cam/x' };
assert.equal(normalize(toPublic(storedRtsp), storedRtsp).cam.source, 'rtsp://admin:secret@cam/x', 'round-trip keeps it');

// --- boundary validation ------------------------------------------------------
const bad = (body) => normalize(body, null).errors.length > 0;
assert.ok(bad({ name: 'x', kind: 'exec', source: 'exec:rm -rf /' }), 'kind whitelist');
assert.ok(bad({ name: 'x', kind: 'rtsp', source: 'exec:ffmpeg -i x' }), 'no exec sources');
assert.ok(bad({ name: 'x', kind: 'rtsp', source: 'ffmpeg:rtsp://cam/x#video=h264' }), 'no ffmpeg (exec) sources');
assert.ok(bad({ name: 'x', kind: 'hikvision', host: 'cam; rm -rf' }), 'host sanity');
assert.ok(bad({ name: 'x', kind: 'hikvision', host: 'cam', port: 70000 }), 'port range');
assert.ok(bad({ name: 'x', kind: 'dahua', host: 'cam', channel: 1.5 }), 'channel int');
assert.ok(bad({ name: '', kind: 'onvif', host: 'cam' }), 'name required');
assert.ok(bad({ name: 'x', kind: 'frigate' }), 'frigate needs a camera name');
assert.ok(!bad({ name: 'x', kind: 'dahua', host: 'nvr.local', port: '554', channel: '3' }), 'numeric strings accepted');
assert.equal(normalize({ name: 'x', kind: 'dahua', host: 'nvr', source: 'rtsp://a:b@c' }, null).cam.source, '', 'unused source dropped');

console.log('test-cameras: all checks passed');
