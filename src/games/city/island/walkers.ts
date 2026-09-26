// An island's pedestrians and pets: a fixed, seeded crowd that lives on this
// island for good. Each walker strolls the sidewalk beside a street-graph
// edge, carries straight on across junctions when the street continues and
// turns back where it ends (or before a roundabout ring). A ground vehicle
// coming their way makes them leap SIDEWAYS out of its path (never down it
// — a truck outruns anyone), onto ground the occupancy grid allows, and a
// hard clamp keeps everyone outside its footprint every frame, so nobody can
// ever be run over (G8); then they drift back onto their sidewalk and carry
// on. They wait at a level crossing while a train is near (and hurry off it).
// Nobody respawns.
import * as THREE from 'three';
import { rng, chunkSeed, type Rng } from '../../../engine/rng.js';
import { makeVillager } from '../../../kit/index.js';
import { bakeObjectToMesh, templateToMesh } from '../../../engine/baked.js';
import { citySeed } from '../../../worlds/cityGrid.js';
import { SCALE } from '../../../worlds/world.js';
import { occupancyFor, LOT, PLAZA, SEA, RIVER, RAIL, ROAD, type Occupancy } from '../../../worlds/grid.js';
import { coastFor, type Coast } from '../../../worlds/coast.js';
import { ROUNDABOUT_REACH } from '../../../worlds/cityPlan.js';
import { lightState } from '../lights.js';
import { graphFor, leaving, type StreetGraph, type SEdge, type SNode } from '../../../worlds/streetGraph.js';
import { crosswalksFor, type Crosswalk, type Crosswalks } from '../../../worlds/crosswalks.js';
import type { BakedTemplate } from '../../../engine/assets.js';
import type { Railway } from '../railway.js';
import { deckAt } from '../../../worlds/causeway.js';

/** kit characters are ~0.7 units tall; scale them to villager height (~1.6 m) */
const PED_SCALE = 2.2;
const DRAW_R = 150;
const FLEE_R = 12;
/** walkers keep this far outside a vehicle's footprint (m) */
export const WALK_CLEAR = 0.6;
/** sideways leap out of a vehicle's path (m/s) */
const DODGE_V = 7;
/** a walker in a vehicle's path this many seconds ahead of it steps aside */
const LOOK = 2.2;
/** ground a dodging walker may not step onto */
const NO_DODGE = LOT | RIVER | SEA | RAIL | PLAZA;
/** walkers hold short of a level crossing while a train is this near (m of
 * track) — farther than the cars' warning: they are slower to clear it */
const WALK_WARN = 90;

/** a ground vehicle the walkers get out of the way of (world coordinates;
 * heading atan2(x, z), v signed, footprint half-length / half-width) */
export interface Threat { x: number; z: number; heading: number; v: number; halfL: number; halfW: number }

interface Walker {
  edge: number;
  dir: 1 | -1;
  /** position along the edge from its node a, and the sidewalk offset (+ = right of a->b) */
  s: number;
  side: number;
  speed: number;
  phase: number;
  pet: boolean;
  /** how far the walker has scurried off the path (world metres), eases back */
  fx: number;
  fz: number;
  /** the way on at the junction ahead (decided as it comes up) */
  plan: Plan | null;
  /** walking over a crosswalk */
  path: CrossPath | null;
  /** the crosswalk it's heading for on this street (after turning onto it) */
  cross: Crosswalk | null;
  /** the crosswalk it is waiting at or crossing (-1: none) — the cars stop for
   * it — and whether it's out on the carriageway (not just at the kerb) */
  xing: number;
  xingOn: boolean;
  /** where the walker is this frame (world) */
  x: number;
  z: number;
  r: Rng;
  /** which body (an index into the island's instanced meshes) and its size */
  body: number;
  size: number;
}
const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _e = new THREE.Euler(), _p = new THREE.Vector3(), _s = new THREE.Vector3();

/** where a walker's sidewalk leads at the junction ahead: straight on (the
 * street carries on, on its side), round the corner onto the next street
 * (and, sometimes, over that street on its crosswalk), or back */
type Plan =
  | { node: number; kind: 'back'; at: number }
  | { node: number; kind: 'straight'; edge: number }
  | { node: number; kind: 'turn'; at: number; edge: number; dir: 1 | -1; mu: number; side: number; cross: Crosswalk | null };
/** walking over a crosswalk: from one sidewalk straight over the stripes to
 * the other (city-local) */
