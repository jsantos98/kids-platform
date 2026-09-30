// Street-level transit furniture, built per city: the track of both railway
// lines (the land part — the causeway decks carry their own), the square
// diamond where they cross, gated level crossings where a line meets a road
// (twin flashing red signals — the car AI stops for them), the station
// platforms where trains dwell, and the river trestles under the rails. A city builds its set the first time the player arrives;
// the four most recent stay alive so nothing pops when crossing a strait.
import * as THREE from 'three';
import type { NightLights } from './nightLights.js';
import { Baked } from '../../engine/baked.js';
import { rng, chunkSeed } from '../../engine/rng.js';
import { RAIL_Y, railNetFor, layRails, railTile, type RailRoute } from '../../worlds/railRoute.js';
import { riverDecksFor, riverDeckProfile, type RiverDeck } from '../../worlds/riverDecks.js';
import { riverFor, type RiverRoute } from '../../worlds/riverRoute.js';
import { coastFor } from '../../worlds/coast.js';
import { cityPlanFor, platformSide, type Crossing, type Station } from '../../worlds/cityPlan.js';
import { PLATFORM_EDGE, PLATFORM_W, PLATFORM_MID, PLATFORM_LEN, CANOPY_IN, CANOPY_OUT, CANOPY_Y, STOP_POST, STOP_HALF } from './platform.js';
import { citySeed } from '../../worlds/cityGrid.js';
import type { CollisionBox } from '../../worlds/cityChunk.js';
import type { Railway } from './railway.js';

const LIT_RED = new THREE.MeshBasicMaterial({ color: 0xff3b30, toneMapped: false });
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
/** how far a crossing's bells carry (m) */
const BELL_R = 90;
/** the level crossings whose warning just started — a train is 60 m off and
 * sounds its horn — for the soundscape (world; G11) */
export const trainHorns: Array<{ x: number; z: number }> = [];
/** a crossing's posts and booms stand this far up and down the street from
 * its centre (R12); cars stop short of the boom line */
export const CROSSING_BOOM = 9.4;

interface Signal {
  /** warning last frame (a new warning sounds the train's horn) */
  warn?: boolean;
  a: THREE.Mesh[];            // left lamps of every post
  b: THREE.Mesh[];            // right lamps of every post
  arms: THREE.Group[];        // boom pivots (rotation.x is animated)
  c: Crossing;
}

interface CityInst {
  bx: number;
  by: number;
  ox: number;
  oz: number;
  mesh: THREE.Mesh;
  /** both lines' track (city-local, placed at the origin) */
  rails: THREE.Mesh;
  /** dynamic per-city props (signal lamps) */
  dyn: THREE.Group;
  signals: Signal[];
  boxes: CollisionBox[];
}

const MAX_CITIES = 4;

export class Transit {
  private cities = new Map<string, CityInst>();
  /** sets being built a few milliseconds a frame (prepare / pump) */
  private pending = new Map<string, Generator<void, CityInst>>();
  /** the island the kid is on: never the one evicted */
  private current = '';

  constructor(private scene: THREE.Scene) {}

  /** start building island (bx, by)'s set in the background (a woken
   * neighbour): pump() advances it a little each frame */
  prepare(bx: number, by: number, ox: number, oz: number): void {
    const key = `${bx},${by}`;
    if (this.cities.has(key) || this.pending.has(key)) return;
    this.pending.set(key, this.buildSteps(bx, by, ox, oz));
  }

  /** advance the background builds for up to `budgetMs` */
  pump(budgetMs: number): void {
    const t0 = performance.now();
    for (const [key, gen] of this.pending) {
      while (performance.now() - t0 < budgetMs) {
        const r = gen.next();
        if (r.done) { this.pending.delete(key); this.add(key, r.value); break; }
      }
      if (performance.now() - t0 >= budgetMs) return;
    }
  }

  private add(key: string, inst: CityInst): void {
    this.cities.set(key, inst);
    while (this.cities.size > MAX_CITIES) {
      const oldest = [...this.cities.keys()].find(k => k !== this.current && k !== key);
      if (!oldest) break;
      const old = this.cities.get(oldest)!;
      this.scene.remove(old.mesh);
      this.scene.remove(old.dyn);
      this.scene.remove(old.rails);
      old.mesh.geometry.dispose();
      old.rails.geometry.dispose();
      old.dyn.traverse(o => {
        const m = o as THREE.Mesh;
        if (m.isMesh) m.geometry.dispose();
      });
      this.cities.delete(oldest);
    }
  }

