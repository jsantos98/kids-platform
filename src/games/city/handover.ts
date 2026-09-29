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
export const HANDOVER_T = 5.2;

/** staff walk out of the door to the vehicle, then lead the cargo (who step
 * off it) back in: nobody appears from nowhere */
interface Walker { rig: Rig; staff: boolean; side: number }

export class Handover {
  private group = new THREE.Group();
  private walkers: Walker[] = [];
  private t = 0;
  private y = 0;
  private door = { x: 0, z: 0 };
  private car = { x: 0, z: 0 };
  private repair = false;
  /** playing now */
  active = false;

  constructor(scene: THREE.Scene) { scene.add(this.group); }

  /** start one: the crew come out of the door `to` to the vehicle at `from`
   * (world; `y` the ground, or the helipad's deck) */
  start(kind: LandmarkKind, from: { x: number; z: number }, to: { x: number; z: number }, y: number, seed: number): void {
    this.clear();
    this.active = true;
    this.t = 0;
    this.y = y;
    this.car = from;
    this.door = to;
    this.repair = kind === 'repair';
    const cast: Array<[number, HatKind | null, boolean]> = kind === 'hospital' ? [[seed % 12, 'medic', true], [(seed + 5) % 12, null, false]]
      : kind === 'prison' ? [[seed % 12, 'police', true], [(seed + 7) % 12, 'beanie', false]]
      : kind === 'pier' ? [[seed % 12, 'police', true], [(seed + 3) % 12, 'pirate', false], [(seed + 9) % 12, 'pirate', false]]
      : kind === 'repair' ? [[seed % 12, 'beanie', true]]
      : [];
    cast.forEach(([id, hat, staff], k) => {
      const rig = person(id, 1.7);
      if (hat) wearHat(rig, hat);
      rig.play('walk');
      rig.root.visible = staff;
      this.group.add(rig.root);
      this.walkers.push({ rig, staff, side: (k - (cast.length - 1) / 2) * 0.9 });
    });
  }

  /** step it; true once it is over */
  update(dt: number): boolean {
    if (!this.active) return true;
    this.t += dt;
    const T = HANDOVER_T, f = this.t / T;
    const lerp = (a: number, b: number, u: number): number => a + (b - a) * Math.max(0, Math.min(1, u));
    for (const w of this.walkers) {
      // (staff: door → vehicle in the first 35 %; the cargo steps off at 40 %;
      // all walk back to the door from 45 % — the mechanic stays and waves)
      let u: number, from = this.door, to = this.car;
      if (w.staff && f < 0.4) { u = f / 0.4; }
      else if (this.repair) { u = 1; }
      else if (f < 0.45) { u = w.staff ? 1 : 0; from = this.door; to = this.car; }
      else { u = (f - 0.45) / 0.55; from = this.car; to = this.door; }
      const dx = to.x - from.x, dz = to.z - from.z, l = Math.hypot(dx, dz) || 1;
      const ox = (-dz / l) * w.side, oz = (dx / l) * w.side;
      const standing = (w.staff && f >= 0.4 && f < 0.45) || (this.repair && f >= 0.4) || (!w.staff && f < 0.45);
      w.rig.root.visible = w.staff || f >= 0.4;
      w.rig.root.position.set(lerp(from.x, to.x, u) + ox, this.y, lerp(from.z, to.z, u) + oz);
      if (!standing) w.rig.root.rotation.y = Math.atan2(dx, dz);
      const want = standing ? (this.repair ? 'emote-yes' : 'idle') : 'walk';
      if (w.rig.clip !== want) w.rig.play(want);
      w.rig.update(dt);
    }
    if (this.t >= T) { this.clear(); return true; }
    return false;
  }

  private clear(): void {
    for (const w of this.walkers) this.group.remove(w.rig.root);
    this.walkers = [];
    this.active = false;
  }
}
