// The bins (G17, G4): three to five full wheelie bins wait on the pavement
// and the garbage truck stands in the kerb lane beside them, its side
// grabber on the flank toward them. The wheel drives the truck along the
// kerb (the camera looks across the street from behind the pavement:
// right on the wheel is right on screen); slowing or stopping with the
// grabber at a bin, it reaches out, grips it, lifts it up over the truck
// and tips it — bags, bottles and cans tumble in — shakes it, and sets it
// back down empty, then lets the truck go on. Near a full bin the truck
// crawls, so a small child sweeping the wheel to and fro catches the bins it
// passes; nobody at the wheel empties none (no bin stands where it starts).
import * as THREE from 'three';
import { rng, type Rng } from '../../../engine/rng.js';
import { t as tr } from '../../../i18n/index.js';
import { PRIMS as P } from '../../../engine/stage.js';
import { spawnVehicle } from '../../../engine/assets.js';
import { person } from '../../../engine/rig.js';
import { StreetSet, marker } from './set.js';
import { wearHat } from './hats.js';
import { wheelieBin } from '../missions.js';
import type { Activity, ActivityInput, ActivityState, CallLook, SceneCue, SceneLoop } from './common.js';

const ROAD_Z = 8;
/** the truck's lane (heading +x, its right flank toward the pavement) */
const LANE_Z = ROAD_Z + 3.5;
const SIDE_Z = LANE_Z + 1.15;
/** the bins' spot on the pavement */
const BIN_Z = ROAD_Z + 8.3;
const RANGE = 9;
const TOP_SPEED = 7, CRAWL = 3.2;
/** within this of a bin, slow enough, the grabber takes it */
const GRAB_R = 1.1, GRAB_V = 3.6;
const COLORS = [0x3f9a4a, 0x2c6fb8, 0xf2c230, 0x3f9a4a, 0x8a93a0];
const TRASH = [0x3a3f48, 0x3f9a4a, 0xc9ced8, 0xd8503a, 0xf2c230, 0x5a3a2a];

type Grab = 'reach' | 'lift' | 'tip' | 'down' | 'back';
const STEP_T: Record<Grab, number> = { reach: 0.45, lift: 0.6, tip: 0.7, down: 0.55, back: 0.3 };

interface Bin { x: number; g: THREE.Group; lid: THREE.Object3D; done: boolean }
interface Bit { m: THREE.Mesh; vx: number; vy: number; vz: number }

export class BinsActivity implements Activity {
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  cues: SceneCue[] = [];
  loops = new Set<SceneLoop>();
  private set: StreetSet;
  private r: Rng;
  private truck = new THREE.Group();
  private boom: THREE.Mesh;
  private claw = new THREE.Group();
  private bins: Bin[] = [];
  private bits: Bit[] = [];
  private x = 0;
  private v = 0;
  private grab: { bin: Bin; step: Grab; t: number } | null = null;
  private progress = 0;
  private won = false;
  private icon = marker('🗑️', 1.2);

