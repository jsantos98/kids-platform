// Ambient traffic: AI cars that actually follow the streets. Each car drives
// node-to-node along OPEN segments of the plan, picks a new direction at every
// junction (preferring straight), keeps to the right-hand lane, stops at red
// lights and queues at level crossings while a train passes.
import * as THREE from 'three';
import { makeCar } from '../../kit/index.js';
import { spawnVehicle, wheelNodes } from '../../engine/assets.js';
import { RoadGrid } from '../../worlds/roadGrid.js';
import { cityPlanFor, type Crossing } from '../../worlds/cityPlan.js';
import { WORLD_CHUNKS } from '../../worlds/world.js';
import { lightState, STOP_LINE } from './lights.js';
import { CROSSING_WARN_DIST } from './transit.js';
import type { Trains } from './train.js';

const MODELS = [
  '/assets/kenney/sedan.glb', '/assets/kenney/taxi.glb', '/assets/kenney/suv.glb',
  '/assets/kenney/van.glb', '/assets/kenney/police.glb', '/assets/kenney/ambulance.glb',
  '/assets/kenney/hatchback-sports.glb',
];
const FALLBACK_COLORS = [0xfaf7ef, 0xd9dde2, 0x7fb2d9, 0xe25c5c];
const LANE = 3.5; // lane centre offset from the road centreline (right-hand)

interface AI {
  fx: number; fz: number;   // from lattice node
  tx: number; tz: number;   // to lattice node
  t: number;                // progress along the segment, 0..1
  speed: number;
  v: number;
}

interface TrafficCar extends THREE.Group {
  userData: { ai: AI; wheels?: THREE.Object3D[] };
}

/** right-hand perpendicular of the travel direction (screen coords: +z south) */
const rightOf = (hx: number, hz: number): { x: number; z: number } => ({ x: -hz, z: hx });

const camDir = new THREE.Vector3();

export class Traffic {
  private cars: TrafficCar[] = [];
  /** segment key "fx,fz,tx,tz" → level crossings on it */
  private crossingsBySeg = new Map<string, Crossing[]>();
  /** world offset of the city the AI is driving in */
  private ox = 0;
  private oz = 0;

  constructor(private scene: THREE.Scene, private grid: RoadGrid, private CH: number, count = 12,
              extraModels: string[] = [], private trains: Trains | null = null,
              private camera?: THREE.Camera) {
    const models = [...MODELS, ...extraModels];
    for (let i = 0; i < count; i++) {
      const c = makeCar({ body: FALLBACK_COLORS[i % 4] }) as TrafficCar;
      c.userData.ai = { fx: 0, fz: 0, tx: 1, tz: 0, t: 0, speed: 6 + Math.random() * 4, v: 0 };
      scene.add(c);
      this.cars.push(c);
      spawnVehicle(models[i % models.length], { len: 4.4 }).then(g => {
        c.clear();
        c.add(g);
        c.userData.wheels = wheelNodes(g);
      }).catch(() => {});
    }
  }

  /** switch cities: rebuild the crossing map, move the origin, respawn the
   * cars on the new street network near the player */
  setCity(bx: number, by: number, ox: number, oz: number, player: THREE.Vector3): void {
    this.ox = ox;
    this.oz = oz;
    this.crossingsBySeg.clear();
    for (const c of cityPlanFor(bx, by).crossings) {
      const horiz = c.axis === 'h';
      const line = Math.round((horiz ? c.z : c.x) / this.CH);
      const idx = Math.floor((horiz ? c.x : c.z) / this.CH);
      const keys = horiz
        ? [`${idx},${line},${idx + 1},${line}`, `${idx + 1},${line},${idx},${line}`]
        : [`${line},${idx},${line},${idx + 1}`, `${line},${idx + 1},${line},${idx}`];
      for (const k of keys) {
        if (!this.crossingsBySeg.has(k)) this.crossingsBySeg.set(k, []);
        this.crossingsBySeg.get(k)!.push(c);
      }
    }
    for (const c of this.cars) this.respawn(c, player);
  }

