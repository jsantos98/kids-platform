// Hose scene: the fire truck faces a burning house, tree or car. The wheel
// swings the hose left and right; up and down bounces by itself, sweeping
// every flame height — so the kid only has to steer onto the flames.
import * as THREE from 'three';
import { rng, type Rng } from '../../../engine/rng.js';
import { spawnVehicle } from '../../../engine/assets.js';
import { C, PRIMS as P } from '../../../engine/stage.js';
import { makeHouse, makeTree, makeCar } from '../../../kit/index.js';
import { makeSet, Flame, WaterJet, ease, disposeScene, type Activity, type ActivityInput, type ActivityState } from './common.js';

export type FireVariant = 'house' | 'tree' | 'car';

const TARGET_Z = -8;       // the burning thing stands this far up the lot
// generous: little hands sweep, they don't aim
const HIT_X = 1.3, HIT_Y = 1.3;

/** n flame spots spread over a rectangle, at least 1.4 m apart (rejection
 * sampled so a fire always has its full count) */
function scatter(r: Rng, n: number, x0: number, x1: number, y0: number, y1: number): Array<[number, number]> {
  const out: Array<[number, number]> = [];
  for (let tries = 0; tries < 80 && out.length < n; tries++) {
    const p: [number, number] = [x0 + r() * (x1 - x0), y0 + r() * (y1 - y0)];
    if (out.every(o => Math.hypot(o[0] - p[0], o[1] - p[1]) > 1.4)) out.push(p);
  }
  return out;
}

export class HoseActivity implements Activity {
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  pumping = true;
  private flames: Flame[] = [];
  private jet: WaterJet;
  private aimX = 0;
  private range: number;           // half-width the hose can reach
  private yMid: number;            // centre + amplitude of the auto bounce
  private yAmp: number;
  private particles;
  private nozzle = new THREE.Vector3(0, 3.1, 6.6);

  constructor(seed: number, readonly variant: FireVariant) {
    const r: Rng = rng(seed);
    const set = makeSet(9);
    this.scene = set.scene;
    this.camera = set.camera;
    this.particles = set.particles;

    // the truck, back to camera, parked on the road in the foreground
    const truck = new THREE.Group();
    truck.position.set(0, 0, 9);
    truck.rotation.y = Math.PI;
    this.scene.add(truck);
    spawnVehicle('/assets/kenney/firetruck.glb', { len: 6.6 }).then(g => {
      g.userData.shared = true;
      truck.add(g);
    }).catch(() => {});

    // the burning thing and where its flames sit (x across, y up)
    let spots: Array<[number, number]> = [];
    if (variant === 'house') {
      const body = [C.pink, C.yellow, C.blue, C.cream][(r() * 4) | 0];
      const house = makeHouse({ w: 8, d: 5, h: 4.4, body, roof: C.purple, windows: 3, chimney: true });
      house.position.set(0, 0, TARGET_Z - 2.5);
      this.scene.add(house);
      spots = scatter(r, 6, -3.4, 3.4, 0.8, 5);
    } else if (variant === 'tree') {
      const tree = makeTree(r, 4.2);
      tree.rotation.y = 0;
      tree.position.set(0, 0, TARGET_Z);
      this.scene.add(tree);
      spots = scatter(r, 5, -2.8, 2.8, 3, 6.4);
    } else {
      const car = new THREE.Group();
      car.position.set(0, 0, TARGET_Z + 1);
      car.rotation.y = Math.PI / 2;
      car.add(makeCar({ body: C.blue }));
      car.scale.setScalar(1.25);
      this.scene.add(car);
      spots = scatter(r, 4, -2.6, 2.6, 0.9, 2.1);
    }
    spots.forEach(([x, y], k) => {
      const f = new Flame(x, y, TARGET_Z + 0.4, variant === 'car' ? 0.9 : 1.1, k);
      this.flames.push(f);
      this.scene.add(f.group);
    });
    const ys = spots.map(s => s[1]);
    const lo = Math.min(...ys), hi = Math.max(...ys);
    this.yMid = (lo + hi) / 2;
    this.yAmp = Math.max(0.6, (hi - lo) / 2 + 0.3);
    this.range = Math.max(...spots.map(s => Math.abs(s[0]))) + 0.6;
    // smoke
    for (let k = 0; k < 4; k++) {
      const puff = P.sphere(0.8 + k * 0.3, C.smoke, (r() - 0.5) * 2, 6 + k * 1.6, TARGET_Z, { transparent: true, opacity: 0.35 });
      puff.userData.smoke = k;
      puff.castShadow = false;
      this.scene.add(puff);
    }
    this.jet = new WaterJet(this.scene);

    this.camera.position.set(0, 7.2, 19);
    this.camera.lookAt(0, 2.6, TARGET_Z);
  }

  update(dt: number, elapsed: number, inp: ActivityInput): ActivityState {
    // the wheel points the hose; keys ease it there too
    this.aimX = ease(this.aimX, inp.steer * this.range, 4, dt);
    // up/down bounces by itself across every flame's height
    const aimY = this.yMid + this.yAmp * Math.sin(elapsed * 1.9);
    const target = new THREE.Vector3(this.aimX, aimY, TARGET_Z + 0.5);
    // the stream douses the one burning flame it's closest to
    let hit: Flame | null = null, best = Infinity;
    for (const f of this.flames) {
      f.update(elapsed);
      if (f.health <= 0 || Math.abs(f.x - this.aimX) >= HIT_X || Math.abs(f.y - aimY) >= HIT_Y) continue;
      const dd = Math.hypot(f.x - this.aimX, f.y - aimY);
      if (dd < best) { best = dd; hit = f; }
    }
    if (hit) hit.health = Math.max(0, hit.health - dt / 0.5);
    const hitting = !!hit;
    const left = this.flames.reduce((s, f) => s + f.health, 0);
    const progress = 1 - left / this.flames.length;
    if (progress < 0.999) this.jet.update(elapsed, this.nozzle, target, hitting);
    else this.jet.hide();
    this.scene.traverse(o => {
      if (o.userData.smoke === undefined) return;
      const m = (o as THREE.Mesh).material as THREE.MeshLambertMaterial;
      m.opacity = 0.35 * (1 - progress);
      o.position.y = 6 + o.userData.smoke * 1.6 + Math.sin(elapsed * 0.7 + o.userData.smoke) * 0.4;
    });
    this.particles.update(dt);
    return { progress, prompt: 'SPRAY THE FIRE!', done: progress >= 0.999 };
  }

  celebrate(): void {
    this.pumping = false;
    this.particles.burstConfetti(new THREE.Vector3(0, 2, TARGET_Z + 2));
  }

  dispose(): void {
    disposeScene(this.scene);
  }
}
