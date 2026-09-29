// A handover (G16): arriving with a pickup at its place, the cargo is
// handed over in a short scene in the world itself — nobody fades out: a
// medic walks the patient in through the hospital's door (or across the
// helipad), an officer leads the thief into the prison, a mechanic comes
// out to the tow truck and waves, officers lead the pirates off the police
// pier. The characters are the scenes' animated ones (engine/rig.ts), in
// their hats; they walk from the vehicle to the door and are gone.
import * as THREE from 'three';
import { person, type Rig } from '../../engine/rig.js';
import { wearHat, type HatKind } from './activity/hats.js';
import type { LandmarkKind } from './landmarks.js';

/** how long a handover takes (s) */
export const HANDOVER_T = 3.2;

interface Walker { rig: Rig; x0: number; z0: number; x1: number; z1: number; side: number }

export class Handover {
  private group = new THREE.Group();
  private walkers: Walker[] = [];
  private t = 0;
  private y = 0;
  /** playing now */
  active = false;

  constructor(scene: THREE.Scene) { scene.add(this.group); }

  /** start one: the cargo leaves the vehicle at `from` for the door at `to`
   * (world; `y` the ground, or the helipad's deck) */
  start(kind: LandmarkKind, from: { x: number; z: number }, to: { x: number; z: number }, y: number, seed: number): void {
    this.clear();
    this.active = true;
    this.t = 0;
    this.y = y;
    const cast: Array<[number, HatKind | null]> = kind === 'hospital' ? [[seed % 12, 'medic'], [(seed + 5) % 12, null]]
      : kind === 'prison' ? [[seed % 12, 'police'], [(seed + 7) % 12, 'beanie']]
      : kind === 'pier' ? [[seed % 12, 'police'], [(seed + 3) % 12, 'pirate'], [(seed + 9) % 12, 'pirate']]
      : kind === 'repair' ? [[seed % 12, 'beanie']]
      : [];
    // (the mechanic comes out to the truck and back; the rest walk in)
    const out = kind === 'repair';
    cast.forEach(([id, hat], k) => {
      const rig = person(id, 1.7);
      if (hat) wearHat(rig, hat);
      rig.play('walk');
      this.group.add(rig.root);
      const side = (k - (cast.length - 1) / 2) * 0.9;
      this.walkers.push(out
        ? { rig, x0: to.x, z0: to.z, x1: from.x, z1: from.z, side }
        : { rig, x0: from.x, z0: from.z, x1: to.x, z1: to.z, side });
    });
  }

  /** step it; true once it is over */
  update(dt: number): boolean {
    if (!this.active) return true;
    this.t += dt;
    const f = Math.min(1, this.t / (HANDOVER_T * 0.75));
    for (const w of this.walkers) {
      const dx = w.x1 - w.x0, dz = w.z1 - w.z0, l = Math.hypot(dx, dz) || 1;
      // (side by side: offset across the way they walk)
      const ox = (-dz / l) * w.side, oz = (dx / l) * w.side;
      w.rig.root.position.set(w.x0 + dx * f + ox, this.y, w.z0 + dz * f + oz);
      w.rig.root.rotation.y = Math.atan2(dx, dz);
      if (f >= 1 && w.rig.clip === 'walk') w.rig.play('emote-yes');
      w.rig.update(dt);
    }
    if (this.t >= HANDOVER_T) { this.clear(); return true; }
    return false;
  }

  private clear(): void {
    for (const w of this.walkers) this.group.remove(w.rig.root);
    this.walkers = [];
    this.active = false;
  }
}
