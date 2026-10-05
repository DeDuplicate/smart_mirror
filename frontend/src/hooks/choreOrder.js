// Pure helpers for drag-reordering a kid's chores (kept free of React so
// choreOrder.test.mjs can run under plain node).
//
// A column shows open chores first and done chores below, so a drag can only
// land among chores of its OWN group. The saved order, though, is the full
// list: moving one chore must not disturb the relative order of the rest,
// including chores of the other group, or they would come back in a different
// order after the nightly reset.

/**
 * Where would a dragged chore land?
 * `cards` are the OTHER chores of the dragged one's group, top to bottom:
 * [{ id, top, height }]. Returns { targetId, after } - insert before that card
 * (after: false) or after it (after: true) - or null when there is nothing to
 * be placed next to.
 */
export function insertionPoint(cards, pointerY) {
  for (const card of cards) {
    if (pointerY < card.top + card.height / 2) return { targetId: card.id, after: false };
  }
  const last = cards[cards.length - 1];
  return last ? { targetId: last.id, after: true } : null;
}

/**
 * Move `movedId` next to `targetId` in the full ordered id list. Everything
 * else keeps its relative order. Returns the same array when nothing applies.
 */
export function moveNextTo(ids, movedId, targetId, after) {
  if (movedId === targetId || !ids.includes(movedId)) return ids;
  const rest = ids.filter((id) => id !== movedId);
  const at = rest.indexOf(targetId);
  if (at === -1) return ids;
  rest.splice(after ? at + 1 : at, 0, movedId);
  return rest;
}
