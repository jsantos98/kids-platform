// Shared arc-length path helper: turns a handful of world-space control
// points into a smooth Catmull-Rom path with uniform-distance sampling.
// Used by the railway loop and the river (both closed paths).
import * as THREE from 'three';

export interface PathPt { x: number; z: number; h: number }

export interface WorldPath {
  total: number;
  /** dense samples, one every ~2 m (plus heading) */
  pts: PathPt[];
  /** position + heading at arc distance `dist` (wraps when closed) */
  sample(dist: number): PathPt;
  /** nearest dense sample to a world point (with its index) */
  nearest(x: number, z: number): { d2: number; p: PathPt; i: number };
  /** is the path within r of (x, z)? (exactly nearest().d2 < r * r, faster) */
  within(x: number, z: number, r: number): boolean;
}

export function makePath(raw: Array<{ x: number; z: number }>, closed: boolean): WorldPath {
  const curve = new THREE.CatmullRomCurve3(
    raw.map(p => new THREE.Vector3(p.x, 0, p.z)), closed, 'centripetal', 0.5);
  curve.arcLengthDivisions = 800;
  const total = curve.getLength();
  const N = Math.max(48, Math.round(total / 2));
  const pts: PathPt[] = [];
  // an open path samples its end point too (t = 1): railway lines must
  // reach their portals exactly
  for (let k = 0; k < (closed ? N : N + 1); k++) {
    const p = curve.getPointAt(k / N);
    const t = curve.getTangentAt(k / N);
    pts.push({ x: p.x, z: p.z, h: Math.atan2(t.x, t.z) });
  }
  return {
    total,
    pts,
    sample(dist: number): PathPt {
      const d = closed
        ? ((dist % total) + total) % total
        : Math.max(0, Math.min(total - 0.01, dist));
      const f = (d / total) * N;
      const i0 = closed ? Math.floor(f) % N : Math.min(N - 1, Math.floor(f));
      const i1 = closed ? (i0 + 1) % N : i0 + 1;
      const fr = f - Math.floor(f);
      const a = pts[i0], b = pts[i1];
      let dh = b.h - a.h;
      while (dh > Math.PI) dh -= Math.PI * 2;
      while (dh < -Math.PI) dh += Math.PI * 2;
      return { x: a.x + (b.x - a.x) * fr, z: a.z + (b.z - a.z) * fr, h: a.h + dh * fr };
    },
    ...vertexNearest(pts),
  };
}

