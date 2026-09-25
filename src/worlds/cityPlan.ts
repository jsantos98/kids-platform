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
import { WORLD_CHUNKS, ISLAND, CENTER, SCALE } from './world.js';
import { blocksOf, inBlock, type Block } from './blocks.js';
import { raceTrackFor, ZONE_ROAD } from './raceIsland.js';
import { fillBlock, LotRaster, LOT_GAP, R_EDGE, R_CENTRE, R_LOT, R_NEAR_C, R_NEAR_E } from './blockFill.js';
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
  | 'downtown' | 'urban' | 'residential' | 'industrial' | 'park' | 'green' | 'raceway'
  | 'forest' | 'meadow' | 'desert';

/** a city block (a face of the street web) and the district it belongs to */
export interface CityBlock extends Block {
  district: District;
}

export interface Lot {
  /** bldg: a kit building (commercial, or works in industry); house: a
   * suburban house; trees: a tree row; parking; garden: lawn, fence, trees;
   * court: a paved courtyard; yard: a works yard of crates and stock */
  kind: 'bldg' | 'house' | 'trees' | 'parking' | 'garden' | 'court' | 'yard';
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
  /** the district at a chunk's centre (the minimap, coarse dressing) */
  district(cx: number, cz: number): District;
  /** the nature corner chunk (cx, cz) lies in, if any */
  nature(cx: number, cz: number): District | null;
  /** the district at any point: its block's, or nature / green outside */
  districtAt(x: number, z: number): District;
  /** every block of the street web */
  blocks: CityBlock[];
  /** the block containing (x, z), if any */
  blockAt(x: number, z: number): CityBlock | null;
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
  /** the plan as plain data (the world worker sends this) */
  data: PlanData;
}

/**
 * The kit traffic-light poles around a signalized node (roadLayout's
 * `trafficPoles`; the plan keeps its lots off them): one per approach arm,
 * on the approaching driver's near-side right corner just off the pad
 * (8.6 m out, 1.6 m past the pad's reach up the arm). `ry` turns the kit
 * light's lamp face (native -x) toward the approaching traffic; `axis` is
 * the light phase the approach obeys.
 */
export function polePoints(edges: PEdge[], n: PNode): Array<{ x: number; z: number; ry: number; axis: 'ew' | 'ns' }> {
  return n.edges.map((id, i) => {
    const e = edges[id];
    const u = e.a === n.id ? { x: e.ux, z: e.uz } : { x: -e.ux, z: -e.uz };
    // right of a driver arriving along -u is (-(-u).z, (-u).x) = (u.z, -u.x)
    const along = Math.max(8.6, (n.reach[i] ?? ROAD_HALF) + 1.6);
    const axis: 'ew' | 'ns' = Math.abs(Math.sin(e.heading - n.frame)) < Math.SQRT1_2 ? 'ew' : 'ns';
    return {
      x: n.x + u.x * along + u.z * 8.6,
      z: n.z + u.z * along - u.x * 8.6,
      ry: Math.atan2(u.z, -u.x),
      axis,
    };
  });
}

const CH = 64;
const W = WORLD_CHUNKS;
/** the districts that are built up: lots, sidewalks, lamps, lights */
export const builtD = (d: District): boolean => d === 'urban' || d === 'downtown' || d === 'industrial' || d === 'residential';
const key = (a: number, b: number) => `${a},${b}`;
const cache = new Map<string, CityPlan>();

/** test/audit hook: plans are cached per cell, so switching the city base
 * seed requires a flush or stale cities come back */
export function clearCityPlanCache(): void { cache.clear(); }

