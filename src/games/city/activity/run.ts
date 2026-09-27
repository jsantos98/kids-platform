// Ambulance (G4): the stretcher run. Two medics push the stretcher from the
// ambulance's open back doors up the street to someone sitting hurt on the
// pavement, lift them on, and run them back — the stretcher rolls by itself
// and the wheel steers it across the street, round the cones, the bins, the
// puddles and a dog trotting across, picking up the hearts floating over
// the road. A bump only wobbles it and slows it a moment; nothing is ever
// lost. At the end the ambulance's doors swing wide and it slides in.
import * as THREE from 'three';
import { rng, type Rng } from '../../../engine/rng.js';
import { t as tr } from '../../../i18n/index.js';
import { spawnVehicle } from '../../../engine/assets.js';
import { person, pet, type Rig } from '../../../engine/rig.js';
import { C, PRIMS as P } from '../../../engine/stage.js';
import { StreetSet, kit, kitSize, cone, marker } from './set.js';
import { wearHat } from './hats.js';
import { ease, type Activity, type ActivityInput, type ActivityState, type CallLook, type SceneCue, type SceneLoop } from './common.js';

const ROAD_Z = 8;
const LANE = 3.4;            // the stretcher steers ±3.4 m across the road
const START_X = -34;         // the ambulance's back doors
const PATIENT_X = 30;
const SPEED = 5.2;           // m/s, rolling by itself
const HALF_W = 0.55, HALF_L = 1.15;

type Kind = 'cone' | 'barrel' | 'box' | 'puddle' | 'dog';
interface Obstacle { kind: Kind; x: number; z: number; r: number; obj: THREE.Object3D; knocked: number; dog?: Rig; phase?: number }
interface Heart { x: number; z: number; obj: THREE.Object3D; taken: boolean }

type Leg = 'out' | 'lift' | 'turn' | 'back' | 'in' | 'done';

function heartShape(): THREE.Shape {
  const s = new THREE.Shape();
  s.moveTo(0, -0.5);
  s.bezierCurveTo(0.1, -0.35, 0.55, -0.1, 0.5, 0.18);
  s.bezierCurveTo(0.46, 0.45, 0.12, 0.5, 0, 0.26);
  s.bezierCurveTo(-0.12, 0.5, -0.46, 0.45, -0.5, 0.18);
  s.bezierCurveTo(-0.55, -0.1, -0.1, -0.35, 0, -0.5);
  return s;
}

export class RunActivity implements Activity {
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  cues: SceneCue[] = [];
  loops = new Set<SceneLoop>(['steps']);
  private set: StreetSet;
  private r: Rng;
  private bed = new THREE.Group();
  private medics: Rig[] = [];
  private patient: Rig;
  private friend: Rig;
  private icon = marker('🆘', 1.5);
  private obstacles: Obstacle[] = [];
  private hearts: Heart[] = [];
  private got = 0;
  private x = START_X + 3;
  private z = ROAD_Z;
  private dir = 1;             // +1 up the street, −1 back
  private yaw = Math.PI / 2;
  private slowT = 0;
  private wobT = 0;
  private leg: Leg = 'out';
  private legT = 0;
  private doors: THREE.Object3D[] = [];
  private camDir = 1;
  private onBed = false;
  private won = false;

