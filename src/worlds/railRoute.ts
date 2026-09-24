// The island railway: two seeded, free-flowing THROUGH LINES per island — a
// north-south line and a west-east line. Each runs portal to portal: it
// enters on a straight stem 24 m beside a causeway avenue, wanders across the
// island as a Catmull-Rom spline, and leaves on the opposite stem, carrying
// on over the strait on the causeway (the strait south / east of an island
// belongs to that island's lines, so neighbouring lines meet end to end). The
// two lines cross exactly once, at a square diamond in the middle of a block.
//
// The spline pays no attention to the street lattice, so it is then DEFORMED
// against it: grazes are lifted off the asphalt, every genuine street
// crossing is squared up, the trestles meet the river at a right angle.
// Every candidate is validated per seed (shapeQuality mirrors the audit), and
// only a clean one ships. Where a line meets a street the plan carves a level
// crossing (cityPlan); where it meets the river, transit lays a trestle deck.
import * as THREE from 'three';
import { rng, chunkSeed } from '../engine/rng.js';
import { Baked } from '../engine/baked.js';
import { bakedModel, type BakedTemplate } from '../engine/assets.js';
import { makePath, polyPath, type WorldPath } from './spline.js';
import { citySeed, southExit, eastExit, CITY_PITCH } from './cityGrid.js';
import {
  streetCandidatesFor, across, along, pointAt, lineDev, inSpan,
  type StreetLine, type StreetCandidates,
} from './streetLines.js';
import { baseRiverFor, type RiverRoute } from './riverRoute.js';
import { ISLAND } from './world.js';
import { coastFor, type Coast } from './coast.js';

export const RAIL_Y = 0.11;   // track bed base, just above the slab top
export const RAIL_TOP = 0.21; // where train wheels sit
/** the track runs this far beside a causeway avenue's centreline (m) */
export const RAIL_OFFSET = 24;
/** straight portal stem inland from the rim (m) */
export const STEM = 180;
/** half-length of the pinned straight through the diamond (m) */
const DIAMOND_ARM = 16;

export type LineKind = 'ns' | 'ew';

export interface RailRoute {
  kind: LineKind;
  path: WorldPath;
  total: number;
  /** dense polyline (for the rails mesh + minimap), h = heading atan2(dx, dz),
   * running from the north / west rim (arc 0) to the neighbour's rim across
   * the south / east strait (arc total) */
  pts: Array<{ x: number; z: number; h: number }>;
  sample(dist: number): { x: number; z: number; h: number };
  /** distance from (x, z) to the centreline */
  distTo(x: number, z: number): number;
  near(x: number, z: number, r: number): boolean;
  /** rail heading at the point nearest to (x, z) — lets the plan tell a
   * parallel run (bad, shadows streets) from a square crossing (fine) */
  headingAt(x: number, z: number): number;
  /** arc position of the point nearest to (x, z) */
  arcAt(x: number, z: number): number;
  /** arc where the line leaves the island over the south / east rim */
  rimOut: number;
  /** candidate street edges this line cuts badly (a shallow crossing, a
   * crossing hard by a junction, a long hug) — the plan drops them */
  vetoed: number[];
  control: Array<{ x: number; z: number }>;
}

/** both lines of one island + the diamond where they cross */
export interface RailNet {
  lines: [RailRoute, RailRoute];
  /** every candidate street edge either line vetoed (see RailRoute.vetoed) */
  vetoed: Set<number>;
  diamond: { x: number; z: number; /** arc of the diamond on each line */ d: [number, number] };
  distTo(x: number, z: number): number;
  near(x: number, z: number, r: number): boolean;
  /** heading of the nearest line at (x, z) */
  headingAt(x: number, z: number): number;
}

/** where the two lines enter / leave the island: the stems' across-axis
 * coordinate (x for the north-south line, z for the west-east line) */
export function railPortals(bx: number, by: number): { xN: number; xS: number; zW: number; zE: number } {
  return {
    xN: southExit(bx, by - 1) * 64 + RAIL_OFFSET,
    xS: southExit(bx, by) * 64 + RAIL_OFFSET,
    zW: eastExit(bx - 1, by) * 64 + RAIL_OFFSET,
    zE: eastExit(bx, by) * 64 + RAIL_OFFSET,
  };
}

// module-level cache: the net only depends on the city cell, and the chunk
// baker, the city plan and the trains all ask for it
const cache = new Map<string, RailNet>();

/** test/audit hook: nets are cached per cell, so switching the city base
 * seed requires a flush or stale cities come back */
export function clearRailCache(): void { cache.clear(); }

export function railNetFor(bx: number, by: number): RailNet {
  const key = `${bx},${by}`;
  let net = cache.get(key);
  if (!net) {
    net = buildNet(bx, by);
    cache.set(key, net);
    if (cache.size > 48) cache.delete(cache.keys().next().value as string);
  }
  return net;
}

interface Attempt { control: Array<{ x: number; z: number }>; score: number; path: WorldPath; veto: Set<number> }

/** the streets a rough line would cut badly: crossed shallower than ~60
 * degrees, crossed within 20 m of a junction, or hugged for over 8 m. The
 * plan drops them (the dead-end trim repairs the web), so the deform never
 * has to square what can't be squared. `pre` carries the other line's. */
function vetoesFor(path: WorldPath, streets: StreetCandidates, pre: Set<number>): Set<number> {
  const veto = new Set(pre);
  const pts = path.pts;
  for (let k = 0; k + 1 < pts.length; k++) {
    const a = pts[k], b = pts[k + 1];
    const len = Math.hypot(b.x - a.x, b.z - a.z);
    if (len < 1e-3) continue;
    for (const L of streets.near((a.x + b.x) / 2, (a.z + b.z) / 2, len / 2 + 1)) {
      const va = across(L, a.x, a.z), vb = across(L, b.x, b.z);
      if (va * vb >= 0) continue;
      const sa = along(L, a.x, a.z);
      const s = sa + (along(L, b.x, b.z) - sa) * (-va / (vb - va));
      if (!inSpan(L, s)) continue;
      if (L.kind !== 'exit' && (Math.abs(vb - va) / len < 0.87 || L.nodeGap(s) < 20)) veto.add(L.id);
    }
  }
  const hug = new Map<number, number>();
  for (const p of pts) {
    for (const L of streets.near(p.x, p.z, 10)) {
      if (Math.abs(across(L, p.x, p.z)) < 10 && inSpan(L, along(L, p.x, p.z), 2) && lineDev(L, p.h) < (55 * Math.PI) / 180) {
        hug.set(L.id, (hug.get(L.id) ?? 0) + 2);
      }
    }
  }
  for (const [id, m] of hug) if (m > 8 && streets.lines[id].kind !== 'exit') veto.add(id);
  return veto;
}

/** the candidate streets minus a veto set */
function without(streets: StreetCandidates, veto: Set<number>): StreetCandidates {
  if (!veto.size) return streets;
  return {
    lines: streets.lines.filter(L => !veto.has(L.id)),
    near: (x, z, r) => streets.near(x, z, r).filter(L => !veto.has(L.id)),
    nearestNode: streets.nearestNode,
  };
}

/** how clean a deformed line came out — mirrors the audit's own checks,
 * so a line is only ever shipped when the deformation provably worked */
interface Quality {
  ride: number; skew: number; folds: number; bridge: number; riverSkew: number;
  offLand: number; riverRide: number; extra: number;
}

/** the frame a line runs in: u = progress (z for north-south, x for
 * west-east), v = the across coordinate */
interface Frame {
  kind: LineKind;
  /** stems' v at the start (north / west) and end (south / east) */
  v0: number;
  v1: number;
  /** diamond in (u, v) */
  du: number;
  dv: number;
}
const toXZ = (f: Frame, u: number, v: number): { x: number; z: number } =>
  f.kind === 'ns' ? { x: v, z: u } : { x: u, z: v };
