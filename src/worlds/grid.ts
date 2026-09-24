// The occupancy grid: ONE map per city saying what occupies every 1 m cell.
// Streets, rail, river, lots and plazas are all
// PAINTED onto it from the seeded generators, and overlaps accumulate by
// bitwise OR — so a cell under both the road and the rail reads ROAD|RAIL
// and means "level crossing", ROAD|RIVER means "bridge", RAIL|RIVER means
// "trestle". Some combinations are declared bugs (rail on a road bridge
// over the river, anything on a lot) and the audit proves they never happen.
//
// Every placement that used to hand-roll its own clearance checks against
// the other generators (trees, lamps, traffic lights, pedestrians, scatter)
// asks the grid instead. The vector generators stay the source of shape
// truth; the grid is the shared authority on what occupies where.
import { cityPlanFor, ROUNDABOUT_REACH } from './cityPlan.js';
import { coastFor } from './coast.js';
import { railNetFor, railPortals } from './railRoute.js';
import { riverFor } from './riverRoute.js';
import { ISLAND, WORLD_CHUNKS } from './world.js';
import { raceTrackFor } from './raceIsland.js';

export const ROAD = 1;
export const RAIL = 2;
export const RIVER = 4;
export const LOT = 8;
export const PLAZA = 16;
/** a race circuit's zone: track and apron (raceIsland.ts) */
export const RACE = 64;
/** off the island's shore (coast.ts) */
export const SEA = 32;
/** a causeway corridor out over the water (the only road allowed on SEA) */
export const DECK = 128;

/** props may never claim cells carrying any of these */
export const BLOCKED_FOR_PROPS = ROAD | RAIL | RIVER | LOT | PLAZA | SEA;
/** built ground a prop cannot stand on even inside its own lot (trees) */
export const STRUCTURED = ROAD | RAIL | RIVER | PLAZA | SEA;
/** wild scatter (trees, junk) may own LOT-free, built-free ground only */
export const WILD_FORBIDDEN = ROAD | RAIL | RIVER | LOT | PLAZA | SEA;

const MARGIN = 32;                       // river + causeway mouths overhang
const SIZE = ISLAND + MARGIN * 2;

export class CityGrid {
  readonly raw = new Uint8Array(SIZE * SIZE);

  /** cell bits at city-local (x, z); 0 outside the painted area */
  bits(x: number, z: number): number {
    const ix = (x | 0) + MARGIN, iz = (z | 0) + MARGIN;
    if (ix < 0 || iz < 0 || ix >= SIZE || iz >= SIZE) return 0;
    return this.raw[iz * SIZE + ix];
  }

  /** true when any cell within r metres of (x, z) carries any of `mask` */
  claims(x: number, z: number, r: number, mask: number): boolean {
    const x0 = Math.max(0, (x - r | 0) + MARGIN), x1 = Math.min(SIZE - 1, (x + r | 0) + MARGIN);
    const z0 = Math.max(0, (z - r | 0) + MARGIN), z1 = Math.min(SIZE - 1, (z + r | 0) + MARGIN);
    const r2 = r * r + 1e-6;
    for (let iz = z0; iz <= z1; iz++) {
      const dz = iz - MARGIN - z;
      const row = iz * SIZE;
      for (let ix = x0; ix <= x1; ix++) {
        const dx = ix - MARGIN - x;
        if (dx * dx + dz * dz > r2) continue;
        if (this.raw[row + ix] & mask) return true;
      }
    }
    return false;
  }

  fill(x0: number, z0: number, x1: number, z1: number, bit: number): void {
    const a = Math.max(0, (x0 | 0) + MARGIN), b = Math.min(SIZE, (x1 + 1 | 0) + MARGIN);
    const c = Math.max(0, (z0 | 0) + MARGIN), d = Math.min(SIZE, (z1 + 1 | 0) + MARGIN);
    for (let iz = c; iz < d; iz++) {
      const row = iz * SIZE;
      for (let ix = a; ix < b; ix++) this.raw[row + ix] |= bit;
    }
  }

