// The city plan: a seeded, top-down generator for the island world. Every
// design decision is made HERE, in one deterministic pass per island, and the
// rest of the game just replays the plan:
//
//   1. the street generator lays the candidate network (streetGen.ts: exit
//      avenues, the coastal ring, the river embankments and bridges, patch
//      seams and each patch's rotated lattice); the river is straightened
//      square at its street crossings (riverRoute.ts) and the two railway
//      lines deform against the candidates (railRoute.ts), vetoing the few
//      streets they would cut badly
//   2. vetoes: streets the rail rides alongside, streets whose river bridge
//      would share the water with a trestle, level crossings squeezed against
//      a junction, anything off the shore — the four causeway avenues are
//      never dropped
//   3. no dead ends, one web: every street tip that doesn't meet a cross
//      street is trimmed back until it does, and only the largest connected
//      network survives. The causeway mouths are the only sanctioned ends
//   4. districts: seeded nature corners, a park next to downtown, industry
//      near the railway, streetless blocks turn green
//   5. junctions: roundabouts at a few square crossroads, traffic lights at
//      built-up junctions of three or more arms; level crossings and river
//      bridges recorded where the corridors meet the streets
//   6. lots along every street, both sides, oriented to it, with setbacks
//      from junction pads, the track, the water and each other
//   7. train stations on straight, quiet stretches of both lines
//
// Consumers: cityChunk + roadLayout (roads, plazas, lamps, lots, nature, the
// river bed), streetGraph (everything that navigates), transit (crossings,
// stations), the occupancy grid and the minimap.
import { rng, chunkSeed } from '../engine/rng.js';
import { WORLD_CHUNKS, ISLAND } from './world.js';
import { citySeed, southExit, eastExit } from './cityGrid.js';
import { railNetFor, type RailRoute } from './railRoute.js';
import { riverFor } from './riverRoute.js';
import { coastFor } from './coast.js';
import { streetNetFor, segDist, type EdgeKind } from './streetGen.js';

/** half-size of the kit roundabout at plazas (3 x 14 m tiles); roadLayout.ts
 * lays it, the lots and the occupancy grid keep clear of it */
export const ROUNDABOUT_REACH = 21;
/** carriageway half-width (R5) */
export const ROAD_HALF = 7;

export type District =
  | 'downtown' | 'urban' | 'industrial' | 'park' | 'green'
  | 'forest' | 'meadow' | 'desert';

export interface Lot {
  kind: 'bldg' | 'trees' | 'parking';
  x: number;               // centre
  z: number;
  ry: number;              // facing (the front looks at its street)
  w: number;               // footprint along the street (m)
  d: number;               // footprint depth (m)
  v: number;               // variation salt 0..1
}

/** a junction, bend, pass-through or causeway mouth of the street web */
export interface PNode {
  id: number;
  x: number;
  z: number;
  /** incident edge ids, sorted by arm heading */
  edges: number[];
  mouth: boolean;
  /** traffic lights stand here */
  signalized: boolean;
  /** a roundabout */
  plaza: boolean;
  /** the node's reference axis (light phases, the kit pad's rotation) */
  frame: number;
  /** every arm lies on the frame's 90-degree cross: a kit pad fits */
  square: boolean;
  /** how far the node's pad reaches up each arm (parallel to edges) */
  reach: number[];
}

/** a straight street between two nodes */
export interface PEdge {
  id: number;
  a: number;
  b: number;
  kind: EdgeKind;
  /** unit direction a -> b, length, heading atan2(ux, uz) */
  ux: number;
  uz: number;
  len: number;
  heading: number;
}

/** the railway crosses a street here (mid-block, with signals) */
export interface Crossing {
  x: number;
  z: number;
  /** heading of the street being crossed (the rail crosses it square).
   * Meaningful modulo pi. */
  heading: number;
  /** which railway line crosses here (index into railNetFor().lines) */
  line: number;
  /** arc distance along that line — trains query this */
  d: number;
  /** the street edge, and the distance along it from its node a */
  edge: number;
  s: number;
}

