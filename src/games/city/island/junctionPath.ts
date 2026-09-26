// The curve a car drives through a junction — the island's traffic
// (cars.ts) and the police's getaway cars (robber.ts) both take it, so
// they turn alike: from the right-hand lane point before the node to the
// next street's lane point after it. An ordinary junction: a quadratic
// Bezier bent through the corner where the two lanes meet (a straight run,
// a turn or a U-turn at a dead end all come out smooth); a roundabout:
// counter-clockwise round its ring (right-hand traffic).
import { leaving, type StreetGraph, type SEdge, type SNode } from '../../../worlds/streetGraph.js';

/** a lane's offset from the centre line (m) */
export const LANE = 3.5;
/** a roundabout is entered / left this far from its centre, round a ring of RING_R */
export const ROUND_IN = 21;
export const RING_R = 9;
/** an ordinary junction is taken on a curve from this far before the node
 * to this far past it */
export const TURN_IN = 7;

export interface JunctionPath {
  pts: Array<{ x: number; z: number }>;
  /** cumulative arc length at each point */
  cum: number[];
  /** where the curve ends on the next street, metres out from the node */
  out: number;
}

const rightOf = (hx: number, hz: number): { x: number; z: number } => ({ x: -hz, z: hx });

/** the right-hand lane point `s` metres along edge e driving `dir` (city-local) */
export function lanePoint(g: StreetGraph, e: SEdge, dir: 1 | -1, s: number, extra = 0): { x: number; z: number } {
  return g.sample(e, dir > 0 ? s : e.len - s, (dir > 0 ? 1 : -1) * (LANE + extra));
}

/** the curve through `node` from edge e (driving `dir`) onto `next` */
export function junctionPath(g: StreetGraph, e: SEdge, dir: 1 | -1, node: SNode, next: SEdge): JunctionPath {
  const nextDir: 1 | -1 = next.a === node.id ? 1 : -1;
  const hin = { x: e.ux * dir, z: e.uz * dir };
  const hout = leaving(g, next, node.id);
  const rin = rightOf(hin.x, hin.z), rout = rightOf(hout.x, hout.z);
  const pts: Array<{ x: number; z: number }> = [];
  let out: number;
  if (node.plaza) {
    const E = lanePoint(g, e, dir, e.len - ROUND_IN);
    const X = lanePoint(g, next, nextDir, ROUND_IN);
    // counter-clockwise on screen (+z south): atan2(z, x) decreases
    const aE = Math.atan2(-hin.z * RING_R + rin.z * LANE, -hin.x * RING_R + rin.x * LANE);
    const aX = Math.atan2(hout.z * RING_R + rout.z * LANE, hout.x * RING_R + rout.x * LANE);
    let sweep = aE - aX;
    while (sweep <= 0.2) sweep += Math.PI * 2;
    pts.push(E);
    const n = Math.max(4, Math.ceil((sweep * RING_R) / 2));
    for (let q = 0; q <= n; q++) {
      const a = aE - (sweep * q) / n;
      pts.push({ x: node.x + Math.cos(a) * RING_R, z: node.z + Math.sin(a) * RING_R });
    }
    pts.push(X);
    out = ROUND_IN;
  } else {
    const E = lanePoint(g, e, dir, e.len - TURN_IN);
    const X = lanePoint(g, next, nextDir, TURN_IN);
    const straight = hin.x * hout.x + hin.z * hout.z > 0.9;
    const uturn = hin.x * hout.x + hin.z * hout.z < -0.9;
    // control point: where the two lane lines cross (the lane corner); a
    // straight run just uses the midpoint, a U-turn swings out past the node
    const C = straight ? { x: (E.x + X.x) / 2, z: (E.z + X.z) / 2 }
      : uturn ? { x: node.x + hin.x * TURN_IN, z: node.z + hin.z * TURN_IN }
        : { x: node.x + (rin.x + rout.x) * LANE, z: node.z + (rin.z + rout.z) * LANE };
    const n = 10;
    for (let q = 0; q <= n; q++) {
      const t = q / n, u = 1 - t;
      pts.push({ x: u * u * E.x + 2 * u * t * C.x + t * t * X.x, z: u * u * E.z + 2 * u * t * C.z + t * t * X.z });
    }
    out = TURN_IN;
  }
  const cum = [0];
  for (let k = 1; k < pts.length; k++) cum.push(cum[k - 1] + Math.hypot(pts[k].x - pts[k - 1].x, pts[k].z - pts[k - 1].z));
  return { pts, cum, out };
}

/** a point `s` metres along a curve, and the heading there */
export function alongPath(p: JunctionPath, s: number): { x: number; z: number; h: number } {
  const { pts, cum } = p;
  let k = 0;
  while (k < pts.length - 2 && cum[k + 1] < s) k++;
  const a = pts[k], b = pts[k + 1];
  const f = Math.min(1, Math.max(0, (s - cum[k]) / (cum[k + 1] - cum[k] || 1)));
  return { x: a.x + (b.x - a.x) * f, z: a.z + (b.z - a.z) * f, h: Math.atan2(b.x - a.x, b.z - a.z) };
}
