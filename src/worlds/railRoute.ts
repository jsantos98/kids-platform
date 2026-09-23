// The island railway: a seeded, free-flowing closed loop — a Catmull-Rom
// spline through a wobbling ring of control points, not a lattice polyline.
// Trains lean through long gentle curves the whole way round. The loop is
// validated per seed:
//   - it stays out of the race-circuit corner (SE)
//   - it never threads a street intersection (junction tile chaos)
//   - control points keep a minimum spacing (no kinks)
// Where the line meets a street the plan carves a level crossing (cityPlan);
// where it meets the river, transit lays a trestle deck.
import * as THREE from 'three';
import { rng, chunkSeed } from '../engine/rng.js';
import { Baked } from '../engine/baked.js';
import { bakedModel, type BakedTemplate } from '../engine/assets.js';
import { makePath, polyPath, type WorldPath } from './spline.js';
import { citySeed, streetLinesFor } from './cityGrid.js';
import { riverFor, type RiverRoute } from './riverRoute.js';
import { WORLD_CHUNKS, ISLAND, CENTER } from './world.js';

export const RAIL_Y = 0.11;   // track bed base, just above the slab top
export const RAIL_TOP = 0.21; // where train wheels sit

export interface RailRoute {
  path: WorldPath;
  total: number;
  /** dense polyline (for the rails mesh + minimap), h = heading atan2(dx, dz) */
  pts: Array<{ x: number; z: number; h: number }>;
  sample(dist: number): { x: number; z: number; h: number };
  /** distance from (x, z) to the centreline */
  distTo(x: number, z: number): number;
  near(x: number, z: number, r: number): boolean;
  /** rail heading at the point nearest to (x, z) — lets the plan tell a
   * parallel run (bad, shadows streets) from a square crossing (fine) */
  headingAt(x: number, z: number): number;
  control: Array<{ x: number; z: number }>;
  /** dense samples of the pristine spline, before crossing deformation —
   * lets the plan re-square the rail once the tram rectangle is known */
  basePts: Array<{ x: number; z: number; h: number }>;
  /** control rings of the runner-up candidates: resquareRail re-rolls
   * through them once the tram streets are known, so the COMPLETE street
   * set gets the same quality gate the lattice set did */
  candidates?: Array<Array<{ x: number; z: number }>>;
}

// the open race-corner zone: nothing rail-ish on its SE diagonal
const RACE_EDGE = (WORLD_CHUNKS - 2) * 64 - 4;
function inRaceZone(x: number, z: number): boolean {
  return x > RACE_EDGE && z > RACE_EDGE;
}

// module-level cache: the route only depends on the city cell, and the chunk
// baker, the city plan and the trains all ask for it
const cache = new Map<string, RailRoute>();

export function railRouteFor(bx: number, by: number): RailRoute {
  const key = `${bx},${by}`;
  let route = cache.get(key);
  if (!route) {
    route = buildRoute(bx, by);
    cache.set(key, route);
  }
  return route;
}

interface Attempt { control: Array<{ x: number; z: number }>; score: number; path: WorldPath }

/** how clean a deformed route came out — mirrors the audit's own checks,
 * so a route is only ever shipped when the deformation provably worked */
interface Quality { ride: number; skew: number; folds: number; bridge: number }

/**
 * Where the river passes within 8 m of a lattice street line, a road bridge
 * lives (or may live — the plan's final bridge set is a subset of these).
 * The rail must cross the water well away from every one of them: a trestle
 * sharing the river with a road bridge is the one rail/river/road pileup the
 * world forbids. Zones derive from streetLinesFor + the river alone, so the
 * gate runs inside the route search with no plan built yet.
 */
function bridgeZones(H: number[], V: number[], river: RiverRoute): Array<{ x: number; z: number }> {
  const zones: Array<{ x: number; z: number }> = [];
  for (const p of river.pts) {
    // the water's EDGE reaches the road band (w/2 + 7 m) — that is what
    // makes a forbidden cell, not the centreline
    for (const j of H) {
      if (Math.abs(p.z - j * 64) < p.w / 2 + 9 && p.x > 8 && p.x < ISLAND - 8) zones.push({ x: p.x, z: j * 64 });
    }
    for (const i of V) {
      if (Math.abs(p.x - i * 64) < p.w / 2 + 9 && p.z > 8 && p.z < ISLAND - 8) zones.push({ x: i * 64, z: p.z });
    }
  }
  return zones;
}

