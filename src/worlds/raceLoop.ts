// A race island's circuit as a loop of Racing Kit tiles (the Starter-Kit-
// Racing look): every island grows its own. A seeded block shape
// (a polyomino) is grown on a coarse grid from a rectangle by random
// bumps in and out, kept simply connected and free of corner-only contacts;
// the track runs round its outline. Scaled 2x onto a grid of TILE m cells
// (a coarse corner is a fine cell, a coarse side a straight between), so
// corners are always a straight apart and two stretches of track never
// touch unless they follow each other. Pure geometry: raceIsland.ts places
// it, the chunk baker lays the tiles, the race drives the centreline.
import type { Rng } from '../engine/rng.js';

/** one tile: 20 m (the kit's 10-unit tile at 2 m a unit; its road is 12 m) */
export const TILE = 20;

/** a heading (atan2(x, z)) per step between 4-neighbour cells */
const STEP_H: Record<string, number> = { '0,1': 0, '1,0': Math.PI / 2, '0,-1': Math.PI, '-1,0': -Math.PI / 2 };
const hOf = (di: number, dj: number): number => STEP_H[`${di},${dj}`];

export interface LoopTile {
  i: number;
  j: number;
  kind: 'straight' | 'corner';
  /** quarter turns applied to the kit tile (its native straight runs along
   * z, its native corner opens to +z and -x) */
  q: number;
  /** travel heading into and out of the tile */
  hIn: number;
  hOut: number;
}

export interface Loop {
  /** fine grid size (cells) */
  nx: number;
  nz: number;
  /** the track, in driving order */
  tiles: LoopTile[];
  /** cells inside the loop (the infield) */
  infield: Array<[number, number]>;
}

type Cell = [number, number];
const key = (a: number, b: number): string => `${a},${b}`;

/** the outline of polyomino S (coarse cells) as one closed cycle of lattice
 * vertices (counter-clockwise), or null if S has holes, pinch points or
 * several pieces */
function outline(S: Set<string>): Cell[] | null {
  // directed boundary edges, each cell walked counter-clockwise (x right, z up)
  const out = new Map<string, Cell>();
  let edges = 0;
  for (const k of S) {
    const [a, b] = k.split(',').map(Number);
    const sides: Array<[boolean, Cell, Cell]> = [
      [!S.has(key(a, b - 1)), [a, b], [a + 1, b]],         // bottom, left to right
      [!S.has(key(a + 1, b)), [a + 1, b], [a + 1, b + 1]], // right, up
      [!S.has(key(a, b + 1)), [a + 1, b + 1], [a, b + 1]], // top, right to left
      [!S.has(key(a - 1, b)), [a, b + 1], [a, b]],         // left, down
    ];
    for (const [open, p, q] of sides) {
      if (!open) continue;
      const pk = key(p[0], p[1]);
      if (out.has(pk)) return null; // two boundary edges leave one vertex: a pinch
      out.set(pk, q);
      edges++;
    }
  }
  if (!edges) return null;
  const start = out.keys().next().value as string;
  const cyc: Cell[] = [];
  let cur = start;
  for (let guard = 0; guard <= edges; guard++) {
    const [a, b] = cur.split(',').map(Number);
    cyc.push([a, b]);
    const nx = out.get(cur);
    if (!nx) return null;
    cur = key(nx[0], nx[1]);
    if (cur === start) break;
  }
  return cyc.length === edges ? cyc : null; // one cycle through every edge: no holes
}

/** grow a seeded loop within a coarse grid of cw x ch cells */
export function makeLoop(r: Rng, cw = 5, ch = 4): Loop {
  const w0 = 3 + ((r() * (cw - 2)) | 0), h0 = 2 + ((r() * (ch - 1)) | 0);
  const x0 = (r() * (cw - w0 + 1)) | 0, z0 = (r() * (ch - h0 + 1)) | 0;
  let S = new Set<string>();
  for (let a = x0; a < x0 + w0; a++) for (let b = z0; b < z0 + h0; b++) S.add(key(a, b));
  // bumps in and out, each kept only if the outline stays one clean loop
  const bumps = 4 + ((r() * 7) | 0);
  for (let done = 0, tries = 0; done < bumps && tries < 200; tries++) {
    const a = (r() * cw) | 0, b = (r() * ch) | 0, k = key(a, b);
    const T = new Set(S);
    if (T.has(k)) {
      if (T.size <= 4) continue;
      T.delete(k);
    } else {
      if (![[1, 0], [-1, 0], [0, 1], [0, -1]].some(([da, db]) => T.has(key(a + da, b + db)))) continue;
      T.add(k);
    }
    if (!outline(T)) continue;
    S = T;
    done++;
  }
  const cyc = outline(S)!;
  // scale 2x: a lattice vertex (a, b) is fine cell (2a, 2b), a side between
  // two vertices the fine cell between them
  const fine: Cell[] = [];
  for (let k = 0; k < cyc.length; k++) {
    const [a, b] = cyc[k], [c, d] = cyc[(k + 1) % cyc.length];
    fine.push([2 * a, 2 * b], [a + c, b + d]);
  }
  let i0 = Infinity, j0 = Infinity, i1 = -Infinity, j1 = -Infinity;
  for (const [i, j] of fine) { i0 = Math.min(i0, i); j0 = Math.min(j0, j); i1 = Math.max(i1, i); j1 = Math.max(j1, j); }
  const cells: Cell[] = fine.map(([i, j]) => [i - i0, j - j0]);
  const n = cells.length;
  const tiles: LoopTile[] = cells.map(([i, j], k) => {
    const [pi, pj] = cells[(k - 1 + n) % n], [ni, nj] = cells[(k + 1) % n];
    const hIn = hOf(i - pi, j - pj), hOut = hOf(ni - i, nj - j);
    if (Math.abs(Math.sin(hIn - hOut)) < 1e-6) return { i, j, kind: 'straight', q: Math.round(hIn / (Math.PI / 2)), hIn, hOut };
    // open sides: back toward the previous cell, on toward the next
    const back = hIn + Math.PI, on = hOut;
    let q = 0;
    for (let t = 0; t < 4; t++) {
      const a = t * (Math.PI / 2), b = -Math.PI / 2 + t * (Math.PI / 2);
      const same = (x: number, y: number): boolean => Math.abs(Math.sin((x - y) / 2)) < 1e-6;
      if ((same(a, back) && same(b, on)) || (same(a, on) && same(b, back))) { q = t; break; }
    }
    return { i, j, kind: 'corner', q, hIn, hOut };
  });
  // the infield: fine cells whose centre lies inside the outline
  const poly = cyc.map(([a, b]) => [2 * a - i0, 2 * b - j0]);
  const onTrack = new Set(cells.map(([i, j]) => key(i, j)));
  const infield: Cell[] = [];
  for (let i = 0; i <= i1 - i0; i++) for (let j = 0; j <= j1 - j0; j++) {
    if (onTrack.has(key(i, j))) continue;
    // (cell (i, j)'s centre is lattice point (i, j) in the scaled outline)
    let inside = false;
    for (let k = 0, m = poly.length - 1; k < poly.length; m = k++) {
      const [xa, za] = poly[k], [xb, zb] = poly[m];
      if ((za > j) !== (zb > j) && i < ((xb - xa) * (j - za)) / (zb - za) + xa) inside = !inside;
    }
    if (inside) infield.push([i, j]);
  }
  return { nx: i1 - i0 + 1, nz: j1 - j0 + 1, tiles, infield };
}
