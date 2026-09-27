// Cat (G4): a cat is stuck up in the trees of a street — or on the ledge
// of a building front. The wheel drives the ladder truck along the street;
// parked with its turntable under the cat, the truck's aerial ladder swings
// round, rises and runs out until the basket stands at the cat's paws, the
// cat hops in, the basket comes down and the cat runs to the child waiting
// for it on the pavement — and they dance. The cat is playful: now and then
// it hops to another tree (or pads along the ledge) before the truck is
// under it — twice at most. Once the ladder goes up the truck's legs are
// down and it stays put: a small child needn't hold the wheel still.
import * as THREE from 'three';
import { rng, type Rng } from '../../../engine/rng.js';
import { t as tr } from '../../../i18n/index.js';
import { pet, person, type Rig } from '../../../engine/rig.js';
import { PRIMS as P } from '../../../engine/stage.js';
import { StreetSet, kit, kitSize, marker } from './set.js';
import { LadderTruck, firefighter } from './ladderTruck.js';
import { pickOf, type Activity, type ActivityInput, type ActivityState, type CallLook, type SceneCue, type SceneLoop } from './common.js';

export type CatVariant = 'tree' | 'building';

const ROAD_Z = 8;
const FRONT_Z = ROAD_Z - 10.6;
const TRUCK_Z = ROAD_Z - 3.2;
const MOUNT = 2.1;           // the turntable sits this far behind the truck's middle (−x when heading +x)
const RANGE = 11;            // the truck drives ±11 m
const LOCK = 1.8;            // turntable within this of the cat, slowing: the ladder goes up
const TREES = ['tree-oak', 'tree-default', 'tree-fat', 'tree-detailed'];
const SHOPS = [...'abcdefghijklmn'].map(c => 'bldg-' + c);

type State = 'wait' | 'up' | 'aboard' | 'down' | 'home' | 'done';

export class CatLadderActivity implements Activity {
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  cues: SceneCue[] = [];
  loops = new Set<SceneLoop>();
  private set: StreetSet;
  private r: Rng;
  private truck: LadderTruck;
  private cat: Rig;
  private kid: Rig;
  private spots: THREE.Vector3[] = [];
  private spot = 0;
  private state: State = 'wait';
  private moves = 0;
  private wanderT = 6;
  private hop: { from: THREE.Vector3; to: THREE.Vector3; t: number; dur: number; h: number } | null = null;
  private progress = 0;
  private home = new THREE.Vector3();
  private won = false;
  private icon = marker('🐱');

