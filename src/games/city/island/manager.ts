// Which islands are alive: the one the player is on, always, plus the
// neighbour whose shore the player is within 200 m of — so crossing a strait
// shows both islands' trains, traffic, people and boats going about their
// business. Simulations are kept (dormant) for a few islands, so coming back
// finds the same people and cars where time would have taken them.
import * as THREE from 'three';
import { cityAt, CITY_PITCH } from '../../../worlds/cityGrid.js';
import { ISLAND } from '../../../worlds/world.js';
import { IslandSim, type SimOptions } from './sim.js';

const NEAR = 200;   // m from a neighbour island's edge that wakes it
const KEEP = 4;     // simulations kept in memory (active + dormant)

export class IslandManager {
  private sims = new Map<string, IslandSim>();

  constructor(private scene: THREE.Scene, private opts: SimOptions) {}

  /** the island simulation for city (bx, by), created on first use */
  sim(bx: number, by: number): IslandSim {
    const key = `${bx},${by}`;
    let s = this.sims.get(key);
    if (!s) {
      s = new IslandSim(this.scene, bx, by, this.opts);
      this.sims.set(key, s);
    } else {
      // LRU touch
      this.sims.delete(key);
      this.sims.set(key, s);
    }
    return s;
  }

  /** the islands that should be awake around world point (x, z) */
  private wanted(x: number, z: number): Array<[number, number]> {
    const here = cityAt(x, z);
    const out: Array<[number, number]> = [[here.bx, here.by]];
    const lx = x - here.ox, lz = z - here.oz;
    // distance from the player to each neighbour island's square
    const toward: Array<[number, number, number]> = [
      [here.bx + 1, here.by, CITY_PITCH - lx],        // east island starts at local x = pitch
      [here.bx - 1, here.by, lx + (CITY_PITCH - ISLAND)], // west island ends at -strait
      [here.bx, here.by + 1, CITY_PITCH - lz],
      [here.bx, here.by - 1, lz + (CITY_PITCH - ISLAND)],
    ];
    let best: [number, number, number] | null = null;
    for (const t of toward) if (t[2] < NEAR && (!best || t[2] < best[2])) best = t;
    if (best) out.push([best[0], best[1]]);
    return out;
  }

  update(dt: number, elapsed: number, player: THREE.Vector3, threat: THREE.Vector3 | null): void {
    const want = this.wanted(player.x, player.z);
    const keys = new Set(want.map(([bx, by]) => `${bx},${by}`));
    for (const [bx, by] of want) this.sim(bx, by).setActive(true, elapsed);
    for (const [key, s] of this.sims) if (!keys.has(key)) s.setActive(false, elapsed);
    // forget the oldest dormant islands beyond the budget
    while (this.sims.size > KEEP) {
      const oldest = [...this.sims.entries()].find(([k]) => !keys.has(k));
      if (!oldest) break;
      oldest[1].dispose();
      this.sims.delete(oldest[0]);
    }
    for (const s of this.sims.values()) s.update(dt, elapsed, player, threat);
  }

  /** every awake island's boats (the minimap's dots) */
  boatDots(): Array<{ x: number; z: number }> {
    return [...this.sims.values()].filter(s => s.active).flatMap(s => s.fleet.dots());
  }

  /** debug: awake / dormant islands and their populations */
  list(): unknown {
    return [...this.sims.values()].map(s => ({
      key: s.key, active: s.active, t: +s.simTime.toFixed(1),
      cars: s.cars.cars.length, walkers: s.walkers.walkers.length,
    }));
  }
}
