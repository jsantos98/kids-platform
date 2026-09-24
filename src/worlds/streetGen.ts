// The street generator: a city that isn't a grid. Every island grows
//
//   - its four EXIT avenues, straight in from the causeway mouths;
//   - a coastal RING road of straight chords, ~58 m inside the shore;
//   - 3-5 PATCHES (Voronoi cells around seeded sites), each with its own
//     rotated lattice (0 / ±15 / ±30 / 45 degrees, 58-78 m spacing);
//   - SEAMS: the straight Voronoi boundaries between patches, boulevards
//     the patch streets meet at an angle.
//
// Pieces are inserted in that priority order into ONE planar graph, and
// every insertion keeps the network drivable and buildable (R34): arms at a
// node at least 55 degrees apart, every edge between junctions at least 32 m, no street within
// 15 m of another it doesn't meet, at most four arms per node. A piece that
// can't meet the rules at some crossing breaks there and carries on from the
// next crossing that works; the plan's dead-end trim tidies what's left.
//
// The river is respected at insertion: a street may cross it only within
// 25 degrees of square (the river is then straightened at that exact spot so
// the bridge meets it at a right angle, R26); anything shallower, or running
// along the water, is cut back around it.
//
// Edges are straight; curves happen only at nodes (the road layout's pads).
import { rng, chunkSeed } from '../engine/rng.js';
import { citySeed, southExit, eastExit } from './cityGrid.js';
import { coastFor, insetShore } from './coast.js';
import { baseRiverFor, type RiverRoute } from './riverRoute.js';
import { railNetFor, STEM } from './railRoute.js';
import { EXIT_IN } from './streetLines.js';
import { ISLAND, CENTER } from './world.js';

export type EdgeKind = 'exit' | 'ring' | 'river' | 'bridge' | 'railside' | 'railx' | 'seam' | 'street' | 'link';

export interface GNode {
  id: number;
  x: number;
  z: number;
  /** a causeway mouth on the rim (the only sanctioned dead end) */
  mouth: boolean;
  /** incident edge ids (alive edges only) */
  edges: number[];
}

export interface GEdge {
  id: number;
  a: number;
  b: number;
  kind: EdgeKind;
  alive: boolean;
}

export interface StreetNet {
  nodes: GNode[];
  /** alive edges only, ids renumbered 0.. */
  edges: GEdge[];
  /** where streets cross the river, with the street's heading — the river
   * is straightened square to the street at each */
  riverCrossings: Array<{ x: number; z: number; heading: number }>;
}

export const MIN_ANGLE = (55 * Math.PI) / 180;
export const MIN_EDGE = 32;
const CLEARANCE = 15;   // two streets that don't meet stay this far apart
const PAD_CLEAR = 20;   // and a junction this far from a street it doesn't meet (two kit pads' corners reach 10 m each)
const SNAP = 16;        // a crossing this close to a node joins it
const RING_INSET = 58;
const RIVER_OK = (25 * Math.PI) / 180;
/** the ring road and the exit avenues must get across: a bit more slack */
const RIVER_OK_TRUNK = (35 * Math.PI) / 180;
const RIVER_OK_LINK = (10 * Math.PI) / 180;

type P = { x: number; z: number };

const cache = new Map<string, StreetNet>();
export function clearStreetNetCache(): void { cache.clear(); }

/** city (bx, by)'s candidate street network (before the plan's vetoes) */
export function streetNetFor(bx: number, by: number): StreetNet {
  const key = `${bx},${by},${citySeed(bx, by)}`;
  let n = cache.get(key);
  if (!n) {
    n = generate(bx, by);
    cache.set(key, n);
    if (cache.size > 48) cache.delete(cache.keys().next().value as string);
  }
  return n;
}

// ---- small geometry ----
const dist = (a: P, b: P): number => Math.hypot(a.x - b.x, a.z - b.z);

/** distance from p to segment ab */
export function segDist(p: P, a: P, b: P): number {
  const abx = b.x - a.x, abz = b.z - a.z, L2 = abx * abx + abz * abz;
  const t = L2 > 1e-9 ? Math.max(0, Math.min(1, ((p.x - a.x) * abx + (p.z - a.z) * abz) / L2)) : 0;
  return Math.hypot(a.x + abx * t - p.x, a.z + abz * t - p.z);
}

function inPoly(p: P, poly: P[]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i], b = poly[j];
    if ((a.z > p.z) !== (b.z > p.z) && p.x < ((b.x - a.x) * (p.z - a.z)) / (b.z - a.z) + a.x) inside = !inside;
  }
  return inside;
}

/** the parts of segment ab inside polygon `poly` */
function clipToPoly(a: P, b: P, poly: P[]): Array<[P, P]> {
  const ts = [0, 1];
  for (let i = 0; i < poly.length; i++) {
    const p = poly[i], q = poly[(i + 1) % poly.length];
    const d1x = b.x - a.x, d1z = b.z - a.z, d2x = q.x - p.x, d2z = q.z - p.z;
    const den = d1x * d2z - d1z * d2x;
    if (Math.abs(den) < 1e-9) continue;
    const t = ((p.x - a.x) * d2z - (p.z - a.z) * d2x) / den;
    const s = ((p.x - a.x) * d1z - (p.z - a.z) * d1x) / den;
    if (t > 0 && t < 1 && s >= 0 && s <= 1) ts.push(t);
  }
  ts.sort((u, v) => u - v);
  const out: Array<[P, P]> = [];
  for (let k = 0; k + 1 < ts.length; k++) {
    const t0 = ts[k], t1 = ts[k + 1];
    if (t1 - t0 < 1e-6) continue;
    const m = { x: a.x + (b.x - a.x) * (t0 + t1) / 2, z: a.z + (b.z - a.z) * (t0 + t1) / 2 };
    if (!inPoly(m, poly)) continue;
    out.push([{ x: a.x + (b.x - a.x) * t0, z: a.z + (b.z - a.z) * t0 }, { x: a.x + (b.x - a.x) * t1, z: a.z + (b.z - a.z) * t1 }]);
  }
  // merge touching pieces
  const merged: Array<[P, P]> = [];
  for (const s of out) {
    const last = merged[merged.length - 1];
    if (last && dist(last[1], s[0]) < 1e-6) last[1] = s[1];
    else merged.push(s);
  }
  return merged;
}

