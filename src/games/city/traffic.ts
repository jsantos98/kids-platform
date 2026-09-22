// Ambient traffic: AI cars driving the road grid, obeying the traffic lights.
import * as THREE from 'three';
import { makeCar } from '../../kit/index.js';
import { spawnVehicle, wheelNodes } from '../../engine/assets.js';
import { lightState, STOP_LINE } from './lights.js';

const MODELS = [
  '/assets/kenney/sedan.glb', '/assets/kenney/taxi.glb', '/assets/kenney/suv.glb',
  '/assets/kenney/van.glb', '/assets/kenney/police.glb', '/assets/kenney/ambulance.glb',
  '/assets/kenney/hatchback-sports.glb',
];
const FALLBACK_COLORS = [0xfaf7ef, 0xd9dde2, 0x7fb2d9, 0xe25c5c];

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

  constructor(private scene: THREE.Scene, private CH: number, count = 8) {
    for (let i = 0; i < count; i++) {
      const c = makeCar({ body: FALLBACK_COLORS[i % 4] }) as TrafficCar;
      c.userData.axis = (i % 2) as 0 | 1;
      c.userData.sign = i < 4 ? 1 : -1;
      c.userData.speed = 6 + Math.random() * 4;
      scene.add(c);
      this.cars.push(c);
      spawnVehicle(MODELS[i % MODELS.length], { len: 4.4 }).then(g => {
        c.clear();
        c.add(g);
        c.userData.wheels = wheelNodes(g);
      }).catch(() => {});
    }
    this.cars.forEach(c => this.respawn(c, new THREE.Vector3()));
  }

  /** Move a car onto a road lane near the player, heading along its axis. */
  respawn(c: TrafficCar, player: THREE.Vector3): void {
    const g = Math.round((Math.random() < 0.5 ? player.x : player.z) / this.CH) * this.CH;
    if (c.userData.axis === 0) {
      c.position.set(player.x + j0(Math.random, 70), 0, g + 2.3 * c.userData.sign);
      c.rotation.y = c.userData.sign > 0 ? Math.PI / 2 : -Math.PI / 2;
    } else {
      c.position.set(g - 2.3 * c.userData.sign, 0, player.z + j0(Math.random, 70));
      c.rotation.y = c.userData.sign > 0 ? 0 : Math.PI;
    }
  }

  update(dt: number, elapsed: number, player: THREE.Vector3): void {
    for (const c of this.cars) {
      let v = c.userData.speed;
      const along = c.userData.axis === 0 ? c.position.x : c.position.z;
      const grid = c.userData.sign > 0
        ? Math.ceil((along + 0.01) / this.CH) * this.CH
        : Math.floor((along - 0.01) / this.CH) * this.CH;
      const dist = (grid - along) * c.userData.sign; // metres to the crossing centre
      const ix = c.userData.axis === 0 ? Math.round(grid / this.CH) : Math.round(c.position.z / this.CH);
      const iz = c.userData.axis === 0 ? Math.round(c.position.x / this.CH) : Math.round(grid / this.CH);
      const st = lightState(ix, iz, elapsed);
      const green = c.userData.axis === 0 ? st === 'ew' : st === 'ns';
      const stopLine = STOP_LINE; // just before the crosswalk tile
      if (!green && dist >= stopLine) v = Math.min(v, Math.max(0, (dist - stopLine) * 1.2));
      if (c.userData.axis === 0) c.position.x += c.userData.sign * v * dt;
      else c.position.z += c.userData.sign * v * dt;
      for (const w of (c.userData.wheels ?? [])) (w as THREE.Object3D).rotation.x += (v * dt) / 0.42;
      if (c.position.distanceTo(player) > 150) this.respawn(c, player);
    }
  }
}