function shapeQuality(
  p: WorldPath, H: number[], V: number[],
  river: RiverRoute | null, zones: Array<{ x: number; z: number }>,
): Quality {
  const pts = p.pts, N = pts.length;
  let ride = 0, run = 0, folds = 0, skew = 0;
  // dense resample at ~2 m: pin walls collapse vertices, leaving 20 m+
  // chords that point-based scans would skim straight over — the chords
  // are real rail the audit will see, so the gate must see them too
  const dense: Array<{ x: number; z: number; h: number }> = [];
  for (let k = 0; k < N; k++) {
    const a = pts[k], b = pts[(k + 1) % N];
    const len = Math.hypot(b.x - a.x, b.z - a.z);
    const steps = Math.max(1, Math.ceil(len / 2));
    let dh = b.h - a.h;
    while (dh > Math.PI) dh -= Math.PI * 2;
    while (dh < -Math.PI) dh += Math.PI * 2;
    for (let q = 0; q < steps; q++) {
      const t = q / steps;
      dense.push({ x: a.x + (b.x - a.x) * t, z: a.z + (b.z - a.z) * t, h: a.h + dh * t });
    }
  }
  const D = dense.length;
  for (let k = 0; k < N; k++) {
    const a = pts[(k - 1 + N) % N], b = pts[k], c = pts[(k + 1) % N];
    const l1 = Math.hypot(b.x - a.x, b.z - a.z), l2 = Math.hypot(c.x - b.x, c.z - b.z);
    if (l1 > 0.5 && l2 > 0.5 && (c.x - b.x) * (b.x - a.x) + (c.z - b.z) * (b.z - a.z) < 0) folds++;
  }
  for (let k = 0; k < D; k++) {
    const b = dense[k], nxt = dense[(k + 1) % D];
    const h = b.h;
    let bad = false;
    for (const line of H) {
      if (Math.abs(b.z - line * 64) < 7 && Math.abs(Math.abs(h) - Math.PI / 2) < Math.PI / 3) { bad = true; break; }
    }
    if (!bad) for (const line of V) {
      const dev = Math.min(Math.abs(h), Math.PI - Math.abs(h));
      if (Math.abs(b.x - line * 64) < 7 && dev < Math.PI / 3) { bad = true; break; }
    }
    if (bad) run += 2;
    else { ride = Math.max(ride, run); run = 0; }
  }
  ride = Math.max(ride, run);
  // squareness of every crossing the plan would record (span-crossings of
  // the final path, >= 11 m from a node), read as the nearest-vertex heading
  const cum: number[] = [0];
  for (let k = 1; k <= N; k++) {
    const a = pts[k - 1], b2 = pts[k % N];
    cum.push(cum[k - 1] + Math.hypot(b2.x - a.x, b2.z - a.z));
  }
  const checkCross = (horiz: boolean, line: number): void => {
    const c = line * 64;
    for (let k = 0; k < N; k++) {
      const va = horiz ? pts[k].z : pts[k].x;
      const vb = horiz ? pts[(k + 1) % N].z : pts[(k + 1) % N].x;
      if ((va - c) * (vb - c) >= 0) continue;
      const f = (c - va) / (vb - va);
      const along = horiz
        ? pts[k].x + (pts[(k + 1) % N].x - pts[k].x) * f
        : pts[k].z + (pts[(k + 1) % N].z - pts[k].z) * f;
      if (Math.abs(along - Math.round(along / 64) * 64) < 11) continue;
      // honest skew: the rail's worst angle to the street WHILE ON ITS
      // asphalt near this crossing — the nearest-vertex reading misses a
      // diagonal chord that only tilts between wall-end vertices
      let worst = 0;
      const streetH = horiz ? Math.PI / 2 : 0;
      for (let i = 0; i < D; i++) {
        const pd = horiz ? Math.abs(dense[i].z - c) : Math.abs(dense[i].x - c);
        if (pd >= 6.5) continue;
        const pa = horiz ? dense[i].x : dense[i].z;
        if (Math.abs(pa - along) >= 24) continue;
        let dev = Math.abs(dense[i].h - streetH);
        if (dev > Math.PI) dev = Math.PI * 2 - dev;
        while (dev > Math.PI / 2) dev = Math.PI - dev;
        worst = Math.max(worst, Math.abs(90 - (dev * 180) / Math.PI));
      }
      skew = Math.max(skew, worst);
    }
  };
  for (const line of H) checkCross(true, line);
  for (const line of V) checkCross(false, line);
  // R22: a trestle sharing the river with a road bridge is forbidden —
  // count trestle runs (contiguous in-water stretches) that come within
  // 12 m of any bridge zone. 12 m provably yields zero forbidden cells: a
  // cell needs the rail bed within 9 m of the street line, and every
  // in-bed sample is at least its zone distance from the line. (The route
  // scorer still prefers 24 m; this is the hard gate.) The water test uses
  // the bed's outer edge (halfAt + 2 m), matching the grid's rail stamp.
  let bridge = 0;
  if (river) {
    let inRun = false;
    for (const pt of dense) {
      if (!river.near(pt.x, pt.z, river.halfAt(pt.x, pt.z) + 4)) { inRun = false; continue; }
      let dmin = Infinity;
      for (const zn of zones) {
        const d = Math.hypot(pt.x - zn.x, pt.z - zn.z);
        if (d < dmin) dmin = d;
      }
      if (dmin >= 12) { inRun = false; continue; }
      if (!inRun) { bridge++; inRun = true; }
    }
  }
  return { ride, skew, folds, bridge };
}

const qualityBetter = (a: Quality, b: Quality): boolean =>
  a.folds !== b.folds ? a.folds < b.folds
    : a.bridge !== b.bridge ? a.bridge < b.bridge
      : a.ride !== b.ride ? a.ride < b.ride
        : a.skew < b.skew;

