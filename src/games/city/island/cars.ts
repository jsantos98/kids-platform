// An island's cars: a fixed, seeded fleet that lives on this island for good.
// Every car starts on a seeded street spot and drives the street graph
// continuously — right-hand lane, red lights, level crossings, roundabouts,
// U-turns at the causeway mouths so it never leaves the island. Nothing ever
// respawns or teleports: cars far from the player are simply not drawn.
// They never hit the player either: a car brakes when the player is in the
// lane ahead and eases toward the kerb when the player gets close.
import * as THREE from 'three';
import { nightLights } from '../nightLights.js';
import { rng, chunkSeed, type Rng } from '../../../engine/rng.js';
import { makeCar } from '../../../kit/index.js';
import { spawnVehicle } from '../../../engine/assets.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { citySeed } from '../../../worlds/cityGrid.js';
import { SCALE } from '../../../worlds/world.js';
import { graphFor, leaving, type StreetGraph, type SEdge, type SNode } from '../../../worlds/streetGraph.js';
import { lightState, greenLeft, STOP_LINE } from '../lights.js';
import { CROSSING_BOOM } from '../transit.js';
import type { Threat } from './walkers.js';
import { junctionPath, lanePoint, alongPath, LANE, ROUND_IN, TURN_IN } from './junctionPath.js';
import { crosswalksFor } from '../../../worlds/crosswalks.js';
import { overlapDepth } from './obb.js';
import { deckAt } from '../../../worlds/causeway.js';
import type { Railway } from '../railway.js';

/** the island's traffic: the Car Kit's ordinary road vehicles — no race
 * cars or karts, no police car or ambulance (those are the kid's) — each at
 * its own length, most of them cars and the odd van or truck (`w`: its share
 * of the fleet) */
export interface TrafficModel { url: string; len: number; w: number }
const K = '/assets/kenney/';
export const TRAFFIC_MODELS: TrafficModel[] = [
  { url: `${K}sedan.glb`, len: 4.4, w: 4 },
  { url: `${K}sedan-sports.glb`, len: 4.4, w: 2 },
  { url: `${K}hatchback-sports.glb`, len: 4.0, w: 2 },
  { url: `${K}suv.glb`, len: 4.6, w: 3 },
  { url: `${K}suv-luxury.glb`, len: 4.8, w: 2 },
  { url: `${K}taxi.glb`, len: 4.4, w: 2 },
  { url: `${K}van.glb`, len: 5.0, w: 2 },
  { url: `${K}delivery.glb`, len: 5.4, w: 1 },
  { url: `${K}delivery-flat.glb`, len: 5.4, w: 1 },
  { url: `${K}truck.glb`, len: 6.5, w: 1 },
  { url: `${K}truck-flat.glb`, len: 6.5, w: 1 },
  { url: `${K}garbage-truck.glb`, len: 6.5, w: 1 },
];
const FALLBACK_COLORS = [0xfaf7ef, 0xd9dde2, 0x7fb2d9, 0xe25c5c];
/** cars nearer than this light their lamps at night (m) */
const LAMP_R = 150;
/** cars farther than this from the player aren't drawn (the fog is ~260 m) */
const DRAW_R = 190;

/** how deep a car (centre, heading, half length; 1 m half width) and a
 * getaway car's footprint overlap (m; ≤ 0 clear) */
function boxDepth(x: number, z: number, h: number, halfL: number, r: Threat): number {
  return overlapDepth({ x, z, h, hl: halfL, hw: 1.0 }, { x: r.x, z: r.z, h: r.heading, hl: r.halfL, hw: r.halfW });
}

/** a getaway car, as the traffic sees it: a footprint to queue behind, and
 * `pushy` while it flees (cars it comes up behind ease aside) — G7 */
export interface Chaser extends Threat { pushy: boolean }

interface Car {
  /** seconds stopped on its curve for a getaway car in its way (G7) */
  yieldT?: number;
  /** seconds held by the last word against a getaway car (G7) */
  deepT?: number;
  /** its place in the fleet (a fixed order, for ties) */
  id: number;
  edge: number;
  dir: 1 | -1;
  /** the street it takes at the end of this one (chosen as it enters) */
  next: number;
  s: number;
  speed: number;
  v: number;
  /** eases toward the kerb when the player crowds the car (m, + = right) */
  dodge: number;
  r: Rng;
  model: number;
  /** its length (m): the model's (a truck is half as long again as a car) */
  len: number;
  /** crossing a node on a curve (junction turn or roundabout ring) */
  round?: { pts: Array<{ x: number; z: number }>; cum: number[]; s: number; next: number; node: number; out: number };
  /** world position this frame, the path's heading and the body's (eased) */
  x: number;
  z: number;
  h: number;
  ry: number;
  /** held right behind the kid's vehicle this step; for how long (s); and
   * whether it has honked about it yet (sound only — G11) */
  kid?: boolean;
  held?: number;
  honked?: boolean;
}

/** where a car honked since the game last looked (the game drains it and
 * plays the horns, G11; capped, since the node tools never drain it) */
export const honks: Array<{ x: number; z: number }> = [];

/**
 * Each car model as ONE geometry (its meshes merged in the model's own
 * frame) with its material, loaded once for every island: an island draws
 * its whole fleet as one instanced mesh per model — a handful of draw calls
 * however many cars — instead of a cloned model (seven meshes) per car.
 * Until a model streams in, its cars show the procedural stand-in, merged
 * the same way.
 */
