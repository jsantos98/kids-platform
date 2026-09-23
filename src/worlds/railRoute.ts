// The island railway: a seeded, procedural closed rail loop on the chunk-line
// lattice (7×7 nodes at 64 m). Every world seed yields a different wiggly loop
// — random rectangle extents plus random detours — that may not cross the open
// race-corner zone (the loop detours along the beach rim there instead).
//
// The route drives three things:
//   - cityChunk suppresses road tiles on rail corridors and swaps level
//     crossings in where a rail passes a road node
//   - the rails mesh (chord-laid track pieces from the Kenney train kit, with
//     a procedural ballast+rails fallback) is built from the same path
//   - the trains ride the sampled path, one path distance per vehicle
import * as THREE from 'three';
import { rng, chunkSeed } from '../engine/rng.js';
import { Baked } from '../engine/baked.js';
import { bakedModel, type BakedTemplate } from '../engine/assets.js';

export const RAIL_Y = 0.11;   // track bed base, just above the slab top
export const RAIL_TOP = 0.21; // where train wheels sit
const R = 12;                 // corner arc radius (m)
const STEP = 1.5;             // path sample spacing (m)

interface Pt { x: number; z: number; h: number }
type Node = [number, number];
type Edge = [number, number, number, number]; // node (a,b) -> (c,d)

const key = (a: number, b: number) => `${a},${b}`;

export interface RailRoute {
  /** closed loop of lattice edges in travel order */
  edges: Edge[];
  /** polyline sampled every ~STEP metres, h = heading atan2(dx, dz) */
  pts: Pt[];
  total: number;
  sample(dist: number): Pt;
  /** rail occupies the corridor segment on vertical line i, chunk-row j */
  edgeV(i: number, j: number): boolean;
  /** rail occupies the corridor segment on horizontal line j, chunk-column i */
  edgeH(j: number, i: number): boolean;
  /** route passes through this lattice node */
  nodeOnRoute(i: number, j: number): boolean;
}

// the open race-corner zone: chunk columns/rows 4..5 may not carry rails in
// their interior — the loop uses the beach rim (lines 0 and 6) there instead
function edgeAllowed(i: number, j: number): boolean {
  if (i < 0 || j < 0 || i > 5 || j > 5) return false;
  const zone = (a: number, b: number) => a >= 4 && a <= 5 && b >= 4 && b <= 5;
  return !zone(i, j);
}

// module-level cache: the route only depends on the world seed, and both the
// chunk baker and the trains ask for it
const cache = new Map<number, RailRoute>();

export function railRouteFor(seed: number): RailRoute {
  let route = cache.get(seed);
  if (route) return route;
  route = buildRoute(seed);
  cache.set(seed, route);
  return route;
}