function buildRoute(bx: number, by: number): RailRoute {
  const seed = citySeed(bx, by);
  const { H, V } = streetLinesFor(bx, by);
  const river = riverFor(seed);
  const zones = bridgeZones(H, V, river);
  // rank route candidates by the cheap pre-deform score, then actually
  // deform the best few and SHIP the first whose geometry comes out clean
  // (no on-road rides, no folds, square crossings, trestles clear of road
  // bridges). The deform has rare bad modes on adversarial splines; rather
  // than patching each one, a dirty result just costs us a re-roll.
  //
  // The ring always crosses the river, and its crossing lands where the
  // west arc happens to meet it — a narrow band of z. When one round's
  // candidates all cross inside a bridge zone, a different control-slide
  // strength shifts that band, so later rounds re-search with new strengths
  // before anyone settles for a dirty fallback.
  const strengths = [0.9, 1.4, 0.5, 1.8, 0.3];
  let fallback: { route: RailRoute; q: Quality } | null = null;
  for (let round = 0; round < strengths.length; round++) {
    const mul = strengths[round];
    const ranked: Attempt[] = [];
    const offer = (a: Attempt): void => {
      let i = 0;
      while (i < ranked.length && ranked[i].score <= a.score) i++;
      if (i >= 12) return;
      ranked.splice(i, 0, a);
      if (ranked.length > 12) ranked.pop();
    };
    for (let attempt = 0; attempt < 45; attempt++) {
      const r = rng(chunkSeed(seed, 0x5a1, 0x7e + attempt + round * 1000));
      const a = tryRoute(r, H, V, river, zones, mul);
      if (!a) continue;
      if (a.score === 0) { ranked.length = 0; ranked.push(a); break; }
      offer(a);
    }
    if (ranked.length === 0) continue;
    for (const a of ranked) {
      const route = finalize(bx, by, a.control, a.path);
      route.candidates = ranked.map(t => t.control);
      const q = shapeQuality(route.path, H, V, river, zones);
      if (q.folds === 0 && q.bridge === 0 && q.ride < 7 && q.skew < 24) return route;
      if (!fallback || qualityBetter(q, fallback.q)) fallback = { route, q };
    }
  }
  // last resort: the deterministic rectangle ring through every strength
  for (const mul of strengths) {
    const a = forcedRoute(seed);
    const route = finalize(bx, by, a.control, a.path);
    route.candidates = [a.control];
    const q = shapeQuality(route.path, H, V, river, zones);
    if (q.folds === 0 && q.bridge === 0 && q.ride < 7 && q.skew < 24) return route;
    if (!fallback || qualityBetter(q, fallback.q)) fallback = { route, q };
  }
  return fallback!.route;
}

/** one control-ring candidate; null when control spacing is impossible */
function tryRoute(
  r: () => number, H: number[], V: number[],
  river: RiverRoute, zones: Array<{ x: number; z: number }>,
  slideMul = 0.9,
): Attempt | null {
  const CX = CENTER, CZ = CENTER;
  const n = 10 + ((r() * 4) | 0);
  const base = ISLAND * (0.32 + r() * 0.06);
  const ph1 = r() * Math.PI * 2, ph2 = r() * Math.PI * 2;
  const control: Array<{ x: number; z: number }> = [];
  for (let k = 0; k < n; k++) {
    const th = (k / n) * Math.PI * 2;
    const rad = base * (0.82 + 0.36 * r());
    let x = CX + Math.cos(th) * rad * (1 + 0.24 * Math.sin(th + ph1));
    let z = CZ + Math.sin(th) * rad * (1 + 0.24 * Math.sin(th + ph2));
    x = Math.max(44, Math.min(ISLAND - 44, x));
    z = Math.max(44, Math.min(ISLAND - 44, z));
    // duck inside around the race corner: pull toward the centre while the
    // point sits on the SE diagonal guard
    const GUARD = (WORLD_CHUNKS - 2) * 64 - 48;
    let guard = 0;
    while (x > GUARD && z > GUARD && guard++ < 60) {
      x = CX + (x - CX) * 0.92;
      z = CZ + (z - CZ) * 0.92;
    }
    control.push({ x, z });
  }
  // slide control points out of the street-junction squares — a railway
  // through an intersection tile reads as chaos, so keep a 16 m bubble
  for (let k = 0; k < control.length; k++) {
    const p = control[k];
    const i = Math.round(p.x / 64), jz = Math.round(p.z / 64);
    if (i < 1 || i >= WORLD_CHUNKS || jz < 1 || jz >= WORLD_CHUNKS) continue;
    const nx = i * 64, nz = jz * 64;
    const d = Math.hypot(p.x - nx, p.z - nz);
    if (d < 16) {
      const f = d < 0.01 ? 16 : 16 / d;
      p.x = nx + (p.x - nx) * f;
      p.z = nz + (p.z - nz) * f;
    }
  }
  // the ring always crosses the river somewhere; WHERE it crosses is the
  // one thing we can steer. Control points near a bridge zone slide along
  // the river (in z) so the arc's water crossing lands between road
  // bridges instead of on one (R22) — same bubble trick as the junctions.
  for (const p of control) {
    if (!river.near(p.x, p.z, 80)) continue;
    let zn: { x: number; z: number } | null = null, dn = Infinity;
    for (const z of zones) {
      const d = Math.hypot(p.x - z.x, p.z - z.z);
      if (d < dn) { dn = d; zn = z; }
    }
    if (!zn || dn > 80) continue;
    const dz = p.z - zn.z;
    p.z += Math.max(-45, Math.min(45, Math.sign(dz || 1) * (60 - Math.min(dn, 60)) * slideMul));
  }
  // adjacent control points need breathing room, or the spline kinks
  for (let k = 0; k < n; k++) {
    const a = control[k], b = control[(k + 1) % n];
    if (Math.hypot(a.x - b.x, a.z - b.z) < 60) return null;
  }
  const path = makePath(control, true);
  // score violations on dense samples
  let score = 0;
  let inBridgeRun = false;
  for (let k = 0; k < path.pts.length; k++) {
    const p = path.pts[k];
    if (inRaceZone(p.x, p.z)) score += 3;
    if (p.x < 34 || p.x > ISLAND - 34 || p.z < 34 || p.z > ISLAND - 34) score += 3;
    const i = Math.round(p.x / 64), jn = Math.round(p.z / 64);
    if (i >= 1 && i < WORLD_CHUNKS && jn >= 1 && jn < WORLD_CHUNKS) {
      const dx = p.x - i * 64, dz = p.z - jn * 64;
      if (dx * dx + dz * dz < 14 * 14) score += 12; // threading a junction
    }
    // dipping into the river anywhere near a road bridge means a trestle
    // sharing the water with the bridge — the one overlap the world
    // forbids. Decisively expensive so clean candidates always rank above
    // tainted ones (runs counted on every 4th sample for speed).
    if ((k & 3) === 0 && river.near(p.x, p.z, river.halfAt(p.x, p.z) + 4)) {
      let dmin = Infinity;
      for (const zn of zones) {
        const d = (p.x - zn.x) * (p.x - zn.x) + (p.z - zn.z) * (p.z - zn.z);
        if (d < dmin) dmin = d;
      }
      if (dmin < 24 * 24) {
        if (!inBridgeRun) { score += 120; inBridgeRun = true; }
      } else inBridgeRun = false;
    } else inBridgeRun = false;
  }
  // a shallow line crossing means the rail rides the road corridor for tens
  // of metres no matter how the crossing itself is squared up — so any
  // crossing gentler than ~59 degrees rejects the candidate outright
  const cum: number[] = [0];
  for (let k = 1; k <= path.pts.length; k++) {
    const a = path.pts[k - 1], b = path.pts[k % path.pts.length];
    cum.push(cum[k - 1] + Math.hypot(b.x - a.x, b.z - a.z));
  }
  const hitArcs: number[] = [];
  for (let k = 0; k < path.pts.length; k++) {
    const a = path.pts[k], b = path.pts[(k + 1) % path.pts.length];
    const len = cum[k + 1] - cum[k];
    if (len < 0.001) continue;
    for (const line of H) {
      if ((a.z - line * 64) * (b.z - line * 64) < 0) {
        hitArcs.push(cum[k] + ((line * 64 - a.z) / (b.z - a.z)) * len);
        if (Math.abs(b.z - a.z) / len < 0.85) score += 20;
      }
    }
    for (const line of V) {
      if ((a.x - line * 64) * (b.x - line * 64) < 0) {
        hitArcs.push(cum[k] + ((line * 64 - a.x) / (b.x - a.x)) * len);
        if (Math.abs(b.x - a.x) / len < 0.85) score += 20;
      }
    }
    // a crossing spilling into a junction tile would go unrecorded (the
    // collector keeps crossings away from nodes) — avoid those hard, the
    // deformation cannot rescue them
    const mi = Math.round((a.x + b.x) / 2 / 64), mj = Math.round((a.z + b.z) / 2 / 64);
    for (const line of H) {
      if ((a.z - line * 64) * (b.z - line * 64) < 0 && Math.abs(mj * 64 - line * 64) < 1 && Math.abs((mi * 64) % 64) >= 0) {
        // crossing of an H line: too close to a V-node column?
        const midX = (a.x + b.x) / 2;
        if (Math.abs(midX - Math.round(midX / 64) * 64) < 16) score += 25;
      }
    }
    for (const line of V) {
      if ((a.x - line * 64) * (b.x - line * 64) < 0) {
        const midZ = (a.z + b.z) / 2;
        if (Math.abs(midZ - Math.round(midZ / 64) * 64) < 16) score += 25;
      }
    }
  }
  // two street hits within ~30 m of arc means the rail cuts a junction
  // corner — the pins of both crossings crowd one stretch, the absolute
  // cores collapse the path onto a knot, and the crossings end up unsquare.
  // Rank any candidate carrying one out.
  hitArcs.sort((p, q) => p - q);
  for (let i = 1; i < hitArcs.length; i++) {
    if (hitArcs[i] - hitArcs[i - 1] < 30) score += 50;
  }
  // hugging a street line near-parallel (the rails would sit on the asphalt
  // edge) — steer the search away from tracking roads; same 55° window the
  // clearance pusher treats as "riding", so scored-ugly means pushed-later
  for (const p of path.pts) {
    for (const line of H) {
      const d = Math.abs(p.z - line * 64);
      if (d < 10 && Math.abs(Math.abs(p.h) - Math.PI / 2) < 55 * Math.PI / 180) score += 0.75;
    }
    for (const line of V) {
      const d = Math.abs(p.x - line * 64);
      const dev = Math.min(p.h, Math.PI - p.h, Math.abs(p.h - Math.PI * 2));
      if (d < 10 && dev < 55 * Math.PI / 180) score += 0.75;
    }
  }
  return { control, score, path };
}

