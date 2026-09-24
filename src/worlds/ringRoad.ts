// The coastal ring road's polygon: the shore inset RING_INSET m, simplified
// to straight chords. streetGen.ts lays the ring road along it (splicing
// square stretches where the river and the railway cross it); the race
// circuit (raceIsland.ts) is placed against it, so the two always agree.
import { coastFor, insetShore } from './coast.js';

type P = { x: number; z: number };

export const RING_INSET = 58;

const dist = (a: P, b: P): number => Math.hypot(a.x - b.x, a.z - b.z);
function segDist(p: P, a: P, b: P): number {
  const abx = b.x - a.x, abz = b.z - a.z, L2 = abx * abx + abz * abz;
  const t = L2 > 1e-9 ? Math.max(0, Math.min(1, ((p.x - a.x) * abx + (p.z - a.z) * abz) / L2)) : 0;
  return Math.hypot(a.x + abx * t - p.x, a.z + abz * t - p.z);
}

/** closed-polygon Douglas-Peucker, then chords at least `minChord` long */
export function simplify(poly: P[], tol: number, minChord: number): P[] {
  const dp = (pts: P[]): P[] => {
    if (pts.length < 3) return pts;
    let bi = 0, bd = 0;
    for (let i = 1; i < pts.length - 1; i++) {
      const d = segDist(pts[i], pts[0], pts[pts.length - 1]);
      if (d > bd) { bd = d; bi = i; }
    }
    if (bd <= tol) return [pts[0], pts[pts.length - 1]];
    const l = dp(pts.slice(0, bi + 1)), r = dp(pts.slice(bi));
    return [...l.slice(0, -1), ...r];
  };
  const half = poly.length >> 1;
  let out = [...dp(poly.slice(0, half + 1)).slice(0, -1), ...dp([...poly.slice(half), poly[0]]).slice(0, -1)];
  // drop vertices whose chords are too short, shortest first
  for (let guard = 0; guard < 400 && out.length > 6; guard++) {
    let bi = -1, bl = minChord;
    for (let i = 0; i < out.length; i++) {
      const l = dist(out[i], out[(i + 1) % out.length]);
      if (l < bl) { bl = l; bi = i; }
    }
    if (bi < 0) break;
    out.splice((bi + 1) % out.length, 1);
  }
  return out;
}


const cache = new Map<string, P[]>();
/** island (bx, by)'s ring polygon, before the crossing stretches */
export function ringPolygon(bx: number, by: number): P[] {
  const coast = coastFor(bx, by);
  const key = `${bx},${by},${coast.pts.length},${coast.pts[0].x.toFixed(3)}`;
  let r = cache.get(key);
  if (!r) {
    r = simplify(insetShore(coast, RING_INSET), 7, 70);
    cache.set(key, r);
    if (cache.size > 32) cache.delete(cache.keys().next().value as string);
  }
  return r;
}
