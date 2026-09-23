// The island sea: a gently waving ocean plane around the island, foam surf on
// the beach rim, a wooden pier with moored dinghies, and Kenney watercraft
// sailing an offshore loop (CC0 watercraft kit, baked to vertex colors like
// the city kit; procedural boats only as fallback if the assets are missing).
// Purely scenic — the player can never reach the water.
import * as THREE from 'three';
import { C, mat } from '../../engine/stage.js';
import { bakedModel, prepBakedModels, type BakeDef } from '../../engine/assets.js';
import { Baked, templateToMesh } from '../../engine/baked.js';
import { makeSailboat, makeTugboat, makeRowboat } from '../../kit/boats.js';

const ISLAND = 384;
const CENTER = ISLAND / 2;

// gentle deterministic swell — crests stay under the island slabs (top y=0.1).
// Also drives the boats/buoys so everything floats on the same water.
function waveAt(x: number, z: number, t: number): number {
  return 0.032 * Math.sin(0.075 * x + t * 0.9)
       + 0.026 * Math.sin(0.105 * z - t * 0.7)
       + 0.018 * Math.sin(0.05 * (x + z) + t * 0.5);
}

// offshore lane: rounded rectangle 52 m beyond the island edge, ~3 m spacing.
// The south run detours around the bridge + picnic island (bridge.ts).
const LO = -26, HI = ISLAND + 26, CUT = 26;
const CORNERS: Array<{ x: number; z: number }> = [
  { x: LO + CUT, z: LO }, { x: HI - CUT, z: LO },
  { x: HI, z: LO + CUT }, { x: HI, z: HI - CUT },
  { x: HI - CUT, z: HI },
  // swing wide around the bridge island before rejoining the south run
  { x: 292, z: HI }, { x: 262, z: HI + 38 }, { x: 248, z: HI + 58 },
  { x: 120, z: HI + 58 }, { x: 106, z: HI + 38 }, { x: 76, z: HI },
  { x: LO + CUT, z: HI },
  { x: LO, z: HI - CUT }, { x: LO, z: LO + CUT },
];
function buildLoop(): Array<{ x: number; z: number }> {
  const pts: Array<{ x: number; z: number }> = [];
  for (let i = 0; i < CORNERS.length; i++) {
    const a = CORNERS[i], b = CORNERS[(i + 1) % CORNERS.length];
    const len = Math.hypot(b.x - a.x, b.z - a.z);
    const steps = Math.max(1, Math.round(len / 3));
    for (let k = 0; k < steps; k++) {
      const f = k / steps;
      pts.push({ x: a.x + (b.x - a.x) * f, z: a.z + (b.z - a.z) * f });
    }
  }
  return pts;
}
const LOOP = buildLoop();

const mod = (a: number, n: number) => ((a % n) + n) % n;

/** One merged, re-centred hull mesh at the requested length (y=0 waterline). */
function hullObject(tplName: string, len: number, fallback: () => THREE.Object3D): THREE.Object3D {
  const tpl = bakedModel(tplName);
  if (!tpl) return fallback();
  const m = templateToMesh(tpl);
  const s = len / Math.max(tpl.size.x, tpl.size.z);
  m.geometry.scale(s, s, s);
  m.geometry.computeBoundingBox();
  const bb = m.geometry.boundingBox!;
  m.geometry.translate(-(bb.min.x + bb.max.x) / 2, -bb.min.y, -(bb.min.z + bb.max.z) / 2);
  m.castShadow = true;
  return m;
}

interface Boat {
  mesh: THREE.Group;
  offset: number;
  speed: number;
  dir: 1 | -1;
  phase: number;
}

interface Bobber {
  mesh: THREE.Object3D;
  x: number; z: number;
  amp: number;
  phase: number;
}

export class Sea {
  private boats: Boat[] = [];
  private bobbers: Bobber[] = [];
  private water: THREE.Mesh;
  private waterBase: Float32Array;
  private foamMat: THREE.MeshLambertMaterial;

