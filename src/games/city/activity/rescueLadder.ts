// Burning building (G4): people wave from the windows of a burning building
// — the very one at the call in the city (its `look`), flames at other
// windows, smoke over the roof. The wheel drives the ladder truck along the
// street; parked with its turntable under someone, the aerial ladder swings
// round and rises to their floor, they step into the basket, it comes down,
// and they run to the crowd behind the tape, cheering — the flame beside
// their window going out. Once the ladder goes up the truck's legs are
// down and it stays put: a small child needn't hold the wheel still.
import * as THREE from 'three';
import { rng, type Rng } from '../../../engine/rng.js';
import { t as tr } from '../../../i18n/index.js';
import { person, type Rig } from '../../../engine/rig.js';
import { PRIMS as P } from '../../../engine/stage.js';
import { StreetSet, kit, kitSize, marker } from './set.js';
import { LadderTruck, firefighter } from './ladderTruck.js';
import type { Fire } from '../fx/fire.js';
import type { SmokeEmitter } from '../fx/smoke.js';
import { pickOf, type Activity, type ActivityInput, type ActivityState, type CallLook, type SceneCue, type SceneLoop } from './common.js';

const ROAD_Z = 8;
const FRONT_Z = ROAD_Z - 10.6;
const TRUCK_Z = ROAD_Z - 3.2;
const MOUNT = 2.1;
const RANGE = 11;
const LOCK = 1.8;
const CROWD_X = 16;
const TALL = ['bldg-a', 'bldg-b', 'bldg-c', 'bldg-d', 'bldg-e', 'bldg-f', 'bldg-g', 'bldg-h', 'bldg-i', 'bldg-j', 'bldg-k', 'bldg-l', 'bldg-m', 'bldg-n'];

interface Waiting {
  who: Rig; spot: THREE.Vector3; flame: Fire | null; icon: THREE.Object3D;
  state: 'wait' | 'aboard' | 'down' | 'run' | 'safe';
  hop: { from: THREE.Vector3; to: THREE.Vector3; t: number; dur: number; h: number } | null;
}

export class RescueLadderActivity implements Activity {
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  cues: SceneCue[] = [];
  loops = new Set<SceneLoop>(['crackle']);
  private set: StreetSet;
  private r: Rng;
  private truck: LadderTruck;
  private people: Waiting[] = [];
  private active: Waiting | null = null;
  private raising = false;
  private column: SmokeEmitter;
  private won = false;