export function cityPlanFor(bx: number, by: number): CityPlan {
  const k = `${bx},${by}`;
  let plan = cache.get(k);
  // (least recently used goes first: a hit moves to the back, so the
  // island the kid is on is never the one evicted)
  if (plan) { cache.delete(k); cache.set(k, plan); }
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

  // ---- 4. districts, block by block: seeded nature corners, then rings
  // out from the centre — downtown business, a mixed ring, residential
  // streets toward the shore — a park beside downtown and industry along
  // the railway. Ground outside every block (the seafront beyond the ring
  // road) is green. ----
  const natGrid: Array<Array<District | null>> = Array.from({ length: W }, () => Array<District | null>(W).fill(null));
  const KINDS: District[] = ['forest', 'desert', 'meadow'];
  // (3 x 3 chunks on a 14-chunk island: the same share of a bigger one)
  const NC = Math.round((W * 3) / 14);
  const corners: Array<[number, number]> = [[0, 0], [W - NC, 0], [0, W - NC]];
  corners.forEach(([cx0, cz0]) => {
    const kind: District | null = r() < 0.18 ? null : KINDS[(r() * 3) | 0];
    for (let dx = 0; dx < NC; dx++) for (let dz = 0; dz < NC; dz++) natGrid[cx0 + dx][cz0 + dz] = kind;
  });
  const natureAt = (x: number, z: number): District | null => {
    const cx = Math.floor(x / CH), cz = Math.floor(z / CH);
    return cx < 0 || cz < 0 || cx >= W || cz >= W ? null : natGrid[cx][cz];
  };
  // (proportions of the island: 140-180 m and +110-150 m on an 896 m island)
  const downtownR = (140 + r() * 40) * SCALE, mixedR = downtownR + (110 + r() * 40) * SCALE;
  // a race island's circuit is its own district: the track and its apron
  const race = raceTrackFor(bx, by);
  const inRace = (x: number, z: number): boolean => !!race && race.inZone(x, z, ZONE_ROAD - 2);
  const blocks: CityBlock[] = blocksOf({ nodes, edges }).map(b => {
    if (inRace(b.cx, b.cz)) return { ...b, district: 'raceway' as District };
    // a race island has no city: parkland round the circuit (R32)
    if (race) return { ...b, district: 'park' as District };
    const nat = natureAt(b.cx, b.cz);
    const dc = Math.hypot(b.cx - CENTER, b.cz - CENTER);
    return { ...b, district: nat ?? (dc < downtownR ? 'downtown' : dc < mixedR ? 'urban' : 'residential') };
  });
  const railIn = (b: CityBlock): boolean => rail.lines.some(L => L.pts.some((p, k) => k % 3 === 0 && inBlock(b, p.x, p.z)));
  // the park: a middling block just outside downtown, clear of the track
  if (!race) {
    const cands = blocks.filter(b => b.district !== 'raceway' && !natureAt(b.cx, b.cz) && b.area > 2500 && b.area < 30000 && !railIn(b))
      .sort((p, q) => Math.abs(Math.hypot(p.cx - CENTER, p.cz - CENTER) - downtownR) - Math.abs(Math.hypot(q.cx - CENTER, q.cz - CENTER) - downtownR));
    const pk = cands[(r() * Math.min(3, cands.length)) | 0];
    if (pk) pk.district = 'park';
  }
  // industry: the railway's big blocks, grown into a few neighbours the
  // track also runs by
  if (!race) {
    const railside = blocks.filter(b => b.district !== 'park' && b.district !== 'downtown' && b.district !== 'raceway' && !natureAt(b.cx, b.cz)
      && (railIn(b) || rail.near(b.cx, b.cz, 70)));
    railside.sort((p, q) => q.area - p.area);
    const anchor = railside[(r() * Math.min(2, railside.length)) | 0];
    if (anchor) {
      const zone = new Set<CityBlock>([anchor]);
      const want = Math.floor((2 + r() * 3) * SCALE); // (the track grows with the island)
      while (zone.size < want) {
        const next = railside.filter(b => !zone.has(b) && [...zone].some(z => z.edges.some(e => b.edges.includes(e))));
        if (!next.length) break;
        zone.add(next[(r() * next.length) | 0]);
      }
      for (const b of zone) b.district = 'industrial';
    }
    // a big block the track runs through is a rail yard, wherever it lies
    for (const b of blocks) if (b.area > 40000 && b.district !== 'park' && b.district !== 'raceway' && !natureAt(b.cx, b.cz) && railIn(b)) b.district = 'industrial';
  }
  const blockBucket = new Map<string, CityBlock[]>();
  for (const b of blocks) {
    let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
    for (const p of b.poly) { x0 = Math.min(x0, p.x); x1 = Math.max(x1, p.x); z0 = Math.min(z0, p.z); z1 = Math.max(z1, p.z); }
    for (let gx = Math.floor(x0 / CH); gx <= Math.floor(x1 / CH); gx++) for (let gz = Math.floor(z0 / CH); gz <= Math.floor(z1 / CH); gz++) {
      const k = key(gx, gz);
      if (!blockBucket.has(k)) blockBucket.set(k, []);
      blockBucket.get(k)!.push(b);
    }
  }
  const blockAt = (x: number, z: number): CityBlock | null =>
    (blockBucket.get(key(Math.floor(x / CH), Math.floor(z / CH))) ?? []).find(b => inBlock(b, x, z)) ?? null;
  const districtAt = (x: number, z: number): District =>
    blockAt(x, z)?.district ?? (inRace(x, z) ? 'raceway' : null) ?? natureAt(x, z) ?? 'green';
  const district = (cx: number, cz: number): District => districtAt(cx * CH + CH / 2, cz * CH + CH / 2);

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
    const want = cands.length ? Math.floor((2 + r() * 2) * SCALE * SCALE) : 0;
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
  // the lot rules as a raster, for the block filler's quick pre-test
  // (painted a little lenient: addLot has the exact word)
  const raster = new LotRaster(ISLAND);
  for (const e of edges) raster.band(nodes[e.a], nodes[e.b], 7.6, R_EDGE);
  for (const n of nodes) raster.disc(n.x, n.z, (n.plaza ? ROUNDABOUT_REACH + 1.5 : Math.max(ROAD_HALF, ...n.reach) + 3) - 0.4, R_EDGE);
  // the traffic-light poles stand just past the pads, in the corner lots' ground
  const poles: Array<{ x: number; z: number }> = nodes.filter(n => n.signalized).flatMap(n => polePoints(edges, n));
  for (const p of poles) raster.disc(p.x, p.z, 1.8, R_EDGE);
  // (and, painted wide, where addLot must still ask the exact distance)
  for (const L of rail.lines) {
    for (let k = 0; k + 1 < L.pts.length; k++) {
      raster.band(L.pts[k], L.pts[k + 1], 2.6, R_EDGE);
      raster.band(L.pts[k], L.pts[k + 1], 15.6, R_CENTRE);
      raster.band(L.pts[k], L.pts[k + 1], 16 + 1.6, R_NEAR_C);
      raster.band(L.pts[k], L.pts[k + 1], 3 + 1.6, R_NEAR_E);
    }
  }
  for (let k = 0; k + 1 < river.pts.length; k++) {
    const p = river.pts[k], q = river.pts[k + 1];
    raster.band(p, q, p.w / 2 + 1.1, R_EDGE);
    raster.band(p, q, p.w / 2 + 6.1, R_CENTRE);
    raster.band(p, q, 7.75 + 6.5 + 1.6, R_NEAR_C);
    raster.band(p, q, 7.75 + 1.5 + 1.6, R_NEAR_E);
  }
  for (let j = 0; j < ISLAND; j++) for (let i = 0; i < ISLAND; i++) {
    if (!coast.inLand(i + 0.5, j + 0.5, 1.6)) raster.bits[j * ISLAND + i] |= R_EDGE | R_CENTRE;
    else if (!coast.inLand(i + 0.5, j + 0.5, 3.6)) raster.bits[j * ISLAND + i] |= R_CENTRE;
  }
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
  /** each built lot's outline (asked again and again by its neighbours) */
  const outlines = new WeakMap<Lot, Array<{ x: number; z: number }>>();
  const outlineOf = (l: Lot): Array<{ x: number; z: number }> => {
    let o = outlines.get(l);
    if (!o) { o = outline(l); outlines.set(l, o); }
    return o;
  };
  /** separating-axis overlap of two lots, p grown by margin m (`cp`: p's
   * grown outline, when the caller has it) */
  const overlap = (p: Lot, q: Lot, m: number, cp0?: Array<{ x: number; z: number }>): boolean => {
    // (lots whose bounding circles are apart can't overlap)
    const rp = Math.hypot(p.w / 2 + m, p.d / 2 + m), rq = Math.hypot(q.w / 2, q.d / 2);
    if ((p.x - q.x) ** 2 + (p.z - q.z) ** 2 > (rp + rq + 0.01) ** 2) return false;
    const cp = cp0 ?? outline({ ...p, w: p.w + 2 * m, d: p.d + 2 * m }), cq = outlineOf(q);
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
  const nodeBucket = new Map<string, PNode[]>();
  for (const n of nodes) {
    const k = key(Math.floor(n.x / 32), Math.floor(n.z / 32));
    if (!nodeBucket.has(k)) nodeBucket.set(k, []);
    nodeBucket.get(k)!.push(n);
  }
  /** build `lot` if every rule lets it stand (own: its street, or -1) */
  const addLot = (lot: Lot, own: number): boolean => {
    if (!builtD(districtAt(lot.x, lot.z))) return false; // nature/park stay clear
    const gx = Math.floor(lot.x / 32), gz = Math.floor(lot.z / 32);
    // the other lots first: the cheapest test that fails most
    let grown: Array<{ x: number; z: number }> | undefined;
    for (let dx = -1; dx <= 1; dx++) for (let dz = -1; dz <= 1; dz++) {
      for (const o of lotBucket.get(key(gx + dx, gz + dz)) ?? []) {
        const rp = Math.hypot(lot.w / 2 + LOT_GAP, lot.d / 2 + LOT_GAP), rq = Math.hypot(o.w / 2, o.d / 2);
        if ((lot.x - o.x) ** 2 + (lot.z - o.z) ** 2 > (rp + rq + 0.01) ** 2) continue;
        grown ??= outline({ ...lot, w: lot.w + 2 * LOT_GAP, d: lot.d + 2 * LOT_GAP });
        if (overlap(lot, o, LOT_GAP, grown)) return false;
      }
    }
    const nearC = (raster.at(lot.x, lot.z) & R_NEAR_C) !== 0;
    if (nearC && rail.near(lot.x, lot.z, 16)) return false;
    if (!coast.inLand(lot.x, lot.z, 4)) return false;
    // (the river is at most 15.5 m wide: only near it is its width asked)
    if (nearC && river.near(lot.x, lot.z, 7.75 + 6.5) && river.near(lot.x, lot.z, river.halfAt(lot.x, lot.z) + 6.5)) return false;
    const ol = outline(lot);
    for (const f of ol) {
      // never on a street or a sidewalk (8.1 m from any centreline)
      if (nearestStreet(f.x, f.z, own) < 7.9) return false;
    }
    // nor on a junction pad or a roundabout's ring
    for (let dx = -2; dx <= 2; dx++) for (let dz = -2; dz <= 2; dz++) {
      for (const n of nodeBucket.get(key(gx + dx, gz + dz)) ?? []) {
        const pad = n.plaza ? ROUNDABOUT_REACH + 1.5 : Math.max(ROAD_HALF, ...n.reach) + 3;
        if (ol.some(f => Math.hypot(f.x - n.x, f.z - n.z) < pad)) return false;
      }
    }
    // nor over a traffic-light pole
    {
      const c = Math.cos(lot.ry), sn = Math.sin(lot.ry);
      for (const p of poles) {
        const dx = p.x - lot.x, dz = p.z - lot.z;
        if (Math.abs(dx * c - dz * sn) < lot.w / 2 + 1.3 && Math.abs(dx * sn + dz * c) < lot.d / 2 + 1.3) return false;
      }
    }
    for (const f of ol) {
      if (!coast.inLand(f.x, f.z, 2)) return false;
      if (!(raster.at(f.x, f.z) & R_NEAR_E)) continue;
      if (rail.near(f.x, f.z, 3)) return false;
      if (river.near(f.x, f.z, 7.75 + 1.5) && (river.inWater(f.x, f.z) || river.near(f.x, f.z, river.halfAt(f.x, f.z) + 1.5))) return false;
    }
    lots.push(lot);
    raster.rect(lot.x, lot.z, lot.ry, lot.w, lot.d, LOT_GAP - 0.1, R_LOT);
    const bk = key(gx, gz);
    if (!lotBucket.has(bk)) lotBucket.set(bk, []);
    lotBucket.get(bk)!.push(lot);
    const ck = key(Math.floor(lot.x / CH), Math.floor(lot.z / CH));
    if (!lotsByChunk.has(ck)) lotsByChunk.set(ck, []);
    lotsByChunk.get(ck)!.push(lot);
    return true;
  };
  /** what a lot of district `d` is, from a roll (frontage: facing a street) */
  const kindFor = (d: District, roll: number, front: boolean): Lot['kind'] => {
    const table: Array<[Lot['kind'], number]> =
      d === 'downtown' ? (front ? [['bldg', 0.84], ['parking', 0.08], ['trees', 0.04], ['court', 0.04]] : [['bldg', 0.5], ['court', 0.3], ['parking', 0.2]])
      : d === 'industrial' ? (front ? [['bldg', 0.66], ['yard', 0.2], ['parking', 0.14]] : [['yard', 0.55], ['bldg', 0.28], ['parking', 0.17]])
      : d === 'residential' ? (front ? [['house', 0.8], ['garden', 0.12], ['trees', 0.08]] : [['garden', 0.6], ['house', 0.28], ['trees', 0.12]])
      : (front ? [['bldg', 0.56], ['house', 0.2], ['parking', 0.12], ['trees', 0.07], ['court', 0.05]]
        : [['bldg', 0.3], ['garden', 0.22], ['court', 0.18], ['parking', 0.16], ['house', 0.14]]);
    let acc = 0;
    for (const [k, p] of table) { acc += p; if (roll < acc) return k; }
    return table[0][0];
  };
  for (const e of edges) {
    const a = nodes[e.a], b = nodes[e.b];
    const nx = -e.uz, nz = e.ux; // right of a -> b
    // a frontage lot's street-side corner (8.1 m out) must clear each end's
    // junction pad (the disc addLot keeps lots out of)
    const clearOf = (n: PNode): number => {
      const pad = n.plaza ? ROUNDABOUT_REACH + 1.5 : Math.max(ROAD_HALF, ...n.reach) + 3;
      return Math.sqrt(Math.max(0, pad * pad - 8.1 * 8.1)) + 0.4;
    };
    for (const side of [-1, 1]) {
      let t = Math.max(reachAt(a, e.id), clearOf(a));
      const tEnd = e.len - Math.max(reachAt(b, e.id), clearOf(b));
      while (t < tEnd) {
        let w = 9 + r() * 5;
        // the last lot takes what room is left
        if (t + w > tEnd) {
          if (tEnd - t < 6) break;
          w = tEnd - t;
        }
        const along = t + w / 2;
        const sx = a.x + e.ux * along, sz = a.z + e.uz * along;
        const dist = districtAt(sx + nx * side * 14, sz + nz * side * 14);
        if (builtD(dist)) {
          const kind = kindFor(dist, r(), true);
          const depth = kind === 'parking' || kind === 'trees' ? 7
            : dist === 'industrial' ? 12 + r() * 5 : dist === 'downtown' ? 12 + r() * 5 : 10 + r() * 3;
          // the front looks at the street: toward -side * normal
          const ry = Math.atan2(-nx * side, -nz * side);
          const v = r();
          // a narrow block takes a shallower lot rather than none
          for (const d of [depth, 9, 6.5]) {
            if (d > depth) continue;
            const off = ROAD_HALF + 1.1 + d / 2;
            if (addLot({ kind, x: sx + nx * side * off, z: sz + nz * side * off, ry, w, d, v }, e.id)) break;
          }
        }
        t += w + LOT_GAP + 0.2 + r() * 0.8;
      }
    }
  }
  // ... and the inside of every built block (blockFill.ts)
  for (const bl of blocks) {
    if (!builtD(bl.district)) continue;
    // (oblong scraps last: they fit the pockets the grain leaves)
    const scraps: Array<[number, number]> = [[8, 5], [5, 8], [6, 4], [4, 6], [4, 4], [3, 3]];
    const sizes: Array<[number, number]> = bl.district === 'downtown' ? [[18, 16], [13, 12], [8, 8], ...scraps]
      : bl.district === 'industrial' ? [[20, 16], [14, 12], [8, 8], ...scraps]
      : [[14, 12], [10, 10], [7, 7], ...scraps];
    // (a scrap of ground too small for a building is a garden, court or yard)
    const small: Lot['kind'] = bl.district === 'downtown' ? 'court' : bl.district === 'industrial' ? 'yard' : 'garden';
    fillBlock(bl, { sizes }, raster, (x, z, ry, w, d) => {
      const k = kindFor(bl.district, r(), false);
      const kind = w * d < 40 && (k === 'bldg' || k === 'house') ? small : k;
      return addLot({ kind, x, z, ry, w, d, v: r() }, -1);
    });
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
      // (two a line on an 896 m island, more on a longer line)
      for (let more = Math.round(2 * SCALE) - 1; more > 0; more--) {
        const next = cand.find(c => chosen.every(cd => Math.abs(c - cd) > 220));
        if (next === undefined) break;
        chosen.push(next);
      }
      chosen.sort((p, q) => p - q);
      for (const d of chosen) stations.push(mkStation(L, li, d));
    });
  }

  void district; void other;
  return assemblePlan({
    seed, bx, by, nodes, edges, blocks, lots, crossings, riverBridges, stations,
    exits: exitLines,
    nat: natGrid.flat(),
    race: race ? { cx: race.cx, cz: race.cz, hx: race.hx, hz: race.hz, ry: race.ry } : null,
  });
}

