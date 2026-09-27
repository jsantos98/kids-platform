// Medical helicopter (G4): the winch. Someone needs lifting out — a hiker
// in a park, a person on a flat roof, a swimmer on a float out at sea. The
// helicopter hovers over them in a gusty wind (the trees sway, the rotor's
// downwash kicks up dust or spray); the wheel holds it steady against the
// gusts. While it's over them a medic rides the line down, clips them on,
// and the two are winched up together into the cabin. Drifting off only
// pauses the winch until it's back over them: nothing is ever lost.
import * as THREE from 'three';
import { rng } from '../../../engine/rng.js';
import { t as tr } from '../../../i18n/index.js';
import { person, type Rig } from '../../../engine/rig.js';
import { C, PRIMS as P } from '../../../engine/stage.js';
import { makeHelicopter } from '../../../kit/index.js';
import { StreetSet, kit, kitSize, marker } from './set.js';
import { wearHat } from './hats.js';
import { ease, pickOf, type Activity, type ActivityInput, type ActivityState, type CallLook, type SceneCue, type SceneLoop } from './common.js';

export type WinchVariant = 'meadow' | 'roof' | 'sea';

const ROAD_Z = 8;
const FRONT_Z = ROAD_Z - 10.6;
const OVER = 1.1;            // the hook within this of them counts
const LIFT = 4.2;            // seconds of winching, down and up
const HOVER = 10.5;          // over the ground (or the roof)
const TREES = ['tree-default', 'tree-oak', 'tree-detailed', 'tree-fat', 'tree-small'];
const SHOPS = [...'abcdefghijklmn'].map(c => 'bldg-' + c);

export class WinchActivity implements Activity {
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  cues: SceneCue[] = [];
  loops = new Set<SceneLoop>(['rotor']);
  private set: StreetSet;
  private heli: THREE.Group;
  private line: THREE.Mesh;
  private hook: THREE.Mesh;
  private medic: Rig;
  private who: Rig;
  private icon = marker('🆘', 1.5);
  private float: THREE.Object3D | null = null;
  private trees: THREE.Object3D[] = [];
  private x = 0;
  private baseX: number;
  private px: number;
  private pz: number;
  private groundY = 0;
  private windA: number;
  private windF: number;
  /** the wind's steady push one way: left alone, the helicopter hangs off to that side */
  private windBias: number;
  private wind = 0;
  private t = 0;
  private washT = 0;
  private aboard = false;
  private won = false;
  readonly variant: WinchVariant;

