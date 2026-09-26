// Can the kid see it? A straight line from the kid's eye to a point, blocked
// by any building whose roof stands above the line there (the collision
// boxes carry their roof heights), so from the helicopter the kid sees over
// low roofs and from the street only down the street. Used by the music
// (G12: the chase tune starts once a getaway car is in sight).

import { inBox, type CollisionBox } from '../../worlds/cityChunk.js';

/** the step along the line (m) — narrower than any building */
const STEP = 2.5;

/** is the line from (x0, z0) at height h0 to (x1, z1) at height h1 clear of
 * every box? */
export function lineOfSight(x0: number, z0: number, h0: number, x1: number, z1: number, h1: number, boxes: readonly CollisionBox[]): boolean {
  const lx = Math.min(x0, x1), hx = Math.max(x0, x1), lz = Math.min(z0, z1), hz = Math.max(z0, z1);
  // (only buildings — boxes with a roof — near the line)
  const near = boxes.filter(b => (b.top ?? 0) > Math.min(h0, h1) && b.x2 >= lx && b.x1 <= hx && b.z2 >= lz && b.z1 <= hz);
  if (!near.length) return true;
  const n = Math.max(1, Math.ceil(Math.hypot(x1 - x0, z1 - z0) / STEP));
  // (the ends themselves are skipped: a car beside a wall is still seen)
  for (let i = 1; i < n; i++) {
    const s = i / n, x = x0 + (x1 - x0) * s, z = z0 + (z1 - z0) * s, h = h0 + (h1 - h0) * s;
    for (const b of near) if ((b.top ?? 0) > h && inBox(b, x, z, 0)) return false;
  }
  return true;
}
