// The city plan: a seeded, top-down generator for the island world. Instead of
// ad-hoc rules sprinkled through the chunk baker, everything is decided HERE,
// in one deterministic pass per world seed, and the rest of the game just
// replays the plan:
//
//   1. the railway claims its corridors (railRoute.ts, generated first)
//   2. street lines: a seeded subset of the interior lattice lines — not every
//      line, so blocks come out irregular; segments are then dropped at random
//      and anything disconnected from the main network is pruned
//   3. signalized intersections: nodes where ≥3 street arms meet
//   4. districts: three seeded nature corners (forest / desert / meadow), a
//      park next to downtown, a downtown chunk with big buildings, an
//      industrial district hugging the railway, the fixed race corner — the
//      rest is urban fabric
//   5. lots: along every street segment, both sides, with proper setbacks;
//      contents rolled per district (building / trees / parking / grass)
//
// Consumers: cityChunk (roads, node tiles, lamps, lots, nature), the traffic
// lights (via RoadGrid), traffic + pedestrians (street lines), and the minimap.
import { rng, chunkSeed } from '../engine/rng.js';
import { railRouteFor } from './railRoute.js';

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

export interface CityPlan {
  seed: number;
  /** street lines (any open segment somewhere on the line) */
  lineH(j: number): boolean;
  lineV(i: number): boolean;
  /** open street segment: horizontal line j across chunk-column i */
  segH(j: number, i: number): boolean;
  /** open street segment: vertical line i across chunk-row j */
  segV(i: number, j: number): boolean;
  /** number of street arms meeting at lattice node (i, j) */
  arms(i: number, j: number): boolean[];
  /** ≥3 arms → traffic lights */
  signalized(i: number, j: number): boolean;
  /** junction is a traffic circle (no lights, central island) */
  roundabout(i: number, j: number): boolean;
  district(cx: number, cz: number): District;
  /** lots whose centre falls inside chunk (cx, cz) */
  lots(cx: number, cz: number): Lot[];
}

const CH = 64;
const key = (a: number, b: number) => `${a},${b}`;
const cache = new Map<number, CityPlan>();

export function cityPlanFor(seed: number): CityPlan {
  let plan = cache.get(seed);
  if (!plan) {
    plan = buildPlan(seed);
    cache.set(seed, plan);
  }
  return plan;
}

