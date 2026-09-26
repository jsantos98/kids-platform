// The robber chase (police car, police helicopter): a getaway car drives the
// island's street graph — cruising when the police are far, fleeing when
// they close in: at every junction it takes the street that leads away from
// them (now and then a random one), never back the way it came unless the
// street ends, and never out onto a causeway. It is a little slower than
// the police car flat out, so a kid who keeps after it always catches it.
// Catching: the police car stays within CATCH_R of it for CATCH_T seconds
// in all; the helicopter keeps it inside its searchlight for as long.
// Several are on the run at once (ROBBERS); each keeps its own progress.
// It is solid: the police car bumping into it knocks the police car back,
// and the getaway car DASHES off (faster than the police for DASH_T s,
// away from them), then tires for DASH_REST s before it can dash again — a
// bump is part of the chase, not its end. The police helicopter's
// searchlight startles it the same way once it has been lit SPOT_T s.
import * as THREE from 'three';
import { rng, type Rng } from '../../engine/rng.js';
import { spawnVehicle } from '../../engine/assets.js';
import { graphFor, type StreetGraph, type SEdge, type SNode } from '../../worlds/streetGraph.js';
import { junctionPath, alongPath, ROUND_IN, TURN_IN, type JunctionPath } from './island/junctionPath.js';
import { deckAt } from '../../worlds/causeway.js';
import { makeIconSprite, GOAL_ICON } from './guide3d.js';

export const CATCH_R = 9;
export const CATCH_T = 4;
/** getaway cars on the run at once (G7) */
export const ROBBERS = 3;
const FLEE_R = 90;
const V_FLEE = 9.5, V_CRUISE = 5.5; // m/s (the police car tops out at 12.5)
const LANE = 3.5;
/** the dash after a bump: its speed, how long it lasts, and the rest after it */
export const DASH_V = 15, DASH_T = 2.2, DASH_REST = 2.5;
/** seconds in the helicopter's searchlight before the getaway car bolts */
const SPOT_T = 0.5;
/** the getaway car's footprint (the Car Kit sedan) */
const HALF_L = 2.2, HALF_W = 1.0;

export class Robber {
  readonly group = new THREE.Group();
  private graph: StreetGraph | null = null;
  private edge: SEdge | null = null;
  /** taking a junction on its curve (and the street it leads onto) */
  private curve: (JunctionPath & { s: number; next: SEdge; node: number }) | null = null;
  private dir: 1 | -1 = 1;
  private s = 0;
  private v = 0;
  private ox = 0;
  private oz = 0;
  private r: Rng = rng(1);
  /** seconds of catching so far */
  caught = 0;
  active = false;
  /** seconds left of the dash after a bump, and of the rest after it */
  dashT = 0;
  private restT = 0;
  private litT = 0;
  private marker: THREE.Sprite;

  constructor(private scene: THREE.Scene) {
    const stub = new THREE.Mesh(new THREE.BoxGeometry(1.9, 1.2, 4.2), new THREE.MeshLambertMaterial({ color: 0x3b3b46 }));
    stub.position.y = 0.8;
    this.group.add(stub);
    spawnVehicle('/assets/kenney/sedan.glb', { len: 4.4 }).then(g => {
      this.group.remove(stub);
      g.traverse(o => { const m = o as THREE.Mesh; if (m.isMesh) m.castShadow = true; });
      this.group.add(g);
    }).catch(() => {});
    // the robber's icon (the HUD badge's) bobbing over the getaway car
    this.marker = makeIconSprite(GOAL_ICON.robber, 2.6);
    this.group.add(this.marker);
    this.group.visible = false;
    scene.add(this.group);
  }

  /** start a getaway on island (bx, by) (world offset ox, oz), on a street
   * 120-260 m from the police at (px, pz) and 80 m from the other getaway
   * cars (`avoid`, world) */
  spawn(bx: number, by: number, ox: number, oz: number, px: number, pz: number, seed: number,
        avoid: Array<{ x: number; z: number }> = []): void {
    this.graph = graphFor(bx, by);
    this.ox = ox; this.oz = oz;
    this.r = rng(seed);
    const g = this.graph;
    const ok = g.edges.filter(e => {
      if (g.nodes[e.a].mouth || g.nodes[e.b].mouth || e.len < 30) return false;
      const m = g.sample(e, e.len / 2);
      const d = Math.hypot(m.x + ox - px, m.z + oz - pz);
      return d > 120 && d < 260 && avoid.every(q => Math.hypot(m.x + ox - q.x, m.z + oz - q.z) > 80);
    });
    const pool = ok.length ? ok : g.edges.filter(e => !g.nodes[e.a].mouth && !g.nodes[e.b].mouth);
    this.edge = pool[(this.r() * pool.length) | 0];
    this.dir = this.r() < 0.5 ? 1 : -1;
    this.s = this.edge.len / 2;
    this.curve = null;
    this.v = V_CRUISE;
    this.caught = 0;
    this.dashT = 0;
    this.restT = 0;
    this.litT = 0;
    this.active = true;
    this.group.visible = true;
    this.place(0, 0);
  }

  /** world position */
  get x(): number { return this.group.position.x; }
  get z(): number { return this.group.position.z; }

