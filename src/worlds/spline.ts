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
}

export function makePath(raw: Array<{ x: number; z: number }>, closed: boolean): WorldPath {
  const curve = new THREE.CatmullRomCurve3(
    raw.map(p => new THREE.Vector3(p.x, 0, p.z)), closed, 'centripetal', 0.5);
  curve.arcLengthDivisions = 800;
  const total = curve.getLength();
  const N = Math.max(48, Math.round(total / 2));
  const pts: PathPt[] = [];
  for (let k = 0; k < N; k++) {
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
      const i0 = Math.floor(f) % N;
      const i1 = (i0 + 1) % N;
      const fr = f - Math.floor(f);
      const a = pts[i0], b = pts[i1];
      let dh = b.h - a.h;
      while (dh > Math.PI) dh -= Math.PI * 2;
      while (dh < -Math.PI) dh += Math.PI * 2;
      return { x: a.x + (b.x - a.x) * fr, z: a.z + (b.z - a.z) * fr, h: a.h + dh * fr };
    },
    nearest(x: number, z: number): { d2: number; p: PathPt; i: number } {
      let bi = 0, bd = Infinity;
      for (let i = 0; i < pts.length; i++) {
        const dx = pts[i].x - x, dz = pts[i].z - z;
        const d2 = dx * dx + dz * dz;
        if (d2 < bd) { bd = d2; bi = i; }
      }
      return { d2: bd, p: pts[bi], i: bi };
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

/** A closed path that follows a dense polyline exactly (linear interpolation
 * between samples) — used for the railway after its crossing deformation,
 * where the shape must not be re-smoothed back off the perpendicular. */
export function polyPath(raw: Array<{ x: number; z: number }>): WorldPath {
  const N = raw.length;
  const pts: PathPt[] = raw.map((p, i) => {
    const a = raw[(i - 1 + N) % N], b = raw[(i + 1) % N];
    return { x: p.x, z: p.z, h: Math.atan2(b.x - a.x, b.z - a.z) };
  });
  const cum: number[] = [0];
  for (let k = 1; k <= N; k++) {
    const a = raw[k - 1], b = raw[k % N];
    cum.push(cum[k - 1] + Math.hypot(b.x - a.x, b.z - a.z));
  }
  const total = cum[N];
  return {
    total,
    pts,
    sample(dist: number): PathPt {
      const d = ((dist % total) + total) % total;
      let lo = 0, hi = N;
      while (lo + 1 < hi) {
        const mid = (lo + hi) >> 1;
        if (cum[mid] <= d) lo = mid; else hi = mid;
      }
      const fr = (d - cum[lo]) / (cum[lo + 1] - cum[lo] || 1e-6);
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
      for (let i = 0; i < N; i++) {
        const a = pts[i], b = pts[(i + 1) % N];
        const abx = b.x - a.x, abz = b.z - a.z;
        const len2 = abx * abx + abz * abz;
        let t = len2 > 1e-9 ? ((x - a.x) * abx + (z - a.z) * abz) / len2 : 0;
        t = t < 0 ? 0 : t > 1 ? 1 : t;
        const dx = a.x + abx * t - x, dz = a.z + abz * t - z;
        const d2 = dx * dx + dz * dz;
        if (d2 < bd) { bd = d2; bi = i; bt = t; }
      }
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
  };
}

/** shortest wrapped arc distance between two distances on a closed loop */
export function arcGap(a: number, b: number, total: number): number {
  const d = Math.abs(((a - b) % total + total) % total);
  return Math.min(d, total - d);
}
