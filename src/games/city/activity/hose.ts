// Fire (G4): the fire truck has pulled up at a burning house, car or tree —
// the very one burning at the call in the city (its `look`). A firefighter
// on the pavement holds the hose; the wheel sweeps the jet left and right,
// and its height finds the flame nearest the aim by itself. Flames flare up
// one or two at a time — in the windows, on the roof, under the bonnet, in
// the branches — and grow while nobody sprays them; the water makes each
// jump, hiss, steam and die down. The last one is a big one. An ignored
// flame only keeps burning: nothing is ever lost.
import * as THREE from 'three';
import { rng, type Rng } from '../../../engine/rng.js';
import { t as tr } from '../../../i18n/index.js';
import { StreetSet, kit, kitSize } from './set.js';
import { LadderTruck, firefighter } from './ladderTruck.js';
import { WaterJet } from '../fx/water.js';
import type { Fire } from '../fx/fire.js';
import type { SmokeEmitter } from '../fx/smoke.js';
import { ease, pickOf, type Activity, type ActivityInput, type ActivityState, type CallLook, type SceneCue, type SceneLoop } from './common.js';

export type FireVariant = 'house' | 'tree' | 'car';

const ROAD_Z = 8;
const FRONT_Z = ROAD_Z - 10.6;    // the lot's front, behind the pavement
const HIT_X = 1.1;                // generous: little hands sweep, they don't aim
const CAM = { x: -0.8, y: 4.6, z: ROAD_Z + 4.2 };
const DOUSE = 1.0;                // seconds of water per flame
const HOUSES = [...'abcdefghijklmnopqrstu'].map(c => 'house-' + c);
const TREES = ['tree-oak', 'tree-default', 'tree-detailed', 'tree-fat'];
const CARS = ['car-sedan', 'car-suv', 'car-taxi', 'car-hatch'];

interface Spot { p: THREE.Vector3; used: boolean; size: number }
interface Flame { spot: Spot; fire: Fire; health: number; age: number; hitT: number; big: boolean }

export class HoseActivity implements Activity {
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  pumping = true;
  cues: SceneCue[] = [];
  loops = new Set<SceneLoop>(['pump', 'crackle']);
  private set: StreetSet;
  private r: Rng;
  private spots: Spot[] = [];
  private flames: Flame[] = [];
  private total: number;
  private doused = 0;
  private popT = 0.4;
  private aimX = 0;
  private aimY = 2;
  private aimZ = FRONT_Z;
  private range = 4;
  private jet: WaterJet;
  private nozzle = new THREE.Vector3();
  private crew: ReturnType<typeof firefighter>;
  private column: SmokeEmitter;
  private won = false;

