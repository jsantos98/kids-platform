// Street-level transit furniture, built per city: gated level crossings where
// the railway meets a road (twin flashing red signals — the car AI stops for
// them), the station platforms where trains dwell, and the river trestles
// under the rails. A city builds its set the first time the player arrives;
// the four most recent stay alive so nothing pops when crossing a strait.
import * as THREE from 'three';
import { Baked } from '../../engine/baked.js';
import { rng, chunkSeed } from '../../engine/rng.js';
import { RAIL_Y, railRouteFor, type RailRoute } from '../../worlds/railRoute.js';
import { riverFor, type RiverRoute } from '../../worlds/riverRoute.js';
import { cityPlanFor, type Crossing, type Station } from '../../worlds/cityPlan.js';
import { citySeed } from '../../worlds/cityGrid.js';
import type { CollisionBox } from '../../worlds/cityChunk.js';
import type { Trains } from './train.js';

const LIT_RED = new THREE.MeshBasicMaterial({ color: 0xff3b30 });
const DIM_RED = new THREE.MeshBasicMaterial({ color: 0x4a2226 });
const STEEL = 0x5f6774;
const CREAM = 0xe8e4d8;
const WOOD = 0xc9b083;
const BOOM_RED = new THREE.MeshLambertMaterial({ color: 0xd94b32 });
const BOOM_WHITE = new THREE.MeshLambertMaterial({ color: 0xf2ede0 });

const BOOM_LEN = 8.2;   // boom reach: half the carriageway plus a shoulder
const BOOM_UP = 1.22;   // raised tilt (rad)
const BOOM_TIME = 1.6;  // seconds to lower or raise
/** a train nearer than this (arc m) starts the lamps flashing and the
 * booms closing — the car AI holds at the same distance */
export const CROSSING_WARN_DIST = 60;

interface Signal {
  a: THREE.Mesh[];            // left lamps of every post
  b: THREE.Mesh[];            // right lamps of every post
  arms: THREE.Group[];        // boom pivots (rotation.x is animated)
  c: Crossing;
}

interface CityInst {
  ox: number;
  oz: number;
  mesh: THREE.Mesh;
  /** dynamic per-city props (signal lamps) */
  dyn: THREE.Group;
  signals: Signal[];
  boxes: CollisionBox[];
}

const MAX_CITIES = 4;

export class Transit {
  private cities = new Map<string, CityInst>();

  constructor(private scene: THREE.Scene) {}

  /** build this city's transit furniture if it's the first visit */
  setCity(bx: number, by: number, ox: number, oz: number): void {
    const key = `${bx},${by}`;
    const have = this.cities.get(key);
    if (have) {
      this.cities.delete(key);
      this.cities.set(key, have); // LRU touch
      return;
    }
    this.buildCity(bx, by, ox, oz, key);
    while (this.cities.size > MAX_CITIES) {
      const oldest = this.cities.keys().next().value as string;
      const inst = this.cities.get(oldest)!;
      this.scene.remove(inst.mesh);
      this.scene.remove(inst.dyn);
      inst.mesh.geometry.dispose();
      inst.dyn.traverse(o => {
        const m = o as THREE.Mesh;
        if (m.isMesh) m.geometry.dispose();
      });
      this.cities.delete(oldest);
    }
  }

  private buildCity(bx: number, by: number, ox: number, oz: number, key: string): void {
    const seed = citySeed(bx, by);
    const route = railRouteFor(bx, by);
    const river = riverFor(seed);
    const plan = cityPlanFor(bx, by);
    const r = rng(chunkSeed(seed, 0x7b2, 9));
    const B = new Baked();
    const inst: CityInst = {
      ox, oz, mesh: null as unknown as THREE.Mesh, dyn: new THREE.Group(),
      signals: [], boxes: [],
    };
    let baked = 0;
    for (const st of plan.stations) { this.bakeStation(B, st, r, ox, oz, inst); baked++; }
    baked += this.bakeTrestles(B, route, river, ox, oz);
    for (const c of plan.crossings) { this.makeCrossing(B, c, ox, oz, inst); baked++; }
    if (baked > 0) {
      inst.mesh = B.build();
      inst.mesh.receiveShadow = true;
      this.scene.add(inst.mesh);
    } else {
      inst.mesh = new THREE.Mesh(); // nothing to draw in this city
    }
    this.scene.add(inst.dyn);
    this.cities.set(key, inst);
  }

