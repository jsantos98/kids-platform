// Digging up the treasure (G15, G4): the pirate ship lies at anchor off the
// treasure islet and its captain is on the beach with a treasure detector.
// Five sand mounds lie along the sand; the treasure is under one of them
// (never the middle one — nobody at the wheel mustn't find it). The wheel
// walks the pirate left and right; the detector beeps faster the nearer the
// treasure is, and sparkles rise off the right mound once they're close.
// Reaching it, the pirate stops and digs by itself — progress never drains,
// and standing still anywhere else does nothing — until the chest pops up out
// of the hole, spilling gold. It can't be lost.
import * as THREE from 'three';
import { rng, type Rng } from '../../../engine/rng.js';
import { t as tr } from '../../../i18n/index.js';
import { person, type Rig } from '../../../engine/rig.js';
import { Baked } from '../../../engine/baked.js';
import { SeaSet, pkModel } from './seaset.js';
import { wearHat } from './hats.js';
import { marker } from './set.js';
import type { Activity, ActivityInput, ActivityState, SceneCue, SceneLoop } from './common.js';

const MOUNDS = [-7, -3.5, 0, 3.5, 7];
const REACH = 9.5;
/** how near the treasure the pirate must stand to dig, and how long digging takes */
const DIG_R = 1.2, DIG_T = 2.4;
const SAND = 0xf0e2c0;

export class DigActivity implements Activity {
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  cues: SceneCue[] = [];
  loops = new Set<SceneLoop>(['waves']);
  private set: SeaSet;
  private r: Rng;
  private pirate: Rig;
  private tx: number;
  private px = 0;
  private progress = 0;
  private found = false;
  private beepT = 0;
  private digT = 0;
  private chest: THREE.Object3D | null = null;
  private hole: THREE.Object3D | null = null;
  private detector: THREE.Object3D;
  private won = false;
  /** reached the treasure: digging now, the wheel let go of */
  private digging = false;

  constructor(seed: number) {
    this.r = rng(seed * 977 + 3);
    const r = this.r;
    const pick = [0, 1, 3, 4][(r() * 4) | 0];
    this.tx = MOUNDS[pick];
    const set = this.set = new SeaSet(seed, { fogFar: 200 });
    this.scene = set.scene;
    this.camera = set.camera;

    // the islet: a sand mound in the sea, palms and rocks along its back
    const B = new Baked();
    B.cyl(22, 26, 1.2, 40, SAND, 0, -0.2, -4);
    B.cyl(16, 22, 0.6, 36, 0xf5e8c8, 0, 0.6, -4);
    for (const x of MOUNDS) B.cyl(0.4, 1.2, 0.5, 12, 0xe8d6ae, x, 1.1, 0);
    const beach = B.build();
    beach.receiveShadow = true;
    this.scene.add(beach);
    const palms = ['palm-detailed-bend', 'palm-bend', 'palm-detailed-straight', 'palm-straight'];
    for (let k = 0; k < 6; k++) {
      const p = pkModel(palms[k % 4], 1.5, r() * 6);
      p.position.set(-15 + k * 6 + (r() - 0.5) * 2, 0.8, -9 - r() * 6);
      this.scene.add(p);
    }
    for (const [x, z, n] of [[-13, -2, 'rocks-sand-a'], [12, -5, 'rocks-sand-b'], [3, -14, 'rocks-sand-c']] as Array<[number, number, string]>) {
      const m = pkModel(n, 1.5, r() * 6);
      m.position.set(x, 0.5, z);
      this.scene.add(m);
    }
    const flag = pkModel('flag-pirate', 2.2, 0.4);
    flag.position.set(-6, 0.8, -10);
    this.scene.add(flag);
    // the ship at anchor behind, and the rowboat pulled up on the sand
    const ship = pkModel('ship-pirate-medium', 1.2, -Math.PI / 2 + 0.3);
    ship.position.set(10, 0, -46);
    this.scene.add(ship);
    const row = pkModel('boat-row-small', 1.6, 0.9);
    row.position.set(-12, 0.7, 5);
    this.scene.add(row);

    // the captain, with the treasure detector held up over the sand
    this.pirate = set.addRig(wearHat(person((seed + 3) % 12, 1.6), 'pirate'), 0, 0.9, 3, Math.PI);
    this.pirate.play('idle');
    this.detector = marker('📡', 1.1);
    this.scene.add(this.detector);
    set.shot({ x: 0, y: 7.5, z: 17 }, { x: 0, y: 1, z: -1 });
  }