// ---- exact nearest-neighbour search on a uniform grid: cells hold the
// items (vertices or segments) whose bounds touch them; rings are searched
// outward until nothing unexplored could be closer than the best so far ----
interface Grid {
  cell: number; x0: number; z0: number; nx: number; nz: number; cells: number[][];
  /** per cell: rings (Chebyshev, in cells) to the nearest non-empty cell */
  ring: Int32Array;
  /** visit stamps (no Set per query) */
  stamp: Int32Array; tick: number;
}
const GRID_CELL = 16;
/** queries a path answers by plain scan before it builds its grid */
const LAZY_GRID = 40;
function buildGrid(n: number, bounds: (i: number) => [number, number, number, number]): Grid {
  let x0 = Infinity, z0 = Infinity, x1 = -Infinity, z1 = -Infinity;
  const bs: Array<[number, number, number, number]> = [];
  for (let i = 0; i < n; i++) {
    const b = bounds(i);
    bs.push(b);
    x0 = Math.min(x0, b[0]); z0 = Math.min(z0, b[1]); x1 = Math.max(x1, b[2]); z1 = Math.max(z1, b[3]);
  }
  const nx = Math.max(1, Math.ceil((x1 - x0) / GRID_CELL) + 1), nz = Math.max(1, Math.ceil((z1 - z0) / GRID_CELL) + 1);
  const cells: number[][] = Array.from({ length: nx * nz }, () => []);
  bs.forEach(([a, b, c, d], i) => {
    const gx0 = Math.floor((a - x0) / GRID_CELL), gx1 = Math.floor((c - x0) / GRID_CELL);
    const gz0 = Math.floor((b - z0) / GRID_CELL), gz1 = Math.floor((d - z0) / GRID_CELL);
    for (let gx = gx0; gx <= gx1; gx++) for (let gz = gz0; gz <= gz1; gz++) cells[gz * nx + gx].push(i);
  });
  // multi-source BFS over the 8-neighbourhood: exact Chebyshev ring counts
  const ring = new Int32Array(nx * nz).fill(-1);
  let q: number[] = [];
  cells.forEach((c, k) => { if (c.length) { ring[k] = 0; q.push(k); } });
  for (let d = 1; q.length; d++) {
    const next: number[] = [];
    for (const k of q) {
      const gx = k % nx, gz = (k / nx) | 0;
      for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) {
        const ax = gx + dx, az = gz + dz;
        if (ax < 0 || az < 0 || ax >= nx || az >= nz) continue;
        const m = az * nx + ax;
        if (ring[m] >= 0) continue;
        ring[m] = d;
        next.push(m);
      }
    }
    q = next;
  }
  return { cell: GRID_CELL, x0, z0, nx, nz, cells, ring, stamp: new Int32Array(n), tick: 0 };
}
function searchGrid(g: Grid, x: number, z: number, visit: (i: number) => void, best: () => number, n: number, maxD = Infinity): void {
  if (!n) return;
  const fx = (x - g.x0) / g.cell, fz = (z - g.z0) / g.cell;
  const cx = Math.floor(fx), cz = Math.floor(fz);
  // rings before the first non-empty one hold nothing (triangle inequality
  // from the nearest in-grid cell when the query lies outside the grid)
  const kx = Math.max(0, Math.min(g.nx - 1, cx)), kz = Math.max(0, Math.min(g.nz - 1, cz));
  const r0 = Math.max(0, g.ring[kz * g.nx + kx] - Math.max(Math.abs(cx - kx), Math.abs(cz - kz)));
  const maxR = Math.max(Math.abs(cx), Math.abs(cz), Math.abs(cx - g.nx), Math.abs(cz - g.nz)) + 1;
  const tick = ++g.tick;
  const cellAt = (gx: number, gz: number): void => {
    if (gx < 0 || gz < 0 || gx >= g.nx || gz >= g.nz) return;
    for (const i of g.cells[gz * g.nx + gx]) {
      if (g.stamp[i] === tick) continue;
      g.stamp[i] = tick;
      visit(i);
    }
  };
  for (let r = r0; r <= maxR; r++) {
    if (r === 0) cellAt(cx, cz);
    else {
      for (let gx = cx - r; gx <= cx + r; gx++) { cellAt(gx, cz - r); cellAt(gx, cz + r); }
      for (let gz = cz - r + 1; gz <= cz + r - 1; gz++) { cellAt(cx - r, gz); cellAt(cx + r, gz); }
    }
    // everything unexplored lies outside the square of rings 0..r
    const edge = Math.min(fx - (cx - r), cx + r + 1 - fx, fz - (cz - r), cz + r + 1 - fz) * g.cell;
    const b = best();
    if (b < Infinity && b <= edge * edge) return;
    if (edge >= maxD) return; // nothing unexplored lies within maxD
  }
}
function vertexNearest(pts: PathPt[]): Pick<WorldPath, 'nearest' | 'within'> {
  let g: Grid | null = null;
  const grid = (): Grid => (g ??= buildGrid(pts.length, i => [pts[i].x, pts[i].z, pts[i].x, pts[i].z]));
  // a path asked only a few times isn't worth a grid: scan those
  let asked = 0;
  const all = (visit: (i: number) => void): void => { for (let i = 0; i < pts.length; i++) visit(i); };
  return {
    nearest(x, z) {
      let bi = 0, bd = Infinity;
      const visit = (i: number): void => {
        const dx = pts[i].x - x, dz = pts[i].z - z;
        const d2 = dx * dx + dz * dz;
        if (d2 < bd || (d2 === bd && i < bi)) { bd = d2; bi = i; }
      };
      if (++asked < LAZY_GRID) all(visit);
      else searchGrid(grid(), x, z, visit, () => bd, pts.length);
      return { d2: bd, p: pts[bi], i: bi };
    },
    within(x, z, r) {
      let hit = false;
      const r2 = r * r;
      if (++asked < LAZY_GRID) {
        for (let i = 0; i < pts.length && !hit; i++) {
          const dx = pts[i].x - x, dz = pts[i].z - z;
          if (dx * dx + dz * dz < r2) hit = true;
        }
        return hit;
      }
      searchGrid(grid(), x, z, i => {
        const dx = pts[i].x - x, dz = pts[i].z - z;
        if (dx * dx + dz * dz < r2) hit = true;
      }, () => (hit ? 0 : Infinity), pts.length, r);
      return hit;
    },
  };
}

function nearestOf(pts: PathPt[], x: number, z: number): { d2: number; p: PathPt; i: number } {
  let bi = 0, bd = Infinity;
  for (let i = 0; i < pts.length; i++) {
    const dx = pts[i].x - x, dz = pts[i].z - z;
    const d2 = dx * dx + dz * dz;
    if (d2 < bd) { bd = d2; bi = i; }
  }
  return { d2: bd, p: pts[bi], i: bi };
}

/** A path that follows a dense polyline exactly (linear interpolation
 * between samples) — used for the railway after its crossing deformation,
 * where the shape must not be re-smoothed back off the perpendicular. The
 * railway lines are OPEN (portal to portal); `closed` wraps the last vertex
 * back onto the first. */
