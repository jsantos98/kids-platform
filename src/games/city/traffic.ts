// Ambient traffic: AI cars driving the road grid, obeying the traffic lights
// AND the level crossings (they queue up when a train is passing). Lanes sit
// at ±3.5 m — the boulevards are wide and forgiving.
import * as THREE from 'three';
import { makeCar } from '../../kit/index.js';
import { spawnVehicle, wheelNodes } from '../../engine/assets.js';
import { RoadGrid } from '../../worlds/roadGrid.js';
import type { Crossing } from '../../worlds/cityPlan.js';
import { lightState, STOP_LINE } from './lights.js';
import type { Trains } from './train.js';

const MODELS = [
  '/assets/kenney/sedan.glb', '/assets/kenney/taxi.glb', '/assets/kenney/suv.glb',
  '/assets/kenney/van.glb', '/assets/kenney/police.glb', '/assets/kenney/ambulance.glb',
  '/assets/kenney/hatchback-sports.glb',
];
const FALLBACK_COLORS = [0xfaf7ef, 0xd9dde2, 0x7fb2d9, 0xe25c5c];
const LANE = 3.5;   // lane centre offset from the road centreline

interface TrafficCar extends THREE.Group {
  userData: {
    axis: 0 | 1;   // 0 = drives along X, 1 = along Z
    sign: number;  // travel direction
    speed: number;
    wheels?: THREE.Object3D[];
  };
}

const j0 = (r: () => number, amp: number) => (r() - 0.5) * 2 * amp;

export class Traffic {
  private cars: TrafficCar[] = [];

  constructor(private scene: THREE.Scene, private grid: RoadGrid, private CH: number, count = 8,
              extraModels: string[] = [], private crossings: Crossing[] = [], private trains: Trains | null = null) {
    const models = [...MODELS, ...extraModels];
    for (let i = 0; i < count; i++) {
      const c = makeCar({ body: FALLBACK_COLORS[i % 4] }) as TrafficCar;
      c.userData.axis = (i % 2) as 0 | 1;
      c.userData.sign = i < 4 ? 1 : -1;
      c.userData.speed = 6 + Math.random() * 4;
      scene.add(c);
      this.cars.push(c);
      spawnVehicle(models[i % models.length], { len: 4.4 }).then(g => {
        c.clear();
        c.add(g);
        c.userData.wheels = wheelNodes(g);
      }).catch(() => {});
    }
    this.cars.forEach(c => this.respawn(c, new THREE.Vector3()));
  }

  /** Move a car onto a road lane near the player (interior island lines only). */
  respawn(c: TrafficCar, player: THREE.Vector3): void {
    const axis0 = c.userData.axis === 0;
    let g = Math.round((Math.random() < 0.5 ? player.x : player.z) / this.CH) * this.CH;
    g = Math.min(320, Math.max(64, g));
    if (axis0) {
      c.position.set(player.x + j0(Math.random, 70), 0, g + LANE * c.userData.sign);
      c.rotation.y = c.userData.sign > 0 ? Math.PI / 2 : -Math.PI / 2;
    } else {
      c.position.set(g - LANE * c.userData.sign, 0, player.z + j0(Math.random, 70));
      c.rotation.y = c.userData.sign > 0 ? 0 : Math.PI;
    }
    // keep cars off streetless stretches (a nudge is enough)
    if (axis0) {
      const row = Math.round(c.position.z / this.CH), col = Math.floor(c.position.x / this.CH);
      if (!this.grid.segH(row, col)) c.position.x += this.CH / 2;
    } else {
      const col = Math.round(c.position.x / this.CH), row = Math.floor(c.position.z / this.CH);
      if (!this.grid.segV(col, row)) c.position.z += this.CH / 2;
    }
  }

  update(dt: number, elapsed: number, player: THREE.Vector3): void {
    for (const c of this.cars) {
      let v = c.userData.speed;
      const axis0 = c.userData.axis === 0;
      const along = axis0 ? c.position.x : c.position.z;
      const dir = c.userData.sign;

      // next real intersection ahead (skips dropped lines)
      let k = dir > 0 ? Math.ceil((along + 0.01) / this.CH) : Math.floor((along - 0.01) / this.CH);
      let ix = 0, iz = 0, has = false;
      for (let n = 0; n < 6; n++) {
        const lineIdx = k + n * dir;
        const ci = axis0 ? lineIdx : Math.round(c.position.x / this.CH);
        const cj = axis0 ? Math.round(c.position.x / this.CH) : lineIdx;
        if (this.grid.cross(ci, cj)) {
          ix = ci; iz = cj;
          has = true;
          break;
        }
      }
      if (has) {
        const lineWorld = (axis0 ? ix : iz) * this.CH;
        const dist = (lineWorld - along) * dir;
        const st = lightState(ix, iz, elapsed);
        const green = axis0 ? st === 'ew' : st === 'ns';
        if (!green && dist >= STOP_LINE) v = Math.min(v, Math.max(0, (dist - STOP_LINE) * 1.2));
      }

      // level crossings: hold back while a train is passing
      if (this.trains) {
        for (const cr of this.crossings) {
          if (cr.axis !== (axis0 ? 'h' : 'v')) continue;
          const across = axis0 ? cr.z - c.position.z : cr.x - c.position.x;
          if (Math.abs(across) > 4.5) continue;
          const dist = (axis0 ? cr.x - along : cr.z - along) * dir;
          if (dist > 0.5 && dist < 34 && this.trains.distTo(cr.d) < 42) {
            v = Math.min(v, Math.max(0, (dist - 10.5) * 1.2));
          }
        }
      }

      if (axis0) c.position.x += dir * v * dt;
      else c.position.z += dir * v * dt;
      for (const w of (c.userData.wheels ?? [])) (w as THREE.Object3D).rotation.x += (v * dt) / 0.42;
      if (c.position.distanceTo(player) > 150) this.respawn(c, player);
    }
  }
}
