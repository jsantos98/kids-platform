// The city plan: a seeded, top-down generator for the island world. Instead of
// ad-hoc rules sprinkled through the chunk baker, everything is decided HERE,
// in one deterministic pass per world seed, and the rest of the game just
// replays the plan:
//
//   1. the railway claims its smooth spline loop (railRoute.ts) and the river
//      meanders north→south (riverRoute.ts) — both generated first
//   2. districts core: three seeded nature corners (forest / desert / meadow),
//      a park next to downtown, a downtown chunk with big buildings
//   3. street lines: a seeded subset of the interior lattice lines — not every
//      line, so blocks come out irregular; segments are then dropped at random
//      (and where the railway would run alongside them), anything disconnected
//      is pruned. Streets the railway crosses head-on are pinned open: every
//      seed gets level crossings with working signals
//   4. no dead ends: every street tip that doesn't meet a cross street is
//      trimmed back until it does — roads always connect to the network. The
//      only sanctioned loose ends are the four causeway mouths on the shore
//   5. districts finish: an industrial blob near the railway, streetless urban
//      blocks become green
//   6. junctions: ≥3 street arms in built-up chunks → traffic lights, unless
//      the junction became a paved plaza; road×rail crossings and road×river
//      bridge spans are recorded where the corridors meet the streets
//   7. lots: along every street segment, both sides, with proper setbacks;
//      anything too close to the railway or the river stays clear
//   8. two train stations on straight, quiet stretches of the line
//
// Consumers: cityChunk (roads, plazas, lamps, lots, nature, the river bed),
// the traffic lights (via RoadGrid), traffic + pedestrians (street lines),
// transit (crossings, stations) and the minimap.
import { rng, chunkSeed } from '../engine/rng.js';
import { WORLD_CHUNKS, ISLAND, CENTER } from './world.js';
import { citySeed, southExit, eastExit, streetLinesFor } from './cityGrid.js';
import { railRouteFor, type RailRoute } from './railRoute.js';
import { riverFor, type RiverRoute } from './riverRoute.js';
import { arcGap } from './spline.js';
import { coastFor } from './coast.js';

/** half-size of the kit roundabout at plazas (3 x 14 m tiles); roadLayout.ts
 * lays it, the lots and the occupancy grid keep clear of it */
export const ROUNDABOUT_REACH = 21;

export type District =
  | 'downtown' | 'urban' | 'industrial' | 'park' | 'green'
  | 'forest' | 'meadow' | 'desert';

export interface Lot {
  kind: 'bldg' | 'trees' | 'parking';
  x: number;               // centre
  z: number;
  ry: number;              // facing (buildings face the street)
  w: number;               // footprint along the street (m)
  d: number;               // footprint depth (m)
  v: number;               // variation salt 0..1
}

/** the railway crosses a street here (mid-block, with signals) */
export interface Crossing {
  x: number;
  z: number;
  /** heading of the street being crossed (atan2 of its direction; the rail
   * crosses it square). Meaningful modulo pi. */
  heading: number;
  /** arc distance along the rail loop — trains query this */
  d: number;
}

/** a street bridge where the river passes under */
export interface RiverBridge {
  x: number;
  z: number;
  axis: 'h' | 'v';
  /** causeway-corridor bridges are wider: they suppress water farther */
  exit: boolean;
}

/** a rail stop: platform beside a straight stretch of the line */
export interface Station {
  d: number;
  x: number;
  z: number;
  h: number;
}

export interface CityExits {
  /** lattice line of the exit road on each side (n/w belong to the neighbours'
   * south/east edges — the four corridor roads always line up) */
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
  /** street lines (any open segment somewhere on the line) */
  lineH(j: number): boolean;
  lineV(i: number): boolean;
  /** open street segment: horizontal line j across chunk-column i */
  segH(j: number, i: number): boolean;
  /** open street segment: vertical line i across chunk-row j */
  segV(i: number, j: number): boolean;
  /** number of street arms meeting at lattice node (i, j) */
  arms(i: number, j: number): boolean[];
  /** ≥3 street arms in built-up chunks → traffic lights (plazas are not
   * signalized); junctions bordering parks or green corners stay bare so no
   * light ever stands alone in the grass */
  signalized(i: number, j: number): boolean;
  /** junction is a paved plaza with a fountain (no lights) */
  plaza(i: number, j: number): boolean;
  district(cx: number, cz: number): District;
  /** lots whose centre falls inside chunk (cx, cz) */
  lots(cx: number, cz: number): Lot[];
  /** road × railway level crossings */
  crossings: Crossing[];
  /** road × river bridge spans */
  riverBridges: RiverBridge[];
  /** train stations (0-3) */
  stations: Station[];
  /** where the four causeways to the neighbouring cities land */
  exits: CityExits;
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
  }
  return plan;
}