function buildRoute(seed: number): RailRoute {
  const r = rng(chunkSeed(seed, 0x5a1, 0x7e));

  // --- base loop: a random rectangle whose SE corner either tucks in at line
  // 3 or bypasses the race zone along the beach rim (lines 6). Extents keep
  // the tour island-sized (≥3 cells per side). ---
  const iW = (r() * 2) | 0;                    // 0..1
  const jN = (r() * 3) | 0;                    // 0..2
  const nodes: Node[] = [];
  if (r() < 0.5) {
    const jS = Math.max(3 + ((r() * 3) | 0), jN + 3);
    rectNodes(nodes, iW, jN, 3, jS);
  } else {
    const iE = Math.max(4 + ((r() * 2) | 0), iW + 3); // 4..5: rim bypass
    nodes.push([iW, jN], [iE, jN], [iE, 3], [6, 3], [6, 6], [iW, 6]);
  }

  let edges = nodesToEdges(expandCells(nodes));

  // --- random detours: splice 2–3-edge jogs into long straight sides ---
  edges = tryJog(r, edges, false, iW) ?? edges; // west side
  edges = tryJog(r, edges, true, jN) ?? edges;  // north side
  edges = tryJog(r, edges, false, 3) ?? edges;  // inner east side
  edges = tryJog(r, edges, true, 3) ?? edges;   // inner south side

  // --- occupancy sets ---
  const edgeVSet = new Set<string>(), edgeHSet = new Set<string>();
  const onRoute = new Set<string>();
  for (const [a, b, c, d] of edges) {
    if (b === d) edgeHSet.add(key(b, Math.min(a, c)));
    else edgeVSet.add(key(a, Math.min(b, d)));
    onRoute.add(key(a, b));
    onRoute.add(key(c, d));
  }

  // --- path pieces: straights plus quarter arcs at turns (unit edges) ---
  const n = edges.length;
  const pos = (nd: Node) => ({ x: nd[0] * 64, z: nd[1] * 64 });
  const dirOf = (a: Node, b: Node) => ({ x: Math.sign(b[0] - a[0]), z: Math.sign(b[1] - a[1]) });
  interface Piece { x: number; z: number; dx: number; dz: number; len: number }
  const pieces: Piece[] = [];
  for (let k = 0; k < n; k++) {
    const A = [edges[k][0], edges[k][1]] as Node;
    const B = [edges[k][2], edges[k][3]] as Node;
    const d = dirOf(A, B);
    const dIn = dirOf([edges[(k - 1 + n) % n][0], edges[(k - 1 + n) % n][1]], A);
    const dOut = dirOf(B, [edges[(k + 1) % n][2], edges[(k + 1) % n][3]]);
    const turnIn = dIn.x !== d.x || dIn.z !== d.z;
    const turnOut = dOut.x !== d.x || dOut.z !== d.z;
    const p = pos(A);
    const s = turnIn ? R : 0;
    if (turnIn) {
      // quarter arc from A−in*R to A+out*R around C = A − in*R + out*R
      const cx = p.x - dIn.x * R + d.x * R;
      const cz = p.z - dIn.z * R + d.z * R;
      const a0 = Math.atan2(p.z - dIn.z * R - cz, p.x - dIn.x * R - cx);
      const sweep = dIn.x * d.z - dIn.z * d.x > 0 ? 1 : -1;
      const steps = 8;
      for (let t = 0; t < steps; t++) {
        const a1 = a0 + sweep * (Math.PI / 2) * (t / steps);
        const a2 = a0 + sweep * (Math.PI / 2) * ((t + 1) / steps);
        pieces.push({
          x: cx + Math.cos(a1) * R, z: cz + Math.sin(a1) * R,
          dx: Math.cos((a1 + a2) / 2), dz: Math.sin((a1 + a2) / 2),
          len: (R * Math.PI / 2) / steps,
        });
      }
    }
    const len = 64 - s - (turnOut ? R : 0);
    if (len > 0.01) {
      pieces.push({ x: p.x + d.x * s, z: p.z + d.z * s, dx: d.x, dz: d.z, len });
    }
  }

  // --- polyline ---
  const pts: Pt[] = [];
  let total = 0;
  for (const p of pieces) {
    const steps = Math.max(1, Math.round(p.len / STEP));
    for (let t = 0; t < steps; t++) {
      const f = t / steps;
      pts.push({ x: p.x + p.dx * p.len * f, z: p.z + p.dz * p.len * f, h: Math.atan2(p.dx, p.dz) });
    }
    total += p.len;
  }

  const route: RailRoute = {
    edges, pts, total,
    edgeV: (i, j) => edgeVSet.has(key(i, j)),
    edgeH: (j, i) => edgeHSet.has(key(j, i)),
    nodeOnRoute: (i, j) => onRoute.has(key(i, j)),
    sample(dist: number): Pt {
      const d = ((dist % total) + total) % total;
      const f = (d / total) * pts.length;
      const i0 = Math.min(pts.length - 1, Math.floor(f));
      const i1 = (i0 + 1) % pts.length;
      const fr = f - Math.floor(f);
      const a = pts[i0], b = pts[i1];
      let dh = b.h - a.h;
      while (dh > Math.PI) dh -= Math.PI * 2;
      while (dh < -Math.PI) dh += Math.PI * 2;
      return { x: a.x + (b.x - a.x) * fr, z: a.z + (b.z - a.z) * fr, h: a.h + dh * fr };
    },
  };
  return route;
}

function rectNodes(nodes: Node[], iW: number, jN: number, iE: number, jS: number): void {
  nodes.push([iW, jN], [iE, jN], [iE, jS], [iW, jS]);
}

function nodesToEdges(nodes: Node[]): Edge[] {
  const out: Edge[] = [];
  for (let k = 0; k < nodes.length; k++) {
    const [a, b] = nodes[k], [c, d] = nodes[(k + 1) % nodes.length];
    out.push([a, b, c, d]);
  }
  return out;
}

