// Breadcrumbs: where to put the vehicle back after a bump. While the kid drives,
// known-good spots are remembered: on a street's asphalt (occupancy grid), in
// the right-hand lane, mid-block (never inside a junction pad), off the track
// and out of the water, clear of anything solid. A crash resumes from the
// newest crumb a few metres back, lined up with its street and heading the
// way the kid was going — it can never land off-road or inside a building,
// which the old "round to the nearest lattice line" rule could.
import { cityAt } from '../../worlds/cityGrid.js';
import { cityPlanFor } from '../../worlds/cityPlan.js';
import { occupancyFor, ROAD, RAIL, RIVER, PLAZA } from '../../worlds/grid.js';
import { WORLD_CHUNKS } from '../../worlds/world.js';
import type { CollisionBox } from '../../worlds/cityChunk.js';

export interface Spot { x: number; z: number; heading: number }

const CH = 64;
const LANE = 3.5;
const EVERY = 0.4;      // seconds between crumbs
const KEEP = 24;        // crumbs remembered (~10 s of driving)
const BACK = 6;         // resume at least this far behind the crash

/** snap a world point to the right-hand lane of the street it's on, facing
 * the travel direction; null when it isn't clearly on one street */
function laneSpot(x: number, z: number, heading: number): Spot | null {
  const lineZ = Math.round(z / CH) * CH, lineX = Math.round(x / CH) * CH;
  const onH = Math.abs(z - lineZ) < 7, onV = Math.abs(x - lineX) < 7;
  if (onH === onV) return null; // off every street, or inside a junction pad
  if (onH) {
    const east = Math.sin(heading) >= 0;
    return { x, z: lineZ + (east ? LANE : -LANE), heading: east ? Math.PI / 2 : -Math.PI / 2 };
  }
  const south = Math.cos(heading) >= 0;
  return { x: lineX + (south ? -LANE : LANE), z, heading: south ? 0 : Math.PI };
}

/** asphalt the kid may be put back on: a street, not the track, the river
 * or a roundabout ring */
function drivable(x: number, z: number): boolean {
  const c = cityAt(x, z);
  const lx = x - c.ox, lz = z - c.oz;
  if (lx < 2 || lz < 2 || lx > WORLD_CHUNKS * CH - 2 || lz > WORLD_CHUNKS * CH - 2) return false;
  const occ = occupancyFor(c.bx, c.by);
  if (!(occ.bits(lx, lz) & ROAD)) return false;
  return !occ.claims(lx, lz, 3.5, RAIL | RIVER | PLAZA);
}

function clearOf(s: Spot, boxes: CollisionBox[], r: number): boolean {
  for (const b of boxes) {
    if (s.x > b.x1 - r && s.x < b.x2 + r && s.z > b.z1 - r && s.z < b.z2 + r) return false;
  }
  return true;
}

export class Breadcrumbs {
  private crumbs: Spot[] = [];
  private timer = 0;

  constructor(private radius: number) {}

  /** forget the trail (teleports, city switches, resets) */
  clear(): void {
    this.crumbs.length = 0;
  }

  /** call every frame while driving normally */
  record(dt: number, x: number, z: number, heading: number, v: number, boxes: CollisionBox[]): void {
    this.timer -= dt;
    if (this.timer > 0) return;
    this.timer = EVERY;
    if (Math.abs(v) < 1.5) return;
    const s = laneSpot(x, z, heading);
    if (!s || !drivable(s.x, s.z) || !clearOf(s, boxes, this.radius + 1)) return;
    const last = this.crumbs[this.crumbs.length - 1];
    if (last && Math.hypot(last.x - s.x, last.z - s.z) < 2) return;
    this.crumbs.push(s);
    if (this.crumbs.length > KEEP) this.crumbs.shift();
  }

  /** where to resume after a crash at (x, z): the newest clear crumb at
   * least BACK metres behind, else the nearest open lane, else `fallback` */
  pickResume(x: number, z: number, heading: number, boxes: CollisionBox[], fallback: Spot): Spot {
    for (let k = this.crumbs.length - 1; k >= 0; k--) {
      const c = this.crumbs[k];
      if (Math.hypot(c.x - x, c.z - z) < BACK) continue;
      if (clearOf(c, boxes, this.radius + 0.5)) return { ...c };
    }
    return nearestLane(x, z, heading, boxes, this.radius) ?? { ...fallback };
  }
}

/** the closest right-hand lane point on an OPEN street segment of the city
 * the point is in (searched on the surrounding lattice lines) */
export function nearestLane(x: number, z: number, heading: number, boxes: CollisionBox[], radius: number): Spot | null {
  const c = cityAt(x, z);
  const plan = cityPlanFor(c.bx, c.by);
  const lx = x - c.ox, lz = z - c.oz;
  let best: Spot | null = null, bestD = Infinity;
  const consider = (s: Spot | null): void => {
    if (!s) return;
    const w = { x: s.x + c.ox, z: s.z + c.oz, heading: s.heading };
    if (!drivable(w.x, w.z) || !clearOf(w, boxes, radius + 0.5)) return;
    const d = Math.hypot(w.x - x, w.z - z);
    if (d < bestD) { bestD = d; best = w; }
  };
  const ci = Math.round(lx / CH), cj = Math.round(lz / CH);
  for (let dj = -2; dj <= 2; dj++) {
    const j = cj + dj;
    for (let i = Math.floor(lx / CH) - 2; i <= Math.floor(lx / CH) + 2; i++) {
      if (!plan.segH(j, i)) continue;
      // mid-block span only (clear of the junction pads)
      const along = Math.max(i * CH + 12, Math.min((i + 1) * CH - 12, lx));
      consider(laneSpot(along, j * CH, heading));
    }
  }
  for (let di = -2; di <= 2; di++) {
    const i = ci + di;
    for (let j = Math.floor(lz / CH) - 2; j <= Math.floor(lz / CH) + 2; j++) {
      if (!plan.segV(i, j)) continue;
      const along = Math.max(j * CH + 12, Math.min((j + 1) * CH - 12, lz));
      consider(laneSpot(i * CH, along, heading));
    }
  }
  return best;
}