const uOf = (f: Frame, x: number, z: number): number => (f.kind === 'ns' ? z : x);
const vOf = (f: Frame, x: number, z: number): number => (f.kind === 'ns' ? x : z);
/** inside the island's own interior (off both stems and the strait) */
const interior = (f: Frame, x: number, z: number, pad = 5): boolean => {
  const u = uOf(f, x, z);
  return u > STEM + pad && u < ISLAND - STEM - pad;
};

/**
 * Where the river passes within 8 m of a lattice street line, a road bridge
 * lives (or may live — the plan's final bridge set is a subset of these).
 * The rail must cross the water well away from every one of them: a trestle
 * sharing the river with a road bridge is the one rail/river/road pileup the
 * world forbids. Zones derive from the street lines + the river alone, so the
 * gate runs inside the route search with no plan built yet.
 */
function bridgeZones(lines: StreetLine[], river: RiverRoute): Array<{ x: number; z: number }> {
  const zones: Array<{ x: number; z: number }> = [];
  for (const p of river.pts) {
    // the water's EDGE reaches the road band (w/2 + 7 m) — that is what
    // makes a forbidden cell, not the centreline
    for (const L of lines) {
      if (Math.abs(across(L, p.x, p.z)) >= p.w / 2 + 9) continue;
      const s = along(L, p.x, p.z);
      if (inSpan(L, s, -2)) zones.push(pointAt(L, s));
    }
  }
  return zones;
}