  constructor(seed: number, look?: CallLook, variant?: WinchVariant) {
    const r = rng(seed);
    this.variant = variant ?? (['meadow', 'roof', 'sea'] as const)[seed % 3];
    const v = this.variant;
    const set = this.set = new StreetSet({
      seed, roadZ: ROAD_Z, keep: v === 'roof' ? [-8, 8] : [-14, 14], sea: v === 'sea',
      district: v === 'meadow' ? 'park' : v === 'roof' ? 'downtown' : (look?.district ?? 'residential'),
      onlookers: 3, crowdX: 11, parked: 1, bothSides: false,
    });
    this.scene = set.scene;
    this.camera = set.camera;
    this.baseX = (r() - 0.5) * 4;
    this.px = this.baseX;
    this.windA = 1.4 + r() * 1.1;
    this.windF = 0.45 + r() * 0.25;
    this.windBias = (r() < 0.5 ? -1 : 1) * (2.2 + r() * 0.8);

    if (v === 'meadow') {
      this.pz = FRONT_Z - 7;
      for (let k = 0; k < 7; k++) {
        const x = -16 + k * 5.3 + (r() - 0.5) * 2, z = FRONT_Z - 3 - r() * 14;
        if (Math.abs(x - this.px) < 3.5 && Math.abs(z - this.pz) < 4) continue;
        const t = kit(pickOf(r, TREES), x, 0.1, z, r() * 6, 5 + r() * 2.5);
        if (t) { t.castShadow = true; set.scene.add(t); this.trees.push(t); }
      }
      // a picnic blanket and a backpack by the hiker
      set.scene.add(P.box(1.8, 0.04, 1.4, 0xe25c5c, this.px - 1.6, 0.14, this.pz + 0.6));
      set.scene.add(P.rbox(0.45, 0.6, 0.3, 0.08, 0x5a92c4, this.px + 1, 0.45, this.pz + 0.4));
    } else if (v === 'roof') {
      const name = look?.kind === 'building' && look.model ? look.model : pickOf(r, SHOPS);
      const sz = kitSize(name) ?? new THREE.Vector3(12, 12, 10);
      const m = kit(name, 0, 0.1, FRONT_Z - sz.z / 2);
      if (m) { m.castShadow = true; m.receiveShadow = true; set.scene.add(m); }
      this.groundY = sz.y + 0.1;
      this.pz = FRONT_Z - sz.z / 2;
      this.px = this.baseX = Math.max(-sz.x / 2 + 2, Math.min(sz.x / 2 - 2, this.baseX));
      // a roof deck with a painted H to stand on
      set.scene.add(P.box(Math.min(sz.x - 0.6, 7), 0.25, Math.min(sz.z - 0.6, 6), 0x8b93a3, this.px, this.groundY + 0.05, this.pz));
      set.scene.add(P.torus(1.5, 0.12, 0xf6c952, this.px, this.groundY + 0.2, this.pz, Math.PI / 2, 0, 0));
    } else {
      this.pz = FRONT_Z - 11;
      // an orange float ring round the swimmer
      this.float = P.torus(0.7, 0.2, 0xf2804c, 0, 0.12, 0, Math.PI / 2, 0, 0);
      set.scene.add(this.float);
    }

    this.who = set.addRig(person(seed % 12, 1.7), this.px, this.groundY + 0.17, this.pz, 0);
    this.who.play(v === 'sea' ? 'idle' : 'interact-right', { speed: 1.3 });
    set.scene.add(this.icon);
    // the medical helicopter, side on, nose right
    this.heli = makeHelicopter({ body: C.white, band: C.red });
    this.heli.scale.setScalar(1.5);
    this.heli.rotation.y = Math.PI / 2;
    set.scene.add(this.heli);
    this.x = this.px - 5;
    this.line = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, 1, 6), new THREE.MeshLambertMaterial({ color: 0x3c424c }));
    this.hook = new THREE.Mesh(new THREE.TorusGeometry(0.2, 0.06, 6, 12, Math.PI * 1.5), new THREE.MeshLambertMaterial({ color: C.red }));
    set.scene.add(this.line, this.hook);
    this.medic = set.addRig(wearHat(person(3, 1.7), 'medic'), 0, 0, 0);
    this.medic.play('holding-both');
    const hy = this.groundY + HOVER;
    set.shot({ x: 0, y: this.groundY * 0.55 + 5, z: ROAD_Z + 9.5 }, { x: 0, y: hy - 4.5, z: this.pz + 2 });
  }

  private get heliY(): number { return this.groundY + HOVER; }

  aim(): number {
    // hold against the wind, and home in on them
    return Math.max(-1, Math.min(1, -this.wind / 4 + (this.px - this.x) * 0.35));
  }

  update(dt: number, elapsed: number, inp: ActivityInput): ActivityState {
    this.set.night = inp.night ?? 0;
    // the swimmer drifts slowly on the swell
    if (this.variant === 'sea') this.px = this.baseX + Math.sin(elapsed * 0.25) * 1.6;
    // gusts push, the wheel pushes back
    this.wind = this.windBias + Math.sin(elapsed * this.windF) * this.windA * 0.6 + Math.sin(elapsed * this.windF * 2.7 + 1) * 0.4;
    const want = this.px + this.wind + Math.max(-1, Math.min(1, inp.steer)) * 4;
    this.x = ease(this.x, want, 2, dt);
    const bob = Math.sin(elapsed * 1.3) * 0.2;
    this.heli.position.set(this.x, this.heliY + bob, this.pz);
    this.heli.rotation.z = 0;
    this.heli.rotation.x = (want - this.x) * 0.05;
    (this.heli.userData.mainRotor as THREE.Object3D).rotation.y = elapsed * 24;
    (this.heli.userData.tailRotor as THREE.Object3D).rotation.x = elapsed * 30;
    for (const t of this.trees) t.rotation.z = this.wind * 0.025 + Math.sin(elapsed * 3 + t.position.x) * 0.01;
    const over = Math.abs(this.x - this.px) < OVER;
    if (over && this.t < 1) this.t = Math.min(1, this.t + dt / LIFT);
    // the medic rides the line down (t < 0.5), clips on, and up they come
    const low = this.t < 0.5 ? this.t * 2 : 1 - (this.t - 0.5) * 2;
    const topY = this.heliY + bob + 0.5;
    const footY = topY - 1.9 - low * (topY - 1.9 - (this.groundY + 0.25));
    const hx = this.x - 0.2;
    if (this.t >= 0.5 && !this.aboard) {
      this.aboard = true;
      this.who.play('holding-both');
      this.cues.push('aboard');
      this.set.sparkles.burst(new THREE.Vector3(this.px, this.groundY + 2, this.pz), 'heart', 8, 0.5);
    }
    const len = topY - (footY + 1.75);
    this.line.scale.y = Math.max(0.05, len);
    this.line.position.set(hx, footY + 1.75 + len / 2, this.pz + 0.9);
    this.hook.position.set(hx, footY + 1.75, this.pz + 0.9);
    this.medic.root.position.set(hx, footY, this.pz + 0.9);
    this.medic.root.rotation.y = 0;
    if (this.aboard) {
      this.who.root.position.set(hx + 0.55, footY - 0.1, this.pz + 0.7);
      this.who.root.rotation.y = -0.4;
      if (this.float) this.float.visible = false;
    } else {
      this.who.root.position.set(this.px, this.variant === 'sea' ? -0.9 + Math.sin(elapsed * 1.1) * 0.08 : this.groundY + 0.17, this.pz);
      this.who.root.rotation.y = Math.atan2(this.x - this.px, 6) * 0.5;
      if (this.float) this.float.position.set(this.px, 0.12 + Math.sin(elapsed * 1.1) * 0.08, this.pz);
    }
    if (this.t >= 1) { this.medic.root.visible = false; this.who.root.visible = false; this.line.visible = false; }
    // the downwash: dust (or spray) round the spot under the rotor
    this.washT -= dt;
    if (this.washT <= 0) {
      this.washT = 0.12;
      const a = Math.random() * Math.PI * 2, rr = 2 + Math.random() * 2;
      this.set.smoke.puff(this.x + Math.cos(a) * rr, this.groundY + 0.3, this.pz + Math.sin(a) * rr, 1.1, this.variant === 'sea' ? 0 : 0.25, 1);
    }
    this.icon.visible = !this.aboard;
    this.icon.position.set(this.px, this.groundY + 3 + Math.sin(elapsed * 3) * 0.2, this.pz);
    this.loops.delete('winch');
    if (over && this.t > 0 && this.t < 1) this.loops.add('winch');
    this.set.update(dt);
    const prompt = this.t >= 0.5 ? tr('scene.winchLift') : over ? tr('scene.winchLower') : tr('scene.winchOver');
    return { progress: this.t, prompt, done: this.t >= 1 };
  }

  celebrate(): void {
    if (this.won) return;
    this.won = true;
    this.set.cheer(3);
    this.set.sparkles.burst(this.heli.position.clone(), 'star', 14, 0.6, 3.5);
    this.set.particles.burstConfetti(this.heli.position.clone().add(new THREE.Vector3(0, -2, 0)));
    this.cues.push('cheer');
  }

  dispose(): void {
    this.set.dispose();
  }
}
