// ENDLESS CITY — deterministic chunk generator for the city game.
// generateCityChunk(seed, cx, cz) -> { mesh (1 baked draw call), boxes (collision AABBs) }
// Roads run along the chunk grid lines, buildings face them; revisiting a chunk
// always rebuilds the exact same block. All props come from CC0 Kenney kits
// (preloaded via engine/assets) with a procedural pastel fallback.
import * as THREE from 'three';
import { C } from '../engine/palette.js';
import { Baked } from '../engine/baked.js';
import { rng, chunkSeed, type Rng } from '../engine/rng.js';
import { bakedModel, type BakedTemplate } from '../engine/assets.js';

const j = (r: Rng, amp: number) => (r() - 0.5) * 2 * amp;
const pick = <T,>(r: Rng, arr: T[]): T => arr[(r() * arr.length) | 0];

/** Rail lines replace every 4th road grid line — the train shuttles along them. */
export function isRailLine(index: number): boolean {
  return (((index % 4) + 4) % 4) === 0;
}

// ---- Kenney kit placement helpers (models baked into chunk vertex-color meshes) ----
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

// axis-aligned footprint of the model rotated by a cardinal angle ry
function footprint(tpl: BakedTemplate, ry: number, s: number): { ex: number; ez: number } {
  const c = Math.abs(Math.cos(ry)), sn = Math.abs(Math.sin(ry));
  return {
    ex: c * tpl.size.x * s * 0.5 + sn * tpl.size.z * s * 0.5,
    ez: sn * tpl.size.x * s * 0.5 + c * tpl.size.z * s * 0.5,
  };
}

// tuned by inspection: yaw that points a road-straight tile's lane dashes along X
const ROAD_DASH_X = 0;
// extra yaw so Kenney building fronts face the street (models face +Z by default)
const BLDG_FACE = 0;

// pastel palettes for the procedural fallback pieces
const BUILDINGS = [0xf2e4cf, 0xf9d9bd, 0xc3ddef, 0xcfe8d8, 0xf3c4d3, 0xdcd0ec, 0xf9e7b0, 0xe8ddd0];
const ROOFS = [0xcf7d6d, 0x8ba7bf, 0xc4a687, 0x9dbd80, 0xb8a4d4];
const CARS = [0xfaf7ef, 0xd9dde2, 0x8f97a3, 0x5a6472, 0x7fb2d9, 0xe25c5c, 0x9cc76a, 0xf6c952];
const AWNINGS = [[0x63b0a8, C.cream], [0xe25c5c, C.cream], [0x7fb2d9, C.cream]];

export interface CollisionBox {
  x1: number; x2: number; z1: number; z2: number;
  /** small props (poles, trees) only collide on direct front hits */
  small?: number;
}

export interface CityChunkResult {
  mesh: THREE.Mesh;
  boxes: CollisionBox[];
}

function kenneyTPL() {
  const names = ['bldg-a', 'bldg-b', 'bldg-c', 'bldg-d', 'bldg-e', 'bldg-f', 'bldg-g',
    'bldg-h', 'bldg-i', 'bldg-j', 'bldg-k', 'bldg-l', 'bldg-m', 'bldg-n'];
  return {
    buildings: names.map(bakedModel).filter((t): t is BakedTemplate => !!t),
    trees: ['tree-default', 'tree-oak', 'tree-detailed', 'tree-fat', 'tree-thin', 'tree-small']
      .map(bakedModel).filter((t): t is BakedTemplate => !!t),
    roadStraight: bakedModel('road-straight'),
    roadCrossroad: bakedModel('road-crossroad'),
    roadCrossing: bakedModel('road-crossing'),
    lightCurved: bakedModel('light-curved'),
    cars: ['car-sedan', 'car-suv', 'car-taxi', 'car-hatch'].map(bakedModel).filter((t): t is BakedTemplate => !!t),
  };
}

