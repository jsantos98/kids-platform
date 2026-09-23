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
//   4. the tram: a rectangle of streets ringing downtown is reserved, with a
//      stop on each of its four sides
//   5. no dead ends: every street tip that doesn't meet a cross street is
//      trimmed back until it does — roads always connect to the network. The
//      only sanctioned loose ends are the four causeway mouths on the shore
//   6. districts finish: an industrial blob near the railway, streetless urban
//      blocks become green
//   7. junctions: ≥3 street arms → traffic lights, unless the junction became
//      a roundabout or a paved plaza; road×rail crossings and road×river
//      bridge spans are recorded where the corridors meet the streets
//   8. lots: along every street segment, both sides, with proper setbacks;
//      anything too close to the railway or the river stays clear
//   9. two train stations on straight, quiet stretches of the line
//
// Consumers: cityChunk (roads, plazas, lamps, lots, nature, the river bed),
// the traffic lights (via RoadGrid), traffic + pedestrians (street lines),
// transit (crossings, stations, tram) and the minimap.
import { rng, chunkSeed } from '../engine/rng.js';
import { WORLD_CHUNKS, ISLAND, CENTER } from './world.js';
import { citySeed, southExit, eastExit, streetLinesFor } from './cityGrid.js';
import { railRouteFor, type RailRoute } from './railRoute.js';
import { riverFor, type RiverRoute } from './riverRoute.js';
import { arcGap } from './spline.js';

export type District =
  | 'downtown' | 'urban' | 'industrial' | 'park' | 'green'
  | 'forest' | 'meadow' | 'desert'
  | 'race';

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
  /** 'h': the street runs along X (rail crosses it perpendicularly) */
  axis: 'h' | 'v';
  /** arc distance along the rail loop — trains query this */
  d: number;
}

/** a street bridge where the river passes under */
export interface RiverBridge {
  x: number;
  z: number;
  axis: 'h' | 'v';
}

/** a rail stop: platform beside a straight stretch of the line */
export interface Station {
  d: number;
  x: number;
  z: number;
  h: number;
}

export interface TramStop {
  x: number;   // shelter position (beside the tram lane)
  z: number;
  ry: number;  // shelter facing
}

export interface TramPlan {
  /** loop control points (chamfered rectangle through downtown) */
  pts: Array<{ x: number; z: number }>;
  stops: TramStop[];
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
  /** ≥3 arms → traffic lights (roundabouts and plazas are not signalized) */
  signalized(i: number, j: number): boolean;
  /** junction is a traffic circle (no lights, central island) */
  roundabout(i: number, j: number): boolean;
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
  /** the downtown tram loop (always found — its streets are pinned open) */
  tram: TramPlan | null;
  /** where the four causeways to the neighbouring cities land */
  exits: CityExits;
}

