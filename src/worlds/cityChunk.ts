// The little island city — chunk baker. All design decisions live in the city
// plan (cityPlan.ts, seeded per world); this file just renders one 64 m chunk
// of that plan into a vertex-colored mesh: streets, node tiles, level
// crossings, lamps, building lots, park ponds, nature scatter, the beach ring
// and the race circuit. The whole island is built once at boot.
import * as THREE from 'three';
import { Baked } from '../engine/baked.js';
import { rng, chunkSeed, type Rng } from '../engine/rng.js';
import { bakedModel, type BakedTemplate } from '../engine/assets.js';
import { raceZoneChunk, raceTiles, tileCenter, RACE_TILE } from './racetrack.js';
import { cityPlanFor, type District, type Lot } from './cityPlan.js';
import { railRouteFor } from './railRoute.js';

export const WORLD_CHUNKS = 6; // island is 6×6 chunks = 384 × 384 m

export interface CollisionBox {
  x1: number; x2: number; z1: number; z2: number;
  small?: number;
}

export interface CityChunkResult {
  mesh: THREE.Mesh;
  boxes: CollisionBox[];
}

const j = (r: Rng, amp: number) => (r() - 0.5) * 2 * amp;
const pick = <T,>(r: Rng, arr: T[]): T => arr[(r() * arr.length) | 0];

// ---- Kenney kit placement helpers ----
const _km = new THREE.Matrix4();
const _kq = new THREE.Quaternion();
const _ke = new THREE.Euler();
const _kv = new THREE.Vector3();
const _ks = new THREE.Vector3();

function bakeModel(B: Baked, tpl: BakedTemplate, x: number, y: number, z: number, ry: number, s: number, s3: [number, number, number] | null = null): void {
  _ke.set(0, ry, 0);
  _kq.setFromEuler(_ke);
  if (s3) _ks.set(s3[0], s3[1], s3[2]);
  else _ks.set(s, s, s);
  _km.compose(_kv.set(x, y, z), _kq, _ks);
  for (const g of tpl.geos) B.raw(g.clone().applyMatrix4(_km));
}

function kenneyTPL() {
  const names = ['bldg-a', 'bldg-b', 'bldg-c', 'bldg-d', 'bldg-e', 'bldg-f', 'bldg-g',
    'bldg-h', 'bldg-i', 'bldg-j', 'bldg-k', 'bldg-l', 'bldg-m', 'bldg-n'].map(bakedModel).filter((t): t is BakedTemplate => !!t);
  return {
    buildings: names,
    trees: ['tree-default', 'tree-oak', 'tree-detailed', 'tree-fat', 'tree-thin', 'tree-small']
      .map(bakedModel).filter((t): t is BakedTemplate => !!t),
    pines: ['pine-a', 'pine-b', 'pine-c'].map(bakedModel).filter((t): t is BakedTemplate => !!t),
    cacti: ['cactus-short', 'cactus-tall'].map(bakedModel).filter((t): t is BakedTemplate => !!t),
    rocks: ['rock-a', 'rock-b'].map(bakedModel).filter((t): t is BakedTemplate => !!t),
    lightCurved: bakedModel('light-curved'),
    roadStraight: bakedModel('road-straight') ?? { geos: [], size: { x: 1, y: 1, z: 1 }, center: { x: 0, z: 0 } },
    roadCrossroad: bakedModel('road-crossroad') ?? { geos: [], size: { x: 1, y: 1, z: 1 }, center: { x: 0, z: 0 } },
    roadCrossing: bakedModel('road-crossing') ?? { geos: [], size: { x: 1, y: 1, z: 1 }, center: { x: 0, z: 0 } },
    raceStraight: bakedModel('race-straight'),
    raceCorner: bakedModel('race-corner'),
    raceFinish: bakedModel('race-finish'),
    cars: ['car-sedan', 'car-suv', 'car-taxi', 'car-hatch'].map(bakedModel).filter((t): t is BakedTemplate => !!t),
  };
}

const BEACH = 0xf0e2c0;
const HOUSE_COLORS = [0xf2e4cf, 0xf9d9bd, 0xc3ddef, 0xcfe8d8, 0xf3c4d3, 0xdcd0ec, 0xf9e7b0, 0xe8ddd0];
const ROOFS = [0xcf7d6d, 0x8ba7bf, 0xc4a687, 0x9dbd80, 0xb8a4d4];
const ROAD_DASH_X = 0;