  /** drive on; (px, pz) = the police (world) */
  update(dt: number, elapsed: number, px: number, pz: number, frozen = false): void {
    if (!this.active || !this.graph || !this.edge) return;
    const d = Math.hypot(this.x - px, this.z - pz);
    if (this.dashT > 0) {
      this.dashT -= dt;
      if (this.dashT <= 0) this.restT = DASH_REST;
    } else if (this.restT > 0) this.restT -= dt;
    const dash = this.dashT > 0 && !frozen;
    const target = frozen ? 0 : dash ? DASH_V : d < FLEE_R ? V_FLEE : V_CRUISE;
    this.v += Math.max(-6 * dt, Math.min((dash ? 9 : 3) * dt, target - this.v));
    // along the street to the junction's curve, round it (junctionPath.ts —
    // the curve the traffic takes), on along the next street
    let left = this.v * dt;
    const g = this.graph;
    for (let guard = 0; guard < 6 && left > 0; guard++) {
      const C = this.curve;
      if (C) {
        const L = C.cum[C.cum.length - 1];
        if (C.s + left < L) { C.s += left; left = 0; break; }
        left -= L - C.s;
        this.edge = C.next;
        this.dir = C.next.a === C.node ? 1 : -1;
        this.s = this.dir > 0 ? C.out : C.next.len - C.out;
        this.curve = null;
        continue;
      }
      const e = this.edge!, node = g.nodes[this.dir > 0 ? e.b : e.a];
      const IN = node.plaza ? ROUND_IN : TURN_IN;
      const toCurve = (this.dir > 0 ? e.len - this.s : this.s) - IN;
      if (left < toCurve) { this.s += left * this.dir; left = 0; break; }
      left -= Math.max(0, toCurve);
      this.s = this.dir > 0 ? e.len - IN : IN;
      const next = this.nextStreet(node, px, pz, d < FLEE_R || dash);
      this.curve = { ...junctionPath(g, e, this.dir, node, next), s: 0, next, node: node.id };
    }
    this.place(elapsed, dt);
  }

  /** at a junction: the next street */
  private nextStreet(node: SNode, px: number, pz: number, flee: boolean): SEdge {
    const g = this.graph!, e = this.edge!;
    const at = node.id;
    let opts = node.edges.map(id => g.edges[id]).filter(o => o.id !== e.id && !g.nodes[o.a === at ? o.b : o.a].mouth);
    if (!opts.length) opts = [e]; // the street ends here: back the way it came
    let next: SEdge;
    if (flee && this.r() > 0.2) {
      // away from the police: the far end that ends up farthest from them
      next = opts.reduce((best, o) => {
        const far = g.nodes[o.a === at ? o.b : o.a];
        const b = g.nodes[best.a === at ? best.b : best.a];
        return Math.hypot(far.x + this.ox - px, far.z + this.oz - pz) > Math.hypot(b.x + this.ox - px, b.z + this.oz - pz) ? o : best;
      });
    } else next = opts[(this.r() * opts.length) | 0];
    return next;
  }

  private place(elapsed: number, dt: number): void {
    const g = this.graph!, e = this.edge!;
    // the right-hand lane of its direction of travel, or its junction curve
    let p: { x: number; z: number }, h: number;
    if (this.curve) {
      const a = alongPath(this.curve, this.curve.s);
      p = a; h = a.h;
    } else {
      p = g.sample(e, this.s, LANE * this.dir);
      h = this.dir > 0 ? e.heading : e.heading + Math.PI;
    }
    const dk = deckAt(p.x + this.ox, p.z + this.oz);
    this.group.position.set(p.x + this.ox, dk && dk.kind === 'road' ? dk.y : 0, p.z + this.oz);
    // turn smoothly into the new street
    let dh = h - this.group.rotation.y;
    while (dh > Math.PI) dh -= Math.PI * 2;
    while (dh < -Math.PI) dh += Math.PI * 2;
    this.group.rotation.y += dt > 0 ? dh * Math.min(1, dt * 8) : dh;
    this.marker.position.set(0, 3.9 + Math.sin(elapsed * 3) * 0.3, 0);
  }

  /**
   * The police car at world (x, z), radius r: if it overlaps the getaway
   * car, the way out of its footprint (along the shallower side) — and,
   * unless it is dashing or resting, the getaway car starts a dash.
   */
  bump(x: number, z: number, r: number): { dx: number; dz: number; dashed: boolean } | null {
    if (!this.active) return null;
    const dx = x - this.x, dz = z - this.z;
    if (dx * dx + dz * dz > 64) return null;
    const h = this.group.rotation.y, fx = Math.sin(h), fz = Math.cos(h);
    const a = dx * fx + dz * fz, l = dx * fz - dz * fx;
    const pa = HALF_L + r - Math.abs(a), pl = HALF_W + r - Math.abs(l);
    if (pa <= 0 || pl <= 0) return null;
    const dashed = this.startle();
    if (pl < pa) {
      const k = (l >= 0 ? 1 : -1) * pl;
      return { dx: fz * k, dz: -fx * k, dashed };
    }
    const k = (a >= 0 ? 1 : -1) * pa;
    return { dx: fx * k, dz: fz * k, dashed };
  }

  /** the police got to it: dash off, unless dashing or resting already */
  startle(): boolean {
    if (this.dashT > 0 || this.restT > 0) return false;
    this.dashT = DASH_T;
    return true;
  }

  /** the police helicopter's searchlight on it (or not) this frame: lit for
   * SPOT_T s in a row, it bolts */
  spotted(lit: boolean, dt: number): boolean {
    this.litT = lit ? this.litT + dt : 0;
    return this.litT >= SPOT_T && this.startle();
  }

  hide(): void { this.active = false; this.group.visible = false; }
}
