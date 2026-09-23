// Shared arc-length path helper: turns a handful of world-space control
// points into a smooth Catmull-Rom path with uniform-distance sampling.
// Used by the railway loop and the tram loop (closed) and the river (open).
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

/** shortest wrapped arc distance between two distances on a closed loop */
export function arcGap(a: number, b: number, total: number): number {
  const d = Math.abs(((a - b) % total + total) % total);
  return Math.min(d, total - d);
}