  /** would a car at world (x, z) be on camera? Roughly the camera's forward
   * hemisphere inside the fog line — anything behind it or beyond the fog is
   * a safe place to appear. */
  private inSight(x: number, z: number): boolean {
    if (!this.camera) return false;
    this.camera.getWorldDirection(camDir);
    const dx = x - this.camera.position.x, dz = z - this.camera.position.z;
    const dist = Math.hypot(dx, dz);
    if (dist < 30) return true;    // right on top of the camera
    if (dist > 170) return false;  // beyond the fog line
    const fl = Math.hypot(camDir.x, camDir.z) || 1;
    const dot = (dx * camDir.x + dz * camDir.z) / (dist * fl);
    return dot > -0.2;
  }

  /** Move a car onto an open street segment near the player (city-local),
   * NEVER on camera: out-of-sight candidates win, and only when 24 draws
   * produce none does the farthest in-fog candidate fall through. */
  respawn(c: TrafficCar, player: THREE.Vector3): void {
    const ai = c.userData.ai;
    const lx = player.x - this.ox, lz = player.z - this.oz;
    const pi = Math.round(lx / this.CH), pj = Math.round(lz / this.CH);
    let best: [number, number, number, number, number] | null = null;
    let bestDist = -1;
    for (let tries = 0; tries < 24; tries++) {
      const i = Math.max(0, Math.min(WORLD_CHUNKS - 1, pi + ((Math.random() * 5) | 0) - 2));
      const j = Math.max(0, Math.min(WORLD_CHUNKS - 1, pj + ((Math.random() * 5) | 0) - 2));
      const opts: Array<[number, number]> = [];
      if (this.grid.segH(j, i)) opts.push([i + 1, j]);
      if (this.grid.segH(j, i - 1)) opts.push([i - 1, j]);
      if (this.grid.segV(i, j)) opts.push([i, j + 1]);
      if (this.grid.segV(i, j - 1)) opts.push([i, j - 1]);
      if (!opts.length) continue;
      const [tx, tz] = opts[(Math.random() * opts.length) | 0];
      const t = Math.random() * 0.7;
      // world position this placement would put the car at (right lane)
      const hx = Math.sign(tx - i), hz = Math.sign(tz - j);
      const r = rightOf(hx, hz);
      const wx = this.ox + i * this.CH + (tx - i) * this.CH * t + r.x * LANE;
      const wz = this.oz + j * this.CH + (tz - j) * this.CH * t + r.z * LANE;
      const dp = Math.hypot(wx - player.x, wz - player.z);
      if (dp > 190 || dp < 25) continue; // keep the fleet in the active ring
      // no ghost stacks: keep clear of the rest of the fleet
      let crowded = false;
      for (const o of this.cars) {
        if (o !== c && Math.hypot(o.position.x - wx, o.position.z - wz) < 14) { crowded = true; break; }
      }
      if (crowded) continue;
      if (!this.inSight(wx, wz)) {
        ai.fx = i; ai.fz = j; ai.tx = tx; ai.tz = tz; ai.t = t; ai.v = ai.speed;
        this.place(c, ai);
        return;
      }
      if (dp > bestDist) { best = [i, j, tx, tz, t]; bestDist = dp; }
    }
    if (best) { // everything drawn was on camera — the fog covers the farthest
      ai.fx = best[0]; ai.fz = best[1]; ai.tx = best[2]; ai.tz = best[3]; ai.t = best[4];
      ai.v = ai.speed;
      this.place(c, ai);
    }
  }

  /** world position + heading for a car's current segment progress */
  private place(c: TrafficCar, ai: AI): void {
    const hx = Math.sign(ai.tx - ai.fx), hz = Math.sign(ai.tz - ai.fz);
    const r = rightOf(hx, hz);
    c.position.set(
      this.ox + ai.fx * this.CH + (ai.tx - ai.fx) * this.CH * ai.t + r.x * LANE,
      0,
      this.oz + ai.fz * this.CH + (ai.tz - ai.fz) * this.CH * ai.t + r.z * LANE,
    );
    c.rotation.y = Math.atan2(hx, hz);
  }