  constructor(seed: number, look?: CallLook) {
    const r = this.r = rng(seed);
    // the building: the one from the call if it has floors enough, else a tall one
    let name = look?.kind === 'building' && look.model ? look.model : pickOf(r, TALL);
    if ((kitSize(name)?.y ?? 0) < 8) name = pickOf(r, TALL.filter(n => (kitSize(n)?.y ?? 20) >= 8)) ?? name;
    const sz = kitSize(name) ?? new THREE.Vector3(12, 14, 10);
    const hw = Math.max(5, sz.x / 2 + 1);
    const set = this.set = new StreetSet({ seed, roadZ: ROAD_Z, keep: [-hw, hw], district: look?.district ?? 'urban', onlookers: 3, crowdX: CROWD_X, parked: 0 });
    this.scene = set.scene;
    this.camera = set.camera;
    const m = kit(name, 0, 0.1, FRONT_Z - sz.z / 2);
    if (m) { m.castShadow = true; m.receiveShadow = true; set.scene.add(m); }
    const floors: number[] = [];
    for (let y = 4.4; y < Math.min(sz.y - 1.5, 13); y += 3.4) floors.push(y);
    if (!floors.length) floors.push(4.4);
    const half = Math.min(5.5, Math.max(2.5, sz.x / 2 - 1.8));
    const cols = [-half, 0, half];
    // 2–3 people, one per column, on little balconies; a flame beside each
    const n = 2 + ((r() * 2) | 0);
    const order = [0, 1, 2].sort(() => r() - 0.5).slice(0, n);
    order.forEach((c, k) => {
      const y = floors[(r() * floors.length) | 0];
      const spot = new THREE.Vector3(cols[c], y, FRONT_Z + 0.55);
      set.scene.add(P.box(2.2, 0.2, 1.1, 0xeceae4, spot.x, y - 0.1, FRONT_Z + 0.5));
      set.scene.add(P.box(2.2, 0.5, 0.08, 0xd9dde2, spot.x, y + 0.25, FRONT_Z + 1.02));
      const who = set.addRig(person(seed + k * 3, 1.7), spot.x, y, spot.z, 0);
      who.play('interact-right', { speed: 1.3 });
      const flame = set.fires.add({ x: spot.x + (c === 2 ? -1.9 : 1.9), y: y - 0.6, z: FRONT_Z + 0.4, size: 1.2, seed: k + 1 });
      const icon = marker('🆘', 1.4);
      set.scene.add(icon);
      this.people.push({ who, spot, flame, icon, state: 'wait', hop: null });
    });
    // more flames at the other windows, smoke from the roof
    for (let k = 0; k < 3; k++) {
      const x = (r() - 0.5) * 2 * half, y = floors[(r() * floors.length) | 0] - 0.6;
      if (this.people.some(p => Math.abs(p.spot.x - x) < 2.4 && Math.abs(p.spot.y - 0.6 - y) < 1)) continue;
      set.fires.add({ x, y, z: FRONT_Z + 0.35, size: 1 + r() * 0.4, seed: 10 + k });
    }
    this.column = set.smoke.add({ x: 0, y: sz.y, z: FRONT_Z - sz.z / 2, rate: 3.5, size0: 1.6, size1: 6, rise: 2.4, life: 5.5, jitter: 3, dark: 0.8 });

    this.truck = new LadderTruck();
    this.truck.root.position.set(-RANGE * 0.7, 0, TRUCK_Z);
    this.truck.root.rotation.y = Math.PI / 2;
    set.scene.add(this.truck.root);
    set.addRig(firefighter(5), -15.5, 0.17, ROAD_Z - 7.6, Math.PI * 0.9).play('idle');
    set.addRig(firefighter(9), 13.5, 0.17, ROAD_Z - 7.4, -Math.PI * 0.8).play('idle');
    const top = Math.max(...this.people.map(p => p.spot.y));
    set.shot({ x: 0, y: 6.5, z: ROAD_Z + 12 }, { x: 0, y: Math.min(7, top * 0.55 + 1.5), z: FRONT_Z + 1 });
  }

  private get mountX(): number { return this.truck.root.position.x - MOUNT; }

  private next(): Waiting | null {
    const left = this.people.filter(p => p.state === 'wait');
    if (!left.length) return null;
    return left.reduce((a, b) => (Math.abs(b.spot.x - this.mountX) < Math.abs(a.spot.x - this.mountX) ? b : a));
  }

  aim(): number {
    if (this.active && this.active.state !== 'wait') return this.truck.root.position.x / RANGE;
    const p = this.active ?? this.next();
    return p ? Math.max(-1, Math.min(1, (p.spot.x + MOUNT) / RANGE)) : this.truck.root.position.x / RANGE;
  }

