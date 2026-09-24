// Road layout: which Kenney City Kit Roads piece goes where. Pure geometry
// (no three.js) so the chunk baker lays exactly these pieces and the audit can
// prove they never overlap (R35).
//
// The kit is a 1x1-unit tile set whose straight piece IS the full road cross
// section (kerb strip, gutter, asphalt, centre line), so every piece is laid
// at one uniform unit of ROAD_TILE = 14 m — the R5 carriageway:
//   - every street node owns a pad: crossroad (4 arms), T-piece (3), bend
//     (2 at a right angle), a straight (2 in line) or the 3x3 roundabout at
//     plazas; the four causeway mouths own nothing, their corridor runs
//     straight out to the rim
//   - straights fill ONLY the span between two node pads, n = round(span/14)
//     pieces, so the length stretch stays within a few percent and no piece
//     ever lies on top of another
// Native orientations (probed from the GLBs): the straight's length axis is
// local X; the T is closed on its north (-z) side; the bend joins west and
// south; the end cap opens east.
import { ROUNDABOUT_REACH, type CityPlan } from './cityPlan.js';
import { WORLD_CHUNKS } from './world.js';

export { ROUNDABOUT_REACH };
export const ROAD_TILE = 14;
const CH = 64;

export type PieceKind = 'cross' | 'tee' | 'bend' | 'end' | 'pass' | 'round' | 'straight';

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
}

/** kit traffic-light poles around a signalized node: one per approach, on the
 * approaching driver's near-side right corner, just off the junction pad
 * (8.6 m — inside every corner lot's 12 m setback). `ry` turns the kit
 * light's lamp face (native -x) toward the approaching traffic; `arm` is the
 * approach's [w, e, n, s] index and `axis` the light phase it shows. */
export const TRAFFIC_POLES: Array<[dx: number, dz: number, ry: number, arm: number, axis: 'ew' | 'ns']> = [
  [-8.6, 8.6, 0, 0, 'ew'],              // eastbound, arriving from the west
  [8.6, -8.6, Math.PI, 1, 'ew'],        // westbound, from the east
  [-8.6, -8.6, -Math.PI / 2, 2, 'ns'],  // southbound, from the north
  [8.6, 8.6, Math.PI / 2, 3, 'ns'],     // northbound, from the south
];

/** unfiltered [west, east, north, south] arms of lattice node (i, j) */
export function nodeArms(plan: CityPlan, i: number, j: number): [boolean, boolean, boolean, boolean] {
  return [plan.segH(j, i - 1), plan.segH(j, i), plan.segV(i, j - 1), plan.segV(i, j)];
}

function isMouth(plan: CityPlan, i: number, j: number): boolean {
  const e = plan.exits;
  return (i === e.n && j === 0) || (i === e.s && j === WORLD_CHUNKS)
    || (i === 0 && j === e.w) || (i === WORLD_CHUNKS && j === e.e);
}

/** the pad a node owns, or null (no street, or a causeway mouth) */
export function nodePiece(plan: CityPlan, i: number, j: number): RoadPiece | null {
  const a = nodeArms(plan, i, j);
  const n = a.filter(Boolean).length;
  if (n === 0 || isMouth(plan, i, j)) return null;
  const x = i * CH, z = j * CH;
  const pad = (kind: PieceKind, ry: number, size = ROAD_TILE): RoadPiece =>
    ({ kind, x, z, ry, lx: size, lz: size, crosswalks: plan.signalized(i, j) });
  if (plan.plaza(i, j)) return pad('round', 0, ROUNDABOUT_REACH * 2);
  if (n === 4) return pad('cross', 0);
  if (n === 3) {
    const miss = a.indexOf(false); // 0=w 1=e 2=n 3=s
    return pad('tee', miss === 2 ? 0 : miss === 3 ? Math.PI : miss === 1 ? -Math.PI / 2 : Math.PI / 2);
  }
  if (n === 2) {
    if (a[0] && a[1]) return pad('pass', 0);
    if (a[2] && a[3]) return pad('pass', Math.PI / 2);
    // bend: native joins west + south
    const ry = a[0] && a[3] ? 0 : a[1] && a[3] ? Math.PI / 2 : a[1] && a[2] ? Math.PI : -Math.PI / 2;
    return pad('bend', ry);
  }
  // a dead end (the dead-end trim leaves none inland, R1): native opens east
  const ry = a[1] ? 0 : a[0] ? Math.PI : a[2] ? Math.PI / 2 : -Math.PI / 2;
  return pad('end', ry);
}

/** how far a node's pad reaches along each of its arms */
export function nodeReach(plan: CityPlan, i: number, j: number): number {
  const p = nodePiece(plan, i, j);
  return p ? p.lx / 2 : 0;
}

/** the straights filling one open segment between its two node pads */
export function segmentPieces(plan: CityPlan, horiz: boolean, line: number, k: number): RoadPiece[] {
  const [ia, ja, ib, jb] = horiz ? [k, line, k + 1, line] : [line, k, line, k + 1];
  const ra = nodeReach(plan, ia, ja), rb = nodeReach(plan, ib, jb);
  const s0 = k * CH + ra, s1 = (k + 1) * CH - rb;
  const span = s1 - s0;
  if (span <= 0.01) return [];
  const n = Math.max(1, Math.round(span / ROAD_TILE));
  const len = span / n;
  const out: RoadPiece[] = [];
  for (let q = 0; q < n; q++) {
    const s = s0 + (q + 0.5) * len;
    out.push(horiz
      ? { kind: 'straight', x: s, z: line * CH, ry: 0, lx: len, lz: ROAD_TILE, crosswalks: false }
      : { kind: 'straight', x: line * CH, z: s, ry: Math.PI / 2, lx: len, lz: ROAD_TILE, crosswalks: false });
  }
  return out;
}

/** every piece chunk (cx, cz) lays: its SW node's pad plus the straights of
 * its south (horizontal) and west (vertical) segments */
export function chunkRoadPieces(plan: CityPlan, cx: number, cz: number): RoadPiece[] {
  const out: RoadPiece[] = [];
  const node = nodePiece(plan, cx, cz);
  if (node) out.push(node);
  if (plan.segH(cz, cx)) out.push(...segmentPieces(plan, true, cz, cx));
  if (plan.segV(cx, cz)) out.push(...segmentPieces(plan, false, cx, cz));
  return out;
}

/** every piece of the city, including rim nodes/segments no chunk owns */
export function cityRoadPieces(plan: CityPlan): RoadPiece[] {
  const out: RoadPiece[] = [];
  for (let i = 0; i <= WORLD_CHUNKS; i++) {
    for (let j = 0; j <= WORLD_CHUNKS; j++) {
      const node = nodePiece(plan, i, j);
      if (node) out.push(node);
      if (i < WORLD_CHUNKS && plan.segH(j, i)) out.push(...segmentPieces(plan, true, j, i));
      if (j < WORLD_CHUNKS && plan.segV(i, j)) out.push(...segmentPieces(plan, false, i, j));
    }
  }
  return out;
}

/** axis-aligned world footprint of a piece (all pieces sit at multiples of 90°) */
export function pieceRect(p: RoadPiece): { x1: number; x2: number; z1: number; z2: number } {
  const alongX = Math.abs(Math.cos(p.ry)) > 0.5;
  const hx = (alongX ? p.lx : p.lz) / 2, hz = (alongX ? p.lz : p.lx) / 2;
  return { x1: p.x - hx, x2: p.x + hx, z1: p.z - hz, z2: p.z + hz };
}
