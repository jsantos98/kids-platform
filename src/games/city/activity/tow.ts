// The tow (G17, G4): a car has broken down at the kerb — bonnet up, hazard
// lamps blinking, a wisp of steam — and its driver waves the tow truck in.
// The tow truck (the Car Kit's red flatbed, the one in the traffic) backs up
// to it by itself and drops its ramps; the winch reels the car up onto the
// bed. The car's flat tyre pulls it off to one side in gusts, and the wheel
// steers it back into line (the camera looks along the street from behind
// the car, so right on the wheel is right on screen): out of line the winch
// waits and the car wobbles — it never drains and the car never falls off.
// Once its front wheels are on the ramps they guide it home; the straps
// click, the driver hops into the cab and the crowd cheers.
import * as THREE from 'three';
import { rng, type Rng } from '../../../engine/rng.js';
import { t as tr } from '../../../i18n/index.js';
import { person, type Rig } from '../../../engine/rig.js';
import { PRIMS as P } from '../../../engine/stage.js';
import { spawnVehicle } from '../../../engine/assets.js';
import { StreetSet, kit, kitSize, marker } from './set.js';
import { pickOf, type Activity, type ActivityInput, type ActivityState, type CallLook, type SceneCue, type SceneLoop } from './common.js';

const ROAD_Z = 8;
/** the kerb lane the car pulled over in */
const LANE_Z = ROAD_Z - 3.2;
/** the flatbed: its length, its bed's height, where the bed ends behind its middle */
export const TOW_LEN = 6.8;
const BED_Y = 1.05, BED_REAR = -3.3, BED_MID = -1.55, RAMP_RUN = 3.1;
/** the tow truck stops with its middle here */
const TRUCK_X = 3;
const CAR_L = 3.7;
const CAR_X0 = -12;
/** how far off line the winch still pulls at full speed, and at all */
const TRUE_DZ = 0.6, SLOW_DZ = 0.9;
const CARS = ['car-sedan', 'car-suv', 'car-taxi', 'car-hatch'];

type Phase = 'back' | 'ramps' | 'pull' | 'strap' | 'done';

export class TowActivity implements Activity {
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  cues: SceneCue[] = [];
  loops = new Set<SceneLoop>();
  private set: StreetSet;
  private r: Rng;
  private truck = new THREE.Group();
  private car = new THREE.Group();
  private ramps: THREE.Group[] = [];
  private cable: THREE.Mesh;
  private lamps: THREE.Mesh[] = [];
  private driver: Rig;
  private icon = marker('🚗', 1.2);
  private phase: Phase = 'back';
  private t = 0;
  private truckX = TRUCK_X + 9;
  private carX = CAR_X0;
  private dz = 0.2;
  private gust = 0;
  private gustSide = 1;
  private gustT = 0;
  private progress = 0;
  private won = false;
  private steamT = 0;
  private wasOff = false;
  /** where the car ends up on the bed, and where the ramps start */
  private readonly carEnd = TRUCK_X + BED_MID;
  private readonly rampFoot = TRUCK_X + BED_REAR - RAMP_RUN;

