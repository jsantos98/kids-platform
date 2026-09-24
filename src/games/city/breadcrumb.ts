// Breadcrumbs: where to put the vehicle back after a bump. While the kid drives,
// known-good spots are remembered: on a street's asphalt (occupancy grid), in
// the right-hand lane, mid-block (never inside a junction pad), off the track
// and out of the water, clear of anything solid. A crash resumes from the
// newest crumb a few metres back, lined up with its street and heading the
// way the kid was going — it can never land off-road or inside a building,
// which the old "round to the nearest lattice line" rule could.
import { cityAt } from '../../worlds/cityGrid.js';
import { graphFor, type SEdge } from '../../worlds/streetGraph.js';
import { occupancyFor, ROAD, RAIL, RIVER, PLAZA } from '../../worlds/grid.js';
import { WORLD_CHUNKS } from '../../worlds/world.js';
import type { CollisionBox } from '../../worlds/cityChunk.js';

export interface Spot { x: number; z: number; heading: number }

const CH = 64;
const LANE = 3.5;
const EVERY = 0.4;      // seconds between crumbs
const KEEP = 24;        // crumbs remembered (~10 s of driving)
const BACK = 6;         // resume at least this far behind the crash

/** the right-hand lane point `s` metres along edge e (city-local), for a
 * vehicle facing `heading`: lane side and spot heading follow whichever way
 * along the street the vehicle points */
function laneOn(e: SEdge, s: number, heading: number, ox: number, oz: number, bx: number, by: number): Spot {
  const g = graphFor(bx, by);
  const fwd = Math.sin(heading) * e.ux + Math.cos(heading) * e.uz >= 0;
  const p = g.sample(e, s, fwd ? LANE : -LANE);
  return { x: p.x + ox, z: p.z + oz, heading: fwd ? e.heading : Math.atan2(-e.ux, -e.uz) };
}

/** snap a world point to the right-hand lane of the street it's on, facing
 * the travel direction; null when it isn't clearly on one street (off the
 * asphalt, or inside a junction pad) */
function laneSpot(x: number, z: number, heading: number): Spot | null {
  const c = cityAt(x, z);
  const near = graphFor(c.bx, c.by).nearest(x - c.ox, z - c.oz);
  if (!near || near.dist >= 7) return null;
  if (near.s < 12 || near.s > near.edge.len - 12) return null; // mid-block only
  return laneOn(near.edge, near.s, heading, c.ox, c.oz, c.bx, c.by);
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

/** the closest right-hand lane point on a street of the city the point is
 * in: every edge within reach, at its mid-block point nearest the crash */
export function nearestLane(x: number, z: number, heading: number, boxes: CollisionBox[], radius: number): Spot | null {
  const c = cityAt(x, z);
  const g = graphFor(c.bx, c.by);
  const lx = x - c.ox, lz = z - c.oz;
  let best: Spot | null = null, bestD = Infinity;
  for (const e of g.edges) {
    const a = g.nodes[e.a];
    const raw = (lx - a.x) * e.ux + (lz - a.z) * e.uz;
    const s = Math.max(12, Math.min(e.len - 12, raw));
    const w = laneOn(e, s, heading, c.ox, c.oz, c.bx, c.by);
    const d = Math.hypot(w.x - x, w.z - z);
    if (d >= bestD || d > 200) continue;
    if (!drivable(w.x, w.z) || !clearOf(w, boxes, radius + 0.5)) continue;
    bestD = d;
    best = w;
  }
  return best;
}
