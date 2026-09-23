// The little island city — chunk baker. All design decisions live in the city
// plan (cityPlan.ts, seeded per world); this file just renders one 64 m chunk
// of that plan into a vertex-colored mesh: wide streets, node tiles, round-
// abouts and plazas, lamps, building lots, park ponds, the river with its
// banks, fords and street bridges, nature scatter, the beach ring and the
// race circuit. The whole island is built once at boot.
import * as THREE from 'three';
import { Baked } from '../engine/baked.js';
import { rng, chunkSeed, type Rng } from '../engine/rng.js';
import { bakedModel, type BakedTemplate } from '../engine/assets.js';
import { raceTiles, tileCenter } from './racetrack.js';
import { cityPlanFor, type District, type Lot } from './cityPlan.js';
import { railRouteFor } from './railRoute.js';
import { riverFor } from './riverRoute.js';
import { citySeed } from './cityGrid.js';
import { WORLD_CHUNKS, ISLAND } from './world.js';
import { STRAIT } from './cityGrid.js';

export { WORLD_CHUNKS }; // re-exported for the game layer

const CAUSEWAY_ASPHALT = 0x5f6771;
const CAUSEWAY_DASH = 0xe8e4d8;
const CAUSEWAY_CURB = 0xcfc9ba;
const CAUSEWAY_CAP = 0x9a948a;

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
    raceStraight: bakedModel('race-straight'),
    raceCorner: bakedModel('race-corner'),
    raceFinish: bakedModel('race-finish'),
    cars: ['car-sedan', 'car-suv', 'car-taxi', 'car-hatch'].map(bakedModel).filter((t): t is BakedTemplate => !!t),
    industrial: [...'abcdefghijklmnopqrst'].map(b => bakedModel('ind-' + b)).filter((t): t is BakedTemplate => !!t),
    indExtras: ['ind-tank', 'ind-tank-l', 'ind-box-a', 'ind-box-b', 'ind-box-c']
      .map(bakedModel).filter((t): t is BakedTemplate => !!t),
    chimney: bakedModel('ind-chimney-l') ?? bakedModel('ind-chimney-m'),
    waterTower: bakedModel('ind-tower'),
    windmill: bakedModel('ind-mill'),
  };
}

const BEACH = 0xf0e2c0;
const RIVER_WATER = 0x5fadc9;
const RIVER_BANK = 0xdfd3b4;
const RIVER_PATH = 0xd9cdb4;
const BRIDGE_STEEL = 0x8f97a3;
const HOUSE_COLORS = [0xf2e4cf, 0xf9d9bd, 0xc3ddef, 0xcfe8d8, 0xf3c4d3, 0xdcd0ec, 0xf9e7b0, 0xe8ddd0];
const ROOFS = [0xcf7d6d, 0x8ba7bf, 0xc4a687, 0x9dbd80, 0xb8a4d4];
const ROAD_HALF = 7;      // 14 m carriageway — roomy for little drivers

export function slabColor(d: District): number {
  switch (d) {
    case 'forest': return 0x7ba363;
    case 'desert': return 0xe8d29a;
    case 'meadow': return 0xa9c88b;
    case 'green': return 0xa9c88b;
    case 'race': return 0xa9c88b;
    case 'park': return 0xa4cf85;
    case 'downtown': return 0xdcd6c6;
    case 'industrial': return 0xcfccc2; // worn concrete aprons
    default: return 0xe9e1cf; // urban
  }
}

/** ground colour of a chunk (ocean blue outside the island) — for the minimap */
export function chunkGroundColor(bx: number, by: number, cx: number, cz: number): number {
  if (cx < 0 || cz < 0 || cx >= WORLD_CHUNKS || cz >= WORLD_CHUNKS) return 0x6fb7d9;
  return slabColor(cityPlanFor(bx, by).district(cx, cz));
}

