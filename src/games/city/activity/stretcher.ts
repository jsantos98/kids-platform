// Ambulance scene: the injured person lies on a stretcher that rolls away
// from the camera toward the ambulance's open back doors by itself. The wheel
// steers the stretcher left and right to line it up with the doors; miss, and
// it bumps gently and rolls back for another go.
import * as THREE from 'three';
import { rng } from '../../../engine/rng.js';
import { spawnVehicle } from '../../../engine/assets.js';
import { C, PRIMS as P } from '../../../engine/stage.js';
import { makeSet, makeHuman, ease, disposeScene, type Activity, type ActivityInput, type ActivityState } from './common.js';

const START_Z = 9, DOOR_Z = -1.5;
const SPEED = 1.7;       // m/s the stretcher rolls
const FIT = 0.45;        // sideways tolerance at the doors
const RANGE = 2.4;       // steer reach either side

export class StretcherActivity implements Activity {
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  private bed = new THREE.Group();
  private z = START_Z;
  private x = 0;
  private doorX: number;
  private state: 'roll' | 'bump' | 'in' = 'roll';
  private bumpT = 0;
  private particles;

  constructor(seed: number) {
    const r = rng(seed);
    const set = makeSet(-4);
    this.scene = set.scene;
    this.camera = set.camera;
    this.particles = set.particles;
    // the doors sit a little left or right: the kid must steer to them
    this.doorX = (r() < 0.5 ? -1 : 1) * (0.9 + r() * 0.9);
    // the ambulance faces away from the camera, back doors toward the stretcher
    const amb = new THREE.Group();
    amb.position.set(this.doorX, 0, DOOR_Z - 3.1);
    amb.rotation.y = Math.PI;
    this.scene.add(amb);
    spawnVehicle('/assets/kenney/ambulance.glb', { len: 5.4 }).then(g => {
      g.userData.shared = true;
      amb.add(g);
    }).catch(() => {});
    // a glowing mat behind the doors shows where to aim
    const mat = new THREE.Mesh(new THREE.PlaneGeometry(1.3, 1.8), new THREE.MeshBasicMaterial({ color: 0xffd35c, transparent: true, opacity: 0.55 }));
    mat.rotation.x = -Math.PI / 2;
    mat.position.set(this.doorX, 0.05, DOOR_Z + 0.6);
    this.scene.add(mat);
    // the stretcher (long axis along z) with its patient lying down
    this.bed.add(P.box(0.8, 0.12, 2.1, C.white, 0, 0.8, 0));
    this.bed.add(P.box(0.84, 0.08, 2.1, C.blue, 0, 0.88, 0));
    for (const [wx, wz] of [[-0.35, -0.9], [0.35, -0.9], [-0.35, 0.9], [0.35, 0.9]]) {
      this.bed.add(P.cyl(0.03, 0.03, 0.7, 6, C.silver, wx, 0.42, wz));
      this.bed.add(P.sphere(0.09, C.dark, wx, 0.09, wz));
    }
    const who = makeHuman(3);
    who.rotation.set(-Math.PI / 2, 0, 0);
    who.position.set(0, 0.95, 0.8);
    this.bed.add(who);
    this.scene.add(this.bed);
    this.camera.position.set(0, 5.2, 11.5);
    this.camera.lookAt(0, 0.8, -1.5);
  }

  update(dt: number, elapsed: number, inp: ActivityInput): ActivityState {
    if (this.state !== 'in') this.x = ease(this.x, inp.steer * RANGE, 3, dt);
    if (this.state === 'roll') {
      this.z -= SPEED * dt;
      if (this.z <= DOOR_Z + 1.2) {
        if (Math.abs(this.x - this.doorX) < FIT) this.state = 'in';
        else { this.state = 'bump'; this.bumpT = 0; }
      }
    } else if (this.state === 'bump') {
      // a gentle bonk, then roll back to the start
      this.bumpT += dt;
      this.z = Math.min(START_Z, this.z + SPEED * 2.2 * dt);
      if (this.z >= START_Z - 0.01) this.state = 'roll';
    } else {
      // slide in between the doors
      this.z = Math.max(DOOR_Z - 1.4, this.z - SPEED * dt);
      this.x = ease(this.x, this.doorX, 6, dt);
    }
    this.bed.position.set(this.x, 0, this.z);
    this.bed.rotation.x = this.state === 'bump' && this.bumpT < 0.3 ? Math.sin(this.bumpT * 40) * 0.05 : 0;
    this.particles.update(dt);
    const progress = this.state === 'in' ? 1 : Math.max(0, (START_Z - this.z) / (START_Z - DOOR_Z - 1.2)) * 0.95;
    const prompt = this.state === 'bump' ? 'OOPS! TRY AGAIN!' : 'STEER INTO THE AMBULANCE!';
    return { progress, prompt, done: this.state === 'in' && this.z <= DOOR_Z - 1.3 };
  }

  celebrate(): void {
    this.particles.burstConfetti(new THREE.Vector3(this.doorX, 1, DOOR_Z));
  }

  dispose(): void {
    disposeScene(this.scene);
  }
}
