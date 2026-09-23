// The city train: shuttles back and forth along the nearest rail line,
// driven purely by (time, player position) so it streams with the chunks.
import * as THREE from 'three';
import { makeTrainCar, makeTrainLoco } from '../../kit/index.js';

const SPEED = 0.15;  // shuttle angular speed (rad/s)
const AMP = 40;      // shuttle amplitude around the player, in metres

export class Train {
  private group = new THREE.Group();
  private dirLast = 1;

  constructor(scene: THREE.Scene, private CH: number) {
    const loco = makeTrainLoco();
    const car1 = makeTrainCar();
    const car2 = makeTrainCar({ color: 0xf0ece2, band: 0x63b0a8 });
    loco.rotation.y = -Math.PI / 2; // train faces +X along the corridor
    car1.rotation.y = -Math.PI / 2;
    car2.rotation.y = -Math.PI / 2;
    loco.position.x = 6.4;
    car2.position.x = -6.4;
    this.group.add(loco, car1, car2);
    this.group.traverse(o => { if (o instanceof THREE.Mesh) o.castShadow = true; });
    scene.add(this.group);
  }

  update(elapsed: number, playerX: number, playerZ: number): void {
    // nearest rail line (every 4th grid line) — switches far from the player,
    // so the swap is never visible
    const lineZ = Math.round(playerZ / (this.CH * 4)) * (this.CH * 4);
    const x = playerX + Math.sin(elapsed * SPEED) * AMP;
    const dir = Math.cos(elapsed * SPEED) >= 0 ? 1 : -1;
    if (dir !== this.dirLast) {
      this.group.rotation.y = dir > 0 ? 0 : Math.PI;
      this.dirLast = dir;
    }
    this.group.position.set(x, 0.15, lineZ);
  }
}
