// Run with plain node: node frontend/src/hooks/avatarCrop.test.mjs
import assert from 'node:assert/strict';
import { coverScale, initialCrop, placement, panBy, zoomBy, sourceRect, MAX_ZOOM } from './avatarCrop.js';

const V = 360;
const near = (a, b, msg) => assert.ok(Math.abs(a - b) < 1e-6, `${msg}: ${a} vs ${b}`);

// ─── a tall phone photo (1440 x 3200), the kind this family's library is full of
{
  const nw = 1440, nh = 3200;
  near(coverScale(nw, nh, V), V / nw, 'covers by width');

  const crop = initialCrop(nw, nh);
  assert.ok(crop.cy < 0.4, 'opens on the top part of a tall photo, where faces are');
  const r = sourceRect(crop, nw, nh, V);
  near(r.size, nw, 'at zoom 1 the square is as wide as the photo');
  assert.ok(r.sy >= 0 && r.sy + r.size <= nh, 'inside the image');
  assert.ok(r.sy < (nh - r.size) / 2, 'above the middle');

  // dragging the image down (finger moves down) reveals what was above: sy shrinks
  const down = panBy(crop, 0, 80, nw, nh, V);
  assert.ok(sourceRect(down, nw, nh, V).sy < r.sy, 'drag down shows higher up');
  // and it can never leave the image
  const far = panBy(crop, 0, 100000, nw, nh, V);
  near(sourceRect(far, nw, nh, V).sy, 0, 'stops at the top edge');
  const farUp = panBy(crop, 0, -100000, nw, nh, V);
  near(sourceRect(farUp, nw, nh, V).sy + sourceRect(farUp, nw, nh, V).size, nh, 'stops at the bottom edge');
  // a photo exactly as wide as the viewport has no sideways room
  near(sourceRect(panBy(crop, 500, 0, nw, nh, V), nw, nh, V).sx, 0, 'no sideways drag at zoom 1');
}

// ─── zoom
{
  const nw = 1000, nh = 1000;
  let crop = initialCrop(nw, nh);
  const before = sourceRect(crop, nw, nh, V);
  crop = zoomBy(crop, 2, nw, nh, V);
  const after = sourceRect(crop, nw, nh, V);
  near(after.size, before.size / 2, 'zooming in halves the area shown');
  // the point at the centre stays the centre
  near(after.sx + after.size / 2, before.sx + before.size / 2, 'x centre kept');
  near(after.sy + after.size / 2, before.sy + before.size / 2, 'y centre kept');
  for (let i = 0; i < 30; i++) crop = zoomBy(crop, 1.25, nw, nh, V);
  assert.equal(crop.zoom, MAX_ZOOM, 'zoom has a ceiling');
  for (let i = 0; i < 60; i++) crop = zoomBy(crop, 0.8, nw, nh, V);
  assert.equal(crop.zoom, 1, 'and a floor: never smaller than covering the square');
}

// ─── zooming near an edge never exposes empty space
{
  const nw = 2000, nh = 1000;                       // landscape
  let crop = { cx: 0.05, cy: 0.5, zoom: 1 };        // hard against the left edge
  crop = zoomBy(crop, 3, nw, nh, V);
  const r = sourceRect(crop, nw, nh, V);
  assert.ok(r.sx >= -1e-6 && r.sx + r.size <= nw + 1e-6, 'inside horizontally');
  assert.ok(r.sy >= -1e-6 && r.sy + r.size <= nh + 1e-6, 'inside vertically');
}

// ─── a landscape photo can be dragged sideways
{
  const nw = 2000, nh = 1000;
  const crop = initialCrop(nw, nh);
  const r0 = sourceRect(crop, nw, nh, V);
  near(r0.size, nh, 'landscape: the square is as tall as the photo');
  const right = panBy(crop, -200, 0, nw, nh, V);    // finger moves left: image moves left
  assert.ok(sourceRect(right, nw, nh, V).sx > r0.sx, 'drag left shows further right');
}

// ─── placement is consistent with sourceRect
{
  const nw = 900, nh = 1600;
  const crop = { cx: 0.4, cy: 0.35, zoom: 1.6 };
  const p = placement(crop, nw, nh, V);
  const r = sourceRect(crop, nw, nh, V);
  near(r.sx * p.scale, -p.left, 'left');
  near(r.sy * p.scale, -p.top, 'top');
}

console.log('avatarCrop: all assertions passed');
