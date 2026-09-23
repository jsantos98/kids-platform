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

  constructor(scene: THREE.Scene) {
    this.group.scale.setScalar(1.6);
    scene.add(this.group);
    this.cx = 0;
    this.cz = 0;
  }

  update(dt: number, elapsed: number, playerX: number, playerZ: number): void {
    // the patrol centre drifts toward the player so the heli stays in the area
    const k = Math.min(1, dt * 0.2);
    this.cx += (playerX - this.cx) * k;
    this.cz += (playerZ - this.cz) * k;
    const a = elapsed * 0.14;
    this.group.position.set(
      this.cx + Math.cos(a) * RADIUS,
      HEIGHT + Math.sin(elapsed * 0.9) * 1.5,
      this.cz + Math.sin(a) * RADIUS,
    );
    this.group.rotation.y = -a - Math.PI / 2;
    this.group.rotation.z = Math.sin(elapsed * 0.7) * 0.04;
    (this.group.userData.mainRotor as THREE.Object3D).rotation.y = elapsed * 22;
    (this.group.userData.tailRotor as THREE.Object3D).rotation.x = elapsed * 30;
  }
}
