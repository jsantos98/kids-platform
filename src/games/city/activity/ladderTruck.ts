// The fire truck's aerial ladder (G4): the Kenney fire truck with a turntable
// on its back, a three-section telescoping ladder boom (silver rails, white
// rungs) and a red rescue basket that stays level at its tip. At rest the
// boom lies along the truck's ladder bed, the basket over the cab; `reach`
// swings the turntable round, raises the boom and runs its sections out
// until the basket stands at a point — visibly, at the speed of a real one
// — and `rest` folds it back. The truck drives along the street by the
// wheel (`driveTo`), its wheels turning.
import * as THREE from 'three';
import { spawnVehicle, wheelNodes } from '../../../engine/assets.js';
import { C, PRIMS as P } from '../../../engine/stage.js';
import { person, type Rig } from '../../../engine/rig.js';
import { wearHat } from './hats.js';

const TRUCK_LEN = 6.6;
const DECK_Y = 3.35;          // top of the Kenney truck's ladder bed at 6.6 m
const MOUNT_Z = -2.1;         // the turntable, over the rear axle
const SECTION = 6;            // each boom section's length (m)
const RUN = 5.2;              // how far each inner section runs out
const BASKET_DROP = 0.9;      // the basket floor hangs below the boom tip

function section(w: number, h: number, len: number, rail: number): THREE.Group {
  const g = new THREE.Group();
  for (const sx of [-1, 1]) {
    g.add(P.box(0.12, h, len, rail, sx * (w / 2), 0, len / 2));
    g.add(P.box(0.14, 0.06, len, 0xe9edf2, sx * (w / 2), h / 2, len / 2));
  }
  for (let z = 0.3; z < len - 0.1; z += 0.45) g.add(P.box(w, 0.06, 0.07, 0xfaf7ef, 0, -h / 2 + 0.05, z));
  return g;
}

function basket(): THREE.Group {
  const g = new THREE.Group();
  g.add(P.rbox(1.9, 0.14, 1.3, 0.04, C.red, 0, 0, 0));
  for (const [x, z, w, d] of [[0, 0.62, 1.9, 0.08], [0, -0.62, 1.9, 0.08], [0.92, 0, 0.08, 1.3], [-0.92, 0, 0.08, 1.3]] as const) {
    g.add(P.box(w, 0.08, d, C.red, x, 0.9, z));
    g.add(P.box(w, 0.3, d, 0xf3f4f6, x, 0.22, z));
  }
  for (const x of [-0.92, 0.92]) for (const z of [-0.62, 0.62]) g.add(P.box(0.08, 0.9, 0.08, 0xcfd3d9, x, 0.45, z));
  // the water monitor on its front rail
  g.add(P.cyl(0.06, 0.08, 0.5, 8, 0xd9dde2, 0.5, 1.2, 0.62, Math.PI / 2.6, 0, 0));
  return g;
}

export class LadderTruck {
  /** the truck, in its own frame: +z forward, the road under y = 0 */
  readonly root = new THREE.Group();
  private turn = new THREE.Group();
  private boom = new THREE.Group();
  private mid: THREE.Group;
  private tip: THREE.Group;
  readonly basket: THREE.Group;
  private wheels: THREE.Object3D[] = [];
  private yaw = 0;
  private elev = 0.04;
  private ext = 0;
  private want = { yaw: 0, elev: 0.04, ext: 0 };
  /** the truck's position along the road (x), eased toward `driveTo` */
  private speed = 0;
  readonly crew: Rig[] = [];

  /** `ladder: false` — the plain truck (its own ladder on its back) */
  constructor({ ladder = true } = {}) {
    spawnVehicle('/assets/kenney/firetruck.glb', { len: TRUCK_LEN }).then(g => {
      g.userData.shared = true;
      this.root.add(g);
      this.wheels = wheelNodes(g);
    }).catch(() => {});
    this.turn.position.set(0, DECK_Y, MOUNT_Z);
    this.root.add(this.turn);
    this.turn.add(P.cyl(0.95, 1.05, 0.3, 20, 0x4a505a, 0, 0.15, 0));
    this.turn.add(P.rbox(1.5, 0.8, 1.4, 0.12, C.red, 0, 0.6, -0.1));
    this.boom.position.set(0, 0.95, 0);
    this.turn.add(this.boom);
    this.boom.add(section(0.9, 0.5, SECTION, 0xb9c0cc));
    this.mid = section(0.74, 0.4, SECTION, 0xc9cfd8);
    this.tip = section(0.6, 0.32, SECTION, 0xd6dbe3);
    this.boom.add(this.mid);
    this.mid.add(this.tip);
    this.basket = basket();
    this.tip.add(this.basket);
    this.pose();
    this.turn.visible = ladder;
  }