function buildPlan(seed: number): CityPlan {
  const r = rng(chunkSeed(seed, 0xc17, 0));
  const rail = railRouteFor(seed);

  // ---- 1. street lines: seeded subset of interior lines, ≥2 per axis ----
  const pickLines = () => [1, 2, 3, 4, 5].filter(() => r() < 0.62);
  const H = pickLines();
  const V = pickLines();
  for (const missing of [1, 2, 3, 4, 5]) {
    if (H.length >= 2) break;
    if (!H.includes(missing)) H.push(missing);
  }
  for (const missing of [1, 2, 3, 4, 5]) {
    if (V.length >= 2) break;
    if (!V.includes(missing)) V.push(missing);
  }
  // race-corner access: keep the zone boundary line (4) as a street
  if (!H.includes(4) && !V.includes(4)) H.push(4);
  H.sort((a, b) => a - b);
  V.sort((a, b) => a - b);
  const hSet = new Set(H), vSet = new Set(V);

  // ---- 2. segments: all segments of chosen lines, minus rail corridors,
  // minus seeded drops (retrying looser until the network is dense enough),
  // then keep the connected component ----
  let segHSet = new Set<string>(); // key(j, i)
  let segVSet = new Set<string>(); // key(i, j)
  for (let attempt = 0; attempt < 4; attempt++) {
    const dropP = Math.max(0.02, 0.14 - attempt * 0.05);
    segHSet = new Set();
    segVSet = new Set();
    for (const j of H) for (let i = 0; i <= 5; i++) {
      if (!rail.edgeH(j, i) && r() >= dropP) segHSet.add(key(j, i));
    }
    for (const i of V) for (let j = 0; j <= 5; j++) {
      if (!rail.edgeV(i, j) && r() >= dropP) segVSet.add(key(i, j));
    }
    let count = segHSet.size + segVSet.size;
    pruneDisconnected(segHSet, segVSet);
    count = segHSet.size + segVSet.size;
    if (count >= 14) break;
  }

  const segH = (j: number, i: number) => segHSet.has(key(j, i));
  const segV = (i: number, j: number) => segVSet.has(key(i, j));
  const lineH = (j: number) => H.includes(j) && [0, 1, 2, 3, 4, 5].some(i => segH(j, i));
  const lineV = (i: number) => V.includes(i) && [0, 1, 2, 3, 4, 5].some(j => segV(i, j));

  // ---- 3. arms + signals ----
  const arms = (i: number, j: number): boolean[] => {
    const w = segH(j, i - 1), e = segH(j, i), n = segV(i, j - 1), s = segV(i, j);
    return [w, e, n, s].filter(Boolean);
  };
  const armDirs = (i: number, j: number) => ({
    w: segH(j, i - 1), e: segH(j, i), n: segV(i, j - 1), s: segV(i, j),
  });

  // ---- 3b. roundabouts: a seeded couple of junctions become traffic
  // circles instead of signalized crossings (no lights there) ----
  const roundaboutSet = new Set<string>();
  {
    const cands: Array<[number, number]> = [];
    for (let i = 1; i <= 5; i++) for (let j = 1; j <= 5; j++) {
      if (arms(i, j).length >= 3 && !rail.nodeOnRoute(i, j)) cands.push([i, j]);
    }
    for (let k = cands.length - 1; k > 0; k--) {
      const m = (r() * (k + 1)) | 0;
      [cands[k], cands[m]] = [cands[m], cands[k]];
    }
    for (const [i, j] of cands.slice(0, 1 + ((r() * 2) | 0))) roundaboutSet.add(key(i, j));
  }
  const roundabout = (i: number, j: number): boolean => roundaboutSet.has(key(i, j));
  const signalized = (i: number, j: number) => arms(i, j).length >= 3 && !roundabout(i, j);

  // ---- 4. districts ----
  const grid: District[][] = Array.from({ length: 6 }, () => Array<District>(6).fill('urban'));
  for (const [cx, cz] of raceChunks()) grid[cx][cz] = 'race';
  // three nature corners, seeded assignment of forest / desert / meadow
  const kinds = [['forest', 'desert', 'meadow'], ['desert', 'meadow', 'forest'], ['meadow', 'forest', 'desert']][(r() * 3) | 0];
  const corners: Array<[number, number]> = [[0, 0], [4, 0], [0, 4]];
  corners.forEach(([bx, bz], n) => {
    for (let dx = 0; dx < 2; dx++) for (let dz = 0; dz < 2; dz++) {
      grid[bx + dx][bz + dz] = kinds[n] as District;
    }
  });
  // a park next to downtown, then downtown = the central chunk left over
  const centre = [[2, 2], [3, 2], [2, 3], [3, 3]].filter(([cx, cz]) => grid[cx][cz] === 'urban');
  const park = centre[(r() * centre.length) | 0] ?? [2, 2];
  grid[park[0]][park[1]] = 'park';
  const downtown = centre.find(([cx, cz]) => !(cx === park[0] && cz === park[1])) ?? [2, 2];
  grid[downtown[0]][downtown[1]] = 'downtown';
  // an industrial district: seeded blob of 2-4 urban chunks, anchored on a
  // chunk whose edges touch the railway (freight needs a siding) and with
  // street frontage so its lots get built
  const frontage = (cx: number, cz: number): boolean =>
    segH(cz, cx) || segH(cz + 1, cx) || segV(cx, cz) || segV(cx + 1, cz);
  const railFrontage = (cx: number, cz: number): boolean =>
    rail.edgeH(cz, cx) || rail.edgeH(cz + 1, cx) || rail.edgeV(cx, cz) || rail.edgeV(cx + 1, cz);
  const urbanLeft = (): Array<[number, number]> => {
    const out: Array<[number, number]> = [];
    for (let cx = 0; cx < 6; cx++) for (let cz = 0; cz < 6; cz++) {
      if (grid[cx][cz] === 'urban' && frontage(cx, cz)) out.push([cx, cz]);
    }
    return out;
  };
  const withRail = urbanLeft().filter(([cx, cz]) => railFrontage(cx, cz));
  const anchorList = withRail.length ? withRail : urbanLeft();
  if (anchorList.length) {
    const anchor = anchorList[(r() * anchorList.length) | 0];
    const zone: Array<[number, number]> = [anchor];
    const want = 2 + ((r() * 3) | 0); // 2..4 chunks
    while (zone.length < want) {
      const next: Array<[number, number]> = [];
      for (const [cx, cz] of zone) {
        for (const [nx, nz] of [[cx + 1, cz], [cx - 1, cz], [cx, cz + 1], [cx, cz - 1]] as const) {
          if (nx < 0 || nx > 5 || nz < 0 || nz > 5) continue;
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
  // urban blocks with no street frontage become green space (tree-filled)
  for (let cx = 0; cx < 6; cx++) for (let cz = 0; cz < 6; cz++) {
    if (grid[cx][cz] === 'urban' && !frontage(cx, cz)) grid[cx][cz] = 'green';
  }
  const district = (cx: number, cz: number): District =>
    cx < 0 || cz < 0 || cx > 5 || cz > 5 ? 'urban' : grid[cx][cz];

  // ---- 5. lots along every street segment, both sides ----
  const lots: Lot[] = [];
  const lotsByChunk = new Map<string, Lot[]>();
  const addLot = (lot: Lot): void => {
    const cx = Math.floor(lot.x / CH), cz = Math.floor(lot.z / CH);
    const dist = district(cx, cz);
    if (dist !== 'urban' && dist !== 'downtown' && dist !== 'industrial') return; // nature/park/race stay clear
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
    const centre = roadCentre + side * (6.6 + depth / 2); // road half + sidewalk + half depth
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
  for (const j of H) for (let i = 0; i <= 5; i++) {
    if (!segH(j, i)) continue;
    for (const side of [-1, 1]) {
      let a = i * CH + 9;
      while (a < (i + 1) * CH - 11) {
        const w = 8 + r() * 5;
        if (a + w > (i + 1) * CH - 8) break;
        const along = a + w / 2;
        const cx = Math.floor(along / CH);
        const cz = Math.floor((j * CH + side * 12) / CH);
        const dist = district(cx, cz);
        if (dist === 'urban' || dist === 'downtown' || dist === 'industrial') {
          rollLot(dist, along, j * CH, side, side > 0 ? Math.PI : 0, w, true);
        }
        a += w + 1.6 + r() * 2;
      }
    }
  }
  for (const i of V) for (let j = 0; j <= 5; j++) {
    if (!segV(i, j)) continue;
    for (const side of [-1, 1]) {
      let b = j * CH + 9;
      while (b < (j + 1) * CH - 11) {
        const w = 8 + r() * 5;
        if (b + w > (j + 1) * CH - 8) break;
        const along = b + w / 2;
        const cx = Math.floor((i * CH + side * 12) / CH);
        const cz = Math.floor(along / CH);
        const dist = district(cx, cz);
        if (dist === 'urban' || dist === 'downtown' || dist === 'industrial') {
          rollLot(dist, along, i * CH, side, side > 0 ? -Math.PI / 2 : Math.PI / 2, w, false);
        }
        b += w + 1.6 + r() * 2;
      }
    }
  }

  const plan: CityPlan = {
    seed,
    lineH, lineV, segH, segV, arms, signalized, roundabout, district,
    lots: (cx, cz) => lotsByChunk.get(key(cx, cz)) ?? [],
  };
  return plan;
}

function raceChunks(): Array<[number, number]> {
  return [[4, 4], [5, 4], [4, 5], [5, 5]];
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
