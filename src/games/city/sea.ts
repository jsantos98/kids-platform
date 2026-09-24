// The sea: a gently waving ocean plane that follows the player, and each
// island's own Kenney watercraft fleet sailing its offshore loop (Fleet —
// owned by the island's simulation, so boats never jump between islands).
// The per-city shoreline dressing (foam, pier, dinghies, buoys, the picnic
// causeway) lives in scenery.ts.
import * as THREE from 'three';
import { C, mat } from '../../engine/stage.js';
import { bakedModel, prepBakedModels, type BakeDef } from '../../engine/assets.js';
import { templateToMesh } from '../../engine/baked.js';
import { makeSailboat, makeTugboat, makeRowboat } from '../../kit/boats.js';
import { ISLAND, CENTER } from '../../worlds/world.js';
import { coastFor } from '../../worlds/coast.js';

// gentle deterministic swell — crests stay under the island slabs (top y=0.1).
export function waveAt(x: number, z: number, t: number): number {
  return 0.032 * Math.sin(0.075 * x + t * 0.9)
       + 0.026 * Math.sin(0.105 * z - t * 0.7)
       + 0.018 * Math.sin(0.05 * (x + z) + t * 0.5);
}

// offshore lane: the island's shore pushed 26 m out to sea, resampled every
// ~3 m (city-local)
const loops = new Map<string, Array<{ x: number; z: number }>>();

/** city (bx, by)'s offshore sailing lane (city-local coordinates) */
export function boatLoop(bx: number, by: number): Array<{ x: number; z: number }> {
  const key = `${bx},${by}`;
  let loop = loops.get(key);
  if (!loop) {
    const coast = coastFor(bx, by);
    const ring = coast.pts.map(p => coast.shoreToward(p.x, p.z, 26));
    loop = [];
    for (let i = 0; i < ring.length; i++) {
      const a = ring[i], b = ring[(i + 1) % ring.length];
      const steps = Math.max(1, Math.round(Math.hypot(b.x - a.x, b.z - a.z) / 3));
      for (let k = 0; k < steps; k++) loop.push({ x: a.x + (b.x - a.x) * (k / steps), z: a.z + (b.z - a.z) * (k / steps) });
    }
    loops.set(key, loop);
    if (loops.size > 16) loops.delete(loops.keys().next().value as string);
  }
  return loop;
}

const mod = (a: number, n: number) => ((a % n) + n) % n;

/** One merged, re-centred hull mesh at the requested length (y=0 waterline). */
export function hullObject(tplName: string, len: number, fallback: () => THREE.Object3D): THREE.Object3D {
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

export class Sea {
  private water: THREE.Mesh;
  private waterBase: Float32Array;
  private ox = 0;
  private oz = 0;

  constructor(scene: THREE.Scene) {
    // ---- waving water plane (flat-shaded facets catch the light) ----
    // sized so its far edge is past full fog from any shore viewpoint
    this.water = new THREE.Mesh(
      new THREE.PlaneGeometry(ISLAND + 400, ISLAND + 400, 72, 72),
      mat(0x72c3de),
    );
    this.water.rotation.x = -Math.PI / 2;
    this.water.position.set(CENTER, -0.02, CENTER);
    this.water.receiveShadow = true;
    scene.add(this.water);
    this.waterBase = Float32Array.from(
      (this.water.geometry.attributes.position as THREE.BufferAttribute).array,
    );
  }

  /** move the water plane to the current city */
  setCity(ox: number, oz: number): void {
    this.ox = ox;
    this.oz = oz;
    this.water.position.set(ox + CENTER, -0.02, oz + CENTER);
  }

  update(elapsed: number): void {
    const pos = this.water.geometry.attributes.position as THREE.BufferAttribute;
    const arr = pos.array as Float32Array;
    for (let i = 0; i < arr.length; i += 3) {
      arr[i + 2] = waveAt(this.ox + CENTER + this.waterBase[i], this.oz + CENTER - this.waterBase[i + 1], elapsed);
    }
    pos.needsUpdate = true;
  }
}

interface Boat {
  mesh: THREE.Group;
  offset: number;
  speed: number;
  dir: 1 | -1;
  phase: number;
}

const FLEET: Array<{ tpl: string; len: number; speed: number; dir: 1 | -1; fb: () => THREE.Object3D }> = [
  { tpl: 'boat-sail-a', len: 8, speed: 5, dir: 1, fb: () => makeSailboat({ hull: C.blue }) },
  { tpl: 'boat-speed-c', len: 5, speed: 7.5, dir: -1, fb: () => makeRowboat({ hull: C.orange }) },
  { tpl: 'boat-tug-a', len: 7, speed: 3.6, dir: 1, fb: () => makeTugboat({ hull: C.red }) },
  { tpl: 'boat-sail-b', len: 6.5, speed: 4.4, dir: 1, fb: () => makeSailboat({ hull: C.teal, sail: C.cream }) },
  { tpl: 'boat-row-small', len: 3.2, speed: 2.4, dir: -1, fb: () => makeRowboat({ hull: C.teal }) },
  { tpl: 'boat-tug-b', len: 6, speed: 3.2, dir: 1, fb: () => makeTugboat({ hull: C.blue, trim: C.yellow }) },
];

/** one island's boats, sailing its offshore lane for good */
export class Fleet {
  private boats: Boat[] = [];
  private loop: Array<{ x: number; z: number }>;

  constructor(private scene: THREE.Scene, private ox: number, private oz: number, seed: number, bx: number, by: number) {
    this.loop = boatLoop(bx, by);
    const LOOP = this.loop;
    FLEET.forEach((d, i) => {
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
      // each island's fleet starts at its own seeded spots on the loop
      const off = ((i / FLEET.length) + ((seed >>> (i * 3)) & 7) / 64) * LOOP.length;
      this.boats.push({ mesh: g, offset: off, speed: d.speed, dir: d.dir, phase: i * 1.7 });
    });
  }

  hide(): void { for (const b of this.boats) b.mesh.visible = false; }

  dispose(): void { for (const b of this.boats) this.scene.remove(b.mesh); }

  update(elapsed: number): void {
    const LOOP = this.loop;
    const total = LOOP.length;
    for (const b of this.boats) {
      b.mesh.visible = true;
      const f = mod(b.offset + elapsed * (b.speed / 3) * b.dir, total);
      const i0 = Math.floor(f) % total;
      const i1 = mod(i0 + b.dir, total);
      const fr = f - Math.floor(f);
      const a = LOOP[i0], c = LOOP[i1];
      const x = this.ox + a.x + (c.x - a.x) * fr;
      const z = this.oz + a.z + (c.z - a.z) * fr;
      b.mesh.position.set(x, waveAt(x, z, elapsed) * 1.6 + 0.05, z);
      b.mesh.rotation.y = Math.atan2(c.x - a.x, c.z - a.z);
      b.mesh.rotation.x = Math.sin(elapsed * 0.7 + b.phase) * 0.035;
      b.mesh.rotation.z = Math.sin(elapsed * 0.9 + b.phase) * 0.05;
    }
  }

  /** where the boats are (world) — the minimap's white dots */
  dots(): Array<{ x: number; z: number }> {
    return this.boats.map(b => ({ x: b.mesh.position.x, z: b.mesh.position.z }));
  }
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