  constructor(seed: number, look?: CallLook) {
    const r = this.r = rng(seed);
    const set = this.set = new StreetSet({ seed, roadZ: ROAD_Z, keep: [-3, 3], district: look?.district ?? 'residential', onlookers: 0, parked: 0, bothSides: true });
    this.scene = set.scene;
    this.camera = set.camera;

    // the ambulance, back doors toward the run
    const amb = new THREE.Group();
    amb.position.set(START_X - 3.4, 0, ROAD_Z);
    amb.rotation.y = -Math.PI / 2;
    set.scene.add(amb);
    spawnVehicle('/assets/kenney/ambulance.glb', { len: 5.6 }).then(g => {
      // (a clone: its door nodes are ours to swing; the geometry is the cache's)
      g.userData.shared = true;
      amb.add(g);
      g.traverse(o => { if (/^door-/.test(o.name)) this.doors.push(o); });
    }).catch(() => {});

    // the stretcher: a white mattress on a frame, four wheels
    this.bed.add(P.rbox(0.9, 0.16, 2.1, 0.06, 0xfaf7ef, 0, 0.86, 0));
    this.bed.add(P.box(0.94, 0.06, 2.14, C.blueDeep, 0, 0.76, 0));
    this.bed.add(P.rbox(0.7, 0.14, 0.4, 0.06, 0xffffff, 0, 1.0, -0.78));
    for (const [wx, wz] of [[-0.36, -0.85], [0.36, -0.85], [-0.36, 0.85], [0.36, 0.85]]) {
      this.bed.add(P.cyl(0.03, 0.03, 0.62, 6, C.silver, wx, 0.42, wz));
      this.bed.add(P.cyl(0.1, 0.1, 0.06, 10, 0x3c424c, wx, 0.1, wz, 0, 0, Math.PI / 2));
    }
    set.scene.add(this.bed);
    for (let k = 0; k < 2; k++) {
      const m = set.addRig(wearHat(person(k ? 6 : 3), 'medic'), 0, 0.12, 0);
      m.play('sprint', { speed: 0.9 });
      this.medics.push(m);
    }
    // the patient sitting on the pavement, a friend waving beside them
    this.patient = set.addRig(person(seed % 12, 1.65), PATIENT_X, 0.17, ROAD_Z - 8.2, -Math.PI / 2);
    this.patient.play('sit');
    this.friend = set.addRig(person((seed + 5) % 12, 1.7), PATIENT_X + 1.6, 0.17, ROAD_Z - 8.8, -Math.PI / 2);
    this.friend.play('interact-right', { speed: 1.4 });
    set.scene.add(this.icon);

    // the obstacles up the street, a gap always left, hearts in the gaps
    const barrel = kitSize('sv-barrel', 1), box = kitSize('sv-box-large', 1);
    const hs = heartShape();
    const heartGeo = new THREE.ExtrudeGeometry(hs, { depth: 0.18, bevelEnabled: true, bevelSize: 0.05, bevelThickness: 0.05, bevelSegments: 2 });
    heartGeo.center();
    const heartMat = new THREE.MeshLambertMaterial({ color: 0xf0506e, emissive: 0x7a1026, emissiveIntensity: 0.35 });
    for (let x = START_X + 12; x < PATIENT_X - 6; x += 6.5 + r() * 2.5) {
      const kinds: Kind[] = ['cone', 'cone', 'barrel', 'box', 'puddle', 'dog'];
      const kind = kinds[(r() * kinds.length) | 0];
      const z = ROAD_Z + (r() * 2 - 1) * (LANE - 0.6);
      let obj: THREE.Object3D;
      let rad = 0.45;
      let dog: Rig | undefined;
      if (kind === 'cone') obj = cone(0, 0);
      else if (kind === 'barrel') {
        const s = barrel ? 1.1 / barrel.y : 1;
        obj = kit('sv-barrel', 0, 0.1, 0, r() * 6, s) ?? P.cyl(0.4, 0.4, 1.1, 12, 0x8a6a4a, 0, 0.65, 0);
        rad = 0.5;
      } else if (kind === 'box') {
        const s = box ? 1 / box.y : 1;
        obj = kit('sv-box-large', 0, 0.1, 0, r() * 6, s) ?? P.box(1, 1, 1, 0xb48a5a, 0, 0.6, 0);
        rad = 0.6;
      } else if (kind === 'puddle') {
        const g = new THREE.Group();
        const w = new THREE.Mesh(new THREE.CircleGeometry(1, 20), new THREE.MeshLambertMaterial({ color: 0x7fb6e0, transparent: true, opacity: 0.85 }));
        w.rotation.x = -Math.PI / 2;
        w.scale.set(1.1, 0.7, 1);
        w.position.y = 0.13;
        g.add(w);
        obj = g;
        rad = 0.8;
      } else {
        dog = pet('dog', 0.75);
        dog.play('walk');
        obj = dog.root;
        this.set.rigs.push(dog);
        rad = 0.5;
      }
      obj.position.set(x, 0, z);
      set.scene.add(obj);
      this.obstacles.push({ kind, x, z, r: rad, obj, knocked: 0, dog, phase: r() * 6 });
      // a heart where the obstacle isn't
      const hz = ROAD_Z + (z > ROAD_Z ? -1 : 1) * (0.8 + r() * (LANE - 1.2));
      const h = new THREE.Mesh(heartGeo, heartMat);
      h.castShadow = true;
      h.position.set(x + 3, 1.3, hz);
      set.scene.add(h);
      this.hearts.push({ x: x + 3, z: hz, obj: h, taken: false });
    }
    this.place();
  }