/** a plan as plain data: what the world worker sends back (worldWorker.ts) */
export interface PlanData {
  seed: number;
  bx: number;
  by: number;
  nodes: PNode[];
  edges: PEdge[];
  blocks: CityBlock[];
  /** every lot, in the order they were laid */
  lots: Lot[];
  crossings: Crossing[];
  riverBridges: RiverBridge[];
  stations: Station[];
  exits: CityExits;
  /** nature corners, chunk by chunk (column-major, W x W) */
  nat: Array<District | null>;
  /** the race circuit's zone, if any */
  race: { cx: number; cz: number; hx: number; hz: number; ry: number } | null;
}

/** the plan's queries over its data — the generator and an installed
 * worker result both go through here, so the two can never disagree */
function assemblePlan(d: PlanData): CityPlan {
  const { nodes, edges, blocks } = d;
  const natureAt = (x: number, z: number): District | null => {
    const cx = Math.floor(x / CH), cz = Math.floor(z / CH);
    return cx < 0 || cz < 0 || cx >= W || cz >= W ? null : d.nat[cx * W + cz];
  };
  const inRace = (x: number, z: number): boolean => {
    const r = d.race;
    if (!r) return false;
    const c = Math.cos(r.ry), s = Math.sin(r.ry), dx = x - r.cx, dz = z - r.cz;
    const m = ZONE_ROAD - 2;
    return Math.abs(dx * c - dz * s) < r.hx + m && Math.abs(dx * s + dz * c) < r.hz + m;
  };
  const blockBucket = new Map<string, CityBlock[]>();
  for (const b of blocks) {
    let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
    for (const p of b.poly) { x0 = Math.min(x0, p.x); x1 = Math.max(x1, p.x); z0 = Math.min(z0, p.z); z1 = Math.max(z1, p.z); }
    for (let gx = Math.floor(x0 / CH); gx <= Math.floor(x1 / CH); gx++) for (let gz = Math.floor(z0 / CH); gz <= Math.floor(z1 / CH); gz++) {
      const k = key(gx, gz);
      if (!blockBucket.has(k)) blockBucket.set(k, []);
      blockBucket.get(k)!.push(b);
    }
  }
  const blockAt = (x: number, z: number): CityBlock | null =>
    (blockBucket.get(key(Math.floor(x / CH), Math.floor(z / CH))) ?? []).find(b => inBlock(b, x, z)) ?? null;
  const districtAt = (x: number, z: number): District =>
    blockAt(x, z)?.district ?? (inRace(x, z) ? 'raceway' : null) ?? natureAt(x, z) ?? 'green';
  const lotsByChunk = new Map<string, Lot[]>();
  for (const lot of d.lots) {
    const ck = key(Math.floor(lot.x / CH), Math.floor(lot.z / CH));
    if (!lotsByChunk.has(ck)) lotsByChunk.set(ck, []);
    lotsByChunk.get(ck)!.push(lot);
  }
  return {
    seed: d.seed, bx: d.bx, by: d.by, nodes, edges,
    district: (cx, cz) => districtAt(cx * CH + CH / 2, cz * CH + CH / 2),
    districtAt, blocks, blockAt,
    nature: (cx, cz) => natureAt(cx * CH + CH / 2, cz * CH + CH / 2),
    lots: (cx, cz) => lotsByChunk.get(key(cx, cz)) ?? [],
    crossings: d.crossings, riverBridges: d.riverBridges, stations: d.stations,
    exits: d.exits,
    other: (e, n) => nodes[e.a === n ? e.b : e.a],
    data: d,
  };
}

