// The station (G6, G4): the kid's train has stopped at a platform, and the
// doors are the kid's job — in a scene of its own, like every mission. The
// camera stands on the platform looking at the train's side; people wait in
// a queue, a few are on the train. Holding the wheel right slides the doors
// open (the Train Kit models have no doors: two leaves over a dark opening
// at each door); the riders step off and walk away, the queue walks in one
// by one — and now and then somebody comes running late from the platform's
// end, and everybody waits for them. When everyone is aboard the bell rings,
// and holding the wheel left closes the doors; the guard waves, the train
// eases forward. The pure door machine (trainDoors.ts) keeps it from ever
// getting stuck: the gauge never drains, the narrator asks again after 8 s,
// the doors move by themselves after 20 s. It can't be lost.
import * as THREE from 'three';
import { makeSceneDressing, PRIMS as P, mat } from '../../../engine/stage.js';
import { rng, type Rng } from '../../../engine/rng.js';
import { person, pet, type Rig } from '../../../engine/rig.js';
import { spawnVehicle } from '../../../engine/assets.js';
import { t as tr } from '../../../i18n/index.js';
import { Particles } from '../particles.js';
import { Sparkles } from '../fx/sparkle.js';
import { kit, kitSize, marker } from './set.js';
import { wearHat } from './hats.js';
import { TrainDoors } from '../trainDoors.js';
import { PLATFORM_EDGE, PLATFORM_W, PLATFORM_MID, PLATFORM_LEN, CANOPY_IN, CANOPY_OUT, CANOPY_Y, STOP_POST } from '../platform.js';
import type { Activity, ActivityInput, ActivityState, SceneCue, SceneLoop } from './common.js';

const CAR_LEN = 9, GAP = 1.1;
const CARS = ['train-electric-city-a', 'train-electric-city-b', 'train-electric-city-c'].map(f => `/assets/kenney/train/${f}.glb`);
const SHOPS = [...'abcdefgh'].map(c => 'bldg-' + c);
const TREES = ['tree-oak', 'tree-default', 'tree-fat'];
const WALK = 1.5, RUN = 3.6;

interface Door { x: number; leaves: Array<{ m: THREE.Mesh; dir: number }>; gap: THREE.Mesh }
interface Rider {
  rig: Rig;
  /** off the train, into the train, or late and running for it */
  kind: 'off' | 'on' | 'late';
  path: Array<{ x: number; z: number }>;
  speed: number;
  /** seconds before it sets off */
  wait: number;
  done: boolean;
}

export class DoorsActivity implements Activity {
  scene = new THREE.Scene();
  camera = new THREE.PerspectiveCamera(45, 16 / 9, 0.1, 600);
  cues: SceneCue[] = [];
  loops = new Set<SceneLoop>();
  private r: Rng;
  private doors = new TrainDoors();
  private doorList: Door[] = [];
  private riders: Rider[] = [];
  private train = new THREE.Group();
  private particles: Particles;
  private sparkles: Sparkles;
  private guard: Rig;
  private icon = marker('🚪', 1.4);
  private hw = 2.1;
  private boarded = 0;
  private toBoard = 0;
  private late: boolean;
  private lateSent = false;
  private opened = -1;
  private t = 0;
  private roll = 0;
  private closedAt = -1;
  private won = false;
  private camPos = new THREE.Vector3(1.5, 4.4, PLATFORM_MID + 12.5);
  private camLook = new THREE.Vector3(0, 2.9, 0);
  private lampHeads: THREE.Mesh[] = [];