/** open-polyline Douglas-Peucker, then chords at least `minChord` long */
function simplifyOpen(pts: P[], tol: number, minChord: number): P[] {
  const dp = (q: P[]): P[] => {
    if (q.length < 3) return q;
    let bi = 0, bd = 0;
    for (let i = 1; i < q.length - 1; i++) {
      const d = segDist(q[i], q[0], q[q.length - 1]);
      if (d > bd) { bd = d; bi = i; }
    }
    if (bd <= tol) return [q[0], q[q.length - 1]];
    return [...dp(q.slice(0, bi + 1)).slice(0, -1), ...dp(q.slice(bi))];
  };
  const out = dp(pts);
  for (let guard = 0; guard < 200 && out.length > 2; guard++) {
    let bi = -1, bl = minChord;
    for (let i = 0; i + 1 < out.length; i++) {
      const l = dist(out[i], out[i + 1]);
      if (l < bl) { bl = l; bi = i; }
    }
    if (bi < 0) break;
    out.splice(bi === out.length - 2 ? bi : bi + 1, 1);
  }
  return out;
}

/** convex polygon clipped to the half-plane (p - m) . n <= 0 */
function clipHalf(poly: P[], m: P, n: P): P[] {
  const out: P[] = [];
  const side = (p: P): number => (p.x - m.x) * n.x + (p.z - m.z) * n.z;
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i], b = poly[(i + 1) % poly.length];
    const sa = side(a), sb = side(b);
    if (sa <= 0) out.push(a);
    if ((sa < 0 && sb > 0) || (sa > 0 && sb < 0)) {
      const t = sa / (sa - sb);
      out.push({ x: a.x + (b.x - a.x) * t, z: a.z + (b.z - a.z) * t });
    }
  }
  return out;
}