/** ~2 m resample of an open polyline, headings interpolated */
function densify(pts: Array<{ x: number; z: number; h: number }>): Array<{ x: number; z: number; h: number }> {
  const dense: Array<{ x: number; z: number; h: number }> = [];
  const N = pts.length;
  for (let k = 0; k < N - 1; k++) {
    const a = pts[k], b = pts[k + 1];
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
  if (N) dense.push({ ...pts[N - 1] });
  return dense;
}

/** proper segment intersections of two open polylines, skipping any within
 * `skipR` of (sx, sz) */
function lineHits(
  a: Array<{ x: number; z: number }>, b: Array<{ x: number; z: number }>,
  sx: number, sz: number, skipR: number,
): number {
  // bucket b's segments for speed
  const CELL = 32;
  const grid = new Map<string, number[]>();
  for (let k = 0; k < b.length - 1; k++) {
    const p = b[k], q = b[k + 1];
    const x0 = Math.floor(Math.min(p.x, q.x) / CELL), x1 = Math.floor(Math.max(p.x, q.x) / CELL);
    const z0 = Math.floor(Math.min(p.z, q.z) / CELL), z1 = Math.floor(Math.max(p.z, q.z) / CELL);
    for (let gx = x0; gx <= x1; gx++) for (let gz = z0; gz <= z1; gz++) {
      const kk = `${gx},${gz}`;
      if (!grid.has(kk)) grid.set(kk, []);
      grid.get(kk)!.push(k);
    }
  }
  let hits = 0;
  const seen = new Set<string>();
  for (let i = 0; i < a.length - 1; i++) {
    const p = a[i], q = a[i + 1];
    const cells = new Set<string>();
    const x0 = Math.floor(Math.min(p.x, q.x) / CELL), x1 = Math.floor(Math.max(p.x, q.x) / CELL);
    const z0 = Math.floor(Math.min(p.z, q.z) / CELL), z1 = Math.floor(Math.max(p.z, q.z) / CELL);
    for (let gx = x0; gx <= x1; gx++) for (let gz = z0; gz <= z1; gz++) cells.add(`${gx},${gz}`);
    for (const c of cells) {
      for (const k of grid.get(c) ?? []) {
        const tag = `${i},${k}`;
        if (seen.has(tag)) continue;
        seen.add(tag);
        const r = b[k], s = b[k + 1];
        const d1x = q.x - p.x, d1z = q.z - p.z, d2x = s.x - r.x, d2z = s.z - r.z;
        const den = d1x * d2z - d1z * d2x;
        if (Math.abs(den) < 1e-9) continue;
        const t = ((r.x - p.x) * d2z - (r.z - p.z) * d2x) / den;
        const w = ((r.x - p.x) * d1z - (r.z - p.z) * d1x) / den;
        if (t < 0 || t >= 1 || w < 0 || w >= 1) continue;
        const hx = p.x + d1x * t, hz = p.z + d1z * t;
        if (Math.hypot(hx - sx, hz - sz) < skipR) continue;
        hits++;
      }
    }
  }
  return hits;
}

function shapeQuality(
  p: WorldPath, f: Frame, streets: StreetCandidates,
  river: RiverRoute | null, zones: Array<{ x: number; z: number }>,
  coast: Coast, other: RailRoute | null,
): Quality {
  const pts = p.pts, N = pts.length;
  let ride = 0, run = 0, folds = 0, skew = 0;
  // dense resample at ~2 m: pin walls collapse vertices, leaving 20 m+
  // chords that point-based scans would skim straight over — the chords
  // are real rail the audit will see, so the gate must see them too
  const dense = densify(pts);
  const D = dense.length;
  for (let k = 1; k < N - 1; k++) {
    const a = pts[k - 1], b = pts[k], c = pts[k + 1];
    const l1 = Math.hypot(b.x - a.x, b.z - a.z), l2 = Math.hypot(c.x - b.x, c.z - b.z);
    if (l1 > 0.5 && l2 > 0.5 && (c.x - b.x) * (b.x - a.x) + (c.z - b.z) * (b.z - a.z) < 0) folds++;
  }
  // distributed hairpins: a ~150-degree U-turn smeared over 3-4 vertices
  // turns < 90 degrees at each one and dodges the reversal test above while
  // still folding the track back on itself (and skimming asphalt at the
  // apex). Square crossing walls turn ~90 degrees per wall, so a >120
  // degree swing across a tight window is never legitimate track.
  for (let k = 0; k + 3 < N; k++) {
    const a = pts[k], b = pts[k + 3];
    if (Math.hypot(b.x - a.x, b.z - a.z) > 12) continue;
    let dh = b.h - a.h;
    while (dh > Math.PI) dh -= Math.PI * 2;
    while (dh < -Math.PI) dh += Math.PI * 2;
    if (Math.abs(dh) > (120 * Math.PI) / 180) folds++;
  }
  const lines = streets.lines;
  for (let k = 0; k < D; k++) {
    const b = dense[k];
    let bad = false;
    for (const L of streets.near(b.x, b.z, 7)) {
      if (Math.abs(across(L, b.x, b.z)) < 7 && inSpan(L, along(L, b.x, b.z), 2) && lineDev(L, b.h) < Math.PI / 3) { bad = true; break; }
    }
    if (bad) run += 2;
    else { ride = Math.max(ride, run); run = 0; }
  }
  ride = Math.max(ride, run);
  // squareness of every crossing the plan would record (span-crossings of
  // the final path, >= 11 m from a node): the rail's worst angle to the
  // street WHILE ON ITS asphalt near this crossing
  for (const L of lines) {
    for (let k = 0; k < N - 1; k++) {
      const a = pts[k], b = pts[k + 1];
      const va = across(L, a.x, a.z), vb = across(L, b.x, b.z);
      if (va * vb >= 0) continue;
      const fr = -va / (vb - va);
      const sa = along(L, a.x, a.z);
      const s = sa + (along(L, b.x, b.z) - sa) * fr;
      if (!inSpan(L, s) || L.nodeGap(s) < 11) continue;
      let worst = 0;
      for (let i = 0; i < D; i++) {
        if (Math.abs(across(L, dense[i].x, dense[i].z)) >= 6.5) continue;
        if (Math.abs(along(L, dense[i].x, dense[i].z) - s) >= 24) continue;
        worst = Math.max(worst, Math.abs(90 - (lineDev(L, dense[i].h) * 180) / Math.PI));
      }
      skew = Math.max(skew, worst);
    }
  }
  // R22: a trestle sharing the river with a road bridge is forbidden —
  // count trestle runs (contiguous in-water stretches) that come within
  // 9 m of any bridge zone (the route scorer still prefers 24 m; this is
  // the hard gate). The water test uses the bed's outer edge.
  let bridge = 0;
  let riverSkew = 0;
  let riverRide = 0;
  if (river) {
    let inRun = false;
    for (const pt of dense) {
      if (!river.near(pt.x, pt.z, river.halfAt(pt.x, pt.z) + 4)) { inRun = false; continue; }
      let dmin = Infinity;
      for (const zn of zones) {
        const d = Math.hypot(pt.x - zn.x, pt.z - zn.z);
        if (d < dmin) dmin = d;
      }
      if (dmin >= 9) { inRun = false; continue; }
      if (!inRun) { bridge++; inRun = true; }
    }
    // R27: the trestle must meet the water at a right angle
    for (const pt of dense) {
      if (!river.inWater(pt.x, pt.z)) continue;
      const near = river.path.nearest(pt.x, pt.z);
      const nx = river.pts[near.i].h + Math.PI / 2;
      let d = Math.abs(pt.h - nx) % Math.PI;
      if (d > Math.PI / 2) d = Math.PI - d;
      riverSkew = Math.max(riverSkew, d);
    }
    // a line may cross the river, never ride it: an in-water run longer
    // than a square trestle is a line lying in the water
    let wet = 0;
    for (const pt of dense) {
      if (river.inWater(pt.x, pt.z)) { wet += 2; if (wet > 34) { riverRide++; wet = -1e9; } } else wet = 0;
    }
  }
  // R29: the interior runs on dry land, a bed-width clear of the beach (the
  // stems cross the shore onto the causeway by design)
  let offLand = 0;
  for (const pt of dense) if (interior(f, pt.x, pt.z) && !coast.inLand(pt.x, pt.z, 12)) offLand++;
  // R31: the second line meets the first ONLY at the diamond
  const extra = other ? lineHits(pts, other.pts, toXZ(f, f.du, f.dv).x, toXZ(f, f.du, f.dv).z, 6) : 0;
  return { ride, skew, folds, bridge, riverSkew: (riverSkew * 180) / Math.PI, offLand, riverRide, extra };
}

const clean = (q: Quality): boolean =>
  q.offLand === 0 && q.folds === 0 && q.bridge === 0 && q.ride < 5 && q.skew < 24
  && q.riverSkew < 30 && q.riverRide === 0 && q.extra === 0;

const qualityBetter = (a: Quality, b: Quality): boolean =>
  a.extra !== b.extra ? a.extra < b.extra
  : a.offLand !== b.offLand ? a.offLand < b.offLand
    : a.folds !== b.folds ? a.folds < b.folds
      : a.riverRide !== b.riverRide ? a.riverRide < b.riverRide
        : a.bridge !== b.bridge ? a.bridge < b.bridge
          : a.ride !== b.ride ? a.ride < b.ride
            : a.skew !== b.skew ? a.skew < b.skew
              : a.riverSkew < b.riverSkew;

/** the diamond: a spot near the middle of the island well inside a block —
 * clear of every candidate street (the pinned ±16 m straights plus the
 * crossings' own walls fit), of the river and of the shore */
function pickDiamond(bx: number, by: number, river: RiverRoute, coast: Coast, streets: StreetCandidates): { x: number; z: number } {
  const r = rng(chunkSeed(citySeed(bx, by), 0xd1a, 7));
  for (const need of [30, 26, 22, 18]) {
    const opts: Array<{ x: number; z: number }> = [];
    for (let x = 256; x <= ISLAND - 256; x += 8) for (let z = 256; z <= ISLAND - 256; z += 8) {
      if (river.distTo(x, z) < 44) continue;
      if (!coast.inLand(x, z, 140)) continue;
      if (streets.near(x, z, need).length) continue;
      opts.push({ x, z });
    }
    if (opts.length) return opts[(r() * opts.length) | 0];
  }
  return { x: 5 * 64 + 32, z: 6 * 64 + 32 };
}

function buildNet(bx: number, by: number): RailNet {
  const seed = citySeed(bx, by);
  const streets = streetCandidatesFor(bx, by);
  const lines = streets.lines;
  // the river as it is before any street crosses it: streets later keep
  // their bridges 30 m clear of every trestle, so the straightening at
  // bridges never reaches the water under the track
  const river = baseRiverFor(bx, by);
  const zones = bridgeZones(lines, river);
  const coast = coastFor(bx, by);
  const P = railPortals(bx, by);
  const D = pickDiamond(bx, by, river, coast, streets);
  const fNS: Frame = { kind: 'ns', v0: P.xN, v1: P.xS, du: D.z, dv: D.x };
  const fEW: Frame = { kind: 'ew', v0: P.zW, v1: P.zE, du: D.x, dv: D.z };
  const ns = buildLine(seed, fNS, streets, river, zones, coast, null);
  const ew = buildLine(seed, fEW, streets, river, zones, coast, ns);
  const both: [RailRoute, RailRoute] = [ns, ew];
  return {
    lines: both,
    vetoed: new Set([...ns.vetoed, ...ew.vetoed]),
    diamond: { x: D.x, z: D.z, d: [ns.arcAt(D.x, D.z), ew.arcAt(D.x, D.z)] },
    distTo: (x, z) => Math.min(ns.distTo(x, z), ew.distTo(x, z)),
    near: (x, z, rr) => ns.near(x, z, rr) || ew.near(x, z, rr),
    headingAt: (x, z) => (ns.distTo(x, z) <= ew.distTo(x, z) ? ns : ew).headingAt(x, z),
  };
}

function buildLine(
  seed: number, f: Frame, streets: StreetCandidates, river: RiverRoute,
  zones: Array<{ x: number; z: number }>, coast: Coast, other: RailRoute | null,
): RailRoute {
  const salt = f.kind === 'ns' ? 0x5a1 : 0x5e1;
  const pre = new Set(other?.vetoed ?? []);
  // rank line candidates by the cheap pre-deform score, then actually
  // deform the best few and SHIP the first whose geometry comes out clean
  // (no on-road rides, no folds, square crossings, trestles clear of road
  // bridges, one diamond). The deform has rare bad modes on adversarial
  // splines; rather than patching each one, a dirty result costs a re-roll.
  // Later rounds re-search with other control-slide strengths (they shift
  // where the line meets the water).
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
    for (let attempt = 0; attempt < 90; attempt++) {
      const r = rng(chunkSeed(seed, salt, 0x7e + attempt + round * 1000));
      const a = tryLine(r, f, streets, river, zones, coast, other, mul, pre);
      if (!a) continue;
      if (a.score === 0) { ranked.length = 0; ranked.push(a); break; }
      offer(a);
    }
    for (const a of ranked) {
      const view = without(streets, a.veto);
      const route = finalize(f, a.control, a.path, view, river, zones, a.veto);
      const q = shapeQuality(route.path, f, view, river, zones, coast, other);
      if (clean(q)) return route;
      if (!fallback || qualityBetter(q, fallback.q)) fallback = { route, q };
    }
  }
  // last resort: the deterministic straight-ish line through the diamond
  const a = forcedLine(f, streets, pre);
  const view = without(streets, a.veto);
  const route = finalize(f, a.control, a.path, view, river, zones, a.veto);
  const q = shapeQuality(route.path, f, view, river, zones, coast, other);
  if (clean(q) || !fallback || qualityBetter(q, fallback.q)) return route;
  return fallback.route;
}

