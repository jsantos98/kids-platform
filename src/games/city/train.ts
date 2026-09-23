// The island railway: Kenney train-kit consists riding the seeded spline loop
// (railRoute.ts). Every vehicle gets its own path distance so the consist
// articulates through the curves like a real train. Trains slow down and pause
// at the plan's stations; the rails mesh is built here too.
import * as THREE from 'three';
import { spawnVehicle, bakedModel } from '../../engine/assets.js';
import { rng, chunkSeed } from '../../engine/rng.js';
import { railRouteFor, bakeRails, RAIL_TOP, type RailRoute } from '../../worlds/railRoute.js';
import { cityPlanFor } from '../../worlds/cityPlan.js';
import { citySeed } from '../../worlds/cityGrid.js';
import { arcGap } from '../../worlds/spline.js';

const SPEED = 9;    // m/s cruising
const BRAKE = 5.5;  // m/s^2 approaching a station
const ACCEL = 2.2;  // m/s^2 leaving one
const LOCO_LEN = 9;
const CAR_LEN = 7.5;
const GAP = 1.1;    // coupling distance (m)
const HOLD = 3.6;   // seconds paused at a platform

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
  s: number;                  // head distance along the loop
  v: number;                  // current speed
  hold: number;               // seconds spent at the current station stop
  next: number;               // index into the sorted station list
  units: Unit[];
}

export class Trains {
  private route: RailRoute;
  private stations: number[] = []; // arc distances, ascending
  private consists: Consist[] = [];

  constructor(scene: THREE.Scene, bx: number, by: number) {
    const seed = citySeed(bx, by);
    this.route = railRouteFor(bx, by);
    this.stations = cityPlanFor(bx, by).stations.map(s => s.d).sort((a, b) => a - b);
    // rails + vehicles ride in this group (city-local coordinates); the game
    // offsets the group to the current city's world position each frame
    this.group = new THREE.Group();
    scene.add(this.group);
    this.group.add(bakeRails(this.route, bakedModel('rail-straight')));

    // three consists, evenly spaced around the loop, random loco + wagons
    const r = rng(chunkSeed(seed, 0x7a1, 2));
    for (let t = 0; t < 3; t++) {
      const consist: Consist = { s: (t * this.route.total) / 3, v: SPEED, hold: 0, next: 0, units: [] };
      consist.next = this.nextStation(consist.s);
      const loco = LOCOS[(r() * LOCOS.length) | 0];
      consist.units.push(this.makeUnit(loco, LOCO_LEN, 0));
      const nCars = 2 + ((r() * 2) | 0); // 2..3 wagons
      let back = LOCO_LEN + GAP;
      for (let c = 0; c < nCars; c++) {
        consist.units.push(this.makeUnit(CARS[(r() * CARS.length) | 0], CAR_LEN, back));
        back += CAR_LEN + GAP;
      }
      this.consists.push(consist);
    }
  }

  private group: THREE.Group;

  /** move the whole railway (mesh + consists) to another city */
  setCity(scene: THREE.Scene, bx: number, by: number): void {
    const seed = citySeed(bx, by);
    this.route = railRouteFor(bx, by);
    this.stations = cityPlanFor(bx, by).stations.map(s => s.d).sort((a, b) => a - b);
    // re-home the mesh + vehicles into a fresh offset group
    const parent = this.group.parent;
    if (parent) parent.remove(this.group);
    this.group = new THREE.Group();
    scene.add(this.group);
    this.group.add(bakeRails(this.route, bakedModel('rail-straight')));
    for (const c of this.consists) {
      c.next = this.nextStation(c.s);
      c.hold = 0;
      for (const u of c.units) {
        if (u.obj && u.obj.parent !== this.group) {
          (u.obj.parent ?? scene).remove(u.obj);
          this.group.add(u.obj);
        }
      }
    }
  }

  /** world offset applied to mesh + vehicles this frame */
  setOrigin(ox: number, oz: number): void {
    this.group.position.set(ox, 0, oz);
  }

  /** wrapped arc distance from `s` to the next station ahead */
  private nextStation(s: number): number {
    if (!this.stations.length) return 0;
    let best = 0, bestGap = Infinity;
    for (let i = 0; i < this.stations.length; i++) {
      const g = ((this.stations[i] - s) % this.route.total + this.route.total) % this.route.total;
      if (g < bestGap) { bestGap = g; best = i; }
    }
    return best;
  }

  private makeUnit(url: string, len: number, back: number): Unit {
    const unit: Unit = { obj: null, back };
    spawnVehicle(url, { len }).then(obj => {
      obj.traverse(o => { if ((o as THREE.Mesh).isMesh) o.castShadow = true; });
      obj.position.y = RAIL_TOP;
      this.group.add(obj);
      unit.obj = obj;
    }).catch(() => { /* stays invisible; the world falls back gracefully */ });
    return unit;
  }

  /** shortest wrapped distance from any train unit to arc position d —
   * the level-crossing signals and the traffic AI both ask this */
  distTo(d: number): number {
    let best = Infinity;
    for (const c of this.consists) {
      for (const u of c.units) {
        if (!u.obj) continue;
        const g = arcGap(c.s - u.back, d, this.route.total);
        if (g < best) best = g;
      }
    }
    return best;
  }

  update(dt: number): void {
    const total = this.route.total;
    for (const c of this.consists) {
      if (this.stations.length) {
        const gap = ((this.stations[c.next] - c.s) % total + total) % total;
        if (gap < 1.6) {
          // dwelling at the platform
          c.v = 0;
          c.hold += dt;
          if (c.hold >= HOLD) {
            c.hold = 0;
            c.next = (c.next + 1) % this.stations.length;
          }
        } else {
          const target = gap < 34 ? Math.max(0.35, gap * 0.42) : SPEED;
          const dv = target - c.v;
          c.v += Math.max(-BRAKE * dt, Math.min(ACCEL * dt, dv));
        }
      }
      c.s += c.v * dt;
      for (const u of c.units) {
        if (!u.obj) continue;
        const p = this.route.sample(c.s - u.back);
        u.obj.position.set(p.x, RAIL_TOP, p.z);
        u.obj.rotation.y = p.h;
      }
    }
  }
}