  constructor(seed: number) {
    const r = this.r = rng(seed * 131 + 9);
    this.scene.userData.dressing = makeSceneDressing(this.scene, {
      sunPos: [-30, 45, 38], shadowSpan: 40, fogNear: 60, fogFar: 170, groundR: 170, groundColor: 0xa9c88b,
    });
    this.particles = new Particles(this.scene);
    this.sparkles = new Sparkles(this.scene);
    const S = this.scene;
    // the track: a ballast bed, sleepers and two rails along x
    S.add(P.box(80, 0.12, 3.4, 0x9a938a, 0, 0.06, 0));
    for (let x = -40; x <= 40; x += 1.1) S.add(P.box(0.28, 0.08, 2.6, 0x8a6a4a, x, 0.14, 0));
    for (const z of [-0.72, 0.72]) S.add(P.box(80, 0.1, 0.12, 0xb8bec9, 0, 0.23, z));
    // the platform (the same numbers as every station's: platform.ts)
    const L = PLATFORM_LEN * 2.2;
    S.add(P.box(L, 0.46, PLATFORM_W, 0xc8b58f, 0, 0.23, PLATFORM_MID));
    S.add(P.box(L, 0.05, 0.55, 0xf2ead6, 0, 0.48, PLATFORM_EDGE + 0.3));
    S.add(P.box(L, 0.02, 0.2, 0xffd23f, 0, 0.48, PLATFORM_EDGE + 0.75));
    // (the canopy over the platform's two ends: across the middle it hid the
    // doors from the camera)
    for (const cx of [-15, 15]) {
      for (const x of [cx - 3, cx + 3]) for (const ac of [-1, 1]) S.add(P.cyl(0.09, 0.11, 3.1, 8, 0x7c828c, x, 1.55, PLATFORM_MID + ac));
      S.add(P.box(8, 0.16, CANOPY_OUT - CANOPY_IN, 0xf2ead6, cx, CANOPY_Y, (CANOPY_IN + CANOPY_OUT) / 2));
    }
    for (const x of [-7.5, 7.5]) S.add(P.box(1.6, 0.09, 0.45, 0xa9805a, x, 0.62, PLATFORM_MID + 0.9));
    // the STOP board, and a station sign
    S.add(P.cyl(0.07, 0.07, 2.4, 8, 0x7c828c, 13.5, 1.2, STOP_POST));
    S.add(P.box(1.1, 0.8, 0.12, 0xffd23f, 13.5, 2.35, STOP_POST));
    S.add(P.cyl(0.06, 0.08, 2.6, 8, 0x7c828c, -14, 1.3, PLATFORM_MID + 0.4));
    const sign = P.cyl(0.55, 0.55, 0.08, 12, 0x4a90d9, -14, 2.5, PLATFORM_MID + 0.4);
    sign.rotation.x = Math.PI / 2;
    S.add(sign);
    // platform lamps (they glow at night)
    for (const x of [-10, 10]) {
      S.add(P.cyl(0.06, 0.08, 3.6, 8, 0x5a5f69, x, 1.8, PLATFORM_EDGE + PLATFORM_W - 0.3));
      const head = new THREE.Mesh(new THREE.SphereGeometry(0.25, 10, 8), new THREE.MeshBasicMaterial({ color: 0xfff1c9 }));
      head.position.set(x, 3.7, PLATFORM_EDGE + PLATFORM_W - 0.3);
      S.add(head);
      this.lampHeads.push(head);
    }
    // the town behind the track, and the ground beyond the platform
    let x = -40;
    while (x < 40) {
      const name = SHOPS[(r() * SHOPS.length) | 0];
      const sz = kitSize(name);
      const w = sz?.x ?? 10;
      const m = kit(name, x + w / 2, 0.02, -9 - (sz?.z ?? 10) / 2);
      if (m) { m.castShadow = true; S.add(m); }
      if (r() < 0.5) { const t = kit(TREES[(r() * TREES.length) | 0], x + w + 1.5, 0.02, -8, r() * 6, 5 + r() * 2); if (t) S.add(t); }
      x += w + 3;
    }
    S.add(P.box(90, 0.05, 30, 0xa9c88b, 0, 0.02, PLATFORM_EDGE + PLATFORM_W + 15));

    // the kid's train along the platform (the middle car in the middle)
    for (let k = 0; k < 3; k++) {
      const cx = (1 - k) * (CAR_LEN + GAP);
      const car = new THREE.Group();
      car.position.set(cx, 0.21, 0);
      car.rotation.y = Math.PI / 2;
      const stand = P.box(3.8, 5.2, CAR_LEN, k === 0 ? 0xe25c5c : 0xf2f0ea, 0, 2.8, 0);
      car.add(stand);
      this.train.add(car);
      spawnVehicle(CARS[k], { len: CAR_LEN }).then(g => {
        g.userData.shared = true;
        car.remove(stand);
        car.add(g);
        const bb = new THREE.Box3().setFromObject(g);
        this.hw = Math.max(1.6, bb.max.z + 0.03);
        this.placeDoors();
      }).catch(() => {});
      for (const off of [CAR_LEN * 0.2, -CAR_LEN * 0.2]) this.addDoor(cx + off);
    }
    S.add(this.train);
    this.placeDoors();

    // on the train: a few who get off; on the platform: the queue
    const off = 1 + ((r() * 3) | 0);
    for (let k = 0; k < off; k++) {
      const d = this.doorList[(r() * this.doorList.length) | 0];
      const rig = this.addRig(k + 3, d.x, this.hw - 0.4);
      rig.root.visible = false;
      const end = r() < 0.5 ? -16 : 16;
      this.riders.push({ rig, kind: 'off', speed: WALK, wait: k * 0.5, done: false,
        path: [{ x: d.x, z: PLATFORM_EDGE + 1 }, { x: end, z: PLATFORM_MID + (r() - 0.5) }] });
    }
    const n = 3 + ((r() * 3) | 0);
    for (let k = 0; k < n; k++) {
      const qx = -7 + k * (14 / Math.max(1, n - 1)) + (r() - 0.5);
      const qz = PLATFORM_MID + (r() - 0.3) * 1.2;
      const isPet = r() < 0.2;
      const rig = isPet ? pet((['dog', 'cat', 'bunny'] as const)[(r() * 3) | 0], 0.6) : this.makePerson(k + 7);
      rig.root.position.set(qx, 0.46, qz);
      rig.root.rotation.y = Math.PI;
      this.scene.add(rig.root);
      rig.play('idle');
      const d = this.doorList.reduce((a, b) => (Math.abs(b.x - qx) < Math.abs(a.x - qx) ? b : a));
      this.riders.push({ rig, kind: 'on', speed: WALK, wait: 1.2 + k * 0.6, done: false,
        path: [{ x: d.x, z: PLATFORM_EDGE + 0.4 }, { x: d.x, z: this.hw - 0.4 }] });
    }
    this.toBoard = n;
    this.late = r() < 0.5;
    // the guard at the platform's end
    this.guard = this.addRig(2, 11.5, PLATFORM_MID + 0.5);
    wearHat(this.guard, 'police');
    this.guard.root.rotation.y = -Math.PI / 2 - 0.4;
    this.guard.play('idle');
    S.add(this.icon);
    this.shot();
  }