export function slabColor(d: District): number {
  switch (d) {
    case 'forest': return 0x7ba363;
    case 'desert': return 0xe8d29a;
    case 'meadow': return 0xa9c88b;
    case 'green': return 0xa9c88b;
    case 'race': return 0xa9c88b;
    case 'park': return 0xa4cf85;
    case 'downtown': return 0xdcd6c6;
    default: return 0xe9e1cf; // urban
  }
}

/** ground colour of a chunk (ocean blue outside the island) — for the minimap */
export function chunkGroundColor(seed: number, cx: number, cz: number): number {
  if (cx < 0 || cz < 0 || cx >= WORLD_CHUNKS || cz >= WORLD_CHUNKS) return 0x6fb7d9;
  return slabColor(cityPlanFor(seed).district(cx, cz));
}

export function generateCityChunk(seed: number, cx: number, cz: number): CityChunkResult {
  const r = rng(chunkSeed(seed, cx, cz));
  const CH = 64, X0 = cx * CH, Z0 = cz * CH;
  const B = new Baked();
  const boxes: CollisionBox[] = [];
  const TPL = kenneyTPL();
  const plan = cityPlanFor(seed);
  const rail = railRouteFor(seed);
  const district = plan.district(cx, cz);

  // base slab — district ground, sand beach ring at the border
  B.box(CH, 0.1, CH, slabColor(district), X0 + CH / 2, 0.05, Z0 + CH / 2);
  if (cx === 0) B.box(6, 0.1, CH, BEACH, X0 + 3, 0.05, Z0 + CH / 2);
  if (cx === WORLD_CHUNKS - 1) B.box(6, 0.1, CH, BEACH, X0 + CH - 3, 0.05, Z0 + CH / 2);
  if (cz === 0) B.box(CH, 0.1, 6, BEACH, X0 + CH / 2, 0.05, Z0 + 3);
  if (cz === WORLD_CHUNKS - 1) B.box(CH, 0.1, 6, BEACH, X0 + CH / 2, 0.05, Z0 + CH - 3);

  // ---- streets: this chunk's south (z=Z0) and west (x=X0) edges ----
  const TS = 10, TY = 0.11;
  const roadS = plan.segH(cz, cx);
  const roadW = plan.segV(cx, cz);
  for (let k = 0; k < 6; k++) {
    const c = TS / 2 + k * TS;
    if (roadS) bakeModel(B, TPL.roadStraight, X0 + c, TY, Z0, ROAD_DASH_X, 1, [TS, TS, TS]);
    if (roadW) bakeModel(B, TPL.roadStraight, X0, TY, Z0 + c, ROAD_DASH_X + Math.PI / 2, 1, [TS, TS, TS]);
  }

  // ---- node tile at the chunk's SW corner (X0, Z0) ----
  const a = plan.arms(cx, cz); // [west, east, north, south]
  const armCount = a.filter(Boolean).length;
  const railHere = rail.nodeOnRoute(cx, cz);
  if (railHere && armCount >= 2) {
    // level crossing: rails run one way, the road crosses them
    const railVertical = rail.edgeV(cx, cz) || rail.edgeV(cx, cz - 1);
    bakeModel(B, TPL.roadCrossing, X0, TY, Z0,
      railVertical ? ROAD_DASH_X : ROAD_DASH_X + Math.PI / 2, 1, [TS, TS, TS]);
  } else if (armCount >= 3) {
    bakeModel(B, TPL.roadCrossroad, X0, TY, Z0, 0, TS);
  } else if (armCount === 2 && ((a[0] && a[1]) || (a[2] && a[3]))) {
    // straight-through node
    const alongX = !!(a[0] && a[1]);
    bakeModel(B, TPL.roadStraight, X0, TY, Z0, alongX ? ROAD_DASH_X : ROAD_DASH_X + Math.PI / 2, 1, [TS, TS, TS]);
  } else if (armCount === 2 || (armCount === 1 && railHere)) {
    bakeModel(B, TPL.roadCrossroad, X0, TY, Z0, 0, TS); // L-corner or stub by a crossing
  }

  // working traffic lights are dynamic objects (chunks.ts) at signalized nodes;
  // chunks only keep their corner collision boxes
  if (plan.signalized(cx, cz)) {
    for (const [tx, tz] of [[X0 + 5.8, Z0 + 5.8], [X0 - 5.8, Z0 - 5.8]]) {
      boxes.push({ x1: tx - 0.4, x2: tx + 0.4, z1: tz - 0.4, z2: tz + 0.4, small: 1 });
    }
  }

  // street lamps along surviving streets (urban fabric only)
  const lampDistrict = district === 'urban' || district === 'downtown';
  if (lampDistrict) {
    for (let d = 10; d < CH; d += 18) {
      if (TPL.lightCurved) {
        if (roadS) bakeModel(B, TPL.lightCurved, X0 + d, 0.1, Z0 + 5.4, 0, 5.5);
        if (roadW) bakeModel(B, TPL.lightCurved, X0 + 5.4, 0.1, Z0 + d, Math.PI / 2, 5.5);
      }
      if (roadS) boxes.push({ x1: X0 + d - 0.3, x2: X0 + d + 0.3, z1: Z0 + 5.1, z2: Z0 + 5.7, small: 1 });
      if (roadW) boxes.push({ x1: X0 + 5.1, x2: X0 + 5.7, z1: Z0 + d - 0.3, z2: Z0 + d + 0.3, small: 1 });
    }
  }

  // ---- lots: buildings, tree rows and parking, laid out by the plan ----
  for (const lot of plan.lots(cx, cz)) bakeLot(lot);

  function bakeLot(lot: Lot): void {
    if (lot.kind === 'bldg') {
      const tpls = TPL.buildings;
      if (tpls.length) {
        const tpl = tpls[((lot.v * tpls.length) | 0) % tpls.length];
        const s = Math.min((lot.w * 0.92) / tpl.size.x, (lot.d * 0.92) / tpl.size.z);
        bakeModel(B, tpl, lot.x, 0.1, lot.z, lot.ry, s);
        // collision AABB from the rotated footprint (ry is axis-aligned)
        const flip = Math.abs(Math.abs(lot.ry) - Math.PI / 2) < 0.01;
        const hx = (flip ? lot.d : lot.w) / 2, hz = (flip ? lot.w : lot.d) / 2;
        boxes.push({ x1: lot.x - hx, x2: lot.x + hx, z1: lot.z - hz, z2: lot.z + hz });
      } else {
        // procedural fallback house
        const h = 2.9 * (2 + ((lot.v * 3) | 0)) + 0.6;
        const flip = Math.abs(Math.abs(lot.ry) - Math.PI / 2) < 0.01;
        const hx = (flip ? lot.d : lot.w) / 2.4, hz = (flip ? lot.w : lot.d) / 2.4;
        B.box(hx * 2, h, hz * 2, HOUSE_COLORS[(lot.v * HOUSE_COLORS.length) | 0], lot.x, h / 2, lot.z);
        B.box(hx * 2 + 0.3, 0.3, hz * 2 + 0.3, ROOFS[(lot.v * ROOFS.length) | 0], lot.x, h + 0.15, lot.z);
        boxes.push({ x1: lot.x - hx, x2: lot.x + hx, z1: lot.z - hz, z2: lot.z + hz });
      }
    } else if (lot.kind === 'trees') {
      bakeTrees(lot.x, lot.z, 2 + ((lot.v * 2) | 0), lot.w / 2);
    } else {
      // parking lot: slab + a car or two
      const flip = Math.abs(Math.abs(lot.ry) - Math.PI / 2) < 0.01;
      const wx = flip ? lot.d : lot.w, wz = flip ? lot.w : lot.d;
      B.box(wx, 0.06, wz, 0x828a96, lot.x, 0.14, lot.z);
      const n = 1 + ((lot.v * 2) | 0);
      for (let i = 0; i < n; i++) {
        const off = (i - (n - 1) / 2) * (lot.w / 2.2);
        const cxx = flip ? lot.x : lot.x + off;
        const czz = flip ? lot.z + off : lot.z;
        bakeParkedCar(cxx, czz, flip ? Math.PI / 2 : 0);
        boxes.push({
          x1: cxx - (flip ? 2.3 : 1.0), x2: cxx + (flip ? 2.3 : 1.0),
          z1: czz - (flip ? 1.0 : 2.3), z2: czz + (flip ? 1.0 : 2.3),
        });
      }
    }
  }

  function bakeTrees(x: number, z: number, n = 3, spread = 3): void {
    for (let i = 0; i < n; i++) {
      const tx = x + j(r, spread), tz = z + j(r, spread);
      if (TPL.trees.length) {
        bakeModel(B, pick(r, TPL.trees), tx, 0.08, tz, r() * Math.PI * 2, 5 + r() * 2.5);
      }
      boxes.push({ x1: tx - 0.55, x2: tx + 0.55, z1: tz - 0.55, z2: tz + 0.55, small: 1 });
    }
  }

  function bakeParkedCar(x: number, z: number, ry: number): void {
    if (TPL.cars.length) {
      const tpl = pick(r, TPL.cars);
      bakeModel(B, tpl, x, 0.17, z, ry, 4.3 / Math.max(tpl.size.x, tpl.size.z));
    }
  }

  // ---- district dressing ----
  if (district === 'park') {
    // a pond with a tree ring and a couple of benches
    const px = X0 + CH / 2 + j(r, 6), pz = Z0 + CH / 2 + j(r, 6);
    const pr = 8 + r() * 3;
    B.cyl(pr, pr, 0.08, 18, 0x7fc4de, px, 0.13, pz);
    B.cyl(pr + 1.4, pr + 1.4, 0.06, 18, 0xd9cdb4, px, 0.12, pz); // sandy rim
    for (let k = 0; k < 7; k++) {
      const ang = (k / 7) * Math.PI * 2 + r();
      bakeTrees(px + Math.cos(ang) * 15, pz + Math.sin(ang) * 15, 1, 2.5);
    }
    for (const s of [-1, 1]) {
      B.box(1.6, 0.08, 0.45, 0xa9805a, px + s * 11.5, 0.55, pz + j(r, 3));
    }
  } else if (district === 'forest' || district === 'desert' || district === 'meadow') {
    scatterNature(district);
  } else if (district === 'green') {
    // streetless block: a little wooded green
    for (let k = 0; k < 8; k++) {
      const x = X0 + 10 + r() * (CH - 20), z = Z0 + 10 + r() * (CH - 20);
      if (nearStreet(x, z)) continue;
      bakeModel(B, pick(r, [...TPL.trees, ...TPL.pines]), x, 0.08, z, r() * Math.PI * 2, 4 + r() * 3);
      boxes.push({ x1: x - 0.6, x2: x + 0.6, z1: z - 0.6, z2: z + 0.6, small: 1 });
    }
  }

  function nearStreet(x: number, z: number): boolean {
    // keep scatter clear of street/rail corridors through this chunk
    const lx = Math.round(x / CH), lz = Math.round(z / CH);
    if (Math.abs(x - lx * CH) < 7 &&
        (plan.segV(lx, cz) || plan.segV(lx, cz - 1) || rail.edgeV(lx, cz) || rail.edgeV(lx, cz - 1))) return true;
    if (Math.abs(z - lz * CH) < 7 &&
        (plan.segH(lz, cx) || plan.segH(lz, cx - 1) || rail.edgeH(lz, cx) || rail.edgeH(lz, cx - 1))) return true;
    return false;
  }

  function scatterNature(kind: 'forest' | 'desert' | 'meadow'): void {
    const tries = kind === 'forest' ? 30 : kind === 'desert' ? 14 : 18;
    for (let i = 0; i < tries; i++) {
      const x = X0 + 7 + r() * (CH - 14);
      const z = Z0 + 7 + r() * (CH - 14);
      if (nearStreet(x, z)) continue;
      let tpl: BakedTemplate | null = null;
      const s = 3.5 + r() * 2.5;
      if (kind === 'forest') tpl = pick(r, [...TPL.pines, ...TPL.trees]);
      else if (kind === 'desert') tpl = pick(r, [...TPL.cacti, ...TPL.rocks]);
      else tpl = pick(r, TPL.trees);
      if (!tpl) continue;
      bakeModel(B, tpl, x, 0.08, z, r() * Math.PI * 2, s);
      boxes.push({ x1: x - 0.6, x2: x + 0.6, z1: z - 0.6, z2: z + 0.6, small: 1 });
    }
  }

  // race circuit: bake the tiles whose centre falls inside this chunk
  if (district === 'race' && TPL.raceStraight && TPL.raceCorner) {
    for (const t of raceTiles()) {
      const c = tileCenter(t.col, t.row);
      if (c.x < X0 || c.x >= X0 + CH || c.z < Z0 || c.z >= Z0 + CH) continue;
      const tpl = t.kind === 'straight' ? TPL.raceStraight
        : t.kind === 'corner' ? TPL.raceCorner
        : t.kind === 'finish' ? TPL.raceFinish : TPL.raceStraight;
      if (!tpl) continue;
      bakeModel(B, tpl, c.x, TY, c.z, t.rot, 1, [RACE_TILE, RACE_TILE, RACE_TILE]);
    }
  }

  return { mesh: B.build(), boxes };
}