const modelCache = new Map<string, Promise<{ geo: THREE.BufferGeometry; mat: THREE.Material } | null>>();
function mergedOf(root: THREE.Object3D): { geo: THREE.BufferGeometry; mat: THREE.Material } | null {
  root.updateMatrixWorld(true);
  const parts: THREE.BufferGeometry[] = [];
  let mat: THREE.Material | null = null;
  root.traverse(o => {
    const m = o as THREE.Mesh;
    if (!m.isMesh) return;
    let g = m.geometry.clone();
    g.applyMatrix4(m.matrixWorld);
    if (g.index) g = g.toNonIndexed();
    for (const k of Object.keys(g.attributes)) if (!['position', 'normal', 'uv', 'color'].includes(k)) g.deleteAttribute(k);
    parts.push(g);
    mat ??= Array.isArray(m.material) ? m.material[0] : m.material;
  });
  // (all of a kit model's meshes share its one palette material)
  const same = (a: THREE.BufferGeometry, b: THREE.BufferGeometry) => Object.keys(a.attributes).sort().join() === Object.keys(b.attributes).sort().join();
  const ok = parts.filter(g => same(g, parts[0]));
  const geo = ok.length ? mergeGeometries(ok) : null;
  return geo && mat ? { geo, mat } : null;
}
function carModel(url: string, len: number): Promise<{ geo: THREE.BufferGeometry; mat: THREE.Material } | null> {
  const key = `${url}@${len}`;
  let p = modelCache.get(key);
  if (!p) {
    p = spawnVehicle(url, { len }).then(mergedOf).catch(() => null);
    modelCache.set(key, p);
  }
  return p;
}
const fallbacks: Array<{ geo: THREE.BufferGeometry; mat: THREE.Material } | null> = [];
function fallbackModel(k: number): { geo: THREE.BufferGeometry; mat: THREE.Material } | null {
  if (fallbacks[k] === undefined) fallbacks[k] = mergedOf(makeCar({ body: FALLBACK_COLORS[k % FALLBACK_COLORS.length] }));
  return fallbacks[k];
}
const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _p = new THREE.Vector3(), _s = new THREE.Vector3(1, 1, 1), _y = new THREE.Vector3(0, 1, 0);

/** an AI car's footprint: half its length, and half its width (a truck's
 * wider) */
const halfW = (c: Car): number => (c.len > 5.2 ? 1.2 : 1.0);
const rightOf = (hx: number, hz: number): { x: number; z: number } => ({ x: -hz, z: hx });

export class IslandCars {
  readonly cars: Car[] = [];
  private graph: StreetGraph;
  /** whether two turns through a junction cross or come close (keyed by
   * node and both turns; the geometry never changes) */
  private conflicts = new Map<string, boolean>();
  /** one instanced mesh per model (the stand-in until the model arrives) */
  private meshes: THREE.InstancedMesh[] = [];

  constructor(private scene: THREE.Scene, readonly bx: number, readonly by: number,
              private ox: number, private oz: number, extraModels: string[] = []) {
    this.graph = graphFor(bx, by);
    const g = this.graph;
    // (an extra — the fire truck driving itself when the kid isn't — one share)
    const models: TrafficModel[] = [...TRAFFIC_MODELS, ...extraModels.map(url => ({ url, len: 6.6, w: 1 }))];
    const total = models.reduce((a, m) => a + m.w, 0);
    const pick = (x: number): number => {
      let acc = 0;
      for (let i = 0; i < models.length; i++) { acc += models[i].w / total; if (x < acc) return i; }
      return models.length - 1;
    };
    // a fixed fleet sized to the island's streets — about a car every 55 m
    // of street — seeded per island, each started on its own stretch of lane
    const count = Math.max(12, Math.min(Math.round(270 * SCALE * SCALE), Math.round(g.totalLen / 55)));
    const edges = g.edges.filter(e => !g.nodes[e.a].plaza && !g.nodes[e.b].plaza && e.len > 30);
    for (let k = 0; k < count && edges.length; k++) {
      const r = rng(chunkSeed(citySeed(bx, by), 0x7af, k));
      let e = edges[(r() * edges.length) | 0], dir: 1 | -1 = r() < 0.5 ? 1 : -1, s0 = (0.2 + r() * 0.6) * e.len;
      // (never on top of another car, nor on a level crossing: a few seeded
      // tries for a clear spot)
      const onCrossing = (): boolean => e.crossings.some(cr => Math.abs((dir > 0 ? cr.s : e.len - cr.s) - s0) < CROSSING_BOOM + 5);
      for (let t = 0; t < 8 && (onCrossing() || this.cars.some(o => o.edge === e.id && o.dir === dir && Math.abs(o.s - s0) < 12)); t++) {
        e = edges[(r() * edges.length) | 0]; dir = r() < 0.5 ? 1 : -1; s0 = (0.2 + r() * 0.6) * e.len;
      }
      // (its model from a stream of its own, so the fleet's spots don't move)
      const model = pick(rng(chunkSeed(citySeed(bx, by), 0x7b0, k))());
      const car: Car = {
        id: k, edge: e.id, dir, next: e.id, s: s0,
        speed: 6 + r() * 4, v: 0, dodge: 0, r, model, len: models[model].len,
        x: 0, z: 0, h: 0, ry: 0,
      };
      car.next = this.nextEdge(car, this.endNode(car), e).id;
      car.v = car.speed;
      this.cars.push(car);
    }
    for (const c of this.cars) { this.place(c); c.ry = c.h; }
    // the fleet's meshes: the stand-in now, each kit model when it's in
    models.forEach(({ url, len }, mi) => {
      const n = this.cars.filter(c => c.model === mi).length;
      if (!n) return;
      const set = (m: { geo: THREE.BufferGeometry; mat: THREE.Material } | null): void => {
        if (!m) return;
        const old = this.meshes[mi];
        const im = new THREE.InstancedMesh(m.geo, m.mat, n);
        im.castShadow = true;
        im.receiveShadow = true;
        im.frustumCulled = false;
        im.count = 0;
        if (old) { im.count = old.count; im.instanceMatrix.copy(old.instanceMatrix); this.scene.remove(old); }
        this.meshes[mi] = im;
        this.scene.add(im);
      };
      set(fallbackModel(mi));
      carModel(url, len).then(set).catch(() => {});
    });
  }