function buildPlan(bx: number, by: number): CityPlan {
  const seed = citySeed(bx, by);
  const r = rng(chunkSeed(seed, 0xc17, 0));
  const rail = railRouteFor(bx, by);
  const river = riverFor(seed);
  // the island's shore (R29): streets, lots and stations stay on land
  const coast = coastFor(bx, by);
  /** any stretch of this segment's carriageway would lie in the sea */
  const offLand = (horiz: boolean, line: number, a: number, b: number): boolean => {
    for (let t = a; t <= b; t += 4) {
      const x = horiz ? t : line * CH, z = horiz ? line * CH : t;
      if (!coast.inLand(x, z, 11)) return true;
    }
    return false;
  };

  // ---- 1. street lines: the shared seeded subset (cityGrid.ts) — the same
  // lines the railway straightens itself to cross at right angles. Two lines
  // per axis are ARTERIALS — every one of their segments stays open, giving
  // continuous roads that run the length of the island. ----
  const { H, V } = streetLinesFor(bx, by);
  // the arterials: two seeded lines per axis that never drop segments
  const pickArterials = (lines: number[]): number[] => {
    const pool = [...lines];
    for (let k = pool.length - 1; k > 0; k--) {
      const m = (r() * (k + 1)) | 0;
      [pool[k], pool[m]] = [pool[m], pool[k]];
    }
    return pool.slice(0, Math.min(2, pool.length));
  };
  const arterialH = new Set(pickArterials(H));
  const arterialV = new Set(pickArterials(V));

  // the railway would run alongside this segment for a long stretch?
  // (head-on passes stay — they become level crossings)
  // the railway runs PARALLEL alongside this segment for a long stretch?
  // (head-on passes stay — they are square level crossings). A shallow graze
  // still shadows: the rail may not ride the road asphalt anywhere.
  const railRunsAlong = (horiz: boolean, line: number, a: number, b: number): boolean => {
    let run = 0;
    for (let t = a + 4; t <= b - 3; t += 4) {
      const x = horiz ? t : line * CH;
      const z = horiz ? line * CH : t;
      if (rail.distTo(x, z) < 9) {
        const h = rail.headingAt(x, z);
        let dev = Math.abs(h - (horiz ? Math.PI / 2 : 0));
        if (dev > Math.PI) dev = Math.PI * 2 - dev;
        const parallel = Math.min(dev, Math.PI - dev) < Math.PI / 4;
        if (parallel && ++run >= 3) return true;
        if (!parallel) run = 0;
      } else run = 0;
    }
    return false;
  };

  // where the rail sits IN the water (trestle spans). A street whose river
  // bridge would land within 24 m of a span is dropped — a trestle sharing
  // the water with a road bridge is the one rail/river/road pileup the
  // world forbids, and the dead-end trim repairs the street web afterwards.
  const trestles: Array<{ x: number; z: number }> = [];
  for (let k = 0; k < rail.pts.length; k++) {
    const a = rail.pts[k], b = rail.pts[(k + 1) % rail.pts.length];
    const len = Math.hypot(b.x - a.x, b.z - a.z);
    // interpolated: pin-collapsed vertices leave long chords whose MIDDLE
    // slices through water the endpoints never touch
    const steps = Math.max(1, Math.ceil(len / 4));
    for (let q = 0; q < steps; q++) {
      const px = a.x + (b.x - a.x) * (q / steps), pz = a.z + (b.z - a.z) * (q / steps);
      if (river.near(px, pz, river.halfAt(px, pz) + 4)) trestles.push({ x: px, z: pz });
    }
  }
  const bridgeClash = (horiz: boolean, line: number, a: number, b: number): boolean => {
    for (const q of river.pts) {
      // any water a road would ride through here — bridge or ford — counts:
      // road band ±7 m plus the river's own half width
      const across = horiz ? Math.abs(q.z - line * CH) : Math.abs(q.x - line * CH);
      if (across >= q.w / 2 + 9) continue;
      const along = horiz ? q.x : q.z;
      if (along < a + 1 || along > b - 1) continue;
      for (const t of trestles) {
        if (Math.hypot(t.x - q.x, t.z - q.z) < 24) return true;
      }
    }
    return false;
  };

  // ---- 2. districts core: nature corners, park, downtown ----
  const grid: District[][] = Array.from({ length: W }, () => Array<District>(W).fill('urban'));
  // each nature corner rolls its own biome (and occasionally stays city) —
  // a forest-seeded city next to a desert-seeded one reads as a different world
  const KINDS: District[] = ['forest', 'desert', 'meadow'];
  const corners: Array<[number, number]> = [[0, 0], [W - 3, 0], [0, W - 3]];
  corners.forEach(([bx, bz]) => {
    const kind: District = r() < 0.18 ? 'urban' : KINDS[(r() * 3) | 0];
    for (let dx = 0; dx < 3; dx++) for (let dz = 0; dz < 3; dz++) {
      grid[bx + dx][bz + dz] = kind;
    }
  });
  // a park next to downtown, then downtown = the central chunk left over
  const c = W >> 1;
  const centre = [[c - 1, c - 1], [c, c - 1], [c - 1, c], [c, c]].filter(([cx, cz]) => grid[cx][cz] === 'urban');
  const park = centre[(r() * centre.length) | 0] ?? [c - 1, c - 1];
  grid[park[0]][park[1]] = 'park';
  const downtown = centre.find(([cx, cz]) => !(cx === park[0] && cz === park[1])) ?? [c, c];
  grid[downtown[0]][downtown[1]] = 'downtown';

  // ---- 3. segments: seeded drops minus railway shadows, pinned rail
  // crossings, then keep the connected component ----
  let segHSet = new Set<string>(); // key(j, i)
  let segVSet = new Set<string>(); // key(i, j)
  for (let attempt = 0; attempt < 4; attempt++) {
    const dropP = Math.max(0.02, 0.14 - attempt * 0.05);
    segHSet = new Set();
    segVSet = new Set();
    for (const j of H) for (let i = 0; i < W; i++) {
      // arterials keep all their segments (rail shadows and bridge clashes still bite)
      const keep = arterialH.has(j) || r() >= dropP;
      if (keep && !railRunsAlong(true, j, i * CH, (i + 1) * CH) && !bridgeClash(true, j, i * CH, (i + 1) * CH)
        && !offLand(true, j, i * CH, (i + 1) * CH)) {
        segHSet.add(key(j, i));
      }
    }
    for (const i of V) for (let j = 0; j < W; j++) {
      const keep = arterialV.has(i) || r() >= dropP;
      if (keep && !railRunsAlong(false, i, j * CH, (j + 1) * CH) && !bridgeClash(false, i, j * CH, (j + 1) * CH)
        && !offLand(false, i, j * CH, (j + 1) * CH)) {
        segVSet.add(key(i, j));
      }
    }
    forceRailCrossings(rail, H, V, segHSet, segVSet,
      (horiz, line, a, b) => bridgeClash(horiz, line, a, b) || offLand(horiz, line, a, b));
    pruneDisconnected(segHSet, segVSet);
    if (segHSet.size + segVSet.size >= 14) break;
  }

  const segH = (j: number, i: number) => segHSet.has(key(j, i));
  const segV = (i: number, j: number) => segVSet.has(key(i, j));
  const lineH = (j: number) => H.includes(j) && Array.from({ length: W }, (_, i) => i).some(i => segH(j, i));
  const lineV = (i: number) => V.includes(i) && Array.from({ length: W }, (_, j) => j).some(j => segV(i, j));

  // ---- 3b. exit corridors: one full-length road leaves on each side and
  // runs to the causeway across the strait. The line indices come from the
  // shared edge hash, so the neighbour's road continues ours exactly. Where
  // the railway shadows the road, the road still wins — a cut corridor
  // would strand the causeway. ----
  const exN = southExit(bx, by - 1);
  const exS = southExit(bx, by);
  const exW = eastExit(bx - 1, by);
  const exE = eastExit(bx, by);
  for (let k = 0; k < W; k++) {
    segVSet.add(key(exN, k));
    segVSet.add(key(exS, k));
    segHSet.add(key(exW, k));
    segHSet.add(key(exE, k));
  }
  const exits: CityExits = { n: exN, s: exS, w: exW, e: exE };

  // ---- 4b. R22 sweep: check every open segment against the FINAL trestle
  // spans and drop clashing ones (exit corridors are exempt — the causeway
  // contract outranks the bridge; they are audited separately). The
  // dead-end trim below repairs the street web afterwards. ----
  {
    const trestles2: Array<{ x: number; z: number }> = [];
    for (const p of rail.pts) {
      if (river.near(p.x, p.z, river.halfAt(p.x, p.z) + 4)) trestles2.push({ x: p.x, z: p.z });
    }
    const exitLines = new Set([exN, exS, exW, exE]);
    const clash2 = (horiz: boolean, line: number, a: number, b: number): boolean => {
      if (exitLines.has(line)) return false;
      for (const q of river.pts) {
        const across = horiz ? Math.abs(q.z - line * CH) : Math.abs(q.x - line * CH);
        if (across >= q.w / 2 + 9) continue;
        const along = horiz ? q.x : q.z;
        if (along < a + 1 || along > b - 1) continue;
        for (const t of trestles2) {
          if (Math.hypot(t.x - q.x, t.z - q.z) < 24) return true;
        }
      }
      return false;
    };
    for (const k of [...segHSet]) {
      const [j, i] = k.split(',').map(Number);
      if (clash2(true, j, i * CH, (i + 1) * CH)) segHSet.delete(k);
    }
    for (const k of [...segVSet]) {
      const [i, j] = k.split(',').map(Number);
      if (clash2(false, i, j * CH, (j + 1) * CH)) segVSet.delete(k);
    }
  }

  // ---- 4c. no level crossing squeezed against a junction: where the rail
  // crosses a street within 18 m of a node, the crossing's barriers (which
  // reach 9.4 m up the road from the crossing centre) would stand inside
  // the junction square — drop the segment instead (exit corridors exempt;
  // the dead-end trim repairs the web). Recorded crossings need >= 18 m for
  // the same reason, so every genuine crossing is either recorded or its
  // street is gone. ----
  {
    const exitLines = new Set([exN, exS, exW, exE]);
    const nodeClash = (horiz: boolean, line: number, a: number, b: number): boolean => {
      if (exitLines.has(line)) return false;
      const c = line * CH;
      const pts = rail.pts;
      for (let k = 0; k < pts.length; k++) {
        const p = pts[k], q = pts[(k + 1) % pts.length];
      const pa = horiz ? p.z : p.x, qa = horiz ? q.z : q.x;
      if (pa === qa) continue; // runs parallel to the street line
      // a vertex pinned exactly ON the line still crosses (see
      // collectCrossings) — tangential grazes against a junction street
      // must veto the segment just like full crossings do
      if ((pa - c) * (qa - c) > 0) continue;
        const t = (c - pa) / (qa - pa);
        const along = horiz ? p.x + (q.x - p.x) * t : p.z + (q.z - p.z) * t;
        if (along >= a + 18 && along <= b - 18) continue; // mid-block: fine
        return true; // node-adjacent: the barriers would stand in a junction
      }
      return false;
    };
    for (const k of [...segHSet]) {
      const [j, i] = k.split(',').map(Number);
      if (nodeClash(true, j, i * CH, (i + 1) * CH)) segHSet.delete(k);
    }
    for (const k of [...segVSet]) {
      const [i, j] = k.split(',').map(Number);
      if (nodeClash(false, i, j * CH, (j + 1) * CH)) segVSet.delete(k);
    }
    // deletions can strand a closed cycle away from the web — prune again
    // so every island keeps ONE connected street network
    pruneDisconnected(segHSet, segVSet);
  }

  // ---- 5. no dead ends: a road may only stop where it meets a cross street.
  // Any degree-1 node that isn't a causeway mouth gives up its street, which
  // can expose a new tip further back — repeat until every street either
  // reaches an intersection or is gone. Roads that ran onto the beach and the
  // stubs left by the random drops all dissolve into the blocks around them. ----
  {
    const deg = (i: number, j: number): number =>
      (segHSet.has(key(j, i - 1)) ? 1 : 0) + (segHSet.has(key(j, i)) ? 1 : 0) +
      (segVSet.has(key(i, j - 1)) ? 1 : 0) + (segVSet.has(key(i, j)) ? 1 : 0);
    const tip = new Set([key(exN, 0), key(exS, W), key(0, exW), key(W, exE)]);
    const queue: Array<[number, number]> = [];
    const seedNode = (i: number, j: number): void => {
      if (!tip.has(key(i, j)) && deg(i, j) === 1) queue.push([i, j]);
    };
    for (const k of segHSet) {
      const [j, i] = k.split(',').map(Number);
      seedNode(i, j); seedNode(i + 1, j);
    }
    for (const k of segVSet) {
      const [i, j] = k.split(',').map(Number);
      seedNode(i, j); seedNode(i, j + 1);
    }
    while (queue.length) {
      const [i, j] = queue.pop()!;
      if (deg(i, j) !== 1 || tip.has(key(i, j))) continue;
      if (segHSet.has(key(j, i - 1))) segHSet.delete(key(j, i - 1));
      else if (segHSet.has(key(j, i))) segHSet.delete(key(j, i));
      else if (segVSet.has(key(i, j - 1))) segVSet.delete(key(i, j - 1));
      else segVSet.delete(key(i, j));
      // whichever node lost a segment may now dangle itself — re-check it
      queue.push([i - 1, j], [i + 1, j], [i, j - 1], [i, j + 1]);
    }
  }

  // ---- 6. districts finish: industrial near the railway, green fillers ----
  const frontage = (cx: number, cz: number): boolean =>
    segH(cz, cx) || segH(cz + 1, cx) || segV(cx, cz) || segV(cx + 1, cz);
  const nearRail = (cx: number, cz: number): boolean =>
    rail.near(cx * CH + CH / 2, cz * CH + CH / 2, 82);
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
    const want = 2 + ((r() * 3) | 0); // 2..4 chunks
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

  // ---- 7. junction styles + corridor crossings ----
  const arms = (i: number, j: number): boolean[] => {
    const w = segH(j, i - 1), e = segH(j, i), n = segV(i, j - 1), s = segV(i, j);
    return [w, e, n, s].filter(Boolean);
  };
  const armsCount = (i: number, j: number) => arms(i, j).length;

  const crossings: Crossing[] = [];
  // arc position of every rail sample — the deformed polyline is NOT evenly
  // spaced (crossing pins cram samples together), so a linear index-to-arc
  // map would misplace crossings and mistime the barriers
  const railCum: number[] = [0];
  for (let k = 1; k <= rail.pts.length; k++) {
    const a2 = rail.pts[k - 1], b2 = rail.pts[k % rail.pts.length];
    railCum.push(railCum[k - 1] + Math.hypot(b2.x - a2.x, b2.z - a2.z));
  }
  const exitLines = new Set([exN, exS, exW, exE]);
  const collectCrossings = (horiz: boolean, line: number, a: number, b: number): void => {
    // true crossings only: sample spans that actually cross the street line
    // (a rail running alongside within a few metres is not a crossing).
    // Exit corridors are never dropped by the node-clash veto, so a crossing
    // squeezed against one of their nodes is still recorded — barriers beat
    // a bare crossing even if the post grazes the junction square.
    const c0 = line * CH;
    const isExit = exitLines.has(line);
    const mNode = isExit ? 0 : 18;
    const pts = rail.pts;
    const hits: Array<{ x: number; z: number; d: number }> = [];
    for (let k = 0; k < pts.length; k++) {
      const p = pts[k], q = pts[(k + 1) % pts.length];
      const pa = horiz ? p.z : p.x, qa = horiz ? q.z : q.x;
      if (pa === qa) continue; // runs parallel to the street line
      // a vertex pinned exactly ON the line counts as a crossing (the
      // deformers land pins dead-centre) — only strictly-one-side skips
      if ((pa - c0) * (qa - c0) > 0) continue;
      const t = (c0 - pa) / (qa - pa);
      const x = p.x + (q.x - p.x) * t, z = p.z + (q.z - p.z) * t;
      const along = horiz ? x : z;
      if (along < a + mNode || along > b - mNode) continue;
      hits.push({ x, z, d: railCum[k] + t * (railCum[k + 1] - railCum[k]) });
    }
    hits.sort((u, v) => (horiz ? u.x - v.x : u.z - v.z));
    let cluster: typeof hits = [];
    const flush = (): void => {
      if (!cluster.length) return;
      const mx = cluster.reduce((s, u) => s + u.x, 0) / cluster.length;
      const mz = cluster.reduce((s, u) => s + u.z, 0) / cluster.length;
      crossings.push({ x: mx, z: mz, heading: horiz ? Math.PI / 2 : 0, d: cluster[(cluster.length / 2) | 0].d });
      cluster = [];
    };
    for (const hit of hits) {
      if (!cluster.length) { cluster.push(hit); continue; }
      const prev = cluster[cluster.length - 1];
      // cluster tightly-spaced dips of one graze into ONE crossing (the
      // deformer squares the whole stretch with a single wall). Two
      // recorded crossings < ~30 m apart would put an on-asphalt jog
      // between their walls — the "W" ride this exists to prevent.
      if ((horiz ? hit.x - prev.x : hit.z - prev.z) <= 30) cluster.push(hit);
      else { flush(); cluster.push(hit); }
    }
    flush();
  };
  for (const k of segHSet) {
    const [j, i] = k.split(',').map(Number);
    collectCrossings(true, j, i * CH, (i + 1) * CH);
  }
  for (const k of segVSet) {
    const [i, j] = k.split(',').map(Number);
    collectCrossings(false, i, j * CH, (j + 1) * CH);
  }

  const riverBridges: RiverBridge[] = [];
  const collectBridges = (horiz: boolean, line: number, a: number, b: number): void => {
    // one bridge per segment: a second pass of the water becomes a ford —
    // EXCEPT on the causeway corridors, which may never ford the river
    // (an exit ford is where a trestle would pile onto the road, R22) and
    // so bridge any water they cross, node margins included
    const exit = horiz ? line === exW || line === exE : line === exN || line === exS;
    const m0 = exit ? 1 : 8, m1 = exit ? 1 : 8, mAcross = exit ? 13 : 8;
    if (exit) {
      // causeways bridge EVERY water pass — a ford is where a trestle
      // would pile onto the road (R22). Long passes get a bridge every
      // ~14 m so the 11 m water-suppression circles tile the whole ford.
      let group: Array<{ x: number; z: number; along: number }> = [];
      const flushGroup = (): void => {
        if (!group.length) return;
        const mid = group[(group.length / 2) | 0];
        riverBridges.push(horiz
          ? { x: mid.x, z: line * CH, axis: 'h' as const, exit: true }
          : { x: line * CH, z: mid.z, axis: 'v' as const, exit: true });
        group = [];
      };
      for (const p of river.pts) {
        const along = horiz ? p.x : p.z;
        const across = horiz ? p.z : p.x;
        const inSpan = along >= a + m0 && along <= b - m1 && Math.abs(across - line * CH) <= p.w / 2 + 9;
        if (inSpan) {
          if (group.length && along - group[0].along > 14) flushGroup();
          group.push({ x: p.x, z: p.z, along });
        } else flushGroup();
      }
      flushGroup();
      return;
    }
    let best: { x: number; z: number } | null = null;
    for (const p of river.pts) {
      const along = horiz ? p.x : p.z;
      const across = horiz ? p.z : p.x;
      if (along < a + m0 || along > b - m1) continue;
      if (Math.abs(across - line * CH) > mAcross) continue;
      if (!best || Math.abs(along - (a + b) / 2) < Math.abs((horiz ? best.x : best.z) - (a + b) / 2)) {
        best = { x: p.x, z: p.z };
      }
    }
    if (best) riverBridges.push(horiz
      ? { x: best.x, z: line * CH, axis: 'h' as const, exit }
      : { x: line * CH, z: best.z, axis: 'v' as const, exit });
  };
  for (const k of segHSet) {
    const [j, i] = k.split(',').map(Number);
    collectBridges(true, j, i * CH, (i + 1) * CH);
  }
  for (const k of segVSet) {
    const [i, j] = k.split(',').map(Number);
    collectBridges(false, i, j * CH, (j + 1) * CH);
  }

  const nearCrossing = (i: number, j: number, m: number): boolean =>
    crossings.some(c => Math.hypot(c.x - i * CH, c.z - j * CH) < m);

  // plazas: a seeded few crossroads become the kit roundabout (3x3 tiles,
  // reaching 21 m up each arm) with a fountain on its centre island. Only
  // 4-arm nodes qualify — a roundabout's arms are all open, a missing street
  // would leave a stub — and the ring keeps well clear of track and water.
  const plazaSet = new Set<string>();
  {
    const cands: Array<[number, number]> = [];
    for (let i = 1; i < W; i++) for (let j = 1; j < W; j++) {
      if (armsCount(i, j) !== 4 || nearCrossing(i, j, 30)) continue;
      if (rail.near(i * CH, j * CH, ROUNDABOUT_REACH + 12)) continue;
      if (river.near(i * CH, j * CH, ROUNDABOUT_REACH + 16)) continue;
      cands.push([i, j]);
    }
    for (let k = cands.length - 1; k > 0; k--) {
      const m = (r() * (k + 1)) | 0;
      [cands[k], cands[m]] = [cands[m], cands[k]];
    }
    const want = cands.length ? Math.max(2, 2 + ((r() * 2) | 0)) : 0;
    for (const [i, j] of cands.slice(0, want)) plazaSet.add(key(i, j));
  }
  const plaza = (i: number, j: number): boolean => plazaSet.has(key(i, j));
  // traffic lights belong where roads cross AND people live around them: a
  // junction whose neighbouring chunks are all park/green/nature gets no
  // signals, so no light pole ever stands alone in the grass
  const built = (i: number, j: number): boolean => {
    for (const [ci, cj] of [[i - 1, j - 1], [i, j - 1], [i - 1, j], [i, j]] as const) {
      const d = district(ci, cj);
      if (d !== 'urban' && d !== 'downtown' && d !== 'industrial') return false;
    }
    return true;
  };
  const signalized = (i: number, j: number) =>
    armsCount(i, j) >= 3 && !plaza(i, j) && built(i, j);

  // ---- 8. lots along every street segment, both sides ----
  const lots: Lot[] = [];
  const lotsByChunk = new Map<string, Lot[]>();
  const addLot = (lot: Lot): void => {
    const cx = Math.floor(lot.x / CH), cz = Math.floor(lot.z / CH);
    const dist = district(cx, cz);
    if (dist !== 'urban' && dist !== 'downtown' && dist !== 'industrial') return; // nature/park stay clear
    // keep the railway corridor (plus the sweep of a barrier arm) and the
    // river banks clear — nothing built may touch the track, and the whole
    // FOOTPRINT must clear the water, not just the lot centre (a deep lot
    // whose centre clears the river can still dip its far corner into it)
    if (rail.near(lot.x, lot.z, 16)) return;
    if (!coast.inLand(lot.x, lot.z, 4)) return;
    if (river.near(lot.x, lot.z, river.halfAt(lot.x, lot.z) + 6.5)) return;
    const flip = Math.abs(Math.abs(lot.ry) - Math.PI / 2) < 0.01;
    const hx = (flip ? lot.d : lot.w) / 2, hz = (flip ? lot.w : lot.d) / 2;
    // the whole FOOTPRINT must clear the track and the water — a long lot
    // whose centre clears 16 m can still edge its wall into the rail bed
    for (const [sx, sz] of [[-1, -1], [0, -1], [1, -1], [-1, 0], [1, 0], [-1, 1], [0, 1], [1, 1]] as const) {
      const fx = lot.x + sx * hx, fz = lot.z + sz * hz;
      if (rail.near(fx, fz, 3)) return;
      if (!coast.inLand(fx, fz, 2)) return; // the whole footprint on dry land (R29)
      if (river.inWater(fx, fz) ||
          river.near(fx, fz, river.halfAt(fx, fz) + 1.5)) return;
    }
    // nor spill onto a roundabout's ring (R23: LOT never over PLAZA)
    for (const k of plazaSet) {
      const [pi, pj] = k.split(',').map(Number);
      const nx = Math.max(lot.x - hx, Math.min(pi * CH, lot.x + hx));
      const nz = Math.max(lot.z - hz, Math.min(pj * CH, lot.z + hz));
      if (Math.hypot(nx - pi * CH, nz - pj * CH) < ROUNDABOUT_REACH + 1.5) return;
    }
    // and no lot may overlap another — corner lots of meeting segments used
    // to intersect, baking buildings into buildings. 2.5 m apart keeps kit
    // roof overhangs clear of the neighbour's walls too.
    for (const o of lots) {
      const oflip = Math.abs(Math.abs(o.ry) - Math.PI / 2) < 0.01;
      const ohx = (oflip ? o.d : o.w) / 2, ohz = (oflip ? o.w : o.d) / 2;
      if (Math.abs(o.x - lot.x) < ohx + hx + 2.5 &&
          Math.abs(o.z - lot.z) < ohz + hz + 2.5) return;
    }
    lots.push(lot);
    const k = key(cx, cz);
    if (!lotsByChunk.has(k)) lotsByChunk.set(k, []);
    lotsByChunk.get(k)!.push(lot);
  };
  const rollLot = (dist: District, along: number, roadCentre: number, side: number, ry: number,
                   w: number, horiz: boolean): void => {
    const downtown = dist === 'downtown';
    const industrial = dist === 'industrial';
    const roll = r();
    const depth = industrial ? 10 + r() * 5 : downtown ? 11 + r() * 5 : 8 + r() * 4;
    const centre = roadCentre + side * (8.1 + depth / 2); // road half + sidewalk + half depth
    const x = horiz ? along : centre;
    const z = horiz ? centre : along;
    const pBldg = industrial ? 0.62 : downtown ? 0.74 : 0.5;
    const pTrees = roll + (industrial ? 0.08 : downtown ? 0.12 : 0.22);
    const pPark = industrial ? 0.92 : downtown ? 0.86 : 0.72;
    if (roll < pBldg) {
      addLot({ kind: 'bldg', x, z, ry, w, d: depth, v: r() });
    } else if (roll < pTrees) {
      addLot({ kind: 'trees', x, z, ry, w, d: 6, v: r() });
    } else if (roll < pPark) {
      addLot({ kind: 'parking', x, z, ry, w, d: 6.5, v: r() });
    } // else: empty grass
  };
  for (const j of H) for (let i = 0; i < W; i++) {
    if (!segH(j, i)) continue;
    for (const side of [-1, 1]) {
      let a = i * CH + 12;
      while (a < (i + 1) * CH - 14) {
        const w = 8 + r() * 5;
        if (a + w > (i + 1) * CH - 10) break;
        const along = a + w / 2;
        const cx = Math.floor(along / CH);
        const cz = Math.floor((j * CH + side * 14) / CH);
        const dist = district(cx, cz);
        if (dist === 'urban' || dist === 'downtown' || dist === 'industrial') {
          rollLot(dist, along, j * CH, side, side > 0 ? Math.PI : 0, w, true);
        }
        a += w + 1.6 + r() * 2;
      }
    }
  }
  for (const i of V) for (let j = 0; j < W; j++) {
    if (!segV(i, j)) continue;
    for (const side of [-1, 1]) {
      let b = j * CH + 12;
      while (b < (j + 1) * CH - 14) {
        const w = 8 + r() * 5;
        if (b + w > (j + 1) * CH - 10) break;
        const along = b + w / 2;
        const cx = Math.floor((i * CH + side * 14) / CH);
        const cz = Math.floor(along / CH);
        const dist = district(cx, cz);
        if (dist === 'urban' || dist === 'downtown' || dist === 'industrial') {
          rollLot(dist, along, i * CH, side, side > 0 ? -Math.PI / 2 : Math.PI / 2, w, false);
        }
        b += w + 1.6 + r() * 2;
      }
    }
  }

  // ---- 9. train stations: straight, quiet stretches away from crossings
  // and the river ----
  const stations: Station[] = [];
  {
    const cand: number[] = [];
    for (let d = 0; d < rail.total; d += 4) {
      const h1 = rail.sample(d - 14).h, h2 = rail.sample(d + 14).h;
      let dh = Math.abs(h2 - h1);
      if (dh > Math.PI) dh = Math.PI * 2 - dh;
      if (dh > 0.16) continue; // needs ~28 m of straight track
      const p = rail.sample(d);
      if (p.x < 46 || p.x > ISLAND - 46 || p.z < 46 || p.z > ISLAND - 46) continue;
      if (!coast.inLand(p.x, p.z, 25)) continue;
      if (river.distTo(p.x, p.z) < 18) continue;
      if (crossings.some(c => arcGap(c.d, d, rail.total) < 24 || Math.hypot(c.x - p.x, c.z - p.z) < 17)) continue;
      cand.push(d);
    }
    if (cand.length) {
      const rs = rng(chunkSeed(seed, 0x9a7, 4));
      const chosen: number[] = [cand[(rs() * cand.length) | 0]];
      // space further stations around the loop, away from the earlier ones
      for (let n = 0; n < 2 && chosen.length < 3; n++) {
        const next = cand.find(c => chosen.every(cd =>
          arcGap(c, cd, rail.total) > rail.total * 0.22
          && Math.hypot(rail.sample(c).x - rail.sample(cd).x, rail.sample(c).z - rail.sample(cd).z) > 80));
        if (next === undefined) break;
        chosen.push(next);
      }
      for (const d of chosen) stations.push(mkStation(rail, d));
    }
  }

  const plan: CityPlan = {
    seed,
    bx,
    by,
    lineH, lineV, segH, segV, arms, signalized, plaza, district,
    lots: (cx, cz) => lotsByChunk.get(key(cx, cz)) ?? [],
    crossings,
    riverBridges,
    stations,
    exits,
  };
  return plan;
}

