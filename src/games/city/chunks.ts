// Chunk streaming: the endless city is cut into 64 m chunks, each generated on
// demand and merged into a single vertex-colored mesh. Chunks within a radius
// of the player are alive; farther ones are disposed. Also owns the dynamic
// traffic-light props for the intersection in the chunk's SW corner.
import * as THREE from 'three';
import { generateCityChunk, type CollisionBox } from '../../worlds/cityChunk.js';
import { RoadGrid } from '../../worlds/roadGrid.js';
import { lightState } from './lights.js';
import { LAMP_MATS, makeTrafficLights } from './lampProps.js';

export interface Chunk {
  mesh: THREE.Mesh;
  boxes: CollisionBox[];
  cx: number;
  cz: number;
  lights: { group: THREE.Group; ew: THREE.Mesh[]; ns: THREE.Mesh[] } | null;
}

export class ChunkManager {
  private chunks = new Map<string, Chunk>();
  private pending = new Set<string>();
  private queue: Array<[number, number, string]> = [];

  constructor(private scene: THREE.Scene, private seed: number, private grid: RoadGrid, private CH = 64, private VIEW_R = 3) {}

  addChunk(cx: number, cz: number): void {
    const key = cx + ',' + cz;
    if (this.chunks.has(key)) return;
    const { mesh, boxes } = generateCityChunk(this.seed, cx, cz);
    this.scene.add(mesh);
    // working lights only at real intersections
    const lights = this.grid.cross(cx, cz) ? makeTrafficLights(cx * this.CH, cz * this.CH) : null;
    if (lights) this.scene.add(lights.group);
    this.chunks.set(key, { mesh, boxes, cx, cz, lights });
  }

  forceChunkAt(px: number, pz: number): void {
    this.addChunk(Math.floor(px / this.CH), Math.floor(pz / this.CH));
  }

  /** Build pending chunks nearest the player first (budget per frame). */
  ensure(budget: number, px: number, pz: number): void {
    const CH = this.CH, VIEW_R = this.VIEW_R;
    const ccx = Math.floor(px / CH), ccz = Math.floor(pz / CH);
    for (let dx = -VIEW_R; dx <= VIEW_R; dx++) {
      for (let dz = -VIEW_R; dz <= VIEW_R; dz++) {
        const cx = ccx + dx, cz = ccz + dz, key = cx + ',' + cz;
        if (!this.chunks.has(key) && !this.pending.has(key)) {
          this.pending.add(key);
          this.queue.push([cx, cz, key]);
        }
      }
    }
    this.queue.sort((a, b) =>
      (Math.abs(a[0] - ccx) + Math.abs(a[1] - ccz)) - (Math.abs(b[0] - ccx) + Math.abs(b[1] - ccz)));
    let made = 0;
    while (this.queue.length && made < budget) {
      const [cx, cz, key] = this.queue.shift()!;
      this.pending.delete(key);
      if (this.chunks.has(key)) continue;
      this.addChunk(cx, cz);
      made++;
    }
    for (const [key, ch] of this.chunks) {
      if (Math.max(Math.abs(ch.cx - ccx), Math.abs(ch.cz - ccz)) > VIEW_R + 1) {
        this.scene.remove(ch.mesh);
        ch.mesh.geometry.dispose();
        if (ch.lights) this.scene.remove(ch.lights.group);
        this.chunks.delete(key);
      }
    }
  }

  boxesNear(px: number, pz: number): CollisionBox[] {
    const CH = this.CH;
    const ccx = Math.floor(px / CH), ccz = Math.floor(pz / CH);
    const out: CollisionBox[] = [];
    for (let dx = -1; dx <= 1; dx++) {
      for (let dz = -1; dz <= 1; dz++) {
        const ch = this.chunks.get((ccx + dx) + ',' + (ccz + dz));
        if (ch) out.push(...ch.boxes);
      }
    }
    return out;
  }

  /** Sync every visible traffic light to its intersection's phase. */
  updateLights(elapsed: number): void {
    for (const ch of this.chunks.values()) {
      if (!ch.lights) continue;
      const st = lightState(ch.cx, ch.cz, elapsed);
      const ewMat = st === 'ew' ? LAMP_MATS.green : st === 'ewY' ? LAMP_MATS.yellow : LAMP_MATS.red;
      const nsMat = st === 'ns' ? LAMP_MATS.green : st === 'nsY' ? LAMP_MATS.yellow : LAMP_MATS.red;
      for (const l of ch.lights.ew) l.material = ewMat;
      for (const l of ch.lights.ns) l.material = nsMat;
    }
  }
}