/** the fixed control points every candidate shares: both stems (straight,
 * rim to STEM, plus the strait) and the diamond's guides */
function stemControls(f: Frame): { head: Array<{ x: number; z: number }>; mid: Array<{ x: number; z: number }>; tail: Array<{ x: number; z: number }> } {
  const G = 22;
  return {
    head: [toXZ(f, 0, f.v0), toXZ(f, STEM / 2, f.v0), toXZ(f, STEM, f.v0)],
    mid: [toXZ(f, f.du - G, f.dv), toXZ(f, f.du, f.dv), toXZ(f, f.du + G, f.dv)],
    tail: [
      toXZ(f, ISLAND - STEM, f.v1), toXZ(f, ISLAND - STEM / 2, f.v1), toXZ(f, ISLAND, f.v1),
      toXZ(f, ISLAND + (CITY_PITCH - ISLAND) / 2, f.v1), toXZ(f, CITY_PITCH, f.v1),
    ],
  };
}

/** one control-chain candidate; null when control spacing is impossible */
function tryLine(
  r: () => number, f: Frame, streets: StreetCandidates,
  river: RiverRoute, zones: Array<{ x: number; z: number }>,
  coast: Coast, other: RailRoute | null,
  slideMul = 0.9,
  pre: Set<number> = new Set(),
): Attempt | null {
  const full = streets;
  const { head, mid, tail } = stemControls(f);
  // free control points between the stems and the diamond: evenly spaced in
  // u, wandering in v around the straight chord
  const free = (u0: number, v0: number, u1: number, v1: number): Array<{ x: number; z: number }> => {
    const n = 1 + ((r() * 2) | 0);
    const amp = 20 + r() * 50; // gentle: every street is laid around it
    const out: Array<{ x: number; z: number }> = [];
    for (let k = 1; k <= n; k++) {
      const t = k / (n + 1);
      const u = u0 + (u1 - u0) * t + (r() - 0.5) * 20;
      let v = v0 + (v1 - v0) * t + (r() - 0.5) * 2 * amp;
      v = Math.max(70, Math.min(ISLAND - 70, v));
      out.push(toXZ(f, u, v));
    }
    return out;
  };
  const freeA = free(STEM, f.v0, f.du - 22, f.dv);
  const freeB = free(f.du + 22, f.dv, ISLAND - STEM, f.v1);
  const movable = [...freeA, ...freeB];
  // slide free points out of the street-junction squares — a railway
  // through an intersection tile reads as chaos, so keep a 16 m bubble
  for (const p of movable) {
    const node = streets.nearestNode(p.x, p.z);
    if (!node) continue;
    const d = Math.hypot(p.x - node.x, p.z - node.z);
    if (d < 16) {
      const k = d < 0.01 ? 16 : 16 / d;
      p.x = node.x + (p.x - node.x) * k;
      p.z = node.z + (p.z - node.z) * k;
    }
  }
  // free points near a bridge zone slide along the river (in z) so the
  // line's water crossing lands between road bridges instead of on one (R22)
  for (const p of movable) {
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
  // the line stays well inland: a free point near the shore is pulled in to
  // 70 m from it (R29)
  for (const p of movable) {
    if (coast.inLand(p.x, p.z, 70)) continue;
    const q = coast.shoreToward(p.x, p.z, -70);
    p.x = q.x; p.z = q.z;
  }
  const control = [...head, ...freeA, ...mid, ...freeB, ...tail];
  // progress must keep going forward, with breathing room between the free
  // points, or the spline kinks
  for (let k = 1; k < control.length; k++) {
    const a = control[k - 1], b = control[k];
    if (uOf(f, b.x, b.z) - uOf(f, a.x, a.z) < 12) return null;
  }
  for (const p of movable) {
    for (const q of control) {
      if (q === p) continue;
      if (Math.hypot(p.x - q.x, p.z - q.z) < 45) return null;
    }
  }
  const path = makePath(control, false);
  // the streets this rough line would cut badly go (each one costs rank);
  // everything below scores against the streets that stay
  const veto = vetoesFor(path, full, pre);
  streets = without(full, veto);
  // score violations on dense samples
  // a trunk road (ring, embankment, bridge, seam, link) holds the island
  // together: vetoing one can strand a whole district, so it costs far more
  let score = 0;
  for (const id of veto) if (!pre.has(id)) score += 60;
  let inBridgeRun = false;
  let wet = 0;
  for (let k = 0; k < path.pts.length; k++) {
    const p = path.pts[k];
    if (!interior(f, p.x, p.z, 0)) continue;
    if (!coast.inLand(p.x, p.z, 30)) score += 30; // too close to the shore / at sea
    const node = streets.nearestNode(p.x, p.z);
    if (node) {
      const dx = p.x - node.x, dz = p.z - node.z;
      if (dx * dx + dz * dz < 14 * 14) score += 12; // threading a junction
    }
    // riding along the river is never a crossing
    if (river.inWater(p.x, p.z)) { wet += 2; if (wet > 30) score += 6; } else wet = 0;
    // nor is running beside it: track and river side by side make one wide
    // barrier the streets can barely cross (both want their own roads)
    if (river.distTo(p.x, p.z) < 80) {
      const near = river.path.nearest(p.x, p.z);
      let dev = Math.abs(p.h - river.pts[near.i].h) % Math.PI;
      if (dev > Math.PI / 2) dev = Math.PI - dev;
      if (dev < Math.PI / 4) score += 1.5;
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
      // a trestle that would meet the water at a skew costs rank too
      const near = river.path.nearest(p.x, p.z);
      const nx = river.pts[near.i].h + Math.PI / 2;
      let rd = Math.abs(p.h - nx) % Math.PI;
      if (rd > Math.PI / 2) rd = Math.PI - rd;
      if (rd > (30 * Math.PI) / 180) score += 8;
    } else inBridgeRun = false;
  }
  // a shallow line crossing means the rail rides the road corridor for tens
  // of metres no matter how the crossing itself is squared up
  const pts = path.pts;
  const cum: number[] = [0];
  for (let k = 1; k < pts.length; k++) {
    cum.push(cum[k - 1] + Math.hypot(pts[k].x - pts[k - 1].x, pts[k].z - pts[k - 1].z));
  }
  const hitArcs: number[] = [];
  for (let k = 0; k < pts.length - 1; k++) {
    const a = pts[k], b = pts[k + 1];
    const len = cum[k + 1] - cum[k];
    if (len < 0.001) continue;
    for (const L of streets.near((a.x + b.x) / 2, (a.z + b.z) / 2, len / 2 + 1)) {
      const va = across(L, a.x, a.z), vb = across(L, b.x, b.z);
      if (va * vb >= 0) continue;
      const sa = along(L, a.x, a.z);
      if (!inSpan(L, sa + (along(L, b.x, b.z) - sa) * (-va / (vb - va)))) continue;
      hitArcs.push(cum[k] + (-va / (vb - va)) * len);
    }
  }
  // two street hits within ~30 m of arc means the rail cuts a junction corner
  hitArcs.sort((p, q) => p - q);
  for (let i = 1; i < hitArcs.length; i++) {
    if (hitArcs[i] - hitArcs[i - 1] < 30) score += 50;
  }
  // hugging a street line near-parallel (the rails would sit on the asphalt
  // edge) — same 55° window the clearance pusher treats as "riding"
  for (const p of pts) {
    for (const L of streets.near(p.x, p.z, 10)) {
      if (Math.abs(across(L, p.x, p.z)) < 10 && inSpan(L, along(L, p.x, p.z), 2) && lineDev(L, p.h) < 55 * Math.PI / 180) score += 0.75;
    }
  }
  // R31: meet the other line only at the diamond, and never run close by it
  if (other) {
    const D = toXZ(f, f.du, f.dv);
    score += 300 * lineHits(pts, other.pts, D.x, D.z, 12);
    for (let k = 0; k < pts.length; k += 3) {
      const p = pts[k];
      if (Math.hypot(p.x - D.x, p.z - D.z) < 40) continue;
      if (other.near(p.x, p.z, 14)) score += 4;
    }
  }
  return { control, score, path, veto };
}

/** deterministic last resort: stems + diamond guides, straight in between */
function forcedLine(f: Frame, streets: StreetCandidates, pre: Set<number>): Attempt {
  const { head, mid, tail } = stemControls(f);
  const la = toXZ(f, (STEM + f.du - 22) / 2, (f.v0 + f.dv) / 2);
  const lb = toXZ(f, (f.du + 22 + ISLAND - STEM) / 2, (f.dv + f.v1) / 2);
  const control = [...head, la, ...mid, lb, ...tail];
  const path = makePath(control, false);
  return { control, score: 0, path, veto: vetoesFor(path, streets, pre) };
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
  lines: StreetCandidates,
  river: RiverRoute, zones: Array<{ x: number; z: number }>,
): Array<{ x: number; z: number }> {
  const swung = riverSwing(pts, river, zones);
  const lifted = clearancePush(riverPerp(swung, river), lines);
  const pushed = clearancePush(perpendicularCrossings(polyPath(lifted), lines), lines);
  // the river pin gets the LAST word: street swings and pins upstream can
  // drag a trestle off the perpendicular, and nothing downstream may undo it
  const ironed = ironSpikes(clearancePush(roundCorners(riverPerp(pushed, river)), lines));
  const cleaned = deOverlap(deSpikes(ironed));
  if (cleaned.length === ironed.length) return cleaned;
  // a fold was spliced out: its chord can cut a street approach askew or
  // ride the asphalt the fold used to skirt, so re-run the crossing tail
  // once on the cleaned shape, re-densified to ~2 m first so the pins can
  // grip the chord's middle and bend it square
  const repinned = perpendicularCrossings(polyPath(subdivide(cleaned)), lines);
  return deOverlap(deSpikes(ironSpikes(clearancePush(roundCorners(clearancePush(repinned, lines)), lines))));
}

/** hard pins after the deform: both stems dead straight on their portal
 * coordinate (fading back into the free line over 30 m), and the diamond a
 * dead-straight run through the crossing point along the line's own axis —
 * the second line runs perpendicular, so the diamond is square (R30, R31) */
function pinFrame(pts: Array<{ x: number; z: number }>, f: Frame, FADE = 30): Array<{ x: number; z: number }> {
  const out = pts.map(p => ({ x: p.x, z: p.z }));
  // the diamond: find where the line passes it, then pin by arc around it
  let kD = 0, best = Infinity;
  const D = toXZ(f, f.du, f.dv);
  out.forEach((p, k) => {
    const d = (p.x - D.x) ** 2 + (p.z - D.z) ** 2;
    if (d < best) { best = d; kD = k; }
  });
  const cum: number[] = [0];
  for (let k = 1; k < out.length; k++) cum.push(cum[k - 1] + Math.hypot(out[k].x - out[k - 1].x, out[k].z - out[k - 1].z));
  for (let k = 0; k < out.length; k++) {
    const p = out[k];
    const u = uOf(f, p.x, p.z);
    let v = vOf(f, p.x, p.z);
    // stems
    if (u <= STEM) v = f.v0;
    else if (u < STEM + FADE) v += (f.v0 - v) * 0.5 * (1 + Math.cos((Math.PI * (u - STEM)) / FADE));
    if (u >= ISLAND - STEM) v = f.v1;
    else if (u > ISLAND - STEM - FADE) v += (f.v1 - v) * 0.5 * (1 + Math.cos((Math.PI * (ISLAND - STEM - u)) / FADE));
    // diamond
    const ad = Math.abs(cum[k] - cum[kD]);
    if (ad <= DIAMOND_ARM) v = f.dv;
    else if (ad < DIAMOND_ARM + FADE) v += (f.dv - v) * 0.5 * (1 + Math.cos((Math.PI * (ad - DIAMOND_ARM)) / FADE));
    out[k] = toXZ(f, u, v);
  }
  return out;
}

/** round off sharp turns into real curves: any corner turning more than
 * ~38 degrees has its apex replaced by a quadratic Bézier (entry, apex
 * tangent point, exit) sampled every ~1.5 m — a 90-degree crossing wall
 * gets a proper curve lead instead of a hard right angle, and pin kinks
 * or splice remnants read as smooth track. Crossing walls keep their
 * square run through the asphalt: both corners of a wall bow alike and
 * the stretch between them is untouched. A clearance push afterwards
 * guarantees a curve can't dip the rail back onto asphalt. The ends of the
 * open line are never rounded. */
function roundCorners(pts: Array<{ x: number; z: number }>): Array<{ x: number; z: number }> {
  let cur = pts.map(p => ({ x: p.x, z: p.z }));
  for (let pass = 0; pass < 2; pass++) {
    const N = cur.length;
    const MIN_TURN = (38 * Math.PI) / 180;
    const out: Array<{ x: number; z: number }> = [];
    let changed = false;
    for (let k = 0; k < N; k++) {
      const b = cur[k];
      if (k === 0 || k === N - 1) { out.push(b); continue; }
      const a = cur[k - 1], c = cur[k + 1];
      const l1 = Math.hypot(b.x - a.x, b.z - a.z), l2 = Math.hypot(c.x - b.x, c.z - b.z);
      let turn = 0;
      if (l1 > 0.25 && l2 > 0.25) {
        const t1 = Math.atan2(b.x - a.x, b.z - a.z), t2 = Math.atan2(c.x - b.x, c.z - b.z);
        turn = Math.abs(t2 - t1);
        if (turn > Math.PI) turn = Math.PI * 2 - turn;
      }
      if (turn < MIN_TURN || l1 < 2 || l2 < 2) { out.push(b); continue; }
      // tangent length along each leg: ~40% of the leg, capped at 7 m, so
      // the curve radius scales with the corner it rounds
      const d1 = Math.min(0.4 * l1, 7), d2 = Math.min(0.4 * l2, 7);
      const p1 = { x: b.x + (a.x - b.x) * (d1 / l1), z: b.z + (a.z - b.z) * (d1 / l1) };
      const p2 = { x: b.x + (c.x - b.x) * (d2 / l2), z: b.z + (c.z - b.z) * (d2 / l2) };
      const n = Math.max(2, Math.ceil((d1 + d2) / 1.5));
      for (let q = 0; q < n; q++) {
        const t = q / n, u = 1 - t;
        out.push({
          x: u * u * p1.x + 2 * u * t * b.x + t * t * p2.x,
          z: u * u * p1.z + 2 * u * t * b.z + t * t * p2.z,
        });
      }
      changed = true;
    }
    cur = out;
    if (!changed) break;
  }
  return cur;
}

/** insert points along every segment so none exceeds ~maxLen m */
function subdivide(
  pts: Array<{ x: number; z: number }>, maxLen = 2,
): Array<{ x: number; z: number }> {
  const out: Array<{ x: number; z: number }> = [];
  const N = pts.length;
  for (let k = 0; k < N - 1; k++) {
    const a = pts[k], b = pts[k + 1];
    const steps = Math.max(1, Math.ceil(Math.hypot(b.x - a.x, b.z - a.z) / maxLen));
    for (let q = 0; q < steps; q++) {
      out.push({ x: a.x + (b.x - a.x) * q / steps, z: a.z + (b.z - a.z) * q / steps });
    }
  }
  if (N) out.push({ x: pts[N - 1].x, z: pts[N - 1].z });
  return out;
}

/** repair hairpins in the deformed path. Two modes, both iterated:
 *  - exact REVERSALS (path doubles straight back, dot < 0): the apex vertex
 *    goes and the run chords straight across the fold;
 *  - DISTRIBUTED U-turns: a >120-degree heading swing across three short
 *    segments (chord <= 12 m) folds the track back without any single
 *    reversal — splice out the two middle vertices instead. Square crossing
 *    walls turn ~90 degrees per wall and are untouched; after a splice the
 *    caller re-runs the crossing tail so the shortcut re-squares its
 *    approaches. The line's two end vertices always stay. */
function deSpikes(pts: Array<{ x: number; z: number }>): Array<{ x: number; z: number }> {
  let cur = pts.map(p => ({ x: p.x, z: p.z }));
  for (let pass = 0; pass < 4; pass++) {
    const N = cur.length;
    const drop: boolean[] = new Array(N).fill(false);
    let any = false;
    for (let k = 1; k < N - 1; k++) {
      const a = cur[k - 1], b = cur[k], c = cur[k + 1];
      const l1 = Math.hypot(b.x - a.x, b.z - a.z), l2 = Math.hypot(c.x - b.x, c.z - b.z);
      if (l1 < 0.5 || l2 < 0.5) continue;
      if ((c.x - b.x) * (b.x - a.x) + (c.z - b.z) * (b.z - a.z) < 0) { drop[k] = true; any = true; }
    }
    for (let k = 0; k + 3 < N; k++) {
      const a = cur[k], b = cur[k + 1], c = cur[k + 2], d = cur[k + 3];
      const l1 = Math.hypot(b.x - a.x, b.z - a.z), l2 = Math.hypot(c.x - b.x, c.z - b.z);
      const l3 = Math.hypot(d.x - c.x, d.z - c.z);
      if (l1 > 12 || l2 < 0.5 || l2 > 12 || l3 > 12) continue;
      const t1 = Math.atan2(b.x - a.x, b.z - a.z), t2 = Math.atan2(d.x - c.x, d.z - c.z);
      let dh = Math.abs(t2 - t1);
      if (dh > Math.PI) dh = Math.PI * 2 - dh;
      if (dh <= (120 * Math.PI) / 180) continue;
      if (Math.hypot(d.x - a.x, d.z - a.z) > 12) continue;
      drop[k + 1] = true;
      drop[k + 2] = true;
      any = true;
    }
    if (!any) break;
    cur = cur.filter((_, k) => !drop[k]);
  }
  return cur;
}

/** remove needle folds: places where the line doubled back so hard that
 * two NON-adjacent stretches of track lie on top of each other (legs of a
 * ~180-degree turn can land within centimetres of each other). The pinch
 * pair is spliced — everything on the arc between them goes, the line
 * closes across the <=4 m gap, and roundCorners smooths the join. */
function deOverlap(pts: Array<{ x: number; z: number }>): Array<{ x: number; z: number }> {
  let cur = pts.map(p => ({ x: p.x, z: p.z }));
  const CELL = 8;
  for (let pass = 0; pass < 4; pass++) {
    const N = cur.length;
    const cum: number[] = [0];
    for (let k = 1; k < N; k++) cum.push(cum[k - 1] + Math.hypot(cur[k].x - cur[k - 1].x, cur[k].z - cur[k - 1].z));
    const grid = new Map<string, number[]>();
    for (let k = 0; k < N; k++) {
      const kk = `${Math.floor(cur[k].x / CELL)},${Math.floor(cur[k].z / CELL)}`;
      if (!grid.has(kk)) grid.set(kk, []);
      grid.get(kk)!.push(k);
    }
    // find one pinch: non-adjacent samples within the bed width
    let cutA = -1, cutB = -1;
    for (let k = 0; k < N && cutA < 0; k++) {
      const p = cur[k];
      const gx = Math.floor(p.x / CELL), gz = Math.floor(p.z / CELL);
      for (let ox = -1; ox <= 1 && cutA < 0; ox++) {
        for (let oz = -1; oz <= 1; oz++) {
          const arr = grid.get(`${gx + ox},${gz + oz}`);
          if (!arr) continue;
          for (const m of arr) {
            if (m <= k) continue;
            const sep = cum[m] - cum[k];
            if (sep < 14 || sep > 300) continue; // neighbours are fine
            const q = cur[m];
            if (Math.hypot(q.x - p.x, q.z - p.z) < 4) { cutA = k; cutB = m; break; }
          }
          if (cutA >= 0) break;
        }
      }
    }
    if (cutA < 0) return cur;
    cur = cur.filter((_, k) => k <= cutA || k >= cutB);
  }
  return cur;
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
    for (let k = 1; k < N - 1; k++) {
      const a = cur[k - 1], b = cur[k], c = cur[k + 1];
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

/** the rail must cross the river at a right angle — a trestle meeting the
 * water at 45 degrees reads broken. Every in-water stretch is pinned ONTO
 * ONE LINE: the river's normal through the stretch midpoint's centreline
 * point (weight 1 — the whole trestle ends up dead straight across the
 * water), with a cosine fade over 8 samples beyond the water so the
 * approach merges smoothly into the rest of the line. */
function riverPerp(
  pts: Array<{ x: number; z: number }>,
  river: RiverRoute,
): Array<{ x: number; z: number }> {
  const N = pts.length;
  let cur = pts.map(p => ({ x: p.x, z: p.z }));
  for (let pass = 0; pass < 3; pass++) {
    const inW = cur.map(p => river.near(p.x, p.z, river.halfAt(p.x, p.z) + 4));
    const stretches: number[][] = [];
    let run: number[] = [];
    for (let k = 0; k <= N; k++) {
      if (k < N && inW[k]) run.push(k);
      else if (run.length) { stretches.push(run); run = []; }
    }
    let changed = false;
    for (const st of stretches) {
      const m = st[(st.length / 2) | 0];
      const mid = cur[m];
      const near = river.path.nearest(mid.x, mid.z);
      const rp = near.p;
      const hr = river.pts[near.i].h;
      const nx = Math.cos(hr), nz = -Math.sin(hr); // river normal (heading + 90 deg)
      const half = st.length / 2, FADE = 8;
      for (let q = 0; q < N; q++) {
        const d = Math.abs(q - m);
        let wgt = 0;
        if (d <= half) wgt = 1;
        else if (d <= half + FADE) wgt = 0.5 * (1 + Math.cos((Math.PI * (d - half)) / FADE));
        else continue;
        const p = cur[q];
        const s = (p.x - rp.x) * nx + (p.z - rp.z) * nz;
        const tx = rp.x + nx * s, tz = rp.z + nz * s;
        const ox = (tx - p.x) * wgt, oz = (tz - p.z) * wgt;
        if (ox * ox + oz * oz > 1e-6) changed = true;
        cur[q] = { x: p.x + ox, z: p.z + oz };
      }
    }
    if (!changed) break;
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
        if (k + j < 0 || k + j >= N) continue;
        const v = raw[k + j] * (1 - 0.16 * Math.abs(j));
        if (Math.abs(v) > Math.abs(best)) best = v;
      }
      return best;
    });
    cur = cur.map((p, k) => ({ x: p.x, z: p.z + spread[k] }));
  }
  return cur;
}

