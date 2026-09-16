// Self-check for the screensaver's backdrop dither.
//
// The dither exists because blurring a dark photo makes a gradient too smooth
// for an 8-bit surface: on the mirror, the blurred backdrop measured 94
// distinct colours against 50,790 in the sharp photo beside it, which reads as
// topographic contour banding.
//
// The failure this pins is one already made once: the noise was written as
// `.photo-backdrop::after`, i.e. INSIDE the element carrying
// `filter: blur(...)`. A CSS filter applies to the whole subtree, so the noise
// was itself blurred to flat grey and did nothing — while still rendering,
// still passing a build, and still measuring as "more colours". Nothing short
// of looking at the screen caught it.
//
// Run: node backdrop-dither.test.mjs   (from frontend/)
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const dir = path.dirname(fileURLToPath(import.meta.url));
const css = readFileSync(path.join(dir, 'src/styles/global.css'), 'utf8');
const jsx = readFileSync(path.join(dir, 'src/components/Screensaver.jsx'), 'utf8');

// ── The blurred layer still blurs ──
const backdrop = css.match(/\.photo-backdrop\s*\{([^}]*)\}/)?.[1];
assert.ok(backdrop, '.photo-backdrop rule is missing');
assert.match(backdrop, /filter:\s*blur\(/, '.photo-backdrop must carry the blur');

// ── The dither exists and is a separate rule, not a pseudo-element of it ──
assert.doesNotMatch(
  css,
  /\.photo-backdrop::(after|before)/,
  'dither must not be a pseudo-element of .photo-backdrop — the filter would blur it away'
);
const dither = css.match(/\.photo-backdrop-dither\s*\{([^}]*)\}/)?.[1];
assert.ok(dither, '.photo-backdrop-dither rule is missing');
assert.match(dither, /feTurbulence/, 'dither needs its noise source');
assert.doesNotMatch(dither, /filter:/, 'the dither layer must not be filtered itself');

// ── ...and it must not be a DESCENDANT selector either ──
assert.doesNotMatch(
  css,
  /\.photo-backdrop\s+\.photo-backdrop-dither/,
  'dither must not be nested inside .photo-backdrop'
);

// ── In the markup, the backdrop div must be CLOSED before the dither div ──
const backdropIdx = jsx.indexOf('photo-backdrop"');
const ditherIdx = jsx.indexOf('photo-backdrop-dither');
assert.ok(backdropIdx > -1, 'Screensaver must render .photo-backdrop');
assert.ok(ditherIdx > backdropIdx, 'Screensaver must render the dither after the backdrop');
const between = jsx.slice(backdropIdx, ditherIdx);
assert.ok(
  between.includes('/>'),
  'the .photo-backdrop element must be self-closed before the dither — otherwise the dither is its child and gets blurred'
);

console.log('backdrop-dither: all checks passed (dither is a sibling, not filtered)');