/** is island (bx, by)'s plan already built? */
export function hasCityPlan(bx: number, by: number): boolean { return cache.has(`${bx},${by}`); }

/** install a plan the world worker built (a no-op if one is already here) */
export function installCityPlan(d: PlanData): void {
  const k = `${d.bx},${d.by}`;
  if (cache.has(k)) return;
  cache.set(k, assemblePlan(d));
  if (cache.size > 32) cache.delete(cache.keys().next().value as string);
}

/** which side of the track a station's platform stands: +1 = right of the
 * line's direction of increasing arc (seeded by the station's spot; the
 * platform baker and the boarding queues agree through this) */
export function platformSide(st: Station): 1 | -1 {
  return (chunkSeed(Math.round(st.x), Math.round(st.z), 0x57a7) & 1) ? 1 : -1;
}

/** a point on a station's platform: `along` metres from the stop point in
 * the track direction, `across` metres out from the track (3.5 = the
 * platform's middle) */
export function platformPoint(st: Station, along: number, across: number): { x: number; z: number } {
  const side = platformSide(st);
  const ux = Math.sin(st.h), uz = Math.cos(st.h), nx = Math.cos(st.h), nz = -Math.sin(st.h);
  return { x: st.x + ux * along + nx * across * side, z: st.z + uz * along + nz * across * side };
}

function mkStation(rail: RailRoute, line: number, d: number): Station {
  const p = rail.sample(d);
  return { line, d, x: p.x, z: p.z, h: p.h };
}