/** deterministic last resort: a plain rounded rectangle ring */
function forcedRoute(seed: number): Attempt {
  const r = rng(chunkSeed(seed, 0x5a2, 3));
  const ph = r() * Math.PI * 2;
  const off = ISLAND * 0.27;
  const control: Array<{ x: number; z: number }> = [];
  const ring = (fx: number, fz: number): { x: number; z: number } => {
    const px = CENTER + fx * off, pz = CENTER + fz * off;
    return { x: px + 14 * Math.sin(pz * 0.012 + ph), z: pz + 14 * Math.sin(px * 0.012 + ph) };
  };
  for (const [fx, fz] of [[-1, -1], [0, -1.15], [1, -1], [1.15, 0], [1, 1], [0, 1.15], [-1, 1], [-1.15, 0]]) {
    control.push(ring(fx, fz));
  }
  return { control, score: 0, path: makePath(control, true) };
}

/** shared deformation sequence. Order matters: tangential grazes are lifted
 * off the roads BEFORE the crossing pins are placed. A graze pinned in place
 * stays a ~30 m skim along the asphalt with a token square jog in the middle
 * — the pins must only ever see genuine crossings. The river swing slides
 * in-water stretches along the river until they clear every bridge zone
 * (R22), running both before the lift (so the street clearance sees the slid
 * shape) and after the final sweep (which can push rail back into water). */
