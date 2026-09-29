// The pull-over (G15, G4): the police boat has caught up with a boat
// breaking the law — a speedboat racing where it shouldn't, or the pirate
// ship — and now it's a chase down the waves: the offender weaves from side
// to side ahead, and the wheel steers the police boat across to stay right
// in its wake (the camera rides behind the police boat: right on the wheel
// is right on screen). Every moment in its wake fills the bar — it never
// drains — until the offender gives up: it slows, stops, and its crew put
// their hands up. It can't be lost. Foam streams past to show the speed.
import * as THREE from 'three';
import { t as tr } from '../../../i18n/index.js';
import { person, type Rig } from '../../../engine/rig.js';
import { PRIMS as P } from '../../../engine/stage.js';
import { hullObject } from '../sea.js';
import { SeaSet, pkModel } from './seaset.js';
import { wearHat } from './hats.js';
import { marker } from './set.js';
import type { Activity, ActivityInput, ActivityState, SceneCue, SceneLoop } from './common.js';

export type PullOverVariant = 'speeder' | 'rival';

/** how far the police boat steers either side, and how fast */
const RANGE = 8, SIDE_SPEED = 7;
/** in its wake: within this of the offender's line */
const WAKE = 1.7;
/** seconds in the wake, in all, that make it stop */
const NEED = 5;
const POLICE_Z = 6, AHEAD_Z = -14;

export class PullOverActivity implements Activity {
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  cues: SceneCue[] = [];
  loops = new Set<SceneLoop>(['waves']);
  private set: SeaSet;
  private police = new THREE.Group();
  private bad = new THREE.Group();
  private lamps: THREE.Mesh[] = [];
  private crew: Rig[] = [];
  private foam: Array<{ m: THREE.Mesh; t: number }> = [];
  private foamT = 0;
  private icon: THREE.Object3D;
  private px = 0;
  private bx = 0;
  private bz = AHEAD_Z;
  private t = 0;
  private held = 0;
  private stopT = -1;
  private won = false;
  private readonly amp: number;
  private readonly w: number;
  private readonly phase: number;

