// Chunk streaming: the archipelago is cut into 64 m chunks that spring up
// around the truck as it drives — including chunks of the NEXT city once its
// shore comes into range, so driving across a strait feels seamless. Chunks
// farther out are disposed. Also owns the dynamic traffic-light props at
// signalized intersections.
import * as THREE from 'three';
import { generateCityChunk, type CollisionBox, type ChunkGlow } from '../../worlds/cityChunk.js';
import type { NightLights } from './nightLights.js';
import { meshFromBakedData, type BakedData } from '../../engine/baked.js';
import { cityPlanFor } from '../../worlds/cityPlan.js';
import { cityAt, CITY_PITCH } from '../../worlds/cityGrid.js';
import { WORLD_CHUNKS } from '../../worlds/world.js';
import { coastFor, clipToRect } from '../../worlds/coast.js';
import { chunkLights, type ChunkLight } from '../../worlds/roadLayout.js';
import { lightState } from './lights.js';
import { makeTrafficLights, setHead, type TrafficLightProps, type LampHead } from './lampProps.js';

const CHUNKS_PER_CITY = CITY_PITCH / 64; // world-chunk stride between city cells
/** chunk bakes queued at the worker at once (nearest first; only a few, so
 * a change of direction re-prioritizes quickly) */
const MAX_IN_FLIGHT = 4;

export interface Chunk {
  mesh: THREE.Mesh;
  boxes: CollisionBox[];
  /** world-chunk coordinates (for disposal distance) */
  wx: number;
  wz: number;
  cx: number;
  cz: number;
  /** working traffic lights at this chunk's signalized junctions */
  lights: Array<{ x: number; z: number; props: TrafficLightProps }>;
}

export class ChunkManager {
  private chunks = new Map<string, Chunk>();
  private pending = new Set<string>();
  private queue: Array<[number, number, number, number, string]> = [];
  private landCache = new Map<string, boolean>();

  /** the chunks' lamps glow here at night (G10) */
  night: NightLights | null = null;

  constructor(private scene: THREE.Scene, private CH = 64, private VIEW_R = 4) {}

  /** resolve a world-chunk column/row to the owning city + local chunk */
  private resolve(wx: number, wz: number): { bx: number; by: number; cx: number; cz: number } | null {
    const city = cityAt(wx * this.CH + 0.5, wz * this.CH + 0.5);
    const cx = wx - Math.round((city.ox / this.CH));
    const cz = wz - Math.round((city.oz / this.CH));
    if (cx < 0 || cz < 0 || cx >= WORLD_CHUNKS || cz >= WORLD_CHUNKS) return null; // open water
    // a chunk entirely off the island's shore is sea: nothing to build
    const k = `${city.bx},${city.by},${cx},${cz}`;
    let land = this.landCache.get(k);
    if (land === undefined) {
      land = clipToRect(coastFor(city.bx, city.by).pts, cx * this.CH, cz * this.CH, (cx + 1) * this.CH, (cz + 1) * this.CH).length >= 3;
      this.landCache.set(k, land);
    }
    if (!land) return null;
    return { bx: city.bx, by: city.by, cx, cz };
  }

  // ---- the chunk worker (chunkWorker.ts): bakes chunks off the main
  // thread; without it (or if it fails) chunks bake here, as before ----
  private worker: Worker | null = null;
  private inFlight = new Map<string, [number, number, number, number]>();
  private here = { wx: 0, wz: 0 };
  private base: () => number = () => 0;

  /** hand chunk baking to a worker (already sent the templates) */
  attachWorker(w: Worker, base: () => number): void {
    this.worker = w;
    this.base = base;
    w.onmessage = (e: MessageEvent<{ ok: boolean; key: string; geo?: BakedData; boxes?: CollisionBox[]; lights?: ChunkLight[]; glows?: ChunkGlow[]; error?: string }>) => {
      const r = e.data;
      const at = this.inFlight.get(r.key);
      this.inFlight.delete(r.key);
      this.pending.delete(r.key);
      if (!at || this.chunks.has(r.key)) return;
      const [bx, by, cx, cz] = at;
      const wx = bx * CHUNKS_PER_CITY + cx, wz = by * CHUNKS_PER_CITY + cz;
      if (Math.max(Math.abs(wx - this.here.wx), Math.abs(wz - this.here.wz)) > this.VIEW_R + 1) return; // gone out of range
      if (!r.ok || !r.geo) { console.warn('chunk worker failed on', r.key, r.error); this.addChunk(bx, by, cx, cz); return; }
      this.finish(bx, by, cx, cz, meshFromBakedData(r.geo), r.boxes!, r.glows ?? [], r.lights);
    };
    w.onerror = e => {
      console.warn('chunk worker error', e.message);
      this.worker = null;
      for (const k of this.inFlight.keys()) this.pending.delete(k);
      this.inFlight.clear();
    };
  }

  /** chunk bakes waiting at the worker (debug) */
  get baking(): number { return this.inFlight.size; }

  addChunk(bx: number, by: number, cx: number, cz: number): void {
    const key = `${bx},${by},${cx},${cz}`;
    if (this.chunks.has(key)) return;
    const { mesh, boxes, glows } = generateCityChunk(bx, by, cx, cz);
    this.finish(bx, by, cx, cz, mesh, boxes, glows);
  }