function mkStation(rail: RailRoute, d: number): Station {
  const p = rail.sample(d);
  return { d, x: p.x, z: p.z, h: p.h };
}

/**
 * Pin open street segments the railway crosses head-on: every seed should get
 * its level crossings even when the random drops ate the neighbourhood.
 */
function forceRailCrossings(
  rail: RailRoute,
  H: number[], V: number[],
  segHSet: Set<string>, segVSet: Set<string>,
  skip: (horiz: boolean, line: number, a: number, b: number) => boolean,
): void {
  // `skip` vetoes segments whose river bridge would share the water with a
  // trestle — the rail then crosses a bare lattice line with no street on
  // it, which needs no crossing and piles up nothing
  const veto = (horiz: boolean, line: number, i: number): boolean =>
    skip(horiz, line, i * CH, (i + 1) * CH);
  const pinsH = new Set<string>();
  const pinsV = new Set<string>();
  for (let k = 0; k < rail.pts.length; k++) {
    const p = rail.pts[k];
    // vertical street line i crossed at (i*64, p.z)?
    const i = Math.round(p.x / 64);
    if (V.includes(i) && Math.abs(p.x - i * CH) < 7) {
      const j = Math.floor(p.z / CH);
      if (p.z - j * CH > 18 && (j + 1) * CH - p.z > 18) pinsV.add(key(i, j));
    }
    // horizontal street line j crossed at (p.x, j*64)?
    const j = Math.round(p.z / 64);
    if (H.includes(j) && Math.abs(p.z - j * CH) < 7) {
      const i = Math.floor(p.x / CH);
      if (p.x - i * CH > 18 && (i + 1) * CH - p.x > 18) pinsH.add(key(j, i));
    }
  }
  const add = (set: Set<string>, pins: Set<string>, cap: number, horiz: boolean): void => {
    let n = 0;
    for (const k of pins) {
      if (n >= cap) break;
      if (!set.has(k)) {
        const [a, i] = k.split(',').map(Number);
        if (veto(horiz, a, i)) continue;
        set.add(k);
        n++;
      }
    }
  };
  add(segHSet, pinsH, 6, true);
  add(segVSet, pinsV, 6, false);
}

