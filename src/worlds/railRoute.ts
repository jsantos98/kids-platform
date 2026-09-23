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
  control: Array<{ x: number; z: number }>;
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

function buildRoute(bx: number, by: number): RailRoute {
  const seed = citySeed(bx, by);
  let best: Attempt | null = null;
  for (let attempt = 0; attempt < 90; attempt++) {
    const r = rng(chunkSeed(seed, 0x5a1, 0x7e + attempt));
    const a = tryRoute(r);
    if (!a) continue;
    if (!best || a.score < best.score) best = a;
    if (a.score === 0) break;
  }
  const chosen = best ?? forcedRoute(seed);
  return finalize(bx, by, chosen.control, chosen.path);
}

/** one control-ring candidate; null when control spacing is impossible */
function tryRoute(r: () => number): Attempt | null {
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
  // adjacent control points need breathing room, or the spline kinks
  for (let k = 0; k < n; k++) {
    const a = control[k], b = control[(k + 1) % n];
    if (Math.hypot(a.x - b.x, a.z - b.z) < 60) return null;
  }
  const path = makePath(control, true);
  // score violations on dense samples
  let score = 0;
  for (const p of path.pts) {
    if (inRaceZone(p.x, p.z)) score += 3;
    if (p.x < 34 || p.x > ISLAND - 34 || p.z < 34 || p.z > ISLAND - 34) score += 3;
    const i = Math.round(p.x / 64), jn = Math.round(p.z / 64);
    if (i >= 1 && i < WORLD_CHUNKS && jn >= 1 && jn < WORLD_CHUNKS) {
      const dx = p.x - i * 64, dz = p.z - jn * 64;
      if (dx * dx + dz * dz < 10 * 10) score += 6; // threading a junction
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

function finalize(bx: number, by: number, control: Array<{ x: number; z: number }>, path: WorldPath): RailRoute {
  // the spline pays no attention to the street lattice, so wherever it
  // happens to graze a road it does so at a rakish angle. Reshape the dense
  // polyline so every street crossing is square: points near a hit are
  // blended onto the perpendicular line through it (fully at the hit,
  // smoothly released outward), which reads as a proper railway junction
  // and gives the level crossings their barriers a clean strip to guard.
  const { H, V } = streetLinesFor(bx, by);
  const shaped = perpendicularCrossings(path, H, V);
  const p2 = polyPath(shaped);
  return {
    path: p2,
    total: p2.total,
    pts: p2.pts,
    sample: d => p2.sample(d),
    distTo(x, z) { return Math.sqrt(p2.nearest(x, z).d2); },
    near(x, z, r) { return p2.nearest(x, z).d2 < r * r; },
    control,
  };
}

/** half-length of the straightened approach either side of a crossing (m) */
const CROSS_ZONE = 24;

function perpendicularCrossings(
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
  // a near-parallel stretch may graze one line repeatedly; the whole wiggle
  // resolves to ONE square crossing — later hits within a blend-zone length
  // of the kept hit fold into it (the blend flattens their span anyway)
  const centers: Hit[] = [];
  for (const h of hits) {
    const prev = centers[centers.length - 1];
    if (prev && prev.horiz === h.horiz && prev.line === h.line && h.s - prev.s < CROSS_ZONE * 2) continue;
    centers.push(h);
  }
  // blend the neighbourhood of every kept hit onto the perpendicular through it
  const out = pts.map(p => ({ x: p.x, z: p.z }));
  for (const hit of hits) {
    for (let k = 0; k < N; k++) {
      let ds = cum[k] - hit.s;
      if (ds > total / 2) ds -= total;
      if (ds < -total / 2) ds += total;
      if (Math.abs(ds) >= CROSS_ZONE) continue;
      const w = 0.5 * (1 + Math.cos((Math.PI * ds) / CROSS_ZONE));
      if (hit.horiz) out[k].x += (hit.x - out[k].x) * w;
      else out[k].z += (hit.z - out[k].z) * w;
    }
  }
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
