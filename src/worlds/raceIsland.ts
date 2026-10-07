// Race islands: every island at bx % 10 == 0 && by % 10 == 0 (island (0,0)
// among them) is a smaller island that IS a racing circuit — a closed loop
// of Kenney Racing Kit tiles (the Starter-Kit-Racing look) in the middle of
// the island, its infield dressed with the kit's forest and tent tiles, on a
// grass apron ringed by its own road. Every race island grows its own loop
// (raceLoop.ts). The circuit is decided from the island's coast alone and
// FIRST: the railway lines then run round it and the streets round both
// (streetGen.ts lays the ringing road, the coastal ring road, the causeway
// avenues and the spokes between them — no city). Pure geometry, shared by
// the street generator, the rail, the plan, the chunk baker, the occupancy
// grid, the race and the audit (R32).
//
// Kit geometry (probed from the GLBs, R15): every tile is 10 x 10 units
// centred on its origin with a 6-unit road; the straight runs along z; the
// corner opens to +z and -x about the tile corner (-5, +5) (centreline
// radius 5); the road surface sits 0.1 units up. Laid at 2 m a unit: 20 m
// tiles, a 12 m road.
import { rng, chunkSeed } from '../engine/rng.js';
import { citySeed, isRaceIsland } from './cityGrid.js';
import { CENTER } from './world.js';
import { makeLoop, TILE, type Loop, type LoopTile } from './raceLoop.js';

export { isRaceIsland };

/** metres per kit unit */
export const UNIT = TILE / 10;
/** half the kit road's width */
export const TRACK_HALF = 3 * UNIT;
/** the starting grid: eight karts, staggered (the kid's in the last slot) */
export const GRID_SLOTS = 8;
/** grass round the loop, inside the ringing road */
export const APRON = 16;
/** the road round the apron runs this far outside the zone */
export const ZONE_ROAD = 16;

export type TrackPieceKind = 'straight' | 'corner' | 'finish';

export interface TrackPiece {
  kind: TrackPieceKind;
  /** the tile's centre (the kit tile's origin) and its rotation */
  x: number;
  z: number;
  ry: number;
  /** which chunk lays it (the centre) */
  mx: number;
  mz: number;
  /** travel heading into and out of the tile */
  hIn: number;
  hOut: number;
}

/** an infield tile of scenery */
export interface TrackDecor { kind: 'forest' | 'tents'; x: number; z: number; ry: number }

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
  decor: TrackDecor[];
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
  /** the circuit as plain data (the world worker sends this) */
  data: RaceData;
}

const cache = new Map<string, RaceTrack | null>();
export function clearRaceCache(): void { cache.clear(); }

/** island (bx, by)'s race circuit, or null (not a race island) */
export function raceTrackFor(bx: number, by: number): RaceTrack | null {
  if (!isRaceIsland(bx, by)) return null;
  const key = `${bx},${by},${citySeed(bx, by)}`;
  if (!cache.has(key)) {
    cache.set(key, build(bx, by));
    if (cache.size > 16) cache.delete(cache.keys().next().value as string);
  }
  return cache.get(key)!;
}

/** a circuit as plain data: the loop's cells in driving order, its infield,
 * and where the zone sits */
export interface RaceData {
  bx: number;
  by: number;
  nx: number;
  nz: number;
  /** track cells (i, j) in driving order, flattened */
  cells: number[];
  /** infield cells, flattened */
  infield: number[];
  cx: number;
  cz: number;
  ry: number;
}

function build(bx: number, by: number): RaceTrack {
  const r = rng(chunkSeed(citySeed(bx, by), 0x7ace, 2));
  const L = makeLoop(r);
  // the loop in the island's middle, square or turned 15 degrees either way
  // (turned further, its zone's corners reach out past the ring road and the
  // railway can't pass them — the diamond sits off a corner)
  const ry = [0, Math.PI / 12, -Math.PI / 12][(r() * 3) | 0];
  return fromData({
    bx, by, nx: L.nx, nz: L.nz,
    cells: L.tiles.flatMap(t => [t.i, t.j]),
    infield: L.infield.flat(),
    cx: CENTER, cz: CENTER, ry,
  }, L);
}

/** the loop's tiles from its cells (their kinds and turns follow from the
 * neighbours) */
function tilesOf(d: RaceData): Loop {
  const n = d.cells.length / 2;
  const at = (k: number): [number, number] => [d.cells[2 * ((k + n) % n)], d.cells[2 * ((k + n) % n) + 1]];
  const hOf = (di: number, dj: number): number => Math.atan2(di, dj);
  const tiles: LoopTile[] = [];
  for (let k = 0; k < n; k++) {
    const [i, j] = at(k), [pi, pj] = at(k - 1), [ni, nj] = at(k + 1);
    const hIn = hOf(i - pi, j - pj), hOut = hOf(ni - i, nj - j);
    if (Math.abs(Math.sin(hIn - hOut)) < 1e-6) { tiles.push({ i, j, kind: 'straight', q: Math.round(hIn / (Math.PI / 2)), hIn, hOut }); continue; }
    const back = hIn + Math.PI, on = hOut;
    const same = (x: number, y: number): boolean => Math.abs(Math.sin((x - y) / 2)) < 1e-6;
    let q = 0;
    for (let t = 0; t < 4; t++) {
      const a = t * (Math.PI / 2), b = -Math.PI / 2 + t * (Math.PI / 2);
      if ((same(a, back) && same(b, on)) || (same(a, on) && same(b, back))) { q = t; break; }
    }
    tiles.push({ i, j, kind: 'corner', q, hIn, hOut });
  }
  const infield: Array<[number, number]> = [];
  for (let k = 0; k + 1 < d.infield.length; k += 2) infield.push([d.infield[k], d.infield[k + 1]]);
  return { nx: d.nx, nz: d.nz, tiles, infield };
}