export function generateCityChunk(bx: number, by: number, cx: number, cz: number): CityChunkResult {
  const seed = citySeed(bx, by);
  const r = rng(chunkSeed(seed, cx, cz));
  const CH = 64, X0 = cx * CH, Z0 = cz * CH;
  const B = new Baked();
  const boxes: CollisionBox[] = [];
  const TPL = kenneyTPL();
  const plan = cityPlanFor(bx, by);
  const rail = railRouteFor(bx, by);
  const river = riverFor(seed);
  const district = plan.district(cx, cz);

  // base slab — district ground, sand beach ring at the border
  B.box(CH, 0.1, CH, slabColor(district), X0 + CH / 2, 0.05, Z0 + CH / 2);
  if (cx === 0) B.box(6, 0.1, CH, BEACH, X0 + 3, 0.05, Z0 + CH / 2);
  if (cx === WORLD_CHUNKS - 1) B.box(6, 0.1, CH, BEACH, X0 + CH - 3, 0.05, Z0 + CH / 2);
  if (cz === 0) B.box(CH, 0.1, 6, BEACH, X0 + CH / 2, 0.05, Z0 + 3);
  if (cz === WORLD_CHUNKS - 1) B.box(CH, 0.1, 6, BEACH, X0 + CH / 2, 0.05, Z0 + CH - 3);

  // ---- the river: water ribbon, sandy banks and a footpath, interrupted
  // where a street bridges it ----
  const bridges = plan.riverBridges.filter(b => b.x > X0 - 30 && b.x < X0 + CH + 30 && b.z > Z0 - 30 && b.z < Z0 + CH + 30);
  const nearBridge = (x: number, z: number): boolean =>
    bridges.some(b => Math.hypot(b.x - x, b.z - z) < 11);
  {
    const rp = river.pts;
    for (let k = 0; k + 1 < rp.length; k++) {
      const a = rp[k], b = rp[k + 1];
      const mx = (a.x + b.x) / 2, mz = (a.z + b.z) / 2;
      if (mx < X0 - 10 || mx > X0 + CH + 10 || mz < Z0 - 10 || mz > Z0 + CH + 10) continue;
      const len = Math.hypot(b.x - a.x, b.z - a.z) + 1.4;
      const ry = Math.atan2(b.x - a.x, b.z - a.z);
      if (nearBridge(mx, mz)) continue; // the street bridge owns this stretch
      const w = (a.w + b.w) / 2;
      B.box(w, 0.09, len, RIVER_WATER, mx, 0.105, mz, 0, ry, 0);
      // sandy banks + a footpath on one side
      const rx = Math.cos(ry), rz = -Math.sin(ry);
      for (const s of [-1, 1]) {
        B.box(2.8, 0.05, len, RIVER_BANK, mx + rx * s * (w / 2 + 1.4), 0.1, mz + rz * s * (w / 2 + 1.4), 0, ry, 0);
      }
      B.box(1.9, 0.045, len, RIVER_PATH, mx + rx * (w / 2 + 3.4), 0.1, mz + rz * (w / 2 + 3.4), 0, ry, 0);
    }
    // greenway: trees and benches along the banks that pass through this chunk
    for (let k = 2; k + 2 < rp.length; k += 5) {
      const p = rp[k];
      if (p.x < X0 + 4 || p.x > X0 + CH - 4 || p.z < Z0 + 4 || p.z > Z0 + CH - 4) continue;
      if (nearBridge(p.x, p.z) || nearStreet(p.x, p.z)) continue;
      const side = (k % 2) * 2 - 1;
      const rx = Math.cos(p.h), rz = -Math.sin(p.h);
      const tx = p.x + rx * side * (p.w / 2 + 5 + r() * 4);
      const tz = p.z + rz * side * (p.w / 2 + 5 + r() * 4);
      const bankTpl = district === 'desert' ? pick(r, [...TPL.cacti, ...TPL.rocks])
        : district === 'forest' ? pick(r, TPL.pines) : pick(r, TPL.trees);
      if (bankTpl) {
        bakeModel(B, bankTpl, tx, 0.08, tz, r() * Math.PI * 2, 4 + r() * 3);
        boxes.push({ x1: tx - 0.6, x2: tx + 0.6, z1: tz - 0.6, z2: tz + 0.6, small: 1 });
      }
      if (r() < 0.4) {
        const bx2 = p.x + rx * side * (p.w / 2 + 2.9), bz2 = p.z + rz * side * (p.w / 2 + 2.9);
        B.box(1.6, 0.08, 0.45, 0xa9805a, bx2, 0.55, bz2, 0, p.h, 0);
      }
    }
  }
  // street bridges over the river: steel girders + cream rail caps + abutments
  for (const b of bridges) {
    const alongX = b.axis === 'h';
    const hw = river.halfAt(b.x, b.z) + 5.5; // span past the water
    for (const s of [-1, 1]) {
      const off = ROAD_HALF + 0.9;
      const gx = b.x + (alongX ? 0 : s * off);
      const gz = b.z + (alongX ? s * off : 0);
      B.box(alongX ? 20 : 0.55, 0.62, alongX ? 0.55 : 20, BRIDGE_STEEL, gx, 0.4, gz);
      B.box(alongX ? 20 : 0.34, 0.14, alongX ? 0.34 : 20, 0xe8e4d8, gx, 0.78, gz);
    }
    for (const s of [-1, 1]) {
      const ax = b.x + (alongX ? s * 10.2 : 0);
      const az = b.z + (alongX ? 0 : s * 10.2);
      B.box(alongX ? 1.3 : hw * 2 + 6, 0.55, alongX ? hw * 2 + 6 : 1.3, BRIDGE_STEEL, ax, 0.28, az);
    }
  }

  // ---- causeways to the neighbouring cities: each city draws its own south
  // and east decks; the neighbours' decks land on our north/west shores ----
  if (cz === WORLD_CHUNKS - 1 && cx === plan.exits.s) bakeCauseway(plan.exits.s * CH, 'v');
  if (cx === WORLD_CHUNKS - 1 && cz === plan.exits.e) bakeCauseway(plan.exits.e * CH, 'h');

  /** flush deck across the strait — flat physics can't arch, so parapets,
   * fender piles and dashes do the looking (collision-free like the picnic
   * causeway: splashing into the shallows is half the fun) */
  function bakeCauseway(at: number, dir: 'h' | 'v'): void {
    const start = ISLAND - 2, len = STRAIT + 8, mid = start + len / 2;
    if (dir === 'v') {
      B.box(11, 0.7, len, CAUSEWAY_ASPHALT, at, -0.25, mid);
      for (let z = start + 3; z < start + len - 2; z += 4) B.box(0.25, 0.02, 1.8, CAUSEWAY_DASH, at, 0.11, z);
      for (const side of [-1, 1]) {
        B.box(0.4, 0.55, len, CAUSEWAY_CURB, at + side * 5.3, 0.375, mid);
        B.box(0.55, 0.12, len, CAUSEWAY_CAP, at + side * 5.3, 0.71, mid);
      }
      for (let z = start + 6; z < start + len; z += 12) {
        for (const side of [-1, 1]) B.box(0.7, 2, 0.7, 0x8a6a4a, at + side * 6.3, -0.6, z);
      }
    } else {
      B.box(len, 0.7, 11, CAUSEWAY_ASPHALT, mid, -0.25, at);
      for (let x = start + 3; x < start + len - 2; x += 4) B.box(1.8, 0.02, 0.25, CAUSEWAY_DASH, x, 0.11, at);
      for (const side of [-1, 1]) {
        B.box(len, 0.55, 0.4, CAUSEWAY_CURB, mid, 0.375, at + side * 5.3);
        B.box(len, 0.12, 0.55, CAUSEWAY_CAP, mid, 0.71, at + side * 5.3);
      }
      for (let x = start + 6; x < start + len; x += 12) {
        for (const side of [-1, 1]) B.box(0.7, 2, 0.7, 0x8a6a4a, x, -0.6, at + side * 6.3);
      }
    }
  }

  // ---- wide streets: this chunk's south (z=Z0) and west (x=X0) edges.
  // Roads are flat procedural slabs in the same style as the strait
  // causeways: a 14 m asphalt strip with centre dashes and low kerbs, tiled
  // cell by cell so no two road pieces ever overlap. Junction nodes claim
  // one plain square pad two cells across, and the runs leave their end
  // cells out where a pad sits — kerbs and dashes stop at every corner ----
  const TS = 64 / 6, TY = 0.11;
  const roadS = plan.segH(cz, cx);
  const roadW = plan.segV(cx, cz);
  // junctions, L-corners and plazas claim a pad; straight-through nodes don't
  const patchNode = (i: number, j: number): boolean => {
    const a = plan.arms(i, j); // [west, east, north, south]
    const n = a.filter(Boolean).length;
    if (plan.plaza(i, j) || n >= 3) return true;
    return n === 2 && !((a[0] && a[1]) || (a[2] && a[3]));
  };
  const jSW = patchNode(cx, cz);
  const jS = patchNode(cx + 1, cz); // south run's far node
  const jW = patchNode(cx, cz + 1); // west run's far node
  for (let k = 0; k < 6; k++) {
    const c = TS / 2 + k * TS;
    if (roadS && !((k === 0 && jSW) || (k === 5 && jS))) {
      B.box(TS + 0.02, 0.04, 14, CAUSEWAY_ASPHALT, X0 + c, TY, Z0);
      for (const side of [-6.9, 6.9]) B.box(TS + 0.02, 0.09, 0.5, CAUSEWAY_CURB, X0 + c, TY + 0.02, Z0 + side);
      for (const d of [c - TS / 3, c, c + TS / 3]) B.box(2.8, 0.02, 0.3, CAUSEWAY_DASH, X0 + d, TY + 0.03, Z0);
    }
    if (roadW && !((k === 0 && jSW) || (k === 5 && jW))) {
      B.box(14, 0.04, TS + 0.02, CAUSEWAY_ASPHALT, X0, TY, Z0 + c);
      for (const side of [-6.9, 6.9]) B.box(0.5, 0.09, TS + 0.02, CAUSEWAY_CURB, X0 + side, TY + 0.02, Z0 + c);
      for (const d of [c - TS / 3, c, c + TS / 3]) B.box(0.3, 0.02, 2.8, CAUSEWAY_DASH, X0, TY + 0.03, Z0 + d);
    }
  }

  // ---- node pad at the chunk's SW corner (X0, Z0) ----
  if (jSW) {
    B.box(TS * 2, 0.04, TS * 2, CAUSEWAY_ASPHALT, X0, TY, Z0);
    if (plan.plaza(cx, cz)) bakePlaza(X0, Z0);
    else if (plan.roundabout(cx, cz)) bakeRoundabout(X0, Z0);
  }

  // working traffic lights are dynamic objects (chunks.ts) at signalized nodes;
  // chunks only keep their corner collision boxes
  if (plan.signalized(cx, cz)) {
    for (const [tx, tz] of [[X0 + 12.5, Z0 + 12.5], [X0 - 12.5, Z0 - 12.5]]) {
      boxes.push({ x1: tx - 0.4, x2: tx + 0.4, z1: tz - 0.4, z2: tz + 0.4, small: 1 });
    }
  }

  // street lamps along surviving streets (urban fabric + industry), kept
  // clear of the railway corridor so nothing stands in the crossing
  const lampDistrict = district === 'urban' || district === 'downtown' || district === 'industrial';
  if (lampDistrict) {
    for (let d = 11; d < CH; d += 18) {
      const clearH = roadS && !rail.near(X0 + d, Z0 + 7.8, 9);
      const clearV = roadW && !rail.near(X0 + 7.8, Z0 + d, 9);
      if (clearH && TPL.lightCurved) bakeModel(B, TPL.lightCurved, X0 + d, 0.1, Z0 + 7.8, 0, 5.5);
      if (clearV && TPL.lightCurved) bakeModel(B, TPL.lightCurved, X0 + 7.8, 0.1, Z0 + d, Math.PI / 2, 5.5);
      if (clearH) boxes.push({ x1: X0 + d - 0.3, x2: X0 + d + 0.3, z1: Z0 + 7.5, z2: Z0 + 8.1, small: 1 });
      if (clearV) boxes.push({ x1: X0 + 7.5, x2: X0 + 8.1, z1: Z0 + d - 0.3, z2: Z0 + d + 0.3, small: 1 });
    }
  }

  // ---- lots: buildings, tree rows and parking, laid out by the plan ----
  for (const lot of plan.lots(cx, cz)) bakeLot(lot);

  function bakeLot(lot: Lot): void {
    if (lot.kind === 'bldg') {
      const industrial = district === 'industrial';
      const tpls = industrial ? TPL.industrial : TPL.buildings;
      if (tpls.length) {
        // occasionally an industrial lot is just stacked containers / a tank
        const tpl = industrial && TPL.indExtras.length && r() < 0.22
          ? pick(r, TPL.indExtras)
          : tpls[((lot.v * tpls.length) | 0) % tpls.length];
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

  /** traffic circle: lighter circular carriageway with a painted ring,
   * kerbed grass island with a tree, pole collision */
  function bakeRoundabout(x: number, z: number): void {
    B.cyl(6.4, 6.4, 0.06, 22, 0x9aa1ab, x, 0.14, z);       // circular carriageway
    B.cyl(6.0, 6.0, 0.065, 22, 0xe8e4d8, x, 0.1425, z);    // painted ring
    B.cyl(5.6, 5.6, 0.07, 22, 0x9aa1ab, x, 0.145, z);
    B.cyl(2.4, 2.6, 0.22, 14, 0x8f97a3, x, 0.21, z);       // kerb
    B.cyl(2.1, 2.1, 0.24, 14, 0xa4cf85, x, 0.29, z);       // grass island
    if (TPL.trees.length) {
      bakeModel(B, pick(r, TPL.trees), x, 0.41, z, r() * Math.PI * 2, 2.0 + r() * 0.6);
    }
    boxes.push({ x1: x - 2.1, x2: x + 2.1, z1: z - 2.1, z2: z + 2.1, small: 1 });
  }

  /** paved plaza with a fountain, benches and planters — the meeting place */
  function bakePlaza(x: number, z: number): void {
    B.cyl(9.4, 9.4, 0.055, 26, 0xcfc6b0, x, 0.14, z);    // apron
    B.cyl(9.0, 9.0, 0.07, 26, 0xd8d0bc, x, 0.145, z);    // paved circle
    B.cyl(6.4, 6.4, 0.06, 26, 0xcfc6b0, x, 0.1475, z);   // ring pattern
    B.cyl(5.9, 5.9, 0.065, 26, 0xd8d0bc, x, 0.15, z);
    // the fountain
    B.cyl(2.9, 3.1, 0.5, 16, 0x9aa1ab, x, 0.35, z);      // basin wall
    B.cyl(2.6, 2.6, 0.44, 16, 0x6fb7d9, x, 0.4, z);      // water
    B.cyl(0.9, 1.15, 1.4, 12, 0xcfccc2, x, 0.8, z);      // pedestal
    B.cyl(1.55, 1.55, 0.18, 12, 0x9fd8ef, x, 1.55, z);   // upper dish
    B.sphere(0.3, 0xbfe3ff, x, 1.8, z);                  // finial
    boxes.push({ x1: x - 2.2, x2: x + 2.2, z1: z - 2.2, z2: z + 2.2, small: 1 });
    // benches + planter pots around the circle
    for (let k = 0; k < 4; k++) {
      const ang = k * Math.PI / 2 + Math.PI / 4;
      const bx = x + Math.cos(ang) * 4.9, bz = z + Math.sin(ang) * 4.9;
      B.box(1.7, 0.1, 0.5, 0xa9805a, bx, 0.55, bz, 0, -ang, 0);
      const px = x + Math.cos(ang + Math.PI / 4) * 7.6, pz = z + Math.sin(ang + Math.PI / 4) * 7.6;
      B.cyl(0.55, 0.7, 0.5, 10, 0xb5651d, px, 0.35, pz); // terracotta pot
      B.cyl(0.4, 0.4, 0.45, 8, 0xa4cf85, px, 0.72, pz);  // shrub
      boxes.push({ x1: px - 0.7, x2: px + 0.7, z1: pz - 0.7, z2: pz + 0.7, small: 1 });
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
  } else if (district === 'industrial') {
    // works yard dressing: a chimney or water tower plus scattered junk
    // away from the streets and the rail siding
    if (TPL.chimney || TPL.waterTower) {
      for (let t = 0; t < 6; t++) {
        const x = X0 + 12 + r() * (CH - 24), z = Z0 + 12 + r() * (CH - 24);
        if (nearStreet(x, z)) continue;
        const big = r() < 0.5 && TPL.chimney ? TPL.chimney : TPL.waterTower;
        if (!big) continue;
        const s = big === TPL.chimney ? 3.2 + r() * 1.6 : 4.5 + r();
        bakeModel(B, big, x, 0.1, z, r() * Math.PI * 2, s);
        boxes.push({ x1: x - 1.2, x2: x + 1.2, z1: z - 1.2, z2: z + 1.2, small: 1 });
        break;
      }
    }
    if (TPL.windmill && r() < 0.3) {
      const x = X0 + 12 + r() * (CH - 24), z = Z0 + 12 + r() * (CH - 24);
      if (!nearStreet(x, z)) {
        bakeModel(B, TPL.windmill, x, 0.1, z, r() * Math.PI * 2, 4 + r() * 2);
        boxes.push({ x1: x - 1, x2: x + 1, z1: z - 1, z2: z + 1, small: 1 });
      }
    }
    for (let k = 0; k < 3; k++) {
      const x = X0 + 9 + r() * (CH - 18), z = Z0 + 9 + r() * (CH - 18);
      if (nearStreet(x, z) || !TPL.indExtras.length) continue;
      const tpl = pick(r, TPL.indExtras);
      const s = 2.6 + r() * 1.4;
      bakeModel(B, tpl, x, 0.1, z, r() * Math.PI * 2, s);
      boxes.push({ x1: x - 1.4, x2: x + 1.4, z1: z - 1.4, z2: z + 1.4, small: 1 });
    }
  }

  function nearStreet(x: number, z: number): boolean {
    // keep scatter clear of street corridors, the railway and the river
    const lx = Math.round(x / CH), lz = Math.round(z / CH);
    if (Math.abs(x - lx * CH) < 8.6 &&
        (plan.segV(lx, cz) || plan.segV(lx, cz - 1))) return true;
    if (Math.abs(z - lz * CH) < 8.6 &&
        (plan.segH(lz, cx) || plan.segH(lz, cx - 1))) return true;
    if (rail.near(x, z, 9.5)) return true;
    if (river.near(x, z, river.halfAt(x, z) + 2.5)) return true;
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
      // kit pieces are already 10 units = one 10 m tile; no extra scaling
      bakeModel(B, tpl, c.x, TY, c.z, t.rot, 1);
    }
  }

  return { mesh: B.build(), boxes };
}