  constructor(scene: THREE.Scene) {
    // ---- waving water plane (flat-shaded facets catch the light) ----
    // sized so its far edge is past full fog from any shore viewpoint
    this.water = new THREE.Mesh(
      new THREE.PlaneGeometry(1200, 1200, 72, 72),
      mat(0x72c3de),
    );
    this.water.rotation.x = -Math.PI / 2;
    this.water.position.set(CENTER, -0.02, CENTER);
    this.water.receiveShadow = true;
    scene.add(this.water);
    this.waterBase = Float32Array.from(
      (this.water.geometry.attributes.position as THREE.BufferAttribute).array,
    );

    // ---- foam surf hugging the beach rim ----
    this.foamMat = mat(0xffffff, { transparent: true, opacity: 0.4, depthWrite: false });
    const strip = (w: number, d: number, x: number, z: number) => {
      const m = new THREE.Mesh(new THREE.BoxGeometry(w, 0.1, d), this.foamMat);
      m.position.set(x, 0.05, z);
      scene.add(m);
    };
    strip(3, ISLAND + 6, -1.8, CENTER);
    strip(3, ISLAND + 6, ISLAND + 1.8, CENTER);
    strip(ISLAND + 6, 3, CENTER, -1.8);
    strip(ISLAND + 6, 3, CENTER, ISLAND + 1.8);

    this.buildPier(scene);
    this.buildBoats(scene);
  }

  /** Wooden pier off the race-corner shore + moored dinghies + buoys + ship. */
  private buildPier(scene: THREE.Scene): void {
    scene.add(bakePier());

    // dinghies moored alongside (bobbing, heading along the shore)
    for (const [x, z, phase] of [[326.5, 394, 1.2], [341.5, 398, 4.1]] as Array<[number, number, number]>) {
      const boat = hullObject('boat-row-large', 4, () => makeRowboat({ hull: C.brown }));
      boat.rotation.y = Math.PI / 2;
      boat.position.set(x, 0, z);
      scene.add(boat);
      this.bobbers.push({ mesh: boat, x, z, amp: 1.6, phase });
    }

    // course buoys just outside the sailing lane
    for (let k = 0; k < 6; k++) {
      const p = LOOP[Math.floor((k / 6) * LOOP.length)];
      const nx = p.x - CENTER, nz = p.z - CENTER;
      const nl = Math.hypot(nx, nz) || 1;
      const x = p.x + (nx / nl) * 8, z = p.z + (nz / nl) * 8;
      const name = k % 2 ? 'buoy' : 'buoy-flag';
      const tpl = bakedModel(name);
      if (!tpl) continue;
      const buoy = hullObject(name, k % 2 ? 1.4 : 2.2, () => new THREE.Group());
      buoy.position.set(x, 0, z);
      buoy.rotation.y = Math.random() * Math.PI * 2;
      scene.add(buoy);
      this.bobbers.push({ mesh: buoy, x, z, amp: 1.4, phase: k * 2.3 });
    }

    // an anchored cargo ship off the race-circuit shore
    const ship = hullObject('ship-cargo-a', 30, () => new THREE.Group());
    ship.rotation.y = 0.5;
    ship.position.set(424, 0, 348);
    scene.add(ship);
    this.bobbers.push({ mesh: ship, x: 424, z: 348, amp: 0.5, phase: 2.8 });
  }

  private buildBoats(scene: THREE.Scene): void {
    const defs: Array<{ tpl: string; len: number; speed: number; dir: 1 | -1; fb: () => THREE.Object3D }> = [
      { tpl: 'boat-sail-a', len: 8, speed: 5, dir: 1, fb: () => makeSailboat({ hull: C.blue }) },
      { tpl: 'boat-speed-c', len: 5, speed: 7.5, dir: -1, fb: () => makeRowboat({ hull: C.orange }) },
      { tpl: 'boat-tug-a', len: 7, speed: 3.6, dir: 1, fb: () => makeTugboat({ hull: C.red }) },
      { tpl: 'boat-sail-b', len: 6.5, speed: 4.4, dir: 1, fb: () => makeSailboat({ hull: C.teal, sail: C.cream }) },
      { tpl: 'boat-row-small', len: 3.2, speed: 2.4, dir: -1, fb: () => makeRowboat({ hull: C.teal }) },
      { tpl: 'boat-tug-b', len: 6, speed: 3.2, dir: 1, fb: () => makeTugboat({ hull: C.blue, trim: C.yellow }) },
    ];
    defs.forEach((d, i) => {
      const g = new THREE.Group();
      g.add(hullObject(d.tpl, d.len, d.fb));
      // foam wake trailing the stern
      const wake = new THREE.Mesh(
        new THREE.PlaneGeometry(d.len * 0.55, d.len * 1.4),
        mat(C.white, { transparent: true, opacity: 0.45, depthWrite: false }),
      );
      wake.rotation.x = -Math.PI / 2;
      wake.position.set(0, 0.06, -d.len * 0.72);
      g.add(wake);
      g.rotation.order = 'YXZ';
      scene.add(g);
      this.boats.push({ mesh: g, offset: (i * LOOP.length) / defs.length, speed: d.speed, dir: d.dir, phase: i * 1.7 });
    });
  }