function fromData(d: RaceData, loop?: Loop): RaceTrack {
  const L = loop ?? tilesOf(d);
  const { cx, cz, ry } = d;
  const c = Math.cos(ry), s = Math.sin(ry);
  const hx = (d.nx * TILE) / 2 + APRON, hz = (d.nz * TILE) / 2 + APRON;
  // loop frame (cell (i, j)'s centre at ((i + 0.5) TILE, (j + 0.5) TILE),
  // centred on the zone) -> world; a heading turns by ry
  const W = (x: number, z: number): { x: number; z: number } => {
    const dx = x - (d.nx * TILE) / 2, dz = z - (d.nz * TILE) / 2;
    return { x: cx + dx * c + dz * s, z: cz - dx * s + dz * c };
  };
  const centre = (t: { i: number; j: number }): { x: number; z: number } => ({ x: (t.i + 0.5) * TILE, z: (t.j + 0.5) * TILE });
  // the centreline, every ~2 m, tile by tile
  const path: RaceTrack['path'] = [];
  const tileS: number[] = [];
  let acc = 0;
  const push = (x: number, z: number, h: number): void => {
    const q = W(x, z);
    if (path.length) acc += Math.hypot(q.x - path[path.length - 1].x, q.z - path[path.length - 1].z);
    path.push({ x: q.x, z: q.z, h: h + ry, s: acc });
  };
  for (const t of L.tiles) {
    const o = centre(t);
    const bx0 = o.x - Math.sin(t.hIn) * (TILE / 2), bz0 = o.z - Math.cos(t.hIn) * (TILE / 2);
    const first = path.length;
    if (t.kind === 'straight') {
      for (let k = 0; k < TILE / 2; k++) push(bx0 + Math.sin(t.hIn) * k * 2, bz0 + Math.cos(t.hIn) * k * 2, t.hIn);
    } else {
      // a quarter circle about the tile corner between the two open sides
      const back = t.hIn + Math.PI;
      const px = o.x + (Math.sin(back) + Math.sin(t.hOut)) * (TILE / 2), pz = o.z + (Math.cos(back) + Math.cos(t.hOut)) * (TILE / 2);
      let dh = t.hOut - t.hIn;
      while (dh > Math.PI) dh -= Math.PI * 2;
      while (dh < -Math.PI) dh += Math.PI * 2;
      const a0 = Math.atan2(bx0 - px, bz0 - pz);
      const steps = 8;
      for (let k = 0; k < steps; k++) {
        const a = a0 + (dh * k) / steps;
        push(px + Math.sin(a) * (TILE / 2), pz + Math.cos(a) * (TILE / 2), t.hIn + (dh * k) / steps);
      }
    }
    tileS.push(path[first].s);
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
  // start / finish: the middle tile of the longest straight run
  const n = L.tiles.length;
  let bestK = 0, bestLen = -1;
  for (let k = 0; k < n; k++) {
    if (L.tiles[k].kind !== 'straight' || L.tiles[(k - 1 + n) % n].kind === 'straight') continue;
    let m = 0;
    while (m < n && L.tiles[(k + m) % n].kind === 'straight') m++;
    if (m > bestLen) { bestLen = m; bestK = (k + ((m - 1) >> 1)) % n; }
  }
  const startS = tileS[bestK] + TILE / 2;
  const pieces: TrackPiece[] = L.tiles.map((t, k) => {
    const o = W(centre(t).x, centre(t).z);
    return {
      kind: k === bestK ? 'finish' : t.kind, x: o.x, z: o.z, ry: t.q * (Math.PI / 2) + ry,
      mx: o.x, mz: o.z, hIn: t.hIn + ry, hOut: t.hOut + ry,
    };
  });
  const decor: TrackDecor[] = L.infield.map(([i, j], k) => {
    const o = W((i + 0.5) * TILE, (j + 0.5) * TILE);
    return { kind: (i * 7 + j * 3 + k) % 4 === 0 ? 'tents' : 'forest', x: o.x, z: o.z, ry: ((i + j) % 4) * (Math.PI / 2) + ry };
  });
  const grid: RaceTrack['grid'] = [];
  // (eight slots, staggered like a real grid — left, right, each 3.5 m
  // behind the one before: the kid starts in the last, behind everyone)
  for (let k = 0; k < GRID_SLOTS; k++) {
    const p = sample(startS - 9 - k * 3.5);
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
      const dd = (path[i].x - x) ** 2 + (path[i].z - z) ** 2;
      if (dd < bd) { bd = dd; bi = i; }
    }
    return { s: path[bi].s, d: Math.sqrt(bd) };
  };
  return { bx: d.bx, by: d.by, cx, cz, hx, hz, ry, pieces, decor, path, length, startS, grid, inZone, outline, nearest, sample, data: d };
}

/** has island (bx, by)'s circuit been decided (circuit or none)? */
export function hasRaceTrack(bx: number, by: number): boolean {
  return !isRaceIsland(bx, by) || cache.has(`${bx},${by},${citySeed(bx, by)}`);
}

/** install a circuit the world worker decided */
export function installRaceTrack(bx: number, by: number, d: RaceData | null): void {
  const key = `${bx},${by},${citySeed(bx, by)}`;
  if (!isRaceIsland(bx, by) || cache.has(key)) return;
  cache.set(key, d ? fromData(d) : null);
  if (cache.size > 16) cache.delete(cache.keys().next().value as string);
}