/** a street bridge where the river passes under */
export interface RiverBridge {
  x: number;
  z: number;
  /** heading of the street on the bridge */
  heading: number;
  /** causeway-avenue bridges are wider: they suppress water farther */
  exit: boolean;
}

/** a rail stop: platform beside a straight stretch of the line */
export interface Station {
  /** which railway line the platform serves, and where along it */
  line: number;
  d: number;
  x: number;
  z: number;
  h: number;
}

export interface CityExits {
  /** lattice line of the exit avenue on each side (n/w belong to the
   * neighbours' south/east edges — the four causeways always line up) */
  n: number;
  s: number;
  w: number;
  e: number;
}

export interface CityPlan {
  seed: number;
  /** which grid cell this city is (the world is an archipelago of them) */
  bx: number;
  by: number;
  nodes: PNode[];
  edges: PEdge[];
  district(cx: number, cz: number): District;
  /** lots whose centre falls inside chunk (cx, cz) */
  lots(cx: number, cz: number): Lot[];
  /** road × railway level crossings */
  crossings: Crossing[];
  /** road × river bridge spans */
  riverBridges: RiverBridge[];
  /** train stations */
  stations: Station[];
  /** where the four causeways to the neighbouring cities land */
  exits: CityExits;
  /** the other end of edge e from node n */
  other(e: PEdge, n: number): PNode;
}

const CH = 64;
const W = WORLD_CHUNKS;
const key = (a: number, b: number) => `${a},${b}`;
const cache = new Map<string, CityPlan>();

/** test/audit hook: plans are cached per cell, so switching the city base
 * seed requires a flush or stale cities come back */
export function clearCityPlanCache(): void { cache.clear(); }

export function cityPlanFor(bx: number, by: number): CityPlan {
  const k = `${bx},${by}`;
  let plan = cache.get(k);
  if (!plan) {
    plan = buildPlan(bx, by);
    cache.set(k, plan);
    if (cache.size > 32) cache.delete(cache.keys().next().value as string);
  }
  return plan;
}

/** how far a node's pad reaches up each of its arms: a kit pad (square
 * node) 7 m, a roundabout 21 m, an oblique junction as far as the kerbs of
 * neighbouring arms need to part (7 / tan(half the angle) + 1, capped) */
export function padReach(dirs: number[], square: boolean, plaza: boolean): number[] {
  if (plaza) return dirs.map(() => ROUNDABOUT_REACH);
  if (square || dirs.length < 2) return dirs.map(() => ROAD_HALF);
  return dirs.map((h, i) => {
    let r = ROAD_HALF;
    for (let j = 0; j < dirs.length; j++) {
      if (j === i) continue;
      let d = Math.abs(dirs[j] - h) % (Math.PI * 2);
      if (d > Math.PI) d = Math.PI * 2 - d;
      if (d >= Math.PI - 1e-3) continue; // straight on: no kerb meets
      r = Math.max(r, ROAD_HALF / Math.tan(d / 2) + 1);
    }
    return Math.min(15, r);
  });
}