function deform(
  pts: Array<{ x: number; z: number; h: number }>,
  H: number[], V: number[],
  river: RiverRoute, zones: Array<{ x: number; z: number }>,
): Array<{ x: number; z: number }> {
  // R22: slide in-water stretches along the river out of bridge zones
  // BEFORE anything else — this early, the crossing pins re-square every
  // street approach the slide drags, so no skew survives
  const swung = riverSwing(pts, river, zones);
  const lifted = clearancePush(swung, H, V);
  return ironSpikes(clearancePush(perpendicularCrossings(polyPath(lifted), H, V), H, V));
}

/** iron out sub-metre spikes left where pin cores collapsed samples onto a
 * wall: three points within ~3 m whose middle kinks off by more than ~20
 * degrees read as a jagged crossing. Real corners — wall ends, bends —
 * have long segments on at least one side and are left alone. */
function ironSpikes(pts: Array<{ x: number; z: number }>): Array<{ x: number; z: number }> {
  const N = pts.length;
  let cur = pts.map(p => ({ x: p.x, z: p.z }));
  for (let it = 0; it < 3; it++) {
    let moved = false;
    const out = cur.map(p => ({ x: p.x, z: p.z }));
    for (let k = 0; k < N; k++) {
      const a = cur[(k - 1 + N) % N], b = cur[k], c = cur[(k + 1) % N];
      const l1 = Math.hypot(b.x - a.x, b.z - a.z), l2 = Math.hypot(c.x - b.x, c.z - b.z);
      if (l1 >= 3 || l2 >= 3) continue;
      const dot = (c.x - b.x) * (b.x - a.x) + (c.z - b.z) * (b.z - a.z);
      if (dot >= 0.9 * l1 * l2) continue;
      out[k] = { x: (a.x + c.x) / 2, z: (a.z + c.z) / 2 };
      moved = true;
    }
    cur = out;
    if (!moved) break;
  }
  return cur;
}

/**
 * R22's active half: any sample sitting in the water (bed edge touching)
 * within 24 m of a bridge zone slides ALONG the river (in z) until the
 * crossing clears the zone — the river is a north-south band, so sliding
 * z moves the trestle to free water instead of piling it onto a bridge.
 * Full-strength displacement, max-dilation spread, iterated until clean.
 */
function riverSwing(
  pts: Array<{ x: number; z: number }>,
  river: RiverRoute, zones: Array<{ x: number; z: number }>,
): Array<{ x: number; z: number }> {
  const N = pts.length;
  const CLEAR = 24, REACH = 30;
  let cur = pts.map(p => ({ x: p.x, z: p.z }));
  for (let pass = 0; pass < 4; pass++) {
    const raw = new Array(N).fill(0);
    for (let k = 0; k < N; k++) {
      const p = cur[k];
      if (!river.near(p.x, p.z, river.halfAt(p.x, p.z) + 4)) continue;
      let zn: { x: number; z: number } | null = null, dn = REACH;
      for (const z of zones) {
        const d = Math.hypot(p.x - z.x, p.z - z.z);
        if (d < dn) { dn = d; zn = z; }
      }
      if (!zn) continue;
      const dz = p.z - zn.z;
      const adz = Math.abs(dz);
      if (adz < CLEAR) raw[k] = (CLEAR - adz) * Math.sign(dz || 1);
    }
    if (raw.every(v => v === 0)) break;
    const spread = raw.map((_, k) => {
      let best = 0;
      for (let j = -4; j <= 4; j++) {
        const v = raw[(k + j + N) % N] * (1 - 0.16 * Math.abs(j));
        if (Math.abs(v) > Math.abs(best)) best = v;
      }
      return best;
    });
    cur = cur.map((p, k) => ({ x: p.x, z: p.z + spread[k] }));
  }
  return cur;
}

function finalize(bx: number, by: number, control: Array<{ x: number; z: number }>, path: WorldPath): RailRoute {
  // the spline pays no attention to the street lattice, so wherever it
  // happens to meet a road it is reshaped to do so properly: grazes are
  // swung clear, every genuine crossing is squared up — which reads as a
  // proper railway junction and gives the level crossings their barriers a
  // clean strip to guard.
  const { H, V } = streetLinesFor(bx, by);
  const river = riverFor(citySeed(bx, by));
  const shaped = deform(path.pts, H, V, river, bridgeZones(H, V, river));
  const p2 = polyPath(shaped);
  return {
    path: p2,
    total: p2.total,
    pts: p2.pts,
    sample: d => p2.sample(d),
    distTo(x, z) { return Math.sqrt(p2.nearest(x, z).d2); },
    near(x, z, r) { return p2.nearest(x, z).d2 < r * r; },
    headingAt(x, z) { return p2.nearest(x, z).p.h; },
    control,
    basePts: path.pts,
  };
}

/**
 * Re-run the crossing deformation once the plan knows streets the rail could
 * not (the tram rectangle is reserved after this route is built). The
 * COMPLETE street set gets the same quality gate the lattice set did: every
 * candidate ring is re-deformed against H/V and the first clean one wins.
 * The tram rectangle was placed to dodge the shipped route's shadows, and a
 * re-roll candidate is itself ride-free against the complete set, so the
 * swap cannot put the rail on top of the tram corridor. Rewrites the cached
 * route in place — every consumer reads the same object.
 */
