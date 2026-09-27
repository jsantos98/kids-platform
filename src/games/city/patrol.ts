// Ambient patrol helicopter: circles the neighbourhood on its own while the
// kid plays the fire truck.
import * as THREE from 'three';
import { makeHelicopter } from '../../kit/index.js';

const RADIUS = 90;
const HEIGHT = 34;

export class PatrolHeli {
  private group = makeHelicopter();
  private cx = 0;
  private cz = 0;
  private heading = 0;
  private bank = 0;

  constructor(scene: THREE.Scene) {
    this.group.scale.setScalar(1.6);
    scene.add(this.group);
    this.cx = 0;
    this.cz = 0;
  }

  update(dt: number, elapsed: number, playerX: number, playerZ: number): void {
    // the patrol centre drifts toward the player so the heli stays in the area
    const k = Math.min(1, dt * 0.12);
    this.cx += (playerX - this.cx) * k;
    this.cz += (playerZ - this.cz) * k;
    const a = elapsed * 0.14;
    const px = this.group.position.x, pz = this.group.position.z;
    this.group.position.set(
      this.cx + Math.cos(a) * RADIUS,
      HEIGHT + Math.sin(elapsed * 0.9) * 1.5,
      this.cz + Math.sin(a) * RADIUS,
    );
    // nose first: the heading is the way it actually moved this frame (the
    // circle and the drifting centre together — the model faces +z); the
    // circle's tangent alone flew it sideways, and backwards while the kid
    // drove fast
    const dx = this.group.position.x - px, dz = this.group.position.z - pz;
    if (dt > 0 && dx * dx + dz * dz > 1e-6) {
      const want = Math.atan2(dx, dz);
      let d = want - this.heading;
      d = Math.atan2(Math.sin(d), Math.cos(d));
      const turn = d * Math.min(1, dt * 2.5);
      this.heading += turn;
      // (banked into the turn: a left turn grows the heading, and a
      // negative roll dips the left side)
      this.bank += (Math.max(-0.35, Math.min(0.35, -(turn / dt) * 0.6)) - this.bank) * Math.min(1, dt * 2);
    }
    this.group.rotation.y = this.heading;
    this.group.rotation.z = this.bank + Math.sin(elapsed * 0.7) * 0.03;
    (this.group.userData.mainRotor as THREE.Object3D).rotation.y = elapsed * 22;
    (this.group.userData.tailRotor as THREE.Object3D).rotation.x = elapsed * 30;
  }
}