  /** stop drawing (the island went dormant) */
  hide(): void { for (const m of this.meshes) if (m) m.count = 0; }

  dispose(): void { for (const m of this.meshes) if (m) this.scene.remove(m); }

  /** a push that moves a vehicle of radius r at world (x, z) out of the
   * car it overlaps (its footprint: its length by 2 m, a truck's 2.4), or null */
  bump(x: number, z: number, r: number): { dx: number; dz: number } | null {
    for (const c of this.cars) {
      const dx = x - c.x, dz = z - c.z;
      if (dx * dx + dz * dz > 64) continue;
      const fx = Math.sin(c.h), fz = Math.cos(c.h);
      const a = dx * fx + dz * fz, l = dx * fz - dz * fx;
      const pa = c.len / 2 + r - Math.abs(a), pl = halfW(c) + r - Math.abs(l);
      if (pa <= 0 || pl <= 0) continue;
      // out along the shallower side
      if (pl < pa) {
        const s = (l >= 0 ? 1 : -1) * pl;
        return { dx: fz * s, dz: -fx * s };
      }
      const s = (a >= 0 ? 1 : -1) * pa;
      return { dx: fx * s, dz: fz * s };
    }
    return null;
  }

  private lanePoint(e: SEdge, dir: 1 | -1, s: number, extra = 0): { x: number; z: number } {
    return lanePoint(this.graph, e, dir, s, extra);
  }

  private place(c: Car): void {
    if (c.round) {
      const { pts, cum, s } = c.round;
      let k = 0;
      while (k < pts.length - 2 && cum[k + 1] < s) k++;
      const a = pts[k], b = pts[k + 1];
      const f = Math.min(1, Math.max(0, (s - cum[k]) / (cum[k + 1] - cum[k] || 1)));
      c.x = this.ox + a.x + (b.x - a.x) * f;
      c.z = this.oz + a.z + (b.z - a.z) * f;
      c.h = Math.atan2(b.x - a.x, b.z - a.z);
      return;
    }
    const e = this.graph.edges[c.edge];
    const p = this.lanePoint(e, c.dir, c.s, c.dodge);
    c.x = this.ox + p.x;
    c.z = this.oz + p.z;
    c.h = Math.atan2(e.ux * c.dir, e.uz * c.dir);
  }

  private endNode(c: Car): SNode {
    const e = this.graph.edges[c.edge];
    return this.graph.nodes[c.dir > 0 ? e.b : e.a];
  }

  private roundPath(c: Car, node: SNode, next: SEdge): NonNullable<Car['round']> {
    return this.turnPath(c, node, next);
  }

  /** whether a car coming in on `inA` (dir `dA`) and turning into `outA`
   * would cross or come close (3.5 m, a car's width and a margin) to one
   * turning from `inB` into `outB` at the junction — each keeps to its own
   * right-hand lane, so two turns between the same two streets the opposite
   * ways, or two right turns, never meet */
  private turnsMeet(node: SNode, inA: number, dA: 1 | -1, outA: number, inB: number, dB: 1 | -1, outB: number): boolean {
    const key = `${node.id}:${inA}.${dA}>${outA}:${inB}.${dB}>${outB}`;
    let m = this.conflicts.get(key);
    if (m === undefined) {
      const g = this.graph;
      const a = junctionPath(g, g.edges[inA], dA, node, g.edges[outA]).pts;
      const b = junctionPath(g, g.edges[inB], dB, node, g.edges[outB]).pts;
      m = a.some(p => b.some(q => (p.x - q.x) ** 2 + (p.z - q.z) ** 2 < 3.5 * 3.5));
      this.conflicts.set(key, m);
    }
    return m;
  }

  /** the curve through a junction (junctionPath.ts, shared with the getaway
   * cars): a Bezier through an ordinary one, round the ring of a roundabout */
  private turnPath(c: Car, node: SNode, next: SEdge): NonNullable<Car['round']> {
    const jp = junctionPath(this.graph, this.graph.edges[c.edge], c.dir, node, next);
    return { pts: jp.pts, cum: jp.cum, s: 0, next: next.id, node: node.id, out: jp.out };
  }

  /** the next edge at a node: straight on (usually), never a U-turn unless
   * it's the only way (the causeway mouths) */
  private nextEdge(c: Car, node: SNode, from: SEdge): SEdge {
    const g = this.graph;
    const tx = from.ux * c.dir, tz = from.uz * c.dir;
    const opts = node.edges.filter(id => id !== from.id).map(id => g.edges[id]);
    if (!opts.length) return from;
    const straight = opts.find(o => { const l = leaving(g, o, node.id); return l.x * tx + l.z * tz > 0.9; });
    if (straight && c.r() < 0.62) return straight;
    return opts[(c.r() * opts.length) | 0];
  }

