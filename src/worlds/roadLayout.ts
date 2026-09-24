// Road layout: which road piece goes where. Pure geometry (no three.js) so the
// chunk baker lays exactly these pieces and the audit can prove they never
// overlap and cover every street (R35).
//
// The Kenney City Kit Roads is a 1x1-unit tile set whose straight piece IS
// the full road cross-section (kerb strip, gutter, asphalt, centre line), laid
// at one uniform unit of ROAD_TILE = 14 m — the R5 carriageway — and rotated
// to any street angle (R2'):
//   - every street node owns a pad. A SQUARE node (all arms on one 90-degree
//     cross) takes a kit piece rotated to its frame: crossroad (4 arms),
//     T-piece (3), bend (2 at a right angle), a straight (2 in line), the end
//     cap, or the 3x3 roundabout at plazas. Any other node — an oblique
//     junction or bend — takes a procedural POLYGON pad: each arm's
//     carriageway out to its reach, joined by the kerb corners where
//     neighbouring arms part (R3'). The causeway mouths own no pad.
//   - straights fill ONLY the span between two pads along each edge,
//     n = round(span / 14) pieces, so the length stretch stays within a few
//     percent and no piece ever lies on another
// Native orientations (probed from the GLBs): the straight's length axis is
// local X; the T is closed on its north (-z) side; the bend joins west and
// south; the end cap opens east. A kit piece rotated by ry turns every
// heading by +ry (heading = atan2(x, z)).
import { ROUNDABOUT_REACH, ROAD_HALF, polePoints, type CityPlan, type PNode, type PEdge } from './cityPlan.js';

export { ROUNDABOUT_REACH };
export const ROAD_TILE = 14;

export type PieceKind = 'cross' | 'tee' | 'bend' | 'end' | 'pass' | 'round' | 'straight' | 'pad';

export interface RoadPiece {
  kind: PieceKind;
  /** city-local centre */
  x: number;
  z: number;
  ry: number;
  /** extent along the piece's local X (length axis) and Z, metres */
  lx: number;
  lz: number;
  /** junction pads of signalized nodes carry crosswalks */
  crosswalks: boolean;
  /** a polygon pad's outline (city-local), counter-clockwise in heading */
  poly?: Array<{ x: number; z: number }>;
}

type V = { x: number; z: number };
const hdg = (v: V): number => Math.atan2(v.x, v.z);

/** unit direction of edge e leaving node n */
export function armDir(plan: CityPlan, n: PNode, e: PEdge): V {
  return e.a === n.id ? { x: e.ux, z: e.uz } : { x: -e.ux, z: -e.uz };
}

/** how far node n's pad reaches up edge e */
export function nodeReach(plan: CityPlan, n: PNode, e: PEdge): number {
  if (n.mouth) return 0;
  const i = n.edges.indexOf(e.id);
  return n.reach[i] ?? ROAD_HALF;
}

/** the pad a node owns, or null (a causeway mouth) */
export function nodePiece(plan: CityPlan, n: PNode): RoadPiece | null {
  if (n.mouth || !n.edges.length) return null;
  const arms = n.edges.map(id => armDir(plan, n, plan.edges[id]));
  const pad = (kind: PieceKind, ry: number, size = ROAD_TILE): RoadPiece =>
    ({ kind, x: n.x, z: n.z, ry, lx: size, lz: size, crosswalks: n.signalized });
  if (n.plaza) return pad('round', hdg(arms[0]) - Math.PI / 2, ROUNDABOUT_REACH * 2);
  if (n.square) {
    const k = arms.length;
    if (k === 4) return pad('cross', hdg(arms[0]) - Math.PI / 2);
    if (k === 1) return pad('end', hdg(arms[0]) - Math.PI / 2);
    if (k === 3) {
      // the missing arm: the one direction of the cross no arm takes
      const f = n.frame;
      const slots = [0, 1, 2, 3].map(q => ({ x: Math.sin(f + (q * Math.PI) / 2), z: Math.cos(f + (q * Math.PI) / 2) }));
      const miss = slots.find(sl => !arms.some(a => a.x * sl.x + a.z * sl.z > 0.9))!;
      return pad('tee', hdg(miss) - Math.PI);
    }
    // two arms: in line, or a right-angle bend
    if (arms[0].x * arms[1].x + arms[0].z * arms[1].z < -0.9) return pad('pass', hdg(arms[0]) - Math.PI / 2);
    return pad('bend', hdg({ x: arms[0].x + arms[1].x, z: arms[0].z + arms[1].z }) + Math.PI / 4);
  }
  // an oblique node: the polygon of its arms' carriageways and kerb corners
  const reach = n.reach;
  const poly: V[] = [];
  const k = arms.length;
  for (let i = 0; i < k; i++) {
    const u = arms[i], r = reach[i];
    const side = { x: u.z, z: -u.x }; // toward the next arm (heading + 90)
    const end = { x: n.x + u.x * r, z: n.z + u.z * r };
    poly.push({ x: end.x - side.x * ROAD_HALF, z: end.z - side.z * ROAD_HALF });
    poly.push({ x: end.x + side.x * ROAD_HALF, z: end.z + side.z * ROAD_HALF });
    // the kerb corner toward the next arm (when the two kerbs meet)
    const v = arms[(i + 1) % k];
    let th = hdg(v) - hdg(u);
    while (th <= 0) th += Math.PI * 2;
    if (k > 1 && th < Math.PI - 1e-3) {
      const t = ROAD_HALF / Math.tan(th / 2);
      poly.push({ x: n.x + side.x * ROAD_HALF + u.x * t, z: n.z + side.z * ROAD_HALF + u.z * t });
    }
  }
  const maxR = Math.max(...reach);
  return { kind: 'pad', x: n.x, z: n.z, ry: 0, lx: maxR * 2, lz: maxR * 2, crosswalks: n.signalized, poly };
}