  constructor(seed: number, readonly variant: FireVariant, look?: CallLook) {
    const r = this.r = rng(seed);
    // (the house's name and size first: the neighbours stand either side of it)
    const hname = look?.kind === 'building' && look.model ? look.model : pickOf(r, HOUSES);
    const hsz = kitSize(hname) ?? new THREE.Vector3(9, 7, 9);
    const hw = variant === 'house' ? Math.max(5.5, hsz.x / 2 + 1.2) : 8;
    const set = this.set = new StreetSet({
      seed, roadZ: ROAD_Z, keep: [-hw, hw], district: look?.district ?? (variant === 'car' ? 'urban' : 'residential'),
      onlookers: 4, crowdX: hw + 3,
    });
    this.scene = set.scene;
    this.camera = set.camera;

    // the burning thing, at its true size, and the spots its flames may take
    let top = 6, subjZ = FRONT_Z - 3;
    if (variant === 'house') {
      const sz = hsz;
      const m = kit(hname, 0, 0.1, FRONT_Z - sz.z / 2);
      if (m) { m.castShadow = true; m.receiveShadow = true; set.scene.add(m); }
      top = sz.y;
      subjZ = FRONT_Z - sz.z / 2;
      this.surfaceSpots(m, -sz.x / 2 + 0.8, sz.x / 2 - 0.8, 0.9, sz.y - 0.6, 18, FRONT_Z);
      this.total = 8;
    } else if (variant === 'tree') {
      const name = look?.kind === 'tree' && look.model ? look.model : pickOf(r, TREES);
      const s = 8.5;
      const sz = kitSize(name, s) ?? new THREE.Vector3(6, 9, 6);
      const m = kit(name, 0, 0.1, FRONT_Z - 3, r() * 6, s);
      if (m) { m.castShadow = true; set.scene.add(m); }
      top = sz.y;
      this.surfaceSpots(m, -sz.x / 2, sz.x / 2, sz.y * 0.35, sz.y * 0.95, 16, FRONT_Z - 3);
      this.total = 7;
    } else {
      const name = look?.kind === 'car' && look.model ? look.model : pickOf(r, CARS);
      const sz1 = kitSize(name, 1) ?? new THREE.Vector3(1, 1, 2);
      const s = 4.6 / Math.max(sz1.x, sz1.z);
      // parked at the kerb on the stage's side, side-on to the camera
      const m = kit(name, 0.5, 0.17, ROAD_Z - 4.6, Math.PI / 2, s);
      if (m) { m.castShadow = true; set.scene.add(m); }
      top = sz1.y * s;
      subjZ = ROAD_Z - 4.6;
      this.surfaceSpots(m, -1.8, 2.8, 0.4, sz1.y * s + 0.1, 14, ROAD_Z - 4.6);
      this.total = 6;
    }
    this.range = Math.max(2.5, ...this.spots.map(s => Math.abs(s.p.x))) + 0.6;

    // the truck parked up the road, side on; the firefighter on the pavement
    const truck = new LadderTruck({ ladder: false });
    truck.root.position.set(-7.4, 0, ROAD_Z - 2.4);
    truck.root.rotation.y = -Math.PI / 2;
    set.scene.add(truck.root);
    this.crew = set.addRig(firefighter(2), -2.2, 0.17, ROAD_Z - 7.4, Math.PI) as ReturnType<typeof firefighter>;
    this.crew.play('holding-both', { speed: 0.6 });
    set.addRig(firefighter(7), -5.6, 0.17, ROAD_Z - 8.4, Math.PI * 0.8).play('idle');
    // the hose line from the truck's pump to the firefighter
    const hose = new THREE.CatmullRomCurve3([
      new THREE.Vector3(-5.2, 0.9, ROAD_Z - 3.9), new THREE.Vector3(-4.8, 0.12, ROAD_Z - 5.2), new THREE.Vector3(-4.2, 0.12, ROAD_Z - 7.6),
      new THREE.Vector3(-3, 0.14, ROAD_Z - 7), new THREE.Vector3(-2.2, 0.8, ROAD_Z - 7.6),
    ]);
    set.scene.add(new THREE.Mesh(new THREE.TubeGeometry(hose, 40, 0.07, 6), new THREE.MeshLambertMaterial({ color: 0xd9c6a0 })));
    this.nozzle.set(-2.2, 1.15, ROAD_Z - 8.1);

    this.jet = new WaterJet(set.scene, set.smoke, 0.24);
    this.column = set.smoke.add({ x: 0, y: top * 0.8, z: subjZ, rate: 3.5, size0: 1.4, size1: 5, rise: 2.4, life: 5, jitter: 2, dark: 0.75 });
    set.shot(CAM, { x: 0.2, y: Math.min(3.6, top * 0.42), z: Math.max(subjZ, FRONT_Z - 1) });
    for (let k = 0; k < (variant === 'house' ? 3 : 2); k++) this.popFlame(false);
  }

  /** spots on the side the camera sees: cast from the camera across a grid
   * over the thing and keep where the rays meet it, a little in front */
  private surfaceSpots(m: THREE.Object3D | null, x0: number, x1: number, y0: number, y1: number, want: number, depth: number): void {
    const cam = new THREE.Vector3(CAM.x, CAM.y, CAM.z);
    const ray = new THREE.Raycaster();
    const pts: THREE.Vector3[] = [];
    if (m) {
      m.updateMatrixWorld(true);
      for (let i = 0; i < 7; i++) for (let j = 0; j < 5; j++) {
        const aim = new THREE.Vector3(x0 + (i + 0.5) / 7 * (x1 - x0), y0 + (j + 0.5) / 5 * (y1 - y0), depth);
        ray.set(cam, aim.sub(cam).normalize());
        const hit = ray.intersectObject(m, true)[0];
        if (hit) pts.push(hit.point.addScaledVector(ray.ray.direction, -0.45));
      }
    }
    // (no model, a node tool: a plain wall of spots)
    if (pts.length < 6) for (let i = 0; i < 6; i++) pts.push(new THREE.Vector3(x0 + (i % 3 + 0.5) / 3 * (x1 - x0), y0 + ((i / 3) | 0) * (y1 - y0) / 2, depth + 0.3));
    // spread them out: never two within 1.6 m
    for (const p of pts.sort(() => this.r() - 0.5)) {
      if (this.spots.length >= want) break;
      if (this.spots.every(s => s.p.distanceTo(p) > 1.6)) this.spots.push({ p, used: false, size: 1.15 + this.r() * 0.4 });
    }
  }

  private popFlame(cue = true): void {
    const left = this.total - this.doused - this.flames.length;
    if (left <= 0) return;
    const free = this.spots.filter(s => !s.used);
    if (!free.length) return;
    const big = left === 1 && this.flames.length === 0;
    // the last one: the biggest, highest spot
    const spot = big ? free.reduce((a, b) => (b.p.y > a.p.y ? b : a)) : pickOf(this.r, free);
    spot.used = true;
    const fire = this.set.fires.add({ x: spot.p.x, y: spot.p.y - 0.3, z: spot.p.z, size: big ? 2.2 : spot.size, tongues: big ? 8 : 6, seed: this.flames.length + this.doused * 3 });
    fire.strength = 0.05;
    this.flames.push({ spot, fire, health: 1, age: 0, hitT: 0, big });
    if (cue) this.cues.push(big ? 'last' : 'pop');
  }

