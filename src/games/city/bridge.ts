// The bridge: a low causeway leaving the island's south shore (at x =
// BRIDGE_X, from wherever the coast is there) to a little picnic island in
// the sea. The physics is flat 2D, so the deck sits
// flush with the island slabs — the parapets, fender piles and corner lamps
// do the looking, and the parapets are deliberately collision-free (driving
// off into the shallows is half the fun).
import * as THREE from 'three';
import { Baked } from '../../engine/baked.js';
import { bakedModel, type BakedTemplate } from '../../engine/assets.js';
import { rng, chunkSeed } from '../../engine/rng.js';
import { ISLAND, BRIDGE_X, CENTER } from '../../worlds/world.js';
import { coastFor } from '../../worlds/coast.js';
import type { CollisionBox } from '../../worlds/cityChunk.js';

const ASPHALT = 0x5f6771;
const DASH = 0xe8e4d8;
const CURB = 0xcfc9ba;
const CAP = 0x9a948a;
const WOOD = 0x8a6a4a;
const GRASS = 0xa9c88b;
const BEACH = 0xf0e2c0;

const X = BRIDGE_X;
const HALF_W = 5.5;

export interface BridgeLayout {
  X: number;
  HALF_W: number;
  /** deck from the south shore (z0 overlaps the beach) to the picnic island */
  Z0: number;
  Z1: number;
  ISLE: { x1: number; z1: number; x2: number; z2: number };
}

/** city (bx, by)'s picnic bridge + island (city-local): the deck leaves the
 * south shore where the coast meets x = BRIDGE_X and runs 40 m out */
const layouts = new Map<string, BridgeLayout>();
export function bridgeLayout(bx: number, by: number): BridgeLayout {
  const key = `${bx},${by}`;
  const hit = layouts.get(key);
  if (hit) return hit;
  if (layouts.size > 32) layouts.clear();
  const coast = coastFor(bx, by);
  let shore = CENTER;
  while (shore < ISLAND && coast.inLand(X, shore + 1, 1)) shore++;
  const Z0 = shore - 3, Z1 = shore + 37;
  const out = { X, HALF_W, Z0, Z1, ISLE: { x1: X - 20, z1: Z1, x2: X + 20, z2: Z1 + 40 } };
  layouts.set(key, out);
  return out;
}

/** the picnic island's lighthouse: its lamp and the beam that sweeps round
 * at night (G10), world coordinates */
export interface Lighthouse { lamp: THREE.Mesh; beam: THREE.Group; x: number; y: number; z: number }
export interface BuiltBridge { group: THREE.Group; boxes: CollisionBox[]; lighthouse: Lighthouse }

/** the lighthouse's height to its lamp (m) */
const LAMP_Y = 15.6;

/** two long soft cones of light from the lamp, opposite ways, fading out
 * along their length (additive, drawn at night) */
function makeBeam(): THREE.Group {
  const g = new THREE.Group();
  const mat = new THREE.MeshBasicMaterial({
    vertexColors: true, transparent: true, opacity: 0, depthWrite: false, fog: false,
    side: THREE.DoubleSide, blending: THREE.AdditiveBlending, toneMapped: false,
  });
  for (const yaw of [0, Math.PI]) {
    const geo = new THREE.CylinderGeometry(0.5, 9, 90, 20, 6, true);
    // (its narrow top turned onto -x, then shifted so it starts at the lamp)
    geo.rotateZ(Math.PI / 2);
    geo.translate(45, 0, 0);
    const pos = geo.attributes.position, col = new Float32Array(pos.count * 3);
    for (let i = 0; i < pos.count; i++) {
      const f = Math.pow(1 - pos.getX(i) / 90, 1.8);
      col.set([1 * f, 0.93 * f, 0.72 * f], i * 3);
    }
    geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
    const m = new THREE.Mesh(geo, mat);
    m.rotation.y = yaw;
    m.rotation.z = -0.06; // (dipping a little toward the sea)
    g.add(m);
  }
  g.visible = false;
  return g;
}