  /** the lane the next stretch of road wants: clear of the next obstacle, onto the next heart */
  aim(): number {
    if (this.leg !== 'out' && this.leg !== 'back') return 0;
    const ahead = (x: number): number => (x - this.x) * this.dir;
    const heart = this.hearts.filter(h => !h.taken && ahead(h.x) > 0.5 && ahead(h.x) < 9).sort((a, b) => ahead(a.x) - ahead(b.x))[0];
    const obs = this.obstacles.filter(o => ahead(o.x) > -1 && ahead(o.x) < 7).sort((a, b) => ahead(a.x) - ahead(b.x))[0];
    let want = heart ? heart.z : this.z;
    if (obs && Math.abs(want - this.zOf(obs)) < obs.r + HALF_W + 0.5) {
      want = this.zOf(obs) > ROAD_Z ? this.zOf(obs) - obs.r - HALF_W - 0.7 : this.zOf(obs) + obs.r + HALF_W + 0.7;
    }
    const lateral = (want - ROAD_Z) / LANE;
    // (screen right is +z looking up the street, −z coming back)
    return Math.max(-1, Math.min(1, lateral * this.dir));
  }

  private zOf(o: Obstacle): number { return o.obj.position.z; }

  private place(): void {
    this.bed.position.set(this.x, 0, this.z);
    const wob = this.wobT > 0 ? Math.sin(this.wobT * 30) * 0.12 * this.wobT : 0;
    this.bed.rotation.set(0, this.yaw + wob, wob * 0.4);
    const fx = Math.sin(this.yaw), fz = Math.cos(this.yaw);
    // a medic at each end, pushing — off to the sides, so the camera behind sees the stretcher
    const sx = fz, sz = -fx;
    this.medics[0].root.position.set(this.x - fx * 1.5 + sx * 0.75, 0.12, this.z - fz * 1.5 + sz * 0.75);
    this.medics[1].root.position.set(this.x + fx * 1.5 - sx * 0.75, 0.12, this.z + fz * 1.5 - sz * 0.75);
    for (const m of this.medics) m.root.rotation.y = this.yaw;
    if (this.onBed) {
      // lying on their back, head on the pillow, feet at the far end
      this.patient.root.position.set(this.x + fx * 0.85, 1.0, this.z + fz * 0.85);
      this.patient.root.rotation.set(-Math.PI / 2, this.yaw + wob, 0, 'YXZ');
    }
  }

