// The surf foam tracing an island's shore, just out from the beach: white
// strips 3 m wide laid end to end round the coast (scenery.ts draws them with
// their own translucent material). Their top, FOAM_TOP, is the lowest of the
// ground's layer ladder (R42): the causeway decks, the picnic bridge and the
// airport's causeway all started at 0.10 where they leave the beach, and the
// foam used to be 0.10 too — exactly coplanar, so white flecks flickered on
// the decks where they cross the foam.
import type { Baked } from '../../engine/baked.js';
import { coastFor } from '../../worlds/coast.js';

/** the foam's top (m): 1 cm under the picnic island's sand (0.08), which is
 * 1 cm under the beach slab (0.09), the island's grass slab (0.10) and the
 * decks (0.11) — each a layer the foam can overlap at a headland. (The sea
 * itself doesn't write depth: the foam's height only matters to what is
 * opaque.) */
export const FOAM_TOP = 0.07;

/** lay island (bx, by)'s foam ring into `F`, offset by (ox, oz) */
export function bakeFoam(F: Baked, bx: number, by: number, ox: number, oz: number): void {
  const coast = coastFor(bx, by);
  const ring = coast.pts.map(p => coast.shoreToward(p.x, p.z, 1.8));
  for (let i = 0; i < ring.length; i++) {
    const a = ring[i], b = ring[(i + 1) % ring.length];
    const len = Math.hypot(b.x - a.x, b.z - a.z) + 0.6;
    F.box(3, FOAM_TOP, len, 0xffffff, ox + (a.x + b.x) / 2, FOAM_TOP / 2, oz + (a.z + b.z) / 2, 0, Math.atan2(b.x - a.x, b.z - a.z), 0);
  }
}