/** Build this city's picnic-island causeway, offset into world space. */
export function buildBridge(bx: number, by: number, ox: number, oz: number): BuiltBridge {
  const { Z0, Z1, ISLE } = bridgeLayout(bx, by);
  const B = new Baked();
  const boxes: CollisionBox[] = [];
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

  // the picnic island: a sand slab with the grass on top, 6 m in from its
  // rim (their tops at different heights — coplanar, they z-fought)
  const iw = ISLE.x2 - ISLE.x1, id = ISLE.z2 - ISLE.z1;
  const icx = (ISLE.x1 + ISLE.x2) / 2, icz = (ISLE.z1 + ISLE.z2) / 2;
  B.box(iw, 0.08, id, BEACH, icx, 0.04, icz);
  B.box(iw - 12, 0.12, id - 12, GRASS, icx, 0.06, icz);

  // the lighthouse, on the island's far corner: a white tower with red
  // bands, its gallery, the lamp room and a red cap (G10: its lamp and
  // beam light up at night)
  const LX = ISLE.x2 - 8, LZ = ISLE.z2 - 8;
  B.cyl(3.4, 3.8, 0.8, 16, 0x9a948a, LX, 0.4, LZ);
  const bands = 6, H = 13.6;
  for (let k = 0; k < bands; k++) {
    const y0 = 0.8 + (k * H) / bands, rb = 3 - (k * 1.1) / bands, rt = 3 - ((k + 1) * 1.1) / bands;
    B.cyl(rt, rb, H / bands, 16, k % 2 ? 0xd9473f : 0xf7f3ea, LX, y0 + H / bands / 2, LZ);
  }
  B.cyl(2.5, 2.5, 0.35, 16, 0x3c4450, LX, 14.6, LZ);
  for (let k = 0; k < 12; k++) {
    const a = (k / 12) * Math.PI * 2;
    B.box(0.1, 0.9, 0.1, 0x3c4450, LX + Math.cos(a) * 2.35, 15.2, LZ + Math.sin(a) * 2.35);
  }
  B.cyl(2.45, 2.45, 0.08, 16, 0x3c4450, LX, 15.65, LZ);
  B.cyl(1.4, 1.4, 0.25, 12, 0x3c4450, LX, 16.9, LZ);
  B.cone(1.7, 1.4, 12, 0xd9473f, LX, 17.7, LZ);
  B.sphere(0.25, 0x3c4450, LX, 18.5, LZ);
  boxes.push({ x1: LX - 3.2, x2: LX + 3.2, z1: LZ - 3.2, z2: LZ + 3.2 });

  // trees + rocks (deterministic scatter, clear of the bridge landing)
  const trees = ['tree-default', 'tree-oak', 'tree-detailed', 'tree-fat', 'tree-thin']
    .map(bakedModel).filter((t): t is BakedTemplate => !!t);
  const rocks = ['rock-a', 'rock-b'].map(bakedModel).filter((t): t is BakedTemplate => !!t);
  const clear = (x: number, z: number): boolean =>
    x > ISLE.x1 + 4 && x < ISLE.x2 - 4 && z > ISLE.z1 + 4 && z < ISLE.z2 - 4 &&
    !(x > X - HALF_W && x < X + HALF_W && z < ISLE.z1 + 10) && Math.hypot(x - LX, z - LZ) > 6;
  for (let k = 0; k < 22 && trees.length; k++) {
    if (boxes.length >= 7) break;
    const x = ISLE.x1 + 6 + r() * (iw - 12), z = ISLE.z1 + 6 + r() * (id - 12);
    if (!clear(x, z)) continue;
    bakeTpl(B, trees[(r() * trees.length) | 0], x, 0.08, z, r() * Math.PI * 2, 4.5 + r() * 2.5);
    boxes.push({ x1: x - 0.55, x2: x + 0.55, z1: z - 0.55, z2: z + 0.55, small: 1 });
  }
  for (let k = 0; k < 8 && rocks.length; k++) {
    if (boxes.length >= 10) break;
    const x = ISLE.x1 + 5 + r() * (iw - 10), z = ISLE.z1 + 5 + r() * (id - 10);
    if (!clear(x, z)) continue;
    bakeTpl(B, rocks[(r() * rocks.length) | 0], x, 0.08, z, r() * Math.PI * 2, 2 + r() * 1.2);
    boxes.push({ x1: x - 0.8, x2: x + 0.8, z1: z - 0.8, z2: z + 0.8, small: 1 });
  }

  const mesh = B.build();
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  const group = new THREE.Group();
  group.add(mesh);
  // the lamp room's glass (lit at night) and the beam
  const glass = new THREE.Mesh(new THREE.CylinderGeometry(1.1, 1.1, 1.3, 12),
    new THREE.MeshBasicMaterial({ color: 0xcfe3ea, toneMapped: false }));
  glass.position.set(LX, LAMP_Y, LZ);
  group.add(glass);
  const beam = makeBeam();
  beam.position.set(LX, LAMP_Y, LZ);
  group.add(beam);
  group.position.set(ox, 0, oz);
  return { group, boxes, lighthouse: { lamp: glass, beam, x: LX + ox, y: LAMP_Y, z: LZ + oz } };
}

function bakeTpl(B: Baked, tpl: BakedTemplate, x: number, y: number, z: number, ry: number, s: number): void {
  const m = new THREE.Matrix4().compose(
    new THREE.Vector3(x, y, z),
    new THREE.Quaternion().setFromEuler(new THREE.Euler(0, ry, 0)),
    new THREE.Vector3(s, s, s),
  );
  for (const g of tpl.geos) B.raw(g.clone().applyMatrix4(m));
}
