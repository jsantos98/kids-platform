// Caught! (G4, G7): the getaway car has pulled over and the robber jumps
// out and runs off across a little town square — round the fountain, past
// the benches, the pigeons flapping up — zigzagging, tiring as they go.
// From the police car, an officer runs after them by themselves and the
// wheel steers the officer left and right: lined up behind the robber, the
// officer closes in and catches them. From the police helicopter the wheel
// steers the searchlight's spot instead: officers on the ground run to
// wherever it shines, and the robber is caught once kept in it for 3 s in
// all (it never drains). Always over in a few seconds more than it takes a
// child to line up: the robber only ever slows.
import * as THREE from 'three';
import { rng, type Rng } from '../../../engine/rng.js';
import { t as tr } from '../../../i18n/index.js';
import { spawnVehicle } from '../../../engine/assets.js';
import { person, type Rig } from '../../../engine/rig.js';
import { PRIMS as P } from '../../../engine/stage.js';
import { makeHelicopter } from '../../../kit/index.js';
import { StreetSet, kit, marker } from './set.js';
import { wearHat } from './hats.js';
import { ease, pickOf, type Activity, type ActivityInput, type ActivityState, type SceneCue, type SceneLoop } from './common.js';

const ROAD_Z = 8;
const FRONT_Z = ROAD_Z - 10.6;
const SQ_X = 12, SQ_Z0 = FRONT_Z - 3, SQ_Z1 = FRONT_Z - 21;
const FOUNTAIN = { x: 0, z: FRONT_Z - 12, r: 3.4 };
const RANGE = 12;
const LIGHT_R = 2.4;
const TREES = ['tree-default', 'tree-oak', 'tree-fat'];

interface Pigeon { obj: THREE.Group; home: THREE.Vector3; fly: number; vx: number; vz: number }

export class ChaseActivity implements Activity {
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  cues: SceneCue[] = [];
  loops = new Set<SceneLoop>(['steps']);
  private set: StreetSet;
  private r: Rng;
  private robber: Rig;
  private officers: Rig[] = [];
  private icon = marker('🦹', 1.5);
  private pigeons: Pigeon[] = [];
  private goal = new THREE.Vector3();
  private t = 0;
  private caught = false;
  private progress = 0;
  private spot = new THREE.Vector3(0, 0.15, FRONT_Z - 6);
  private heli: THREE.Group | null = null;
  private beam: THREE.Mesh | null = null;
  private disc: THREE.Mesh | null = null;
  private lamps: THREE.Mesh[] = [];
  private won = false;