/** closed-polygon Douglas-Peucker, then chords at least `minChord` long */
function simplify(poly: P[], tol: number, minChord: number): P[] {
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

export interface Builder {
  nodes: GNode[];
  edges: GEdge[];
  riverCrossings: StreetNet['riverCrossings'];
  /** insert a straight street piece under the rules (see the header) */
  insert(a: P, b: P, kind: EdgeKind, mouthStart?: boolean): number | null;
  /** insert, cut around the river where it cannot cross it square */
  insertDry(a: P, b: P, kind: EdgeKind, mouthStart?: boolean): number | null;
  /** a chain of straight pieces, each starting where the last one really
   * ended (a tail too short to lay stops at its last junction, and the next
   * piece carries on from there instead of a free point beside it) */
  insertPolyline(pts: P[], kind: EdgeKind, closed?: boolean): void;
  /** link stranded pieces and exits to the main web with straight links */
  linkUp(): void;
  /** the network so far: alive edges, renumbered */
  result(): StreetNet;
}

/** a network under construction, with every rule of the header. `extraOk`
 * is one more veto on each new edge (the plan uses it for the railway). */
export function makeBuilder(
  river: RiverRoute,
  nearTrestle: (x: number, z: number) => boolean = () => false,
  extraOk: ((a: P, b: P, kind: EdgeKind | 'split') => boolean) | null = null,
  seed?: { nodes: GNode[]; edges: GEdge[] },
  /** pieces of a -> b worth trying (the railway's cuts), before the river's */
  preCut: (a: P, b: P, kind: EdgeKind) => Array<[P, P]> = (a, b) => [[a, b]],
): Builder {
  const nodes: GNode[] = seed ? seed.nodes.map(n => ({ ...n, edges: [...n.edges] })) : [];
  const edges: GEdge[] = seed ? seed.edges.map(e => ({ ...e })) : [];
  const riverCrossings: StreetNet['riverCrossings'] = [];

  const newNode = (p: P, mouth = false): number => {
    nodes.push({ id: nodes.length, x: p.x, z: p.z, mouth, edges: [] });
    return nodes.length - 1;
  };
  const addEdge = (a: number, b: number, kind: EdgeKind): void => {
    const e: GEdge = { id: edges.length, a, b, kind, alive: true };
    edges.push(e);
    nodes[a].edges.push(e.id);
    nodes[b].edges.push(e.id);
  };
  const detach = (e: GEdge): void => {
    e.alive = false;
    for (const n of [nodes[e.a], nodes[e.b]]) n.edges = n.edges.filter(id => id !== e.id);
  };
  /** split edge e at point p (on it): returns the new node */
  const split = (e: GEdge, p: P): number => {
    const id = newNode(p);
    detach(e);
    addEdge(e.a, id, e.kind);
    addEdge(id, e.b, e.kind);
    return id;
  };
  const dirOf = (a: P, b: P): P => { const l = dist(a, b) || 1; return { x: (b.x - a.x) / l, z: (b.z - a.z) / l }; };
  const angle = (u: P, v: P): number => Math.acos(Math.max(-1, Math.min(1, u.x * v.x + u.z * v.z)));
  /** can node n take one more arm heading `d`? */
  const armOk = (n: number, d: P): boolean => {
    const nd = nodes[n];
    if (nd.mouth ? nd.edges.length >= 1 : nd.edges.length >= 4) return false;
    // a short stub (allowed out to a free end) may not become a street
    // between two junctions: no new arm where it would
    for (const eid of nd.edges) {
      const e = edges[eid];
      const o = nodes[e.a === n ? e.b : e.a];
      if (dist(nd, o) < MIN_EDGE - 0.5 && (o.edges.length >= 2 || o.mouth)) return false;
    }
    for (const eid of nd.edges) {
      const e = edges[eid];
      const o = nodes[e.a === n ? e.b : e.a];
      if (angle(d, dirOf(nd, o)) < MIN_ANGLE) return false;
    }
    return true;
  };
  /** an edge as actually built (snaps bend it off its line) stays
   * CLEARANCE from every street neither of its ends touches */
  const clearEdge = (pId: number, qq: P, qId: number | null, splitEdge: number | null = null): boolean => {
    const pp = nodes[pId];
    const L = dist(pp, qq);
    const touch = new Set<number>([...nodes[pId].edges, ...(qId !== null ? nodes[qId].edges : [])]);
    if (splitEdge !== null) touch.add(splitEdge);
    for (let s = 12; s <= L - 12; s += 3) {
      const x = { x: pp.x + ((qq.x - pp.x) * s) / L, z: pp.z + ((qq.z - pp.z) * s) / L };
      for (const e of edges) {
        if (!e.alive || touch.has(e.id)) continue;
        if (segDist(x, nodes[e.a], nodes[e.b]) < CLEARANCE) return false;
      }
    }
    // junction pads reach ~10 m from their node (a kit pad's corner): every
    // junction keeps PAD_CLEAR from streets it doesn't meet, both ways
    const near = new Set<number>([pId, ...(qId !== null ? [qId] : [])]);
    for (const id of touch) { const e = edges[id]; near.add(e.a); near.add(e.b); }
    for (const nd of nodes) {
      if (near.has(nd.id) || !nd.edges.length || nd.mouth) continue;
      if (segDist(nd, pp, qq) < PAD_CLEAR) return false;
    }
    for (const end of [pp, qq]) {
      for (const e of edges) {
        if (!e.alive || touch.has(e.id)) continue;
        if (segDist(end, nodes[e.a], nodes[e.b]) < PAD_CLEAR) return false;
      }
    }
    return true;
  };

  interface Ev { t: number; x: number; z: number; node?: number; edge?: number; s?: number }
  /** insert straight segment a -> b into the network (see the header) */
  const insert = (a: P, b: P, kind: EdgeKind, mouthStart = false): number | null => {
    const L = dist(a, b);
    if (L < 1) return null;
    const u = dirOf(a, b);
    const tolT = 0.6 / L;
    let endNode: number | null = null;
    // ---- where it meets the network ----
    const evs: Ev[] = [];
    for (const e of edges) {
      if (!e.alive) continue;
      const p = nodes[e.a], q = nodes[e.b];
      const d2x = q.x - p.x, d2z = q.z - p.z;
      const lenE = Math.hypot(d2x, d2z);
      const den = (b.x - a.x) * d2z - (b.z - a.z) * d2x;
      if (Math.abs(den) < 1e-9) continue;
      const t = ((p.x - a.x) * d2z - (p.z - a.z) * d2x) / den;
      const s = ((p.x - a.x) * (b.z - a.z) - (p.z - a.z) * (b.x - a.x)) / den;
      if (t < -tolT || t > 1 + tolT || s < -0.6 / lenE || s > 1 + 0.6 / lenE) continue;
      const tc = Math.max(0, Math.min(1, t));
      const x = a.x + (b.x - a.x) * tc, z = a.z + (b.z - a.z) * tc;
      const dp = s * lenE, dq = (1 - s) * lenE;
      if (dp < SNAP) evs.push({ t: tc, x: p.x, z: p.z, node: e.a });
      else if (dq < SNAP) evs.push({ t: tc, x: q.x, z: q.z, node: e.b });
      else evs.push({ t: tc, x, z, edge: e.id, s });
    }
    evs.sort((p, q) => p.t - q.t);
    const uniq: Ev[] = [];
    for (const ev of evs) {
      const last = uniq[uniq.length - 1];
      if (last && ((ev.node !== undefined && ev.node === last.node) || Math.hypot(ev.x - last.x, ev.z - last.z) < 1)) continue;
      uniq.push(ev);
    }
    // ---- where it may be built: CLEARANCE from every street it doesn't
    // cross squarely (near a good crossing the closeness is the crossing) ----
    const STEP = 2;
    const n = Math.max(1, Math.ceil(L / STEP));
    const blocked: boolean[] = new Array(n + 1).fill(false);
    const allow = new Map<number, Array<[number, number]>>(); // edge id -> [s0, s1] windows along S
    for (const ev of uniq) {
      if (ev.node !== undefined) {
        // at a node the question is the ARM angle: the new street's arms
        // (back along it, and on along it) against each existing arm
        const nd = nodes[ev.node];
        const mine: P[] = [];
        if (ev.t > tolT) mine.push({ x: -u.x, z: -u.z });
        if (ev.t < 1 - tolT) mine.push(u);
        for (const eid of nd.edges) {
          const e = edges[eid];
          const arm = dirOf(nd, nodes[e.a === nd.id ? e.b : e.a]);
          const phi = Math.min(...mine.map(m => angle(m, arm)));
          if (phi < MIN_ANGLE - 1e-6) continue; // too tight: no allowance
          const w = (phi < Math.PI / 2 ? CLEARANCE / Math.sin(phi) : CLEARANCE) + SNAP;
          if (!allow.has(eid)) allow.set(eid, []);
          allow.get(eid)!.push([ev.t * L - w, ev.t * L + w]);
        }
        continue;
      }
      const e = edges[ev.edge!];
      const cr = angle(u, dirOf(nodes[e.a], nodes[e.b]));
      const sn = Math.sin(cr);
      if (sn < Math.sin(MIN_ANGLE) - 1e-6) continue; // shallow: no allowance
      const w = CLEARANCE / sn + 2;
      if (!allow.has(e.id)) allow.set(e.id, []);
      allow.get(e.id)!.push([ev.t * L - w, ev.t * L + w]);
    }
    for (let k = 0; k <= n; k++) {
      const sk = (k / n) * L;
      const x = { x: a.x + u.x * sk, z: a.z + u.z * sk };
      for (const e of edges) {
        if (!e.alive) continue;
        if (segDist(x, nodes[e.a], nodes[e.b]) >= CLEARANCE) continue;
        if ((allow.get(e.id) ?? []).some(([w0, w1]) => sk >= w0 && sk <= w1)) continue;
        blocked[k] = true;
        break;
      }
    }
    const intervals: Array<[number, number]> = [];
    for (let k = 0; k <= n;) {
      if (blocked[k]) { k++; continue; }
      let e = k;
      while (e + 1 <= n && !blocked[e + 1]) e++;
      const s0 = k === 0 ? 0 : ((k + 1) / n) * L, s1 = e === n ? L : ((e - 1) / n) * L;
      if (s1 - s0 >= 1) intervals.push([s0, s1]);
      k = e + 1;
    }
    /** make an event a node of the network (split an edge), if the rules allow */
    const resolve = (ev: Ev, inDir: P | null, outDir: P | null): number | null => {
      if (ev.node !== undefined) {
        if (inDir && !armOk(ev.node, inDir)) return null;
        if (outDir && !armOk(ev.node, outDir)) return null;
        if (inDir && outDir && nodes[ev.node].edges.length >= 3) return null;
        return ev.node;
      }
      const e = edges[ev.edge!];
      if (!e.alive) return null;
      const p = nodes[e.a], q = nodes[e.b];
      const lenE = dist(p, q);
      // a short piece is only a problem between two junctions: a stub out to
      // a free end is trimmed away with the dead ends anyway
      const free = (id: number): boolean => nodes[id].edges.length === 1 && !nodes[id].mouth;
      if ((ev.s! * lenE < MIN_EDGE && !free(e.a)) || ((1 - ev.s!) * lenE < MIN_EDGE && !free(e.b))) return null;
      // the arms it really adds: back toward where the chain came from (a
      // snapped node can sit off the line) and on along the line
      const ed = dirOf(p, q);
      for (const d of [inDir, outDir ?? (inDir ? null : u)]) {
        if (!d) continue;
        const cross = angle(d, ed);
        if (cross < MIN_ANGLE || cross > Math.PI - MIN_ANGLE) return null;
      }
      // both halves of a split edge must still pass the extra rule (a new
      // node may not land hard by a rail crossing)
      // (an exit avenue is exempt, as ever: the rail squares itself to it and
      // its crossings are recorded whatever junction stands beside them)
      const sk = e.kind === 'exit' ? 'exit' : 'split';
      if (extraOk && (!extraOk(p, ev, sk) || !extraOk(ev, q, sk))) return null;
      return split(e, ev);
    };
    const pointAt = (sk: number): P => ({ x: a.x + u.x * sk, z: a.z + u.z * sk });
    for (const [s0, s1] of intervals) {
      const inner = uniq.filter(ev => ev.t * L >= s0 - 1 && ev.t * L <= s1 + 1);
      let cur: number | null = null;
      if (!inner.length || inner[0].t * L > s0 + 1) cur = newNode(pointAt(s0), mouthStart && s0 === 0);
      for (let k = 0; k < inner.length; k++) {
        const ev = inner[k];
        const pt: P = ev.node !== undefined ? nodes[ev.node] : ev;
        const next = inner[k + 1];
        const hasOut = !!next || s1 - ev.t * L >= MIN_EDGE;
        if (cur !== null) {
          const len = dist(nodes[cur], pt);
          if (len < 1) continue;
          const d = dirOf(nodes[cur], pt);
          if (len >= MIN_EDGE && armOk(cur, d) && (!extraOk || extraOk(nodes[cur], pt, kind))
            && clearEdge(cur, pt, ev.node ?? null, ev.edge ?? null)) {
            const nid = resolve(ev, { x: -d.x, z: -d.z }, null);
            if (nid !== null && nid !== cur) { addEdge(cur, nid, kind); cur = nid; continue; }
          }
          cur = null; // the chain breaks here ...
        }
        // ... and restarts at the first crossing that can start it — or, when
        // it can't join the network there, from a free end 16 m further on
        // (the next crossings still pick the street up; the plan's dead-end
        // trim tidies the stub)
        if (hasOut) cur = resolve(ev, null, u);
        if (cur === null && hasOut) {
          const fs = ev.t * L + 16;
          const lim = next ? next.t * L : s1;
          if (lim - fs >= MIN_EDGE || (!next && s1 - fs >= MIN_EDGE)) cur = newNode(pointAt(fs));
        }
      }
      // a free tail to the end of the interval (a stub the trim removes,
      // unless a later piece meets it)
      const last = inner[inner.length - 1];
      const joinedEnd = last && last.t * L > s1 - 1 && cur !== null && (last.node === cur || (nodes[cur].x === last.x && nodes[cur].z === last.z));
      if (cur !== null && !joinedEnd) {
        const tail = pointAt(s1);
        if (dist(nodes[cur], tail) >= MIN_EDGE && armOk(cur, dirOf(nodes[cur], tail)) && (!extraOk || extraOk(nodes[cur], tail, kind))) {
          const tn = newNode(tail);
          addEdge(cur, tn, kind);
          cur = tn;
        }
      }
      // where this piece really ended, if that is near its far end
      if (s1 > L - 1 && cur !== null && dist(nodes[cur], b) < MIN_EDGE) endNode = cur;
    }
    return endNode;
  };

  /** the network as the plan's dead-end trim will leave it: component id
   * per node (-1 = trimmed away) and component sizes in edges */
  const skeleton = (): { comp: Map<number, number>; sizes: Map<number, number> } => {
    const alive = new Set(edges.filter(e => e.alive).map(e => e.id));
    const deg = (n: number): number => nodes[n].edges.filter(id => alive.has(id)).length;
    for (let changed = true; changed;) {
      changed = false;
      for (const nd of nodes) {
        if (nd.mouth || deg(nd.id) !== 1) continue;
        for (const id of nd.edges) if (alive.has(id)) { alive.delete(id); changed = true; }
      }
    }
    const comp = new Map<number, number>(), sizes = new Map<number, number>();
    let c = 0;
    for (const nd of nodes) {
      if (comp.has(nd.id) || deg(nd.id) === 0) continue;
      const stack = [nd.id];
      comp.set(nd.id, c);
      let n = 0;
      while (stack.length) {
        const cur = stack.pop()!;
        for (const id of nodes[cur].edges) {
          if (!alive.has(id)) continue;
          n++;
          const e = edges[id];
          const o = e.a === cur ? e.b : e.a;
          if (!comp.has(o)) { comp.set(o, c); stack.push(o); }
        }
      }
      sizes.set(c, n / 2);
      c++;
    }
    return { comp, sizes };
  };

  const linkUp = (): void => {
    for (let round = 0; round < 12; round++) {
      const { comp, sizes } = skeleton();
      let main = -1, best = -1;
      for (const [c, n] of sizes) if (n > best) { best = n; main = c; }
      if (main < 0) return;
      // an exit whose corridor never reached the web counts as stranded too
      // (its whole avenue would be trimmed): it links from its inner end
      const strandedExit = nodes.filter(nd => nd.mouth && nd.edges.length === 1 && comp.get(nd.id) !== main);
      const pieces = [...sizes].filter(([c, n]) => c !== main && n >= 3).map(([c]) => c);
      if (!strandedExit.length && !pieces.length) return;
      let linked = false;
      const tryLink = (from: number[]): boolean => {
        const targets = nodes.filter(nd => comp.get(nd.id) === main && nd.edges.length < 4 && !nd.mouth).map(nd => nd.id);
        const pairs: Array<[number, number, number]> = [];
        for (const f of from) for (const t of targets) {
          const d = dist(nodes[f], nodes[t]);
          if (d >= MIN_EDGE && d < 260) pairs.push([d, f, t]);
        }
        pairs.sort((p, q) => p[0] - q[0]);
        for (const [, f, t] of pairs.slice(0, 10)) {
          const before = edges.length;
          insertDry(nodes[f], nodes[t], 'link');
          if (edges.length === before) continue;
          const after = skeleton();
          if (after.comp.get(f) !== undefined && after.comp.get(f) === after.comp.get(t)) return true;
        }
        return false;
      };
      for (const m of strandedExit) {
        // the avenue's far end, walking in from the mouth
        let cur = m.id, prev = -1;
        for (let g = 0; g < 8; g++) {
          const nx = nodes[cur].edges.map(id => edges[id]).map(e => (e.a === cur ? e.b : e.a)).find(o => o !== prev);
          if (nx === undefined) break;
          prev = cur; cur = nx;
          if (nodes[cur].edges.length !== 2) break;
        }
        if (tryLink([cur])) linked = true;
      }
      for (const c of pieces) {
        const own = nodes.filter(nd => comp.get(nd.id) === c).map(nd => nd.id);
        if (tryLink(own)) linked = true;
      }
      if (!linked) return;
    }
  };

  /** insert a street piece, cut around the river where it can't cross it
   * square (and noting the crossings it keeps) */
  const insertDry = (a: P, b: P, kind: EdgeKind, mouthStart = false): number | null => {
    let end: number | null = null;
    // (a late link isn't there when the river is straightened: it must
    // already cross square)
    const tol = kind === 'ring' || kind === 'exit' ? RIVER_OK_TRUNK : kind === 'link' ? RIVER_OK_LINK : RIVER_OK;
    for (const [p0, q0] of preCut(a, b, kind)) {
      for (const [p, q] of riverCut(river, p0, q0, riverCrossings, tol, nearTrestle)) {
        const e = insert(p, q, kind, mouthStart && dist(p, a) < 1e-6);
        end = dist(q, b) < 1e-6 ? e : null;
      }
    }
    return end;
  };
  const insertPolyline = (pts: P[], kind: EdgeKind, closed = false): void => {
    const n = closed ? pts.length : pts.length - 1;
    let from: number | null = null;
    for (let i = 0; i < n; i++) {
      const a = from !== null ? nodes[from] : pts[i];
      const b = pts[(i + 1) % pts.length];
      if (dist(a, b) < 1) continue;
      from = insertDry(a, b, kind);
    }
  };

  const result = (): StreetNet => {
    // renumber: alive edges only, drop orphan nodes
    const alive = edges.filter(e => e.alive);
    const used = new Set<number>();
    for (const e of alive) { used.add(e.a); used.add(e.b); }
    const remap = new Map<number, number>();
    const outNodes: GNode[] = [];
    for (const n of nodes) {
      if (!used.has(n.id)) continue;
      remap.set(n.id, outNodes.length);
      outNodes.push({ id: outNodes.length, x: n.x, z: n.z, mouth: n.mouth, edges: [] });
    }
    const outEdges: GEdge[] = alive.map((e, k) => {
      const ne: GEdge = { id: k, a: remap.get(e.a)!, b: remap.get(e.b)!, kind: e.kind, alive: true };
      outNodes[ne.a].edges.push(k);
      outNodes[ne.b].edges.push(k);
      return ne;
    });
    return { nodes: outNodes, edges: outEdges, riverCrossings };
  };
  return { nodes, edges, riverCrossings, insert, insertDry, insertPolyline, linkUp, result };
}

function generate(bx: number, by: number): StreetNet {
  const seed = citySeed(bx, by);
  const r = rng(chunkSeed(seed, 0x57e, 1));
  const coast = coastFor(bx, by);
  const river = baseRiverFor(bx, by);
  // the railway is laid first (railRoute.ts, against the causeway avenues
  // and the river only); every street is laid around it: it crosses the
  // track at 70 degrees or better, at least 18 m from any junction, never
  // runs alongside it, keeps clear of the diamond and of the trestles
  const rail = railNetFor(bx, by);
  const spans: Array<[P, P]> = [];
  for (const L of rail.lines) for (let k = 0; k + 1 < L.pts.length; k++) spans.push([L.pts[k], L.pts[k + 1]]);
  const trestles: P[] = [];
  for (const [a, b] of spans) {
    const m = { x: (a.x + b.x) / 2, z: (a.z + b.z) / 2 };
    if (river.near(m.x, m.z, river.halfAt(m.x, m.z) + 4)) trestles.push(m);
  }
  const nearTrestle = (x: number, z: number): boolean => trestles.some(t => Math.hypot(t.x - x, t.z - z) < 30);
  const D = rail.diamond;
  const railOk = (p: P, q: P, kind: EdgeKind | 'split'): boolean => {
    if (kind === 'exit') return true; // the rail squares itself to the avenues
    const len = dist(p, q);
    const ux = (q.x - p.x) / len, uz = (q.z - p.z) / len;
    if (segDist(D, p, q) < 25) return false;
    for (const [a, b] of spans) {
      const d1x = b.x - a.x, d1z = b.z - a.z, d2x = q.x - p.x, d2z = q.z - p.z;
      const den = d1x * d2z - d1z * d2x;
      if (Math.abs(den) < 1e-9) continue;
      const t = ((p.x - a.x) * d2z - (p.z - a.z) * d2x) / den;
      const sn = ((p.x - a.x) * d1z - (p.z - a.z) * d1x) / den;
      if (t < 0 || t > 1 || sn < 0 || sn > 1) continue;
      if (sn * len < 18 || sn * len > len - 18) return false;
      const cos = Math.abs((d1x * ux + d1z * uz) / (Math.hypot(d1x, d1z) || 1));
      if (cos > Math.cos((74 * Math.PI) / 180)) return false;
      // and square all across the asphalt: the rail's worst heading while on
      // the carriageway within ±24 m of the crossing (a trestle's pin can
      // leave a kink just beside it) — the R7 audit reads the same window
      const cx = p.x + d2x * sn, cz = p.z + d2z * sn;
      for (const L of rail.lines) {
        for (const rp of L.pts) {
          const ax = rp.x - cx, az = rp.z - cz;
          if (Math.abs(ax * uz - az * ux) >= 6.5 || Math.abs(ax * ux + az * uz) >= 24) continue;
          const c2 = Math.abs(Math.sin(rp.h) * ux + Math.cos(rp.h) * uz);
          if (c2 > Math.cos((68 * Math.PI) / 180)) return false;
        }
      }
    }
    for (let t = 0; t <= len; t += 4) {
      const x = p.x + ux * t, z = p.z + uz * t;
      if (rail.distTo(x, z) < 12) {
        let dev = Math.abs(rail.headingAt(x, z) - Math.atan2(ux, uz)) % Math.PI;
        if (dev > Math.PI / 2) dev = Math.PI - dev;
        if (dev < (60 * Math.PI) / 180) return false;
      }
    }
    return true;
  };
  /** cut a street piece around every place it would meet the track badly:
   * a crossing shallower than 70 degrees, a stretch alongside it, the
   * diamond — the rest is tried piece by piece */
  const railCut = (a: P, b: P, kind: EdgeKind): Array<[P, P]> => {
    if (kind === 'exit') return [[a, b]];
    const L = dist(a, b);
    const n = Math.max(1, Math.ceil(L / 2));
    const at = (k: number): P => ({ x: a.x + ((b.x - a.x) * k) / n, z: a.z + ((b.z - a.z) * k) / n });
    const hS = Math.atan2(b.x - a.x, b.z - a.z);
    const bad: boolean[] = [];
    for (let k = 0; k <= n; k++) {
      const p = at(k);
      if (dist(p, D) < 28) { bad.push(true); continue; }
      const d = rail.distTo(p.x, p.z);
      if (d >= 14) { bad.push(false); continue; }
      let dev = Math.abs(rail.headingAt(p.x, p.z) - hS) % Math.PI;
      if (dev > Math.PI / 2) dev = Math.PI - dev; // 0 = alongside, pi/2 = square
      bad.push(dev < (74 * Math.PI) / 180);
    }
    const out: Array<[P, P]> = [];
    let k0 = -1;
    for (let k = 0; k <= n + 1; k++) {
      const ok = k <= n && !bad[k];
      if (ok && k0 < 0) k0 = k;
      if (!ok && k0 >= 0) {
        const k1 = k - 1;
        const p = k0 === 0 ? a : at(Math.min(n, k0 + 3)), q = k1 === n ? b : at(Math.max(0, k1 - 3));
        if (dist(p, q) >= MIN_EDGE * 0.5) out.push([p, q]);
        k0 = -1;
      }
    }
    return out;
  };
  const B = makeBuilder(river, nearTrestle, railOk, undefined, railCut);
  const { nodes, insertDry, insertPolyline } = B;
  // ---- 1. exit avenues: straight in from each causeway mouth ----
  const exN = southExit(bx, by - 1) * 64, exS = southExit(bx, by) * 64;
  const exW = eastExit(bx - 1, by) * 64, exE = eastExit(bx, by) * 64;
  insertDry({ x: exN, z: 0 }, { x: exN, z: EXIT_IN }, 'exit', true);
  insertDry({ x: exS, z: ISLAND }, { x: exS, z: ISLAND - EXIT_IN }, 'exit', true);
  insertDry({ x: 0, z: exW }, { x: EXIT_IN, z: exW }, 'exit', true);
  insertDry({ x: ISLAND, z: exE }, { x: ISLAND - EXIT_IN, z: exE }, 'exit', true);

  // ---- 2. the coastal ring road: chords ~58 m inside the shore, crossing
  // the river on a dead-square stretch ----
  const ringPoly = simplify(insetShore(coast, RING_INSET), 7, 70);
  const normalAt = (p: P): { c: P; n: P } => {
    const near = river.path.nearest(p.x, p.z);
    const h = river.pts[near.i].h;
    return { c: near.p, n: { x: Math.cos(h), z: -Math.sin(h) } };
  };
  const ring: P[] = [];
  /** the square crossings' own points, which the tidy-up must keep */
  const pinned = new Set<P>();
  for (let i = 0; i < ringPoly.length; i++) {
    const a = ringPoly[i], b = ringPoly[(i + 1) % ringPoly.length];
    ring.push(a);
    // where this chord meets the river, splice in a square crossing
    const L = dist(a, b);
    for (let t = 0; t <= L; t += 2) {
      const p = { x: a.x + ((b.x - a.x) * t) / L, z: a.z + ((b.z - a.z) * t) / L };
      if (river.distTo(p.x, p.z) > 2) continue;
      const { c, n } = normalAt(p);
      const side = Math.sign((a.x - c.x) * n.x + (a.z - c.z) * n.z) || 1;
      const r1 = { x: c.x + n.x * 48 * side, z: c.z + n.z * 48 * side }, r2 = { x: c.x - n.x * 48 * side, z: c.z - n.z * 48 * side };
      ring.push(r1, r2);
      pinned.add(r1); pinned.add(r2);
      break;
    }
  }
  // ... and crossing each railway line dead square too (at the portals the
  // ring bends round the headland, the track runs straight out)
  for (const L of rail.lines) {
    for (let i = 0; i < ring.length; i++) {
      const a = ring[i], b = ring[(i + 1) % ring.length];
      let hit: { x: number; z: number; h: number } | null = null;
      for (let k = 0; k + 1 < L.pts.length && !hit; k++) {
        const p = L.pts[k], q = L.pts[k + 1];
        const d1x = b.x - a.x, d1z = b.z - a.z, d2x = q.x - p.x, d2z = q.z - p.z;
        const den = d1x * d2z - d1z * d2x;
        if (Math.abs(den) < 1e-9) continue;
        const t = ((p.x - a.x) * d2z - (p.z - a.z) * d2x) / den;
        const sn = ((p.x - a.x) * d1z - (p.z - a.z) * d1x) / den;
        if (t > 0 && t < 1 && sn >= 0 && sn <= 1) hit = { x: a.x + d1x * t, z: a.z + d1z * t, h: p.h };
      }
      if (!hit) continue;
      const n = { x: Math.cos(hit.h), z: -Math.sin(hit.h) };
      const side = Math.sign((a.x - hit.x) * n.x + (a.z - hit.z) * n.z) || 1;
      const c1 = { x: hit.x + n.x * 60 * side, z: hit.z + n.z * 60 * side }, c2 = { x: hit.x - n.x * 60 * side, z: hit.z - n.z * 60 * side };
      pinned.add(c1); pinned.add(c2);
      ring.splice(i + 1, 0, c1, c2);
      // vertices inside the new square stretch would fold the ring back
      const X = hit;
      const drop = (k: number): boolean => dist(ring[k], X) < 62 && ring[k] !== c1 && ring[k] !== c2;
      while (ring.length > 6 && drop((ring.indexOf(c1) - 1 + ring.length) % ring.length)) ring.splice((ring.indexOf(c1) - 1 + ring.length) % ring.length, 1);
      while (ring.length > 6 && drop((ring.indexOf(c2) + 1) % ring.length)) ring.splice((ring.indexOf(c2) + 1) % ring.length, 1);
      i = ring.indexOf(c2);
    }
  }
  // no chord may come out shorter than a street: vertices crowding a spliced
  // river crossing go (the crossing's own two points stay)
  for (let guard = 0; guard < 64; guard++) {
    let bi = -1;
    for (let i = 0; i < ring.length; i++) {
      const b = ring[(i + 1) % ring.length];
      if (dist(ring[i], b) < 50 && !(pinned.has(ring[i]) && pinned.has(b))) { bi = i; break; }
    }
    if (bi < 0 || ring.length <= 6) break;
    // drop whichever end of the short chord is not part of a river splice
    const a = ring[bi], b = ring[(bi + 1) % ring.length];
    const spliced = (p: P): boolean => pinned.has(p);
    ring.splice(spliced(a) && !spliced(b) ? (bi + 1) % ring.length : bi, 1);
  }
  insertPolyline(ring, 'ring', true);
  // the patches live inside the ring
  const inner = ring;

  // ---- 2b. the river valley: an embankment road 34 m either side of the
  // water (patch streets T into it), and square bridges every ~170 m ----
  for (const side of [-1, 1]) {
    const off: P[] = [];
    for (let k = 0; k < river.pts.length; k += 3) {
      const p = river.pts[k];
      off.push({ x: p.x + Math.cos(p.h) * 34 * side, z: p.z - Math.sin(p.h) * 34 * side });
    }
    const chords = simplifyOpen(off, 3, 45);
    for (let k = 0; k + 1 < chords.length; k++) {
      for (const [p, q] of clipToPoly(chords[k], chords[k + 1], inner)) insertDry(p, q, 'river');
    }
  }
  {
    const cum: number[] = [0];
    for (let k = 1; k < river.pts.length; k++) cum.push(cum[k - 1] + dist(river.pts[k - 1], river.pts[k]));
    const start = 60 + r() * 80;
    for (let d = start; d < cum[cum.length - 1]; d += 150 + r() * 60) {
      let k = 0;
      while (k + 1 < cum.length && cum[k + 1] < d) k++;
      const c = river.pts[k];
      if (!inPoly(c, inner) || !coast.inLand(c.x, c.z, RING_INSET + 50) || nearTrestle(c.x, c.z)) continue;
      const n = { x: Math.cos(c.h), z: -Math.sin(c.h) };
      insertDry({ x: c.x - n.x * 44, z: c.z - n.z * 44 }, { x: c.x + n.x * 44, z: c.z + n.z * 44 }, 'bridge');
    }
  }

  // ---- 2c. the railway corridor: square level-crossing streets every
  // ~125 m (laid first, so nothing snaps them askew), and a railside road
  // 26 m either side of each line that they and the patch streets T into —
  // the track never cuts the island in two ----
  rail.lines.forEach((L, li) => {
    for (let d = 90 + r() * 30; d < L.rimOut - 90; d += 110 + r() * 30) {
      if (Math.abs(d - rail.diamond.d[li]) < 70) continue;
      const c = L.sample(d);
      const u = L.kind === 'ns' ? c.z : c.x;
      if (u < 100 || u > ISLAND - 100) continue;
      if (river.distTo(c.x, c.z) < 50 || !inPoly(c, inner)) continue;
      const n = { x: Math.cos(c.h), z: -Math.sin(c.h) };
      insertDry({ x: c.x - n.x * 34, z: c.z - n.z * 34 }, { x: c.x + n.x * 34, z: c.z + n.z * 34 }, 'railx');
    }
  });
  rail.lines.forEach(L => {
    for (const side of [-1, 1]) {
      const off: P[] = [];
      for (let k = 0; k < L.pts.length; k += 3) {
        const p = L.pts[k];
        off.push({ x: p.x + Math.cos(p.h) * 26 * side, z: p.z - Math.sin(p.h) * 26 * side });
      }
      const chords = simplifyOpen(off, 3, 45);
      for (let k = 0; k + 1 < chords.length; k++) {
        for (const [p, q] of clipToPoly(chords[k], chords[k + 1], inner)) insertDry(p, q, 'railside');
      }
    }
  });

  // ---- 3. patches: Voronoi sites, one rotated lattice each ----
  const K = 3 + ((r() * 3) | 0);
  const sites: Array<P & { th: number; sp: number; ph: [number, number] }> = [];
  const ANGLES = [0, 15, -15, 30, -30, 45].map(a => (a * Math.PI) / 180);
  for (let tries = 0; tries < 400 && sites.length < K; tries++) {
    const p = { x: 120 + r() * (ISLAND - 240), z: 120 + r() * (ISLAND - 240) };
    if (!coast.inLand(p.x, p.z, 150)) continue;
    if (sites.some(s => dist(s, p) < 190)) continue;
    const th = sites.length === 0 && r() < 0.5 ? 0 : ANGLES[(r() * ANGLES.length) | 0];
    sites.push({ ...p, th, sp: 58 + r() * 20, ph: [r(), r()] });
  }
  if (!sites.length) sites.push({ x: CENTER, z: CENTER, th: 0, sp: 64, ph: [0.5, 0.5] });
  const box: P[] = [{ x: -10, z: -10 }, { x: ISLAND + 10, z: -10 }, { x: ISLAND + 10, z: ISLAND + 10 }, { x: -10, z: ISLAND + 10 }];
  const cells = sites.map((s, i) => {
    let poly = box;
    sites.forEach((o, j) => {
      if (j === i) return;
      poly = clipHalf(poly, { x: (s.x + o.x) / 2, z: (s.z + o.z) / 2 }, { x: o.x - s.x, z: o.z - s.z });
    });
    return poly;
  });

  // ---- 4. seams: the straight boundaries between patches ----
  const seams: Array<[P, P]> = [];
  cells.forEach((poly, i) => {
    for (let k = 0; k < poly.length; k++) {
      const a = poly[k], b = poly[(k + 1) % poly.length];
      const m = { x: (a.x + b.x) / 2, z: (a.z + b.z) / 2 };
      // which other site is equidistant here? (a bisector edge)
      const di = dist(m, sites[i]);
      const j = sites.findIndex((s, jj) => jj > i && Math.abs(dist(m, s) - di) < 0.5);
      if (j < 0) continue;
      seams.push([a, b]);
    }
  });
  for (const [a, b] of seams) for (const [p, q] of clipToPoly(a, b, inner)) insertDry(p, q, 'seam');

  // ---- 5. every patch's lattice, clipped to its cell and the ring ----
  sites.forEach((s, i) => {
    const cell = cells[i];
    for (const fam of [0, 1]) {
      const th = s.th + (fam ? Math.PI / 2 : 0);
      const ux = Math.sin(th), uz = Math.cos(th), nx = uz, nz = -ux;
      const R = ISLAND * 1.5;
      for (let k = -24; k <= 24; k++) {
        const off = (k + s.ph[fam]) * s.sp;
        const c = { x: s.x + nx * off, z: s.z + nz * off };
        const a = { x: c.x - ux * R, z: c.z - uz * R }, b = { x: c.x + ux * R, z: c.z + uz * R };
        for (const [p, q] of clipToPoly(a, b, cell)) {
          for (const [p2, q2] of clipToPoly(p, q, inner)) {
            if (dist(p2, q2) < MIN_EDGE) continue;
            if (r() < 0.06) continue; // the odd missing street
            insertDry(p2, q2, 'street');
          }
        }
      }
    }
  });

  // ---- 6. link up what the rules stranded: every exit, and every piece of
  // street bigger than a block, joins the main web with a straight link ----
  B.linkUp();

  // the river is straightened at the crossings as BUILT: a snap at a node
  // can kink a street a few degrees off the line it was laid along
  const out = B.result();
  out.riverCrossings.length = 0;
  for (const e of out.edges) {
    const a = out.nodes[e.a], b = out.nodes[e.b];
    const pts = river.pts;
    for (let k = 0; k + 1 < pts.length; k++) {
      const p = pts[k], q = pts[k + 1];
      const d1x = b.x - a.x, d1z = b.z - a.z, d2x = q.x - p.x, d2z = q.z - p.z;
      const den = d1x * d2z - d1z * d2x;
      if (Math.abs(den) < 1e-9) continue;
      const t = ((p.x - a.x) * d2z - (p.z - a.z) * d2x) / den;
      const sn = ((p.x - a.x) * d1z - (p.z - a.z) * d1x) / den;
      if (t < 0 || t > 1 || sn < 0 || sn > 1) continue;
      out.riverCrossings.push({ x: a.x + d1x * t, z: a.z + d1z * t, heading: Math.atan2(d1x, d1z) });
    }
  }
  return out;
}

/**
 * The pieces of segment a -> b that may be built: where it crosses the
 * river within 25 degrees of square it keeps going (and the crossing is
 * noted); where it would cross shallower, or run along the water, the
 * stretch near the river is cut away.
 */
function riverCut(
  river: RiverRoute, a: P, b: P, crossings: StreetNet['riverCrossings'], okDev: number,
  nearTrestle: (x: number, z: number) => boolean,
): Array<[P, P]> {
  const L = dist(a, b);
  const STEP = 2;
  const n = Math.max(1, Math.ceil(L / STEP));
  const at = (k: number): P => ({ x: a.x + ((b.x - a.x) * k) / n, z: a.z + ((b.z - a.z) * k) / n });
  const wet: boolean[] = [];
  for (let k = 0; k <= n; k++) {
    const p = at(k);
    // generous: the final river is straightened at the crossings, which
    // can shift it a few metres toward a street that ran alongside
    wet.push(river.distTo(p.x, p.z) < river.halfAt(p.x, p.z) + 16);
  }
  const hS = Math.atan2(b.x - a.x, b.z - a.z);
  const side = (p: P): number => {
    const near = river.path.nearest(p.x, p.z);
    const h = river.pts[near.i].h;
    return Math.sign((p.x - near.p.x) * Math.cos(h) - (p.z - near.p.z) * Math.sin(h));
  };
  const cuts: Array<[number, number]> = [];
  let k = 0;
  while (k <= n) {
    if (!wet[k]) { k++; continue; }
    let e = k;
    while (e + 1 <= n && wet[e + 1]) e++;
    const before = k > 0 ? side(at(k - 1)) : 0, after = e < n ? side(at(e + 1)) : 0;
    const mid = at((k + e) >> 1);
    const near = river.path.nearest(mid.x, mid.z);
    let dev = Math.abs(hS - river.pts[near.i].h) % Math.PI;
    if (dev > Math.PI / 2) dev = Math.PI - dev; // 0 = along the river, pi/2 = square
    // (and never within 30 m of a railway trestle: a bridge sharing the water
    // with the track is the pileup the world forbids, R22)
    // (a crossing within 45 m of another would share its straightening
    // window with it, and one of the two would stay askew)
    const square = before !== 0 && after !== 0 && before !== after && Math.PI / 2 - dev <= okDev && (e - k) * STEP < 60
      && !nearTrestle(near.p.x, near.p.z) && !crossings.some(c => Math.hypot(c.x - near.p.x, c.z - near.p.z) < 45);
    if (square) {
      crossings.push({ x: near.p.x, z: near.p.z, heading: hS });
    } else {
      cuts.push([Math.max(0, k - 3), Math.min(n, e + 3)]);
    }
    k = e + 1;
  }
  if (!cuts.length) return [[a, b]];
  const out: Array<[P, P]> = [];
  let s = 0;
  for (const [c0, c1] of cuts) {
    if (c0 > s) out.push([at(s), at(c0)]);
    s = c1;
  }
  if (s < n) out.push([at(s), b]);
  return out.filter(([p, q]) => dist(p, q) >= MIN_EDGE * 0.5);
}
