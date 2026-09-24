// Race islands: every island at bx % 10 == 0 && by % 10 == 0 (island (0,0)
// among them) carries a racing circuit — a closed loop of Kenney Toy Car Kit
// track pieces on an apron of grass, tents and trees, with a road ringing
// the apron (streetGen.ts lays it; the island's streets, both railway lines
// and the river all keep outside). Everything here is pure geometry, decided
// once per island and shared by the street generator, the plan, the chunk
// baker, the occupancy grid, the race and the audit (R32).
//
// Kit geometry (probed from the GLBs): a piece's entry is its origin,
// heading +z; the wide road is 2 units across; a straight is 4 units long;
// `corner-large` turns 90° left (heading -90°, exit at (-4, 4)) about a
// centreline radius of 4. Everything is laid at UNIT metres per kit unit.
import { rng, chunkSeed } from '../engine/rng.js';
import { citySeed, southExit, eastExit } from './cityGrid.js';
import { ringPolygon } from './ringRoad.js';

function inPoly(p: { x: number; z: number }, poly: Array<{ x: number; z: number }>): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i], b = poly[j];
    if ((a.z > p.z) !== (b.z > p.z) && p.x < ((b.x - a.x) * (p.z - a.z)) / (b.z - a.z) + a.x) inside = !inside;
  }
  return inside;
}
import { baseRiverFor } from './riverRoute.js';
import { railNetFor } from './railRoute.js';
import { EXIT_IN } from './streetLines.js';
import { ISLAND, CENTER } from './world.js';

/** metres per kit unit: the wide track is 12 m across */
export const UNIT = 6;
export const TRACK_HALF = UNIT;
/** a straight piece's length, and the centreline radius of the large and
 * small corners (compact circuits use the small ones where room is short) */
const STRAIGHT = 4 * UNIT;
const R_LARGE = 4 * UNIT, R_SMALL = 2 * UNIT;
/** grass, tents and trees round the loop, inside the ringing road */
export const APRON = 16;
/** the road round the apron runs this far outside the zone */
export const ZONE_ROAD = 16;
/** the ringing road's own clearances, measured from that road (its square
 * corners reach 16√2 m out from the zone's): the track (streets keep 14 m
 * unless square across it), the water (the river cut takes half + 16 m),
 * the avenues (a junction keeps 20 m from a street it doesn't meet), and
 * the island's ring road — a spoke of at least a street's length between */
const TIERS = [
  { rail: 26, river: 30, exit: 26, ring: 40, diamond: 64 },
  // a crowded island: still every street rule's own minimum plus a margin
  { rail: 20, river: 24, exit: 22, ring: 34, diamond: 44 },
];

export type TrackPieceKind = 'straight' | 'corner' | 'cornerSmall';

export interface TrackPiece {
  kind: TrackPieceKind;
  /** entry point (the model's origin) and the model's rotation */
  x: number;
  z: number;
  ry: number;
  /** the piece's middle (which chunk lays it) */
  mx: number;
  mz: number;
}

export interface RaceTrack {
  bx: number;
  by: number;
  /** the zone: a rectangle turned by `ry` (local x along (cos, -sin)) */
  cx: number;
  cz: number;
  hx: number;
  hz: number;
  ry: number;
  pieces: TrackPiece[];
  /** the centreline, closed, every ~2 m, with cumulative arc length */
  path: Array<{ x: number; z: number; h: number; s: number }>;
  length: number;
  /** arc of the start / finish line */
  startS: number;
  /** grid slots behind the line, pole position first */
  grid: Array<{ x: number; z: number; h: number }>;
  /** is (x, z) inside the zone (grown by m)? */
  inZone(x: number, z: number, m?: number): boolean;
  /** the zone's corners (for the ringing road, grown by m) */
  outline(m: number): Array<{ x: number; z: number }>;
  /** nearest point of the centreline: its arc and distance */
  nearest(x: number, z: number): { s: number; d: number };
  /** the centreline point at arc s (wrapping) */
  sample(s: number): { x: number; z: number; h: number };
}

/** does island (bx, by) hold a race circuit? */
export function isRaceIsland(bx: number, by: number): boolean {
  return ((bx % 10) + 10) % 10 === 0 && ((by % 10) + 10) % 10 === 0;
}

const cache = new Map<string, RaceTrack | null>();
export function clearRaceCache(): void { cache.clear(); }