  /** build this city's transit furniture if it's the first visit */
  setCity(bx: number, by: number, ox: number, oz: number): void {
    const key = `${bx},${by}`;
    this.current = key;
    const have = this.cities.get(key);
    if (have) {
      this.cities.delete(key);
      this.cities.set(key, have); // LRU touch
      return;
    }
    // finish a background build now, or build it all at once
    const gen = this.pending.get(key) ?? this.buildSteps(bx, by, ox, oz);
    this.pending.delete(key);
    let r = gen.next();
    while (!r.done) r = gen.next();
    this.add(key, r.value);
  }

  /** build one island's set, yielding between the pieces */
  private *buildSteps(bx: number, by: number, ox: number, oz: number): Generator<void, CityInst> {
    const seed = citySeed(bx, by);
    const net = railNetFor(bx, by);
    const river = riverFor(bx, by);
    const coast = coastFor(bx, by);
    const D = net.diamond;
    const plan = cityPlanFor(bx, by);
    const r = rng(chunkSeed(seed, 0x7b2, 9));
    const B = new Baked();
    // the track: both lines on dry land (the decks lay their own), broken
    // at the diamond, where one square plate carries all four rails
    // (and off the raised trestles, which carry their own rails)
    const trestles = riverDecksFor(bx, by).filter(d => d.kind === 'rail');
    const onTrestle = (x: number, z: number): boolean => trestles.some(d => {
      const t = (x - d.ax) * d.ux + (z - d.az) * d.uz;
      return t > 0.3 && t < d.len - 0.3 && Math.abs((x - d.ax) * d.uz - (z - d.az) * d.ux) < 3;
    });
    const keep = (x: number, z: number): boolean => coast.inLand(x, z, 1) && Math.hypot(x - D.x, z - D.z) > 2.7 && !onTrestle(x, z);
    const RB = new Baked();
    for (const L of net.lines) { layRails(RB, L, railTile(), keep); yield; }
    RB.box(5.6, 0.1, 5.6, 0xb9a88c, D.x, RAIL_Y + 0.05, D.z);
    for (const s of [-0.72, 0.72]) {
      RB.box(0.12, 0.14, 5.6, 0x8d939e, D.x + s, RAIL_Y + 0.17, D.z);
      RB.box(5.6, 0.14, 0.12, 0x8d939e, D.x, RAIL_Y + 0.17, D.z + s);
    }
    for (const [dx, dz] of [[-2.2, -2.2], [2.2, -2.2], [-2.2, 2.2], [2.2, 2.2]]) {
      RB.box(0.5, 0.14, 0.5, 0x6e5238, D.x + dx, RAIL_Y + 0.12, D.z + dz);
    }
    const rails = RB.build();
    rails.receiveShadow = true;
    rails.position.set(ox, 0, oz);
    this.scene.add(rails);
    yield;
    const inst: CityInst = {
      bx, by, ox, oz, mesh: null as unknown as THREE.Mesh, rails, dyn: new THREE.Group(),
      signals: [], boxes: [],
    };
    let baked = 0;
    for (const st of plan.stations) { this.bakeStation(B, st, r, ox, oz, inst); baked++; }
    yield;
    for (const d of trestles) { this.bakeTrestle(B, d, ox, oz); baked++; yield; }
    for (const L of net.lines) { baked += this.bakeTrestles(B, L, river, ox, oz, onTrestle); yield; }
    for (const c of plan.crossings) { this.makeCrossing(B, c, ox, oz, inst); baked++; yield; }
    if (baked > 0) {
      inst.mesh = B.build();
      inst.mesh.receiveShadow = true;
      this.scene.add(inst.mesh);
    } else {
      inst.mesh = new THREE.Mesh(); // nothing to draw in this city
    }
    this.scene.add(inst.dyn);
    return inst;
  }