interface CrossPath {
  to: { x: number; z: number };
  x: number;
  z: number;
  /** allowed across (green / clear), and how long it has waited at the kerb */
  go: boolean;
  waited: number;
  cw: Crosswalk;
  walkPhase: 'ew' | 'ns';
}
export class IslandWalkers {
  readonly walkers: Walker[] = [];
  private graph: StreetGraph;
  private coast: Coast;
  private occ: Occupancy;
  /** one instanced mesh per body (person or pet model): a few draw calls for the whole crowd */
  private meshes: THREE.InstancedMesh[] = [];

  constructor(private scene: THREE.Scene, readonly bx: number, readonly by: number,
              private ox: number, private oz: number,
              petTpls: BakedTemplate[], peopleTpls: BakedTemplate[]) {
    this.graph = graphFor(bx, by);
    this.coast = coastFor(bx, by);
    const g = this.graph;
    const occ = this.occ = occupancyFor(bx, by);
    // bodies: Kenney mini-characters / cube pets, procedural villagers as fallback
    const people = peopleTpls.length
      ? peopleTpls.map(t => { const m = templateToMesh(t); m.geometry.scale(PED_SCALE, PED_SCALE, PED_SCALE); return m; })
      : [0, 1, 2, 3].map(() => bakeObjectToMesh(makeVillager()));
    const pets = petTpls.map(t => templateToMesh(t));
    const bodies = [...people, ...pets];
    // (about a person every 55 m of street, and half as many pets)
    const nPeople = Math.max(12, Math.min(Math.round(260 * SCALE * SCALE), Math.round(g.totalLen / 55)));
    const nPets = pets.length ? Math.round(nPeople / 2) : 0;
    const base = chunkSeed(citySeed(bx, by), 0xbeef, 1);
    for (let k = 0; k < nPeople + nPets; k++) {
      const r = rng(chunkSeed(base, k, 7));
      const pet = k >= nPeople;
      // a seeded sidewalk spot that isn't inside a front yard or on a ring
      let placed = false;
      for (let tries = 0; tries < 20 && !placed; tries++) {
        const e = g.edges[(r() * g.edges.length) | 0];
        const side = (r() < 0.5 ? -1 : 1) * (8.2 + r() * 1.4);
        const s = 12 + r() * (e.len - 24);
        const p = g.sample(e, s, side);
        if (occ.claims(p.x, p.z, 0.5, LOT | ROAD) || occ.claims(p.x, p.z, 1.5, PLAZA | SEA)) continue;
        const body = pet ? people.length + (k - nPeople) % pets.length : k % people.length;
        const size = pet ? 0.9 + r() * 0.3 : 1;
        this.walkers.push({
          edge: e.id, dir: r() < 0.5 ? -1 : 1, s, side, speed: (pet ? 1.2 : 0.8) + r() * 0.6,
          phase: r() * 10, pet, fx: 0, fz: 0, plan: null, path: null, cross: null, xing: -1, xingOn: false, x: this.ox + p.x, z: this.oz + p.z, r, body, size,
        });
        placed = true;
      }
    }
    bodies.forEach((src, bi) => {
      const n = this.walkers.filter(w => w.body === bi).length;
      if (!n) return;
      const im = new THREE.InstancedMesh(src.geometry, src.material, n);
      im.castShadow = true;
      im.frustumCulled = false;
      im.count = 0;
      this.meshes[bi] = im;
      scene.add(im);
    });
  }

  hide(): void { for (const m of this.meshes) if (m) m.count = 0; }

  dispose(): void { for (const m of this.meshes) if (m) this.scene.remove(m); }

  /** is the walker about to step off the kerb onto a carriageway? */
  private stepsOntoRoad(e: { id: number }, w: Walker): boolean {
    const ed = this.graph.edges[e.id];
    const here = this.graph.sample(ed, w.s, w.side), ahead = this.graph.sample(ed, w.s + w.dir * 1.5, w.side);
    return !(this.occ.bits(here.x, here.z) & ROAD) && (this.occ.bits(ahead.x, ahead.z) & ROAD) !== 0;
  }