/** island (bx, by)'s race circuit, or null (not a race island, or no room) */
export function raceTrackFor(bx: number, by: number): RaceTrack | null {
  if (!isRaceIsland(bx, by)) return null;
  const key = `${bx},${by},${citySeed(bx, by)}`;
  if (!cache.has(key)) {
    cache.set(key, build(bx, by));
    if (cache.size > 16) cache.delete(cache.keys().next().value as string);
  }
  return cache.get(key)!;
}

/** the loop in its own frame: a rectangle of nA x nB straights with four
 * large corners, driven with left turns from the origin heading +z */
function layout(nA: number, nB: number, small: boolean): { pieces: Array<{ kind: TrackPieceKind; x: number; z: number; h: number }>; bx0: number; bx1: number; bz0: number; bz1: number } {
  const RADIUS = small ? R_SMALL : R_LARGE;
  const pieces: Array<{ kind: TrackPieceKind; x: number; z: number; h: number }> = [];
  let x = 0, z = 0, h = 0;
  const fwd = (d: number): void => { x += Math.sin(h) * d; z += Math.cos(h) * d; };
  for (const n of [nA, nB, nA, nB]) {
    for (let k = 0; k < n; k++) { pieces.push({ kind: 'straight', x, z, h }); fwd(STRAIGHT); }
    pieces.push({ kind: small ? 'cornerSmall' : 'corner', x, z, h });
    // exit of a left 90° turn: forward R, then left R
    const ux = Math.sin(h), uz = Math.cos(h), lx = -uz, lz = ux; // left of heading (heading - 90°)
    x += (ux + lx) * RADIUS; z += (uz + lz) * RADIUS;
    h -= Math.PI / 2;
  }
  const bx0 = -2 * RADIUS - nB * STRAIGHT - TRACK_HALF, bx1 = TRACK_HALF;
  const bz0 = -RADIUS - TRACK_HALF, bz1 = nA * STRAIGHT + RADIUS + TRACK_HALF;
  return { pieces, bx0, bx1, bz0, bz1 };
}