  private makePerson(id: number): Rig { return person(id % 12, 1.7); }

  private addRig(id: number, x: number, z: number): Rig {
    const rig = this.makePerson(id);
    rig.root.position.set(x, 0.46, z);
    this.scene.add(rig.root);
    rig.play('idle');
    return rig;
  }

  /** a door on the platform side: a dark opening, two leaves over it */
  private addDoor(x: number): void {
    const gap = new THREE.Mesh(new THREE.BoxGeometry(1.5, 2.7, 0.04), mat(0x1f2630));
    this.scene.add(gap);
    const leaves = [-1, 1].map(dir => {
      const m = new THREE.Mesh(new THREE.BoxGeometry(0.75, 2.7, 0.06), mat(0xe9edf2));
      this.scene.add(m);
      return { m, dir };
    });
    this.doorList.push({ x, leaves, gap });
  }

  private placeDoors(): void {
    for (const d of this.doorList) {
      d.gap.position.set(d.x + this.roll, 2.6, this.hw);
      for (const l of d.leaves) l.m.position.set(d.x + this.roll + l.dir * (0.375 + 0.72 * this.doors.open), 2.6, this.hw + 0.04);
    }
  }

  private shot(): void {
    this.camera.position.copy(this.camPos);
    this.camera.lookAt(this.camLook);
  }

  aim(): number { return this.doors.aim(); }