  constructor(seed: number, look?: CallLook) {
    const r = this.r = rng(seed * 31 + 5);
    this.gustSide = r() < 0.5 ? -1 : 1;
    const set = this.set = new StreetSet({ seed, roadZ: ROAD_Z, keep: [-18, 10], district: look?.district ?? 'urban', onlookers: 3, crowdX: -2, parked: 0, bothSides: true });
    this.scene = set.scene;
    this.camera = set.camera;

    // the tow truck, heading +x (the Car Kit models face +z)
    this.truck.position.set(this.truckX, 0, LANE_Z);
    this.truck.rotation.y = Math.PI / 2;
    // (a stand-in until the model streams in — and in the node check)
    const stand = new THREE.Group();
    stand.add(P.box(2.1, 0.5, TOW_LEN - 0.4, 0x4b505c, 0, 0.8, 0));
    stand.add(P.box(2.1, 1.6, 2.2, 0xd8503a, 0, 1.5, TOW_LEN / 2 - 1.3));
    this.truck.add(stand);
    spawnVehicle('/assets/kenney/delivery-flat.glb', { len: TOW_LEN }).then(g => {
      g.userData.shared = true;
      this.truck.remove(stand);
      this.truck.add(g);
    }).catch(() => {});
    // an amber beacon on the cab (a work truck's, G17)
    const beacon = P.box(0.9, 0.18, 0.3, 0xffb030, 0, 2.95, TOW_LEN / 2 - 1.6);
    this.lamps.push(beacon);
    this.truck.add(beacon);
    set.scene.add(this.truck);
    // the ramps: two planks hinged at the bed's end, folded up until it stops
    for (const side of [-0.62, 0.62]) {
      const pivot = new THREE.Group();
      const plank = P.box(RAMP_RUN + 0.3, 0.1, 0.55, 0x8a8f99, -(RAMP_RUN + 0.3) / 2, 0, 0);
      pivot.add(plank);
      pivot.position.set(TRUCK_X + BED_REAR, BED_Y, LANE_Z + side);
      pivot.rotation.z = -1.3;
      pivot.visible = false;
      set.scene.add(pivot);
      this.ramps.push(pivot);
    }
    // the winch's cable, from the drum behind the cab to the car's nose
    this.cable = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, 1, 6), new THREE.MeshLambertMaterial({ color: 0x3a3f48 }));
    this.cable.visible = false;
    set.scene.add(this.cable);

    // the broken-down car: the call's own, bonnet up, hazard lamps
    const name = look?.kind === 'car' && look.model ? look.model : pickOf(r, CARS);
    const sz = kitSize(name, 1);
    const m = kit(name, 0, 0.02, 0, Math.PI / 2, sz ? CAR_L / Math.max(sz.x, sz.z) : 1);
    if (m) { m.castShadow = true; this.car.add(m); }
    else this.car.add(P.box(CAR_L, 1.2, 1.8, 0x7fb2d9, 0, 0.7, 0));
    const hood = P.box(1.0, 0.06, 1.5, 0xe8e2d6, CAR_L / 2 - 0.75, 1.25, 0);
    hood.rotation.z = 0.9;
    this.car.add(hood);
    for (const [x, z] of [[CAR_L / 2 - 0.05, 0.72], [CAR_L / 2 - 0.05, -0.72], [-CAR_L / 2 + 0.05, 0.72], [-CAR_L / 2 + 0.05, -0.72]]) {
      const l = new THREE.Mesh(new THREE.SphereGeometry(0.13, 8, 6), new THREE.MeshBasicMaterial({ color: 0xffa21f }));
      l.position.set(x, 0.75, z);
      this.car.add(l);
      this.lamps.push(l);
    }
    set.scene.add(this.car);
    set.scene.add(this.icon);

    // its driver on the pavement, waving the tow truck down
    this.driver = set.addRig(person((seed + 2) % 12, 1.7), CAR_X0 + 2.5, 0.17, ROAD_Z - 8.3, Math.PI / 2);
    this.driver.play('interact-right', { speed: 1.4 });
    this.place();
  }

  aim(): number {
    if (this.phase !== 'pull') return 0;
    // (the steer that brings it back to the middle, against the gust)
    return Math.max(-1, Math.min(1, (-this.dz * 2.2 - this.gust) / 1.6));
  }

  /** the road under the car at x: flat, up the ramps, the bed */
  private groundAt(x: number): number {
    const top = TRUCK_X + BED_REAR;
    if (x <= this.rampFoot) return 0;
    if (x >= top) return BED_Y;
    return ((x - this.rampFoot) / (top - this.rampFoot)) * BED_Y;
  }

  private place(): void {
    const yf = this.groundAt(this.carX + 1.25), yr = this.groundAt(this.carX - 1.25);
    this.car.position.set(this.carX, (yf + yr) / 2, LANE_Z + this.dz);
    this.car.rotation.set(0, 0, 0);
    this.car.rotation.z = Math.atan2(yf - yr, 2.5);
  }

  update(dt: number, elapsed: number, inp: ActivityInput): ActivityState {
    this.set.night = inp.night ?? 0;
    this.t += dt;
    const steer = Math.max(-1, Math.min(1, inp.steer));
    this.loops.clear();
    let wobble = 0;
    if (this.phase === 'back') {
      // the tow truck backs up to the car by itself
      this.truckX = Math.max(TRUCK_X, this.truckX - dt * 4);
      this.progress = 0.08 * (1 - (this.truckX - TRUCK_X) / 9);
      if (this.truckX <= TRUCK_X) { this.phase = 'ramps'; this.t = 0; this.cues.push('clank'); }
    } else if (this.phase === 'ramps') {
      const f = Math.min(1, this.t / 0.8);
      for (const p of this.ramps) { p.visible = true; p.rotation.z = -1.3 + (1.3 + Math.atan2(BED_Y, RAMP_RUN)) * f; }
      this.progress = 0.1;
      if (f >= 1) { this.phase = 'pull'; this.t = 0; this.cable.visible = true; }
    } else if (this.phase === 'pull') {
      // the flat tyre pulls it aside in gusts; the wheel steers it back
      const onRamp = this.carX + CAR_L / 2 > this.rampFoot;
      this.gustT -= dt;
      if (this.gustT <= 0) {
        this.gustT = 1.8 + this.r() * 1.4;
        // (a flat tyre: it keeps pulling the same way a while, now and then the other)
        this.gustSide = this.r() < 0.2 ? -this.gustSide : this.gustSide;
        this.gust = this.gustSide * (0.5 + this.r() * 0.3);
      }
      if (onRamp) this.dz += (0 - this.dz) * Math.min(1, dt * 3);
      else {
        this.dz += (this.gust + steer * 1.6) * dt;
        this.dz = Math.max(-1.4, Math.min(1.4, this.dz));
      }
      const off = Math.abs(this.dz);
      const speed = onRamp || off < TRUE_DZ ? 1.25 : off < SLOW_DZ ? 0.3 : 0;
      this.carX = Math.min(this.carEnd, this.carX + speed * dt);
      if (speed === 0) wobble = Math.sin(elapsed * 14) * 0.03;
      // (off its line: the narrator says keep it in the middle)
      if (off > SLOW_DZ && !this.wasOff) this.cues.push('drift');
      this.wasOff = off > SLOW_DZ;
      if (speed > 0) this.loops.add('winch');
      this.progress = 0.1 + 0.85 * (this.carX - CAR_X0) / (this.carEnd - CAR_X0);
      if (this.carX >= this.carEnd) { this.phase = 'strap'; this.t = 0; this.cues.push('strap'); }
    } else if (this.phase === 'strap') {
      this.progress = 0.97;
      for (const p of this.ramps) p.rotation.z = Math.atan2(BED_Y, RAMP_RUN) - 1.4 * Math.min(1, this.t / 0.6) - 0.1;
      if (this.t > 0.7) {
        for (const p of this.ramps) p.visible = false;
        this.cable.visible = false;
        this.phase = 'done';
        this.progress = 1;
        this.driver.play('walk');
        this.cues.push('safe');
      }
    } else {
      // the driver walks to the cab and hops in
      const p = this.driver.root.position, tx = TRUCK_X + 2.6, tz = LANE_Z - 1.5;
      const dx = tx - p.x, dz = tz - p.z, d = Math.hypot(dx, dz);
      if (d > 0.3) { p.x += (dx / d) * Math.min(d, dt * 2.4); p.z += (dz / d) * Math.min(d, dt * 2.4); this.driver.root.rotation.y = Math.atan2(dx, dz); }
      else this.driver.root.visible = false;
    }
    this.truck.position.x = this.truckX;
    this.place();
    this.car.rotation.x = wobble;
    // the cable: drum to nose
    if (this.cable.visible) {
      const a = new THREE.Vector3(this.truckX + 0.2, BED_Y + 0.55, LANE_Z);
      const b = new THREE.Vector3(this.carX + CAR_L / 2, this.car.position.y + 0.55, this.car.position.z);
      const mid = a.clone().add(b).multiplyScalar(0.5), len = a.distanceTo(b);
      this.cable.position.copy(mid);
      this.cable.scale.set(1, len, 1);
      this.cable.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), b.clone().sub(a).normalize());
    }
    // the hazard lamps and the beacon blink
    const on = Math.floor(elapsed * 2.5) % 2 === 0;
    for (const l of this.lamps) (l.material as THREE.MeshBasicMaterial).color.setHex(on ? 0xffb030 : 0x6b4410);
    this.steamT -= dt;
    if (this.steamT <= 0 && this.phase !== 'done') {
      this.steamT = 0.35;
      this.set.smoke.puff(this.carX + CAR_L / 2 - 0.6, this.car.position.y + 1.3, this.car.position.z, 0.5, 0, 1.1);
    }
    this.icon.visible = this.phase !== 'done';
    this.icon.position.set(this.carX, this.car.position.y + 2.6 + Math.sin(elapsed * 3) * 0.15, this.car.position.z);
    // the camera: behind the car, looking up the street at the truck
    const cx = Math.min(this.carX, this.carEnd - 4);
    this.set.shot({ x: cx - 7.5, y: 4.2, z: LANE_Z - 0.8 }, { x: cx + 5, y: 1.3, z: LANE_Z });
    this.set.update(dt);
    const prompt = this.phase === 'back' || this.phase === 'ramps' ? tr('scene.tow.back')
      : this.phase === 'pull' ? tr('scene.tow.winch') : tr('scene.tow.done');
    return { progress: this.progress, prompt, done: this.phase === 'done' };
  }

  celebrate(): void {
    if (this.won) return;
    this.won = true;
    this.set.cheer(3);
    this.set.sparkles.burst(this.car.position.clone().add(new THREE.Vector3(0, 2, 0)), 'star', 14, 0.6);
    this.set.particles.burstConfetti(this.car.position.clone().add(new THREE.Vector3(0, 1.5, 0)));
    this.set.pushIn({ x: this.carX - 4, y: 3.6, z: LANE_Z - 1 });
    this.cues.push('cheer');
  }

  dispose(): void {
    this.set.dispose();
  }
}