  /** every cell within `half` of segment a-b (a band at any angle) */
  seg(ax: number, az: number, bx: number, bz: number, half: number, bit: number): void {
    const x0 = Math.max(0, (Math.min(ax, bx) - half | 0) + MARGIN), x1 = Math.min(SIZE - 1, (Math.max(ax, bx) + half | 0) + MARGIN);
    const z0 = Math.max(0, (Math.min(az, bz) - half | 0) + MARGIN), z1 = Math.min(SIZE - 1, (Math.max(az, bz) + half | 0) + MARGIN);
    const dx = bx - ax, dz = bz - az, L2 = dx * dx + dz * dz || 1e-9;
    for (let iz = z0; iz <= z1; iz++) {
      const z = iz - MARGIN + 0.5, row = iz * SIZE;
      for (let ix = x0; ix <= x1; ix++) {
        const x = ix - MARGIN + 0.5;
        const t = Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / L2));
        const ex = ax + dx * t - x, ez = az + dz * t - z;
        if (ex * ex + ez * ez <= half * half) this.raw[row + ix] |= bit;
      }
    }
  }

  /** every cell inside a rectangle of half extents hx, hz turned by ry
   * (local x = (cos, -sin), local z = (sin, cos)) */
  obb(cx: number, cz: number, hx: number, hz: number, ry: number, bit: number): void {
    const c = Math.cos(ry), s = Math.sin(ry);
    const ex = Math.abs(hx * c) + Math.abs(hz * s), ez = Math.abs(hx * s) + Math.abs(hz * c);
    const x0 = Math.max(0, (cx - ex | 0) + MARGIN), x1 = Math.min(SIZE - 1, (cx + ex | 0) + MARGIN);
    const z0 = Math.max(0, (cz - ez | 0) + MARGIN), z1 = Math.min(SIZE - 1, (cz + ez | 0) + MARGIN);
    for (let iz = z0; iz <= z1; iz++) {
      const dz = iz - MARGIN + 0.5 - cz, row = iz * SIZE;
      for (let ix = x0; ix <= x1; ix++) {
        const dx = ix - MARGIN + 0.5 - cx;
        const lx = dx * c - dz * s, lz = dx * s + dz * c;
        if (Math.abs(lx) <= hx && Math.abs(lz) <= hz) this.raw[row + ix] |= bit;
      }
    }
  }

  disc(cx: number, cz: number, r: number, bit: number): void {
    const x0 = Math.max(0, (cx - r | 0) + MARGIN), x1 = Math.min(SIZE - 1, (cx + r | 0) + MARGIN);
    const z0 = Math.max(0, (cz - r | 0) + MARGIN), z1 = Math.min(SIZE - 1, (cz + r | 0) + MARGIN);
    const r2 = r * r + 1e-6;
    for (let iz = z0; iz <= z1; iz++) {
      const dz = iz - MARGIN - cz, row = iz * SIZE;
      for (let ix = x0; ix <= x1; ix++) {
        const dx = ix - MARGIN - cx;
        if (dx * dx + dz * dz <= r2) this.raw[row + ix] |= bit;
      }
    }
  }

  stroke(pts: Array<{ x: number; z: number }>, step: number, half: number, bit: number): void {
    for (let k = 0; k < pts.length; k++) {
      const p = pts[k], q = pts[k + 1] ?? p;
      const len = Math.hypot(q.x - p.x, q.z - p.z);
      const n = Math.max(1, Math.ceil(len / step));
      for (let s = 0; s <= n; s++) {
        this.disc(p.x + (q.x - p.x) * (s / n), p.z + (q.z - p.z) * (s / n), half, bit);
      }
    }
  }
}

export interface Occupancy extends CityGrid {
  bx: number;
  by: number;
}

const cache = new Map<string, Occupancy>();

/** test/audit hook: occupancy caches are keyed by cell only, so switching
 * the city base seed requires a flush or stale cities come back */
export function clearOccupancyCache(): void { cache.clear(); }
/** the current island + the twelve the world worker prefetches round it */
const CACHE_MAX = 16;

/** is island (bx, by)'s grid already painted? */
export function hasOccupancy(bx: number, by: number): boolean { return cache.has(`${bx},${by}`); }

/** install a grid the world worker painted (a no-op if one is here) */
export function installOccupancy(bx: number, by: number, raw: Uint8Array): void {
  const key = `${bx},${by}`;
  if (cache.has(key)) return;
  const g = new CityGrid() as Occupancy;
  g.raw.set(raw);
  g.bx = bx;
  g.by = by;
  cache.set(key, g);
  if (cache.size > CACHE_MAX) cache.delete(cache.keys().next().value as string);
}