export function resquareRail(route: RailRoute, bx: number, by: number, H: number[], V: number[]): void {
  const cands = route.candidates && route.candidates.length > 0 ? route.candidates : [route.control];
  // resquareRail's H/V include the tram lines, whose positions come from the
  // plan, which exists only after a route shipped — the river, however, is
  // plan-independent, so the R22 trestle-vs-bridge gate still applies here
  const river = riverFor(citySeed(bx, by));
  const zones = bridgeZones(H, V, river);
  let best: { p2: WorldPath; q: Quality } | null = null;
  for (const c of cands) {
    const p2 = polyPath(deform(makePath(c, true).pts, H, V, river, zones));
    const q = shapeQuality(p2, H, V, river, zones);
    if (q.folds === 0 && q.bridge === 0 && q.ride < 7 && q.skew < 24) {
      best = { p2, q };
      break;
    }
    if (!best || qualityBetter(q, best.q)) best = { p2, q };
  }
  const p2 = best!.p2;
  route.path = p2;
  route.total = p2.total;
  route.pts = p2.pts;
  route.sample = d => p2.sample(d);
  route.distTo = (x, z) => Math.sqrt(p2.nearest(x, z).d2);
  route.near = (x, z, r) => p2.nearest(x, z).d2 < r * r;
  route.headingAt = (x, z) => p2.nearest(x, z).p.h;
}

/** half-length of the straightened approach either side of a crossing (m) */
const CROSS_ZONE = 24;

/**
 * Final guarantee for "the rail never lies on a road": any point headed
 * within 55° of a street's own direction while within 10 m of that street's
 * centreline is displaced sideways to an 11.5 m clearance (bed edge ~2.8 m
 * clear of the kerb). The 55° window is deliberately wider than the ±45°
 * "clearly parallel" case — an oblique approach rides the asphalt just as
 * visibly, and everything the audit would flag (60° window) must get
 * pushed.
 *
 * One exemption keeps the correction from fighting the crossing pins:
 * within ±12 m of arc of a span-crossing of the SAME street the path is
 * genuinely crossing, the pin rebuilds that whole neighbourhood, and a
 * push there would shear samples across the line and tear the path into
 * a hairpin with a fake square crossing in the middle. Hugs beyond that
 * window — including tangent graze bottoms that never dip 3 m deep — all
 * lift.
 *
 * Two properties make the correction actually hold:
 *  - it iterates until no point violates (steepening one stretch changes
 *    headings downstream and can expose a new violation one pass later);
 *  - the push spreads to neighbours by max-magnitude with a decaying
 *    weight, NOT by averaging — a mean would dilute a lone violation back
 *    onto the asphalt, which is exactly the brush this exists to kill.
 * Every push moves its point AWAY from the line, so no pass can create a
 * crossing that was not already there.
 */
export function clearancePush(
  pts: Array<{ x: number; z: number }>,
  H: number[], V: number[],
): Array<{ x: number; z: number }> {
  const N = pts.length;
  const CLEAR = 11.5, BAND = 10, NEAR = 12, SWING = 30, PARALLEL = (55 * Math.PI) / 180;
  let cur = pts.map(p => ({ x: p.x, z: p.z }));
  for (let pass = 0; pass < 6; pass++) {
    // arc table + where the current path genuinely crosses each street family
    const cum: number[] = [0];
    for (let k = 1; k <= N; k++) {
      const a = cur[k - 1], b = cur[k % N];
      cum.push(cum[k - 1] + Math.hypot(b.x - a.x, b.z - a.z));
    }
    const total = cum[N];
    // span-crossings of the CURRENT path, split by whether the plan would
    // record them (>= 11.5 m from the nearest node, matching the
    // collector's margin). Recorded crossings earn the no-push window —
    // the pin rebuilds that neighbourhood. A crossing squeezed against a
    // junction would go unrecorded (no barriers), so instead of tearing it
    // apart the push SWINGS the whole neighbourhood to the majority side:
    // the crossing re-forms at the window edge, away from the node, where
    // it is eligible again. Same-line swings closer than two windows merge
    // into one — opposing swings would yank the path into a knot.
    const hKeep: number[] = [], vKeep: number[] = [];
    const hSwing: Array<{ s: number; side: number; line: number }> = [];
    const vSwing: Array<{ s: number; side: number; line: number }> = [];
    const collect = (
      line: number, c: number, horiz: boolean,
      keep: number[], swing: Array<{ s: number; side: number; line: number }>,
    ): void => {
      const raw: Array<{ s: number; k: number }> = [];
      for (let k = 0; k < N; k++) {
        const va = horiz ? cur[k].z : cur[k].x;
        const vb = horiz ? cur[(k + 1) % N].z : cur[(k + 1) % N].x;
        const wa = horiz ? cur[k].x : cur[k].z;
        const wb = horiz ? cur[(k + 1) % N].x : cur[(k + 1) % N].z;
        if ((va - c) * (vb - c) < 0) {
          const f = (c - va) / (vb - va);
          const cross = wa + (wb - wa) * f;
          const s = cum[k] + f * (cum[k + 1] - cum[k]);
          if (Math.abs(cross - Math.round(cross / 64) * 64) >= 12) keep.push(s);
          else raw.push({ s, k });
        }
      }
      // same-line hits closer than two swing windows share ONE side, so
      // their windows push the same direction instead of fighting
      let group: Array<{ s: number; k: number }> = [];
      const flush = (): void => {
        if (group.length === 0) return;
        const k0 = group[0].k, k1 = group[group.length - 1].k;
        const d0 = (horiz ? cur[(k0 - 15 + N) % N].z : cur[(k0 - 15 + N) % N].x) - c;
        const d1 = (horiz ? cur[(k1 + 15) % N].z : cur[(k1 + 15) % N].x) - c;
        const side = Math.sign(d0 + d1) || 1;
        for (const h of group) swing.push({ s: h.s, side, line });
        group = [];
      };
      for (const h of raw) {
        if (group.length > 0 && h.s - group[group.length - 1].s >= 60) flush();
        group.push(h);
      }
      flush();
    };
    for (const line of H) collect(line, line * 64, true, hKeep, hSwing);
    for (const line of V) collect(line, line * 64, false, vKeep, vSwing);
    const arcDist = (s: number, c: number): number => {
      let d = Math.abs(s - c);
      if (d > total / 2) d = total - d;
      return d;
    };
    const rawX = new Array(N).fill(0);
    const rawZ = new Array(N).fill(0);
    for (let k = 0; k < N; k++) {
      const p = cur[k];
      const a = cur[(k - 2 + N) % N], b = cur[(k + 2) % N];
      const h = Math.atan2(b.x - a.x, b.z - a.z);
      const nearH = hKeep.some(c => arcDist(cum[k], c) < NEAR);
      const nearV = vKeep.some(c => arcDist(cum[k], c) < NEAR);
      for (const line of H) {
        const d = p.z - line * 64;
        const ad = Math.abs(d);
        if (ad >= BAND || nearH) continue;
        if (Math.abs(Math.abs(h) - Math.PI / 2) >= PARALLEL) continue;
        let swing: number | null = null, best = SWING;
        for (const sw of hSwing) {
          if (sw.line !== line) continue;
          const dd = arcDist(cum[k], sw.s);
          if (dd < best) { best = dd; swing = sw.side; }
        }
        if (swing !== null) rawZ[k] = (CLEAR - d * swing) * swing;
        else rawZ[k] = (CLEAR - ad) * Math.sign(d || 1);
      }
      for (const line of V) {
        const d = p.x - line * 64;
        const ad = Math.abs(d);
        if (ad >= BAND || nearV) continue;
        const dev = Math.min(Math.abs(h), Math.PI - Math.abs(h));
        if (dev >= PARALLEL) continue;
        let swing: number | null = null, best = SWING;
        for (const sw of vSwing) {
          if (sw.line !== line) continue;
          const dd = arcDist(cum[k], sw.s);
          if (dd < best) { best = dd; swing = sw.side; }
        }
        if (swing !== null) rawX[k] = (CLEAR - d * swing) * swing;
        else rawX[k] = (CLEAR - ad) * Math.sign(d || 1);
      }
    }
    if (rawX.every(v => v === 0) && rawZ.every(v => v === 0)) break;
    // max-dilation spread: a violating point always keeps its full push,
    // neighbours ramp down toward zero over ±4 samples
    const spread = (raw: number[]): number[] => cur.map((_, k) => {
      let best = 0;
      for (let j = -4; j <= 4; j++) {
        const v = raw[(k + j + N) % N] * (1 - 0.16 * Math.abs(j));
        if (Math.abs(v) > Math.abs(best)) best = v;
      }
      return best;
    });
    const sx = spread(rawX), sz = spread(rawZ);
    cur = cur.map((p, k) => ({ x: p.x + sx[k], z: p.z + sz[k] }));
  }
  return cur;
}

