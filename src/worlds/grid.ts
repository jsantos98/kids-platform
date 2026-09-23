// The occupancy grid: ONE map per city saying what occupies every 1 m cell.
// Streets, rail, river, lots, tram, plaza and the race circuit are all
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
import { cityPlanFor } from './cityPlan.js';
import { railRouteFor } from './railRoute.js';
import { riverFor } from './riverRoute.js';
import { citySeed } from './cityGrid.js';
import { raceTiles, RACE_ORIGIN, RACE_TILE } from './racetrack.js';
import { ISLAND, WORLD_CHUNKS } from './world.js';

export const ROAD = 1;
export const RAIL = 2;
export const RIVER = 4;
export const LOT = 8;
export const PLAZA = 16;
export const TRAM = 32;
export const RACE = 64;
export const DECK = 128; // causeway decks (offshore — reserved)

/** props may never claim cells carrying any of these */
export const BLOCKED_FOR_PROPS = ROAD | RAIL | RIVER | LOT | PLAZA | TRAM;
/** built ground a prop cannot stand on even inside its own lot (trees) */
export const STRUCTURED = ROAD | RAIL | RIVER | PLAZA | TRAM;
/** wild scatter (trees, junk) may own LOT-free, built-free ground only */
export const WILD_FORBIDDEN = ROAD | RAIL | RIVER | LOT | PLAZA | TRAM | RACE;

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

  seg(ax: number, az: number, bx: number, bz: number, half: number, bit: number): void {
    this.fill(Math.min(ax, bx) - half, Math.min(az, bz) - half,
      Math.max(ax, bx) + half, Math.max(az, bz) + half, bit);
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
const CACHE_MAX = 6;

export function occupancyFor(bx: number, by: number): Occupancy {
  const key = `${bx},${by}`;
  let occ = cache.get(key);
  if (occ) return occ;
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
 * FIRST — building the plan is what re-squares the rail after the tram
 * rectangle is reserved, and the grid must record the final rail. */
function paint(bx: number, by: number): CityGrid {
  const plan = cityPlanFor(bx, by);
  const rail = railRouteFor(bx, by);
  const river = riverFor(citySeed(bx, by));
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

  // streets: the plan's open segments, 14 m carriageway, plus specials
  for (let j = 0; j <= WORLD_CHUNKS; j++) {
    for (let i = 0; i < WORLD_CHUNKS; i++) {
      if (plan.segH(j, i)) g.seg(i * 64, j * 64, (i + 1) * 64, j * 64, 7, ROAD);
    }
  }
  for (let i = 0; i <= WORLD_CHUNKS; i++) {
    for (let j = 0; j < WORLD_CHUNKS; j++) {
      if (plan.segV(i, j)) g.seg(i * 64, j * 64, i * 64, (j + 1) * 64, 7, ROAD);
    }
  }
  for (let cx = 0; cx < WORLD_CHUNKS; cx++) {
    for (let cz = 0; cz < WORLD_CHUNKS; cz++) {
      if (plan.roundabout(cx, cz)) g.disc(cx * 64, cz * 64, 6.4, ROAD);
      else if (plan.plaza(cx, cz)) g.disc(cx * 64, cz * 64, 9.4, PLAZA);
    }
  }

  // race circuit tiles
  for (const t of raceTiles()) {
    const c = RACE_ORIGIN.x + t.col * RACE_TILE, r = RACE_ORIGIN.z + t.row * RACE_TILE;
    g.fill(c, r, c + RACE_TILE - 0.5, r + RACE_TILE - 0.5, RACE);
  }

  // tram loop (3.4 m paving)
  if (plan.tram) g.stroke(plan.tram.pts, 1.5, 1.7, TRAM);

  // rail bed (3.4 m bed, stamped a little wider for approaches)
  g.stroke(rail.pts, 1.5, 2, RAIL);

  // lots: developed ground (buildings, tree rows, parking slabs)
  for (let cx = 0; cx < WORLD_CHUNKS; cx++) {
    for (let cz = 0; cz < WORLD_CHUNKS; cz++) {
      for (const lot of plan.lots(cx, cz)) {
        const flip = Math.abs(Math.abs(lot.ry) - Math.PI / 2) < 0.01;
        const hx = (flip ? lot.d : lot.w) / 2, hz = (flip ? lot.w : lot.d) / 2;
        g.fill(lot.x - hx, lot.z - hz, lot.x + hx, lot.z + hz, LOT);
      }
    }
  }
  return g;
}
