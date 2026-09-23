// The little island city: a 6×6-chunk (384 m) world with a beach ring, ocean
// beyond, biome pockets (forest, desert, meadow), the race circuit in the
// south-east, and the train looping the island shore. Each chunk is one
// vertex-colored mesh; the whole island is built once at boot.
import * as THREE from 'three';
import { C } from '../engine/palette.js';
import { Baked } from '../engine/baked.js';
import { rng, chunkSeed, type Rng } from '../engine/rng.js';
import { bakedModel, type BakedTemplate } from '../engine/assets.js';
import { raceZoneChunk, raceTiles, tileCenter, RACE_TILE } from './racetrack.js';

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
const BUILDINGS = [0xf2e4cf, 0xf9d9bd, 0xc3ddef, 0xcfe8d8, 0xf3c4d3, 0xdcd0ec, 0xf9e7b0, 0xe8ddd0];
const ROOFS = [0xcf7d6d, 0x8ba7bf, 0xc4a687, 0x9dbd80, 0xb8a4d4];
const ROAD_DASH_X = 0;

// biome per chunk: city centre, nature pockets at the corners, race in the SE
export type ChunkBiome = 'city' | 'forest' | 'meadow' | 'desert' | 'race';
export function islandBiome(cx: number, cz: number): ChunkBiome {
  if (raceZoneChunk(cx, cz)) return 'race';
  if (cx <= 1 && cz <= 1) return 'forest';
  if (cx >= 4 && cz <= 1) return 'meadow';
  if (cx <= 1 && cz >= 4) return 'desert';
  return 'city';
}

function slabColor(biome: ChunkBiome): number {
  switch (biome) {
    case 'forest': return 0x7ba363;
    case 'desert': return 0xe8d29a;
    case 'meadow': return 0xa9c88b;
    case 'race': return 0xa9c88b;
    default: return C.sidewalk;
  }
}

/** ground colour of a chunk (ocean blue outside the island) — for the minimap */
export function chunkGroundColor(cx: number, cz: number): number {
  if (cx < 0 || cz < 0 || cx >= WORLD_CHUNKS || cz >= WORLD_CHUNKS) return 0x6fb7d9;
  return slabColor(islandBiome(cx, cz));
}

