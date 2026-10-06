// Pure maths for the avatar crop (no React, so avatarCrop.test.mjs runs under
// plain node). A square viewport of `view` px shows part of an image; the person
// drags the image under it and zooms with buttons (the IR frame is single-touch,
// so no pinch). The result is the square of the image under the viewport.
//
// A crop is { cx, cy, zoom }: the point of the image (0..1 each way) shown at the
// centre of the viewport, and a zoom of 1 or more over the "cover" scale (the
// smallest scale at which the image still fills the viewport).

export const MIN_ZOOM = 1;
export const MAX_ZOOM = 5;
export const ZOOM_STEP = 1.25;

/** Pixels per image pixel at which the image just covers the viewport. */
export const coverScale = (nw, nh, view) => Math.max(view / nw, view / nh);

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

/**
 * Where the crop starts. Tall photos are almost always people standing up, so
 * the face is in the top third, not the middle; centring would open on a chest.
 */
export function initialCrop(nw, nh) {
  return { cx: 0.5, cy: nh > nw * 1.15 ? 0.3 : 0.45, zoom: 1 };
}

/** Where the image is drawn: its top-left corner in the viewport, and its scale. */
export function placement(crop, nw, nh, view) {
  const scale = coverScale(nw, nh, view) * crop.zoom;
  const w = nw * scale;
  const h = nh * scale;
  // Keep the viewport inside the image: no empty corners in an avatar.
  const left = clamp(view / 2 - crop.cx * w, view - w, 0);
  const top = clamp(view / 2 - crop.cy * h, view - h, 0);
  return { left, top, scale, w, h };
}

/** Back to a crop from a placement, so a drag and a zoom share one state. */
function cropFrom(p, nw, nh, view, zoom) {
  return { cx: (view / 2 - p.left) / p.w, cy: (view / 2 - p.top) / p.h, zoom };
}

/** Drag by (dx, dy) viewport pixels: the image follows the finger. */
export function panBy(crop, dx, dy, nw, nh, view) {
  const p = placement(crop, nw, nh, view);
  const moved = { ...p, left: clamp(p.left + dx, view - p.w, 0), top: clamp(p.top + dy, view - p.h, 0) };
  return cropFrom(moved, nw, nh, view, crop.zoom);
}

/** Zoom by a factor, keeping what is at the centre of the viewport where it is. */
export function zoomBy(crop, factor, nw, nh, view) {
  // What is really at the centre now: a stored cx/cy that was clamped to fit
  // (a square photo at zoom 1 cannot be off-centre) is not where it looks.
  const settled = cropFrom(placement(crop, nw, nh, view), nw, nh, view, crop.zoom);
  const zoom = clamp(crop.zoom * factor, MIN_ZOOM, MAX_ZOOM);
  // placement() re-clamps the edges for the new size.
  return cropFrom(placement({ ...settled, zoom }, nw, nh, view), nw, nh, view, zoom);
}

/** The square of the source image (in its own pixels) to draw into the avatar. */
export function sourceRect(crop, nw, nh, view) {
  const p = placement(crop, nw, nh, view);
  return { sx: -p.left / p.scale, sy: -p.top / p.scale, size: view / p.scale };
}
