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
import { occupancyFor, LOT, PLAZA, SEA, RIVER, RAIL, type Occupancy } from '../../../worlds/grid.js';
import { coastFor, type Coast } from '../../../worlds/coast.js';
import { ROUNDABOUT_REACH } from '../../../worlds/cityPlan.js';
import { graphFor, leaving, type StreetGraph } from '../../../worlds/streetGraph.js';
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
  /** where the walker is this frame (world) */
  x: number;
  z: number;
  r: Rng;
  mesh: THREE.Mesh;
}

export class IslandWalkers {
  readonly walkers: Walker[] = [];
  private graph: StreetGraph;
  private coast: Coast;
  private occ: Occupancy;

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
    const nPeople = Math.max(10, Math.min(Math.round(30 * SCALE * SCALE), Math.round(g.totalLen / 280)));
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
        if (occ.claims(p.x, p.z, 0.5, LOT) || occ.claims(p.x, p.z, 1.5, PLAZA | SEA)) continue;
        const src = pet ? pets[(k - nPeople) % pets.length] : people[k % people.length];
        const mesh = new THREE.Mesh(src.geometry, src.material);
        if (pet) mesh.scale.setScalar(0.9 + r() * 0.3);
        mesh.castShadow = true;
        mesh.visible = false;
        scene.add(mesh);
        this.walkers.push({
          edge: e.id, dir: r() < 0.5 ? -1 : 1, s, side, speed: (pet ? 1.2 : 0.8) + r() * 0.6,
          phase: r() * 10, pet, fx: 0, fz: 0, x: this.ox + p.x, z: this.oz + p.z, r, mesh,
        });
        placed = true;
      }
    }
  }

  hide(): void { for (const w of this.walkers) w.mesh.visible = false; }

  dispose(): void { for (const w of this.walkers) this.scene.remove(w.mesh); }

  /** may a dodging walker stand at world (x, z)? */
  private free(x: number, z: number): boolean {
    const lx = x - this.ox, lz = z - this.oz;
    return this.coast.inLand(lx, lz, 0.5) && !this.occ.claims(lx, lz, 0.3, NO_DODGE);
  }

  /** advance the crowd at game time t; `threat` is a ground vehicle to get
   * out of the way of (or null), `rail` the trains they wait for at level
   * crossings (null: none), `viewer` decides who is drawn */
  update(dt: number, t: number, rail: Railway | null, threat: Threat | null, viewer: THREE.Vector3 | null, draw: boolean): void {
    const g = this.graph;
    for (const w of this.walkers) {
      let e = g.edges[w.edge];
      // walk along the edge
      const end = g.nodes[w.dir > 0 ? e.b : e.a];
      const toEnd = w.dir > 0 ? e.len - w.s : w.s;
      if (end.plaza && toEnd < ROUNDABOUT_REACH + 1) {
        w.dir = -w.dir as 1 | -1;
      } else if (toEnd <= 0) {
        const tx = e.ux * w.dir, tz = e.uz * w.dir;
        const cont = end.edges.map(id => g.edges[id]).find(o => {
          if (o.id === e.id) return false;
          const l = leaving(g, o, end.id);
          return l.x * tx + l.z * tz > 0.9;
        });
        if (cont) {
          // same sidewalk line on the next edge: keep the world-side offset
          const flip = cont.ux * e.ux + cont.uz * e.uz < 0;
          w.side = flip ? -w.side : w.side;
          w.dir = cont.a === end.id ? 1 : -1;
          w.s = w.dir > 0 ? 0 : cont.len;
          w.edge = cont.id;
          e = cont;
        } else {
          w.dir = -w.dir as 1 | -1;
        }
      }
      // the sidewalk ends at the shore: a causeway corridor runs on out to
      // sea, its walkers turn back at the beach
      {
        const ahead = g.sample(e, w.s + w.dir * 1.5, w.side);
        if (!this.coast.inLand(ahead.x, ahead.z, 2)) w.dir = -w.dir as 1 | -1;
      }
      // a level crossing: wait short of it while a train is near, hurry off
      // it if the warning caught them on it
      let pace = 1, waiting = false;
      if (rail) {
        for (const cr of e.crossings) {
          const ahead = (cr.s - w.s) * w.dir;
          if (ahead < -5 || ahead > 10) continue;
          if (rail.distTo(this.bx, this.by, cr.c.line, cr.c.d, t) >= WALK_WARN) continue;
          if (ahead > 5) waiting = true;
          else pace = 3;
        }
      }
      if (!waiting) w.s += w.dir * w.speed * pace * dt;
      const p = g.sample(e, w.s, w.side);
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
      w.mesh.visible = near;
      if (!near) continue;
      w.phase += dt * (running ? (w.pet ? 16 : 14) : waiting ? 0 : 6);
      // (up on a bridge deck where the sidewalk crosses the river)
      const dk = deckAt(x, z);
      const y0 = dk && dk.kind === 'road' ? dk.y : 0;
      w.mesh.position.set(x, y0 + 0.1 + Math.abs(Math.sin(w.phase)) * (running ? 0.16 : w.pet ? 0.06 : 0.04), z);
      w.mesh.rotation.set(running ? (w.pet ? 0.1 : 0.18) : 0,
        running && threat ? Math.atan2(x - threat.x, z - threat.z) : Math.atan2(e.ux * w.dir, e.uz * w.dir), 0);
    }
  }

  /** debug: current spots */
  list(): Array<{ x: number; z: number }> {
    return this.walkers.map(w => ({ x: +w.x.toFixed(1), z: +w.z.toFixed(1) }));
  }
}
