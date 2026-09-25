// Winch scene: seen from beside the hovering medical helicopter. A breeze
// sways it left and right; the wheel steers against the sway to keep the hook
// over the person below. While it's over them the hook lowers, they clip on
// and get lifted up; drift off and the winch pauses until you're back.
import * as THREE from 'three';
import { rng } from '../../../engine/rng.js';
import { C, PRIMS as P } from '../../../engine/stage.js';
import { makeHelicopter, makeTree } from '../../../kit/index.js';
import { makeSet, makeHuman, ease, disposeScene, type Activity, type ActivityInput, type ActivityState } from './common.js';
import { t as tr } from '../../../i18n/index.js';

const HOVER_Y = 11;
const OVER = 0.9;        // hook within this of the person counts
const LIFT = 3.2;        // seconds of winching

export class WinchActivity implements Activity {
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  private heli: THREE.Group;
  private line: THREE.Mesh;
  private hook: THREE.Mesh;
  private who: THREE.Object3D;
  private x = 0;
  private personX: number;
  private windA: number;
  private windF: number;
  private t = 0;
  private particles;

  constructor(seed: number) {
    const r = rng(seed);
    const set = makeSet(7);
    this.scene = set.scene;
    this.camera = set.camera;
    this.particles = set.particles;
    this.personX = (r() - 0.5) * 3;
    this.windA = 1.8 + r() * 1.2;
    this.windF = 0.5 + r() * 0.3;
    // a little meadow with trees around the person
    for (let k = 0; k < 6; k++) {
      const t = makeTree(r, 2.2);
      t.position.set(-12 + k * 4.8 + r() * 2, 0, -6 - r() * 5);
      this.scene.add(t);
    }
    this.who = makeHuman(1);
    this.who.position.set(this.personX, 0.05, 0);
    this.scene.add(this.who);
    this.scene.add(P.cyl(1.3, 1.3, 0.04, 20, C.white, this.personX, 0.04, 0)); // landing X mat
    this.heli = makeHelicopter({ body: C.white, band: C.red });
    this.heli.scale.setScalar(1.5);
    this.heli.rotation.y = Math.PI / 2;
    this.scene.add(this.heli);
    this.line = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, 1, 6), new THREE.MeshLambertMaterial({ color: C.dark }));
    this.hook = new THREE.Mesh(new THREE.TorusGeometry(0.25, 0.08, 6, 12, Math.PI * 1.5), new THREE.MeshLambertMaterial({ color: C.red }));
    this.scene.add(this.line, this.hook);
    this.camera.position.set(0, 7.5, 21);
    this.camera.lookAt(0, 6.2, 0);
  }

  update(dt: number, elapsed: number, inp: ActivityInput): ActivityState {
    // the breeze pushes, the wheel pushes back
    const wind = Math.sin(elapsed * this.windF) * this.windA + Math.sin(elapsed * this.windF * 2.7) * 0.6;
    this.x = ease(this.x, this.personX + wind + inp.steer * 4, 2.2, dt);
    this.heli.position.set(this.x, HOVER_Y + Math.sin(elapsed * 1.3) * 0.2, 0);
    this.heli.rotation.z = (this.personX + wind + inp.steer * 4 - this.x) * -0.05;
    (this.heli.userData.mainRotor as THREE.Object3D).rotation.y = elapsed * 22;
    const over = Math.abs(this.x - this.personX) < OVER;
    if (over) this.t = Math.min(1, this.t + dt / LIFT);
    // the hook hangs straight down from the door; the line pays out to the
    // person while lowering (t < 0.5) and reels them up after
    const low = this.t < 0.5 ? this.t * 2 : 1 - (this.t - 0.5) * 2;
    const hookY = HOVER_Y + 1 - low * (HOVER_Y + 1 - 1.6);
    const len = HOVER_Y + 2.1 - hookY;
    this.line.scale.y = len;
    this.line.position.set(this.x, hookY + len / 2, 0.6);
    this.hook.position.set(this.x, hookY - 0.2, 0.6);
    if (this.t >= 0.5) this.who.position.set(this.x, hookY - 1.7, 0.4);
    this.particles.update(dt);
    const prompt = this.t >= 0.5 ? tr('scene.winchLift') : over ? tr('scene.winchLower') : tr('scene.winchOver');
    return { progress: this.t, prompt, done: this.t >= 1 };
  }

  celebrate(): void {
    this.particles.burstConfetti(new THREE.Vector3(this.x, HOVER_Y - 1, 0.6));
  }

  dispose(): void {
    disposeScene(this.scene);
  }
}