/** Drop segments that ended up disconnected from the main network. */
function pruneDisconnected(segHSet: Set<string>, segVSet: Set<string>): void {
  // nodes adjacent to at least one open segment
  const armsOf = (i: number, j: number): number =>
    (segHSet.has(key(j, i - 1)) ? 1 : 0) + (segHSet.has(key(j, i)) ? 1 : 0) +
    (segVSet.has(key(i, j - 1)) ? 1 : 0) + (segVSet.has(key(i, j)) ? 1 : 0);
  const nodes = new Set<string>();
  for (const k of segHSet) {
    const [j, i] = k.split(',').map(Number);
    if (armsOf(i, j) > 0) nodes.add(key(i, j));
    if (armsOf(i + 1, j) > 0) nodes.add(key(i + 1, j));
  }
  for (const k of segVSet) {
    const [i, j] = k.split(',').map(Number);
    if (armsOf(i, j) > 0) nodes.add(key(i, j));
    if (armsOf(i, j + 1) > 0) nodes.add(key(i, j + 1));
  }
  // BFS from the first node
  let start: string | null = null;
  let bestSize = 0;
  for (const n0 of nodes) {
    const [si, sj] = n0.split(',').map(Number);
    if (armsOf(si, sj) === 0) continue;
    const seen = new Set<string>([n0]);
    const queue = [n0];
    while (queue.length) {
      const cur = queue.pop()!;
      const [i, j] = cur.split(',').map(Number);
      const step = (ni: number, nj: number, has: boolean): void => {
        const nk = key(ni, nj);
        if (has && nodes.has(nk) && !seen.has(nk)) { seen.add(nk); queue.push(nk); }
      };
      step(i - 1, j, segHSet.has(key(j, i - 1)));
      step(i + 1, j, segHSet.has(key(j, i)));
      step(i, j - 1, segVSet.has(key(i, j - 1)));
      step(i, j + 1, segVSet.has(key(i, j)));
    }
    if (seen.size > bestSize) { bestSize = seen.size; start = n0; }
  }
  if (!start) return;
  // keep only segments touching the best component
  const comp = new Set<string>();
  const queue = [start];
  comp.add(start);
  while (queue.length) {
    const cur = queue.pop()!;
    const [i, j] = cur.split(',').map(Number);
    const step = (ni: number, nj: number, has: boolean): void => {
      const nk = key(ni, nj);
      if (has && nodes.has(nk) && !comp.has(nk)) { comp.add(nk); queue.push(nk); }
    };
    step(i - 1, j, segHSet.has(key(j, i - 1)));
    step(i + 1, j, segHSet.has(key(j, i)));
    step(i, j - 1, segVSet.has(key(i, j - 1)));
    step(i, j + 1, segVSet.has(key(i, j)));
  }
  const keepH = [...segHSet].filter(k => {
    const [j, i] = k.split(',').map(Number);
    return comp.has(key(i, j)) || comp.has(key(i + 1, j));
  });
  const keepV = [...segVSet].filter(k => {
    const [i, j] = k.split(',').map(Number);
    return comp.has(key(i, j)) || comp.has(key(i, j + 1));
  });
  segHSet.clear();
  keepH.forEach(k => segHSet.add(k));
  segVSet.clear();
  keepV.forEach(k => segVSet.add(k));
}