function finalize(
  f: Frame, control: Array<{ x: number; z: number }>, path: WorldPath,
  lines: StreetCandidates, river: RiverRoute, zones: Array<{ x: number; z: number }>,
  veto: Set<number>,
): RailRoute {
  // the spline pays no attention to the street lattice, so wherever it
  // happens to meet a road it is reshaped to do so properly: grazes are
  // swung clear, every genuine crossing is squared up — which reads as a
  // proper railway junction and gives the level crossings their barriers a
  // clean strip to guard. The stems and the diamond are pinned last.
  // pinned BEFORE the deform (so every crossing pin sees the final stems and
  // diamond and squares against them), then re-snapped with a short fade in
  // case a pin's zone nudged a stem end
  const pre = pinFrame(path.pts, f);
  const withH = polyPath(pre).pts;
  const shaped = pinFrame(deform(withH, lines, river, zones), f, 8);
  const p2 = polyPath(shaped);
  // where the line crosses the island's far rim
  let rimOut = p2.total;
  {
    let s = 0;
    for (let k = 1; k < p2.pts.length; k++) {
      const a = p2.pts[k - 1], b = p2.pts[k];
      const seg = Math.hypot(b.x - a.x, b.z - a.z);
      const ua = uOf(f, a.x, a.z), ub = uOf(f, b.x, b.z);
      if (ua < ISLAND && ub >= ISLAND) { rimOut = s + seg * ((ISLAND - ua) / (ub - ua || 1)); break; }
      s += seg;
    }
  }
  return {
    kind: f.kind,
    path: p2,
    total: p2.total,
    pts: p2.pts,
    sample: d => p2.sample(d),
    distTo(x, z) { return Math.sqrt(p2.nearest(x, z).d2); },
    near(x, z, r) { return p2.nearest(x, z).d2 < r * r; },
    headingAt(x, z) { return p2.nearest(x, z).p.h; },
    arcAt(x, z) {
      const n = p2.nearest(x, z);
      let s = 0;
      for (let k = 1; k <= n.i; k++) s += Math.hypot(p2.pts[k].x - p2.pts[k - 1].x, p2.pts[k].z - p2.pts[k - 1].z);
      return s + Math.hypot(n.p.x - p2.pts[n.i].x, n.p.z - p2.pts[n.i].z);
    },
    rimOut,
    vetoed: [...veto].sort((p, q) => p - q),
    control,
  };
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
  streets: StreetCandidates,
): Array<{ x: number; z: number }> {
  const lines = streets.lines;
  const N = pts.length;
  const CLEAR = 11.5, BAND = 10, NEAR = 12, SWING = 30, PARALLEL = (55 * Math.PI) / 180;
  const clamp = (k: number): number => Math.max(0, Math.min(N - 1, k));
  // street families (parallel lines) in first-appearance order; a family's
  // pushes all run along its shared normal
  const families: Array<{ key: string; nx: number; nz: number; lines: StreetLine[] }> = [];
  for (const L of lines) {
    let f = families.find(q => q.key === L.family);
    if (!f) { f = { key: L.family, nx: L.nx, nz: L.nz, lines: [] }; families.push(f); }
    f.lines.push(L);
  }
  let cur = pts.map(p => ({ x: p.x, z: p.z }));
  for (let pass = 0; pass < 6; pass++) {
    // arc table + where the current path genuinely crosses each street family
    const cum: number[] = [0];
    for (let k = 1; k < N; k++) cum.push(cum[k - 1] + Math.hypot(cur[k].x - cur[k - 1].x, cur[k].z - cur[k - 1].z));
    // span-crossings of the CURRENT path, split by whether the plan would
    // record them (>= 18 m from the nearest node, matching the
    // collector's margin). Recorded crossings earn the no-push window —
    // the pin rebuilds that neighbourhood. A crossing squeezed against a
    // junction would go unrecorded (no barriers), so instead of tearing it
    // apart the push SWINGS the whole neighbourhood to the majority side:
    // the crossing re-forms at the window edge, away from the node, where
    // it is eligible again. Same-line swings closer than two windows merge
    // into one — opposing swings would yank the path into a knot.
    const keep = new Map<string, number[]>();                 // per family
    const swings = new Map<number, Array<{ s: number; side: number }>>(); // per line
    for (const f of families) keep.set(f.key, []);
    const collect = (L: StreetLine): void => {
      const kept = keep.get(L.family)!;
      const swing: Array<{ s: number; side: number }> = [];
      swings.set(L.id, swing);
      const raw: Array<{ s: number; k: number }> = [];
      for (let k = 0; k < N - 1; k++) {
        const a = cur[k], b = cur[k + 1];
        const va = across(L, a.x, a.z), vb = across(L, b.x, b.z);
        if (va * vb < 0) {
          const f = -va / (vb - va);
          const wa = along(L, a.x, a.z);
          const cross = wa + (along(L, b.x, b.z) - wa) * f;
          if (!inSpan(L, cross)) continue;
          const s = cum[k] + f * (cum[k + 1] - cum[k]);
          if (L.nodeGap(cross) >= 18) kept.push(s);
          else raw.push({ s, k });
        }
      }
      // same-line hits closer than two swing windows share ONE side, so
      // their windows push the same direction instead of fighting
      let group: Array<{ s: number; k: number }> = [];
      const flush = (): void => {
        if (group.length === 0) return;
        const k0 = group[0].k, k1 = group[group.length - 1].k;
        const p0 = cur[clamp(k0 - 15)], p1 = cur[clamp(k1 + 15)];
        const side = Math.sign(across(L, p0.x, p0.z) + across(L, p1.x, p1.z)) || 1;
        for (const h of group) swing.push({ s: h.s, side });
        group = [];
      };
      for (const h of raw) {
        if (group.length > 0 && h.s - group[group.length - 1].s >= 60) flush();
        group.push(h);
      }
      flush();
    };
    for (const L of lines) collect(L);
    // one push per family per point, along the family normal; within a
    // family the last violated line wins
    const raws = families.map(() => new Array(N).fill(0));
    for (let k = 0; k < N; k++) {
      const p = cur[k];
      const a = cur[clamp(k - 2)], b = cur[clamp(k + 2)];
      const h = Math.atan2(b.x - a.x, b.z - a.z);
      const nearby = streets.near(p.x, p.z, BAND);
      families.forEach((fam, fi) => {
        if (keep.get(fam.key)!.some(c => Math.abs(cum[k] - c) < NEAR)) return;
        for (const L of nearby) {
          if (L.family !== fam.key) continue;
          const d = across(L, p.x, p.z);
          const ad = Math.abs(d);
          if (ad >= BAND) continue;
          if (!inSpan(L, along(L, p.x, p.z), 7)) continue;
          if (lineDev(L, h) >= PARALLEL) continue;
          let swing: number | null = null, best = SWING;
          for (const sw of swings.get(L.id)!) {
            const dd = Math.abs(cum[k] - sw.s);
            if (dd < best) { best = dd; swing = sw.side; }
          }
          if (swing !== null) raws[fi][k] = (CLEAR - d * swing) * swing;
          else raws[fi][k] = (CLEAR - ad) * Math.sign(d || 1);
        }
      });
    }
    if (raws.every(r => r.every(v => v === 0))) break;
    // max-dilation spread: a violating point always keeps its full push,
    // neighbours ramp down toward zero over ±4 samples
    const spread = (raw: number[]): number[] => cur.map((_, k) => {
      let best = 0;
      for (let j = -4; j <= 4; j++) {
        if (k + j < 0 || k + j >= N) continue;
        const v = raw[k + j] * (1 - 0.16 * Math.abs(j));
        if (Math.abs(v) > Math.abs(best)) best = v;
      }
      return best;
    });
    const spreads = raws.map(spread);
    cur = cur.map((p, k) => {
      let x = p.x, z = p.z;
      families.forEach((fam, fi) => {
        x += spreads[fi][k] * fam.nx;
        z += spreads[fi][k] * fam.nz;
      });
      return { x, z };
    });
  }
  return cur;
}

