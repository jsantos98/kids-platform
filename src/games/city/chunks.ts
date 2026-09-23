// Chunk streaming: the archipelago is cut into 64 m chunks that spring up
// around the truck as it drives — including chunks of the NEXT city once its
// shore comes into range, so driving across a strait feels seamless. Chunks
// farther out are disposed. Also owns the dynamic traffic-light props at
// signalized intersections.
import * as THREE from 'three';
import { generateCityChunk, type CollisionBox } from '../../worlds/cityChunk.js';
import { cityPlanFor } from '../../worlds/cityPlan.js';
import { cityAt, CITY_PITCH } from '../../worlds/cityGrid.js';
import { WORLD_CHUNKS } from '../../worlds/world.js';
import { lightState } from './lights.js';
import { LAMP_MATS, makeTrafficLights } from './lampProps.js';

const CHUNKS_PER_CITY = CITY_PITCH / 64; // world-chunk stride between city cells

export interface Chunk {
  mesh: THREE.Mesh;
  boxes: CollisionBox[];
  /** world-chunk coordinates (for disposal distance) */
  wx: number;
  wz: number;
  cx: number;
  cz: number;
  lights: { group: THREE.Group; ew: THREE.Mesh[]; ns: THREE.Mesh[] } | null;
}

export class ChunkManager {
  private chunks = new Map<string, Chunk>();
  private pending = new Set<string>();
  private queue: Array<[number, number, number, number, string]> = [];

  constructor(private scene: THREE.Scene, private CH = 64, private VIEW_R = 4) {}

  /** resolve a world-chunk column/row to the owning city + local chunk */
  private resolve(wx: number, wz: number): { bx: number; by: number; cx: number; cz: number } | null {
    const city = cityAt(wx * this.CH + 0.5, wz * this.CH + 0.5);
    const cx = wx - Math.round((city.ox / this.CH));
    const cz = wz - Math.round((city.oz / this.CH));
    if (cx < 0 || cz < 0 || cx >= WORLD_CHUNKS || cz >= WORLD_CHUNKS) return null; // open water
    return { bx: city.bx, by: city.by, cx, cz };
  }

  addChunk(bx: number, by: number, cx: number, cz: number): void {
    const key = `${bx},${by},${cx},${cz}`;
    if (this.chunks.has(key)) return;
    const { mesh, boxes } = generateCityChunk(bx, by, cx, cz);
    const ox = bx * CITY_PITCH, oz = by * CITY_PITCH;
    mesh.position.set(ox, 0, oz); // chunk geometry is city-local
    this.scene.add(mesh);
    // collision boxes move from city-local to world coordinates
    const wboxes = boxes.map(b => ({ ...b, x1: b.x1 + ox, x2: b.x2 + ox, z1: b.z1 + oz, z2: b.z2 + oz }));
    // working lights only at real intersections
    const plan = cityPlanFor(bx, by);
    const lights = plan.signalized(cx, cz) ? makeTrafficLights(ox + cx * this.CH, oz + cz * this.CH) : null;
    if (lights) this.scene.add(lights.group);
    const wx = bx * CHUNKS_PER_CITY + cx, wz = by * CHUNKS_PER_CITY + cz;
    this.chunks.set(key, { mesh, boxes: wboxes, wx, wz, cx, cz, lights });
  }

  forceChunkAt(px: number, pz: number): void {
    const r = this.resolve(Math.floor(px / this.CH), Math.floor(pz / this.CH));
    if (r) this.addChunk(r.bx, r.by, r.cx, r.cz);
  }

  /** Build pending chunks nearest the player first (budget per frame). */
  ensure(budget: number, px: number, pz: number): void {
    const CH = this.CH, VIEW_R = this.VIEW_R;
    const wcx = Math.floor(px / CH), wcz = Math.floor(pz / CH);
    for (let dx = -VIEW_R; dx <= VIEW_R; dx++) {
      for (let dz = -VIEW_R; dz <= VIEW_R; dz++) {
        const wx = wcx + dx, wz = wcz + dz;
        const r = this.resolve(wx, wz);
        if (!r) continue; // strait — no chunk to build
        const key = `${r.bx},${r.by},${r.cx},${r.cz}`;
        if (!this.chunks.has(key) && !this.pending.has(key)) {
          this.pending.add(key);
          this.queue.push([r.bx, r.by, r.cx, r.cz, key]);
        }
      }
    }
    this.queue.sort((a, b) => {
      const acx = a[0] * CHUNKS_PER_CITY + a[2], acz = a[1] * CHUNKS_PER_CITY + a[3];
      const bcx = b[0] * CHUNKS_PER_CITY + b[2], bcz = b[1] * CHUNKS_PER_CITY + b[3];
      return (Math.abs(acx - wcx) + Math.abs(acz - wcz)) - (Math.abs(bcx - wcx) + Math.abs(bcz - wcz));
    });
    let made = 0;
    while (this.queue.length && made < budget) {
      const [bx, by, cx, cz, key] = this.queue.shift()!;
      this.pending.delete(key);
      if (this.chunks.has(key)) continue;
      this.addChunk(bx, by, cx, cz);
      made++;
    }
    for (const [key, ch] of this.chunks) {
      if (Math.max(Math.abs(ch.wx - wcx), Math.abs(ch.wz - wcz)) > VIEW_R + 1) {
        this.scene.remove(ch.mesh);
        ch.mesh.geometry.dispose();
        if (ch.lights) this.scene.remove(ch.lights.group);
        this.chunks.delete(key);
      }
    }
  }

  boxesNear(px: number, pz: number): CollisionBox[] {
    const CH = this.CH;
    const wcx = Math.floor(px / CH), wcz = Math.floor(pz / CH);
    const out: CollisionBox[] = [];
    for (const ch of this.chunks.values()) {
      if (Math.abs(ch.wx - wcx) <= 1 && Math.abs(ch.wz - wcz) <= 1) out.push(...ch.boxes);
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
