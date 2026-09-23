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

export class Traffic {
  private cars: TrafficCar[] = [];
  /** segment key "fx,fz,tx,tz" → level crossings on it */
  private crossingsBySeg = new Map<string, Crossing[]>();
  /** world offset of the city the AI is driving in */
  private ox = 0;
  private oz = 0;

  constructor(private scene: THREE.Scene, private grid: RoadGrid, private CH: number, count = 12,
              extraModels: string[] = [], private trains: Trains | null = null) {
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

  /** Move a car onto an open street segment near the player (city-local). */
  respawn(c: TrafficCar, player: THREE.Vector3): void {
    const ai = c.userData.ai;
    const lx = player.x - this.ox, lz = player.z - this.oz;
    const pi = Math.round(lx / this.CH), pj = Math.round(lz / this.CH);
    for (let tries = 0; tries < 12; tries++) {
      const i = Math.max(0, Math.min(WORLD_CHUNKS - 1, pi + ((Math.random() * 5) | 0) - 2));
      const j = Math.max(0, Math.min(WORLD_CHUNKS - 1, pj + ((Math.random() * 5) | 0) - 2));
      const opts: Array<[number, number]> = [];
      if (this.grid.segH(j, i)) opts.push([i + 1, j]);
      if (this.grid.segH(j, i - 1)) opts.push([i - 1, j]);
      if (this.grid.segV(i, j)) opts.push([i, j + 1]);
      if (this.grid.segV(i, j - 1)) opts.push([i, j - 1]);
      if (!opts.length) continue;
      const [tx, tz] = opts[(Math.random() * opts.length) | 0];
      ai.fx = i; ai.fz = j; ai.tx = tx; ai.tz = tz;
      ai.t = Math.random() * 0.7;
      ai.v = ai.speed;
      this.place(c, ai);
      return;
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
