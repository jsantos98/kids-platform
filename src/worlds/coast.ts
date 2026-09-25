// The coast: each island's seeded shoreline. Islands are no longer the 896 m
// square slab — the shore is a wavy star-shaped curve r(θ) around the centre
// (a few seeded harmonics on a 360–430 m radius), clamped inside the city
// cell, with a HEADLAND reaching out to within a few metres of the cell edge
// wherever one of the four causeways lands, so every causeway is short.
//
// Everything that must stand on land asks `inLand` (streets, lots, the
// railway, stations, props, walkers); the chunk baker cuts slabs and beaches
// to the shore; boats sail an offshore lane that follows it.
import { rng, chunkSeed } from '../engine/rng.js';
import { citySeed, southExit, eastExit, STRAIT, isRaceIsland } from './cityGrid.js';
import { ISLAND, CENTER, SCALE } from './world.js';

const N = Math.round(256 * SCALE); // polygon vertices (~10 m apart)
const HEADLAND_GAP = 8;     // a headland stops this far short of the cell edge
const RIM_MARGIN = 14;      // elsewhere the shore keeps this far inside

export interface Coast {
  /** shore polygon (city-local), counter-clockwise by angle */
  pts: Array<{ x: number; z: number }>;
  /** shore distance from the island centre at angle θ = atan2(z-c, x-c) */
  radius(theta: number): number;
  /** (x, z) is on land at least `inset` m inside the shore (negative = that
   * far out to sea) */
  inLand(x: number, z: number, inset?: number): boolean;
  /** the shore point along the ray from the centre through (x, z) */
  shoreToward(x: number, z: number, out?: number): { x: number; z: number };
}

const cache = new Map<number, Coast>();

export function clearCoastCache(): void { cache.clear(); spanCache.clear(); }

/** distance from the centre to the cell square's edge along angle θ */
function rimDist(theta: number): number {
  return CENTER / Math.max(Math.abs(Math.cos(theta)), Math.abs(Math.sin(theta)));
}

export function coastFor(bx: number, by: number): Coast {
  const key = citySeed(bx, by);
  let c = cache.get(key);
  if (c) return c;
  const r = rng(chunkSeed(key, 0xc0a57, 1));
  // a race island is a smaller, rounder island round its circuit (R32): no
  // headlands — its causeways run out over the sea to it
  const race = isRaceIsland(bx, by);
  const R0 = race ? 400 + r() * 40 : (360 + r() * 70) * SCALE;
  const harm = [2, 3, 4, 5].map((k, i) => ({
    k, a: (r() - 0.5) * 2 * [0.06, 0.045, 0.03, 0.02][i] * (race ? 0.5 : 1), ph: r() * Math.PI * 2,
  }));
  // the four causeway portals: where each exit line meets the cell edge
  const portals = [
    [southExit(bx, by - 1) * 64, 0],        // north
    [southExit(bx, by) * 64, ISLAND],       // south
    [0, eastExit(bx - 1, by) * 64],         // west
    [ISLAND, eastExit(bx, by) * 64],        // east
  ].map(([x, z]) => Math.atan2(z - CENTER, x - CENTER));
  const radii: number[] = [];
  for (let i = 0; i < N; i++) {
    const th = -Math.PI + (i / N) * Math.PI * 2;
    let rr = R0 * (1 + harm.reduce((s, h) => s + h.a * Math.sin(h.k * th + h.ph), 0));
    const rim = rimDist(th);
    rr = Math.min(rr, rim - RIM_MARGIN);
    // headlands: swell out toward the portal so the causeway lands close
    for (const tp of race ? [] : portals) {
      let d = Math.abs(th - tp);
      if (d > Math.PI) d = Math.PI * 2 - d;
      // (~120 m wide at the shore whatever the island's size)
      const w = Math.exp(-((d / (0.3 / SCALE)) ** 2));
      const tip = rim - HEADLAND_GAP;
      if (tip > rr) rr += (tip - rr) * w;
    }
    radii.push(rr);
  }
  const radius = (theta: number): number => {
    let f = ((theta + Math.PI) / (Math.PI * 2)) * N;
    f = ((f % N) + N) % N;
    const i0 = Math.floor(f), i1 = (i0 + 1) % N, t = f - i0;
    return radii[i0] * (1 - t) + radii[i1] * t;
  };
  const pts = radii.map((rr, i) => {
    const th = -Math.PI + (i / N) * Math.PI * 2;
    return { x: CENTER + Math.cos(th) * rr, z: CENTER + Math.sin(th) * rr };
  });
  c = {
    pts,
    radius,
    inLand(x, z, inset = 0) {
      const dx = x - CENTER, dz = z - CENTER;
      return Math.hypot(dx, dz) < radius(Math.atan2(dz, dx)) - inset;
    },
    shoreToward(x, z, out = 0) {
      const th = Math.atan2(z - CENTER, x - CENTER);
      const rr = radius(th) + out;
      return { x: CENTER + Math.cos(th) * rr, z: CENTER + Math.sin(th) * rr };
    },
  };
  cache.set(key, c);
  if (cache.size > 64) cache.delete(cache.keys().next().value as number);
  return c;
}

