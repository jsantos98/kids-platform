// An island's cars: a fixed, seeded fleet that lives on this island for good.
// Every car starts on a seeded street spot and drives the street graph
// continuously — right-hand lane, red lights, level crossings, roundabouts,
// U-turns at the causeway mouths so it never leaves the island. Nothing ever
// respawns or teleports: cars far from the player are simply not drawn.
// They never hit the player either: a car brakes when the player is in the
// lane ahead and eases toward the kerb when the player gets close.
import * as THREE from 'three';
import { rng, chunkSeed, type Rng } from '../../../engine/rng.js';
import { makeCar } from '../../../kit/index.js';
import { spawnVehicle, wheelNodes } from '../../../engine/assets.js';
import { citySeed } from '../../../worlds/cityGrid.js';
import { SCALE } from '../../../worlds/world.js';
import { graphFor, leaving, type StreetGraph, type SEdge, type SNode } from '../../../worlds/streetGraph.js';
import { lightState, STOP_LINE } from '../lights.js';
import { CROSSING_WARN_DIST } from '../transit.js';
import { deckAt } from '../../../worlds/causeway.js';
import type { Railway } from '../railway.js';

const MODELS = [
  '/assets/kenney/sedan.glb', '/assets/kenney/taxi.glb', '/assets/kenney/suv.glb',
  '/assets/kenney/van.glb', '/assets/kenney/police.glb', '/assets/kenney/ambulance.glb',
  '/assets/kenney/hatchback-sports.glb',
];
const FALLBACK_COLORS = [0xfaf7ef, 0xd9dde2, 0x7fb2d9, 0xe25c5c];
const LANE = 3.5;
const ROUND_IN = 21;
const RING_R = 9;
/** an ordinary junction is taken on a curve from this far before the node
 * to this far after it (the 14 m junction pad) — never a jump between lanes */
const TURN_IN = 7;
/** cars farther than this from the player aren't drawn (the fog is ~260 m) */
const DRAW_R = 190;

interface Car {
  edge: number;
  dir: 1 | -1;
  s: number;
  speed: number;
  v: number;
  /** eases toward the kerb when the player crowds the car (m, + = right) */
  dodge: number;
  r: Rng;
  model: number;
  /** crossing a node on a curve (junction turn or roundabout ring) */
  round?: { pts: Array<{ x: number; z: number }>; cum: number[]; s: number; next: number; node: number; out: number };
  obj: THREE.Group;
  wheels: THREE.Object3D[];
  loaded: boolean;
  /** world position this frame */
  x: number;
  z: number;
  h: number;
}

/** the procedural stand-in shown until a car's kit model streams in: built
 * once per colour and cloned (a clone shares its geometry) — building one
 * per car cost ~6 ms each, ~150 ms per island waking */
const fallbacks: THREE.Group[] = [];
function fallbackCar(k: number): THREE.Group {
  fallbacks[k] ??= makeCar({ body: FALLBACK_COLORS[k] });
  return fallbacks[k].clone();
}

/** an AI car's footprint (half length / half width, m) */
const CAR_HALF_L = 2.2, CAR_HALF_W = 1.0;
const rightOf = (hx: number, hz: number): { x: number; z: number } => ({ x: -hz, z: hx });

export class IslandCars {
  readonly cars: Car[] = [];
  private graph: StreetGraph;

  constructor(private scene: THREE.Scene, readonly bx: number, readonly by: number,
              private ox: number, private oz: number, extraModels: string[] = []) {
    this.graph = graphFor(bx, by);
    const g = this.graph;
    const models = [...MODELS, ...extraModels];
    // a fixed fleet sized to the island's streets, seeded per island
    // (8-24 on an 896 m island; the cap grows with the island's area)
    const count = Math.max(8, Math.min(Math.round(24 * SCALE * SCALE), Math.round(g.totalLen / 160)));
    const edges = g.edges.filter(e => !g.nodes[e.a].plaza && !g.nodes[e.b].plaza);
    for (let k = 0; k < count && edges.length; k++) {
      const r = rng(chunkSeed(citySeed(bx, by), 0x7af, k));
      const e = edges[(r() * edges.length) | 0];
      const obj = new THREE.Group();
      obj.add(fallbackCar(k % 4));
      obj.visible = false;
      scene.add(obj);
      const car: Car = {
        edge: e.id, dir: r() < 0.5 ? 1 : -1, s: (0.2 + r() * 0.6) * e.len,
        speed: 6 + r() * 4, v: 0, dodge: 0, r, model: k % models.length,
        obj, wheels: [], loaded: false, x: 0, z: 0, h: 0,
      };
      car.v = car.speed;
      this.cars.push(car);
      spawnVehicle(models[car.model], { len: 4.4 }).then(m => {
        obj.clear();
        obj.add(m);
        car.wheels = wheelNodes(m);
        car.loaded = true;
      }).catch(() => {});
    }
    for (const c of this.cars) this.place(c);
  }