export function generateCityChunk(seed: number, cx: number, cz: number): CityChunkResult {
  const r = rng(chunkSeed(seed, cx, cz));
  const CH = 64, X0 = cx * CH, Z0 = cz * CH;
  const B = new Baked();
  const boxes: CollisionBox[] = [];
  const TPL = kenneyTPL();

  // base slab (sidewalk-level concrete everywhere; roads sit on top)
  B.box(CH, 0.1, CH, C.sidewalk, X0 + CH / 2, 0.05, Z0 + CH / 2);

  // roads along this chunk's south (z=Z0) and west (x=X0) grid lines.
  // every 4th line is a RAIL corridor instead (the train shuttles along it),
  // with level crossings where side roads pass over the rails.
  // tile: road surface at model y=0, raised sidewalk strips to y=0.02 — at 10 m
  // scale the curbs stand 0.2 proud; sit the surface just above the slab top
  const TS = 10, TY = 0.11;
  const railZ = isRailLine(cz); // south edge is rail
  const railX = isRailLine(cx); // west edge is rail
  if (railZ) {
    // rail corridor along the south edge; ballast/sleepers pause where the
    // N-S side roads cross (rails only there, like a level crossing)
    B.box(CH, 0.06, 5, 0xcbb894, X0 + CH / 2, 0.1, Z0);
    for (let d = 5; d < CH - 5; d += 0.75) B.box(0.24, 0.1, 2.0, C.brownDark, X0 + d, 0.17, Z0);
    B.box(CH, 0.1, 0.14, 0x9aa5b5, X0 + CH / 2, 0.26, Z0 - 0.75);
    B.box(CH, 0.1, 0.14, 0x9aa5b5, X0 + CH / 2, 0.26, Z0 + 0.75);
  }
  if (railX) {
    B.box(5, 0.06, CH, 0xcbb894, X0, 0.1, Z0 + CH / 2);
    for (let d = 5; d < CH - 5; d += 0.75) B.box(2.0, 0.1, 0.24, C.brownDark, X0, 0.17, Z0 + d);
    B.box(0.14, 0.1, CH, 0x9aa5b5, X0 - 0.75, 0.26, Z0 + CH / 2);
    B.box(0.14, 0.1, CH, 0x9aa5b5, X0 + 0.75, 0.26, Z0 + CH / 2);
  }
  if (TPL.roadStraight && TPL.roadCrossroad && !railZ && !railX) {
    // straight tiles fill the edge between the corner crossroad (which covers
    // TS/2 into this chunk) and the neighbour's crossroad; the first slot is a
    // crosswalk tile as the approach to the SW intersection
    const n = Math.round((CH - TS) / TS);
    const L = (CH - TS) / n;
    for (let k = 0; k < n; k++) {
      const c = TS / 2 + L / 2 + k * L;
      const first = k === 0;
      bakeModel(B, first && TPL.roadCrossing ? TPL.roadCrossing : TPL.roadStraight,
        X0 + c, TY, Z0, ROAD_DASH_X, 1, [L, TS, TS]);
      bakeModel(B, first && TPL.roadCrossing ? TPL.roadCrossing : TPL.roadStraight,
        X0, TY, Z0 + c, ROAD_DASH_X + Math.PI / 2, 1, [L, TS, TS]);
    }
    bakeModel(B, TPL.roadCrossroad, X0, TY, Z0, 0, TS);
  } else if (!railZ && !railX) {
    B.box(CH + 9, 0.06, 9, C.road, X0 + CH / 2, 0.09, Z0);
    B.box(9, 0.06, CH + 9, C.road, X0, 0.09, Z0 + CH / 2);
  }
  // curbs + markings: procedural look only (the tiles carry their own)
  if (!(TPL.roadStraight && TPL.roadCrossroad) && !railZ && !railX) {
    for (const cz of [Z0 - 4.7, Z0 + 4.7]) B.box(CH + 9, 0.16, 0.4, 0xd8d2c2, X0 + CH / 2, 0.12, cz);
    for (const cxx of [X0 - 4.7, X0 + 4.7]) B.box(0.4, 0.16, CH + 9, 0xd8d2c2, cxx, 0.12, Z0 + CH / 2);
    for (let d = 3; d < CH - 2; d += 3.6) {
      if (d > 6.5) B.box(1.7, 0.02, 0.16, C.roadLine, X0 + d, 0.14, Z0);
      if (d > 6.5) B.box(0.16, 0.02, 1.7, C.roadLine, X0, 0.14, Z0 + d);
    }
    for (let i = 0; i < 7; i++) {
      B.box(2.6, 0.02, 0.55, C.roadLine, X0 + 6.8, 0.15, Z0 - 3.45 + i * 1.15);
      B.box(0.55, 0.02, 2.6, C.roadLine, X0 - 3.45 + i * 1.15, 0.15, Z0 + 6.8);
    }
  }
  // traffic-light corners: the working lights are dynamic objects added by the
  // game (traffic.ts); chunks only keep their collision boxes
  for (const [tx, tz] of [[X0 + 5.8, Z0 + 5.8], [X0 - 5.8, Z0 - 5.8]]) {
    boxes.push({ x1: tx - 0.4, x2: tx + 0.4, z1: tz - 0.4, z2: tz + 0.4, small: 1 });
  }
  // street lamps
  for (let d = 10; d < CH; d += 18) {
    if (TPL.lightCurved) {
      bakeModel(B, TPL.lightCurved, X0 + d, 0.1, Z0 + 5.4, 0, 5.5);
      bakeModel(B, TPL.lightCurved, X0 + 5.4, 0.1, Z0 + d, Math.PI / 2, 5.5);
    } else {
      B.cyl(0.08, 0.1, 3.6, 7, C.dark, X0 + d, 1.8, Z0 + 5.4);
      B.box(1.0, 0.1, 0.1, C.dark, X0 + d - 0.5, 3.5, Z0 + 5.4);
      B.sphere(0.17, 0xfff6cf, X0 + d - 1.0, 3.42, Z0 + 5.4);
      B.cyl(0.08, 0.1, 3.6, 7, C.dark, X0 + 5.4, 1.8, Z0 + d);
      B.box(0.1, 0.1, 1.0, C.dark, X0 + 5.4, 3.5, Z0 + d - 0.5);
      B.sphere(0.17, 0xfff6cf, X0 + 5.4, 3.42, Z0 + d - 1.0);
    }
    boxes.push({ x1: X0 + d - 0.3, x2: X0 + d + 0.3, z1: Z0 + 5.1, z2: Z0 + 5.7, small: 1 });
    boxes.push({ x1: X0 + 5.1, x2: X0 + 5.7, z1: Z0 + d - 0.3, z2: Z0 + d + 0.3, small: 1 });
  }

  // building lots along the four edges (fronts toward the roads)
  function bakeBuilding(x: number, z: number, w: number, d: number, ry: number): void {
    const fx = Math.round(Math.sin(ry)), fz = Math.round(Math.cos(ry));
    const frontFacesZ = fz !== 0;
    if (TPL.buildings.length) {
      const tpl = pick(r, TPL.buildings);
      const s = Math.min((w * 0.95) / tpl.size.x, (d * 0.95) / tpl.size.z);
      const fp = footprint(tpl, ry + BLDG_FACE, s);
      const dep = frontFacesZ ? tpl.size.z * s : tpl.size.x * s;
      const inX = frontFacesZ ? 0 : -fx;
      const inZ = frontFacesZ ? -fz : 0;
      const bcx = x + (inX * dep) / 2;
      const bcz = z + (inZ * dep) / 2;
      // hard rule: a building may never touch a road corridor (belt and braces)
      const rx = Math.abs(bcx - Math.round(bcx / CH) * CH) - fp.ex;
      const rz = Math.abs(bcz - Math.round(bcz / CH) * CH) - fp.ez;
      if (rx < 7 || rz < 7) return;
      bakeModel(B, tpl, bcx, 0.1, bcz, ry + BLDG_FACE, s);
      boxes.push({ x1: bcx - fp.ex, x2: bcx + fp.ex, z1: bcz - fp.ez, z2: bcz + fp.ez });
      return;
    }
    const floors = 2 + ((r() * 3) | 0);
    const h = floors * 2.9 + 0.6;
    const isShop = r() < 0.4;
    const bodyC = pick(r, BUILDINGS);
    const halfX = (frontFacesZ ? w : d) / 2;
    const halfZ = (frontFacesZ ? d : w) / 2;
    const inX = frontFacesZ ? 0 : -fx;
    const inZ = frontFacesZ ? -fz : 0;
    const bcx = frontFacesZ ? x : x + (inX * d) / 2;
    const bcz = frontFacesZ ? z : z + (inZ * d) / 2;
    const rx = Math.abs(bcx - Math.round(bcx / CH) * CH) - halfX;
    const rz = Math.abs(bcz - Math.round(bcz / CH) * CH) - halfZ;
    if (rx < 7 || rz < 7) return;
    B.box(halfX * 2, h, halfZ * 2, bodyC, bcx, h / 2, bcz);
    B.box(halfX * 2 + 0.3, 0.3, halfZ * 2 + 0.3, pick(r, ROOFS), bcx, h + 0.15, bcz);
    if (r() < 0.5) B.box(1.1, 0.7, 0.9, 0x8f9399, bcx + j(r, halfX / 2), h + 0.3, bcz + j(r, halfZ / 3));
    const cols = Math.max(1, Math.floor((w - 1.6) / 2.1));
    for (let fl = 0; fl < floors - 1; fl++) {
      const wy = 1.7 + fl * 2.9;
      for (let c2 = 0; c2 < cols; c2++) {
        const off = -((cols - 1) * 2.1) / 2 + c2 * 2.1;
        const col = r() < 0.16 ? 0xf9e2ae : 0xa9cadd;
        if (frontFacesZ) B.box(1.05, 1.05, 0.08, col, bcx + off, wy, bcz + fz * (halfZ + 0.04));
        else B.box(0.08, 1.05, 1.05, col, bcx + fx * (halfX + 0.04), wy, bcz + off);
      }
    }
    const rows = Math.max(1, Math.floor((d - 1.6) / 2.3));
    for (let fl = 0; fl < floors - 1; fl++) {
      const wy = 1.7 + fl * 2.9;
      for (let c2 = 0; c2 < rows; c2++) {
        const off = -((rows - 1) * 2.3) / 2 + c2 * 2.3;
        const col = r() < 0.12 ? 0xf9e2ae : 0xa9cadd;
        if (frontFacesZ) {
          B.box(0.08, 1.0, 1.0, col, bcx - halfX - 0.04, wy, bcz + off);
          B.box(0.08, 1.0, 1.0, col, bcx + halfX + 0.04, wy, bcz + off);
        } else {
          B.box(1.0, 1.0, 0.08, col, bcx + off, wy, bcz - halfZ - 0.04);
          B.box(1.0, 1.0, 0.08, col, bcx + off, wy, bcz + halfZ + 0.04);
        }
      }
    }
    if (frontFacesZ) {
      B.box(1.0, 2.1, 0.1, 0x6a5240, bcx + w * 0.22, 1.05, bcz + fz * (halfZ + 0.03));
      B.box(w * 0.45, 1.4, 0.08, 0xa9cadd, bcx - w * 0.18, 1.35, bcz + fz * (halfZ + 0.03));
      if (isShop) {
        for (let si = 0; si < Math.floor(w * 0.45 / 0.8); si++)
          B.box(0.8, 0.06, 0.9, si % 2 ? 0xcf7d6d : C.cream, bcx - w * 0.22 + si * 0.8, 2.35, bcz + fz * (halfZ + 0.3), -0.3);
      }
    } else {
      B.box(0.1, 2.1, 1.0, 0x6a5240, bcx + fx * (halfX + 0.03), 1.05, bcz + w * 0.22);
      B.box(0.08, 1.4, w * 0.45, 0xa9cadd, bcx + fx * (halfX + 0.03), 1.35, bcz - w * 0.18);
      if (isShop) {
        for (let si = 0; si < Math.floor(w * 0.45 / 0.8); si++)
          B.box(0.9, 0.06, 0.8, si % 2 ? 0xcf7d6d : C.cream, bcx + fx * (halfX + 0.3), 2.35, bcz - w * 0.22 + si * 0.8, 0, 0, -0.3);
      }
    }
    boxes.push({ x1: bcx - halfX, x2: bcx + halfX, z1: bcz - halfZ, z2: bcz + halfZ });
  }

  function bakeTrees(x: number, z: number, n = 3): void {
    for (let i = 0; i < n; i++) {
      const tx = x + j(r, 3), tz = z + j(r, 3), s = 1 + r() * 0.8;
      if (TPL.trees.length) {
        // street trees: scale the kit models up to real 6-13 m next to the buildings
        bakeModel(B, pick(r, TPL.trees), tx, 0.08, tz, r() * Math.PI * 2, 5 + r() * 2.5);
      } else {
        B.cyl(0.14 * s, 0.2 * s, 0.9 * s, 6, C.brown, tx, 0.45 * s, tz);
        B.sphere(0.75 * s, C.leaf, tx, 1.4 * s, tz);
        B.sphere(0.5 * s, C.leafLight, tx + 0.4 * s, 1.05 * s, tz);
      }
      boxes.push({ x1: tx - 0.55, x2: tx + 0.55, z1: tz - 0.55, z2: tz + 0.55, small: 1 });
    }
  }

  function bakeParkedCar(x: number, z: number, ry: number): void {
    if (TPL.cars.length) {
      const tpl = pick(r, TPL.cars);
      bakeModel(B, tpl, x, 0.17, z, ry, 4.3 / Math.max(tpl.size.x, tpl.size.z));
    } else {
      bakeCarInto(B, pick(r, CARS), x, z, ry);
    }
  }

  function edge(edgeRy: number, axis: 'x' | 'z', fixed: number): void {
    let s = 8.4;
    while (s < CH - 9) {
      let w = 9 + r() * 6;
      if (s + w > CH - 8.4) w = (CH - 8.4) - s; // never spill into the next street
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
        // pocket park: grass + trees + bench, offset inward off the street
        const pcx = px + diX * 4, pcz = pz + diZ * 4;
        B.box(along ? 8 : w, 0.08, along ? w : 8, 0xa9c88b, pcx, 0.14, pcz);
        bakeTrees(pcx, pcz, 3);
        B.box(1.6, 0.08, 0.45, C.brown, pcx - w / 4, 0.55, pcz + 2.5);
      } else if (roll < 0.86) {
        // parking lot with cars, offset inward off the street
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
      } // else: empty plot
      s += w + 0.8 + r() * 2;
    }
  }
  edge(Math.PI, 'x', Z0 + 7.6);          // south edge, fronts face -Z toward the road
  edge(0, 'x', Z0 + CH - 7.6);           // north edge
  edge(-Math.PI / 2, 'z', X0 + 7.6);     // west edge
  edge(Math.PI / 2, 'z', X0 + CH - 7.6); // east edge

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