  /**
   * The way on at node N for a walker coming up edge e. The walker keeps to
   * its side of the pavement (sig: +1 right of its way): the first street
   * round from its own on that side bounds its corner — it turns the corner
   * onto it, or (3+ arms, sometimes) crosses it on its crosswalk into the
   * next corner; with no street on its side before straight on, it carries
   * straight on; round the outside of a bend it follows the corner round.
   */
  private planAt(w: Walker, e: SEdge, N: SNode, cws: Crosswalks): Plan {
    const g = this.graph;
    const tx = e.ux * w.dir, tz = e.uz * w.dir;
    const sig: 1 | -1 = w.side * w.dir >= 0 ? 1 : -1, d = Math.abs(w.side);
    // toward the walker's side of its way
    const sx = -tz * sig, sz = tx * sig;
    const arms = N.edges.filter(id => id !== e.id).map(id => {
      const o = g.edges[id], l = leaving(g, o, N.id);
      let phi = Math.atan2(l.x * sx + l.z * sz, -(l.x * tx + l.z * tz));
      if (phi <= 1e-6) phi += Math.PI * 2;
      return { o, l, phi };
    }).sort((a, b) => a.phi - b.phi);
    const back: Plan = { node: N.id, kind: 'back', at: 12 };
    if (!arms.length) return back;
    const first = arms[0];
    if (first.phi < Math.PI - 0.15) {
      const tp = this.turnPlan(N, tx, tz, first, sig, d);
      if (!tp) return back;
      // (3+ arms, sometimes: over the street it turns onto, on its crosswalk
      // — when the corner meets that street's sidewalk short of the stripes)
      const cw = arms.length >= 2 ? cws.at(N.id, first.o.id) : undefined;
      if (cw && tp.kind === 'turn' && tp.mu <= cw.far - 0.5 && w.r() < 0.6) tp.cross = cw;
      return tp;
    }
    if (Math.abs(first.phi - Math.PI) < 0.15) return { node: N.id, kind: 'straight', edge: first.o.id };
    return this.turnPlan(N, tx, tz, first, sig, d) ?? back;
  }

  /** round the corner onto arm a: where the walker's sidewalk line (offset d
   * on side sig) meets a's, the same side of its new way */
  private turnPlan(N: SNode, tx: number, tz: number, a: { o: SEdge; l: { x: number; z: number } }, sig: 1 | -1, d: number): Plan | null {
    const lx = a.l.x, lz = a.l.z;
    const rx = sig * d * (-lz) - sig * d * (-tz), rz = sig * d * lx - sig * d * tx;
    const det = tx * lz - lx * tz;
    if (Math.abs(det) < 0.15) return null;
    const lam = (-rx * lz + lx * rz) / det, mu = (-tx * rz + rx * tz) / det;
    if (Math.abs(lam) > 30 || Math.abs(mu) > 30) return null;
    const dir: 1 | -1 = a.o.a === N.id ? 1 : -1;
    return { node: N.id, kind: 'turn', at: lam, edge: a.o.id, dir, mu, side: sig * d * dir, cross: null };
  }

  /** may a dodging walker stand at world (x, z)? */
  private free(x: number, z: number): boolean {
    const lx = x - this.ox, lz = z - this.oz;
    return this.coast.inLand(lx, lz, 0.5) && !this.occ.claims(lx, lz, 0.3, NO_DODGE);
  }