export function perpendicularCrossings(
  path: WorldPath,
  H: number[], V: number[],
): Array<{ x: number; z: number }> {
  const pts = path.pts;
  const N = pts.length;
  const cum: number[] = [0];
  for (let k = 1; k <= N; k++) {
    const a = pts[k - 1], b = pts[k % N];
    cum.push(cum[k - 1] + Math.hypot(b.x - a.x, b.z - a.z));
  }
  const total = cum[N];
  // where does a sample span cross a street line?
  interface Hit { s: number; x: number; z: number; horiz: boolean; line: number }
  const hits: Hit[] = [];
  const spanCross = (va: number, vb: number, c: number): number | null => {
    if ((va - c) * (vb - c) >= 0) return null;
    return (c - va) / (vb - va);
  };
  for (let k = 0; k < N; k++) {
    const a = pts[k], b = pts[(k + 1) % N];
    const segLen = cum[k + 1] - cum[k];
    for (const line of H) {
      const t = spanCross(a.z, b.z, line * 64);
      if (t !== null) hits.push({ s: cum[k] + t * segLen, x: a.x + (b.x - a.x) * t, z: line * 64, horiz: true, line });
    }
    for (const line of V) {
      const t = spanCross(a.x, b.x, line * 64);
      if (t !== null) hits.push({ s: cum[k] + t * segLen, x: line * 64, z: a.z + (b.z - a.z) * t, horiz: false, line });
    }
  }
  hits.sort((u, v) => u.s - v.s);
  // a noisy touch can wiggle across one line several times within a pin
  // core; those fold into ONE square crossing. Separated pairs stay
  // separate — the lift has already cleared the hugs, so two genuine
  // crossings 30-40 m apart are a real double crossing and EACH needs its
  // own wall (merging them used to leave the second one shallow).
  const centers: Hit[] = [];
  for (const h of hits) {
    const prev = centers[centers.length - 1];
    if (prev && prev.horiz === h.horiz && prev.line === h.line && h.s - prev.s < 26) continue;
    centers.push(h);
  }
  // hits from DIFFERENT lines can also crowd (the rail cutting a junction
  // corner). Two overlapping absolute cores collapse every point between
  // them onto one corner — a knot hanging off the crossing — so where kept
  // hits sit closer than two cores, both cores shrink to tile the gap.
  // Blend zones shrink too: overlapping blends shear each other's shoulder
  // and leave the second of a close pair skewed off square.
  const core: number[] = centers.map(() => 10);
  const zone: number[] = centers.map(() => CROSS_ZONE);
  for (let i = 0; i < centers.length; i++) {
    if (centers.length < 2) break;
    const j = (i + 1) % centers.length;
    const gap = i + 1 < centers.length
      ? centers[j].s - centers[i].s
      : centers[j].s + total - centers[i].s;
    if (gap < 20) {
      const h = Math.max(3, (gap - 2) / 2);
      core[i] = Math.min(core[i], h);
      core[j] = Math.min(core[j], h);
    }
    if (gap < CROSS_ZONE * 2) {
      const z = Math.max(12, gap / 2 - 1);
      zone[i] = Math.min(zone[i], z);
      zone[j] = Math.min(zone[j], z);
    }
  }
  // blend the neighbourhood of every kept hit onto the perpendicular through
  // it. Inside the road corridor (±7 m) the pin is absolute — the crossing
  // itself is dead square however shallow the approach — then the pin fades
  // out to its (possibly shrunk) zone so the merge back into the line is
  // smooth.
  const out = pts.map(p => ({ x: p.x, z: p.z }));
  // points claimed by TWO crossing walls (shared asphalt between close
  // crossings) belong to no single wall — pinning them lets the later pin
  // crush the earlier wall's spread. A wall tip merely reaching toward a
  // junction street with no crossing of its own is NOT contested.
  const claims = new Array(N).fill(0);
  for (const hit of centers) {
    for (let k = 0; k < N; k++) {
      const d0 = Math.abs((hit.horiz ? pts[k].z : pts[k].x) - (hit.horiz ? hit.z : hit.x));
      if (d0 >= 7.5) continue;
      const pa = hit.horiz ? pts[k].x : pts[k].z;
      if (Math.abs(pa - (hit.horiz ? hit.x : hit.z)) >= 30) continue;
      claims[k]++;
    }
  }
  const contested = claims.map(c => c > 1);
  centers.forEach((hit, ci) => {
    const co = core[ci], zo = zone[ci];
    for (let k = 0; k < N; k++) {
      if (contested[k]) continue;
      let ds = cum[k] - hit.s;
      if (ds > total / 2) ds -= total;
      if (ds < -total / 2) ds += total;
      const ad = Math.abs(ds);
      const arcW = ad <= co ? 1
        : ad >= zo ? 0
          : 0.5 * (1 + Math.cos((Math.PI * (ad - co)) / (zo - co)));
      // the pin stays absolute across the asphalt within its own ±30 m
      // street window: a wall whose arc runs out mid-corridor — or a graze
      // squeezed between two crossings a few metres apart — leaves asphalt
      // crossed at a visible skew otherwise. Windowed so near-node walls of
      // the perpendicular street stay out of reach.
      const d0 = Math.abs((hit.horiz ? pts[k].z : pts[k].x) - (hit.horiz ? hit.z : hit.x));
      const mask = d0 >= 12 ? 0 : d0 <= 7 ? 1 : (12 - d0) / 5;
      const pa = hit.horiz ? pts[k].x : pts[k].z;
      const inWindow = Math.abs(pa - (hit.horiz ? hit.x : hit.z)) < 30;
      const w = Math.max(arcW, inWindow ? mask : 0);
      if (w <= 0) continue;
      if (hit.horiz) out[k].x += (hit.x - out[k].x) * w;
      else out[k].z += (hit.z - out[k].z) * w;
    }
  });
  return out;
}

