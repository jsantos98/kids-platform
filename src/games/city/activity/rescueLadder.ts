// Burning-building rescue: people wave from the windows of a smoking block.
// The wheel slides the fire-truck ladder across the facade; parked under a
// window column that has someone waiting, the ladder extends to their floor by
// itself and they climb down. Slide away mid-climb and they scurry back up to
// their window to wait — hold still until everyone is down.
import * as THREE from 'three';
import { rng } from '../../../engine/rng.js';
import { C, PRIMS as P } from '../../../engine/stage.js';
import { makeSet, makeHuman, Flame, ease, disposeScene, type Activity, type ActivityInput, type ActivityState } from './common.js';

const COLS = [-3.6, -1.2, 1.2, 3.6];
const FLOORS = [1.6, 4.1, 6.6];
const LOCK = 0.55;
const CLIMB = 1.8;
const RANGE = 4.4;
const FACE = -1.2;   // z of the facade

interface Waiting { col: number; floor: number; who: THREE.Object3D; t: number; saved: boolean }

export class RescueLadderActivity implements Activity {
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  private people: Waiting[] = [];
  private flames: Flame[] = [];
  private rails: THREE.Mesh[] = [];
  private rungs: THREE.Group;
  private ladderX = 0;
  private ext = 1.5;           // ladder height (auto-extends)
  private particles;

  constructor(seed: number) {
    const r = rng(seed);
    const set = makeSet(5.5);
    this.scene = set.scene;
    this.camera = set.camera;
    this.particles = set.particles;
    // a three-storey block
    this.scene.add(P.box(10.4, 8.4, 5, [C.yellow, C.pink, C.blue][(r() * 3) | 0], 0, 4.2, FACE - 2.5));
    this.scene.add(P.box(11, 0.5, 5.6, C.dark, 0, 8.6, FACE - 2.5));
    for (const x of COLS) for (const y of FLOORS) {
      this.scene.add(P.box(1.3, 1.4, 0.1, C.glass, x, y, FACE + 0.02));
      this.scene.add(P.box(1.6, 0.14, 0.4, C.white, x, y - 0.76, FACE + 0.15));
    }
    // 2-3 people, one per column, upper floors
    const cols = [0, 1, 2, 3].sort(() => r() - 0.5).slice(0, 2 + ((r() * 2) | 0));
    cols.forEach((col, k) => {
      const floor = 1 + ((r() * 2) | 0);
      const who = makeHuman(k);
      who.position.set(COLS[col], FLOORS[floor] - 0.7, FACE + 0.3);
      this.scene.add(who);
      this.people.push({ col, floor, who, t: 0, saved: false });
    });
    // flames licking out of the windows nobody is standing in
    for (let k = 0; k < 4; k++) {
      const col = (r() * 4) | 0, floor = (r() * 3) | 0;
      if (this.people.some(p => p.col === col && p.floor === floor)) continue;
      const f = new Flame(COLS[col], FLOORS[floor] - 0.4, FACE + 0.3, 1, k);
      this.flames.push(f);
      this.scene.add(f.group);
    }
    for (let k = 0; k < 3; k++) {
      const puff = P.sphere(1.1 + k * 0.4, C.smoke, (r() - 0.5) * 4, 9.5 + k * 1.5, FACE - 2, { transparent: true, opacity: 0.3 });
      this.scene.add(puff);
    }
    // the ladder: two rails that grow, rungs every 0.4 m
    const railM = new THREE.MeshLambertMaterial({ color: 0xd9dde2 });
    for (const x of [-0.34, 0.34]) {
      const rail = new THREE.Mesh(new THREE.BoxGeometry(0.1, 1, 0.1), railM);
      rail.castShadow = true;
      rail.userData.dx = x;
      this.scene.add(rail);
      this.rails.push(rail);
    }
    this.rungs = new THREE.Group();
    const rungM = new THREE.MeshLambertMaterial({ color: 0xe25c5c });
    for (let y = 0.35; y < 8; y += 0.4) {
      const rung = new THREE.Mesh(new THREE.BoxGeometry(0.68, 0.07, 0.07), rungM);
      rung.position.y = y;
      this.rungs.add(rung);
    }
    this.scene.add(this.rungs);
    this.camera.position.set(0, 4.6, 15);
    this.camera.lookAt(0, 3.8, FACE);
  }

  update(dt: number, elapsed: number, inp: ActivityInput): ActivityState {
    this.ladderX = ease(this.ladderX, inp.steer * RANGE, 4, dt);
    // who is the ladder under?
    const at = this.people.find(p => !p.saved && Math.abs(COLS[p.col] - this.ladderX) < LOCK);
    const wantExt = at ? FLOORS[at.floor] - 0.6 : 1.5;
    this.ext = ease(this.ext, wantExt, 3, dt);
    for (const rail of this.rails) {
      rail.scale.y = this.ext;
      rail.position.set(this.ladderX + rail.userData.dx, this.ext / 2, FACE + 0.55);
    }
    this.rungs.position.set(this.ladderX, 0, FACE + 0.55);
    this.rungs.children.forEach(c => { c.visible = c.position.y < this.ext; });

    for (const p of this.people) {
      if (p.saved) continue;
      const top = FLOORS[p.floor] - 0.7;
      if (p === at && this.ext > FLOORS[p.floor] - 0.9) {
        p.t = Math.min(1, p.t + dt / CLIMB);
      } else {
        // the ladder left: back up to the window to wait
        p.t = Math.max(0, p.t - dt * 1.5);
      }
      const x = p.t > 0 ? this.ladderX : COLS[p.col];
      p.who.position.set(p.t > 0 && p === at ? x : COLS[p.col], top - p.t * (top - 0.05), FACE + (p.t > 0 ? 0.75 : 0.3));
      p.who.rotation.y = p.t > 0 ? Math.PI : Math.sin(elapsed * 3 + p.col) * 0.4;
      if (p.t >= 1) {
        p.saved = true;
        // down safe: walk off to the side of the road
        p.who.position.set(-6 + this.people.filter(q => q.saved).length * 1.1, 0.05, 3);
        p.who.rotation.y = 0;
        this.particles.burstConfetti(new THREE.Vector3(this.ladderX, 0.5, FACE + 1));
      }
    }
    for (const f of this.flames) f.update(elapsed);
    this.particles.update(dt);
    const saved = this.people.filter(p => p.saved).length;
    const climbing = this.people.find(p => !p.saved && p.t > 0);
    const progress = (saved + (climbing ? climbing.t : 0)) / this.people.length;
    return {
      progress,
      prompt: climbing ? 'HOLD STILL…' : 'MOVE THE LADDER TO THE PEOPLE!',
      done: saved === this.people.length,
    };
  }

  celebrate(): void {
    this.particles.burstConfetti(new THREE.Vector3(0, 1, 2));
  }

  dispose(): void {
    disposeScene(this.scene);
  }
}