  /** advance the crowd at game time t; `threat` is a ground vehicle to get
   * out of the way of (or null), `rail` the trains they wait for at level
   * crossings (null: none), `viewer` decides who is drawn */
  update(dt: number, t: number, rail: Railway | null, threat: Threat | null, viewer: THREE.Vector3 | null, draw: boolean,
         cars: Array<{ x: number; z: number; v?: number }> | null = null): void {
    const g = this.graph;
    const used = this.meshes.map(() => 0);
    const cws = crosswalksFor(this.bx, this.by);
    for (const w of this.walkers) {
      let e = g.edges[w.edge];
      let p: { x: number; z: number };
      // (which way the walker faces: along its street, or along its route)
      let fhx = e.ux * w.dir, fhz = e.uz * w.dir;
      let pace = 1, waiting = false;
      w.xing = -1;
      w.xingOn = false;
      const reverse = (): void => { w.dir = -w.dir as 1 | -1; w.plan = null; w.cross = null; };
      if (w.path) {
        // ---- over a crosswalk: from the kerb straight across the stripes ----
        const P = w.path;
        if (!P.go) {
          // at the kerb: the walker's own green where there are lights; at a
          // zebra, once no car is too near to stop (after 20 s, anyway — the
          // cars stop for anybody waiting there)
          // — and never while a car is on the stripes, or still coming at
          // them (a car that has stopped short of them has stopped for the
          // walker: waiting on it too left both standing for good)
          const N = g.nodes[P.cw.node];
          const cx = this.ox + P.cw.x, cz = this.oz + P.cw.z, cw = P.cw;
          const blocks = (r: number): boolean => !!cars && cars.some(c => {
            const dx = c.x - cx, dz = c.z - cz;
            if (dx * dx + dz * dz > r * r) return false;
            const along = Math.abs(dx * cw.lx + dz * cw.lz), lat = Math.abs(dx * -cw.lz + dz * cw.lx);
            const onStripes = along < 1.5 + 2.6 && lat < 7.5;
            return onStripes || (c.v ?? 1) > 1;
          });
          if (N.signalized) P.go = lightState(N.x, N.z, t) === P.walkPhase && !blocks(12);
          else {
            P.go = P.waited > 20 ? !blocks(6) : !blocks(11);
            w.xing = P.cw.id;
          }
          P.waited += dt;
          waiting = !P.go;
        }
        const dx = P.to.x - P.x, dz = P.to.z - P.z, dist = Math.hypot(dx, dz);
        if (P.go) {
          // (brisk over the stripes; the cars wait while they're on the
          // carriageway — not for the last steps on the far pavement)
          const lat = Math.abs((P.x - P.cw.x) * -P.cw.lz + (P.z - P.cw.z) * P.cw.lx);
          if (lat < 7.6) { w.xing = P.cw.id; w.xingOn = true; }
          const step = w.speed * dt * 1.7;
          if (step >= dist) { P.x = P.to.x; P.z = P.to.z; } else { P.x += (dx / dist) * step; P.z += (dz / dist) * step; }
        }
        if (dist > 1e-3) { fhx = dx / dist; fhz = dz / dist; }
        p = { x: P.x, z: P.z };
        if (P.go && dist <= w.speed * dt * 1.7) {
          // over: on the far sidewalk, walking back toward the junction (it
          // turns the next corner there and carries on its way)
          w.side = -w.side;
          w.dir = -w.dir as 1 | -1;
          w.path = null; w.plan = null; w.cross = null;
        }
      } else {
        const end = g.nodes[w.dir > 0 ? e.b : e.a];
        const toEnd = w.dir > 0 ? e.len - w.s : w.s;
        if (end.plaza && toEnd < ROUNDABOUT_REACH + 1) {
          reverse();
        } else {
          // the way on at the next junction, decided as it comes up
          if ((!w.plan || w.plan.node !== end.id) && toEnd < 45) w.plan = this.planAt(w, e, end, cws);
          const pl = w.plan && w.plan.node === end.id ? w.plan : null;
          if (pl?.kind === 'back') {
            if (toEnd <= pl.at) reverse();
          } else if (pl?.kind === 'turn') {
            // round the corner: onto the next street's sidewalk, where the
            // two sidewalk lines meet (so the step is seamless) — and, when it
            // means to cross that street, on toward its crosswalk
            if (toEnd <= pl.at) {
              const o = g.edges[pl.edge];
              w.edge = o.id; w.dir = pl.dir; w.s = pl.dir > 0 ? pl.mu : o.len - pl.mu; w.side = pl.side;
              w.plan = null;
              w.cross = pl.cross;
              e = o;
            }
          } else if (toEnd <= 0) {
            // straight on, the sidewalk carrying on along the next street
            const cont = pl?.kind === 'straight' ? g.edges[pl.edge] : undefined;
            if (cont) {
              const flip = cont.ux * e.ux + cont.uz * e.uz < 0;
              w.side = flip ? -w.side : w.side;
              w.dir = cont.a === end.id ? 1 : -1;
              w.s = w.dir > 0 ? 0 : cont.len;
              w.edge = cont.id;
              w.plan = null;
              e = cont;
            } else reverse();
          }
          // at the stripes of the crosswalk it's heading for: over it, square
          // across the street to the same spot on the far sidewalk
          if (w.cross && w.cross.edge === e.id && !w.path) {
            const cw = w.cross, mid = (cw.near + cw.far) / 2;
            const sMid = cw.node === e.a ? mid : e.len - mid;
            const from = cw.node === e.a ? w.s : e.len - w.s; // (metres out from the junction)
            const away = cw.node === e.a ? w.dir > 0 : w.dir < 0;
            if (away && from >= mid - 0.2) {
              w.s = sMid;
              const here = g.sample(e, sMid, w.side), there = g.sample(e, sMid, -w.side);
              const N = g.nodes[cw.node];
              w.path = { to: there, x: here.x, z: here.z, go: false, waited: 0, cw,
                walkPhase: g.phaseOf(N, e) === 'ew' ? 'ns' : 'ew' };
            }
          }
          // never off the kerb but on a crosswalk: a step onto a carriageway
          // turns them back
          if (!w.path && this.stepsOntoRoad(e, w)) reverse();
        }
        // the sidewalk ends at the shore: a causeway corridor runs on out to
        // sea, its walkers turn back at the beach
        if (!w.path) {
          const ahead = g.sample(e, w.s + w.dir * 1.5, w.side);
          if (!this.coast.inLand(ahead.x, ahead.z, 2)) reverse();
        }
        // a level crossing: wait short of it while a train is near, hurry off
        // it if the warning caught them on it
        if (rail && !w.path) {
          for (const cr of e.crossings) {
            const ahead = (cr.s - w.s) * w.dir;
            if (ahead < -5 || ahead > 10) continue;
            if (rail.distTo(this.bx, this.by, cr.c.line, cr.c.d, t) >= WALK_WARN) continue;
            if (ahead > 5) waiting = true;
            else pace = 3;
          }
        }
        if (w.path) p = { x: w.path.x, z: w.path.z };
        else {
          if (!waiting) w.s += w.dir * w.speed * pace * dt;
          p = g.sample(e, w.s, w.side);
          fhx = e.ux * w.dir; fhz = e.uz * w.dir;
        }
      }
      let x = this.ox + p.x + w.fx, z = this.oz + p.z + w.fz;
      let running = false;
      if (threat) {
        const fx = Math.sin(threat.heading), fz = Math.cos(threat.heading);
        const nx = fz, nz = -fx;
        const hl = threat.halfL + WALK_CLEAR, hw = threat.halfW + WALK_CLEAR;
        const band = hw + 1.6;
        const mv = threat.v >= 0 ? 1 : -1;
        const along = (x - threat.x) * fx + (z - threat.z) * fz;
        let lat = (x - threat.x) * nx + (z - threat.z) * nz;
        // in the vehicle's path soon (or right beside it): leap sideways, to
        // the side they're on unless that ground is barred — never down its
        // path, where a truck outruns anyone
        const front = along * mv - hl;
        const reach = Math.max(4, Math.abs(threat.v) * LOOK);
        if (Math.abs(lat) < band && front > -2 * hl && front < reach) {
          running = true;
          const step = Math.min(DODGE_V * dt, band + 0.4 - Math.abs(lat));
          const pref = lat >= 0 ? 1 : -1;
          for (const sg of [pref, -pref]) {
            const nl = lat + sg * step;
            const cx = threat.x + fx * along + nx * nl, cz = threat.z + fz * along + nz * nl;
            if (this.free(cx, cz)) {
              w.fx += cx - x; w.fz += cz - z;
              x = cx; z = cz; lat = nl;
              break;
            }
          }
        } else if (Math.hypot(x - threat.x, z - threat.z) < FLEE_R) {
          running = true; // close by but off its path: hold the dodge
        }
        // the hard clamp: never inside the footprint, whatever the ground
        if (Math.abs(along) < hl && Math.abs(lat) < hw) {
          const at = (sg: number): { x: number; z: number } =>
            ({ x: threat.x + fx * along + nx * sg * hw, z: threat.z + fz * along + nz * sg * hw });
          const pref = lat >= 0 ? 1 : -1;
          const q0 = at(pref), q1 = at(-pref);
          const q = !this.free(q0.x, q0.z) && this.free(q1.x, q1.z) ? q1 : q0;
          w.fx += q.x - x; w.fz += q.z - z;
          x = q.x; z = q.z;
          running = true;
        }
      }
      if (!running) {
        w.fx *= 1 - Math.min(1, dt * 0.8);
        w.fz *= 1 - Math.min(1, dt * 0.8);
        x = this.ox + p.x + w.fx;
        z = this.oz + p.z + w.fz;
      }
      w.x = x; w.z = z;
      if (!draw) continue;
      const near = !viewer || Math.hypot(x - viewer.x, z - viewer.z) < DRAW_R;
      const im = this.meshes[w.body];
      if (!near || !im) continue;
      w.phase += dt * (running ? (w.pet ? 16 : 14) : waiting ? 0 : 6);
      // (up on a bridge deck where the sidewalk crosses the river)
      const dk = deckAt(x, z);
      const y0 = dk && dk.kind === 'road' ? dk.y : 0;
      _p.set(x, y0 + 0.1 + Math.abs(Math.sin(w.phase)) * (running ? 0.16 : w.pet ? 0.06 : 0.04), z);
      _e.set(running ? (w.pet ? 0.1 : 0.18) : 0,
        running && threat ? Math.atan2(x - threat.x, z - threat.z) : Math.atan2(fhx, fhz), 0);
      im.setMatrixAt(used[w.body]++, _m.compose(_p, _q.setFromEuler(_e), _s.setScalar(w.size)));
    }
    if (draw) this.meshes.forEach((im, bi) => {
      if (!im) return;
      im.count = used[bi];
      im.instanceMatrix.needsUpdate = true;
    });
  }

  /** debug: current spots */
  list(): Array<{ x: number; z: number }> {
    return this.walkers.map(w => ({ x: +w.x.toFixed(1), z: +w.z.toFixed(1) }));
  }
}
