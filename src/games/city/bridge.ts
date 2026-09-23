// The bridge: a low causeway leaving the island's south shore (x≈184) to a
// little picnic island in the sea. The physics is flat 2D, so the deck sits
// flush with the island slabs — the parapets, fender piles and corner lamps
// do the looking, and the parapets are deliberately collision-free (driving
// off into the shallows is half the fun).
import * as THREE from 'three';
import { Baked } from '../../engine/baked.js';
import { bakedModel, type BakedTemplate } from '../../engine/assets.js';
import { rng, chunkSeed } from '../../engine/rng.js';
import type { CollisionBox } from '../../worlds/cityChunk.js';

const ASPHALT = 0x5f6771;
const DASH = 0xe8e4d8;
const CURB = 0xcfc9ba;
const CAP = 0x9a948a;
const WOOD = 0x8a6a4a;
const GRASS = 0xa9c88b;
const BEACH = 0xf0e2c0;

/** X centre of the bridge, deck width, and shore/island extents */
const X = 184;
const HALF_W = 5.5;
const Z0 = 381;        // overlaps the beach ring
const Z1 = 421;        // lands on the picnic island
const ISLE = { x1: 164, z1: 421, x2: 204, z2: 461 };

/** static collision for the picnic island's trees and rocks */
export const BRIDGE_BOXES: CollisionBox[] = [];

export function createBridge(scene: THREE.Scene): void {
  const B = new Baked();
  const r = rng(chunkSeed(77, 1, 4));

  // deck + lane dashes
  B.box(HALF_W * 2, 0.7, Z1 - Z0, ASPHALT, X, -0.25, (Z0 + Z1) / 2);
  for (let z = Z0 + 3; z < Z1 - 2; z += 4) {
    B.box(0.25, 0.02, 1.8, DASH, X, 0.11, z);
  }
  // parapets with cap rails
  for (const side of [-1, 1]) {
    const px = X + side * (HALF_W - 0.2);
    B.box(0.4, 0.55, Z1 - Z0, CURB, px, 0.375, (Z0 + Z1) / 2);
    B.box(0.55, 0.12, Z1 - Z0, CAP, px, 0.71, (Z0 + Z1) / 2);
  }
  // fender piles rising from the water alongside the deck
  for (let z = Z0 + 5; z < Z1 - 3; z += 6) {
    for (const side of [-1, 1]) {
      B.box(0.7, 2, 0.7, WOOD, X + side * (HALF_W + 0.8), -0.6, z);
    }
  }
  // corner lamps
  const lamp = bakedModel('light-curved');
  for (const [lx, lz, rot] of [
    [X - HALF_W + 1.4, Z0 + 4, 0], [X + HALF_W - 1.4, Z0 + 4, Math.PI],
    [X - HALF_W + 1.4, Z1 - 4, 0], [X + HALF_W - 1.4, Z1 - 4, Math.PI],
  ] as Array<[number, number, number]>) {
    if (lamp) bakeTpl(B, lamp, lx, 0.1, lz, rot, 5.5);
  }

  // the picnic island: grass slab with a sand rim
  const iw = ISLE.x2 - ISLE.x1, id = ISLE.z2 - ISLE.z1;
  const icx = (ISLE.x1 + ISLE.x2) / 2, icz = (ISLE.z1 + ISLE.z2) / 2;
  B.box(iw, 0.1, id, GRASS, icx, 0.05, icz);
  B.box(iw, 0.1, 6, BEACH, icx, 0.05, ISLE.z1 + 3);
  B.box(iw, 0.1, 6, BEACH, icx, 0.05, ISLE.z2 - 3);
  B.box(6, 0.1, id, BEACH, ISLE.x1 + 3, 0.05, icz);
  B.box(6, 0.1, id, BEACH, ISLE.x2 - 3, 0.05, icz);

  // trees + rocks (deterministic scatter, clear of the bridge landing)
  const trees = ['tree-default', 'tree-oak', 'tree-detailed', 'tree-fat', 'tree-thin']
    .map(bakedModel).filter((t): t is BakedTemplate => !!t);
  const rocks = ['rock-a', 'rock-b'].map(bakedModel).filter((t): t is BakedTemplate => !!t);
  const clear = (x: number, z: number): boolean =>
    x > ISLE.x1 + 4 && x < ISLE.x2 - 4 && z > ISLE.z1 + 4 && z < ISLE.z2 - 4 &&
    !(x > X - HALF_W && x < X + HALF_W && z < ISLE.z1 + 10);
  for (let k = 0; k < 22 && trees.length; k++) {
    if (BRIDGE_BOXES.length >= 7) break;
    const x = ISLE.x1 + 6 + r() * (iw - 12), z = ISLE.z1 + 6 + r() * (id - 12);
    if (!clear(x, z)) continue;
    bakeTpl(B, trees[(r() * trees.length) | 0], x, 0.08, z, r() * Math.PI * 2, 4.5 + r() * 2.5);
    BRIDGE_BOXES.push({ x1: x - 0.55, x2: x + 0.55, z1: z - 0.55, z2: z + 0.55, small: 1 });
  }
  for (let k = 0; k < 8 && rocks.length; k++) {
    if (BRIDGE_BOXES.length >= 10) break;
    const x = ISLE.x1 + 5 + r() * (iw - 10), z = ISLE.z1 + 5 + r() * (id - 10);
    if (!clear(x, z)) continue;
    bakeTpl(B, rocks[(r() * rocks.length) | 0], x, 0.08, z, r() * Math.PI * 2, 2 + r() * 1.2);
    BRIDGE_BOXES.push({ x1: x - 0.8, x2: x + 0.8, z1: z - 0.8, z2: z + 0.8, small: 1 });
  }

  const mesh = B.build();
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  scene.add(mesh);
}

function bakeTpl(B: Baked, tpl: BakedTemplate, x: number, y: number, z: number, ry: number, s: number): void {
  const m = new THREE.Matrix4().compose(
    new THREE.Vector3(x, y, z),
    new THREE.Quaternion().setFromEuler(new THREE.Euler(0, ry, 0)),
    new THREE.Vector3(s, s, s),
  );
  for (const g of tpl.geos) B.raw(g.clone().applyMatrix4(m));
}