  // ---- station platform beside a straight stretch of the line ----
  private bakeStation(B: Baked, st: Station, r: () => number, ox: number, oz: number, inst: CityInst): void {
    const side = r() < 0.5 ? 1 : -1;
    const nx = Math.cos(st.h), nz = -Math.sin(st.h);   // right of travel
    const px = ox + st.x + nx * 3.5 * side, pz = oz + st.z + nz * 3.5 * side;
    B.box(3.4, 0.36, 15, WOOD, px, 0.28, pz, 0, st.h, 0);
    B.box(0.55, 0.05, 15, CREAM, px - nx * 1.5 * side, 0.48, pz - nz * 1.5 * side, 0, st.h, 0);
    // canopy posts + roof
    for (const [al, ac] of [[5.4, 1.35], [5.4, -1.35], [-5.4, 1.35], [-5.4, -1.35]]) {
      B.cyl(0.09, 0.11, 3.1, 8, STEEL, px + Math.sin(st.h) * al + nx * ac, 1.55, pz + Math.cos(st.h) * al + nz * ac);
    }
    B.box(4.4, 0.16, 13.5, CREAM, px, 3.15, pz, 0, st.h, 0);
    // two benches + a name sign
    for (const al of [2.2, -2.2]) {
      B.box(1.6, 0.09, 0.45, 0xa9805a, px + Math.sin(st.h) * al, 0.62, pz + Math.cos(st.h) * al, 0, st.h, 0);
    }
    const sx = px + nx * 0.4 * side, sz = pz + nz * 0.4 * side;
    B.cyl(0.06, 0.08, 2.6, 8, STEEL, sx + Math.sin(st.h) * 6.8, 1.3, sz + Math.cos(st.h) * 6.8);
    B.cyl(0.55, 0.55, 0.08, 12, 0x4a90d9, sx + Math.sin(st.h) * 6.8, 2.5, sz + Math.cos(st.h) * 6.8, Math.PI / 2, st.h, 0);
    // platform collision: approximate AABB of the rotated deck
    const alongZ = Math.abs(Math.sin(st.h)) > Math.abs(Math.cos(st.h));
    inst.boxes.push({
      x1: px - (alongZ ? 1.8 : 7.8), x2: px + (alongZ ? 1.8 : 7.8),
      z1: pz - (alongZ ? 7.8 : 1.8), z2: pz + (alongZ ? 7.8 : 1.8),
    });
  }

  // ---- wooden trestle decks where the line crosses the water ----
  private bakeTrestles(B: Baked, route: RailRoute, river: RiverRoute, ox: number, oz: number): number {
    let decks = 0;
    const pts = route.pts;
    let k = 0;
    while (k < pts.length) {
      if (!river.inWater(pts[k].x, pts[k].z)) { k++; continue; }
      let end = k;
      let sx = 0, sz = 0, sh = 0;
      while (end < pts.length && river.inWater(pts[end].x, pts[end].z)) {
        sx += pts[end].x; sz += pts[end].z; sh += pts[end].h;
        end++;
      }
      const n = end - k;
      const mx = ox + sx / n, mz = oz + sz / n;
      const mh = sh / n;
      const a = pts[k], b = pts[Math.min(pts.length - 1, end - 1)];
      const len = Math.hypot(b.x - a.x, b.z - a.z) + 3;
      B.box(3.8, 0.16, len, 0x8a6a4a, mx, RAIL_Y - 0.03, mz, 0, mh, 0);
      for (const al of [-len / 4, 0, len / 4]) {
        B.box(0.22, 0.3, 0.22, 0x7a5c40, mx + Math.sin(mh) * al, RAIL_Y - 0.2, mz + Math.cos(mh) * al);
      }
      decks++;
      k = end;
    }
    return decks;
  }