  update(dt: number, elapsed: number, inp: ActivityInput): ActivityState {
    this.set.night = inp.night ?? 0;
    // the wheel drives the truck — until the ladder goes up: then its legs
    // are down and it stays put (a small child needn't hold the wheel still)
    if (this.active) this.truck.brake(dt);
    else this.truck.driveTo(Math.max(-1, Math.min(1, inp.steer)) * RANGE, dt);

    if (!this.active) {
      // under someone waiting, slowing: up goes the ladder
      const p = this.people.find(q => q.state === 'wait' && Math.abs(this.mountX - q.spot.x) < LOCK);
      if (p && Math.abs(this.truck.speedX) < 5) { this.active = p; this.raising = true; }
    }
    const a = this.active;
    if (a && a.state === 'wait') {
      const at = a.spot.clone().add(new THREE.Vector3(0, -0.1, 1.3));
      this.truck.reach(at);
      const b = this.truck.basketAt();
      if (this.truck.settled && b.distanceTo(at) < 1.6) {
        a.state = 'aboard';
        a.hop = { from: a.who.root.position.clone(), to: b.clone().add(new THREE.Vector3(0, 0.15, 0)), t: 0, dur: 0.7, h: 0.7 };
        a.who.play('jump', { loop: false });
        this.cues.push('aboard');
      }
    }
    for (const p of this.people) {
      if (p.hop) {
        const h = p.hop;
        h.t = Math.min(1, h.t + dt / h.dur);
        p.who.root.position.lerpVectors(h.from, h.to, h.t);
        p.who.root.position.y += Math.sin(h.t * Math.PI) * h.h;
        if (h.t >= 1) p.hop = null;
      }
      p.icon.visible = p.state === 'wait';
      p.icon.position.copy(p.spot).add(new THREE.Vector3(0, 2.6 + Math.sin(elapsed * 3 + p.spot.x) * 0.2, 0.2));
      if (p.state === 'wait') {
        p.who.root.rotation.y = Math.sin(elapsed * 1.3 + p.spot.x) * 0.3;
      } else if (p.state === 'aboard' && !p.hop) {
        p.state = 'down';
        p.who.play('idle');
        this.truck.rest();
        // their window's flame goes out as they leave it
        if (p.flame) p.flame.target = 0;
      } else if (p.state === 'down') {
        p.who.root.position.copy(this.truck.basketAt()).add(new THREE.Vector3(0, 0.15, 0));
        p.who.root.rotation.y = 0;
        if (this.truck.resting) {
          p.state = 'run';
          p.hop = { from: p.who.root.position.clone(), to: new THREE.Vector3(p.who.root.position.x, 0.17, TRUCK_Z - 2.3), t: 0, dur: 0.7, h: 1.1 };
          p.who.play('sprint');
          this.active = null;
          this.raising = false;
        }
      } else if (p.state === 'run' && !p.hop) {
        const to = new THREE.Vector3(CROWD_X - 3 + this.people.filter(q => q.state === 'safe').length * 1.1, 0.17, ROAD_Z - 8.3);
        const d = to.clone().sub(p.who.root.position);
        const dist = d.length();
        p.who.root.rotation.y = Math.atan2(d.x, d.z);
        p.who.root.position.addScaledVector(d.normalize(), Math.min(dist, dt * 5.5));
        if (dist < 0.3) {
          p.state = 'safe';
          p.who.play('emote-yes');
          p.who.root.rotation.y = 0;
          this.set.cheer(2);
          this.set.sparkles.burst(to.clone().add(new THREE.Vector3(0, 2, 0)), 'star', 10, 0.5);
          this.cues.push('safe', 'cheer');
        }
      }
    }
    const saved = this.people.filter(p => p.state === 'safe').length;
    const moving = this.people.filter(p => p.state !== 'wait' && p.state !== 'safe').length;
    const progress = Math.min(1, (saved + moving * 0.6) / this.people.length);
    this.column.strength = 1 - saved / this.people.length * 0.7;
    const lit = this.set.fires.fires.reduce((s, f) => s + f.light, 0);
    this.set.fireLight.intensity = Math.min(1, lit / 3) * (this.set.night * 40 + 3);
    this.set.fireLight.position.set(0, 6, FRONT_Z + 4);
    this.loops.delete('ladder');
    if (!this.truck.resting && this.truck.moving) this.loops.add('ladder');
    this.truck.update(dt);
    this.set.update(dt);
    const prompt = this.raising ? tr('scene.ladderUp') : tr('scene.ladderPeople');
    return { progress, prompt, done: saved === this.people.length };
  }

  celebrate(): void {
    if (this.won) return;
    this.won = true;
    for (const f of this.set.fires.fires) f.target = 0;
    this.column.strength = 0.15;
    this.loops.delete('crackle');
    this.set.cheer(3);
    for (const p of this.people) p.who.play('jump');
    this.set.particles.burstConfetti(new THREE.Vector3(CROWD_X - 2, 1.5, ROAD_Z - 8));
    this.set.pushIn({ x: 4, y: 5, z: ROAD_Z + 8 });
    this.cues.push('cheer');
  }

  dispose(): void {
    this.set.dispose();
  }
}