  update(elapsed: number): void {
    // swell
    const pos = this.water.geometry.attributes.position as THREE.BufferAttribute;
    const arr = pos.array as Float32Array;
    for (let i = 0; i < arr.length; i += 3) {
      arr[i + 2] = waveAt(CENTER + this.waterBase[i], CENTER - this.waterBase[i + 1], elapsed);
    }
    pos.needsUpdate = true;

    // surf breathing
    this.foamMat.opacity = 0.3 + 0.14 * (0.5 + 0.5 * Math.sin(elapsed * 0.9));

    // sailing boats follow the lane
    const total = LOOP.length;
    for (const b of this.boats) {
      const f = mod(b.offset + elapsed * (b.speed / 3) * b.dir, total);
      const i0 = Math.floor(f) % total;
      const i1 = mod(i0 + b.dir, total);
      const fr = f - Math.floor(f);
      const a = LOOP[i0], c = LOOP[i1];
      const x = a.x + (c.x - a.x) * fr;
      const z = a.z + (c.z - a.z) * fr;
      b.mesh.position.set(x, waveAt(x, z, elapsed) * 1.6 + 0.05, z);
      b.mesh.rotation.y = Math.atan2(c.x - a.x, c.z - a.z);
      b.mesh.rotation.x = Math.sin(elapsed * 0.7 + b.phase) * 0.035;
      b.mesh.rotation.z = Math.sin(elapsed * 0.9 + b.phase) * 0.05;
    }

    // buoys, dinghies and the anchored ship ride the swell
    for (const b of this.bobbers) {
      b.mesh.position.y = waveAt(b.x, b.z, elapsed) * b.amp + 0.03;
      b.mesh.rotation.x = Math.sin(elapsed * 0.8 + b.phase) * 0.02 * b.amp;
      b.mesh.rotation.z = Math.sin(elapsed * 0.65 + b.phase) * 0.03 * b.amp;
    }
  }

  /** Moving boats only — the minimap draws these as white dots. */
  boatDots(): Array<{ x: number; z: number }> {
    return this.boats.map(b => ({ x: b.mesh.position.x, z: b.mesh.position.z }));
  }
}

// pier deck, beams, posts and bollards in one baked mesh (south shore,
// race-corner beach: deck runs z 384→403 at x 330..338)
function bakePier(): THREE.Mesh {
  const wood = C.brown, dark = C.brownDark;
  const B = new Baked();
  B.box(8, 0.16, 19, wood, 334, 0.42, 393.5);         // deck out to z=403
  for (const x of [330.5, 333.5, 336.5]) B.box(0.14, 0.04, 19, dark, x, 0.51, 393.5);
  for (const x of [330.2, 337.8]) B.box(0.32, 0.2, 19, dark, x, 0.45, 393.5);
  for (const z of [386.5, 393.5, 400.5]) {
    for (const x of [330.9, 337.1]) B.cyl(0.18, 0.22, 2.4, 8, dark, x, -0.4, z);
  }
  for (const x of [332.4, 335.6]) B.cyl(0.14, 0.18, 0.5, 8, dark, x, 0.75, 401.5); // bollards
  return B.build();
}

/** Bake the watercraft kit templates, then build the sea. */
export async function createSea(scene: THREE.Scene): Promise<Sea> {
  const WC = '/assets/kenney/watercraft';
  const MAP = `${WC}/Textures/colormap.png`;
  const def = (n: string): BakeDef => [`${WC}/${n}.glb`, MAP];
  await prepBakedModels({
    'boat-sail-a': def('boat-sail-a'),
    'boat-sail-b': def('boat-sail-b'),
    'boat-tug-a': def('boat-tug-a'),
    'boat-tug-b': def('boat-tug-b'),
    'boat-speed-c': def('boat-speed-c'),
    'boat-row-small': def('boat-row-small'),
    'boat-row-large': def('boat-row-large'),
    'buoy': def('buoy'),
    'buoy-flag': def('buoy-flag'),
    'ship-cargo-a': def('ship-cargo-a'),
  }).catch(() => {});
  return new Sea(scene);
}