export function perpendicularCrossings(
  path: WorldPath,
  streets: StreetCandidates,
): Array<{ x: number; z: number }> {
  const pts = path.pts;
  const N = pts.length;
  const cum: number[] = [0];
  for (let k = 1; k < N; k++) cum.push(cum[k - 1] + Math.hypot(pts[k].x - pts[k - 1].x, pts[k].z - pts[k - 1].z));
  // where does a sample span cross a street line?
  // (a = the hit's position ALONG its street line)
  interface Hit { s: number; a: number; L: StreetLine }
  const hits: Hit[] = [];
  for (let k = 0; k < N - 1; k++) {
    const p = pts[k], q = pts[k + 1];
    const segLen = cum[k + 1] - cum[k];
    for (const L of streets.near((p.x + q.x) / 2, (p.z + q.z) / 2, segLen / 2 + 1)) {
      const va = across(L, p.x, p.z), vb = across(L, q.x, q.z);
      if (va === vb) continue; // runs parallel to the line
      // a vertex landing exactly ON the line still crosses (the deformers
      // land pins dead-centre) — only strictly-one-side spans are skipped
      if (va * vb > 0) continue;
      const t = -va / (vb - va);
      const sa = along(L, p.x, p.z);
      const aHit = sa + (along(L, q.x, q.z) - sa) * t;
      if (!inSpan(L, aHit)) continue;
      hits.push({ s: cum[k] + t * segLen, a: aHit, L });
    }
  }
  hits.sort((u, v) => u.s - v.s);
  // a noisy touch can wiggle across one line several times within a pin
  // core; those fold into ONE square crossing. Separated pairs stay
  // separate — two genuine crossings 30-40 m apart each need their own wall.
  const centers: Hit[] = [];
  for (const h of hits) {
    const prev = centers[centers.length - 1];
    if (prev && prev.L === h.L && h.s - prev.s < 26) continue;
    centers.push(h);
  }
  // hits from DIFFERENT lines can also crowd (the rail cutting a junction
  // corner). Two overlapping absolute cores collapse every point between
  // them onto one corner, so where kept hits sit closer than two cores,
  // both cores shrink to tile the gap; blend zones shrink too.
  const core: number[] = centers.map(() => 10);
  const zone: number[] = centers.map(() => CROSS_ZONE);
  for (let i = 0; i + 1 < centers.length; i++) {
    const j = i + 1;
    const gap = centers[j].s - centers[i].s;
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
  // crush the earlier wall's spread
  const claims = new Array(N).fill(0);
  for (const hit of centers) {
    for (let k = 0; k < N; k++) {
      if (Math.abs(across(hit.L, pts[k].x, pts[k].z)) >= 7.5) continue;
      if (Math.abs(along(hit.L, pts[k].x, pts[k].z) - hit.a) >= 30) continue;
      claims[k]++;
    }
  }
  const contested = claims.map(c => c > 1);
  centers.forEach((hit, ci) => {
    const co = core[ci], zo = zone[ci];
    for (let k = 0; k < N; k++) {
      if (contested[k]) continue;
      const ad = Math.abs(cum[k] - hit.s);
      const arcW = ad <= co ? 1
        : ad >= zo ? 0
          : 0.5 * (1 + Math.cos((Math.PI * (ad - co)) / (zo - co)));
      // the pin stays absolute across the asphalt within its own ±30 m
      // street window: a wall whose arc runs out mid-corridor leaves asphalt
      // crossed at a visible skew otherwise
      const L = hit.L;
      const d0 = Math.abs(across(L, pts[k].x, pts[k].z));
      const mask = d0 >= 12 ? 0 : d0 <= 7 ? 1 : (12 - d0) / 5;
      const ak = along(L, pts[k].x, pts[k].z);
      const inWindow = Math.abs(ak - hit.a) < 30 && inSpan(L, ak, 7);
      const w = Math.max(arcW, inWindow ? mask : 0);
      if (w <= 0) continue;
      // slide the point along its street onto the hit's cross-line
      const o = out[k];
      const m = (hit.a - along(L, o.x, o.z)) * w;
      o.x += L.ux * m;
      o.z += L.uz * m;
    }
  });
  return out;
}

/**
 * Rails mesh: track pieces laid along a line (the Kenney railroad-straight
 * tile, scaled per piece; a procedural ballast+rails fallback when the kit
 * is unavailable). One merged mesh. `keep(x, z)` drops pieces elsewhere
 * (the causeway decks carry their own track; the diamond lays one plate).
 */
export function bakeRails(
  route: RailRoute, tpl: BakedTemplate | null,
  keep: (x: number, z: number) => boolean = () => true,
): THREE.Mesh {
  const B = new Baked();
  layRails(B, route, tpl, keep);
  const mesh = B.build();
  mesh.receiveShadow = true;
  return mesh;
}

/** lay a line's track pieces into an existing builder (see bakeRails) */
export function layRails(
  B: Baked, route: RailRoute, tpl: BakedTemplate | null,
  keep: (x: number, z: number) => boolean = () => true,
): void {
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
    if (!keep(x, z)) return;
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
  // walk the polyline, emitting each piece as the exact CHORD from the
  // previous piece's end vertex to a shared end vertex — a straight tile
  // oriented by its run's start heading misses the next joint by metres at
  // the square corners the crossing pins bend into the path, so the pieces
  // mitre corner-to-corner instead (straights still merge into ~14 m
  // pieces; a turn over ~20 deg or a >0.15 m bow off the chord ends the run).
  const dense = subdivide(route.pts);
  const M = dense.length;
  let ix = 0;     // vertex the open run starts from
  let runLen = 0; // arc length since that vertex
  const emitChord = (end: number): void => {
    const s = dense[ix], e = dense[end];
    piece((s.x + e.x) / 2, (s.z + e.z) / 2,
      Math.atan2(e.x - s.x, e.z - s.z), Math.hypot(e.x - s.x, e.z - s.z));
  };
  for (let k = 0; k < M - 1; k++) {
    const a = dense[k], b = dense[k + 1], c = dense[Math.min(M - 1, k + 2)];
    runLen += Math.hypot(b.x - a.x, b.z - a.z);
    const t1 = Math.atan2(b.x - a.x, b.z - a.z), t2 = Math.atan2(c.x - b.x, c.z - b.z);
    let turn = Math.abs(t2 - t1);
    if (turn > Math.PI) turn = Math.PI * 2 - turn;
    // worst bow of ANY interior vertex off the run's chord
    let dev = 0;
    if (runLen >= 1.5) {
      const s = dense[ix];
      const ex = b.x - s.x, ez = b.z - s.z, L2 = ex * ex + ez * ez;
      if (L2 > 1e-6) {
        for (let m = ix + 1; m <= k; m++) {
          const p = dense[m];
          const t = Math.max(0, Math.min(1, ((p.x - s.x) * ex + (p.z - s.z) * ez) / L2));
          const d = Math.hypot(s.x + ex * t - p.x, s.z + ez * t - p.z);
          if (d > dev) dev = d;
        }
      }
    }
    // a run also ends wherever `keep` flips (shore -> deck, the diamond), so
    // no kept piece reaches into a dropped stretch
    const flip = keep(b.x, b.z) !== keep(c.x, c.z);
    if ((turn > 0.3 && runLen >= 0.5) || (dev > 0.15 && runLen >= 1.5) || runLen >= 14 || flip || k === M - 2) {
      emitChord(k + 1);
      ix = k + 1;
      runLen = 0;
    }
  }
}

/** the kit railroad tile (cached template), for callers baking track */
export function railTile(): BakedTemplate | null { return bakedModel('rail-straight'); }