/** Expand corner-to-corner hops into unit (64 m) lattice edges. */
function expandCells(nodes: Node[]): Node[] {
  const out: Node[] = [];
  for (let k = 0; k < nodes.length; k++) {
    const [a, b] = nodes[k], [c, d] = nodes[(k + 1) % nodes.length];
    const di = Math.sign(c - a), dj = Math.sign(d - b);
    let i = a, j = b;
    while (i !== c || j !== d) {
      out.push([i, j]);
      i += di; j += dj;
    }
  }
  return out;
}

/**
 * Splice a 2–3-edge jog into a straight run of the loop along vertical line
 * `line` (horiz=false) or horizontal line `line` (horiz=true). Returns the new
 * edge list, or null when no valid jog fits (caller keeps the original).
 */
function tryJog(
  r: () => number,
  edges: Edge[],
  horiz: boolean,
  line: number,
): Edge[] | null {
  // maximal consecutive runs of same-direction edges on this line
  const runs: Array<{ start: number; count: number }> = [];
  for (let k = 0; k < edges.length; k++) {
    const [a, b, c, d] = edges[k];
    const isHoriz = b === d;
    const atLine = isHoriz ? b : a;
    const last = runs[runs.length - 1];
    if (isHoriz === horiz && atLine === line && last && last.start + last.count === k) {
      last.count++;
    } else if (isHoriz === horiz && atLine === line) {
      runs.push({ start: k, count: 1 });
    }
  }
  const fit = runs.filter(run => run.count >= L_MIN);
  if (!fit.length) return null;
  const run = fit[(r() * fit.length) | 0];
  const L = 2 + ((r() * 2) | 0); // jog length in edges
  const slack = run.count - L - 2; // margins on both sides
  if (slack < 1) return null;
  const s = run.start + 1 + ((r() * slack) | 0);

  const first = edges[s];
  const dirSign = horiz ? Math.sign(first[2] - first[0]) : Math.sign(first[3] - first[1]);
  const i0 = first[0], j0 = first[1];
  const lineOut = line + (r() < 0.5 ? -1 : 1);
  if (lineOut < 0 || lineOut > 6) return null;

  const newPath: Edge[] = [];
  const perp: Edge = horiz ? [i0, j0, i0, lineOut] : [i0, j0, lineOut, j0];
  if (!edgeAllowed(perp[0], perp[1]) || !edgeAllowed(perp[2], perp[3])) return null;
  newPath.push(perp);
  for (let k = 0; k < L; k++) {
    const a: Edge = horiz
      ? [i0 + dirSign * k, lineOut, i0 + dirSign * (k + 1), lineOut]
      : [lineOut, j0 + dirSign * k, lineOut, j0 + dirSign * (k + 1)];
    if (!edgeAllowed(a[0], a[1])) return null;
    newPath.push(a);
  }
  const back: Edge = horiz
    ? [i0 + dirSign * L, lineOut, i0 + dirSign * L, j0]
    : [lineOut, j0 + dirSign * L, i0, j0 + dirSign * L];
  if (!edgeAllowed(back[0], back[1]) || !edgeAllowed(back[2], back[3])) return null;
  newPath.push(back);

  const out: Edge[] = [];
  for (let k = 0; k < edges.length; k++) {
    if (k === s) out.push(...newPath);
    if (k >= s && k < s + L) continue;
    out.push(edges[k]);
  }
  return out;
}
const L_MIN = 5; // a side needs at least this many edges before a jog fits

/**
 * Rails mesh: track pieces laid along the whole path (the Kenney
 * railroad-straight tile, scaled per piece; a procedural ballast+rails
 * fallback when the kit is unavailable). One merged mesh for the island.
 */
export function bakeRails(route: RailRoute, tpl: BakedTemplate | null): THREE.Mesh {
  const B = new Baked();
  const W = 3.4; // track bed width (m)
  const piece = (x: number, z: number, h: number, len: number): void => {
    if (tpl) {
      const sx = W / tpl.size.x, sz = (len + 0.3) / tpl.size.z;
      for (const src of tpl.geos) {
        const g = src.clone();
        g.scale(sx, 1, sz);
        g.translate(0, 0, -len / 2);
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