const CH = 64;
const W = WORLD_CHUNKS;
const key = (a: number, b: number) => `${a},${b}`;
const cache = new Map<string, CityPlan>();

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
        const dev = Math.abs(h - (horiz ? Math.PI / 2 : 0));
        const parallel = Math.min(dev, Math.PI - dev) < Math.PI / 4;
        if (parallel && ++run >= 3) return true;
        if (!parallel) run = 0;
      } else run = 0;
    }
    return false;
  };

  // ---- 2. districts core: nature corners, park, downtown ----
  const grid: District[][] = Array.from({ length: W }, () => Array<District>(W).fill('urban'));
  for (const [cx, cz] of raceChunks()) grid[cx][cz] = 'race';
  const kinds = [['forest', 'desert', 'meadow'], ['desert', 'meadow', 'forest'], ['meadow', 'forest', 'desert']][(r() * 3) | 0];
  // three 3×3 nature corners (SW, NE, NW)
  const corners: Array<[number, number]> = [[0, 0], [W - 3, 0], [0, W - 3]];
  corners.forEach(([bx, bz], n) => {
    for (let dx = 0; dx < 3; dx++) for (let dz = 0; dz < 3; dz++) {
      grid[bx + dx][bz + dz] = kinds[n] as District;
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
      // arterials keep all their segments (rail shadows still bite)
      const keep = arterialH.has(j) || r() >= dropP;
      if (keep && !railRunsAlong(true, j, i * CH, (i + 1) * CH)) segHSet.add(key(j, i));
    }
    for (const i of V) for (let j = 0; j < W; j++) {
      const keep = arterialV.has(i) || r() >= dropP;
      if (keep && !railRunsAlong(false, i, j * CH, (j + 1) * CH)) segVSet.add(key(i, j));
    }
    forceRailCrossings(rail, H, V, segHSet, segVSet);
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

  // ---- 4. the tram: reserve a rectangle of streets around downtown.
  // Score every candidate perimeter by how many of its segments are already
  // open (and whether the railway shadows a side), pin the best one open.
  // Its closed ring anchors every one of its corners, so it never dangles. ----
  const tram = reserveTram(downtown[0], downtown[1], rail, segHSet, segVSet, r, railRunsAlong);

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
  const collectCrossings = (horiz: boolean, line: number, a: number, b: number): void => {
    // true crossings only: sample spans that actually cross the street line
    // (a rail running alongside within a few metres is not a crossing)
    const c0 = line * CH;
    const pts = rail.pts;
    const hits: Array<{ x: number; z: number; d: number }> = [];
    for (let k = 0; k < pts.length; k++) {
      const p = pts[k], q = pts[(k + 1) % pts.length];
      const pa = horiz ? p.z : p.x, qa = horiz ? q.z : q.x;
      if ((pa - c0) * (qa - c0) >= 0) continue;
      const t = (c0 - pa) / (qa - pa);
      const x = p.x + (q.x - p.x) * t, z = p.z + (q.z - p.z) * t;
      const along = horiz ? x : z;
      if (along < a + 11 || along > b - 11) continue;
      hits.push({ x, z, d: railCum[k] + t * (railCum[k + 1] - railCum[k]) });
    }
    hits.sort((u, v) => (horiz ? u.x - v.x : u.z - v.z));
    let cluster: typeof hits = [];
    const flush = (): void => {
      if (!cluster.length) return;
      const mx = cluster.reduce((s, u) => s + u.x, 0) / cluster.length;
      const mz = cluster.reduce((s, u) => s + u.z, 0) / cluster.length;
      crossings.push({ x: mx, z: mz, axis: horiz ? 'h' : 'v', d: cluster[(cluster.length / 2) | 0].d });
      cluster = [];
    };
    for (const hit of hits) {
      if (!cluster.length) { cluster.push(hit); continue; }
      const prev = cluster[cluster.length - 1];
      if ((horiz ? hit.x - prev.x : hit.z - prev.z) <= 12) cluster.push(hit);
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
    // one bridge per segment: a second pass of the water becomes a ford
    let best: { x: number; z: number } | null = null;
    for (const p of river.pts) {
      const along = horiz ? p.x : p.z;
      const across = horiz ? p.z : p.x;
      if (along < a + 8 || along > b - 8) continue;
      if (Math.abs(across - line * CH) > 8) continue;
      if (!best || Math.abs(along - (a + b) / 2) < Math.abs((horiz ? best.x : best.z) - (a + b) / 2)) {
        best = { x: p.x, z: p.z };
      }
    }
    if (best) riverBridges.push(horiz
      ? { x: best.x, z: line * CH, axis: 'h' as const }
      : { x: line * CH, z: best.z, axis: 'v' as const });
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

  // roundabouts: a seeded few junctions become traffic circles
  const roundaboutSet = new Set<string>();
  {
    const cands: Array<[number, number]> = [];
    for (let i = 1; i < W; i++) for (let j = 1; j < W; j++) {
      if (armsCount(i, j) >= 3 && !nearCrossing(i, j, 26)) cands.push([i, j]);
    }
    for (let k = cands.length - 1; k > 0; k--) {
      const m = (r() * (k + 1)) | 0;
      [cands[k], cands[m]] = [cands[m], cands[k]];
    }
    for (const [i, j] of cands.slice(0, 2 + ((r() * 2) | 0))) roundaboutSet.add(key(i, j));
  }
  const roundabout = (i: number, j: number): boolean => roundaboutSet.has(key(i, j));

  // plazas: a few more junctions become paved squares with a fountain
  const plazaSet = new Set<string>();
  {
    const cands: Array<[number, number]> = [];
    for (let i = 1; i < W; i++) for (let j = 1; j < W; j++) {
      if (armsCount(i, j) >= 3 && !roundabout(i, j) && !nearCrossing(i, j, 30)) cands.push([i, j]);
    }
    for (let k = cands.length - 1; k > 0; k--) {
      const m = (r() * (k + 1)) | 0;
      [cands[k], cands[m]] = [cands[m], cands[k]];
    }
    const want = cands.length ? Math.max(2, 2 + ((r() * 2) | 0)) : 0;
    for (const [i, j] of cands.slice(0, want)) plazaSet.add(key(i, j));
  }
  const plaza = (i: number, j: number): boolean => plazaSet.has(key(i, j));
  const signalized = (i: number, j: number) =>
    armsCount(i, j) >= 3 && !roundabout(i, j) && !plaza(i, j);

  // ---- 8. lots along every street segment, both sides ----
  const lots: Lot[] = [];
  const lotsByChunk = new Map<string, Lot[]>();
  const addLot = (lot: Lot): void => {
    const cx = Math.floor(lot.x / CH), cz = Math.floor(lot.z / CH);
    const dist = district(cx, cz);
    if (dist !== 'urban' && dist !== 'downtown' && dist !== 'industrial') return; // nature/park/race stay clear
    // keep the railway corridor (plus the sweep of a barrier arm) and the
    // river banks clear — nothing built may touch the track
    if (rail.near(lot.x, lot.z, 16)) return;
    if (river.near(lot.x, lot.z, river.halfAt(lot.x, lot.z) + 6.5)) return;
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
    lineH, lineV, segH, segV, arms, signalized, roundabout, plaza, district,
    lots: (cx, cz) => lotsByChunk.get(key(cx, cz)) ?? [],
    crossings,
    riverBridges,
    stations,
    tram,
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
): void {
  const pinsH = new Set<string>();
  const pinsV = new Set<string>();
  for (let k = 0; k < rail.pts.length; k++) {
    const p = rail.pts[k];
    // vertical street line i crossed at (i*64, p.z)?
    const i = Math.round(p.x / 64);
    if (V.includes(i) && Math.abs(p.x - i * CH) < 7) {
      const j = Math.floor(p.z / CH);
      if (p.z - j * CH > 11 && (j + 1) * CH - p.z > 11) pinsV.add(key(i, j));
    }
    // horizontal street line j crossed at (p.x, j*64)?
    const j = Math.round(p.z / 64);
    if (H.includes(j) && Math.abs(p.z - j * CH) < 7) {
      const i = Math.floor(p.x / CH);
      if (p.x - i * CH > 11 && (i + 1) * CH - p.x > 11) pinsH.add(key(j, i));
    }
  }
  const add = (set: Set<string>, pins: Set<string>, cap: number): void => {
    let n = 0;
    for (const k of pins) {
      if (n >= cap) break;
      if (!set.has(k)) { set.add(k); n++; }
    }
  };
  add(segHSet, pinsH, 6);
  add(segVSet, pinsV, 6);
}

/**
 * Reserve the tram rectangle: pick the perimeter around downtown with the
 * most streets already open (railway shadows disqualify a side), then pin any
 * missing perimeter segments open so the loop always exists.
 */
function reserveTram(
  dcx: number, dcz: number,
  rail: RailRoute,
  segHSet: Set<string>, segVSet: Set<string>,
  r: () => number,
  railRunsAlong: (horiz: boolean, line: number, a: number, b: number) => boolean,
): TramPlan | null {
  const rects: Array<{ i0: number; j0: number; n: number; score: number }> = [];
    for (const n of [4, 3, 2]) {
      for (const di of [-1, 0]) for (const dj of [-1, 0]) {
        const i0 = dcx + di, j0 = dcz + dj;
        if (i0 < 0 || j0 < 0 || i0 + n > W || j0 + n > W) continue;
        if (!(i0 <= dcx && dcx < i0 + n && j0 <= dcz && dcz < j0 + n)) continue;
        rects.push({ i0, j0, n, score: 0 });
      }
    }
  if (!rects.length) return null;
  // score: +2 per already-open perimeter segment, −6 per railway-shadowed one
  for (const rc of rects) {
    const i1 = rc.i0 + rc.n, j1 = rc.j0 + rc.n;
    for (let i = rc.i0; i < i1; i++) {
      if (segHSet.has(key(rc.j0, i))) rc.score += 2;
      if (segHSet.has(key(j1, i))) rc.score += 2;
      if (railRunsAlong(true, rc.j0, i * CH, (i + 1) * CH)) rc.score -= 6;
      if (railRunsAlong(true, j1, i * CH, (i + 1) * CH)) rc.score -= 6;
    }
    for (let j = rc.j0; j < j1; j++) {
      if (segVSet.has(key(rc.i0, j))) rc.score += 2;
      if (segVSet.has(key(i1, j))) rc.score += 2;
      if (railRunsAlong(false, rc.i0, j * CH, (j + 1) * CH)) rc.score -= 6;
      if (railRunsAlong(false, i1, j * CH, (j + 1) * CH)) rc.score -= 6;
    }
  }
  rects.sort((a, b) => b.score - a.score || (r() < 0.5 ? -1 : 1));
  const win = rects[0];
  const i1 = win.i0 + win.n, j1 = win.j0 + win.n;
  // pin the whole perimeter open
  for (let i = win.i0; i < i1; i++) {
    segHSet.add(key(win.j0, i));
    segHSet.add(key(j1, i));
  }
  for (let j = win.j0; j < j1; j++) {
    segVSet.add(key(win.i0, j));
    segVSet.add(key(i1, j));
  }
  // chamfered perimeter: corner cuts keep the tram from jerking 90°
  const corners = [[win.i0, win.j0], [i1, win.j0], [i1, j1], [win.i0, j1]];
  const pts: Array<{ x: number; z: number }> = [];
  const C = 9;
  for (let k = 0; k < 4; k++) {
    const [ci, cj] = corners[k];
    const [pi, pj] = corners[(k + 3) % 4];
    const [ni, nj] = corners[(k + 1) % 4];
    const inX = Math.sign(ci - pi), inZ = Math.sign(cj - pj);
    const outX = Math.sign(ni - ci), outZ = Math.sign(nj - cj);
    pts.push({ x: ci * CH - inX * C, z: cj * CH - inZ * C });
    pts.push({ x: ci * CH + outX * C, z: cj * CH + outZ * C });
    pts.push({ x: (ci + ni) / 2 * CH, z: (cj + nj) / 2 * CH }); // straightener
  }
  // a stop on each side, shelter just outside the loop
  const stops: TramStop[] = [];
  for (let k = 0; k < 4; k++) {
    const [ci, cj] = corners[k];
    const [ni, nj] = corners[(k + 1) % 4];
    const mx = (ci + ni) / 2 * CH, mz = (cj + nj) / 2 * CH;
    const horiz = cj === nj;
    const outward = horiz ? (cj * CH < CENTER ? -1 : 1) : (ci * CH < CENTER ? -1 : 1);
    stops.push({
      x: horiz ? mx : mx + outward * 5.7,
      z: horiz ? mz + outward * 5.7 : mz,
      ry: horiz ? Math.PI / 2 : 0,
    });
  }
  return { pts, stops };
}

function raceChunks(): Array<[number, number]> {
  const b = W - 2;
  return [[b, b], [b + 1, b], [b, b + 1], [b + 1, b + 1]];
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
