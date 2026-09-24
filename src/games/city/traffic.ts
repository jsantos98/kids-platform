// Ambient traffic: AI cars that actually follow the streets. Each car drives
// along the street graph's edges, picks a new edge at every junction
// (preferring straight on), keeps to the right-hand lane, stops at red lights,
// circles roundabouts and queues at level crossings while a train passes.
import * as THREE from 'three';
import { makeCar } from '../../kit/index.js';
import { spawnVehicle, wheelNodes } from '../../engine/assets.js';
import { graphFor, leaving, type StreetGraph, type SEdge, type SNode } from '../../worlds/streetGraph.js';
import { lightState, STOP_LINE } from './lights.js';
import { CROSSING_WARN_DIST } from './transit.js';
import type { Trains } from './train.js';

const MODELS = [
  '/assets/kenney/sedan.glb', '/assets/kenney/taxi.glb', '/assets/kenney/suv.glb',
  '/assets/kenney/van.glb', '/assets/kenney/police.glb', '/assets/kenney/ambulance.glb',
  '/assets/kenney/hatchback-sports.glb',
];
const FALLBACK_COLORS = [0xfaf7ef, 0xd9dde2, 0x7fb2d9, 0xe25c5c];
const LANE = 3.5; // lane centre offset from the road centreline (right-hand)

interface AI {
  edge: number;            // street-graph edge id
  dir: 1 | -1;             // +1 drives a -> b, -1 drives b -> a
  s: number;               // metres travelled along the edge from its start node
  speed: number;
  v: number;
  /** circling a roundabout: a city-local path from the entry lane point,
   * counter-clockwise (right-hand traffic) around the island, to the exit
   * lane point on the chosen next street */
  round?: { pts: Array<{ x: number; z: number }>; cum: number[]; s: number; next: number; node: number };
}

/** traffic enters the roundabout path this far before the node (the kit
 * roundabout reaches 21 m up every arm) and circles at this radius */
const ROUND_IN = 21;
const RING_R = 9;

interface TrafficCar extends THREE.Group {
  userData: { ai: AI; wheels?: THREE.Object3D[] };
}

/** right-hand perpendicular of the travel direction (screen coords: +z south) */
const rightOf = (hx: number, hz: number): { x: number; z: number } => ({ x: -hz, z: hx });

const camDir = new THREE.Vector3();

export class Traffic {
  private cars: TrafficCar[] = [];
  private graph: StreetGraph;
  /** world offset of the city the AI is driving in */
  private ox = 0;
  private oz = 0;

  constructor(private scene: THREE.Scene, count = 12,
              extraModels: string[] = [], private trains: Trains | null = null,
              private camera?: THREE.Camera) {
    this.graph = graphFor(0, 0);
    const models = [...MODELS, ...extraModels];
    for (let i = 0; i < count; i++) {
      const c = makeCar({ body: FALLBACK_COLORS[i % 4] }) as TrafficCar;
      c.userData.ai = { edge: 0, dir: 1, s: 0, speed: 6 + Math.random() * 4, v: 0 };
      scene.add(c);
      this.cars.push(c);
      spawnVehicle(models[i % models.length], { len: 4.4 }).then(g => {
        c.clear();
        c.add(g);
        c.userData.wheels = wheelNodes(g);
      }).catch(() => {});
    }
  }

  /** debug: the cars (positions + AI state) */
  get fleet(): TrafficCar[] { return this.cars; }

  /** switch cities: move the origin onto the new street graph and respawn
   * the cars near the player */
  setCity(bx: number, by: number, ox: number, oz: number, player: THREE.Vector3): void {
    this.graph = graphFor(bx, by);
    this.ox = ox;
    this.oz = oz;
    for (const c of this.cars) this.respawn(c, player);
  }

  /** would a car at world (x, z) be on camera? Roughly the camera's forward
   * hemisphere inside the fog line — anything behind it or beyond the fog is
   * a safe place to appear. */
  private inSight(x: number, z: number): boolean {
    if (!this.camera) return false;
    this.camera.getWorldDirection(camDir);
    const dx = x - this.camera.position.x, dz = z - this.camera.position.z;
    const dist = Math.hypot(dx, dz);
    if (dist < 30) return true;    // right on top of the camera
    if (dist > 170) return false;  // beyond the fog line
    const fl = Math.hypot(camDir.x, camDir.z) || 1;
    const dot = (dx * camDir.x + dz * camDir.z) / (dist * fl);
    return dot > -0.2;
  }

  private startNode(ai: AI): SNode {
    const e = this.graph.edges[ai.edge];
    return this.graph.nodes[ai.dir > 0 ? e.a : e.b];
  }