function buildPlan(bx: number, by: number): CityPlan {
  const seed = citySeed(bx, by);
  const r = rng(chunkSeed(seed, 0xc17, 0));
  const net = streetNetFor(bx, by);
  const rail = railNetFor(bx, by);
  const river = riverFor(bx, by);
  const coast = coastFor(bx, by);
  const railSpans: Array<[{ x: number; z: number }, { x: number; z: number }, number, number]> = [];
  rail.lines.forEach((L, li) => {
    let cum = 0;
    for (let k = 0; k + 1 < L.pts.length; k++) {
      const seg = Math.hypot(L.pts[k + 1].x - L.pts[k].x, L.pts[k + 1].z - L.pts[k].z);
      railSpans.push([L.pts[k], L.pts[k + 1], li, cum]);
      cum += seg;
    }
  });

  // ---- 1. the candidate web minus the rail's vetoes ----
  const N = net.nodes;
  const E = net.edges;
  const alive = new Set<number>();
  for (const e of E) if (!rail.vetoed.has(e.id) || e.kind === 'exit') alive.add(e.id);
  const edgeGeom = (id: number) => {
    const e = E[id], a = N[e.a], b = N[e.b];
    const len = Math.hypot(b.x - a.x, b.z - a.z);
    return { a, b, len, ux: (b.x - a.x) / len, uz: (b.z - a.z) / len };
  };

  // ---- 2. vetoes ----
  // the railway runs PARALLEL alongside this street for a stretch (head-on
  // passes stay — they are square level crossings)
  const railRunsAlong = (id: number): boolean => {
    const { a, len, ux, uz } = edgeGeom(id);
    let run = 0;
    for (let t = 4; t <= len - 3; t += 4) {
      const x = a.x + ux * t, z = a.z + uz * t;
      if (rail.distTo(x, z) < 9) {
        let dev = Math.abs(rail.headingAt(x, z) - Math.atan2(ux, uz)) % Math.PI;
        if (dev > Math.PI / 2) dev = Math.PI - dev;
        if (dev < Math.PI / 4) { if (++run >= 3) return true; } else run = 0;
      } else run = 0;
    }
    return false;
  };
  // where the rail sits IN the water: a street whose river bridge would
  // land within 24 m of a span shares the water with a trestle (R22)
  const trestles: Array<{ x: number; z: number }> = [];
  for (const [a, b] of railSpans) {
    const len = Math.hypot(b.x - a.x, b.z - a.z);
    const steps = Math.max(1, Math.ceil(len / 4));
    for (let q = 0; q < steps; q++) {
      const px = a.x + (b.x - a.x) * (q / steps), pz = a.z + (b.z - a.z) * (q / steps);
      if (river.near(px, pz, river.halfAt(px, pz) + 4)) trestles.push({ x: px, z: pz });
    }
  }
  const bridgeClash = (id: number): boolean => {
    const { a, b } = edgeGeom(id);
    for (const q of river.pts) {
      if (segDist(q, a, b) >= q.w / 2 + 9) continue;
      for (const t of trestles) if (Math.hypot(t.x - q.x, t.z - q.z) < 24) return true;
    }
    return false;
  };
  // a level crossing within 18 m of a junction would put its barriers in
  // the junction square
  const nodeClash = (id: number): boolean => {
    const { a, b, len } = edgeGeom(id);
    for (const [p, q] of railSpans) {
      const d1x = q.x - p.x, d1z = q.z - p.z, d2x = b.x - a.x, d2z = b.z - a.z;
      const den = d1x * d2z - d1z * d2x;
      if (Math.abs(den) < 1e-9) continue;
      const t = ((a.x - p.x) * d2z - (a.z - p.z) * d2x) / den;
      const s = ((a.x - p.x) * d1z - (a.z - p.z) * d1x) / den;
      if (t < 0 || t > 1 || s < 0 || s > 1) continue;
      const along = s * len;
      if (along < 18 || along > len - 18) return true;
    }
    return false;
  };
  // the whole carriageway and both kerbs stay on dry land (R29)
  const offLand = (id: number): boolean => {
    const { a, len, ux, uz } = edgeGeom(id);
    for (let t = 0; t <= len; t += 4) {
      const x = a.x + ux * t, z = a.z + uz * t;
      if (!coast.inLand(x, z, 11)) return true;
      if (!coast.inLand(x - uz * 7, z + ux * 7, 4) || !coast.inLand(x + uz * 7, z - ux * 7, 4)) return true;
    }
    return false;
  };
  for (const id of [...alive]) {
    if (E[id].kind === 'exit') continue;
    if (railRunsAlong(id) || bridgeClash(id) || nodeClash(id) || offLand(id)) alive.delete(id);
  }

  // ---- 3. no dead ends, one web ----
  const incident = (n: number): number[] => N[n].edges.filter(id => alive.has(id));
  for (let changed = true; changed;) {
    changed = false;
    for (const n of N) {
      if (n.mouth) continue;
      const inc = incident(n.id);
      if (inc.length === 1) { alive.delete(inc[0]); changed = true; }
    }
  }
  {
    // keep the largest component
    const comp = new Map<number, number>();
    let bestC = -1, bestN = -1, c = 0;
    for (const n of N) {
      if (comp.has(n.id) || !incident(n.id).length) continue;
      const stack = [n.id];
      comp.set(n.id, c);
      let size = 0;
      while (stack.length) {
        const cur = stack.pop()!;
        for (const id of incident(cur)) {
          size++;
          const e = E[id];
          const o = e.a === cur ? e.b : e.a;
          if (!comp.has(o)) { comp.set(o, c); stack.push(o); }
        }
      }
      if (size > bestN) { bestN = size; bestC = c; }
      c++;
    }
    for (const id of [...alive]) if (comp.get(E[id].a) !== bestC) alive.delete(id);
  }

  // renumber into the plan's own nodes / edges
  const nodeMap = new Map<number, number>();
  const nodes: PNode[] = [];
  const edges: PEdge[] = [];
  const nodeOf = (id: number): number => {
    let m = nodeMap.get(id);
    if (m === undefined) {
      m = nodes.length;
      nodeMap.set(id, m);
      nodes.push({ id: m, x: N[id].x, z: N[id].z, edges: [], mouth: N[id].mouth, signalized: false, plaza: false, frame: 0, square: false, reach: [] });
    }
    return m;
  };
  for (const e of E) {
    if (!alive.has(e.id)) continue;
    const a = nodeOf(e.a), b = nodeOf(e.b);
    const pa = nodes[a], pb = nodes[b];
    const len = Math.hypot(pb.x - pa.x, pb.z - pa.z);
    const ux = (pb.x - pa.x) / len, uz = (pb.z - pa.z) / len;
    const pe: PEdge = { id: edges.length, a, b, kind: e.kind, ux, uz, len, heading: Math.atan2(ux, uz) };
    edges.push(pe);
    pa.edges.push(pe.id);
    pb.edges.push(pe.id);
  }
  const other = (e: PEdge, n: number): PNode => nodes[e.a === n ? e.b : e.a];
  const armHeading = (n: PNode, id: number): number => {
    const e = edges[id];
    return e.a === n.id ? e.heading : Math.atan2(-e.ux, -e.uz);
  };
  for (const n of nodes) {
    n.edges.sort((p, q) => armHeading(n, p) - armHeading(n, q));
    const hs = n.edges.map(id => armHeading(n, id));
    n.frame = hs[0] ?? 0;
    // square: every arm on the frame's cross
    n.square = hs.every(h => {
      let d = ((h - n.frame) % (Math.PI / 2) + Math.PI / 2) % (Math.PI / 2);
      d = Math.min(d, Math.PI / 2 - d);
      return d < (0.3 * Math.PI) / 180; // a kit pad at the frame fits within 4 cm
    });
  }

  // ---- 4. districts ----
  const grid: District[][] = Array.from({ length: W }, () => Array<District>(W).fill('urban'));
  const KINDS: District[] = ['forest', 'desert', 'meadow'];
  const corners: Array<[number, number]> = [[0, 0], [W - 3, 0], [0, W - 3]];
  corners.forEach(([cx0, cz0]) => {
    const kind: District = r() < 0.18 ? 'urban' : KINDS[(r() * 3) | 0];
    for (let dx = 0; dx < 3; dx++) for (let dz = 0; dz < 3; dz++) grid[cx0 + dx][cz0 + dz] = kind;
  });
  const c0 = W >> 1;
  const centre = [[c0 - 1, c0 - 1], [c0, c0 - 1], [c0 - 1, c0], [c0, c0]].filter(([cx, cz]) => grid[cx][cz] === 'urban');
  const park = centre[(r() * centre.length) | 0] ?? [c0 - 1, c0 - 1];
  grid[park[0]][park[1]] = 'park';
  const downtown = centre.find(([cx, cz]) => !(cx === park[0] && cz === park[1])) ?? [c0, c0];
  grid[downtown[0]][downtown[1]] = 'downtown';
  // frontage: a chunk whose middle lies within a block's depth of a street
  // (streets run at any angle now, so "a street crosses the chunk" would
  // leave a checkerboard of streetless squares)
  const front = new Set<string>();
  for (let cx = 0; cx < W; cx++) for (let cz = 0; cz < W; cz++) {
    const c = { x: cx * CH + CH / 2, z: cz * CH + CH / 2 };
    if (edges.some(e => segDist(c, nodes[e.a], nodes[e.b]) < 46)) front.add(key(cx, cz));
  }
  const frontage = (cx: number, cz: number): boolean => front.has(key(cx, cz));
  const nearRail = (cx: number, cz: number): boolean => rail.near(cx * CH + CH / 2, cz * CH + CH / 2, 82);
  const urbanLeft = (): Array<[number, number]> => {
    const out: Array<[number, number]> = [];
    for (let cx = 0; cx < W; cx++) for (let cz = 0; cz < W; cz++) {
      if (grid[cx][cz] === 'urban' && frontage(cx, cz)) out.push([cx, cz]);
    }
    return out;
  };
  const withRail = urbanLeft().filter(([cx, cz]) => nearRail(cx, cz));
  const anchorList = withRail.length ? withRail : urbanLeft();
  if (anchorList.length) {
    const anchor = anchorList[(r() * anchorList.length) | 0];
    const zone: Array<[number, number]> = [anchor];
    const want = 2 + ((r() * 3) | 0);
    while (zone.length < want) {
      const next: Array<[number, number]> = [];
      for (const [cx, cz] of zone) {
        for (const [nx, nz] of [[cx + 1, cz], [cx - 1, cz], [cx, cz + 1], [cx, cz - 1]] as const) {
          if (nx < 0 || nx >= W || nz < 0 || nz >= W) continue;
          if (grid[nx][nz] !== 'urban') continue;
          if (zone.some(([ax, az]) => ax === nx && az === nz)) continue;
          if (frontage(nx, nz)) next.push([nx, nz]);
        }
      }
      if (!next.length) break;
      zone.push(next[(r() * next.length) | 0]);
    }
    for (const [cx, cz] of zone) grid[cx][cz] = 'industrial';
  }
  for (let cx = 0; cx < W; cx++) for (let cz = 0; cz < W; cz++) {
    if (grid[cx][cz] === 'urban' && !frontage(cx, cz)) grid[cx][cz] = 'green';
  }
  const district = (cx: number, cz: number): District =>
    cx < 0 || cz < 0 || cx >= W || cz >= W ? 'urban' : grid[cx][cz];
  const districtAt = (x: number, z: number): District => district(Math.floor(x / CH), Math.floor(z / CH));
  const builtD = (d: District): boolean => d === 'urban' || d === 'downtown' || d === 'industrial';

  // ---- 5. crossings, bridges, plazas, lights ----
  const exitLines = { n: southExit(bx, by - 1), s: southExit(bx, by), w: eastExit(bx - 1, by), e: eastExit(bx, by) };
  const crossings: Crossing[] = [];
  for (const e of edges) {
    const a = nodes[e.a], b = nodes[e.b];
    const hits: Array<{ x: number; z: number; s: number; line: number; d: number }> = [];
    for (const [p, q, li, cum] of railSpans) {
      const d1x = q.x - p.x, d1z = q.z - p.z, d2x = b.x - a.x, d2z = b.z - a.z;
      const den = d1x * d2z - d1z * d2x;
      if (Math.abs(den) < 1e-9) continue;
      const t = ((a.x - p.x) * d2z - (a.z - p.z) * d2x) / den;
      const s = ((a.x - p.x) * d1z - (a.z - p.z) * d1x) / den;
      if (t < 0 || t > 1 || s < 0 || s > 1) continue;
      const m = e.kind === 'exit' ? 0 : 18;
      if (s * e.len < m || s * e.len > e.len - m) continue;
      hits.push({ x: p.x + d1x * t, z: p.z + d1z * t, s: s * e.len, line: li, d: cum + Math.hypot(d1x, d1z) * t });
    }
    hits.sort((u, v) => u.s - v.s);
    // tightly-spaced dips of one graze fold into ONE crossing
    let cluster: typeof hits = [];
    const flush = (): void => {
      if (!cluster.length) return;
      const mid = cluster[(cluster.length / 2) | 0];
      crossings.push({ x: mid.x, z: mid.z, heading: e.heading, line: mid.line, d: mid.d, edge: e.id, s: mid.s });
      cluster = [];
    };
    for (const h of hits) {
      if (cluster.length && (h.s - cluster[cluster.length - 1].s > 30 || h.line !== cluster[0].line)) flush();
      cluster.push(h);
    }
    flush();
  }

  const riverBridges: RiverBridge[] = [];
  for (const e of edges) {
    const a = nodes[e.a];
    const exit = e.kind === 'exit';
    // every water pass gets a bridge (causeway avenues tile long passes, R22)
    let group: Array<{ x: number; z: number; t: number }> = [];
    const flushB = (): void => {
      if (!group.length) return;
      const mid = group[(group.length / 2) | 0];
      riverBridges.push({ x: mid.x, z: mid.z, heading: e.heading, exit });
      group = [];
    };
    for (let t = 0; t <= e.len; t += 2) {
      const x = a.x + e.ux * t, z = a.z + e.uz * t;
      const wet = river.distTo(x, z) < river.halfAt(x, z) + (exit ? 9 : 2);
      if (wet) {
        if (group.length && t - group[0].t > 14 && exit) flushB();
        group.push({ x, z, t });
      } else flushB();
    }
    flushB();
  }

  const nearCrossing = (x: number, z: number, m: number): boolean => crossings.some(c => Math.hypot(c.x - x, c.z - z) < m);
  {
    const cands = nodes.filter(n => n.edges.length === 4 && n.square && !n.mouth
      && n.edges.every(id => edges[id].len >= 2 * ROUNDABOUT_REACH + 4)
      && !nearCrossing(n.x, n.z, 30) && !rail.near(n.x, n.z, ROUNDABOUT_REACH + 12)
      && !river.near(n.x, n.z, ROUNDABOUT_REACH + 16));
    for (let k = cands.length - 1; k > 0; k--) {
      const m = (r() * (k + 1)) | 0;
      [cands[k], cands[m]] = [cands[m], cands[k]];
    }
    const want = cands.length ? 2 + ((r() * 2) | 0) : 0;
    for (const n of cands.slice(0, want)) n.plaza = true;
  }
  for (const n of nodes) {
    // lights where roads cross AND people live around them
    const built = [[-12, -12], [12, -12], [-12, 12], [12, 12]].every(([dx, dz]) => builtD(districtAt(n.x + dx, n.z + dz)));
    n.signalized = n.edges.length >= 3 && !n.plaza && built;
    n.reach = padReach(n.edges.map(id => armHeading(n, id)), n.square, n.plaza);
  }
  const reachAt = (n: PNode, id: number): number => n.reach[n.edges.indexOf(id)] ?? ROAD_HALF;

  // ---- 6. lots along every street, both sides ----
  const lots: Lot[] = [];
  const lotsByChunk = new Map<string, Lot[]>();
  const lotBucket = new Map<string, Lot[]>();
  const edgeBucket = new Map<string, number[]>();
  for (const e of edges) {
    const a = nodes[e.a];
    const seen = new Set<string>();
    for (let t = 0; t <= e.len; t += 8) {
      const kk = key(Math.floor((a.x + e.ux * t) / 32), Math.floor((a.z + e.uz * t) / 32));
      if (seen.has(kk)) continue;
      seen.add(kk);
      if (!edgeBucket.has(kk)) edgeBucket.set(kk, []);
      edgeBucket.get(kk)!.push(e.id);
    }
  }
  /** the lot's footprint outline: corners and edge midpoints */
  const outline = (l: Lot): Array<{ x: number; z: number }> => {
    const c = Math.cos(l.ry), s = Math.sin(l.ry);
    const out: Array<{ x: number; z: number }> = [];
    for (const [lx, lz] of [[-1, -1], [0, -1], [1, -1], [1, 0], [1, 1], [0, 1], [-1, 1], [-1, 0]] as const) {
      const px = (lx * l.w) / 2, pz = (lz * l.d) / 2;
      out.push({ x: l.x + px * c + pz * s, z: l.z - px * s + pz * c });
    }
    return out;
  };
  /** separating-axis overlap of two lots, p grown by margin m */
  const overlap = (p: Lot, q: Lot, m: number): boolean => {
    const cp = outline({ ...p, w: p.w + 2 * m, d: p.d + 2 * m }), cq = outline(q);
    for (const a of [p.ry, p.ry + Math.PI / 2, q.ry, q.ry + Math.PI / 2]) {
      const ax = Math.cos(a), az = -Math.sin(a);
      let p0 = Infinity, p1 = -Infinity, q0 = Infinity, q1 = -Infinity;
      for (const v of cp) { const t = v.x * ax + v.z * az; p0 = Math.min(p0, t); p1 = Math.max(p1, t); }
      for (const v of cq) { const t = v.x * ax + v.z * az; q0 = Math.min(q0, t); q1 = Math.max(q1, t); }
      if (p1 < q0 || q1 < p0) return false;
    }
    return true;
  };
  const nearestStreet = (x: number, z: number, own: number): number => {
    let best = Infinity;
    const gx = Math.floor(x / 32), gz = Math.floor(z / 32);
    for (let dx = -1; dx <= 1; dx++) for (let dz = -1; dz <= 1; dz++) {
      for (const id of edgeBucket.get(key(gx + dx, gz + dz)) ?? []) {
        const e = edges[id];
        const d = segDist({ x, z }, nodes[e.a], nodes[e.b]) + (id === own ? 0.25 : 0);
        if (d < best) best = d;
      }
    }
    return best;
  };
  const addLot = (lot: Lot, own: number): void => {
    if (!builtD(districtAt(lot.x, lot.z))) return; // nature/park stay clear
    if (rail.near(lot.x, lot.z, 16)) return;
    if (!coast.inLand(lot.x, lot.z, 4)) return;
    if (river.near(lot.x, lot.z, river.halfAt(lot.x, lot.z) + 6.5)) return;
    const ol = outline(lot);
    for (const f of ol) {
      if (rail.near(f.x, f.z, 3)) return;
      if (!coast.inLand(f.x, f.z, 2)) return;
      if (river.inWater(f.x, f.z) || river.near(f.x, f.z, river.halfAt(f.x, f.z) + 1.5)) return;
      // never on a street or a sidewalk (8.1 m from any centreline)
      if (nearestStreet(f.x, f.z, own) < 7.9) return;
    }
    // nor on a junction pad or a roundabout's ring
    for (const n of nodes) {
      if (Math.hypot(n.x - lot.x, n.z - lot.z) > 60) continue;
      const pad = n.plaza ? ROUNDABOUT_REACH + 1.5 : Math.max(ROAD_HALF, ...n.reach) + 3;
      if (ol.some(f => Math.hypot(f.x - n.x, f.z - n.z) < pad)) return;
    }
    const gx = Math.floor(lot.x / 32), gz = Math.floor(lot.z / 32);
    for (let dx = -1; dx <= 1; dx++) for (let dz = -1; dz <= 1; dz++) {
      for (const o of lotBucket.get(key(gx + dx, gz + dz)) ?? []) if (overlap(lot, o, 1.25)) return;
    }
    lots.push(lot);
    const bk = key(gx, gz);
    if (!lotBucket.has(bk)) lotBucket.set(bk, []);
    lotBucket.get(bk)!.push(lot);
    const ck = key(Math.floor(lot.x / CH), Math.floor(lot.z / CH));
    if (!lotsByChunk.has(ck)) lotsByChunk.set(ck, []);
    lotsByChunk.get(ck)!.push(lot);
  };
  for (const e of edges) {
    const a = nodes[e.a], b = nodes[e.b];
    const nx = -e.uz, nz = e.ux; // right of a -> b
    for (const side of [-1, 1]) {
      let t = reachAt(a, e.id) + 5;
      const tEnd = e.len - reachAt(b, e.id) - 5;
      while (t < tEnd) {
        const w = 8 + r() * 5;
        if (t + w > tEnd) break;
        const along = t + w / 2;
        const sx = a.x + e.ux * along, sz = a.z + e.uz * along;
        const dist = districtAt(sx + nx * side * 14, sz + nz * side * 14);
        if (builtD(dist)) {
          const dt = dist === 'downtown', ind = dist === 'industrial';
          const roll = r();
          const depth = ind ? 10 + r() * 5 : dt ? 11 + r() * 5 : 8 + r() * 4;
          // the front looks at the street: toward -side * normal
          const ry = Math.atan2(-nx * side, -nz * side);
          const place = (kind: Lot['kind'], d: number): void => {
            const off = ROAD_HALF + 1.1 + d / 2;
            addLot({ kind, x: sx + nx * side * off, z: sz + nz * side * off, ry, w, d, v: r() }, e.id);
          };
          const pBldg = ind ? 0.62 : dt ? 0.74 : 0.5;
          const pTrees = roll + (ind ? 0.08 : dt ? 0.12 : 0.22);
          const pPark = ind ? 0.92 : dt ? 0.86 : 0.72;
          if (roll < pBldg) place('bldg', depth);
          else if (roll < pTrees) place('trees', 6);
          else if (roll < pPark) place('parking', 6.5);
        }
        t += w + 1.6 + r() * 2;
      }
    }
  }

  // ---- 7. train stations: straight, quiet stretches away from crossings,
  // the diamond and the river — up to two per line, well apart ----
  const stations: Station[] = [];
  {
    const rs = rng(chunkSeed(seed, 0x9a7, 4));
    rail.lines.forEach((L, li) => {
      const cand: number[] = [];
      for (let d = 60; d < L.rimOut - 60; d += 4) {
        const h1 = L.sample(d - 14).h, h2 = L.sample(d + 14).h;
        let dh = Math.abs(h2 - h1);
        if (dh > Math.PI) dh = Math.PI * 2 - dh;
        if (dh > 0.16) continue; // needs ~28 m of straight track
        const p = L.sample(d);
        if (p.x < 46 || p.x > ISLAND - 46 || p.z < 46 || p.z > ISLAND - 46) continue;
        if (!coast.inLand(p.x, p.z, 25)) continue;
        if (river.distTo(p.x, p.z) < 18) continue;
        if (Math.abs(d - rail.diamond.d[li]) < 60) continue;
        if (crossings.some(c => (c.line === li && Math.abs(c.d - d) < 24) || Math.hypot(c.x - p.x, c.z - p.z) < 17)) continue;
        if (rail.lines.some((o, oi) => oi !== li && o.near(p.x, p.z, 20))) continue;
        if (stations.some(st => Math.hypot(st.x - p.x, st.z - p.z) < 60)) continue;
        // the platform (3.5 m off the track) stays off every street
        if (nearestStreet(p.x, p.z, -1) < 14) continue;
        cand.push(d);
      }
      if (!cand.length) return;
      const chosen: number[] = [cand[(rs() * cand.length) | 0]];
      const next = cand.find(c => chosen.every(cd => Math.abs(c - cd) > 220));
      if (next !== undefined) chosen.push(next);
      chosen.sort((p, q) => p - q);
      for (const d of chosen) stations.push(mkStation(L, li, d));
    });
  }

  return {
    seed, bx, by, nodes, edges,
    district,
    lots: (cx, cz) => lotsByChunk.get(key(cx, cz)) ?? [],
    crossings, riverBridges, stations,
    exits: exitLines,
    other,
  };
}

function mkStation(rail: RailRoute, line: number, d: number): Station {
  const p = rail.sample(d);
  return { line, d, x: p.x, z: p.z, h: p.h };
}
