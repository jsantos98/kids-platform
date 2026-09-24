// Cat rescue scene: a cat stuck up a tree or on a building's window ledge.
// The wheel slides the ladder left and right. Once the ladder is under the
// cat it locks and the cat climbs down — but if the ladder moves away again
// (past a small threshold) the cat takes fright, jumps to another spot and
// the rescue starts over.
import * as THREE from 'three';
import { rng, type Rng } from '../../../engine/rng.js';
import { C, PRIMS as P } from '../../../engine/stage.js';
import { makeSet, makeCat, ease, disposeScene, type Activity, type ActivityInput, type ActivityState } from './common.js';

export type CatVariant = 'tree' | 'building';

const LOCK = 0.5;    // ladder within this of the cat: it starts climbing
const SLIP = 0.6;    // ladder moved this far from the lock point: cat jumps
const CLIMB = 2.2;   // seconds to climb all the way down
const RANGE = 4.2;   // ladder slides +-4.2 m

function makeLadder(height: number): THREE.Group {
  const g = new THREE.Group();
  const railM = new THREE.MeshLambertMaterial({ color: 0xd9dde2 });
  const rungM = new THREE.MeshLambertMaterial({ color: 0xe25c5c });
  for (const x of [-0.32, 0.32]) {
    const rail = new THREE.Mesh(new THREE.BoxGeometry(0.1, height, 0.1), railM);
    rail.position.set(x, height / 2, 0);
    rail.castShadow = true;
    g.add(rail);
  }
  for (let y = 0.35; y < height - 0.1; y += 0.4) {
    const rung = new THREE.Mesh(new THREE.BoxGeometry(0.64, 0.07, 0.07), rungM);
    rung.position.set(0, y, 0);
    g.add(rung);
  }
  return g;
}

export class CatLadderActivity implements Activity {
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  private r: Rng;
  private spots: Array<{ x: number; y: number }> = [];
  private spot = 0;
  private cat: THREE.Object3D;
  private ladder: THREE.Group;
  private ladderX = 0;
  private state: 'seek' | 'climb' | 'jump' = 'seek';
  private lockX = 0;
  private progress = 0;
  private jumpT = 0;
  private jumpFrom = new THREE.Vector3();
  private jumpTo = new THREE.Vector3();
  private oops = 0;
  private particles;
  private topY: number;

  constructor(seed: number, readonly variant: CatVariant) {
    this.r = rng(seed);
    const set = makeSet(5.5);
    this.scene = set.scene;
    this.camera = set.camera;
    this.particles = set.particles;

    if (variant === 'tree') {
      // one big tree with branches reaching both ways
      this.scene.add(P.cyl(0.45, 0.65, 5.2, 10, C.brown, 0, 2.6, -1.4));
      for (const [x, y, rz] of [[-2.1, 3.6, 0.25], [2.1, 3.9, -0.25], [-3.3, 4.4, 0.15], [3.2, 3.3, -0.15]] as const) {
        const b = P.box(Math.abs(x) * 1.3, 0.28, 0.3, C.brown, x / 2, y - 0.2, -1.1);
        b.rotation.z = rz;
        this.scene.add(b);
        this.spots.push({ x, y });
      }
      for (const [x, y, s] of [[0, 6.6, 2.6], [-2.4, 5.6, 1.9], [2.5, 5.4, 1.9], [0, 5.2, 2.2]] as const) {
        this.scene.add(P.sphere(s, C.leaf, x, y, -1.6));
      }
    } else {
      // a two-storey house front; the cat sits on an upstairs window ledge
      this.scene.add(P.box(10, 6.2, 5, C.cream, 0, 3.1, -3.6));
      this.scene.add(P.box(10.6, 0.5, 5.6, C.red, 0, 6.45, -3.6));
      for (const x of [-3.3, -1.1, 1.1, 3.3]) {
        for (const y of [1.6, 4.4]) {
          this.scene.add(P.box(1.2, 1.3, 0.1, C.glass, x, y, -1.05));
          this.scene.add(P.box(1.5, 0.14, 0.45, C.white, x, y - 0.72, -0.95));
        }
        this.spots.push({ x, y: 3.9 });
      }
      this.scene.add(P.box(1.2, 2.2, 0.1, C.brown, 0, 1.1, -1.05));
    }
    // start somewhere the ladder isn't
    this.spot = 1 + ((this.r() * (this.spots.length - 1)) | 0);
    this.topY = Math.max(...this.spots.map(s => s.y));
    this.ladder = makeLadder(this.topY + 0.4);
    this.ladder.position.set(0, 0, -0.5);
    this.ladder.rotation.x = -0.08;
    this.scene.add(this.ladder);
    this.cat = makeCat();
    const s0 = this.spots[this.spot];
    this.cat.position.set(s0.x, s0.y, -0.9);
    this.scene.add(this.cat);

    this.camera.position.set(0, 3.8, 13);
    this.camera.lookAt(0, 3, -1);
  }

  update(dt: number, elapsed: number, inp: ActivityInput): ActivityState {
    this.ladderX = ease(this.ladderX, inp.steer * RANGE, 4, dt);
    this.ladder.position.x = this.ladderX;
    const s = this.spots[this.spot];
    this.oops = Math.max(0, this.oops - dt);

    if (this.state === 'seek') {
      // wiggle: the cat waits, tail flicking
      this.cat.position.set(s.x, s.y, -0.9);
      this.cat.rotation.y = Math.sin(elapsed * 2) * 0.3;
      if (Math.abs(this.ladderX - s.x) < LOCK) {
        this.state = 'climb';
        this.lockX = this.ladderX;
      }
    } else if (this.state === 'climb') {
      if (Math.abs(this.ladderX - this.lockX) > SLIP) {
        // the ladder wobbled away: the cat jumps to a fresh spot
        const far = this.spots.map((p, k) => ({ p, k })).filter(({ p, k }) => k !== this.spot && Math.abs(p.x - this.ladderX) > 2.5);
        const pick = far.length ? far[(this.r() * far.length) | 0] : { k: (this.spot + 1) % this.spots.length };
        this.jumpFrom.copy(this.cat.position);
        this.spot = pick.k;
        const t = this.spots[this.spot];
        this.jumpTo.set(t.x, t.y, -0.9);
        this.jumpT = 0;
        this.state = 'jump';
        this.progress = 0;
        this.oops = 1.6;
      } else {
        this.progress = Math.min(1, this.progress + dt / CLIMB);
        // down the ladder, rung by rung
        this.cat.position.set(this.lockX, s.y - this.progress * (s.y - 0.25), -0.6);
        this.cat.rotation.y = Math.PI;
      }
    } else {
      this.jumpT += dt / 0.8;
      const t = Math.min(1, this.jumpT);
      this.cat.position.lerpVectors(this.jumpFrom, this.jumpTo, t);
      this.cat.position.y += Math.sin(t * Math.PI) * 1.4;
      if (t >= 1) this.state = 'seek';
    }
    this.particles.update(dt);
    const prompt = this.oops > 0 ? 'OOPS! HOLD THE LADDER STILL!'
      : this.state === 'climb' ? 'HOLD STILL…' : 'MOVE THE LADDER TO THE CAT!';
    return { progress: this.progress, prompt, done: this.progress >= 1 };
  }

  celebrate(): void {
    this.particles.burstConfetti(new THREE.Vector3(this.lockX, 0.5, 0));
  }

  dispose(): void {
    disposeScene(this.scene);
  }
}