  constructor(seed: number, readonly variant: CatVariant, look?: CallLook) {
    const r = this.r = rng(seed);
    // (the building's name and size first: the neighbours stand either side of it)
    const bname = look?.kind === 'building' && look.model ? look.model : pickOf(r, SHOPS);
    const bsz = kitSize(bname) ?? new THREE.Vector3(12, 12, 10);
    const hw = variant === 'tree' ? 13 : Math.max(6, bsz.x / 2 + 1);
    const set = this.set = new StreetSet({ seed, roadZ: ROAD_Z, keep: [-hw, hw], district: look?.district ?? (variant === 'tree' ? 'residential' : 'urban'), onlookers: 3, crowdX: 16, parked: 0 });
    this.scene = set.scene;
    this.camera = set.camera;
    const cam = new THREE.Vector3(0, 6.2, ROAD_Z + 10.5);
    const ray = new THREE.Raycaster();

    if (variant === 'tree') {
      // three trees along the lot; the cat sits in their leaves, in front
      const name = look?.kind === 'tree' && look.model ? look.model : pickOf(r, TREES);
      for (const x of [-8.5, 0, 8.5]) {
        const s = 8 + r() * 1.5;
        const m = kit(x === 0 ? name : pickOf(r, TREES), x, 0.1, FRONT_Z - 2.2, r() * 6, s);
        const h = (kitSize(name, s)?.y ?? 8);
        if (m) {
          m.castShadow = true;
          set.scene.add(m);
          m.updateMatrixWorld(true);
          const aim = new THREE.Vector3(x, h * 0.62, FRONT_Z - 2.2);
          ray.set(cam, aim.clone().sub(cam).normalize());
          const hit = ray.intersectObject(m, true)[0];
          this.spots.push(hit ? hit.point.addScaledVector(ray.ray.direction, -0.25) : aim.setZ(FRONT_Z));
        } else this.spots.push(new THREE.Vector3(x, h * 0.62, FRONT_Z));
      }
    } else {
      // a town building; the cat pads along a ledge across its first floor
      const sz = bsz;
      const m = kit(bname, 0, 0.1, FRONT_Z - sz.z / 2);
      if (m) { m.castShadow = true; m.receiveShadow = true; set.scene.add(m); }
      const y = Math.min(sz.y * 0.55, 7.5);
      const w = Math.max(8, sz.x);
      set.scene.add(P.box(w - 0.6, 0.2, 0.9, 0xeceae4, 0, y - 0.1, FRONT_Z + 0.4));
      for (const x of [-w / 2 + 1.6, 0, w / 2 - 1.6]) this.spots.push(new THREE.Vector3(x, y, FRONT_Z + 0.45));
    }
    this.spot = 1 + ((r() * (this.spots.length - 1)) | 0);

    this.truck = new LadderTruck();
    this.truck.root.position.set(-RANGE * 0.6, 0, TRUCK_Z);
    this.truck.root.rotation.y = Math.PI / 2;
    set.scene.add(this.truck.root);
    set.addRig(firefighter(4), -15, 0.17, ROAD_Z - 7.6, Math.PI * 0.9).play('idle');

    this.cat = set.addRig(pet('cat', 1.0), 0, 0, 0);
    this.cat.root.position.copy(this.spots[this.spot]);
    this.cat.play('idle');
    set.scene.add(this.icon);
    // the child who lost the cat, on the pavement
    this.kid = set.addRig(person((seed % 6) * 2 + 1, 1.15), 3.5, 0.17, ROAD_Z - 8.2, Math.PI);
    this.kid.play('idle');
    this.home.set(2.6, 0.17, ROAD_Z - 8.2);

    set.shot(cam, { x: 0, y: 4.6, z: FRONT_Z + 1 });
  }

  /** the turntable's x (the truck heads +x: it sits behind the middle) */
  private get mountX(): number { return this.truck.root.position.x - MOUNT; }

  aim(): number {
    if (this.state !== 'wait' && this.state !== 'up') return (this.mountX + MOUNT) / RANGE;
    return Math.max(-1, Math.min(1, (this.spots[this.spot].x + MOUNT) / RANGE));
  }

  /** where the basket should stop: a little in front of the cat, at its paws */
  private reachPoint(): THREE.Vector3 {
    return this.spots[this.spot].clone().add(new THREE.Vector3(0, -0.2, 1.1));
  }