  constructor(seed: number, readonly variant: PullOverVariant = 'speeder') {
    const set = this.set = new SeaSet(seed, { fogFar: 260 });
    this.scene = set.scene;
    this.camera = set.camera;
    const r = set.r;
    this.amp = variant === 'rival' ? 4 + r() * 1.5 : 5 + r() * 1.5;
    this.w = variant === 'rival' ? 0.45 + r() * 0.15 : 0.6 + r() * 0.2;
    this.phase = r() * Math.PI * 2;
    // (the pirate ship is 19 m long: it weaves further ahead)
    if (variant === 'rival') this.bz = AHEAD_Z - 10;

    // the police boat: the blue and white speedboat, a light bar on it
    this.police.add(hullObject('boat-speed-g', 7, () => P.box(2.4, 1.2, 7, 0x3c63b8, 0, 0.6, 0)));
    for (const [x, c] of [[-0.35, 0xff3b30], [0.35, 0x3f7bff]] as Array<[number, number]>) {
      const l = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.2, 0.25), new THREE.MeshBasicMaterial({ color: c }));
      l.position.set(x, 2.3, -0.4);
      l.userData.lit = c;
      this.lamps.push(l);
      this.police.add(l);
    }
    set.addRig(wearHat(person((seed + 1) % 12, 1.5), 'police'), 0, 0.7, 0.8, Math.PI, this.police).play('idle');
    // (heading away from the camera, -z)
    this.police.rotation.y = Math.PI;
    set.scene.add(this.police);

    // the offender: a racing speedboat, or the pirate ship
    if (variant === 'rival') {
      const ship = pkModel('ship-pirate-large', 1.5, Math.PI);
      this.bad.add(ship);
      const flag = pkModel('flag-pirate', 1.4, Math.PI);
      flag.position.set(0, 14, 0);
      this.bad.add(flag);
      for (let k = 0; k < 2; k++) this.crew.push(set.addRig(wearHat(person((seed + 3 + k * 4) % 12, 1.6), 'pirate'), (k - 0.5) * 2, 1.8, 3, 0, this.bad));
    } else {
      const hull = hullObject(seed % 2 ? 'boat-speed-h' : 'boat-speed-b', 6, () => P.box(2.2, 1.1, 6, 0xd8503a, 0, 0.55, 0));
      hull.rotation.y = Math.PI;
      this.bad.add(hull);
      this.crew.push(set.addRig(person((seed + 6) % 12, 1.4), 0, 0.6, 0.6, Math.PI, this.bad));
    }
    for (const c of this.crew) c.play('idle');
    set.scene.add(this.bad);
    this.icon = marker(variant === 'rival' ? '🏴' : '🚤', 1.6);
    set.scene.add(this.icon);
    this.place(0);
  }

  /** where the offender weaves to at time t */
  private weave(t: number): number {
    return this.amp * Math.sin(this.w * t + this.phase) + 1.2 * Math.sin(this.w * 2.3 * t);
  }

  aim(): number {
    return Math.max(-1, Math.min(1, (this.stopT >= 0 ? this.bx : this.weave(this.t + 0.35)) / RANGE));
  }

  private place(elapsed: number): void {
    const s = this.set;
    this.police.position.set(this.px, s.sea(this.px, POLICE_Z) * 0.8, POLICE_Z);
    this.police.rotation.z = Math.sin(elapsed * 1.4) * 0.03;
    this.bad.position.set(this.bx, s.sea(this.bx, this.bz) * 0.8, this.bz);
  }

  update(dt: number, elapsed: number, inp: ActivityInput): ActivityState {
    this.set.night = inp.night ?? 0;
    this.t += dt;
    const steer = Math.max(-1, Math.min(1, inp.steer));
    // the police boat: the wheel steers it across
    const want = steer * RANGE;
    this.px += Math.max(-SIDE_SPEED * dt, Math.min(SIDE_SPEED * dt, (want - this.px) * 3 * dt));
    if (this.stopT < 0) {
      // the offender weaves; in its wake the bar fills (it never drains)
      const nx = this.weave(this.t);
      this.bad.rotation.y = -Math.atan2(nx - this.bx, 8 * dt) * 0.25;
      this.bx = nx;
      if (Math.abs(this.px - this.bx) < WAKE) this.held += dt;
      if (this.held >= NEED) {
        this.stopT = 0;
        this.cues.push('surrender');
        for (const c of this.crew) c.play('emote-no');
      }
    } else {
      // it gives up: slows, lines up ahead of the police boat and stops
      this.stopT += dt;
      this.bz += (POLICE_Z - (this.variant === 'rival' ? 22 : 11) - this.bz) * Math.min(1, dt * 1.2);
      this.bad.rotation.y *= 1 - Math.min(1, dt * 2);
    }
    this.place(elapsed);
    // the light bar flashes
    const beat = Math.floor(elapsed * 5) % 2;
    this.lamps.forEach((l, k) => (l.material as THREE.MeshBasicMaterial).color.setHex(k === beat ? l.userData.lit : 0x202634));
    // foam streaming past: the chase is at speed (slower once it stops)
    const speed = this.stopT < 0 ? 12 : Math.max(0, 12 - this.stopT * 10);
    this.foamT -= dt * speed / 12;
    if (this.foamT <= 0) {
      this.foamT = 0.08;
      for (const x of [this.bx - 1, this.bx + 1, (this.set.r() - 0.5) * 30]) {
        const m = new THREE.Mesh(new THREE.CircleGeometry(0.35 + this.set.r() * 0.4, 8), new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.8, depthWrite: false }));
        m.rotation.x = -Math.PI / 2;
        m.position.set(x, 0.3, this.bz + 3);
        this.scene.add(m);
        this.foam.push({ m, t: 0 });
      }
    }
    for (let k = this.foam.length - 1; k >= 0; k--) {
      const f = this.foam[k];
      f.t += dt;
      f.m.position.z += speed * dt;
      (f.m.material as THREE.MeshBasicMaterial).opacity = Math.max(0, 0.8 - f.t * 0.4);
      if (f.t > 2) { this.scene.remove(f.m); f.m.geometry.dispose(); (f.m.material as THREE.Material).dispose(); this.foam.splice(k, 1); }
    }
    this.icon.visible = this.stopT < 0;
    this.icon.position.set(this.bx, (this.variant === 'rival' ? 18 : 3.6) + Math.sin(elapsed * 3) * 0.2, this.bz);
    this.set.shot({ x: this.px * 0.6, y: 5.5, z: POLICE_Z + 11 }, { x: this.bx * 0.5, y: 1.2, z: this.bz });
    this.set.update(dt);
    const progress = this.stopT < 0 ? 0.9 * (this.held / NEED) : Math.min(1, 0.9 + this.stopT / 15);
    const done = this.stopT >= 1.5;
    return { progress: done ? 1 : progress, prompt: this.stopT < 0 ? tr('scene.pullover.follow') : tr('scene.pullover.stop'), done };
  }

  celebrate(): void {
    if (this.won) return;
    this.won = true;
    this.set.sparkles.burst(new THREE.Vector3(this.bx, 3, this.bz), 'star', 14, 0.6);
    this.set.particles.burstConfetti(new THREE.Vector3(this.px, 3, POLICE_Z));
    this.set.pushIn({ x: this.bx * 0.5, y: 4.5, z: POLICE_Z + 4 });
    this.cues.push('cheer');
  }

  dispose(): void {
    for (const f of this.foam) { f.m.geometry.dispose(); (f.m.material as THREE.Material).dispose(); }
    this.set.dispose();
  }
}