/** the straights filling one edge between its two node pads */
export function edgePieces(plan: CityPlan, e: PEdge): RoadPiece[] {
  const a = plan.nodes[e.a], b = plan.nodes[e.b];
  const s0 = nodeReach(plan, a, e), s1 = e.len - nodeReach(plan, b, e);
  const span = s1 - s0;
  if (span <= 0.01) return [];
  const n = Math.max(1, Math.round(span / ROAD_TILE));
  const len = span / n;
  const out: RoadPiece[] = [];
  for (let q = 0; q < n; q++) {
    const s = s0 + (q + 0.5) * len;
    out.push({ kind: 'straight', x: a.x + e.ux * s, z: a.z + e.uz * s, ry: e.heading - Math.PI / 2, lx: len, lz: ROAD_TILE, crosswalks: false });
  }
  return out;
}

/** every piece of the city */
export function cityRoadPieces(plan: CityPlan): RoadPiece[] {
  const out: RoadPiece[] = [];
  for (const n of plan.nodes) {
    const p = nodePiece(plan, n);
    if (p) out.push(p);
  }
  for (const e of plan.edges) out.push(...edgePieces(plan, e));
  return out;
}

const chunkCache = new WeakMap<CityPlan, Map<string, RoadPiece[]>>();
/** the pieces chunk (cx, cz) lays: those whose centre falls inside it */
export function chunkRoadPieces(plan: CityPlan, cx: number, cz: number): RoadPiece[] {
  let m = chunkCache.get(plan);
  if (!m) {
    m = new Map();
    for (const p of cityRoadPieces(plan)) {
      const k = `${Math.floor(p.x / 64)},${Math.floor(p.z / 64)}`;
      if (!m.has(k)) m.set(k, []);
      m.get(k)!.push(p);
    }
    chunkCache.set(plan, m);
  }
  return m.get(`${cx},${cz}`) ?? [];
}

/** a piece's world outline: the rotated rectangle, or the pad polygon */
export function pieceOutline(p: RoadPiece): V[] {
  if (p.poly) return p.poly;
  // local X (length) turns to heading ry + pi/2, local Z to heading ry
  const ax = { x: Math.cos(p.ry), z: -Math.sin(p.ry) }, az = { x: Math.sin(p.ry), z: Math.cos(p.ry) };
  const hx = p.lx / 2, hz = p.lz / 2;
  return [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([sx, sz]) => ({
    x: p.x + ax.x * hx * sx + az.x * hz * sz,
    z: p.z + ax.z * hx * sx + az.z * hz * sz,
  }));
}

/**
 * The kit traffic-light poles around a signalized node: one per approach
 * arm, on the approaching driver's near-side right corner just off the pad
 * (8.6 m out, 1.6 m past the pad's reach up the arm). `ry` turns the kit
 * light's lamp face (native -x) toward the approaching traffic; `axis` is
 * the light phase the approach obeys.
 */
export function trafficPoles(plan: CityPlan, n: PNode): Array<{ x: number; z: number; ry: number; axis: 'ew' | 'ns' }> {
  return polePoints(plan.edges, n);
}