  // ---- station platform beside a straight stretch of the line: the deck,
  // its canopy, posts and STOP board all clear of the widest train
  // (platform.ts) ----
  private bakeStation(B: Baked, st: Station, r: () => number, ox: number, oz: number, inst: CityInst): void {
    const side = platformSide(st);
    const nx = Math.cos(st.h) * side, nz = -Math.sin(st.h) * side;   // toward the platform
    const ux = Math.sin(st.h), uz = Math.cos(st.h);
    const at = (along: number, across: number): [number, number] => [ox + st.x + ux * along + nx * across, oz + st.z + uz * along + nz * across];
    const [px, pz] = at(0, PLATFORM_MID);
    B.box(PLATFORM_W, 0.36, PLATFORM_LEN, WOOD, px, 0.28, pz, 0, st.h, 0);
    const [ex, ez] = at(0, PLATFORM_EDGE + 0.3);
    B.box(0.55, 0.05, PLATFORM_LEN, CREAM, ex, 0.48, ez, 0, st.h, 0);
    // canopy posts + roof (over the platform only)
    for (const [al, ac] of [[5.4, 1.0], [5.4, -1.0], [-5.4, 1.0], [-5.4, -1.0]]) {
      const [cx, cz] = at(al, PLATFORM_MID + ac);
      B.cyl(0.09, 0.11, 3.1, 8, STEEL, cx, 1.55, cz);
    }
    const [rx, rz] = at(0, (CANOPY_IN + CANOPY_OUT) / 2);
    B.box(CANOPY_OUT - CANOPY_IN, 0.16, 13.5, CREAM, rx, CANOPY_Y, rz, 0, st.h, 0);
    // two benches + a name sign
    for (const al of [2.2, -2.2]) {
      const [bx, bz] = at(al, PLATFORM_MID + 0.4);
      B.box(1.6, 0.09, 0.45, 0xa9805a, bx, 0.62, bz, 0, st.h, 0);
    }
    const [sx, sz] = at(6.8, PLATFORM_MID + 0.4);
    B.cyl(0.06, 0.08, 2.6, 8, STEEL, sx, 1.3, sz);
    B.cyl(0.55, 0.55, 0.08, 12, 0x4a90d9, sx, 2.5, sz, Math.PI / 2, st.h, 0);
    // the stop board: a train's head stops level with it — a yellow board on
    // a post near the platform's track edge, and a yellow line painted
    // across the platform
    {
      const [bx, bz] = at(0, STOP_POST);
      B.cyl(0.07, 0.07, 2.4, 8, STEEL, bx, 1.2, bz);
      B.box(0.12, 0.8, STOP_HALF * 2, 0xffd23f, bx, 2.35, bz, 0, st.h + Math.PI / 2, 0);
      B.box(0.14, 0.18, STOP_HALF * 2 + 0.02, 0x2b2b2b, bx, 2.35, bz, 0, st.h + Math.PI / 2, 0);
      B.box(PLATFORM_W - 0.2, 0.02, 0.35, 0xffd23f, px, 0.47, pz, 0, st.h, 0);
    }
    // platform collision: approximate AABB of the rotated deck
    const alongZ = Math.abs(Math.sin(st.h)) > Math.abs(Math.cos(st.h));
    const hw = PLATFORM_W / 2 + 0.1, hl = PLATFORM_LEN / 2 + 0.3;
    inst.boxes.push({
      x1: px - (alongZ ? hw : hl), x2: px + (alongZ ? hw : hl),
      z1: pz - (alongZ ? hl : hw), z2: pz + (alongZ ? hl : hw),
    });
  }

  // ---- a raised timber trestle where the line crosses the river on a deck
  // (riverDecks.ts): the track ramps up onto it, the water flows beneath ----
  private bakeTrestle(B: Baked, d: RiverDeck, ox: number, oz: number): void {
    const rx = Math.cos(d.heading), rz = -Math.sin(d.heading);
    const box = (t: number, l: number, a: number, w: number, h: number, lift: number, color: number): void => {
      const y0 = riverDeckProfile(d, t - l / 2), y1 = riverDeckProfile(d, t + l / 2);
      const pitch = Math.atan2(y1 - y0, l);
      const g = new THREE.BoxGeometry(w, h, l / Math.cos(pitch) + 0.03);
      g.rotateX(-pitch);
      g.rotateY(d.heading);
      g.translate(ox + d.ax + d.ux * t + rx * a, (y0 + y1) / 2 + lift, oz + d.az + d.uz * t + rz * a);
      B.add(g, color);
    };
    const STEP = 2;
    for (let t = 0; t < d.len - 1e-6; t += STEP) {
      const l = Math.min(STEP, d.len - t), tm = t + l / 2;
      box(tm, l, 0, 4.4, 0.35, RAIL_Y - 0.15, 0x8a6a4a);
      for (const a of [-0.72, 0.72]) box(tm, l, a, 0.12, 0.14, RAIL_Y + 0.12, 0x8d939e);
      for (const a of [-2.05, 2.05]) box(tm, l, a, 0.16, 0.55, RAIL_Y + 0.3, 0xd9cdb4);
    }
    for (let t = 0.5; t < d.len; t += 0.9) box(t, 0.28, 0, 2.4, 0.1, RAIL_Y + 0.05, 0x6e5238);
    // timber posts down into the water wherever the deck stands clear
    for (let t = 3; t < d.len - 2; t += 4) {
      const y = riverDeckProfile(d, t);
      if (y < 0.45) continue;
      for (const a of [-1.7, 1.7]) {
        B.box(0.28, y, 0.28, 0x7a5c40, ox + d.ax + d.ux * t + rx * a, y / 2, oz + d.az + d.uz * t + rz * a);
      }
    }
  }

