// The island railway: Kenney train-kit consists riding the seeded procedural
// rail loop (railRoute.ts). Every vehicle gets its own path distance so the
// consist articulates around corners like a real train. The rails mesh is
// built here too — track pieces from the kit baked into one island-wide mesh.
import * as THREE from 'three';
import { spawnVehicle, bakedModel } from '../../engine/assets.js';
import { rng, chunkSeed } from '../../engine/rng.js';
import { railRouteFor, bakeRails, RAIL_TOP, type RailRoute } from '../../worlds/railRoute.js';

const SPEED = 9; // m/s
const LOCO_LEN = 9;
const CAR_LEN = 7.5;
const GAP = 1.1; // coupling distance (m)

const LOCOS = ['/assets/kenney/train/train-diesel-a.glb', '/assets/kenney/train/train-locomotive-b.glb'];
const CARS = [
  '/assets/kenney/train/train-carriage-container-red.glb',
  '/assets/kenney/train/train-carriage-container-green.glb',
  '/assets/kenney/train/train-carriage-coal.glb',
  '/assets/kenney/train/train-carriage-box.glb',
  '/assets/kenney/train/train-carriage-flatbed.glb',
];

interface Unit {
  obj: THREE.Object3D | null; // null until the GLB arrives
  back: number;               // distance behind the consist head (m)
}

interface Consist {
  start: number;              // head distance at elapsed = 0
  units: Unit[];
}

export class Trains {
  private route: RailRoute;
  private consists: Consist[] = [];

  constructor(scene: THREE.Scene, seed: number) {
    this.route = railRouteFor(seed);
    // the rails: one baked mesh for the whole island
    scene.add(bakeRails(this.route, bakedModel('rail-straight')));

    // three consists, evenly spaced around the loop, random loco + wagons
    const r = rng(chunkSeed(seed, 0x7a1, 2));
    for (let t = 0; t < 3; t++) {
      const consist: Consist = { start: (t * this.route.total) / 3, units: [] };
      const loco = LOCOS[(r() * LOCOS.length) | 0];
      consist.units.push(this.makeUnit(scene, loco, LOCO_LEN, 0));
      const nCars = 2 + ((r() * 2) | 0); // 2..3 wagons
      let back = LOCO_LEN + GAP;
      for (let c = 0; c < nCars; c++) {
        consist.units.push(this.makeUnit(scene, CARS[(r() * CARS.length) | 0], CAR_LEN, back));
        back += CAR_LEN + GAP;
      }
      this.consists.push(consist);
    }
  }

  private makeUnit(scene: THREE.Scene, url: string, len: number, back: number): Unit {
    const unit: Unit = { obj: null, back };
    spawnVehicle(url, { len }).then(obj => {
      obj.traverse(o => { if ((o as THREE.Mesh).isMesh) o.castShadow = true; });
      obj.position.y = RAIL_TOP;
      scene.add(obj);
      unit.obj = obj;
    }).catch(() => { /* stays invisible; the world falls back gracefully */ });
    return unit;
  }

  update(elapsed: number): void {
    const total = this.route.total;
    for (const c of this.consists) {
      const head = c.start + elapsed * SPEED;
      for (const u of c.units) {
        if (!u.obj) continue;
        const p = this.route.sample(head - u.back);
        u.obj.position.set(p.x, RAIL_TOP, p.z);
        u.obj.rotation.y = p.h;
      }
    }
  }
}