  aim(): number {
    if (!this.flames.length) return 0;
    const f = this.flames.reduce((a, b) => (Math.abs(b.spot.p.x - this.aimX) < Math.abs(a.spot.p.x - this.aimX) ? b : a));
    return Math.max(-1, Math.min(1, f.spot.p.x / this.range));
  }

  update(dt: number, _elapsed: number, inp: ActivityInput): ActivityState {
    this.set.night = inp.night ?? 0;
    this.aimX = ease(this.aimX, inp.steer * this.range, 4, dt);
    // the jet's height and depth find the flame nearest the aim
    let near: Flame | null = null;
    for (const f of this.flames) if (!near || Math.abs(f.spot.p.x - this.aimX) < Math.abs(near.spot.p.x - this.aimX)) near = f;
    if (near && Math.abs(near.spot.p.x - this.aimX) < 3) {
      this.aimY = ease(this.aimY, near.spot.p.y, 5, dt);
      this.aimZ = ease(this.aimZ, near.spot.p.z, 5, dt);
    }
    const hit = near && Math.abs(near.spot.p.x - this.aimX) < HIT_X ? near : null;
    for (const f of this.flames) {
      f.age += dt;
      // a flame grows while nobody sprays it (up to a cap), shrinks under the water
      const grow = Math.min(1.25, 0.75 + f.age * 0.05);
      if (f === hit) {
        if (f.hitT === 0) { f.fire.flare(); this.cues.push('hit'); }
        f.hitT += dt;
        f.health = Math.max(0, f.health - dt / (DOUSE * (f.big ? 1.6 : 1)));
        if (Math.random() < dt * 9) this.set.smoke.puff(f.spot.p.x, f.spot.p.y + 0.5, f.spot.p.z + 0.2, 1, 0, 1.1);
      } else f.hitT = 0;
      f.fire.target = f.health > 0 ? Math.max(0.25, f.health) * grow : 0;
    }
    // out: steam, a sparkle, a cheer from the crowd, and the next one flares
    for (const f of this.flames.filter(q => q.health <= 0)) {
      this.flames.splice(this.flames.indexOf(f), 1);
      this.set.fires.remove(f.fire);
      // (its spot may burn again later: a small house has fewer spots than flames)
      f.spot.used = false;
      this.doused++;
      this.cues.push('out');
      this.set.smoke.puff(f.spot.p.x, f.spot.p.y + 0.3, f.spot.p.z, 1.6, 0.1, 1.6);
      this.set.sparkles.burst(f.spot.p.clone().add(new THREE.Vector3(0, 0.6, 0.4)), 'twinkle', 8, 0.4);
      this.popT = 0.7 + this.r() * 0.6;
    }
    this.popT -= dt;
    const left = this.total - this.doused;
    const wantActive = Math.min(left, left > 3 ? 2 : 1);
    if (this.popT <= 0 && this.flames.length < wantActive) { this.popFlame(); this.popT = 1.2; }
    const progress = this.doused / this.total;
    // the jet: out while there's fire, landing where the aim meets it
    this.jet.on = progress < 1;
    this.jet.aim(this.nozzle, new THREE.Vector3(this.aimX, this.aimY, this.aimZ));
    this.jet.update(dt, this.camera);
    this.crew.root.rotation.y = Math.atan2(this.aimX - this.crew.root.position.x, this.aimZ - this.crew.root.position.z);
    this.column.strength = 1 - progress;
    // the fire lights the street at night
    const lit = this.flames.reduce((s, f) => s + f.fire.light, 0);
    this.set.fireLight.intensity = Math.min(1, lit / 2) * (this.set.night * 40 + 4);
    if (this.flames.length) this.set.fireLight.position.set(this.flames[0].spot.p.x, this.flames[0].spot.p.y + 1, this.flames[0].spot.p.z + 2);
    if (progress >= 1) { this.pumping = false; this.loops.delete('pump'); this.loops.delete('crackle'); }
    this.set.update(dt);
    return { progress, prompt: this.flames.some(f => f.big) ? tr('scene.sprayLast') : tr('scene.spray'), done: progress >= 1 };
  }

  celebrate(): void {
    if (this.won) return;
    this.won = true;
    this.pumping = false;
    this.set.cheer(3);
    this.crew.play('emote-yes');
    this.set.sparkles.burst(new THREE.Vector3(0, 4, FRONT_Z + 1), 'star', 16, 0.7, 4);
    this.set.particles.burstConfetti(new THREE.Vector3(0, 2, FRONT_Z + 3));
    this.set.pushIn({ x: -0.5, y: 4.2, z: ROAD_Z + 5 });
    this.cues.push('cheer');
  }

  dispose(): void {
    this.jet.dispose();
    this.set.dispose();
  }
}