export function polyPath(raw: Array<{ x: number; z: number }>, closed = false): WorldPath {
  const N = raw.length;
  const at = (i: number): { x: number; z: number } =>
    closed ? raw[((i % N) + N) % N] : raw[Math.max(0, Math.min(N - 1, i))];
  const pts: PathPt[] = raw.map((p, i) => {
    const a = at(i - 1), b = at(i + 1);
    return { x: p.x, z: p.z, h: Math.atan2(b.x - a.x, b.z - a.z) };
  });
  const S = closed ? N : N - 1; // segments
  const cum: number[] = [0];
  for (let k = 1; k <= S; k++) {
    const a = raw[k - 1], b = raw[k % N];
    cum.push(cum[k - 1] + Math.hypot(b.x - a.x, b.z - a.z));
  }
  const total = cum[S];
  let segGrid: Grid | null = null, asked = 0;
  const segGridOf = (): Grid => (segGrid ??= buildGrid(S, i => {
    const a = pts[i], b = pts[(i + 1) % N];
    return [Math.min(a.x, b.x), Math.min(a.z, b.z), Math.max(a.x, b.x), Math.max(a.z, b.z)];
  }));
  return {
    total,
    pts,
    sample(dist: number): PathPt {
      const d = closed ? ((dist % total) + total) % total : Math.max(0, Math.min(total, dist));
      let lo = 0, hi = S;
      while (lo + 1 < hi) {
        const mid = (lo + hi) >> 1;
        if (cum[mid] <= d) lo = mid; else hi = mid;
      }
      const fr = Math.min(1, (d - cum[lo]) / (cum[lo + 1] - cum[lo] || 1e-6));
      const a = pts[lo], b = pts[(lo + 1) % N];
      let dh = b.h - a.h;
      while (dh > Math.PI) dh -= Math.PI * 2;
      while (dh < -Math.PI) dh += Math.PI * 2;
      return { x: a.x + (b.x - a.x) * fr, z: a.z + (b.z - a.z) * fr, h: a.h + dh * fr };
    },
    nearest(x: number, z: number): { d2: number; p: PathPt; i: number } {
      // project onto SEGMENTS, not just vertices: the deformation collapses
      // samples, and the polyline between two far-apart vertices is real
      // rail that vertex-based guards would miss entirely
      let bi = 0, bd = Infinity, bt = 0;
      const seg = (i: number): void => {
        const a = pts[i], b = pts[(i + 1) % N];
        const abx = b.x - a.x, abz = b.z - a.z;
        const len2 = abx * abx + abz * abz;
        let t = len2 > 1e-9 ? ((x - a.x) * abx + (z - a.z) * abz) / len2 : 0;
        t = t < 0 ? 0 : t > 1 ? 1 : t;
        const dx = a.x + abx * t - x, dz = a.z + abz * t - z;
        const d2 = dx * dx + dz * dz;
        // (ties go to the lowest index, as a plain scan would)
        if (d2 < bd || (d2 === bd && i < bi)) { bd = d2; bi = i; bt = t; }
      };
      if (++asked < LAZY_GRID) for (let i = 0; i < S; i++) seg(i);
      else searchGrid(segGridOf(), x, z, seg, () => bd, S);
      const a = pts[bi], b = pts[(bi + 1) % N];
      let dh = b.h - a.h;
      while (dh > Math.PI) dh -= Math.PI * 2;
      while (dh < -Math.PI) dh += Math.PI * 2;
      return {
        d2: bd,
        p: { x: a.x + (b.x - a.x) * bt, z: a.z + (b.z - a.z) * bt, h: a.h + dh * bt },
        i: bi,
      };
    },
    within(x: number, z: number, r: number): boolean {
      let hit = false;
      const r2 = r * r;
      const seg = (i: number): void => {
        const a = pts[i], b = pts[(i + 1) % N];
        const abx = b.x - a.x, abz = b.z - a.z;
        const len2 = abx * abx + abz * abz;
        let t = len2 > 1e-9 ? ((x - a.x) * abx + (z - a.z) * abz) / len2 : 0;
        t = t < 0 ? 0 : t > 1 ? 1 : t;
        const dx = a.x + abx * t - x, dz = a.z + abz * t - z;
        if (dx * dx + dz * dz < r2) hit = true;
      };
      if (++asked < LAZY_GRID) { for (let i = 0; i < S && !hit; i++) seg(i); return hit; }
      searchGrid(segGridOf(), x, z, seg, () => (hit ? 0 : Infinity), S, r);
      return hit;
    },
  };
}

/** shortest wrapped arc distance between two distances on a closed loop */
export function arcGap(a: number, b: number, total: number): number {
  const d = Math.abs(((a - b) % total + total) % total);
  return Math.min(d, total - d);
}