  update(dt: number, elapsed: number, player: THREE.Vector3): void {
    for (const c of this.cars) {
      const ai = c.userData.ai;
      const horiz = ai.tz === ai.fz;
      const sign = horiz ? Math.sign(ai.tx - ai.fx) : Math.sign(ai.tz - ai.fz);

      // ---- speed target: red lights + level crossings ----
      let vTarget = ai.speed;

      // red lights at the junction we're approaching (signalized to-node)
      if (this.grid.cross(ai.tx, ai.tz)) {
        const st = lightState(ai.tx, ai.tz, elapsed);
        const green = horiz ? st === 'ew' : st === 'ns';
        if (!green) {
          const dStop = (1 - STOP_LINE / this.CH - ai.t) * this.CH;
          if (dStop < 12) vTarget = Math.min(vTarget, Math.max(0, dStop * 1.4));
        }
      }

      // level crossings on this segment: hold back while the crossing is
      // warning (lamps flashing, booms closing) for a train
      const segKey = `${ai.fx},${ai.fz},${ai.tx},${ai.tz}`;
      const segCrossings = this.crossingsBySeg.get(segKey);
      if (segCrossings && this.trains) {
        for (const cr of segCrossings) {
          const along = horiz ? cr.x : cr.z;
          const from = (horiz ? ai.fx : ai.fz) * this.CH;
          const tC = ((along - from) * sign) / this.CH;
          if (tC <= ai.t) continue; // already past it — keep going
          if (this.trains.distTo(cr.d) < CROSSING_WARN_DIST) {
            const dStop = (tC - 10.5 / this.CH - ai.t) * this.CH;
            if (dStop < 16) vTarget = Math.min(vTarget, Math.max(0, dStop * 1.4));
          }
        }
      }

      // approach the node; pick the next street on arrival
      ai.v += Math.max(-8 * dt, Math.min(5 * dt, vTarget - ai.v));
      ai.t += (ai.v * dt) / this.CH;
      if (ai.t >= 1) {
        const over = ai.t - 1;
        const next = this.nextNodes(ai.tx, ai.tz, horiz ? [sign, 0] : [0, sign]);
        if (next) {
          ai.fx = ai.tx; ai.fz = ai.tz;
          ai.tx = next[0]; ai.tz = next[1];
          ai.t = over;
        } else {
          ai.t = 0.98; // boxed in (shouldn't happen on a connected grid)
        }
      }
      this.place(c, ai);

      for (const w of (c.userData.wheels ?? [])) (w as THREE.Object3D).rotation.x += (ai.v * dt) / 0.42;
      if (c.position.distanceTo(player) > 190) this.respawn(c, player);
    }
  }

  /** choose the next node at a junction: prefer straight, never U-turn
   * unless it's the only option. Returns null when nothing is open. */
  private nextNodes(i: number, j: number, dir: [number, number]): [number, number] | null {
    const opts: Array<[number, number]> = [];
    const push = (ni: number, nj: number, open: boolean): void => {
      if (open && !(ni === i - dir[0] && nj === j - dir[1])) opts.push([ni, nj]);
    };
    push(i + 1, j, this.grid.segH(j, i));       // east
    push(i - 1, j, this.grid.segH(j, i - 1));   // west
    push(i, j + 1, this.grid.segV(i, j));       // south
    push(i, j - 1, this.grid.segV(i, j - 1));   // north
    if (!opts.length) return null;
    const straight: [number, number] = [i + dir[0], j + dir[1]];
    const straightOpt = opts.find(o => o[0] === straight[0] && o[1] === straight[1]);
    if (straightOpt && Math.random() < 0.62) return straightOpt;
    return opts[(Math.random() * opts.length) | 0];
  }
}