  aim(): number { return Math.max(-1, Math.min(1, this.tx / REACH)); }

  update(dt: number, elapsed: number, inp: ActivityInput): ActivityState {
    this.set.night = inp.night ?? 0;
    const set = this.set;
    const steer = Math.max(-1, Math.min(1, inp.steer));
    if (!this.found) {
      // the wheel walks the pirate along the beach
      const want = steer * REACH;
      const step = this.digging ? 0 : Math.max(-5 * dt, Math.min(5 * dt, want - this.px));
      this.px += step;
      const walking = Math.abs(step) > 0.02;
      const near = Math.abs(this.px - this.tx);
      // (once there, the pirate stays and digs to the end — a child swinging
      // the wheel past it would never have stood still long enough)
      if (near < DIG_R) this.digging = true;
      if (this.digging) {
        // over the treasure: dig (it never drains)
        this.progress = Math.min(1, this.progress + dt / DIG_T);
        this.digT -= dt;
        if (this.digT <= 0) {
          this.digT = 0.55;
          this.pirate.play('interact-right', { loop: false });
          set.smoke.puff(this.tx + (this.r() - 0.5), 1.4, 0.4, 0.8, 0, 0.7);
          this.cues.push('dig');
        }
        if (this.progress >= 1) this.dig();
      } else if (this.pirate.clip !== (walking ? 'walk' : 'idle')) this.pirate.play(walking ? 'walk' : 'idle');
      this.pirate.root.rotation.y = walking ? (step > 0 ? Math.PI / 2 : -Math.PI / 2) : Math.PI;
      // the detector: beeps faster the nearer, sparkles off the right mound when close
      this.beepT -= dt;
      if (this.beepT <= 0) {
        this.beepT = 0.18 + Math.min(1.2, near * 0.12);
        this.cues.push('beep');
        if (near < 3) set.sparkles.burst(new THREE.Vector3(this.tx, 1.6, 0), 'twinkle', 3, 0.35, 1.4);
      }
    }
    this.pirate.root.position.set(this.px, 0.9, 3);
    this.detector.position.set(this.px, 3.2 + Math.sin(elapsed * 6) * 0.08, 3);
    this.detector.visible = !this.found;
    if (this.chest) {
      this.chest.position.y = Math.min(1.2, this.chest.position.y + dt * 2.5);
      this.chest.rotation.y += dt * 0.8;
    }
    set.update(dt);
    const near = Math.abs(this.px - this.tx) < DIG_R;
    return {
      progress: this.progress,
      prompt: this.found ? tr('scene.dig.found') : near ? tr('scene.dig.digging') : tr('scene.dig.find'),
      done: this.found,
    };
  }

  /** the chest comes up out of the hole, spilling gold */
  private dig(): void {
    if (this.found) return;
    this.found = true;
    this.hole = pkModel('hole', 1.8);
    this.hole.position.set(this.tx, 1.05, 0);
    this.scene.add(this.hole);
    this.chest = pkModel('chest', 1.6);
    this.chest.position.set(this.tx, -0.8, 0);
    this.scene.add(this.chest);
    this.pirate.play('emote-yes');
    this.set.sparkles.burst(new THREE.Vector3(this.tx, 2.2, 0), 'star', 16, 0.7, 4);
    this.set.particles.burstConfetti(new THREE.Vector3(this.tx, 1.4, 0));
    this.cues.push('coins');
  }

  celebrate(): void {
    if (this.won) return;
    this.won = true;
    this.set.pushIn(new THREE.Vector3(this.tx, 4, 9));
    this.set.sparkles.burst(new THREE.Vector3(this.tx, 3, 0), 'star', 12, 0.6, 3);
  }

  dispose(): void {
    this.set.dispose();
  }
}