/**
 * Rails mesh: track pieces laid along the whole path (the Kenney
 * railroad-straight tile, scaled per piece; a procedural ballast+rails
 * fallback when the kit is unavailable). One merged mesh for the island.
 */
export function bakeRails(route: RailRoute, tpl: BakedTemplate | null): THREE.Mesh {
  const B = new Baked();
  const W = 3.4; // track bed width (m)
  // the kit tile is modelled about a metre below its own origin — measure it
  // and lift, so the bed rests on the ground (RAIL_Y) instead of hanging
  // buried beneath the island with the trains floating above it
  let dy = 0;
  if (tpl) {
    let minY = Infinity;
    for (const src of tpl.geos) {
      src.computeBoundingBox();
      minY = Math.min(minY, src.boundingBox!.min.y);
    }
    if (Number.isFinite(minY)) dy = -minY;
  }
  const piece = (x: number, z: number, h: number, len: number): void => {
    if (tpl) {
      const sx = W / tpl.size.x, sz = (len + 0.3) / tpl.size.z;
      for (const src of tpl.geos) {
        const g = src.clone();
        g.scale(sx, 1, sz);
        g.translate(0, dy, -len / 2);
        g.rotateY(h);
        g.translate(x, RAIL_Y, z);
        B.raw(g);
      }
    } else {
      B.box(W, 0.08, len + 0.3, 0xb9a88c, x, RAIL_Y + 0.04, z, 0, h, 0);
      const rx = Math.cos(h) * 0.95, rz = -Math.sin(h) * 0.95;
      B.box(0.12, 0.12, len + 0.3, 0x8d939e, x + rx, RAIL_Y + 0.14, z + rz, 0, h, 0);
      B.box(0.12, 0.12, len + 0.3, 0x8d939e, x - rx, RAIL_Y + 0.14, z - rz, 0, h, 0);
    }
  };
  // walk the polyline, merging consecutive samples into pieces (~14 m on
  // straights, ~5 m where the path curves)
  let runLen = 0;
  let sx = route.pts[0].x, sz = route.pts[0].z, sh = route.pts[0].h;
  for (let k = 0; k < route.pts.length; k++) {
    const a = route.pts[k], b = route.pts[(k + 1) % route.pts.length];
    runLen += Math.hypot(b.x - a.x, b.z - a.z);
    const curved = Math.abs(b.h - sh) > 0.06;
    if (runLen >= (curved ? 5 : 14)) {
      piece((sx + b.x) / 2, (sz + b.z) / 2, sh, runLen);
      runLen = 0;
      sx = b.x; sz = b.z; sh = b.h;
    }
  }
  if (runLen > 0.5) {
    const last = route.pts[route.pts.length - 1];
    piece((sx + last.x) / 2, (sz + last.z) / 2, sh, runLen);
  }
  const mesh = B.build();
  mesh.receiveShadow = true;
  return mesh;
}