  /** where the basket's floor is now (world) */
  basketAt(out = new THREE.Vector3()): THREE.Vector3 {
    this.root.updateMatrixWorld(true);
    return this.basket.getWorldPosition(out);
  }

  /** the ladder is folded on its bed */
  get resting(): boolean { return this.ext < 0.02 && this.elev < 0.08 && Math.abs(this.yaw) < 0.05; }

  /** swing, raise and run the ladder out so the basket floor stands at a world point */
  reach(p: THREE.Vector3): void {
    this.root.updateMatrixWorld(true);
    const local = this.root.worldToLocal(p.clone());
    const dx = local.x, dz = local.z - MOUNT_Z, dy = local.y - DECK_Y - 0.95;
    const h = Math.hypot(dx, dz);
    // the basket hangs `o` below the boom's tip, square to the boom: the
    // vector (reach, −o) turned by the elevation must land on (h, dy)
    const o = BASKET_DROP - 0.2;
    const d = Math.sqrt(Math.max(0.01, h * h + dy * dy - o * o));
    this.want.yaw = Math.atan2(dx, dz);
    this.want.elev = Math.max(0.04, Math.atan2(dy, h) + Math.atan2(o, d));
    this.want.ext = Math.max(0, Math.min(1, (d - SECTION - 1.0) / (2 * RUN)));
  }

  /** fold the ladder back onto its bed */
  rest(): void { this.want = { yaw: 0, elev: 0.04, ext: 0 }; }

  /** how close the basket is to where it was sent (m, roughly) */
  get settled(): boolean {
    return Math.abs(this.want.yaw - this.yaw) < 0.02 && Math.abs(this.want.elev - this.elev) < 0.01 && Math.abs(this.want.ext - this.ext) < 0.01;
  }

  /** the ladder is out and moving (for the hydraulics' sound) */
  get moving(): boolean { return !this.settled; }

  /** drive the truck along the street toward x (its heading ±x) */
  driveTo(x: number, dt: number): void {
    const cur = this.root.position.x;
    const v = Math.max(-7, Math.min(7, (x - cur) * 2.2));
    this.speed += (v - this.speed) * Math.min(1, dt * 4);
    this.root.position.x += this.speed * dt;
    // (the truck's forward is (sin ry, cos ry): its speed along it spins the wheels)
    const fwd = this.speed * Math.sin(this.root.rotation.y);
    for (const w of this.wheels) w.rotation.x += (fwd * dt) / 0.6;
  }

  get rolling(): boolean { return Math.abs(this.speed) > 0.25; }

  /** its speed along the street (m/s) */
  get speedX(): number { return this.speed; }

  /** stop where it is, quickly (its legs going down) */
  brake(dt: number): void {
    this.speed -= this.speed * Math.min(1, dt * 8);
    this.root.position.x += this.speed * dt;
    const fwd = this.speed * Math.sin(this.root.rotation.y);
    for (const w of this.wheels) w.rotation.x += (fwd * dt) / 0.6;
  }

  update(dt: number): void {
    // swing first, then raise and run out; fold in the reverse order
    const out = this.want.ext > 0.001 || this.want.elev > 0.05;
    const yawOk = Math.abs(this.want.yaw - this.yaw) < 0.25;
    const folded = this.ext < 0.05 && this.elev < 0.12;
    const step = (v: number, t: number, rate: number): number => v + Math.max(-rate * dt, Math.min(rate * dt, t - v));
    if (!out || folded || yawOk) this.yaw = step(this.yaw, out || folded ? this.want.yaw : this.yaw, 1.1);
    if (!out || yawOk) {
      this.elev = step(this.elev, this.want.elev, 0.55);
      this.ext = step(this.ext, this.want.ext, 0.32);
    }
    this.pose();
    for (const c of this.crew) c.update(dt);
  }

  private pose(): void {
    this.turn.rotation.y = this.yaw;
    this.boom.rotation.x = -this.elev;
    this.mid.position.set(0, 0.02, 0.3 + this.ext * RUN);
    this.tip.position.set(0, 0.02, 0.3 + this.ext * RUN);
    // the basket at the tip, kept level whatever the boom's angle
    this.basket.position.set(0, -BASKET_DROP + 0.2, SECTION + 0.4);
    this.basket.rotation.x = this.elev;
  }
}

/** a firefighter: a Kenney character with a red helmet on */
export function firefighter(k: number): Rig {
  return wearHat(person(k), 'fire');
}