/** Sutherland–Hodgman: the part of polygon `poly` inside the axis-aligned
 * rectangle (convex clip region, so a concave subject like the shore is fine) */
export function clipToRect(
  poly: Array<{ x: number; z: number }>, x0: number, z0: number, x1: number, z1: number,
): Array<{ x: number; z: number }> {
  type P = { x: number; z: number };
  const edges: Array<[(p: P) => boolean, (a: P, b: P) => P]> = [
    [p => p.x >= x0, (a, b) => ({ x: x0, z: a.z + ((x0 - a.x) / (b.x - a.x)) * (b.z - a.z) })],
    [p => p.x <= x1, (a, b) => ({ x: x1, z: a.z + ((x1 - a.x) / (b.x - a.x)) * (b.z - a.z) })],
    [p => p.z >= z0, (a, b) => ({ x: a.x + ((z0 - a.z) / (b.z - a.z)) * (b.x - a.x), z: z0 })],
    [p => p.z <= z1, (a, b) => ({ x: a.x + ((z1 - a.z) / (b.z - a.z)) * (b.x - a.x), z: z1 })],
  ];
  let out = poly;
  for (const [inside, cut] of edges) {
    const src = out;
    out = [];
    for (let i = 0; i < src.length; i++) {
      const a = src[(i + src.length - 1) % src.length], b = src[i];
      const ia = inside(a), ib = inside(b);
      if (ib) {
        if (!ia) out.push(cut(a, b));
        out.push(b);
      } else if (ia) out.push(cut(a, b));
    }
    if (!out.length) return out;
  }
  return out;
}

/** the shore polygon pulled `inset` m toward the centre (radially) */
export function insetShore(c: Coast, inset: number): Array<{ x: number; z: number }> {
  return c.pts.map(p => {
    const dx = p.x - CENTER, dz = p.z - CENTER, d = Math.hypot(dx, dz);
    const k = Math.max(0, d - inset) / d;
    return { x: CENTER + dx * k, z: CENTER + dz * k };
  });
}

/**
 * The deck a city lays across the strait on its south ('s') or east ('e')
 * side: along the exit line `at` (plus `offset` — the railway deck runs
 * 24 m beside the avenue), from the last dry land on our corridor to the
 * first dry land on the neighbour's (city-local coordinates, running +z
 * for 's', +x for 'e'). Cached: the physics asks every frame.
 */
const spanCache = new Map<string, { at: number; from: number; to: number }>();
export function causewaySpan(bx: number, by: number, side: 's' | 'e', offset = 0): { at: number; from: number; to: number } {
  const key = `${bx},${by},${side},${offset},${southExit(bx, by)},${eastExit(bx, by)}`;
  const hit = spanCache.get(key);
  if (hit) return hit;
  const at = (side === 's' ? southExit(bx, by) : eastExit(bx, by)) * 64 + offset;
  const ours = coastFor(bx, by);
  const theirs = side === 's' ? coastFor(bx, by + 1) : coastFor(bx + 1, by);
  const dry = (c: Coast, t: number): boolean => (side === 's' ? c.inLand(at, t, 1) : c.inLand(t, at, 1));
  let from = CENTER;
  while (from < ISLAND && dry(ours, from + 1)) from++;
  let to = 0;
  while (to < CENTER && !dry(theirs, to)) to++;
  const out = { at, from, to: ISLAND + STRAIT + to };
  if (spanCache.size > 256) spanCache.clear();
  spanCache.set(key, out);
  return out;
}