  /**
   * Advance every car by dt. `player` (world) makes cars brake/dodge (null =
   * no player nearby, e.g. fast-forwarding); `draw` updates the meshes;
   * `walkers` are the island's people (world spots) cars stop for.
   *
   * Every car follows the one ahead in its lane — through a junction too: a
   * car on a junction curve counts on the lane it's turning into (just
   * before its start), and a car last in its lane looks on into the street
   * it will take next. At a junction without lights cars take turns (nobody
   * starts across while another car coming from another street is on the
   * junction), at a roundabout they give way to the ring, and they stop for
   * anybody on the crosswalk ahead.
   */
  update(dt: number, elapsed: number, rail: Railway | null, player: THREE.Vector3 | null, draw: boolean,
         walkers: Array<{ x: number; z: number; xing?: number; xingOn?: boolean }> | null = null, road: Threat | null = null,
         chasers: readonly Chaser[] = []): void {
    const g = this.graph;
    // the crosswalks somebody is waiting at or crossing (the walkers say)
    const cws = crosswalksFor(this.bx, this.by);
    // (busy: somebody waiting at the kerb or out on it — a car that can still
    // stop comfortably stops for either, so the walker can go; on: somebody
    // out on the carriageway — all a car already turning, or just out of the
    // junction, stops for: stopping it for a walker still at the kerb could
    // hold the queue behind it over the stripes the walker waits to see clear)
    const busyX = new Set<number>(), onX = new Set<number>();
    if (walkers) for (const w of walkers) {
      if (w.xing !== undefined && w.xing >= 0) { busyX.add(w.xing); if (w.xingOn) onX.add(w.xing); }
    }
    // ---- who is where ----
    type Slot = { s: number; car: Car };
    const lanes = new Map<number, Slot[]>();
    const laneKey = (edge: number, dir: 1 | -1): number => edge * 2 + (dir > 0 ? 1 : 0);
    const slotOf = new Map<Car, { key: number; i: number }>();
    /** the in-streets of the cars now on each junction's curves */
    const onJunction = new Map<number, number[]>();
    /** the cars now on each junction's curves */
    const curveCars = new Map<number, Array<{ edge: number; dir: 1 | -1; out: number; s: number; car: Car }>>();
    const add = (key: number, s: number, car: Car): void => {
      let l = lanes.get(key);
      if (!l) lanes.set(key, l = []);
      l.push({ s, car });
    };
    for (const c of this.cars) {
      if (c.round) {
        const next = g.edges[c.round.next];
        const nd: 1 | -1 = next.a === c.round.node ? 1 : -1;
        add(laneKey(next.id, nd), c.round.out - (c.round.cum[c.round.cum.length - 1] - c.round.s), c);
        let j = onJunction.get(c.round.node);
        if (!j) onJunction.set(c.round.node, j = []);
        let cc = curveCars.get(c.round.node);
        if (!cc) curveCars.set(c.round.node, cc = []);
        cc.push({ edge: c.edge, dir: c.dir, out: c.round.next, s: c.round.s, car: c });
        j.push(c.edge);
      } else add(laneKey(c.edge, c.dir), c.s, c);
    }
    for (const [key, l] of lanes) {
      l.sort((p, q) => p.s - q.s || p.car.id - q.car.id);
      l.forEach((sl, i) => slotOf.set(sl.car, { key, i }));
    }
    // the walkers, in 16 m cells (a car only looks round its own cell)
    const wcells = new Map<number, Array<{ x: number; z: number }>>();
    const cellKey = (gx: number, gz: number): number => (gx + 4096) * 8192 + (gz + 4096);
    if (walkers) for (const w of walkers) {
      const k = cellKey(Math.floor(w.x / 16), Math.floor(w.z / 16));
      let l = wcells.get(k);
      if (!l) wcells.set(k, l = []);
      l.push(w);
    }
    /** slow for anybody standing in the lane just ahead (world heading h) */
    const forWalkers = (c: Car, h: number, v: number): number => {
      if (!walkers) return v;
      // (walkers only cross at the corners: mid-block there's nobody to meet)
      if (!c.round) {
        const e = g.edges[c.edge];
        if (c.s > 26 && e.len - c.s > 26) return v;
      }
      const fx = Math.sin(h), fz = Math.cos(h);
      const px = c.x + fx * 6, pz = c.z + fz * 6;
      const gx = Math.floor(px / 16), gz = Math.floor(pz / 16);
      for (let i = -1; i <= 1; i++) for (let j = -1; j <= 1; j++) {
        for (const w of wcells.get(cellKey(gx + i, gz + j)) ?? []) {
          const dx = w.x - c.x, dz = w.z - c.z;
          const a = dx * fx + dz * fz, l = dx * fz - dz * fx;
          if (a > 1 && a < 11 && Math.abs(l) < 1.8) v = Math.min(v, Math.max(0, (a - 4) * 1.2));
        }
      }
      return v;
    };
    /** metres to the car ahead (Infinity: a free road) */
    const gapAhead = (c: Car): number => Math.min(laneGap(c), turnGap(c));
    /** the car ahead that came from this car's own lane and has started its
     * turn — into another street than this one's, so in no lane of this
     * one's: stopped at the start of its curve, the car behind drove through
     * it (a getaway car held turning cars, seed 144795619, island (3,2)) */
    const turnGap = (c: Car): number => {
      const node = c.round ? c.round.node : this.endNode(c).id;
      const mine = c.round ? c.round.s : -(g.edges[c.edge].len - (g.nodes[node].plaza ? ROUND_IN : TURN_IN) - c.s);
      let gap = Infinity;
      for (const o of curveCars.get(node) ?? []) {
        if (o.car === c) continue;
        if (o.edge === c.edge && o.dir === c.dir && o.s > mine) gap = Math.min(gap, o.s - mine - lenAdj(c, o.car));

      }
      return gap;
    };
    const laneGap = (c: Car): number => {
      const sl = slotOf.get(c)!;
      const l = lanes.get(sl.key)!;
      // (measured as between two 4.4 m cars: a longer one ahead or behind
      // keeps the same bumper-to-bumper room)
      if (sl.i + 1 < l.length) return l[sl.i + 1].s - l[sl.i].s - lenAdj(c, l[sl.i + 1].car);
      if (c.round) return Infinity;
      // last on this street: the first car on the one it takes next,
      // measured along the curve both take through the junction (a car
      // on it: how far along the curve; a car beyond: the curve and on)
      const e = g.edges[c.edge], end = this.endNode(c);
      const IN = end.plaza ? ROUND_IN : TURN_IN;
      const next = g.edges[c.next];
      const nd: 1 | -1 = next.a === end.id ? 1 : -1;
      const nl = lanes.get(laneKey(next.id, nd));
      if (!nl || !nl.length || nl[0].car === c) return Infinity;
      const f = nl[0].car;
      const along = f.round && f.round.node === end.id ? f.round.s : 2 * IN + (nl[0].s - IN);
      return (e.len - IN - c.s) + along - lenAdj(c, f);
    };
    const lenAdj = (a: Car, b: Car): number => (a.len + b.len) / 2 - 4.4;
    /** the kid's road vehicle in the lane ahead (heading h): wait behind it,
     * bumper to bumper ~2.5 m, braking early enough to get there — it was
     * only seen 16 m out, stopping 6 m short of its centre, which a 6.6 m
     * truck and a 4.4 m car overlap (the push felt like being rammed) */
    const forPlayer = (c: Car, h: number, v: number): number => {
      if (!road) return v;
      const fx = Math.sin(h), fz = Math.cos(h);
      const dx = road.x - c.x, dz = road.z - c.z;
      const ahead = dx * fx + dz * fz, side = dx * fz - dz * fx;
      if (ahead <= 0 || ahead > 40 || Math.abs(side) > road.halfW + 1.8) return v;
      const room = ahead - road.halfL - c.len / 2 - 2.5;
      if (room < 5) c.kid = true;
      // (v² = 2·a·d: from here, stopping in `room` at a gentle 4 m/s²)
      return Math.min(v, Math.sqrt(Math.max(0, 8 * room)));
    };
    const follow = (gap: number, v: number): number => (gap < 16 ? Math.min(v, Math.max(0, (gap - 7) * 0.9)) : v);
    /** the getaway cars in the lane ahead: queue behind them as behind the
     * kid (G7 — a car drove straight through one) */
    const forChasers = (c: Car, h: number, v: number): number => {
      if (!chasers.length) return v;
      const fx = Math.sin(h), fz = Math.cos(h);
      for (const r of chasers) {
        const dx = r.x - c.x, dz = r.z - c.z;
        const ahead = dx * fx + dz * fz, side = dx * fz - dz * fx;
        if (ahead <= 0 || ahead > 40 || Math.abs(side) > r.halfW + 1.8) continue;
        v = Math.min(v, Math.sqrt(Math.max(0, 8 * (ahead - r.halfL - c.len / 2 - 2.5))));
      }
      return v;
    };
    /** a fleeing getaway car coming up behind in this car's lane — or
     * passing it, until it is by: ease over to the kerb and slow, so it can
     * pass (true when one is; pulled back in while it was alongside, the two
     * met) */
    const makeWay = (c: Car, hx: number, hz: number): boolean => chasers.some(r => {
      const dx = r.x - c.x, dz = r.z - c.z;
      const behind = -(dx * hx + dz * hz), side = dx * hz - dz * hx;
      if (Math.abs(side) > 3.2 || Math.sin(r.heading) * hx + Math.cos(r.heading) * hz < 0.7) return false;
      // (alongside, whatever it's doing now: stay over until it's by)
      if (behind > -(c.len / 2 + r.halfL + 1) && behind < c.len / 2 + r.halfL) return true;
      return r.pushy && behind > 0 && behind < 35;
    });

    for (const c of this.cars) {
      if (c.round) {
        // on a junction curve / roundabout ring: the stop line is behind
        // (cars commit at 18.5 m, the curve starts at 7), so only the car
        // ahead and anybody on the crossing hold it
        let vT = follow(gapAhead(c), c.speed * 0.8);
        vT = forWalkers(c, c.h, vT);
        vT = forPlayer(c, c.h, vT);
        vT = forChasers(c, c.h, vT);
        // (a getaway car where this curve goes — it bends, and a look along
        // the car's heading missed one it swung into): stop short
        // (near its way it waits, and after 2.5 s goes on — the getaway car
        // may be waiting for it in turn; right in its way it goes on after
        // 3 s only if the getaway car is standing still: it was, held at the
        // junction's edge, and the two stood for good — the last word below
        // still never lets it into the getaway car)
        let yielded = false;
        if (chasers.length) {
          const L = c.round.cum[c.round.cum.length - 1];
          for (const ds of [2, 4.5, 7]) {
            const q = alongPath(c.round, Math.min(L, c.round.s + ds));
            let d = Infinity, still = false;
            for (const r of chasers) {
              const dr = Math.hypot(r.x - q.x - this.ox, r.z - q.z - this.oz);
              if (dr < d) { d = dr; still = r.v < 0.3; }
            }
            const y = c.yieldT ?? 0;
            if ((d < 2.4 && (!still || y < 3)) || (d < 3 && y < 2.5)) { vT = Math.min(vT, Math.sqrt(Math.max(0, 10 * (ds - 2.2)))); yielded = true; break; }
          }
        }
        c.yieldT = yielded ? (c.yieldT ?? 0) + dt : 0;
        // turning into a street whose crosswalk somebody is on: stop at the
        // end of the turn, the nose short of the stripes
        {
          const cwO = cws.at(c.round.node, c.round.next);
          if (cwO && onX.has(cwO.id)) {
            const endS = c.round.cum[c.round.cum.length - 1];
            const dS = endS - c.len / 2 + (cwO.near - TURN_IN) - 0.4 - c.round.s;
            if (dS > -0.5) vT = Math.min(vT, Math.sqrt(Math.max(0, 10 * dS)));
          }
        }
        c.v += Math.max(-8 * dt, Math.min(5 * dt, vT - c.v));
        // (the last word, as the getaway car's own: never a step that takes
        // this car's body deeper into one — its side swept into one waiting
        // beside its curve, where no look ahead along the curve could see it)
        if (chasers.length && c.v > 0) {
          const L = c.round.cum[c.round.cum.length - 1];
          const q = alongPath(c.round, Math.min(L, c.round.s + c.v * dt));
          // (except driving on away from one standing behind it, its tail only
          // grazing it: the getaway car may not follow into it either, and the
          // two stood for good — seed 4242, island (2,2))
          const deeper = chasers.some(r => {
            const d0 = boxDepth(c.x, c.z, c.h, c.len / 2, r), d1 = boxDepth(q.x + this.ox, q.z + this.oz, q.h, c.len / 2, r);
            if (!(d1 > 0.2 && d1 > d0 + 0.005)) return false;
            const behind = (r.x - c.x) * Math.sin(c.h) + (r.z - c.z) * Math.cos(c.h) < 0;
            const away = Math.hypot(r.x - q.x - this.ox, r.z - q.z - this.oz) > Math.hypot(r.x - c.x, r.z - c.z);
            // (nor, held 1.5 s against one standing still, a graze past it —
            // the getaway car won't drive into this one either, and on a
            // roundabout's ring the two stood for good: seed 144795619,
            // island (3,2))
            return !(r.v < 0.3 && d1 < 0.6 && ((behind && away) || (c.deepT ?? 0) > 1.5));
          });
          c.deepT = deeper ? (c.deepT ?? 0) + dt : 0;
          if (deeper) c.v = 0;
        }
        c.round.s += c.v * dt;
        if (c.round.s >= c.round.cum[c.round.cum.length - 1]) {
          const next = g.edges[c.round.next];
          c.dir = next.a === c.round.node ? 1 : -1;
          c.edge = next.id;
          c.s = c.round.out;
          c.round = undefined;
          c.next = this.nextEdge(c, this.endNode(c), next).id;
        }
        this.place(c);
      } else {
        const e = g.edges[c.edge];
        const end = this.endNode(c);
        let vTarget = c.speed;
        let green = true;
        if (end.signalized) {
          const st = lightState(end.x, end.z, elapsed);
          green = g.phaseOf(end, e) === 'ew' ? st === 'ew' : st === 'ns';
          if (!green) {
            const dStop = e.len - STOP_LINE - c.s;
            if (dStop < 12) vTarget = Math.min(vTarget, Math.max(0, dStop * 1.4));
          }
        }
        if (rail) {
          for (const cr of e.crossings) {
            const sC = c.dir > 0 ? cr.s : e.len - cr.s;
            // (a crossing counts until the car's tail is past its far boom)
            if (sC + CROSSING_BOOM + c.len / 2 + 0.5 <= c.s) continue;
            // stop with the nose 1.2 m short of the boom line (the old 10.5 m
            // left the nose past the boom, between the barriers)
            const dStop = sC - CROSSING_BOOM - 1.2 - c.len / 2 - c.s;
            if (rail.crossingWarns(this.bx, this.by, cr.c.line, cr.c.d, elapsed)) {
              // (already past the stop point when the warning starts — or
              // caught inside by a queue — never stay on the crossing: drive
              // on until the tail is clear of the far boom, a red light
              // beyond notwithstanding)
              if (dStop > -0.5) {
                if (dStop < 16) vTarget = Math.min(vTarget, Math.max(0, dStop * 1.4));
              } else vTarget = Math.max(vTarget, Math.min(c.speed, 6));
            } else if (dStop > -0.5 && dStop < 16) {
              // keep the crossing clear: start over it only if wherever this
              // car may have to stop beyond it — behind the car ahead, at a
              // red light — leaves its whole length past the far boom (a
              // car queued at the lights just past a crossing sat with its
              // tail between the barriers)
              const clearAt = sC + CROSSING_BOOM + 0.5 + c.len / 2;
              const sl = slotOf.get(c)!, l = lanes.get(sl.key)!;
              const f = sl.i + 1 < l.length ? l[sl.i + 1] : null;
              let reach = f && !f.car.round ? f.s - f.car.len / 2 - 2.6 - c.len / 2 : Infinity;
              // where traffic may stop at the junction ahead: a roundabout's
              // give-way, a junction without lights, a red — or a green that
              // runs out before this car gets to the stop line
              // (everybody ahead beyond the crossing may queue there, this
              // car at the back of it)
              let q = 0;
              for (let j = sl.i + 1; j < l.length; j++) if (!l[j].car.round && l[j].s > sC) q += l[j].car.len + 2.6;
              let hold = Infinity;
              if (end.signalized) {
                const need = (e.len - STOP_LINE - c.s) / Math.max(3, c.speed * 0.9) + 0.5;
                if (!green || greenLeft(end.x, end.z, elapsed, g.phaseOf(end, e)) < need) hold = e.len - STOP_LINE;
              } else if ((end.plaza || (!end.mouth && end.edges.length >= 3))
                && (q > 0 || onJunction.has(end.id))) {
                // (a give-way holds a car only while somebody is on the
                // junction or queued for it: counted always, a crossing 12 m
                // short of a junction without lights left no room for any car
                // past its far boom, and they waited there for good — seed
                // 144795619, island (1,0))
                hold = e.len - (end.plaza ? ROUND_IN : TURN_IN);
              }
              if (hold < Infinity) reach = Math.min(reach, hold - q);
              if (reach < clearAt) vTarget = Math.min(vTarget, Math.max(0, dStop * 1.4));
            }
          }
        }
        // the car ahead, on this street or the next
        vTarget = follow(gapAhead(c), vTarget);
        // taking turns at a junction without lights; giving way to the ring
        // of a roundabout — held just short of the curve's start
        let holdAt = Infinity;
        if (end.plaza) {
          const E = this.lanePoint(e, c.dir, e.len - ROUND_IN);
          // (a getaway car on the ring too: entering in front of one, a car
          // T-boned it and the two stood for good — seed 144795619, island
          // (3,2))
          const busy = this.cars.some(o => o !== c && o.round && o.round.node === end.id
            && Math.hypot(o.x - this.ox - E.x, o.z - this.oz - E.z) < 11)
            || chasers.some(r => Math.hypot(r.x - this.ox - E.x, r.z - this.oz - E.z) < 11);
          if (busy) holdAt = e.len - ROUND_IN - 0.05;
        } else if (!end.signalized && !end.mouth && end.edges.length >= 3) {
          // (a getaway car moving onto or across the junction counts too —
          // it has right of way; one standing at its edge waits for the
          // traffic, and the traffic doesn't wait for it: nobody deadlocks)
          // (only a car whose way crosses or comes close to this one's: the
          // car turning back the way this one came, in the other lane, held
          // it, and a circle of such waits round a short street with a level
          // crossing in it stood for good — seed 5, island (2,2))
          const busy = (curveCars.get(end.id) ?? []).some(o => o.edge !== c.edge
              && this.turnsMeet(end, c.edge, c.dir, c.next, o.edge, o.dir, o.out))
            || chasers.some(r => r.v > 0.5 && Math.hypot(r.x - end.x - this.ox, r.z - end.z - this.oz) < TURN_IN + 4);
          if (busy) holdAt = e.len - TURN_IN - 0.05;
        }
        // don't block a junction without lights: start across it only when
        // the whole car fits in the street it turns into, past the curve — two junctions
        // without lights 33 m apart gridlocked, each one's curves holding
        // cars that waited for room on the short street between them while
        // that street's cars waited for the junctions to clear (seed
        // 144795619, island (3,2))
        // (at lights a car caught in the middle clears on the next change,
        // and holding there too made long waits: without lights nothing ever
        // breaks the circle)
        if (!end.plaza && !end.mouth && !end.signalized && end.edges.length >= 3) {
          const next = g.edges[c.next];
          const nd: 1 | -1 = next.a === end.id ? 1 : -1;
          const nl = lanes.get(laneKey(next.id, nd));
          const f = nl && nl.length && nl[0].car !== c ? nl[0] : null;
          let full = !!f && f.s - f.car.len / 2 - 2.6 < TURN_IN + c.len / 2 + 0.5;
          // (nor unless it fits short of a level crossing just beyond, should
          // the queue ahead stop there: the car ahead stopped at the
          // crossing, this one stood on the curve behind it, the cross
          // traffic waited for it — and the same at the junction at the
          // street's other end, all four for good: seed 2024, island (1,0))
          if (!full && rail) for (const cr of next.crossings) {
            const stop = (nd > 0 ? cr.s : next.len - cr.s) - CROSSING_BOOM - 1.2;
            if (stop > 60) continue;
            let room = stop;
            for (const q of nl ?? []) if (q.car !== c && q.s < stop + 1) room -= q.car.len + 2.6;
            // (a crossing so near that no car fits short of it: wait only
            // while somebody is between the junction and it)
            if (room < Math.min(stop, TURN_IN + c.len + 0.5)) full = true;
          }
          if (full) {
            // (waiting short of this street's crosswalk there, not on its
            // stripes — the walkers waited 100 s for a car holding on them;
            // one already past that point has committed and goes on)
            const cw = cws.at(end.id, e.id);
            const short = cw ? e.len - cw.far - 1.2 - c.len / 2 : e.len - TURN_IN - 0.05;
            if (c.s <= short + 0.3) holdAt = Math.min(holdAt, short);
          }
        }
        if (holdAt < Infinity) vTarget = Math.min(vTarget, Math.max(0, (holdAt - c.s) * 1.4));
        // a crosswalk with somebody waiting at it or on it: stop with the nose
        // 1.2 m short of the stripes — this street's at the junction ahead,
        // and (not starting across the junction onto it) the one on the
        // street it turns into; a car already too close to stop rolls on
        // rather than stopping on the stripes
        if (busyX.size) {
          // (the one at the junction just left, too: short of it while the
          // nose isn't over the stripes yet)
          const cwS = cws.at(c.dir > 0 ? e.a : e.b, e.id);
          if (cwS && onX.has(cwS.id)) {
            const dS0 = cwS.near - 0.4 - c.len / 2 - c.s;
            if (dS0 > -0.3) vTarget = Math.min(vTarget, Math.sqrt(Math.max(0, 10 * dS0)));
          }
          const cwIn = cws.at(end.id, e.id), cwOut = cws.at(end.id, c.next);
          if ((cwIn && busyX.has(cwIn.id)) || (cwOut && busyX.has(cwOut.id))) {
            const dS = e.len - (cwIn ? cwIn.far : 10.4) - 1.2 - c.len / 2 - c.s;
            // (braking early enough to stop there at 5 m/s²: v² = 2·a·d — the
            // gentler 1.4·d rule asked for more braking than a car has and
            // ran onto the stripes)
            if (dS > -0.5 && dS < 25) vTarget = Math.min(vTarget, Math.sqrt(Math.max(0, 10 * dS)));
          }
        }
        vTarget = forWalkers(c, c.h, vTarget);
        // the kid's road vehicle: queue behind it, ease aside when close
        vTarget = forPlayer(c, c.h, vTarget);
        vTarget = forChasers(c, c.h, vTarget);
        let dodge = 0;
        if (road) {
          const hx = e.ux * c.dir, hz = e.uz * c.dir;
          const dx = road.x - c.x, dz = road.z - c.z;
          const side = -dx * hz + dz * hx;
          if (Math.hypot(dx, dz) < 6) dodge = side > 0 ? -1.2 : 1.8; // away from the player, kerb-ward by default
        }
        // (a getaway car fleeing up behind: to the kerb, slower — it passes;
        // and while it's alongside this car doesn't start its turn across it)
        if (!dodge && makeWay(c, e.ux * c.dir, e.uz * c.dir)) {
          dodge = 1.8;
          vTarget = Math.min(vTarget, c.speed * 0.6, Math.sqrt(Math.max(0, 10 * (e.len - (end.plaza ? ROUND_IN : TURN_IN) - 1 - c.s))));
        }
        c.dodge += (dodge - c.dodge) * Math.min(1, dt * 3);
        c.v += Math.max(-8 * dt, Math.min(5 * dt, vTarget - c.v));
        c.s += c.v * dt;
        if (c.s > holdAt) { c.s = holdAt; c.v = 0; }
        const next = g.edges[c.next];
        if (end.plaza && c.s >= e.len - ROUND_IN) {
          c.round = this.roundPath(c, end, next);
        } else if (!end.plaza && c.s >= e.len - TURN_IN) {
          c.round = this.turnPath(c, end, next);
        }
        this.place(c);
      }
      // the body swings round smoothly (the path's heading steps at the
      // joints of a tight curve, like a U-turn's apex)
      let dh = c.h - c.ry;
      while (dh > Math.PI) dh -= Math.PI * 2;
      while (dh < -Math.PI) dh += Math.PI * 2;
      c.ry += Math.abs(dh) > 2.5 ? dh : dh * Math.min(1, dt * 10);
      // stuck waiting behind the kid for 3 s: one honk (then patience)
      if (c.kid && c.v < 0.4) {
        c.held = (c.held ?? 0) + dt;
        if (c.held > 3 && !c.honked) {
          c.honked = true;
          honks.push({ x: c.x, z: c.z });
          if (honks.length > 20) honks.shift();
        }
      } else if (!c.kid) { c.held = 0; c.honked = false; }
      c.kid = false;
    }
    if (!draw) return;
    // ---- draw: the cars near the player, packed into their model's mesh ----
    const used = this.meshes.map(() => 0);
    const nl = nightLights(), lamps = nl?.dark && player ? nl : null;
    for (const c of this.cars) {
      if (player && (c.x - player.x) ** 2 + (c.z - player.z) ** 2 > DRAW_R * DRAW_R) continue;
      const im = this.meshes[c.model];
      if (!im) continue;
      // (up on a deck: a causeway out over the sea, a river bridge)
      const dk = deckAt(c.x, c.z);
      _p.set(c.x, dk && dk.kind === 'road' ? dk.y : 0, c.z);
      _q.setFromAxisAngle(_y, c.ry);
      im.setMatrixAt(used[c.model]++, _m.compose(_p, _q, _s));
      // at night: its head and tail lamps, and the beam ahead (G10)
      if (lamps && (c.x - player!.x) ** 2 + (c.z - player!.z) ** 2 < LAMP_R * LAMP_R) {
        lamps.carLamps(c.x, _p.y, c.z, c.ry, c.len / 2, halfW(c), c.len > 5.2 ? 1.1 : 0.7);
      }
    }
    this.meshes.forEach((im, mi) => {
      if (!im) return;
      im.count = used[mi];
      im.instanceMatrix.needsUpdate = true;
    });
  }
}