  update(dt: number, elapsed: number, inp: ActivityInput): ActivityState {
    this.set.night = inp.night ?? 0;
    this.legT += dt;
    this.slowT = Math.max(0, this.slowT - dt);
    this.wobT = Math.max(0, this.wobT - dt * 1.6);
    const running = this.leg === 'out' || this.leg === 'back';
    if (running) {
      const v = SPEED * (this.slowT > 0 ? 0.4 : 1);
      this.x += v * this.dir * dt;
      // the wheel steers across the road (screen right: +z up the street, −z back)
      const want = ROAD_Z + Math.max(-1, Math.min(1, inp.steer)) * LANE * this.dir;
      const dz = ease(this.z, want, 3.2, dt) - this.z;
      this.z += dz;
      this.yaw = Math.atan2(v * this.dir, dz / Math.max(dt, 1e-4) * 0.6) ;
      // bumps: a wobble and a moment's slowness, the thing knocked aside
      for (const o of this.obstacles) {
        const oz = this.zOf(o);
        if (o.knocked > 0 || Math.abs(o.obj.position.x - this.x) > HALF_L + o.r || Math.abs(oz - this.z) > HALF_W + o.r) continue;
        if (o.kind === 'puddle') {
          this.set.smoke.puff(this.x, 0.4, this.z, 0.8, 0, 0.8);
          this.cues.push('bump');
          o.knocked = 3;
          continue;
        }
        o.knocked = 3;
        this.slowT = 0.8;
        this.wobT = 1;
        this.cues.push(o.kind === 'dog' ? 'bark' : 'bump');
        if (o.dog) o.dog.play('gesture-negative', { loop: false });
      }
      for (const h of this.hearts) {
        if (h.taken || Math.abs(h.x - this.x) > HALF_L + 0.5 || Math.abs(h.z - this.z) > HALF_W + 0.6) continue;
        h.taken = true;
        h.obj.visible = false;
        this.got++;
        this.set.sparkles.burst(h.obj.position.clone(), 'heart', 8, 0.45, 2.6);
        this.cues.push('heart');
      }
      if (this.leg === 'out' && this.x >= PATIENT_X - 2.2) { this.leg = 'lift'; this.legT = 0; }
      if (this.leg === 'back' && this.x <= START_X + 9) { this.leg = 'in'; this.legT = 0; this.cues.push('doors'); }
    } else if (this.leg === 'lift') {
      // pull up beside them; the medics lift them on
      this.z = ease(this.z, ROAD_Z - 5.5, 3, dt);
      this.yaw = ease(this.yaw, Math.PI / 2, 4, dt);
      for (const m of this.medics) if (m.clip !== 'pick-up') m.play('pick-up', { loop: false });
      if (this.legT > 1.1 && !this.onBed) {
        this.onBed = true;
        this.patient.play('static');
        this.cues.push('aboard');
        this.set.sparkles.burst(new THREE.Vector3(this.x, 2, this.z), 'heart', 10, 0.5);
      }
      if (this.legT > 1.8) { this.leg = 'turn'; this.legT = 0; this.friend.play('emote-yes'); }
    } else if (this.leg === 'turn') {
      // swing round for the run back
      const k = Math.min(1, this.legT / 1.1);
      this.yaw = Math.PI / 2 + k * Math.PI;
      if (k >= 1) {
        this.leg = 'back';
        this.legT = 0;
        this.dir = -1;
        for (const m of this.medics) m.play('sprint', { speed: 0.9 });
        // fresh hearts for the run back
        for (const h of this.hearts) { h.taken = false; h.obj.visible = true; }
      }
    } else if (this.leg === 'in') {
      // the doors swing wide and in it rolls, lined up with them
      for (const d of this.doors) d.rotation.y = ease(d.rotation.y, (d.name === 'door-left' ? -1 : 1) * 1.9, 3, dt);
      this.z = ease(this.z, ROAD_Z, 5, dt);
      this.yaw = ease(this.yaw, Math.PI * 1.5, 5, dt);
      this.x -= SPEED * 0.6 * dt;
      if (this.x <= START_X - 1.2) {
        this.leg = 'done';
        for (const m of this.medics) m.play('emote-yes');
        this.cues.push('safe');
      }
    }
    if (this.leg === 'done') this.bed.visible = this.patient.root.visible = this.x > START_X - 1;
    // the knocked things rock back upright, the dog trots across and back
    for (const o of this.obstacles) {
      if (o.knocked > 0) {
        o.knocked = Math.max(0, o.knocked - dt);
        if (o.kind !== 'puddle' && o.kind !== 'dog') o.obj.rotation.z = Math.sin(o.knocked * 9) * 0.4 * (o.knocked / 3);
      }
      if (o.dog) {
        const s = Math.sin(elapsed * 0.6 + (o.phase ?? 0));
        o.obj.position.z = ROAD_Z + s * (LANE + 0.5);
        o.obj.rotation.y = Math.cos(elapsed * 0.6 + (o.phase ?? 0)) > 0 ? 0 : Math.PI;
      }
    }
    for (const h of this.hearts) if (!h.taken) { h.obj.rotation.y = elapsed * 2.5; h.obj.position.y = 1.3 + Math.sin(elapsed * 3 + h.x) * 0.15; }
    this.icon.visible = this.leg === 'out';
    this.icon.position.set(PATIENT_X, 3 + Math.sin(elapsed * 3) * 0.2, ROAD_Z - 8.2);
    this.place();
    // the camera follows behind the stretcher, swinging round for the run back
    if (this.leg === 'lift' || this.leg === 'turn') {
      // at the patient: from the road, looking at them and the stretcher
      this.set.shot({ x: PATIENT_X - 3, y: 4.2, z: ROAD_Z + 5 }, { x: PATIENT_X - 1.5, y: 0.8, z: ROAD_Z - 6.5 });
      this.camDir = this.leg === 'turn' ? -1 : 1;
    } else {
      this.camDir = ease(this.camDir, this.dir, 2.4, dt);
      const side = Math.sqrt(Math.max(0, 1 - this.camDir * this.camDir));
      this.set.shot(
        { x: this.x - this.camDir * 8.5, y: 6.2, z: this.z * 0.4 + ROAD_Z * 0.6 + side * 7 },
        { x: this.x + this.camDir * 6, y: 0.8, z: ROAD_Z },
      );
    }
    this.loops.clear();
    if (running) this.loops.add('steps');
    this.set.update(dt);
    const total = (PATIENT_X - START_X) * 2;
    const done = this.leg === 'out' ? this.x - START_X : this.leg === 'lift' || this.leg === 'turn' ? PATIENT_X - START_X : (PATIENT_X - START_X) + (PATIENT_X - this.x);
    const progress = this.leg === 'done' ? 1 : Math.min(0.99, done / total);
    const prompt = this.leg === 'lift' || this.leg === 'turn' ? tr('scene.runLift')
      : this.leg === 'in' || this.leg === 'done' ? tr('scene.runIn')
      : tr('scene.runHearts', { n: this.got });
    return { progress, prompt, done: this.leg === 'done' };
  }

  celebrate(): void {
    if (this.won) return;
    this.won = true;
    this.friend.play('jump');
    this.set.sparkles.burst(new THREE.Vector3(START_X, 2.5, ROAD_Z), 'heart', 16, 0.6, 4);
    this.set.particles.burstConfetti(new THREE.Vector3(START_X + 2, 1.5, ROAD_Z));
    this.cues.push('cheer');
  }

  dispose(): void {
    this.set.dispose();
  }
}