  update(dt: number, _elapsed: number, inp: ActivityInput): ActivityState {
    this.set.night = inp.night ?? 0;
    const catSpot = this.spots[this.spot];
    // the wheel drives the truck — until the ladder goes up: then its legs
    // are down and it stays put (a small child needn't hold the wheel still)
    const locked = this.state !== 'wait';
    if (!locked) this.truck.driveTo(Math.max(-1, Math.min(1, inp.steer)) * RANGE, dt);
    else this.truck.brake(dt);
    const under = Math.abs(this.mountX - catSpot.x) < LOCK && Math.abs(this.truck.speedX) < 5;

    if (this.hop) {
      // the cat mid-hop (to another tree, into the basket, down to the street)
      const h = this.hop;
      h.t = Math.min(1, h.t + dt / h.dur);
      this.cat.root.position.lerpVectors(h.from, h.to, h.t);
      this.cat.root.position.y += Math.sin(h.t * Math.PI) * h.h;
      if (h.t >= 1) this.hop = null;
    }

    if (this.state === 'wait') {
      this.progress = 0;
      if (!this.hop) {
        this.cat.root.position.copy(catSpot);
        this.cat.root.rotation.y = Math.sin(_elapsed * 0.8) * 0.4;
        if (this.cat.clip !== 'idle') this.cat.play('idle');
      }
      // playful: now and then it goes somewhere else — never with the truck close
      this.wanderT -= dt;
      if (this.wanderT <= 0 && this.moves < 2 && !this.hop && Math.abs(this.mountX - catSpot.x) > 3.5) {
        const others = this.spots.map((_, k) => k).filter(k => k !== this.spot && Math.abs(this.spots[k].x - this.mountX) > 3);
        if (others.length) {
          const next = pickOf(this.r, others);
          this.hop = { from: catSpot.clone(), to: this.spots[next].clone(), t: 0, dur: this.variant === 'tree' ? 0.9 : 1.8, h: this.variant === 'tree' ? 2.2 : 0.15 };
          this.cat.play(this.variant === 'tree' ? 'run' : 'walk');
          this.cat.root.rotation.y = this.spots[next].x > catSpot.x ? Math.PI / 2 : -Math.PI / 2;
          this.spot = next;
          this.moves++;
          this.cues.push('catMoved');
        }
        this.wanderT = 6 + this.r() * 3;
      }
      if (under && !this.hop) { this.state = 'up'; this.truck.reach(this.reachPoint()); this.cues.push('meow'); }
    } else if (this.state === 'up') {
      this.truck.reach(this.reachPoint());
      const b = this.truck.basketAt();
      this.progress = 0.5 * Math.min(1, Math.max(0, b.y / Math.max(1, this.reachPoint().y)));
      if (this.truck.settled && b.distanceTo(this.reachPoint()) < 1.6) {
        // in it hops
        this.state = 'aboard';
        this.hop = { from: this.cat.root.position.clone(), to: b.clone().add(new THREE.Vector3(0, 0.2, 0)), t: 0, dur: 0.6, h: 0.8 };
        this.cat.play('run');
        this.cues.push('aboard', 'meow');
        this.set.sparkles.burst(b.clone().add(new THREE.Vector3(0, 1, 0)), 'heart', 8, 0.5);
      }
    } else if (this.state === 'aboard') {
      this.progress = 0.55;
      if (!this.hop) {
        this.state = 'down';
        this.truck.rest();
        this.cat.play('idle');
      }
    } else if (this.state === 'down') {
      const b = this.truck.basketAt();
      this.cat.root.position.copy(b).add(new THREE.Vector3(0, 0.2, 0));
      this.cat.root.rotation.y = 0;
      this.progress = 0.55 + 0.3 * (1 - Math.min(1, (b.y - 3) / Math.max(1, catSpot.y - 3)));
      if (this.truck.resting) {
        // down to the road and off to its child
        this.state = 'home';
        const land = new THREE.Vector3(b.x, 0.17, TRUCK_Z - 2.2);
        this.hop = { from: this.cat.root.position.clone(), to: land, t: 0, dur: 0.7, h: 1.2 };
        this.cat.play('run');
      }
    } else if (this.state === 'home') {
      this.progress = Math.min(0.99, this.progress + dt * 0.1);
      if (!this.hop) {
        const p = this.cat.root.position, d = this.home.clone().sub(p);
        d.y = 0;
        const dist = d.length();
        this.cat.root.rotation.y = Math.atan2(d.x, d.z);
        p.addScaledVector(d.normalize(), Math.min(dist, dt * 4.5));
        this.kid.root.rotation.y = Math.atan2(p.x - this.kid.root.position.x, p.z - this.kid.root.position.z);
        if (dist < 0.9) {
          this.state = 'done';
          this.progress = 1;
          this.cat.play('dance');
          this.kid.play('jump');
          this.cues.push('safe', 'meow');
        }
      }
    }

    // (its icon bobs over it until it's in the basket)
    this.icon.visible = this.state === 'wait' || this.state === 'up';
    this.icon.position.copy(this.cat.root.position).add(new THREE.Vector3(0, 2 + Math.sin(_elapsed * 3) * 0.2, 0));
    this.loops.clear();
    if (this.truck.moving && !this.truck.resting) this.loops.add('ladder');
    this.truck.update(dt);
    this.set.update(dt);
    const prompt = this.state === 'wait' ? tr('scene.ladderCat')
      : this.state === 'up' ? tr('scene.ladderUp') : tr('scene.catComing');
    return { progress: this.progress, prompt, done: this.state === 'done' };
  }

  celebrate(): void {
    if (this.won) return;
    this.won = true;
    this.set.cheer(3);
    this.set.sparkles.burst(this.cat.root.position.clone().add(new THREE.Vector3(0, 1, 0)), 'heart', 12, 0.6);
    this.set.particles.burstConfetti(this.home.clone().add(new THREE.Vector3(0, 1, 0)));
    this.set.pushIn({ x: this.home.x * 0.6, y: 4, z: ROAD_Z + 6 });
    this.cues.push('cheer');
  }

  dispose(): void {
    this.set.dispose();
  }
}