  // ---- level crossing: four posts (two per road approach) each carrying a
  // crossbuck, a flashing lamp pair and a boom barrier. The booms swing down
  // while a train nears (update()) and the lamps warn the whole time. ----
  private makeCrossing(B: Baked, c: Crossing, ox: number, oz: number, inst: CityInst): void {
    // the street's direction u and its across-road normal n
    const ux = Math.round(Math.sin(c.heading) * 1e9) / 1e9, uz = Math.round(Math.cos(c.heading) * 1e9) / 1e9;
    const nx = uz, nz = -ux;
    const ry = c.heading;
    // posts stand on both shoulders of both approaches (9.4 m up/down the
    // road, 7.6 m out); each boom yaws across the carriageway from its
    // shoulder — local +z points back toward the road's centre line (R12)
    const spots: Array<[number, number, number]> = [];
    for (const al of [-9.4, 9.4]) {
      for (const side of [-1, 1]) {
        spots.push([c.x + ux * al + nx * 7.6 * side, c.z + uz * al + nz * 7.6 * side,
          Math.atan2(-nx * side, -nz * side)]);
      }
    }
    const lamps: THREE.Mesh[][] = [[], [], [], []];
    const arms: THREE.Group[] = [];
    for (let i = 0; i < spots.length; i++) {
      const [px, pz, ary] = spots[i];
      const wx = ox + px, wz = oz + pz;
      B.cyl(0.09, 0.11, 1.8, 8, STEEL, wx, 0.9, wz);
      // white crossbuck facing down the street
      B.box(1.5, 0.2, 0.09, 0xfaf7ef, wx, 2.35, wz, 0, ry + Math.PI / 4, 0);
      B.box(1.5, 0.2, 0.09, 0xfaf7ef, wx, 2.35, wz, 0, ry - Math.PI / 4, 0);
      // pair of signal lamps (kept dynamic so they can flash)
      for (const s of [-0.34, 0.34]) {
        const lamp = new THREE.Mesh(new THREE.SphereGeometry(0.17, 10, 8), DIM_RED);
        lamp.position.set(wx + ux * s, 1.75, wz + uz * s);
        inst.dyn.add(lamp);
        lamps[i].push(lamp);
      }
      // the boom: a striped arm on a pivot, raised while the road is open
      const outer = new THREE.Group();
      outer.position.set(wx, 0, wz);
      outer.rotation.y = ary;
      const pivot = new THREE.Group();
      pivot.position.y = 1.05;
      pivot.rotation.x = -BOOM_UP;
      for (let sgm = 0; sgm < 4; sgm++) {
        const seg = new THREE.Mesh(
          new THREE.BoxGeometry(0.26, 0.14, BOOM_LEN / 4),
          sgm % 2 ? BOOM_WHITE : BOOM_RED,
        );
        seg.position.set(0, 0, 0.4 + (sgm + 0.5) * (BOOM_LEN / 4));
        seg.castShadow = true;
        pivot.add(seg);
      }
      outer.add(pivot);
      inst.dyn.add(outer);
      arms.push(pivot);
      inst.boxes.push({ x1: wx - 0.35, x2: wx + 0.35, z1: wz - 0.35, z2: wz + 0.35, small: 1 });
    }
    inst.signals.push({ a: lamps.map(l => l[0]), b: lamps.map(l => l[1]), arms, c });
  }

  /** true while a train is near enough that the barriers close and the
   * lamps warn (the car AI holds at the same distance) */
  blocked(c: Crossing, trains: Trains): boolean {
    return trains.distTo(c.d) < CROSSING_WARN_DIST;
  }

  /** `trainsFor(key)` is the railway of city "bx,by" (null: its island is
   * dormant — no train can be near, the booms stay up) */
  update(dt: number, elapsed: number, trainsFor: (key: string) => Trains | null): void {
    for (const [key, inst] of this.cities) {
      const trains = trainsFor(key);
      // crossing lamps: alternate flash while a train is near, dim otherwise;
      // the booms swing down for the train and lift again once it is past
      for (const sig of inst.signals) {
        const warn = !!trains && this.blocked(sig.c, trains);
        const phase = Math.floor(elapsed * 2.6) % 2;
        for (const l of sig.a) l.material = warn && phase === 0 ? LIT_RED : DIM_RED;
        for (const l of sig.b) l.material = warn && phase === 1 ? LIT_RED : DIM_RED;
        const target = warn ? 0 : -BOOM_UP;
        const rate = (BOOM_UP / BOOM_TIME) * dt;
        for (const pivot of sig.arms) {
          pivot.rotation.x += Math.max(-rate, Math.min(rate, target - pivot.rotation.x));
        }
      }
    }
  }

  /** static collision from every built city (signal + crossing posts) */
  boxesNear(): CollisionBox[] {
    const out: CollisionBox[] = [];
    for (const inst of this.cities.values()) out.push(...inst.boxes);
    return out;
  }

  /** debug probe (current focus: every built city) */
  list(): unknown {
    return [...this.cities.entries()].map(([key, inst]) => ({
      key,
      crossings: inst.signals.map(s => ({ x: +s.c.x.toFixed(1), z: +s.c.z.toFixed(1), heading: +s.c.heading.toFixed(3) })),
    }));
  }
}
