// Pedestrians and pets: villagers stroll the sidewalks and cube pets wander
// with them — everyone flees the truck when it gets close (they can never be
// run over — no collision, they just panic and scatter). Each body is merged
// into one mesh at creation. They walk beside the street graph's edges: on
// reaching a junction they carry straight on along the next edge if the
// street continues, and turn back otherwise — or before a roundabout, whose
// ring has no sidewalk.
import * as THREE from 'three';
import { makeVillager } from '../../kit/index.js';
import { bakeObjectToMesh, templateToMesh } from '../../engine/baked.js';
import { occupancyFor, LOT, PLAZA } from '../../worlds/grid.js';
import { ROUNDABOUT_REACH } from '../../worlds/cityPlan.js';
import { cityAt } from '../../worlds/cityGrid.js';
import { graphFor, leaving, type StreetGraph, type SEdge } from '../../worlds/streetGraph.js';
import type { BakedTemplate } from '../../engine/assets.js';

interface Ped {
  mesh: THREE.Mesh;
  /** street-graph edge walked beside, which side of it, and which way */
  edge: number;
  side: 1 | -1;
  offset: number;
  dir: 1 | -1;
  speed: number;
  phase: number;
  /** pets hop while moving */
  pet: boolean;
}

/** kit characters are ~0.7 units tall; scale them to villager height (~1.6 m) */
const PED_SCALE = 2.2;

const camDir = new THREE.Vector3();

export class Pedestrians {
  private peds: Ped[] = [];
  private graph: StreetGraph;
  /** world offset of the city the locals are strolling in */
  private ox = 0;
  private oz = 0;

  /** move the crowd to another city's sidewalks near the player */
  setCity(bx: number, by: number, ox: number, oz: number, px: number, pz: number): void {
    this.graph = graphFor(bx, by);
    this.ox = ox;
    this.oz = oz;
    for (const p of this.peds) this.respawn(p, px, pz);
  }

  constructor(private scene: THREE.Scene, count = 14, petTpls: BakedTemplate[] = [],
              peopleTpls: BakedTemplate[] = [], private camera?: THREE.Camera) {
    this.graph = graphFor(0, 0);
    // distinct bodies shared across the pedestrians: Kenney mini-characters
    // when available, procedural villagers otherwise
    const variants: Array<{ geo: THREE.BufferGeometry; mat: THREE.Material }> = [];
    if (peopleTpls.length) {
      for (const tpl of peopleTpls) {
        const m = templateToMesh(tpl);
        m.geometry.scale(PED_SCALE, PED_SCALE, PED_SCALE);
        variants.push({ geo: m.geometry, mat: m.material as THREE.Material });
      }
    } else {
      for (let i = 0; i < 4; i++) {
        const m = bakeObjectToMesh(makeVillager());
        variants.push({ geo: m.geometry, mat: m.material as THREE.Material });
      }
    }
    const mk = (mesh: THREE.Mesh, speed: number, pet: boolean): void => {
      mesh.castShadow = true;
      scene.add(mesh);
      const p: Ped = { mesh, edge: 0, side: 1, offset: 8.5, dir: 1, speed, phase: Math.random() * 10, pet };
      this.peds.push(p);
      this.respawn(p, 0, 0);
    };
    for (let i = 0; i < count; i++) {
      const v = variants[i % variants.length];
      mk(new THREE.Mesh(v.geo, v.mat), 1, false);
    }
    // cube pets: same wandering + fleeing, with a hop in their step
    for (const tpl of petTpls) {
      const mesh = templateToMesh(tpl);
      mesh.scale.setScalar(0.9 + Math.random() * 0.3);
      mk(mesh, 1.2, true);
    }
  }

  /** would a body at world (x, z) be on camera? Same rule as the traffic
   * fleet: behind the camera's forward hemisphere or beyond the fog is safe. */
  private inSight(x: number, z: number): boolean {
    if (!this.camera) return false;
    this.camera.getWorldDirection(camDir);
    const dx = x - this.camera.position.x, dz = z - this.camera.position.z;
    const dist = Math.hypot(dx, dz);
    if (dist < 25) return true;
    if (dist > 140) return false;
    const fl = Math.hypot(camDir.x, camDir.z) || 1;
    const dot = (dx * camDir.x + dz * camDir.z) / (dist * fl);
    return dot > -0.2;
  }