  // ---- wooden trestle decks where the line crosses the water ----
  private bakeTrestles(B: Baked, route: RailRoute, river: RiverRoute, ox: number, oz: number,
                       raised: (x: number, z: number) => boolean = () => false): number {
    let decks = 0;
    const pts = route.pts;
    let k = 0;
    while (k < pts.length) {
      if (!river.inWater(pts[k].x, pts[k].z) || raised(pts[k].x, pts[k].z)) { k++; continue; }
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
    // (each spot: x, z, the boom's yaw, and how far along the street it stands)
    const spots: Array<[number, number, number, number]> = [];
    for (const al of [-CROSSING_BOOM, CROSSING_BOOM]) {
      for (const side of [-1, 1]) {
        spots.push([c.x + ux * al + nx * 7.6 * side, c.z + uz * al + nz * 7.6 * side,
          Math.atan2(-nx * side, -nz * side), al]);
      }
    }
    const lamps: THREE.Mesh[][] = [[], [], [], []];
    const arms: THREE.Group[] = [];
    for (let i = 0; i < spots.length; i++) {
      const [px, pz, ary] = spots[i];
      const wx = ox + px, wz = oz + pz;
      B.cyl(0.09, 0.11, 1.8, 8, STEEL, wx, 0.9, wz);
      // the white crossbuck stands upright facing down the street: each board
      // is rolled ±45° about its own facing axis, then turned so that axis
      // runs along the street (XYZ order: roll first, then yaw). Turned
      // ±45° about the vertical instead, the boards lay flat and the X faced
      // the sky.
      B.box(1.5, 0.2, 0.09, 0xfaf7ef, wx, 2.35, wz, 0, ry, Math.PI / 4);
      B.box(1.5, 0.2, 0.09, 0xfaf7ef, wx, 2.35, wz, 0, ry, -Math.PI / 4);
      // the pair of signal lamps side by side ACROSS the road (along the
      // street they hid one behind the other), on a dark backplate on the
      // crossing's side, so they face the traffic coming up this approach
      const toward = -Math.sign(spots[i][3]); // along u, from this post toward the crossing
      B.box(1.0, 0.5, 0.06, 0x3a3f47, wx + ux * toward * 0.12, 1.75, wz + uz * toward * 0.12, 0, ry, 0);
      for (const s of [-0.3, 0.3]) {
        // (kept dynamic so they can flash)
        const lamp = new THREE.Mesh(new THREE.SphereGeometry(0.15, 10, 8), DIM_RED);
        lamp.position.set(wx + nx * s - ux * toward * 0.02, 1.75, wz + nz * s - uz * toward * 0.02);
        // (it faces the traffic coming up this approach: its glow shows only to them, G10)
        lamp.userData.face = { x: -ux * toward, z: -uz * toward };
        inst.dyn.add(lamp);
        lamps[i].push(lamp);
      }
      // the boom — HALF barriers: only the post on the entry lane's shoulder
      // has one (driving +u, the right-hand lane is n·side −1; driving −u
      // it is +1), so the lane leaving the crossing stays open and a car
      // caught inside can always drive out (booms on both lanes boxed it in)
      inst.boxes.push({ x1: wx - 0.35, x2: wx + 0.35, z1: wz - 0.35, z2: wz + 0.35, small: 1 });
      const al = spots[i][3], side = i % 2 === 0 ? -1 : 1;
      if (side !== Math.sign(al)) continue;
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
    }
    inst.signals.push({ a: lamps.map(l => l[0]), b: lamps.map(l => l[1]), arms, c });
  }

  /** true while a train is near enough that the barriers close and the
   * lamps warn (the car AI holds at the same distance) */
  blocked(inst: CityInst, c: Crossing, rail: Railway): boolean {
    return rail.crossingWarns(inst.bx, inst.by, c.line, c.d);
  }

  /** at night a lit crossing lamp glows here (G10) */
  night: NightLights | null = null;
  private _p = new THREE.Vector3();

  /** the nearest crossing to (px, pz) that is warning a train, within 90 m
   * (world; its bells ring, G11 — 150 m carried them across half a town), or null */
  nearestWarning(px: number, pz: number, rail: Railway): { x: number; z: number; d: number } | null {
    let best: { x: number; z: number; d: number } | null = null;
    for (const inst of this.cities.values()) {
      for (const sig of inst.signals) {
        const x = sig.c.x + inst.ox, z = sig.c.z + inst.oz, d = Math.hypot(x - px, z - pz);
        if (d > BELL_R || (best && d >= best.d) || !this.blocked(inst, sig.c, rail)) continue;
        best = { x, z, d };
      }
    }
    return best;
  }

  /** the lamps + booms of every built city follow the world's trains */
  update(dt: number, elapsed: number, rail: Railway): void {
    for (const inst of this.cities.values()) {
      // crossing lamps: alternate flash while a train is near, dim otherwise;
      // the booms swing down for the train and lift again once it is past
      for (const sig of inst.signals) {
        const warn = this.blocked(inst, sig.c, rail);
        // (a train coming up to the crossing sounds its horn — G11)
        if (warn && sig.warn === false) {
          trainHorns.push({ x: sig.c.x + inst.ox, z: sig.c.z + inst.oz });
          if (trainHorns.length > 8) trainHorns.shift();
        }
        sig.warn = warn;
        const phase = Math.floor(elapsed * 2.6) % 2;
        for (const l of sig.a) l.material = warn && phase === 0 ? LIT_RED : DIM_RED;
        for (const l of sig.b) l.material = warn && phase === 1 ? LIT_RED : DIM_RED;
        if (warn && this.night && this.night.night.value > 0.01) {
          for (const l of phase === 0 ? sig.a : sig.b) {
            l.getWorldPosition(this._p);
            this.night.flash({ x: this._p.x, y: this._p.y, z: this._p.z, color: 0xff3b2e, size: 1.0, pool: 0, face: l.userData.face });
          }
        }
        const target = warn ? 0 : -BOOM_UP;
        const rate = (BOOM_UP / BOOM_TIME) * dt;
        for (const pivot of sig.arms) {
          pivot.rotation.x += Math.max(-rate, Math.min(rate, target - pivot.rotation.x));
        }
      }
    }
  }

  /** collision from every built city: signal + crossing posts, and — while
   * a crossing's booms are down — a solid bar across the street at each
   * of its two approaches (nobody drives through a closed crossing) */
  boxesNear(): CollisionBox[] {
    const out: CollisionBox[] = [];
    for (const inst of this.cities.values()) {
      out.push(...inst.boxes);
      for (const sig of inst.signals) {
        if (!sig.arms.length || sig.arms[0].rotation.x < -BOOM_UP * 0.6) continue; // (still up)
        const c = sig.c, ux = Math.sin(c.heading), uz = Math.cos(c.heading);
        for (const al of [-CROSSING_BOOM, CROSSING_BOOM]) {
          // (half barriers: a bar across the entry lane only — from just past
          // the centre line to the kerb — so the way out stays open)
          const nx = uz, nz = -ux, side = Math.sign(al);
          const cx = inst.ox + c.x + ux * al + nx * side * 3.3, cz = inst.oz + c.z + uz * al + nz * side * 3.3;
          // across the carriageway (local x), a thin bar along the street
          const hx = 4.0, hz = 0.5;
          const ca = Math.abs(Math.cos(c.heading)), sa = Math.abs(Math.sin(c.heading));
          const ex = hx * ca + hz * sa, ez = hx * sa + hz * ca;
          out.push({ x1: cx - ex, x2: cx + ex, z1: cz - ez, z2: cz + ez, obb: { cx, cz, hx, hz, ry: c.heading } });
        }
      }
    }
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