function build(bx: number, by: number): RaceTrack | null {
  const seed = citySeed(bx, by);
  const r = rng(chunkSeed(seed, 0x7ace, 1));
  const ring = ringPolygon(bx, by);
  const river = baseRiverFor(bx, by);
  const rail = railNetFor(bx, by);
  const railPts: Array<{ x: number; z: number }> = [];
  for (const L of rail.lines) for (let k = 0; k < L.pts.length; k += 2) railPts.push(L.pts[k]);
  const riverPts = river.pts.filter((_, k) => k % 2 === 0);
  const exN = southExit(bx, by - 1) * 64, exS = southExit(bx, by) * 64;
  const exW = eastExit(bx - 1, by) * 64, exE = eastExit(bx, by) * 64;
  const exits: Array<[{ x: number; z: number }, { x: number; z: number }]> = [
    [{ x: exN, z: 0 }, { x: exN, z: EXIT_IN }], [{ x: exS, z: ISLAND - EXIT_IN }, { x: exS, z: ISLAND }],
    [{ x: 0, z: exW }, { x: EXIT_IN, z: exW }], [{ x: ISLAND - EXIT_IN, z: exE }, { x: ISLAND, z: exE }],
  ];
  const segD = (p: { x: number; z: number }, a: { x: number; z: number }, b: { x: number; z: number }): number => {
    const abx = b.x - a.x, abz = b.z - a.z, L2 = abx * abx + abz * abz;
    const t = Math.max(0, Math.min(1, ((p.x - a.x) * abx + (p.z - a.z) * abz) / L2));
    return Math.hypot(a.x + abx * t - p.x, a.z + abz * t - p.z);
  };
  // sizes to try, the seeded favourite first, shrinking to the smallest loop
  const sizes: Array<[number, number, boolean]> = [];
  const nA0 = 3 + ((r() * 4) | 0), nB0 = 1 + ((r() * 3) | 0);
  for (let a = nA0; a >= 1; a--) for (let b = Math.min(nB0, a); b >= 1; b--) sizes.push([a, b, false]);
  // compact circuits (small corners) when nothing larger fits
  for (let a = 3; a >= 1; a--) for (let b = Math.min(2, a); b >= 1; b--) sizes.push([a, b, true]);
  const th0 = r() * Math.PI;
  for (const T of TIERS) for (const [nA, nB, small] of sizes) {
    const { rail: CLEAR_RAIL, river: CLEAR_RIVER, exit: CLEAR_EXIT, ring: CLEAR_RING, diamond: CLEAR_DIAMOND } = T;
    const L = layout(nA, nB, small);
    const hx = (L.bx1 - L.bx0) / 2 + APRON, hz = (L.bz1 - L.bz0) / 2 + APRON;
    const lcx = (L.bx0 + L.bx1) / 2, lcz = (L.bz0 + L.bz1) / 2;
    let best: { cx: number; cz: number; ry: number; score: number } | null = null;
    for (let k = 0; k < 12; k++) {
      const ry = th0 + (k * Math.PI) / 12;
      const c = Math.cos(ry), s = Math.sin(ry);
      // distance from p to the zone's ringing road (the rectangle centred at
      // (cx, cz), grown by ZONE_ROAD)
      const rx = hx + ZONE_ROAD, rz = hz + ZONE_ROAD;
      const rectD = (cx: number, cz: number, p: { x: number; z: number }): number => {
        const dx = p.x - cx, dz = p.z - cz;
        const lx = dx * c - dz * s, lz = dx * s + dz * c;
        return Math.hypot(Math.max(0, Math.abs(lx) - rx), Math.max(0, Math.abs(lz) - rz));
      };
      for (let cx = 160; cx <= ISLAND - 160; cx += 16) for (let cz = 160; cz <= ISLAND - 160; cz += 16) {
        const corners = [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([sx, sz]) => ({
          x: cx + sx * rx * c + sz * rz * s, z: cz - sx * rx * s + sz * rz * c,
        }));
        // inside the ring road, and how far from it (it must clear CLEAR_RING;
        // the closer to it the better — one side then faces the ring road
        // across open ground, a short square spoke away)
        if (!corners.every(q => inPoly(q, ring))) continue;
        let depth = Infinity;
        for (let i = 0; i < 4; i++) {
          const a = corners[i], b = corners[(i + 1) % 4];
          for (let t = 0; t <= 1; t += 0.1) {
            const q = { x: a.x + (b.x - a.x) * t, z: a.z + (b.z - a.z) * t };
            for (let j = 0; j < ring.length; j++) depth = Math.min(depth, segD(q, ring[j], ring[(j + 1) % ring.length]));
          }
        }
        if (depth < CLEAR_RING) continue;
        const score = (depth - CLEAR_RING) + 0.05 * Math.hypot(cx - CENTER, cz - CENTER);
        if (best && score >= best.score) continue;
        if (rectD(cx, cz, rail.diamond) < CLEAR_DIAMOND) continue;
        if (railPts.some(p => rectD(cx, cz, p) < CLEAR_RAIL)) continue;
        if (riverPts.some(p => rectD(cx, cz, p) < CLEAR_RIVER + p.w / 2)) continue;
        // the avenues: sampled along each, against the rectangle
        let hitExit = false;
        for (const [a, b] of exits) {
          for (let t = 0; t <= 1 && !hitExit; t += 0.02) {
            if (rectD(cx, cz, { x: a.x + (b.x - a.x) * t, z: a.z + (b.z - a.z) * t }) < CLEAR_EXIT) hitExit = true;
          }
        }
        if (hitExit) continue;
        best = { cx, cz, ry, score };
      }
    }
    if (!best) continue;
    return finish(bx, by, nA, small ? R_SMALL : R_LARGE, L, lcx, lcz, hx, hz, best.cx, best.cz, best.ry);
  }
  return null;
}