export function generateCityChunk(seed: number, cx: number, cz: number): CityChunkResult {
  const r = rng(chunkSeed(seed, cx, cz));
  const CH = 64, X0 = cx * CH, Z0 = cz * CH;
  const B = new Baked();
  const boxes: CollisionBox[] = [];
  const TPL = kenneyTPL();
  const biome = islandBiome(cx, cz);
  const wild = biome === 'forest' || biome === 'desert' || biome === 'meadow';
  const openZone = biome === 'race'; // clear apron: no buildings, no scatter

  // base slab — concrete downtown, grass pockets, sand beach ring at the border
  B.box(CH, 0.1, CH, slabColor(biome), X0 + CH / 2, 0.05, Z0 + CH / 2);
  if (cx === 0) B.box(6, 0.1, CH, BEACH, X0 + 3, 0.05, Z0 + CH / 2);
  if (cx === WORLD_CHUNKS - 1) B.box(6, 0.1, CH, BEACH, X0 + CH - 3, 0.05, Z0 + CH / 2);
  if (cz === 0) B.box(CH, 0.1, 6, BEACH, X0 + CH / 2, 0.05, Z0 + 3);
  if (cz === WORLD_CHUNKS - 1) B.box(CH, 0.1, 6, BEACH, X0 + CH / 2, 0.05, Z0 + CH - 3);

  // roads along this chunk's south (z=Z0) and west (x=X0) grid lines.
  // tile: road surface at model y=0, raised sidewalk strips to y=0.02 — at 10 m
  // scale the curbs stand 0.2 proud; sit the surface just above the slab top
  const TS = 10, TY = 0.11;
  for (let k = 0; k < 6; k++) {
    const c = TS / 2 + k * TS;
    bakeModel(B, TPL.roadStraight, X0 + c, TY, Z0, ROAD_DASH_X, 1, [TS, TS, TS]);
    bakeModel(B, TPL.roadStraight, X0, TY, Z0 + c, ROAD_DASH_X + Math.PI / 2, 1, [TS, TS, TS]);
  }
  bakeModel(B, TPL.roadCrossroad, X0, TY, Z0, 0, TS);
  // traffic-light corners: the working lights are dynamic objects added by the
  // game (traffic.ts); chunks only keep their collision boxes
  for (const [tx, tz] of [[X0 + 5.8, Z0 + 5.8], [X0 - 5.8, Z0 - 5.8]]) {
    boxes.push({ x1: tx - 0.4, x2: tx + 0.4, z1: tz - 0.4, z2: tz + 0.4, small: 1 });
  }
  // street lamps (city streets only)
  if (biome === 'city') {
    for (let d = 10; d < CH; d += 18) {
      if (TPL.lightCurved) {
        bakeModel(B, TPL.lightCurved, X0 + d, 0.1, Z0 + 5.4, 0, 5.5);
        bakeModel(B, TPL.lightCurved, X0 + 5.4, 0.1, Z0 + d, Math.PI / 2, 5.5);
      }
      boxes.push({ x1: X0 + d - 0.3, x2: X0 + d + 0.3, z1: Z0 + 5.1, z2: Z0 + 5.7, small: 1 });
      boxes.push({ x1: X0 + 5.1, x2: X0 + 5.7, z1: Z0 + d - 0.3, z2: Z0 + d + 0.3, small: 1 });
    }
  }

  // building lots along the four edges (fronts toward the roads)
  function bakeBuilding(x: number, z: number, w: number, d: number, ry: number): void {
    const fx = Math.round(Math.sin(ry)), fz = Math.round(Math.cos(ry));
    const frontFacesZ = fz !== 0;
    if (TPL.buildings.length) {
      const tpl = pick(r, TPL.buildings);
      const s = Math.min((w * 0.95) / tpl.size.x, (d * 0.95) / tpl.size.z);
      const dep = frontFacesZ ? tpl.size.z * s : tpl.size.x * s;
      const inX = frontFacesZ ? 0 : -fx;
      const inZ = frontFacesZ ? -fz : 0;
      const bcx = x + (inX * dep) / 2;
      const bcz = z + (inZ * dep) / 2;
      // hard rule: a building may never touch a road corridor
      const rx = Math.abs(bcx - Math.round(bcx / CH) * CH) - dep / 2;
      const rz = Math.abs(bcz - Math.round(bcz / CH) * CH) - dep / 2;
      if (rx < 7 || rz < 7) return;
      bakeModel(B, tpl, bcx, 0.1, bcz, ry, s);
      boxes.push({ x1: bcx - dep / 2, x2: bcx + dep / 2, z1: bcz - dep / 2, z2: bcz + dep / 2 });
      return;
    }
    const h = 2.9 * (2 + ((r() * 3) | 0)) + 0.6;
    const bodyC = pick(r, BUILDINGS);
    const halfX = 2.25, halfZ = 2.25;
    const bcx = x, bcz = z;
    const rx = Math.abs(bcx - Math.round(bcx / CH) * CH) - halfX;
    const rz = Math.abs(bcz - Math.round(bcz / CH) * CH) - halfZ;
    if (rx < 7 || rz < 7) return;
    B.box(halfX * 2, h, halfZ * 2, bodyC, bcx, h / 2, bcz);
    B.box(halfX * 2 + 0.3, 0.3, halfZ * 2 + 0.3, pick(r, ROOFS), bcx, h + 0.15, bcz);
    boxes.push({ x1: bcx - halfX, x2: bcx + halfX, z1: bcz - halfZ, z2: bcz + halfZ });
  }

  function bakeTrees(x: number, z: number, n = 3): void {
    for (let i = 0; i < n; i++) {
      const tx = x + j(r, 3), tz = z + j(r, 3);
      if (TPL.trees.length) {
        bakeModel(B, pick(r, TPL.trees), tx, 0.08, tz, r() * Math.PI * 2, 5 + r() * 2.5);
      }
      boxes.push({ x1: tx - 0.55, x2: tx + 0.55, z1: tz - 0.55, z2: tz + 0.55, small: 1 });
    }
  }

  // wild biomes: scatter nature instead of buildings
  function scatterNature(): void {
    const tries = biome === 'forest' ? 30 : biome === 'desert' ? 14 : 18;
    for (let i = 0; i < tries; i++) {
      const x = X0 + 7 + r() * (CH - 14);
      const z = Z0 + 7 + r() * (CH - 14);
      const gx = Math.abs(x - Math.round(x / CH) * CH);
      const gz = Math.abs(z - Math.round(z / CH) * CH);
      if (gx < 6.5 || gz < 6.5) continue;
      let tpl: BakedTemplate | null = null;
      const s = 3.5 + r() * 2.5;
      if (biome === 'forest') tpl = pick(r, [...TPL.pines, ...TPL.trees]);
      else if (biome === 'desert') tpl = pick(r, [...TPL.cacti, ...TPL.rocks]);
      else tpl = pick(r, TPL.trees);
      if (!tpl) continue;
      bakeModel(B, tpl, x, 0.08, z, r() * Math.PI * 2, s);
      boxes.push({ x1: x - 0.6, x2: x + 0.6, z1: z - 0.6, z2: z + 0.6, small: 1 });
    }
  }

  function bakeParkedCar(x: number, z: number, ry: number): void {
    if (TPL.cars.length) {
      const tpl = pick(r, TPL.cars);
      bakeModel(B, tpl, x, 0.17, z, ry, 4.3 / Math.max(tpl.size.x, tpl.size.z));
    }
  }

  function edge(edgeRy: number, axis: 'x' | 'z', fixed: number): void {
    let s = 8.4;
    while (s < CH - 9) {
      let w = 9 + r() * 6;
      if (s + w > CH - 8.4) w = (CH - 8.4) - s;
      if (w < 5) { s += (CH - 8.4) - s + 2; break; }
      const roll = r();
      const along = axis === 'x';
      const px = along ? X0 + s + w / 2 : fixed;
      const pz = along ? fixed : Z0 + s + w / 2;
      const diX = along ? 0 : -Math.sin(edgeRy);
      const diZ = along ? -Math.cos(edgeRy) : 0;
      if (roll < 0.55) {
        const d = 9 + r() * 4;
        bakeBuilding(px, pz, w, d, edgeRy);
      } else if (roll < 0.72) {
        const pcx = px + diX * 4, pcz = pz + diZ * 4;
        B.box(along ? 8 : w, 0.08, along ? w : 8, 0xa9c88b, pcx, 0.14, pcz);
        bakeTrees(pcx, pcz, 3);
        B.box(1.6, 0.08, 0.45, C.brown, pcx - w / 4, 0.55, pcz + 2.5);
      } else if (roll < 0.86) {
        const pcx = px + diX * 4, pcz = pz + diZ * 4;
        B.box(along ? 8 : w, 0.06, along ? w : 8, 0x828a96, pcx, 0.14, pcz);
        const n = 1 + ((r() * 2) | 0);
        for (let i = 0; i < n; i++) {
          if (axis === 'x') {
            const ccx = pcx - w / 3 + i * (w / 2.2);
            bakeParkedCar(ccx, pcz, 0);
            boxes.push({ x1: ccx - 1.0, x2: ccx + 1.0, z1: pcz - 2.3, z2: pcz + 2.3 });
          } else {
            const ccz = pcz - w / 3 + i * (w / 2.2);
            bakeParkedCar(pcx, ccz, Math.PI / 2);
            boxes.push({ x1: pcx - 2.3, x2: pcx + 2.3, z1: ccz - 1.0, z2: ccz + 1.0 });
          }
        }
      }
      s += w + 0.8 + r() * 2;
    }
  }
  if (wild) {
    scatterNature();
  } else if (!openZone) {
    edge(Math.PI, 'x', Z0 + 7.6);
    edge(0, 'x', Z0 + CH - 7.6);
    edge(-Math.PI / 2, 'z', X0 + 7.6);
    edge(Math.PI / 2, 'z', X0 + CH - 7.6);
  }

  // race circuit: bake the tiles whose centre falls inside this chunk
  if (biome === 'race' && TPL.raceStraight && TPL.raceCorner) {
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

// procedural pastel car used as the fallback when Kenney templates are missing
function bakeCarInto(B: Baked, color: number, x: number, z: number, ry: number): void {
  const c = Math.cos(ry), s = Math.sin(ry);
  const put = (w: number, h: number, d: number, col: number, lx: number, ly: number, lz: number) => {
    B.box(w, h, d, col, x + lx * c + lz * s, ly, z - lx * s + lz * c, 0, ry, 0);
  };
  put(1.78, 0.5, 4.4, color, 0, 0.6, 0);
  put(1.6, 0.48, 2.2, color, 0, 1.05, -0.2);
  put(1.55, 0.4, 1.7, 0x3e4550, 0, 1.06, -0.2);
  for (const wx of [-0.8, 0.8]) for (const wz of [1.42, -1.42]) {
    const wxw = x + wx * c + wz * s, wzw = z - wx * s + wz * c;
    B.cyl(0.32, 0.32, 0.22, 10, C.tire, wxw, 0.32, wzw, 0, ry, Math.PI / 2);
  }
}
