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

// ---- exact nearest-neighbour search: a bounding-volume tree over the items
// (vertices or segments), split at the median of its longer side. A query
// descends nearer child first and skips any box farther than the best so
// far — strictly farther, so every item tied with the best is still seen
// and the visitor's lowest-index rule decides, as a plain scan would ----
interface Tree {
  /** item ids, grouped so each node owns the range [lo, hi) */
  ids: Int32Array;
  /** per node: box (x0, z0, x1, z1), range lo / hi, children (-1: a leaf) */
  box: Float64Array; lo: Int32Array; hi: Int32Array; left: Int32Array; right: Int32Array;
}
const LEAF = 8;
/** queries a path answers by plain scan before it builds its tree */
const LAZY_GRID = 40;
function buildTree(n: number, bounds: (i: number) => [number, number, number, number]): Tree {
  const bs = new Float64Array(n * 4);
  for (let i = 0; i < n; i++) { const b = bounds(i); bs[i * 4] = b[0]; bs[i * 4 + 1] = b[1]; bs[i * 4 + 2] = b[2]; bs[i * 4 + 3] = b[3]; }
  const ids = new Int32Array(n);
  for (let i = 0; i < n; i++) ids[i] = i;
  const maxNodes = Math.max(1, 2 * Math.ceil(n / LEAF) * 2);
  const box = new Float64Array(maxNodes * 4), lo = new Int32Array(maxNodes), hi = new Int32Array(maxNodes);
  const left = new Int32Array(maxNodes).fill(-1), right = new Int32Array(maxNodes).fill(-1);
  let count = 0;
  const make = (a: number, b: number): number => {
    const k = count++;
    let x0 = Infinity, z0 = Infinity, x1 = -Infinity, z1 = -Infinity;
    for (let j = a; j < b; j++) {
      const i = ids[j] * 4;
      if (bs[i] < x0) x0 = bs[i];
      if (bs[i + 1] < z0) z0 = bs[i + 1];
      if (bs[i + 2] > x1) x1 = bs[i + 2];
      if (bs[i + 3] > z1) z1 = bs[i + 3];
    }
    box[k * 4] = x0; box[k * 4 + 1] = z0; box[k * 4 + 2] = x1; box[k * 4 + 3] = z1;
    lo[k] = a; hi[k] = b;
    if (b - a > LEAF) {
      // split at the median centre along the longer side
      const ax = x1 - x0 >= z1 - z0 ? 0 : 1;
      const sub = Array.from(ids.subarray(a, b)).sort((p, q) =>
        (bs[p * 4 + ax] + bs[p * 4 + ax + 2]) - (bs[q * 4 + ax] + bs[q * 4 + ax + 2]) || p - q);
      ids.set(sub, a);
      const m = (a + b) >> 1;
      left[k] = make(a, m);
      right[k] = make(m, b);
    }
    return k;
  };
  if (n) make(0, n);
  return { ids, box, lo, hi, left, right };
}
/** squared distance from (x, z) to node k's box */
function boxD2(t: Tree, k: number, x: number, z: number): number {
  const dx = Math.max(t.box[k * 4] - x, 0, x - t.box[k * 4 + 2]);
  const dz = Math.max(t.box[k * 4 + 1] - z, 0, z - t.box[k * 4 + 3]);
  return dx * dx + dz * dz;
}
/** visit every item that could beat `best()` (squared): boxes strictly
 * farther than it are skipped, the nearer child is searched first */
function searchTree(t: Tree, x: number, z: number, visit: (i: number) => void, best: () => number, n: number): void {
  if (!n) return;
  const stack: number[] = [0];
  while (stack.length) {
    const k = stack.pop()!;
    if (boxD2(t, k, x, z) > best()) continue;
    const l = t.left[k];
    if (l < 0) {
      for (let j = t.lo[k]; j < t.hi[k]; j++) visit(t.ids[j]);
      continue;
    }
    const r = t.right[k];
    // (pushed far first: the near child pops next)
    if (boxD2(t, l, x, z) <= boxD2(t, r, x, z)) { stack.push(r, l); } else { stack.push(l, r); }
  }
}
function vertexNearest(pts: PathPt[]): Pick<WorldPath, 'nearest' | 'within'> {
  let g: Tree | null = null;
  const grid = (): Tree => (g ??= buildTree(pts.length, i => [pts[i].x, pts[i].z, pts[i].x, pts[i].z]));
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
      else searchTree(grid(), x, z, visit, () => bd, pts.length);
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
      // (a box at r or beyond can't hold a point nearer than r; a hit ends it)
      searchTree(grid(), x, z, i => {
        const dx = pts[i].x - x, dz = pts[i].z - z;
        if (dx * dx + dz * dz < r2) hit = true;
      }, () => (hit ? -1 : r2), pts.length);
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
  let segGrid: Tree | null = null, asked = 0;
  const segGridOf = (): Tree => (segGrid ??= buildTree(S, i => {
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
      else searchTree(segGridOf(), x, z, seg, () => bd, S);
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
      searchTree(segGridOf(), x, z, seg, () => (hit ? -1 : r2), S);
      return hit;
    },
  };
}

/** shortest wrapped arc distance between two distances on a closed loop */
export function arcGap(a: number, b: number, total: number): number {
  const d = Math.abs(((a - b) % total + total) % total);
  return Math.min(d, total - d);
}