  /** Place a pedestrian or pet on the sidewalk of a street near (px, pz),
   * never on camera. */
  respawn(p: Ped, px: number, pz: number): void {
    const g = this.graph;
    const lx = px - this.ox, lz = pz - this.oz;
    const near = g.edges.filter(e => {
      const m = g.sample(e, e.len / 2);
      return Math.abs(m.x - lx) < 140 && Math.abs(m.z - lz) < 140;
    });
    if (!near.length) return;
    let best: [SEdge, 1 | -1, number, number] | null = null;
    let bestDist = -1;
    for (let tries = 0; tries < 20; tries++) {
      const e = near[(Math.random() * near.length) | 0];
      const side: 1 | -1 = Math.random() < 0.5 ? -1 : 1;
      const offset = 8.2 + Math.random() * 1.4;
      const s = 12 + Math.random() * (e.len - 24);
      const q = g.sample(e, s, side * offset);
      // sidewalks run right past building fronts — the occupancy grid says
      // whether this stretch of pavement is inside someone's front yard,
      // or on a roundabout ring
      const city = cityAt(this.ox + q.x + 0.5, this.oz + q.z + 0.5);
      const occ = occupancyFor(city.bx, city.by);
      if (occ.claims(q.x, q.z, 0.5, LOT) || occ.claims(q.x, q.z, 1.5, PLAZA)) continue;
      const dp = Math.hypot(q.x + this.ox - px, q.z + this.oz - pz);
      if (dp > 130 || dp < 18) continue; // keep the crowd in the active ring
      if (!this.inSight(this.ox + q.x, this.oz + q.z)) {
        this.place(p, e, side, offset, q);
        return;
      }
      if (dp > bestDist) { best = [e, side, offset, s]; bestDist = dp; }
    }
    if (best) this.place(p, best[0], best[1], best[2], g.sample(best[0], best[3], best[1] * best[2]));
  }

  /** commit a candidate placement (position, stroll direction and pace) */
  private place(p: Ped, e: SEdge, side: 1 | -1, offset: number, q: { x: number; z: number }): void {
    p.edge = e.id;
    p.side = side;
    p.offset = offset;
    p.dir = Math.random() < 0.5 ? -1 : 1;
    p.speed = (p.pet ? 1.2 : 0.8) + Math.random() * 0.6;
    p.phase = Math.random() * 10;
    p.mesh.position.set(this.ox + q.x, 0.1, this.oz + q.z);
    p.mesh.rotation.set(0, Math.random() * Math.PI * 2, 0);
  }

  update(dt: number, truckX: number, truckZ: number, px: number, pz: number): void {
    const g = this.graph;
    for (const p of this.peds) {
      const pos = p.mesh.position;
      const dx = pos.x - truckX, dz = pos.z - truckZ;
      const d = Math.hypot(dx, dz);

      if (d < 12) {
        // panic: run straight away from the truck
        const inv = 1 / (d || 1);
        const runX = dx * inv * 4 * dt, runZ = dz * inv * 4 * dt;
        pos.x += runX;
        pos.z += runZ;
        p.mesh.rotation.y = Math.atan2(runX, runZ);
        p.mesh.rotation.x = p.pet ? 0.1 : 0.18;
        pos.y = 0.1 + Math.abs(Math.sin((p.phase += dt * (p.pet ? 16 : 14)))) * 0.16;
        continue;
      }
      // stroll along the edge's direction
      p.mesh.rotation.x = 0;
      let e = g.edges[p.edge];
      if (!e) { this.respawn(p, px, pz); continue; }
      const a = g.nodes[e.a];
      const s = (pos.x - this.ox - a.x) * e.ux + (pos.z - this.oz - a.z) * e.uz;
      const endNode = g.nodes[p.dir > 0 ? e.b : e.a];
      const toEnd = p.dir > 0 ? e.len - s : s;
      // turn back before a roundabout ring (no sidewalk there) ...
      if (endNode.plaza && toEnd < ROUNDABOUT_REACH + 1) {
        p.dir = -p.dir as 1 | -1;
      } else if (toEnd < 0) {
        // ... and at a junction carry straight on if the street continues
        const tx = e.ux * p.dir, tz = e.uz * p.dir;
        const cont = endNode.edges.map(id => g.edges[id]).find(o => {
          if (o.id === e.id) return false;
          const l = leaving(g, o, endNode.id);
          return l.x * tx + l.z * tz > 0.9;
        });
        if (cont) {
          p.dir = cont.a === endNode.id ? 1 : -1;
          p.edge = cont.id;
          e = cont;
        } else {
          p.dir = -p.dir as 1 | -1;
        }
      }
      const move = p.dir * p.speed * dt;
      pos.x += e.ux * move;
      pos.z += e.uz * move;
      p.mesh.rotation.y = Math.atan2(e.ux * p.dir, e.uz * p.dir);
      pos.y = 0.1 + Math.abs(Math.sin((p.phase += dt * 6))) * (p.pet ? 0.06 : 0.04);
      if (d > 130) this.respawn(p, px, pz);
    }
  }

  /** debug: current pedestrian spots */
  list(): Array<{ x: number; z: number; y: number }> {
    return this.peds.map(p => ({
      x: +p.mesh.position.x.toFixed(1),
      z: +p.mesh.position.z.toFixed(1),
      y: +p.mesh.position.y.toFixed(2),
    }));
  }
}
