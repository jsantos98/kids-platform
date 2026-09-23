// Pedestrians: villagers walking the sidewalks near the player. They flee the
// truck when it gets close (they can never be run over — no collision, they
// just panic and scatter). Each villager is merged into one mesh at creation.
import * as THREE from 'three';
import { makeVillager } from '../../kit/index.js';
import { bakeObjectToMesh } from '../../engine/baked.js';
import { RoadGrid } from '../../worlds/roadGrid.js';

interface Ped {
  mesh: THREE.Mesh;
  /** true: walks along X beside a horizontal (z = idx*CH) street */
  alongX: boolean;
  idx: number;
  dir: number;
  speed: number;
  phase: number;
}

export class Pedestrians {
  private peds: Ped[] = [];

  constructor(private scene: THREE.Scene, private grid: RoadGrid, private CH: number, count = 14) {
    // a few distinct merged villager bodies, shared across the pedestrians
    const variants: Array<{ geo: THREE.BufferGeometry; mat: THREE.Material }> = [];
    for (let i = 0; i < 4; i++) {
      const m = bakeObjectToMesh(makeVillager());
      variants.push({ geo: m.geometry, mat: m.material as THREE.Material });
    }
    for (let i = 0; i < count; i++) {
      const v = variants[i % variants.length];
      const mesh = new THREE.Mesh(v.geo, v.mat);
      mesh.castShadow = true;
      scene.add(mesh);
      const p: Ped = { mesh, alongX: true, idx: 0, dir: 1, speed: 1, phase: Math.random() * 10 };
      this.peds.push(p);
      this.respawn(p, 0, 0);
    }
  }

  /** Place a pedestrian on a sidewalk of a real street near (px, pz). */
  respawn(p: Ped, px: number, pz: number): void {
    for (let tries = 0; tries < 12; tries++) {
      const alongX = Math.random() < 0.5;
      const base = Math.round((alongX ? pz : px) / this.CH);
      const idx = Math.min(5, Math.max(1, base + ((Math.random() * 3) | 0) - 1));
      if (!(alongX ? this.grid.hasZ(idx) : this.grid.hasX(idx))) continue;
      const side = Math.random() < 0.5 ? -1 : 1;
      const offset = side * (5.8 + Math.random() * 1.4);
      const along = Math.min(360, Math.max(24, (alongX ? px : pz) + (Math.random() - 0.5) * 140));
      p.alongX = alongX;
      p.idx = idx;
      p.dir = Math.random() < 0.5 ? -1 : 1;
      p.speed = 0.8 + Math.random() * 0.6;
      p.phase = Math.random() * 10;
      if (alongX) p.mesh.position.set(along, 0.1, idx * this.CH + offset);
      else p.mesh.position.set(idx * this.CH + offset, 0.1, along);
      p.mesh.rotation.set(0, Math.random() * Math.PI * 2, 0);
      return;
    }
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
        p.mesh.rotation.x = 0.18;
        pos.y = 0.1 + Math.abs(Math.sin((p.phase += dt * 14))) * 0.16;
      } else {
        // stroll along the sidewalk
        p.mesh.rotation.x = 0;
        const move = p.dir * p.speed * dt;
        if (p.alongX) {
          pos.x += move;
          p.mesh.rotation.y = p.dir > 0 ? Math.PI / 2 : -Math.PI / 2;
        } else {
          pos.z += move;
          p.mesh.rotation.y = p.dir > 0 ? 0 : Math.PI;
        }
        pos.y = 0.1 + Math.abs(Math.sin((p.phase += dt * 6))) * 0.04;
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