  constructor(seed: number, readonly fromHeli: boolean) {
    const r = this.r = rng(seed);
    const set = this.set = new StreetSet({ seed, roadZ: ROAD_Z, keep: [-15, 15], district: 'downtown', onlookers: 3, crowdX: 18, parked: 0 });
    this.scene = set.scene;
    this.camera = set.camera;

    // the square: paving with a border, a fountain, benches, trees
    set.scene.add(P.box(2 * SQ_X + 4, 0.06, SQ_Z0 - SQ_Z1 + 6, 0xb9b3a6, 0, 0.1, (SQ_Z0 + SQ_Z1) / 2));
    set.scene.add(P.box(2 * SQ_X + 2, 0.07, SQ_Z0 - SQ_Z1 + 4, 0xe3dccd, 0, 0.11, (SQ_Z0 + SQ_Z1) / 2));
    set.scene.add(P.cyl(FOUNTAIN.r, FOUNTAIN.r + 0.2, 0.7, 28, 0xcfc8b8, FOUNTAIN.x, 0.45, FOUNTAIN.z));
    const water = new THREE.Mesh(new THREE.CircleGeometry(FOUNTAIN.r - 0.3, 28), new THREE.MeshLambertMaterial({ color: 0x7fc4ea }));
    water.rotation.x = -Math.PI / 2;
    water.position.set(FOUNTAIN.x, 0.78, FOUNTAIN.z);
    set.scene.add(water);
    set.scene.add(P.cyl(0.35, 0.5, 2.2, 14, 0xcfc8b8, FOUNTAIN.x, 1.4, FOUNTAIN.z));
    set.scene.add(P.cyl(1.1, 0.4, 0.3, 18, 0xcfc8b8, FOUNTAIN.x, 2.5, FOUNTAIN.z));
    set.smoke.add({ x: FOUNTAIN.x, y: 2.7, z: FOUNTAIN.z, rate: 6, size0: 0.4, size1: 1.1, rise: 0.8, life: 1.2, dark: 0, jitter: 0.3 });
    for (const [x, z, ry] of [[-8, SQ_Z0 - 2, 0], [8, SQ_Z0 - 2, 0], [-10, FRONT_Z - 16, Math.PI / 2], [10, FRONT_Z - 16, -Math.PI / 2]] as const) {
      const b = new THREE.Group();
      b.add(P.box(2.2, 0.12, 0.6, 0xa9805a, 0, 0.55, 0), P.box(2.2, 0.5, 0.1, 0xa9805a, 0, 0.85, -0.28));
      for (const lx of [-0.9, 0.9]) b.add(P.box(0.1, 0.5, 0.5, 0x5f6774, lx, 0.3, 0));
      b.position.set(x, 0.1, z);
      b.rotation.y = ry;
      set.scene.add(b);
    }
    for (const [x, z] of [[-SQ_X - 1, SQ_Z0], [SQ_X + 1, SQ_Z0], [-SQ_X - 1, SQ_Z1], [SQ_X + 1, SQ_Z1]]) {
      const t = kit(pickOf(r, TREES), x, 0.1, z, r() * 6, 5.5 + r() * 2);
      if (t) { t.castShadow = true; set.scene.add(t); }
    }
    // pigeons pecking about
    for (let k = 0; k < 10; k++) {
      const g = new THREE.Group();
      g.add(P.sphere(0.16, 0x9aa0ab, 0, 0.18, 0), P.sphere(0.09, 0x7a8190, 0, 0.3, 0.12), P.cone(0.03, 0.08, 6, 0xf2984c, 0, 0.3, 0.22, Math.PI / 2, 0, 0));
      g.children[0].scale.set(1, 0.85, 1.35);
      const home = new THREE.Vector3((r() * 2 - 1) * SQ_X * 0.9, 0.12, SQ_Z1 + r() * (SQ_Z0 - SQ_Z1));
      if (Math.hypot(home.x - FOUNTAIN.x, home.z - FOUNTAIN.z) < FOUNTAIN.r + 0.5) home.x += FOUNTAIN.r + 1;
      g.position.copy(home);
      g.rotation.y = r() * 6;
      set.scene.add(g);
      this.pigeons.push({ obj: g, home, fly: 0, vx: 0, vz: 0 });
    }

    // the getaway car pulled over, the police car behind it, lights flashing
    const car = new THREE.Group();
    car.position.set(5, 0, ROAD_Z - 3.5);
    car.rotation.y = Math.PI / 2;
    set.scene.add(car);
    spawnVehicle('/assets/kenney/sedan.glb', { len: 4.4 }).then(g => { g.userData.shared = true; car.add(g); }).catch(() => {});
    const police = new THREE.Group();
    police.position.set(-3, 0, ROAD_Z - 3.5);
    police.rotation.y = Math.PI / 2;
    set.scene.add(police);
    spawnVehicle('/assets/kenney/police.glb', { len: 4.6 }).then(g => { g.userData.shared = true; police.add(g); }).catch(() => {});
    for (const [dz, col] of [[-0.35, 0xff3b30], [0.35, 0x3f7bff]] as const) {
      const lamp = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.22, 0.4), new THREE.MeshBasicMaterial({ color: col }));
      lamp.position.set(-3 + 0.2, 1.95, ROAD_Z - 3.5 + dz);
      set.scene.add(lamp);
      this.lamps.push(lamp);
    }

    // the robber: out of the car and off into the square
    this.robber = set.addRig(wearHat(person(seed % 12, 1.7), 'beanie'), 5, 0.12, ROAD_Z - 5.4, Math.PI);
    this.robber.play('sprint');
    const sack = P.sphere(0.34, 0x8bb35a, 0.5, 0.9, -0.1);
    sack.scale.set(1, 1.2, 1);
    this.robber.root.add(sack);
    this.pickGoal();
    set.scene.add(this.icon);

    if (!fromHeli) {
      const o = set.addRig(wearHat(person((seed + 4) % 12, 1.75), 'police'), -3, 0.12, ROAD_Z - 5.4, Math.PI);
      o.play('sprint');
      this.officers.push(o);
    } else {
      for (const [k, x, z] of [[0, -4, ROAD_Z - 5.4], [1, -1.5, ROAD_Z - 5.8]]) {
        const o = set.addRig(wearHat(person(seed + 3 + k * 5, 1.75), 'police'), x, 0.12, z, Math.PI);
        o.play('sprint');
        this.officers.push(o);
      }
      this.heli = makeHelicopter({ body: 0x5a7fb5, band: 0xfaf7ef });
      this.heli.scale.setScalar(1.4);
      set.scene.add(this.heli);
      // the searchlight: a soft cone from the belly and a bright spot on the ground
      const cone = new THREE.ConeGeometry(LIGHT_R, 1, 24, 1, true);
      cone.translate(0, -0.5, 0);
      this.beam = new THREE.Mesh(cone, new THREE.MeshBasicMaterial({ color: 0xfff6d0, transparent: true, opacity: 0.16, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide }));
      this.disc = new THREE.Mesh(new THREE.CircleGeometry(LIGHT_R, 32), new THREE.MeshBasicMaterial({ color: 0xfff2b0, transparent: true, opacity: 0.55, depthWrite: false, blending: THREE.AdditiveBlending }));
      this.disc.rotation.x = -Math.PI / 2;
      set.scene.add(this.beam, this.disc);
      this.loops.add('rotor');
    }
    if (fromHeli) set.shot({ x: 0, y: 17, z: ROAD_Z + 9 }, { x: 0, y: 0, z: FRONT_Z - 11 });
    else this.follow(1);
  }

  /** the robber's next corner of the square: across from where they are,
   * and away from whoever is after them (so nobody is caught standing still) */
  private pickGoal(): void {
    const p = this.robber.root.position;
    const chaser = this.fromHeli ? this.spot.x : this.officers[0]?.root.position.x ?? 0;
    for (let k = 0; k < 16; k++) {
      const x = (this.r() * 2 - 1) * SQ_X * 0.85;
      const z = SQ_Z1 + 1 + this.r() * (SQ_Z0 - SQ_Z1 - 2);
      if (Math.abs(x - p.x) < 5 || Math.hypot(x - FOUNTAIN.x, z - FOUNTAIN.z) < FOUNTAIN.r + 1.2) continue;
      if (k < 12 && Math.abs(x - chaser) < 4) continue;
      this.goal.set(x, 0.12, z);
      return;
    }
    this.goal.set(-Math.sign(p.x || 1) * SQ_X * 0.7, 0.12, (SQ_Z0 + SQ_Z1) / 2 + 5);
  }

  private get speed(): number { return Math.max(1.3, 4.6 - this.t * 0.24); }

  aim(): number {
    return Math.max(-1, Math.min(1, this.robber.root.position.x / RANGE));
  }

  private follow(dt: number): void {
    const o = this.officers[0];
    const p = o.root.position;
    this.set.shot({ x: p.x * 0.55, y: 7.5, z: Math.min(ROAD_Z + 4, p.z + 10) }, { x: p.x * 0.7, y: 0.5, z: p.z - 7 });
    void dt;
  }

  update(dt: number, elapsed: number, inp: ActivityInput): ActivityState {
    this.set.night = inp.night ?? 0;
    this.t += dt;
    const rp = this.robber.root.position;
    if (!this.caught) {
      // the robber runs for the goal, round the fountain, picking a new one on arrival
      const d = this.goal.clone().sub(rp);
      d.y = 0;
      if (d.length() < 0.8) this.pickGoal();
      const step = d.normalize().multiplyScalar(this.speed * dt);
      const next = rp.clone().add(step);
      const fd = Math.hypot(next.x - FOUNTAIN.x, next.z - FOUNTAIN.z);
      if (fd < FOUNTAIN.r + 0.8) {
        // slide round the basin's rim
        const nx = (next.x - FOUNTAIN.x) / fd, nz = (next.z - FOUNTAIN.z) / fd;
        next.set(FOUNTAIN.x + nx * (FOUNTAIN.r + 0.8), 0.12, FOUNTAIN.z + nz * (FOUNTAIN.r + 0.8));
      }
      this.robber.root.rotation.y = Math.atan2(next.x - rp.x, next.z - rp.z);
      rp.copy(next);
      this.robber.play(this.speed > 2.4 ? 'sprint' : 'walk', { speed: this.speed > 2.4 ? 1 : 1.4 });
    }
    const steer = Math.max(-1, Math.min(1, inp.steer));
    if (!this.fromHeli) {
      // the officer: the wheel steers across, the chase up the square is theirs
      const o = this.officers[0], op = o.root.position;
      // (the officer sets off a moment after the robber: "Hey! Stop!")
      if (!this.caught && this.t > 0.8) {
        const tx = steer * RANGE;
        const nx = op.x + Math.max(-5.5 * dt, Math.min(5.5 * dt, tx - op.x));
        const lined = Math.abs(op.x - rp.x) < 1.2;
        const tz = lined ? rp.z : rp.z + 2.4;
        const nz = op.z + Math.max(-4.2 * dt, Math.min(4.2 * dt, tz - op.z));
        o.root.rotation.y = Math.atan2(nx - op.x, nz - op.z - 0.001);
        op.set(nx, 0.12, nz);
        if (Math.hypot(op.x - rp.x, op.z - rp.z) < 1.1) this.catch();
        this.progress = Math.max(this.progress, Math.min(0.9, 1 - Math.hypot(op.x - rp.x, op.z - rp.z) / 14));
      }
      this.follow(dt);
    } else if (this.heli && this.beam && this.disc) {
      // the searchlight's spot: the wheel moves it across, it tracks up the square
      this.spot.x = ease(this.spot.x, steer * RANGE, 3.2, dt);
      this.spot.z = ease(this.spot.z, rp.z, 2.4, dt);
      this.heli.position.set(this.spot.x * 0.7, 12 + Math.sin(elapsed * 1.3) * 0.25, this.spot.z - 7);
      this.heli.rotation.y = 0;
      (this.heli.userData.mainRotor as THREE.Object3D).rotation.y = elapsed * 24;
      const from = this.heli.position.clone().add(new THREE.Vector3(0, 0.9, 0));
      const to = this.spot;
      const len = from.distanceTo(to);
      this.beam.position.copy(from);
      this.beam.scale.set(1, len, 1);
      this.beam.lookAt(to);
      this.beam.rotateX(-Math.PI / 2);
      this.disc.position.set(to.x, 0.2, to.z);
      const lit = Math.hypot(rp.x - to.x, rp.z - to.z) < LIGHT_R + 0.6;
      if (!this.caught && lit) this.progress = Math.min(1, this.progress + dt / 3);
      (this.disc.material as THREE.MeshBasicMaterial).opacity = lit ? 0.75 : 0.5;
      // the officers run to wherever it shines (at the robber once caught)
      this.officers.forEach((o, k) => {
        const op = o.root.position, tgt = this.caught ? rp.clone().add(new THREE.Vector3(k ? 1 : -1, 0, 0.6)) : to.clone().add(new THREE.Vector3(k ? 1.4 : -1.4, 0, 1.5));
        const d = tgt.sub(op);
        d.y = 0;
        const dist = d.length();
        if (dist > 0.2) {
          o.root.rotation.y = Math.atan2(d.x, d.z);
          op.addScaledVector(d.normalize(), Math.min(dist, dt * 4.4));
          if (o.clip !== 'sprint' && !this.caught) o.play('sprint');
        } else if (!this.caught && o.clip !== 'idle') o.play('idle');
      });
      if (!this.caught && this.progress >= 1) this.catch();
    }
    // pigeons: up they go when someone runs by, then settle back down
    let flush = false;
    for (const g of this.pigeons) {
      const near = [rp, ...this.officers.map(o => o.root.position)].some(p => Math.hypot(p.x - g.obj.position.x, p.z - g.obj.position.z) < 2.4);
      if (g.fly <= 0 && near) {
        g.fly = 3.5;
        const a = this.r() * Math.PI * 2;
        g.vx = Math.cos(a) * 3;
        g.vz = Math.sin(a) * 3;
        flush = true;
      }
      if (g.fly > 0) {
        g.fly -= dt;
        g.obj.position.x += g.vx * dt;
        g.obj.position.z += g.vz * dt;
        g.obj.position.y = g.fly > 1.2 ? Math.min(6, g.obj.position.y + dt * 3.5) : Math.max(0.12, g.obj.position.y - dt * 4);
        g.obj.rotation.z = Math.sin(elapsed * 30) * 0.3;
        if (g.fly <= 0) { g.obj.position.copy(g.home); g.obj.rotation.z = 0; }
      } else {
        g.obj.rotation.x = Math.max(0, Math.sin(elapsed * 4 + g.home.x * 3)) * 0.5;
      }
    }
    if (flush) this.cues.push('flutter');
    const on = Math.floor(elapsed * 6) % 2 === 0;
    (this.lamps[0].material as THREE.MeshBasicMaterial).color.setHex(on ? 0xff3b30 : 0x3a1010);
    (this.lamps[1].material as THREE.MeshBasicMaterial).color.setHex(on ? 0x10183a : 0x3f7bff);
    this.icon.visible = !this.caught;
    this.icon.position.copy(rp).add(new THREE.Vector3(0, 2.8 + Math.sin(elapsed * 4) * 0.15, 0));
    this.loops.delete('steps');
    if (!this.caught) this.loops.add('steps');
    this.set.update(dt);
    return {
      progress: this.caught ? 1 : this.progress,
      prompt: this.caught ? tr('scene.caught') : this.fromHeli ? tr('scene.chaseLight') : tr('scene.chaseRun'),
      done: this.caught,
    };
  }

  private catch(): void {
    this.caught = true;
    this.progress = 1;
    this.robber.play('emote-no');
    for (const o of this.officers) o.play('interact-right', { loop: false });
    this.set.sparkles.burst(this.robber.root.position.clone().add(new THREE.Vector3(0, 2, 0)), 'star', 12, 0.55);
    this.cues.push('caught', 'cuffs');
  }

  celebrate(): void {
    if (this.won) return;
    this.won = true;
    this.set.cheer(3);
    for (const o of this.officers) o.play('emote-yes');
    this.set.particles.burstConfetti(this.robber.root.position.clone().add(new THREE.Vector3(0, 1.5, 0)));
    this.cues.push('cheer');
  }

  dispose(): void {
    this.set.dispose();
  }
}