  constructor(seed: number, look?: CallLook) {
    const r = this.r = rng(seed * 17 + 3);
    const set = this.set = new StreetSet({ seed, roadZ: ROAD_Z, keep: [-12, 12], district: look?.district ?? 'residential', onlookers: 0, parked: 0 });
    this.scene = set.scene;
    this.camera = set.camera;

    // the garbage truck, heading +x (the Car Kit models face +z)
    const body = new THREE.Group();
    body.rotation.y = Math.PI / 2;
    const stand = new THREE.Group();
    stand.add(P.box(2.2, 2.6, 6.2, 0x3f9a4a, 0, 1.6, -0.4));
    stand.add(P.box(2.2, 1.8, 1.6, 0xf2f0ea, 0, 1.3, 2.4));
    body.add(stand);
    spawnVehicle('/assets/kenney/garbage-truck.glb', { len: 6.5 }).then(g => {
      g.userData.shared = true;
      body.remove(stand);
      body.add(g);
    }).catch(() => {});
    this.truck.add(body);
    // the side grabber: a mast on the flank, a boom that runs out, a claw
    const mast = P.box(0.35, 1.8, 0.3, 0x4b505c, 0, 1.3, SIDE_Z - LANE_Z);
    this.boom = P.box(0.22, 0.22, 1, 0xf2c230, 0, 1.1, 0);
    this.claw.add(P.box(1.0, 0.5, 0.12, 0x4b505c, 0, 0, 0));
    for (const x of [-0.5, 0.5]) this.claw.add(P.box(0.1, 0.5, 0.5, 0x4b505c, x, 0, 0.25));
    this.truck.add(mast, this.boom, this.claw);
    this.truck.position.set(0, 0, LANE_Z);
    set.scene.add(this.truck);

    // the bins along the kerb — never where the truck starts
    const n = 3 + (seed % 3);
    const slots = n === 3 ? [-6.5, 3.5, 7.5] : n === 4 ? [-7.5, -3.8, 3.8, 7.5] : [-8, -4.6, 3.2, 5.8, 8.4];
    for (let k = 0; k < n; k++) {
      const x = slots[k] + (r() - 0.5) * 0.6;
      const g = wheelieBin(COLORS[(k + seed) % COLORS.length]);
      g.position.set(x, 0.17, BIN_Z);
      g.rotation.y = Math.PI;
      set.scene.add(g);
      this.bins.push({ x, g, lid: g.children[1], done: false });
    }
    // a bag or two beside them, and a neighbour at the gate
    for (let k = 0; k < 3; k++) {
      const bag = P.sphere(0.36, 0x3a3f48, (r() - 0.5) * 16, 0.45, BIN_Z + 0.9);
      bag.scale.set(1, 0.8, 1);
      set.scene.add(bag);
    }
    set.addRig(wearHat(person((seed + 4) % 12, 1.7), 'beanie'), -11, 0.17, BIN_Z + 1.4, Math.PI).play('interact-right', { speed: 1.2 });
    set.scene.add(this.icon);
    set.shot({ x: 0, y: 6.4, z: ROAD_Z + 20 }, { x: 0, y: 1.6, z: ROAD_Z + 5 });
  }

  /** the next bin to empty: the nearest full one */
  private next(): Bin | null {
    let best: Bin | null = null, bd = Infinity;
    for (const b of this.bins) if (!b.done && Math.abs(b.x - this.x) < bd) { bd = Math.abs(b.x - this.x); best = b; }
    return best;
  }

  aim(): number {
    const b = this.grab ? null : this.next();
    return b ? Math.max(-1, Math.min(1, b.x / RANGE)) : this.x / RANGE;
  }

