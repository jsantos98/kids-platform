// Pedestrians and pets: villagers stroll the sidewalks and cube pets wander
// with them — everyone flees the truck when it gets close (they can never be
// run over — no collision, they just panic and scatter). Each body is merged
// into one mesh at creation.
import * as THREE from 'three';
import { makeVillager } from '../../kit/index.js';
import { Baked, bakeObjectToMesh, templateToMesh } from '../../engine/baked.js';
import { RoadGrid } from '../../worlds/roadGrid.js';
import { occupancyFor, LOT, PLAZA } from '../../worlds/grid.js';
import { ROUNDABOUT_REACH } from '../../worlds/cityPlan.js';
import { cityAt } from '../../worlds/cityGrid.js';
import { WORLD_CHUNKS, ISLAND } from '../../worlds/world.js';
import type { BakedTemplate } from '../../engine/assets.js';

interface Ped {
  mesh: THREE.Mesh;
  /** true: walks along X beside a horizontal (z = idx*CH) street */
  alongX: boolean;
  idx: number;
  dir: number;
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
  /** world offset of the city the locals are strolling in */
  private ox = 0;
  private oz = 0;

  /** move the crowd to another city's sidewalks near the player */
  setCity(ox: number, oz: number, px: number, pz: number): void {
    this.ox = ox;
    this.oz = oz;
    for (const p of this.peds) this.respawn(p, px, pz);
  }

  constructor(private scene: THREE.Scene, private grid: RoadGrid, private CH: number,
              count = 14, petTpls: BakedTemplate[] = [], peopleTpls: BakedTemplate[] = [],
              private camera?: THREE.Camera) {
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
    for (let i = 0; i < count; i++) {
      const v = variants[i % variants.length];
      const mesh = new THREE.Mesh(v.geo, v.mat);
      mesh.castShadow = true;
      scene.add(mesh);
      const p: Ped = { mesh, alongX: true, idx: 0, dir: 1, speed: 1, phase: Math.random() * 10, pet: false };
      this.peds.push(p);
      this.respawn(p, 0, 0);
    }
    // cube pets: same wandering + fleeing, with a hop in their step
    for (const tpl of petTpls) {
      const mesh = templateToMesh(tpl);
      mesh.scale.setScalar(0.9 + Math.random() * 0.3);
      mesh.castShadow = true;
      scene.add(mesh);
      const p: Ped = { mesh, alongX: true, idx: 0, dir: 1, speed: 1.2, phase: Math.random() * 10, pet: true };
      this.peds.push(p);
      this.respawn(p, 0, 0);
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

  /** Place a pedestrian or pet on a sidewalk of a real street near (px, pz),
   * never on camera. */
  respawn(p: Ped, px: number, pz: number): void {
    const lx = px - this.ox, lz = pz - this.oz;
    let best: [boolean, number, number, number] | null = null;
    let bestDist = -1;
    for (let tries = 0; tries < 20; tries++) {
      const alongX = Math.random() < 0.5;
      const base = Math.round((alongX ? lz : lx) / this.CH);
      const idx = Math.min(WORLD_CHUNKS - 1, Math.max(1, base + ((Math.random() * 3) | 0) - 1));
      if (!(alongX ? this.grid.hasZ(idx) : this.grid.hasX(idx))) continue;
      const side = Math.random() < 0.5 ? -1 : 1;
      const offset = side * (8.2 + Math.random() * 1.4);
      const along = Math.min(ISLAND - 24, Math.max(24, (alongX ? lx : lz) + (Math.random() - 0.5) * 140));
      // the line must actually have a street segment at this stretch
      const seg = Math.min(WORLD_CHUNKS - 2, Math.max(0, Math.floor(along / this.CH)));
      if (!(alongX ? this.grid.segH(idx, seg) : this.grid.segV(idx, seg))) continue;
      const sx = alongX ? along : idx * this.CH + offset;
      const sz = alongX ? idx * this.CH + offset : along;
      // sidewalks run right past building fronts — the occupancy grid says
      // whether this stretch of pavement is inside someone's front yard
      const city = cityAt(this.ox + sx + 0.5, this.oz + sz + 0.5);
      const occ = occupancyFor(city.bx, city.by);
      if (occ.claims(sx, sz, 0.5, LOT) || occ.claims(sx, sz, 1.5, PLAZA)) continue;
      const dp = Math.hypot(sx + this.ox - px, sz + this.oz - pz);
      if (dp > 130 || dp < 18) continue; // keep the crowd in the active ring
      if (!this.inSight(this.ox + sx, this.oz + sz)) {
        this.place(p, alongX, idx, sx, sz);
        return;
      }
      if (dp > bestDist) { best = [alongX, idx, sx, sz]; bestDist = dp; }
    }
    if (best) this.place(p, best[0], best[1], best[2], best[3]);
  }

  /** commit a candidate placement (position, stroll direction and pace) */
  private place(p: Ped, alongX: boolean, idx: number, sx: number, sz: number): void {
    p.alongX = alongX;
    p.idx = idx;
    p.dir = Math.random() < 0.5 ? -1 : 1;
    p.speed = 0.8 + Math.random() * 0.6;
    p.phase = Math.random() * 10;
    p.mesh.position.set(this.ox + sx, 0.1, this.oz + sz);
    p.mesh.rotation.set(0, Math.random() * Math.PI * 2, 0);
  }

  update(dt: number, truckX: number, truckZ: number, px: number, pz: number): void {
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
      } else {
        // stroll along the sidewalk — and turn back before a roundabout,
        // whose ring has no sidewalk to walk on
        p.mesh.rotation.x = 0;
        {
          const ahead = 1.5 * p.dir;
          const lx = pos.x - this.ox + (p.alongX ? ahead : 0), lz = pos.z - this.oz + (p.alongX ? 0 : ahead);
          const ni = Math.round(lx / this.CH), nj = Math.round(lz / this.CH);
          if (this.grid.plaza(ni, nj) && Math.hypot(lx - ni * this.CH, lz - nj * this.CH) < ROUNDABOUT_REACH + 1) {
            p.dir = -p.dir;
          }
        }
        const move = p.dir * p.speed * dt;
        if (p.alongX) {
          pos.x += move;
          p.mesh.rotation.y = p.dir > 0 ? Math.PI / 2 : -Math.PI / 2;
        } else {
          pos.z += move;
          p.mesh.rotation.y = p.dir > 0 ? 0 : Math.PI;
        }
        pos.y = 0.1 + Math.abs(Math.sin((p.phase += dt * 6))) * (p.pet ? 0.06 : 0.04);
        if (d > 130) this.respawn(p, px, pz);
      }
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
