// An island's pedestrians and pets: a fixed, seeded crowd that lives on this
// island for good. Each walker strolls the sidewalk beside a street-graph
// edge, carries straight on across junctions when the street continues and
// turns back where it ends (or before a roundabout ring). When a ground
// vehicle comes close they scurry out of the way — nobody can ever be run
// over — then drift back onto their sidewalk and carry on. Nobody respawns.
import * as THREE from 'three';
import { rng, chunkSeed, type Rng } from '../../../engine/rng.js';
import { makeVillager } from '../../../kit/index.js';
import { bakeObjectToMesh, templateToMesh } from '../../../engine/baked.js';
import { citySeed } from '../../../worlds/cityGrid.js';
import { occupancyFor, LOT, PLAZA } from '../../../worlds/grid.js';
import { ROUNDABOUT_REACH } from '../../../worlds/cityPlan.js';
import { graphFor, leaving, type StreetGraph } from '../../../worlds/streetGraph.js';
import type { BakedTemplate } from '../../../engine/assets.js';

/** kit characters are ~0.7 units tall; scale them to villager height (~1.6 m) */
const PED_SCALE = 2.2;
const DRAW_R = 150;
const FLEE_R = 12;

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
  r: Rng;
  mesh: THREE.Mesh;
}

export class IslandWalkers {
  readonly walkers: Walker[] = [];
  private graph: StreetGraph;

  constructor(private scene: THREE.Scene, readonly bx: number, readonly by: number,
              private ox: number, private oz: number,
              petTpls: BakedTemplate[], peopleTpls: BakedTemplate[]) {
    this.graph = graphFor(bx, by);
    const g = this.graph;
    const occ = occupancyFor(bx, by);
    // bodies: Kenney mini-characters / cube pets, procedural villagers as fallback
    const people = peopleTpls.length
      ? peopleTpls.map(t => { const m = templateToMesh(t); m.geometry.scale(PED_SCALE, PED_SCALE, PED_SCALE); return m; })
      : [0, 1, 2, 3].map(() => bakeObjectToMesh(makeVillager()));
    const pets = petTpls.map(t => templateToMesh(t));
    const nPeople = Math.max(10, Math.min(30, Math.round(g.totalLen / 280)));
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
        if (occ.claims(p.x, p.z, 0.5, LOT) || occ.claims(p.x, p.z, 1.5, PLAZA)) continue;
        const src = pet ? pets[(k - nPeople) % pets.length] : people[k % people.length];
        const mesh = new THREE.Mesh(src.geometry, src.material);
        if (pet) mesh.scale.setScalar(0.9 + r() * 0.3);
        mesh.castShadow = true;
        mesh.visible = false;
        scene.add(mesh);
        this.walkers.push({
          edge: e.id, dir: r() < 0.5 ? -1 : 1, s, side, speed: (pet ? 1.2 : 0.8) + r() * 0.6,
          phase: r() * 10, pet, fx: 0, fz: 0, r, mesh,
        });
        placed = true;
      }
    }
  }

  hide(): void { for (const w of this.walkers) w.mesh.visible = false; }

  dispose(): void { for (const w of this.walkers) this.scene.remove(w.mesh); }

  /** advance the crowd; `threat` is a ground vehicle to scurry away from
   * (world, or null), `viewer` decides who is drawn */
  update(dt: number, threat: THREE.Vector3 | null, viewer: THREE.Vector3 | null, draw: boolean): void {
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
      w.s += w.dir * w.speed * dt;
      const p = g.sample(e, w.s, w.side);
      let x = this.ox + p.x + w.fx, z = this.oz + p.z + w.fz;
      // scurry away from a vehicle that comes close, drift back after
      let running = false;
      if (threat) {
        const dx = x - threat.x, dz = z - threat.z, d = Math.hypot(dx, dz);
        if (d < FLEE_R) {
          const inv = 1 / (d || 1);
          w.fx += dx * inv * 4 * dt;
          w.fz += dz * inv * 4 * dt;
          running = true;
        }
      }
      if (!running) {
        w.fx *= 1 - Math.min(1, dt * 0.8);
        w.fz *= 1 - Math.min(1, dt * 0.8);
      }
      x = this.ox + p.x + w.fx;
      z = this.oz + p.z + w.fz;
      if (!draw) continue;
      const near = !viewer || Math.hypot(x - viewer.x, z - viewer.z) < DRAW_R;
      w.mesh.visible = near;
      if (!near) continue;
      w.phase += dt * (running ? (w.pet ? 16 : 14) : 6);
      w.mesh.position.set(x, 0.1 + Math.abs(Math.sin(w.phase)) * (running ? 0.16 : w.pet ? 0.06 : 0.04), z);
      w.mesh.rotation.set(running ? (w.pet ? 0.1 : 0.18) : 0,
        running && threat ? Math.atan2(x - threat.x, z - threat.z) : Math.atan2(e.ux * w.dir, e.uz * w.dir), 0);
    }
  }

  /** debug: current spots */
  list(): Array<{ x: number; z: number }> {
    return this.walkers.map(w => ({ x: +w.mesh.position.x.toFixed(1), z: +w.mesh.position.z.toFixed(1) }));
  }
}