  update(dt: number, elapsed: number, inp: ActivityInput): ActivityState {
    this.set.night = inp.night ?? 0;
    this.loops.clear();
    const steer = Math.max(-1, Math.min(1, inp.steer));
    const left = this.bins.filter(b => !b.done).length;
    if (!this.grab) {
      // the wheel drives the truck along the kerb; it crawls by a full bin
      const near = this.bins.some(b => !b.done && Math.abs(b.x - this.x) < 1.6);
      const want = steer * RANGE, top = near ? CRAWL : TOP_SPEED;
      const dv = Math.max(-top, Math.min(top, (want - this.x) * 2.2)) - this.v;
      this.v += Math.max(-12 * dt, Math.min(12 * dt, dv));
      this.x = Math.max(-RANGE, Math.min(RANGE, this.x + this.v * dt));
      const b = this.bins.find(k => !k.done && Math.abs(k.x - this.x) < GRAB_R);
      if (b && Math.abs(this.v) < GRAB_V) {
        this.grab = { bin: b, step: 'reach', t: 0 };
        this.v = 0;
      }
    } else {
      // the grabber at work: reach, lift, tip, set down, back
      const g = this.grab, b = g.bin;
      this.v = 0;
      this.x += (b.x - this.x) * Math.min(1, dt * 6);
      g.t += dt;
      const f = Math.min(1, g.t / STEP_T[g.step]);
      const e = f * f * (3 - 2 * f);
      this.loops.add('ladder');
      if (g.step === 'lift' || g.step === 'down') {
        const u = g.step === 'lift' ? e : 1 - e;
        b.g.position.set(b.x, 0.17 + u * 3.3, BIN_Z + (SIDE_Z + 0.2 - BIN_Z) * u);
        b.g.rotation.x = -u * 0.6;
      } else if (g.step === 'tip') {
        b.g.rotation.x = -0.6 - Math.sin(Math.min(1, f * 1.4) * Math.PI / 2) * 1.6 + Math.sin(g.t * 30) * 0.08 * (f < 0.8 ? 1 : 0);
        b.lid.rotation.x = -1.8 * Math.min(1, f * 3);
        if (f < 0.6 && this.r() < 0.6) this.spill(b);
      }
      if (f >= 1) {
        const order: Grab[] = ['reach', 'lift', 'tip', 'down', 'back'];
        if (g.step === 'lift') this.cues.push('tip');
        if (g.step === 'tip') b.lid.rotation.x = 0;
        if (g.step === 'down') {
          b.done = true;
          b.g.position.set(b.x, 0.17, BIN_Z);
          b.g.rotation.x = 0;
          this.cues.push('binSet');
          this.set.sparkles.burst(new THREE.Vector3(b.x, 1.8, BIN_Z), 'twinkle', 8, 0.4);
        }
        const k = order.indexOf(g.step);
        if (k === order.length - 1) this.grab = null;
        else { g.step = order[k + 1]; g.t = 0; }
      }
    }
    // the boom runs out to the bin while it's reaching or holding one
    const g = this.grab;
    const f = g ? Math.min(1, g.t / STEP_T[g.step]) : 0;
    const out = !g ? 0 : g.step === 'reach' ? f : g.step === 'back' ? 1 - f : g.step === 'lift' ? 1 - f : g.step === 'down' ? f : 0;
    const reach = (BIN_Z - 0.5 - SIDE_Z) * out;
    const hold = g ? g.bin.g.position : null;
    const cy = hold && (g!.step === 'lift' || g!.step === 'tip' || g!.step === 'down') ? hold.y + 0.8 : 1.1;
    this.boom.scale.z = Math.max(0.05, reach + 0.3);
    this.boom.position.set(0, cy, SIDE_Z - LANE_Z + (reach + 0.3) / 2);
    this.claw.position.set(0, cy, SIDE_Z - LANE_Z + reach + 0.3);
    this.truck.position.x = this.x;
    // the trash tumbling into the truck
    for (let k = this.bits.length - 1; k >= 0; k--) {
      const p = this.bits[k];
      p.vy -= 14 * dt;
      p.m.position.x += p.vx * dt; p.m.position.y += p.vy * dt; p.m.position.z += p.vz * dt;
      p.m.rotation.x += dt * 6; p.m.rotation.z += dt * 4;
      if (p.m.position.y < 2.4 && p.vy < 0) { this.scene.remove(p.m); p.m.geometry.dispose(); this.bits.splice(k, 1); }
    }
    const next = this.next();
    this.icon.visible = !!next && !this.grab;
    if (next) this.icon.position.set(next.x, 2.4 + Math.sin(elapsed * 3) * 0.15, BIN_Z);
    const n = this.bins.length || 1;
    const done = this.bins.filter(b => b.done).length;
    this.progress = Math.min(1, (done + (this.grab ? 0.5 : 0)) / n);
    this.set.update(dt);
    const over = left === 0 && !this.grab;
    const prompt = over ? tr('scene.bins.done') : this.grab ? tr('scene.bins.lift') : tr('scene.bins.grab', { n: left });
    return { progress: over ? 1 : this.progress, prompt, done: over };
  }

  /** a piece of trash out of the tipped bin, over into the truck */
  private spill(b: Bin): void {
    const c = TRASH[(this.r() * TRASH.length) | 0];
    const m = this.r() < 0.5 ? P.box(0.22, 0.3, 0.22, c) : P.cyl(0.08, 0.08, 0.3, 6, c);
    m.position.set(b.x + (this.r() - 0.5) * 0.5, b.g.position.y + 0.6, b.g.position.z - 0.4);
    this.scene.add(m);
    this.bits.push({ m, vx: (this.r() - 0.5) * 1.5, vy: 1.5 + this.r() * 2, vz: -1.5 - this.r() * 1.5 });
  }

  celebrate(): void {
    if (this.won) return;
    this.won = true;
    this.set.sparkles.burst(new THREE.Vector3(this.x, 3.5, LANE_Z), 'star', 14, 0.6);
    this.set.particles.burstConfetti(new THREE.Vector3(this.x, 3, BIN_Z));
    this.set.pushIn({ x: this.x * 0.5, y: 5, z: ROAD_Z + 15 });
    this.cues.push('cheer');
  }

  dispose(): void {
    for (const p of this.bits) p.m.geometry.dispose();
    this.set.dispose();
  }
}