  private endNode(ai: AI): SNode {
    const e = this.graph.edges[ai.edge];
    return this.graph.nodes[ai.dir > 0 ? e.b : e.a];
  }

  /** city-local right-lane point `s` metres along edge e driven in `dir` */
  private lanePoint(e: SEdge, dir: 1 | -1, s: number): { x: number; z: number } {
    return this.graph.sample(e, dir > 0 ? s : e.len - s, dir > 0 ? LANE : -LANE);
  }

  /** Move a car onto a street edge near the player (city-local), NEVER on
   * camera: out-of-sight candidates win, and only when 24 draws produce none
   * does the farthest in-fog candidate fall through. */
  respawn(c: TrafficCar, player: THREE.Vector3): void {
    const ai = c.userData.ai;
    const g = this.graph;
    const lx = player.x - this.ox, lz = player.z - this.oz;
    const near = g.nodes.filter(n => n.edges.length && Math.abs(n.x - lx) <= 160 && Math.abs(n.z - lz) <= 160);
    if (!near.length) return;
    let best: [number, 1 | -1, number] | null = null;
    let bestDist = -1;
    for (let tries = 0; tries < 24; tries++) {
      const n = near[(Math.random() * near.length) | 0];
      const e = g.edges[n.edges[(Math.random() * n.edges.length) | 0]];
      const dir: 1 | -1 = e.a === n.id ? 1 : -1;
      // never drop a car inside a roundabout's ring
      const nearRound = n.plaza || g.other(e, n.id).plaza;
      const s = (nearRound ? 0.36 + Math.random() * 0.28 : Math.random() * 0.7) * e.len;
      const p = this.lanePoint(e, dir, s);
      const wx = this.ox + p.x, wz = this.oz + p.z;
      const dp = Math.hypot(wx - player.x, wz - player.z);
      if (dp > 190 || dp < 25) continue; // keep the fleet in the active ring
      // no ghost stacks: keep clear of the rest of the fleet
      let crowded = false;
      for (const o of this.cars) {
        if (o !== c && Math.hypot(o.position.x - wx, o.position.z - wz) < 14) { crowded = true; break; }
      }
      if (crowded) continue;
      if (!this.inSight(wx, wz)) {
        Object.assign(ai, { edge: e.id, dir, s, v: ai.speed, round: undefined });
        this.place(c, ai);
        return;
      }
      if (dp > bestDist) { best = [e.id, dir, s]; bestDist = dp; }
    }
    if (best) { // everything drawn was on camera — the fog covers the farthest
      Object.assign(ai, { edge: best[0], dir: best[1], s: best[2], v: ai.speed, round: undefined });
      this.place(c, ai);
    }
  }

  /** world position + heading for a car's current progress */
  private place(c: TrafficCar, ai: AI): void {
    if (ai.round) {
      const { pts, cum, s } = ai.round;
      let k = 0;
      while (k < pts.length - 2 && cum[k + 1] < s) k++;
      const a = pts[k], b = pts[k + 1];
      const f = Math.min(1, Math.max(0, (s - cum[k]) / (cum[k + 1] - cum[k] || 1)));
      c.position.set(this.ox + a.x + (b.x - a.x) * f, 0, this.oz + a.z + (b.z - a.z) * f);
      c.rotation.y = Math.atan2(b.x - a.x, b.z - a.z);
      return;
    }
    const e = this.graph.edges[ai.edge];
    const p = this.lanePoint(e, ai.dir, ai.s);
    c.position.set(this.ox + p.x, 0, this.oz + p.z);
    c.rotation.y = Math.atan2(e.ux * ai.dir, e.uz * ai.dir);
  }

  /** the path around roundabout node `node` from the current edge onto
   * edge `next`: entry lane point ROUND_IN before the node, counter-
   * clockwise on screen (north up — right-hand traffic) around the island
   * at RING_R, out to the exit lane point ROUND_IN along the next street */
  private roundPath(ai: AI, node: SNode, next: SEdge): NonNullable<AI['round']> {
    const e = this.graph.edges[ai.edge];
    const nextDir: 1 | -1 = next.a === node.id ? 1 : -1;
    const E = this.lanePoint(e, ai.dir, e.len - ROUND_IN);
    const X = this.lanePoint(next, nextDir, ROUND_IN);
    // ring angles where the lanes meet the circle; with +z pointing south,
    // counter-clockwise on screen means atan2(z, x) DECREASES
    const hin = { x: e.ux * ai.dir, z: e.uz * ai.dir };
    const hout = leaving(this.graph, next, node.id);
    const rin = rightOf(hin.x, hin.z), rout = rightOf(hout.x, hout.z);
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
    for (let k = 1; k < pts.length; k++) {
      cum.push(cum[k - 1] + Math.hypot(pts[k].x - pts[k - 1].x, pts[k].z - pts[k - 1].z));
    }
    return { pts, cum, s: 0, next: next.id, node: node.id };
  }

