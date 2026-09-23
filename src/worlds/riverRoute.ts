// The river: a seeded ribbon of water flowing from the north shore to the
// south shore of the island. Everything about it is decided here so the
// city plan (streets, lots, districts), the chunk baker and the transit layer
// can all ask the same questions:
//
//   - where is the water?            near / inWater / distTo
//   - where do roads cross it?       (bridges — the plan carves those)
//   - what does the minimap draw?    pts
//
// Shape rules (R26): the river lives INSIDE one north-south corridor between
// two lattice lanes, so it never crosses a north-south street and never runs
// underneath one; it reaches the ocean on both ends; and at every east-west
// street it is straightened to flow due south, so bridges always meet it at
// a right angle — never 45 degrees.
//
// The river is drivable — it's a shallow ford. Trucks slow down and splash;
// proper bridges carry the streets across.
import { rng, chunkSeed } from '../engine/rng.js';
import { makePath, type WorldPath } from './spline.js';
import { WORLD_CHUNKS, ISLAND, CENTER, BRIDGE_X } from './world.js';

const SPAWN = { x: CENTER, z: CENTER };
const LANE = 64; // lattice spacing

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
  // rejection-sampled wobble inside the chosen corridor
  const lane = pickCorridor(seed);
  let samples: Array<{ x: number; z: number; w: number }> | null = null;
  for (let attempt = 0; attempt < 48 && !samples; attempt++) {
    samples = tryRiver(rng(chunkSeed(seed, 0x71f3, attempt)), lane);
  }
  samples ??= fallbackRiver(lane);
  // two passes: the second flattens the residual slope the first one's
  // blend windows leave a few metres off the line
  samples = straightenAtStreets(straightenAtStreets(samples));
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

/** the north-south lane the river lives in: an interior corridor between two
 * lattice columns, kept clear of the picnic causeway and the fire-station
 * spawn. Inside it the river can never cross — or run beneath — a
 * north-south street. */
function pickCorridor(seed: number): number {
  const r = rng(chunkSeed(seed, 0x71f5, 1));
  const lanes: number[] = [];
  for (let k = 1; k < WORLD_CHUNKS - 1; k++) {
    const cx = k * LANE + LANE / 2;
    if (Math.abs(cx - BRIDGE_X) < 100) continue;
    if (Math.abs(cx - SPAWN.x) < 60) continue;
    lanes.push(k);
  }
  return lanes.length ? lanes[(r() * lanes.length) | 0] : 3;
}

/** One candidate wobble; null when it escapes the corridor or fouls a guard.
 * The wobble budget (±18 m around the lane centre) keeps water + banks at
 * least ~13 m clear of both bounding lattice lines. */
function tryRiver(r: () => number, lane: number): Array<{ x: number; z: number; w: number }> | null {
  const cx0 = lane * LANE + LANE / 2;
  const a1 = 5 + r() * 12, w1 = 0.006 + r() * 0.006, p1 = r() * Math.PI * 2;
  const a2 = 2 + r() * 6, w2 = 0.015 + r() * 0.012, p2 = r() * Math.PI * 2;
  if (a1 + a2 > 18) return null;
  const out: Array<{ x: number; z: number; w: number }> = [];
  for (let z = -30; z <= ISLAND + 30; z += 12) {
    const x = cx0 + a1 * Math.sin(z * w1 + p1) + a2 * Math.sin(z * w2 + p2);
    out.push({ x, z, w: 0 });
  }
  for (const s of out) {
    if (s.x < lane * LANE + 13 || s.x > (lane + 1) * LANE - 13) return null;
    // keep clear of the fire-station spawn
    if (Math.hypot(s.x - SPAWN.x, s.z - SPAWN.z) < 44) return null;
  }
  return out;
}

/** at every east-west lattice line, straighten the flow to due south so a
 * bridge there meets the water at a right angle. The blend window (±26 m)
 * fades the straightening out; windows are 64 m apart so they never stack. */
function straightenAtStreets(
  samples: Array<{ x: number; z: number; w: number }>,
): Array<{ x: number; z: number; w: number }> {
  let cur = samples.map(p => ({ ...p }));
  for (let j = 1; j < WORLD_CHUNKS; j++) {
    const zj = j * LANE;
    // the river's own x at this line (samples are 12 m apart in z)
    let xc = cur[cur.length - 1].x;
    for (let k = 0; k + 1 < cur.length; k++) {
      if ((cur[k].z - zj) * (cur[k + 1].z - zj) <= 0) {
        const f = (zj - cur[k].z) / ((cur[k + 1].z - cur[k].z) || 1);
        xc = cur[k].x + (cur[k + 1].x - cur[k].x) * f;
        break;
      }
    }
    cur = cur.map(p => {
      const t = Math.abs(p.z - zj) / 26;
      if (t >= 1) return p;
      const w = t * t * (3 - 2 * t); // smoothstep: tangent exactly vertical at zj
      return { x: xc + (p.x - xc) * w, z: p.z, w: p.w };
    });
  }
  return cur;
}

function fallbackRiver(lane: number): Array<{ x: number; z: number; w: number }> {
  const cx0 = lane * LANE + LANE / 2;
  const out: Array<{ x: number; z: number; w: number }> = [];
  for (let z = -30; z <= ISLAND + 30; z += 12) {
    out.push({ x: cx0 + 6 * Math.sin(z * 0.01 + 1.3), z, w: 0 });
  }
  return out;
}
