// The river: a seeded, meandering ribbon of water flowing from the north shore
// to the south shore of the island. Everything about it is decided here so the
// city plan (streets, lots, districts), the chunk baker and the transit layer
// can all ask the same questions:
//
//   - where is the water?            near / inWater / distTo
//   - where do roads cross it?       (bridges — the plan carves those)
//   - what does the minimap draw?    pts
//
// The river is drivable — it's a shallow ford. Trucks slow down and splash;
// proper bridges carry the streets across.
import { rng, chunkSeed } from '../engine/rng.js';
import { makePath, type WorldPath } from './spline.js';
import { WORLD_CHUNKS, ISLAND, CENTER, BRIDGE_X } from './world.js';

const SPAWN = { x: CENTER, z: CENTER };

export interface RiverRoute {
  /** centreline path, north (z<0) to south (z>ISLAND) */
  path: WorldPath;
  /** dense centreline samples with local water width (metres) */
  pts: Array<{ x: number; z: number; w: number; h: number }>;
  /** distance from (x, z) to the centreline */
  distTo(x: number, z: number): number;
  /** water half-width at the point nearest to (x, z) */
  halfAt(x: number, z: number): number;
  /** true when the point sits on the water */
  inWater(x: number, z: number): boolean;
  /** within r metres of the centreline (corridor test for buildings) */
  near(x: number, z: number, r: number): boolean;
}

// module-level cache per seed
const cache = new Map<number, RiverRoute>();

/** test/audit hook: rivers are cached per seed, so switching the city base
 * seed requires a flush or stale rivers come back */
export function clearRiverCache(): void { cache.clear(); }

export function riverFor(seed: number): RiverRoute {
  let rv = cache.get(seed);
  if (!rv) {
    rv = buildRiver(seed);
    cache.set(seed, rv);
  }
  return rv;
}

function buildRiver(seed: number): RiverRoute {
  // rejection-sampled sine meander: x(z) = X0 + drift*z + waves, single-valued
  let samples: Array<{ x: number; z: number; w: number }> | null = null;
  for (let attempt = 0; attempt < 48 && !samples; attempt++) {
    samples = tryRiver(rng(chunkSeed(seed, 0x71f3, attempt)));
  }
  samples ??= fallbackRiver(seed);
  const path = makePath(samples.map(p => ({ x: p.x, z: p.z })), false);
  const pts = path.pts.map(p => {
    // width swells gently along the run
    const u = Math.min(1, Math.max(0, p.z / ISLAND));
    const w = 10.5 + 2.6 * Math.sin(u * 5.2 + p.x * 0.05) + 1.6 * Math.sin(u * 11 + 2);
    return { x: p.x, z: p.z, h: p.h, w: Math.max(8.5, Math.min(15.5, w)) };
  });
  const route: RiverRoute = {
    path,
    pts,
    distTo(x, z) { return Math.sqrt(path.nearest(x, z).d2); },
    halfAt(x, z) { return pts[path.nearest(x, z).i].w / 2; },
    inWater(x, z) {
      const n = path.nearest(x, z);
      return Math.sqrt(n.d2) < pts[n.i].w / 2;
    },
    near(x, z, r) { return path.nearest(x, z).d2 < r * r; },
  };
  return route;
}

/** One candidate meander; null when it violates a hard constraint. */
function tryRiver(r: () => number): Array<{ x: number; z: number; w: number }> | null {
  const x0 = CENTER * 0.45 + r() * CENTER * 0.5; // north mouth, west of the bridge
  const drift = -(0.10 + r() * 0.08);            // swings west as it flows south
  const a1 = 30 + r() * 34, w1 = 0.006 + r() * 0.005, p1 = r() * Math.PI * 2;
  const a2 = 12 + r() * 14, w2 = 0.013 + r() * 0.008, p2 = r() * Math.PI * 2;
  const out: Array<{ x: number; z: number; w: number }> = [];
  for (let z = -30; z <= ISLAND + 30; z += 12) {
    const x = x0 + drift * z + a1 * Math.sin(z * w1 + p1) + a2 * Math.sin(z * w2 + p2);
    out.push({ x, z, w: 0 });
  }
  const raceEdge = (WORLD_CHUNKS - 2) * 64 - 8;
  for (const s of out) {
    if (s.x < 34 || s.x > ISLAND - 34) return null;
    // keep clear of the fire-station spawn
    if (Math.hypot(s.x - SPAWN.x, s.z - SPAWN.z) < 44) return null;
    // the SE corner is the race circuit
    if (s.z > raceEdge && s.x > raceEdge) return null;
    // the bridge + picnic causeway hang off the south shore around BRIDGE_X
    if (s.z > ISLAND - 70 && Math.abs(s.x - BRIDGE_X) < 46) return null;
  }
  return out;
}

function fallbackRiver(seed: number): Array<{ x: number; z: number; w: number }> {
  const r = rng(chunkSeed(seed, 0x71f4, 7));
  const p1 = r() * Math.PI * 2;
  const out: Array<{ x: number; z: number; w: number }> = [];
  for (let z = -30; z <= ISLAND + 30; z += 12) {
    out.push({ x: CENTER * 0.42 + 16 * Math.sin(z * 0.008 + p1), z, w: 0 });
  }
  return out;
}