  /** stop drawing (the island went dormant) */
  hide(): void { for (const c of this.cars) c.obj.visible = false; }

  dispose(): void { for (const c of this.cars) this.scene.remove(c.obj); }

  /** a push that moves a vehicle of radius r at world (x, z) out of the
   * car it overlaps (a car's footprint as a 4.4 x 2 m box), or null */
  bump(x: number, z: number, r: number): { dx: number; dz: number } | null {
    for (const c of this.cars) {
      const dx = x - c.x, dz = z - c.z;
      if (dx * dx + dz * dz > 64) continue;
      const fx = Math.sin(c.h), fz = Math.cos(c.h);
      const a = dx * fx + dz * fz, l = dx * fz - dz * fx;
      const pa = CAR_HALF_L + r - Math.abs(a), pl = CAR_HALF_W + r - Math.abs(l);
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
    return this.graph.sample(e, dir > 0 ? s : e.len - s, (dir > 0 ? 1 : -1) * (LANE + extra));
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
    const e = this.graph.edges[c.edge];
    const nextDir: 1 | -1 = next.a === node.id ? 1 : -1;
    const E = this.lanePoint(e, c.dir, e.len - ROUND_IN);
    const X = this.lanePoint(next, nextDir, ROUND_IN);
    const hin = { x: e.ux * c.dir, z: e.uz * c.dir };
    const hout = leaving(this.graph, next, node.id);
    const rin = rightOf(hin.x, hin.z), rout = rightOf(hout.x, hout.z);
    // counter-clockwise on screen (+z south): atan2(z, x) decreases
    const aE = Math.atan2(-hin.z * RING_R + rin.z * LANE, -hin.x * RING_R + rin.x * LANE);
    const aX = Math.atan2(hout.z * RING_R + rout.z * LANE, hout.x * RING_R + rout.x * LANE);
    let sweep = aE - aX;
    while (sweep <= 0.2) sweep += Math.PI * 2;
    const pts: Array<{ x: number; z: number }> = [E];
    const n = Math.max(4, Math.ceil((sweep * RING_R) / 2));
    for (let q = 0; q <= n; q++) {
      const a = aE - (sweep * q) / n;
      pts.push({ x: node.x + Math.cos(a) * RING_R, z: node.z + Math.sin(a) * RING_R });
    }
    pts.push(X);
    const cum = [0];
    for (let k = 1; k < pts.length; k++) cum.push(cum[k - 1] + Math.hypot(pts[k].x - pts[k - 1].x, pts[k].z - pts[k - 1].z));
    return { pts, cum, s: 0, next: next.id, node: node.id, out: ROUND_IN };
  }

  /** the curve through an ordinary junction: from the lane point TURN_IN
   * before the node to the next street's lane point TURN_IN after it, bent
   * through the corner where the two lanes meet (a quadratic Bezier — a
   * straight run, a turn or a U-turn at a mouth all come out smooth) */
  private turnPath(c: Car, node: SNode, next: SEdge): NonNullable<Car['round']> {
    const e = this.graph.edges[c.edge];
    const nextDir: 1 | -1 = next.a === node.id ? 1 : -1;
    const E = this.lanePoint(e, c.dir, e.len - TURN_IN);
    const X = this.lanePoint(next, nextDir, TURN_IN);
    const hin = { x: e.ux * c.dir, z: e.uz * c.dir };
    const hout = leaving(this.graph, next, node.id);
    const rin = rightOf(hin.x, hin.z), rout = rightOf(hout.x, hout.z);
    const straight = hin.x * hout.x + hin.z * hout.z > 0.9;
    const uturn = hin.x * hout.x + hin.z * hout.z < -0.9;
    // control point: where the two lane lines cross (the lane corner); a
    // straight run just uses the midpoint, a U-turn swings out past the node
    const C = straight ? { x: (E.x + X.x) / 2, z: (E.z + X.z) / 2 }
      : uturn ? { x: node.x + hin.x * TURN_IN, z: node.z + hin.z * TURN_IN }
        : { x: node.x + (rin.x + rout.x) * LANE, z: node.z + (rin.z + rout.z) * LANE };
    const pts: Array<{ x: number; z: number }> = [];
    const n = 10;
    for (let q = 0; q <= n; q++) {
      const t = q / n, u = 1 - t;
      pts.push({ x: u * u * E.x + 2 * u * t * C.x + t * t * X.x, z: u * u * E.z + 2 * u * t * C.z + t * t * X.z });
    }
    const cum = [0];
    for (let k = 1; k < pts.length; k++) cum.push(cum[k - 1] + Math.hypot(pts[k].x - pts[k - 1].x, pts[k].z - pts[k - 1].z));
    return { pts, cum, s: 0, next: next.id, node: node.id, out: TURN_IN };
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
   * no player nearby, e.g. fast-forwarding); `draw` updates the meshes.
   */
  update(dt: number, elapsed: number, rail: Railway | null, player: THREE.Vector3 | null, draw: boolean): void {
    const g = this.graph;
    for (const c of this.cars) {
      if (c.round) {
        // on a junction curve / roundabout ring: the stop line is behind
        // (cars commit at 18.5 m, the curve starts at 7), so it's a free run
        c.v += Math.max(-8 * dt, Math.min(5 * dt, c.speed * 0.8 - c.v));
        c.round.s += c.v * dt;
        if (c.round.s >= c.round.cum[c.round.cum.length - 1]) {
          const next = g.edges[c.round.next];
          c.dir = next.a === c.round.node ? 1 : -1;
          c.edge = next.id;
          c.s = c.round.out;
          c.round = undefined;
        }
        this.place(c);
      } else {
        const e = g.edges[c.edge];
        const end = this.endNode(c);
        let vTarget = c.speed;
        if (end.signalized) {
          const st = lightState(end.x, end.z, elapsed);
          const green = g.phaseOf(end, e) === 'ew' ? st === 'ew' : st === 'ns';
          if (!green) {
            const dStop = e.len - STOP_LINE - c.s;
            if (dStop < 12) vTarget = Math.min(vTarget, Math.max(0, dStop * 1.4));
          }
        }
        if (rail) {
          for (const cr of e.crossings) {
            const sC = c.dir > 0 ? cr.s : e.len - cr.s;
            if (sC <= c.s) continue;
            if (rail.distTo(this.bx, this.by, cr.c.line, cr.c.d, elapsed) < CROSSING_WARN_DIST) {
              const dStop = sC - 10.5 - c.s;
              if (dStop < 16) vTarget = Math.min(vTarget, Math.max(0, dStop * 1.4));
            }
          }
        }
        // queue behind the car ahead in the same lane (a fixed fleet would
        // otherwise stack up on the stop line)
        for (const o of this.cars) {
          if (o === c || o.round || o.edge !== c.edge || o.dir !== c.dir) continue;
          const gap = o.s - c.s;
          if (gap > 0 && gap < 16) vTarget = Math.min(vTarget, Math.max(0, (gap - 7) * 0.9));
        }
        // the player: brake for them in the lane ahead, ease aside when close
        let dodge = 0;
        if (player) {
          const hx = e.ux * c.dir, hz = e.uz * c.dir;
          const dx = player.x - c.x, dz = player.z - c.z;
          const ahead = dx * hx + dz * hz, side = -dx * hz + dz * hx;
          if (ahead > 0 && ahead < 16 && Math.abs(side) < 3) vTarget = Math.min(vTarget, Math.max(0, (ahead - 6) * 0.8));
          if (Math.hypot(dx, dz) < 6) dodge = side > 0 ? -1.2 : 1.8; // away from the player, kerb-ward by default
        }
        c.dodge += (dodge - c.dodge) * Math.min(1, dt * 3);
        c.v += Math.max(-8 * dt, Math.min(5 * dt, vTarget - c.v));
        c.s += c.v * dt;
        if (end.plaza && c.s >= e.len - ROUND_IN) {
          c.round = this.roundPath(c, end, this.nextEdge(c, end, e));
        } else if (!end.plaza && c.s >= e.len - TURN_IN) {
          c.round = this.turnPath(c, end, this.nextEdge(c, end, e));
        }
        this.place(c);
      }
      if (draw) {
        const near = !player || Math.hypot(c.x - player.x, c.z - player.z) < DRAW_R;
        c.obj.visible = near;
        if (near) {
          // (up on a causeway's deck where the avenue runs out over the sea)
          const dk = deckAt(c.x, c.z);
          c.obj.position.set(c.x, dk && dk.kind === 'road' ? dk.y : 0, c.z);
          // the body swings round smoothly (the path's heading steps at the
          // joints of a tight curve, like a U-turn's apex)
          let dh = c.h - c.obj.rotation.y;
          while (dh > Math.PI) dh -= Math.PI * 2;
          while (dh < -Math.PI) dh += Math.PI * 2;
          c.obj.rotation.y += Math.abs(dh) > 2.5 ? dh : dh * Math.min(1, dt * 10);
          for (const w of c.wheels) w.rotation.x += (c.v * dt) / 0.42;
        }
      }
    }
  }
}