  update(dt: number, elapsed: number, inp: ActivityInput): ActivityState {
    this.t += dt;
    const night = inp.night ?? 0;
    for (const h of this.lampHeads) (h.material as THREE.MeshBasicMaterial).color.setHex(night > 0.3 ? 0xfff1c9 : 0xcfd3da);
    const steer = Math.max(-1, Math.min(1, inp.steer));
    const busy = this.opened < 0 || this.t - this.opened < 2 || this.riders.some(r => (r.kind === 'on' || r.kind === 'late') && !r.done) || (this.late && !this.lateSent);
    const was = this.doors.phase;
    const ev = this.doors.update(dt, steer, busy);
    if (was === 'shut' && this.doors.phase === 'opening') this.cues.push('doorsSlide');
    if (was === 'aboard' && this.doors.phase === 'closing') this.cues.push('doorsSlide');
    for (const e of ev) {
      if (e === 'opened') this.opened = this.t;
      if (e === 'allAboard') this.cues.push('bell');
      if (e === 'closed') { this.closedAt = this.t; this.cues.push('safe'); this.guard.play('interact-right', { speed: 1.4 }); }
    }
    const open = this.doors.phase === 'open' || this.doors.phase === 'aboard';
    // the people: off first, then the queue one by one; the latecomer runs
    if (open) {
      for (const rd of this.riders) {
        if (rd.done) continue;
        if (rd.kind === 'on' && rd.wait > 0 && this.t - this.opened < 1) continue;
        rd.wait -= dt;
        if (rd.wait > 0) continue;
        rd.rig.root.visible = true;
        const goal = rd.path[0];
        const p = rd.rig.root.position, dx = goal.x - p.x, dz = goal.z - p.z, d = Math.hypot(dx, dz);
        if (rd.rig.clip !== (rd.kind === 'late' ? 'sprint' : 'walk')) rd.rig.play(rd.kind === 'late' ? 'sprint' : 'walk');
        if (d > 0.08) {
          const s = Math.min(d, rd.speed * dt);
          p.x += (dx / d) * s; p.z += (dz / d) * s;
          rd.rig.root.rotation.y = Math.atan2(dx, dz);
        } else {
          rd.path.shift();
          if (!rd.path.length) {
            rd.done = true;
            rd.rig.root.visible = false;
            if (rd.kind !== 'off') { this.boarded++; this.sparkles.burst(new THREE.Vector3(p.x, 2.2, p.z), 'heart', 5, 0.35, 1.6); }
          }
        }
      }
      // (the last of the queue in: somebody running late, now and then)
      if (this.late && !this.lateSent && this.riders.every(r => r.kind !== 'on' || r.done)) {
        this.lateSent = true;
        const rig = this.addRig(11, 22, PLATFORM_MID + 0.3);
        const d = this.doorList[0];
        this.riders.push({ rig, kind: 'late', speed: RUN, wait: 0, done: false,
          path: [{ x: d.x + 1.2, z: PLATFORM_MID - 0.4 }, { x: d.x, z: PLATFORM_EDGE + 0.4 }, { x: d.x, z: this.hw - 0.4 }] });
        this.toBoard++;
        this.cues.push('latecomer');
      }
    }
    for (const rd of this.riders) rd.rig.update(dt);
    this.guard.update(dt);
    // closed: the train eases forward
    if (this.closedAt >= 0) this.roll += dt * Math.min(3, (this.t - this.closedAt) * 1.5);
    this.train.position.x = this.roll;
    this.placeDoors();
    // the icon over the middle door until the doors have closed
    const mid = this.doorList[2] ?? this.doorList[0];
    this.icon.visible = this.doors.phase === 'shut' || this.doors.phase === 'aboard';
    this.icon.position.set(mid.x + this.roll, 4.8 + Math.sin(elapsed * 3) * 0.15, this.hw + 0.6);
    this.particles.update(dt);
    this.sparkles.update(dt);
    // a slow handheld drift
    this.camera.position.set(this.camPos.x + Math.sin(this.t * 0.23) * 0.3, this.camPos.y + Math.sin(this.t * 0.31) * 0.15, this.camPos.z);
    this.camera.lookAt(this.camLook);
    const ph = this.doors.phase;
    const lateRunning = this.riders.some(r => r.kind === 'late' && !r.done);
    const prompt = ph === 'shut' ? tr('train.openDoors')
      : ph === 'aboard' ? tr('train.closeDoors')
      : lateRunning ? tr('train.latecomer')
      : ph === 'open' ? tr('train.aboard', { people: '🧍'.repeat(Math.min(6, this.boarded)) })
      : tr('train.boarding');
    const progress = ph === 'shut' ? 0.15 * this.doors.gauge
      : ph === 'opening' ? 0.18
      : ph === 'open' ? 0.2 + 0.6 * (this.boarded / Math.max(1, this.toBoard))
      : ph === 'aboard' ? 0.8 + 0.18 * this.doors.gauge
      : ph === 'closing' ? 0.98 : 1;
    return { progress: Math.min(1, progress), prompt, done: ph === 'closed' };
  }

  celebrate(): void {
    if (this.won) return;
    this.won = true;
    this.sparkles.burst(new THREE.Vector3(0, 4, this.hw + 1), 'star', 14, 0.6);
    this.particles.burstConfetti(new THREE.Vector3(2, 3, PLATFORM_MID));
    this.cues.push('cheer');
  }

  dispose(): void {
    const walk = (o: THREE.Object3D): void => {
      if (o.userData.shared) return;
      const m = o as THREE.Mesh;
      if (m.isMesh) m.geometry?.dispose();
      for (const c of o.children) walk(c);
    };
    walk(this.scene);
  }
}