  /** a baked chunk joins the world (world-offset mesh, boxes, lights) */
  private finish(bx: number, by: number, cx: number, cz: number, mesh: THREE.Mesh, boxes: CollisionBox[], glows: ChunkGlow[],
                 /** the worker's lights (else read from the plan here) */
                 lightData: ChunkLight[] = chunkLights(bx, by, cx, cz)): void {
    const key = `${bx},${by},${cx},${cz}`;
    if (this.chunks.has(key)) return;
    const ox = bx * CITY_PITCH, oz = by * CITY_PITCH;
    mesh.position.set(ox, 0, oz); // chunk geometry is city-local
    this.scene.add(mesh);
    // collision boxes move from city-local to world coordinates
    const wboxes = boxes.map(b => ({
      ...b, x1: b.x1 + ox, x2: b.x2 + ox, z1: b.z1 + oz, z2: b.z2 + oz,
      obb: b.obb ? { ...b.obb, cx: b.obb.cx + ox, cz: b.obb.cz + oz } : undefined,
    }));
    // working kit traffic lights at real intersections: one pole per
    // approach arm, on the driver's near-side right corner
    const lights: Chunk['lights'] = [];
    for (const n of lightData) {
      const props = makeTrafficLights(n.poles.map(p => ({ ...p, x: p.x + ox, z: p.z + oz })));
      this.scene.add(props.group);
      lights.push({ x: n.x, z: n.z, props });
    }
    const wx = bx * CHUNKS_PER_CITY + cx, wz = by * CHUNKS_PER_CITY + cz;
    this.chunks.set(key, { mesh, boxes: wboxes, wx, wz, cx, cz, lights });
    this.night?.addChunk(key, glows, ox, oz);
  }

  forceChunkAt(px: number, pz: number): void {
    const r = this.resolve(Math.floor(px / this.CH), Math.floor(pz / this.CH));
    if (r) this.addChunk(r.bx, r.by, r.cx, r.cz);
  }

  /** Build pending chunks nearest the player first (budget per frame). */
  /** the chunks in view of world (px, pz) not built yet, nearest first
   * (the boot bakes these a few a frame, under its progress bar) */
  wanted(px: number, pz: number): Array<[number, number, number, number]> {
    const CH = this.CH, VIEW_R = this.VIEW_R;
    const wcx = Math.floor(px / CH), wcz = Math.floor(pz / CH);
    const out: Array<[number, number, number, number, number]> = [];
    for (let dx = -VIEW_R; dx <= VIEW_R; dx++) {
      for (let dz = -VIEW_R; dz <= VIEW_R; dz++) {
        const r = this.resolve(wcx + dx, wcz + dz);
        if (!r || this.chunks.has(`${r.bx},${r.by},${r.cx},${r.cz}`)) continue;
        out.push([r.bx, r.by, r.cx, r.cz, Math.abs(dx) + Math.abs(dz)]);
      }
    }
    return out.sort((a, b) => a[4] - b[4]).map(([bx, by, cx, cz]) => [bx, by, cx, cz]);
  }

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
    this.here = { wx: wcx, wz: wcz };
    let made = 0;
    if (this.worker) {
      // keep a few bakes in flight, nearest first
      while (this.queue.length && this.inFlight.size < MAX_IN_FLIGHT) {
        const [bx, by, cx, cz, key] = this.queue.shift()!;
        if (this.chunks.has(key)) { this.pending.delete(key); continue; }
        this.inFlight.set(key, [bx, by, cx, cz]);
        this.worker.postMessage({ type: 'chunk', base: this.base(), bx, by, cx, cz, key });
      }
    } else {
      while (this.queue.length && made < budget) {
        const [bx, by, cx, cz, key] = this.queue.shift()!;
        this.pending.delete(key);
        if (this.chunks.has(key)) continue;
        this.addChunk(bx, by, cx, cz);
        made++;
      }
    }
    for (const [key, ch] of this.chunks) {
      if (Math.max(Math.abs(ch.wx - wcx), Math.abs(ch.wz - wcz)) > VIEW_R + 1) {
        this.scene.remove(ch.mesh);
        ch.mesh.geometry.dispose();
        for (const l of ch.lights) this.scene.remove(l.props.group);
        this.night?.dropChunk(key);
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

  /** Sync every visible traffic light to its intersection's phase; at
   * night each lit lamp near (px, pz) glows too (G10) */
  updateLights(elapsed: number, px = 0, pz = 0): void {
    const glow = this.night && this.night.night.value > 0.01;
    for (const ch of this.chunks.values()) {
      for (const l of ch.lights) {
        const st = lightState(l.x, l.z, elapsed);
        const ew = st === 'ew' ? 'go' : st === 'ewY' ? 'slow' : 'stop';
        const ns = st === 'ns' ? 'go' : st === 'nsY' ? 'slow' : 'stop';
        for (const h of l.props.ew) setHead(h, ew);
        for (const h of l.props.ns) setHead(h, ns);
        if (glow && Math.abs(l.x + ch.mesh.position.x - px) < 260 && Math.abs(l.z + ch.mesh.position.z - pz) < 260) {
          for (const h of l.props.ew) this.glowHead(h, ew);
          for (const h of l.props.ns) this.glowHead(h, ns);
        }
      }
    }
  }

  private _p = new THREE.Vector3();
  private glowHead(h: LampHead, phase: 'go' | 'slow' | 'stop'): void {
    const lamp = phase === 'go' ? h.green : phase === 'slow' ? h.yellow : h.red;
    lamp.getWorldPosition(this._p);
    this.night!.flash({ x: this._p.x, y: this._p.y, z: this._p.z, color: phase === 'go' ? 0x3cff6a : phase === 'slow' ? 0xffc21a : 0xff3b2e, size: 0.9, pool: 0, face: lamp.userData.face });
  }
}