  update(dt: number, elapsed: number, player: THREE.Vector3): void {
    const g = this.graph;
    for (const c of this.cars) {
      const ai = c.userData.ai;
      if (ai.round) {
        // circling a roundabout: plazas are unsignalized, and crossings keep
        // 30 m clear of them, so the ring is a free run
        ai.v += Math.max(-8 * dt, Math.min(5 * dt, ai.speed * 0.8 - ai.v));
        ai.round.s += ai.v * dt;
        const total = ai.round.cum[ai.round.cum.length - 1];
        if (ai.round.s >= total) {
          // hand over to the next street exactly at the exit lane point
          const next = g.edges[ai.round.next];
          ai.dir = next.a === ai.round.node ? 1 : -1;
          ai.edge = next.id;
          ai.s = ROUND_IN;
          ai.round = undefined;
        }
        this.place(c, ai);
        for (const w of (c.userData.wheels ?? [])) (w as THREE.Object3D).rotation.x += (ai.v * dt) / 0.42;
        if (c.position.distanceTo(player) > 190) this.respawn(c, player);
        continue;
      }
      const e = g.edges[ai.edge];
      const end = this.endNode(ai);

      // ---- speed target: red lights + level crossings ----
      let vTarget = ai.speed;

      // red lights at the junction we're approaching
      if (end.signalized) {
        const st = lightState(end.x, end.z, elapsed);
        const green = g.phaseOf(end, e) === 'ew' ? st === 'ew' : st === 'ns';
        if (!green) {
          const dStop = e.len - STOP_LINE - ai.s;
          if (dStop < 12) vTarget = Math.min(vTarget, Math.max(0, dStop * 1.4));
        }
      }

      // level crossings on this edge: hold back while the crossing is
      // warning (lamps flashing, booms closing) for a train
      if (this.trains) {
        for (const cr of e.crossings) {
          const sC = ai.dir > 0 ? cr.s : e.len - cr.s;
          if (sC <= ai.s) continue; // already past it — keep going
          if (this.trains.distTo(cr.c.d) < CROSSING_WARN_DIST) {
            const dStop = sC - 10.5 - ai.s;
            if (dStop < 16) vTarget = Math.min(vTarget, Math.max(0, dStop * 1.4));
          }
        }
      }

      // approach the node; pick the next street on arrival
      ai.v += Math.max(-8 * dt, Math.min(5 * dt, vTarget - ai.v));
      ai.s += ai.v * dt;
      if (end.plaza && ai.s >= e.len - ROUND_IN) {
        // a roundabout ahead: pick the exit now and follow the ring
        const next = this.nextEdge(end, e, ai.dir);
        if (next) {
          ai.round = this.roundPath(ai, end, next);
          this.place(c, ai);
          continue;
        }
      }
      if (ai.s >= e.len) {
        const over = ai.s - e.len;
        const next = this.nextEdge(end, e, ai.dir);
        if (next) {
          ai.dir = next.a === end.id ? 1 : -1;
          ai.edge = next.id;
          ai.s = over;
        } else {
          ai.s = e.len - 0.1; // boxed in (shouldn't happen on a connected graph)
        }
      }
      this.place(c, ai);

      for (const w of (c.userData.wheels ?? [])) (w as THREE.Object3D).rotation.x += (ai.v * dt) / 0.42;
      if (c.position.distanceTo(player) > 190) this.respawn(c, player);
    }
  }

  /** choose the next edge at a node: prefer straight on, never U-turn unless
   * it's the only option. Returns null when nothing is open. */
  private nextEdge(node: SNode, from: SEdge, dir: 1 | -1): SEdge | null {
    const g = this.graph;
    const tx = from.ux * dir, tz = from.uz * dir;
    const opts = node.edges.filter(id => id !== from.id).map(id => g.edges[id]);
    if (!opts.length) return node.edges.length ? from : null;
    const straight = opts.find(o => {
      const l = leaving(g, o, node.id);
      return l.x * tx + l.z * tz > 0.9;
    });
    if (straight && Math.random() < 0.62) return straight;
    return opts[(Math.random() * opts.length) | 0];
  }
}