export function occupancyFor(bx: number, by: number): Occupancy {
  const key = `${bx},${by}`;
  let occ = cache.get(key);
  // (least recently used goes first: a hit moves to the back, so the
  // island the kid is on is never the one evicted)
  if (occ) { cache.delete(key); cache.set(key, occ); return occ; }
  occ = paint(bx, by) as Occupancy;
  occ.bx = bx;
  occ.by = by;
  cache.set(key, occ);
  if (cache.size > CACHE_MAX) {
    cache.delete(cache.keys().next().value as string);
  }
  return occ;
}

/** paint one city from its seeded generators. cityPlanFor must be asked for
 * FIRST — building the plan finalizes the street set (crossing pins,
 * R22 sweep, trims), and the grid must record that final rail. */
function paint(bx: number, by: number): CityGrid {
  const plan = cityPlanFor(bx, by);
  const rail = railNetFor(bx, by);
  const river = riverFor(bx, by);
  const g = new CityGrid();

  // water first — everything later declares itself against the river.
  // Like the chunk baker, water is suppressed near a recorded road bridge —
  // farther for the wide causeway-corridor bridges — so the grid must not
  // call that stretch water (the grid mirrors the world as built).
  const bridges = plan.riverBridges;
  const nearBridge = (x: number, z: number): boolean =>
    bridges.some(b => Math.hypot(b.x - x, b.z - z) < (b.exit ? 16 : 11));
  for (let k = 0; k < river.pts.length; k++) {
    const p = river.pts[k];
    if (nearBridge(p.x, p.z)) continue;
    g.disc(p.x, p.z, p.w / 2, RIVER);
  }

  // streets: every edge of the plan's web, 14 m carriageway, plus each
  // junction's pad (its farthest reach) and the roundabouts' rings
  for (const e of plan.edges) {
    const a = plan.nodes[e.a], b = plan.nodes[e.b];
    g.seg(a.x, a.z, b.x, b.z, 7, ROAD);
  }
  for (const n of plan.nodes) {
    if (n.plaza) g.disc(n.x, n.z, ROUNDABOUT_REACH, PLAZA);
    else if (!n.mouth && !n.square) g.disc(n.x, n.z, Math.max(...n.reach) * 0.75, ROAD);
  }

  // a race circuit's zone: the track and its apron (R32)
  const race = raceTrackFor(bx, by);
  if (race) g.obb(race.cx, race.cz, race.hx, race.hz, race.ry, RACE);

  // rail bed (3.4 m bed, stamped a little wider for approaches)
  for (const L of rail.lines) g.stroke(L.pts, 1.5, 2, RAIL);

  // lots: developed ground (buildings, tree rows, parking slabs), turned
  // to their streets
  for (let cx = 0; cx < WORLD_CHUNKS; cx++) {
    for (let cz = 0; cz < WORLD_CHUNKS; cz++) {
      for (const lot of plan.lots(cx, cz)) g.obb(lot.x, lot.z, lot.w / 2, lot.d / 2, lot.ry, LOT);
    }
  }
  // the sea: every cell off the shore; causeway corridors out over it are
  // DECK — the avenue and, 24 m beside it, the railway stem (the one road
  // and the one track the sea may carry)
  const coast = coastFor(bx, by);
  const exitV = [plan.exits.n, plan.exits.s], exitH = [plan.exits.w, plan.exits.e];
  const P = railPortals(bx, by);
  const stemV = [P.xN, P.xS], stemH = [P.zW, P.zE];
  for (let iz = 0; iz < SIZE; iz++) {
    const z = iz - MARGIN + 0.5, row = iz * SIZE;
    for (let ix = 0; ix < SIZE; ix++) {
      const x = ix - MARGIN + 0.5;
      if (coast.inLand(x, z)) continue;
      let bits = g.raw[row + ix] | SEA;
      if (exitV.some(l => Math.abs(x - l * 64) <= 8) || exitH.some(l => Math.abs(z - l * 64) <= 8)) bits |= DECK;
      if (stemV.some(v => Math.abs(x - v) <= 4) || stemH.some(v => Math.abs(z - v) <= 4)) bits |= DECK;
      g.raw[row + ix] = bits;
    }
  }
  return g;
}