function finish(
  bx: number, by: number, nA: number, RADIUS: number, L: ReturnType<typeof layout>,
  lcx: number, lcz: number, hx: number, hz: number, cx: number, cz: number, ry: number,
): RaceTrack {
  const c = Math.cos(ry), s = Math.sin(ry);
  // local (loop frame) -> world: centre the loop's box on the zone, turn by ry
  // (local x along (c, -s), local z along (s, c) — the lots' convention)
  const W = (x: number, z: number): { x: number; z: number } => {
    const dx = x - lcx, dz = z - lcz;
    return { x: cx + dx * c + dz * s, z: cz - dx * s + dz * c };
  };
  // a heading h in the loop frame turns by ry (the frame's +z = heading ry)
  const pieces: TrackPiece[] = L.pieces.map(p => {
    const w = W(p.x, p.z);
    const mid = p.kind === 'straight'
      ? W(p.x + Math.sin(p.h) * STRAIGHT / 2, p.z + Math.cos(p.h) * STRAIGHT / 2)
      : W(p.x + (Math.sin(p.h) - Math.cos(p.h)) * RADIUS * 0.6, p.z + (Math.cos(p.h) + Math.sin(p.h)) * RADIUS * 0.6);
    return { kind: p.kind, x: w.x, z: w.z, ry: p.h + ry, mx: mid.x, mz: mid.z };
  });
  // the centreline, every ~2 m
  const path: RaceTrack['path'] = [];
  let acc = 0;
  const push = (x: number, z: number, h: number): void => {
    const q = W(x, z);
    if (path.length) acc += Math.hypot(q.x - path[path.length - 1].x, q.z - path[path.length - 1].z);
    path.push({ x: q.x, z: q.z, h: h + ry, s: acc });
  };
  for (const p of L.pieces) {
    if (p.kind === 'straight') {
      for (let t = 0; t < STRAIGHT; t += 2) push(p.x + Math.sin(p.h) * t, p.z + Math.cos(p.h) * t, p.h);
    } else {
      // left turn: the centre lies R to the left of the entry
      const ocx = p.x - Math.cos(p.h) * RADIUS, ocz = p.z + Math.sin(p.h) * RADIUS;
      const n = Math.ceil((RADIUS * Math.PI / 2) / 2);
      for (let k = 0; k < n; k++) {
        const hh = p.h - (k / n) * (Math.PI / 2);
        // the point on the circle whose tangent heading is hh
        push(ocx + Math.cos(hh) * RADIUS, ocz - Math.sin(hh) * RADIUS, hh);
      }
    }
  }
  const last = path[path.length - 1], first = path[0];
  const length = acc + Math.hypot(first.x - last.x, first.z - last.z);
  const sample = (sv: number): { x: number; z: number; h: number } => {
    const t = ((sv % length) + length) % length;
    let lo = 0, hi = path.length - 1;
    while (lo < hi) { const m = (lo + hi + 1) >> 1; if (path[m].s <= t) lo = m; else hi = m - 1; }
    const a = path[lo], b = path[(lo + 1) % path.length];
    const segL = (lo + 1 < path.length ? b.s : length) - a.s || 1;
    const f = (t - a.s) / segL;
    let dh = b.h - a.h;
    while (dh > Math.PI) dh -= Math.PI * 2;
    while (dh < -Math.PI) dh += Math.PI * 2;
    return { x: a.x + (b.x - a.x) * f, z: a.z + (b.z - a.z) * f, h: a.h + dh * f };
  };
  // start / finish: halfway up the first long straight
  const startS = Math.floor(nA / 2) * STRAIGHT + (nA % 2 ? STRAIGHT / 2 : 0);
  const grid: RaceTrack['grid'] = [];
  for (let k = 0; k < 4; k++) {
    const p = sample(startS - 9 - k * 7);
    const side = k % 2 ? -1 : 1;
    // across the track: right of the heading is (cos h, -sin h)
    grid.push({ x: p.x + Math.cos(p.h) * side * 3, z: p.z - Math.sin(p.h) * side * 3, h: p.h });
  }
  const inZone = (x: number, z: number, m = 0): boolean => {
    const dx = x - cx, dz = z - cz;
    const lx = dx * c - dz * s, lz = dx * s + dz * c;
    return Math.abs(lx) < hx + m && Math.abs(lz) < hz + m;
  };
  const outline = (m: number): Array<{ x: number; z: number }> =>
    [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([sx, sz]) => ({
      x: cx + sx * (hx + m) * c + sz * (hz + m) * s, z: cz - sx * (hx + m) * s + sz * (hz + m) * c,
    }));
  const nearest = (x: number, z: number): { s: number; d: number } => {
    let bi = 0, bd = Infinity;
    for (let i = 0; i < path.length; i++) {
      const d = (path[i].x - x) ** 2 + (path[i].z - z) ** 2;
      if (d < bd) { bd = d; bi = i; }
    }
    return { s: path[bi].s, d: Math.sqrt(bd) };
  };
  return { bx, by, cx, cz, hx, hz, ry, pieces, path, length, startS, grid, inZone, outline, nearest, sample };
}
