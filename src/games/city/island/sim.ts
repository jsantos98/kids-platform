// One island's living things: its fixed fleet of cars, its crowd of
// pedestrians and pets, and its boats (the trains are world-level — see
// railway.ts — and the cars ask them at every level crossing).
// They are created once, seeded from the island's coordinates, and keep
// their state for good; a dormant island stops ticking and is fast-forwarded
// (up to 90 s) when the player comes back.
import * as THREE from 'three';
import { citySeed, CITY_PITCH } from '../../../worlds/cityGrid.js';
import { Fleet } from '../sea.js';
import { IslandCars } from './cars.js';
import { IslandWalkers } from './walkers.js';
import type { BakedTemplate } from '../../../engine/assets.js';
import type { Railway } from '../railway.js';

/** a dormant island catches up this much on waking, at most (seconds) */
const CATCH_UP = 90;
const STEP = 0.25;

export interface SimOptions {
  /** extra car models in the fleet (the fire truck when the kid isn't driving it) */
  extraCars: string[];
  pets: BakedTemplate[];
  people: BakedTemplate[];
  /** the world's trains (the cars hold at level crossings for them) */
  railway: Railway;
}

export class IslandSim {
  readonly key: string;
  readonly ox: number;
  readonly oz: number;
  readonly cars: IslandCars;
  readonly walkers: IslandWalkers;
  readonly fleet: Fleet;
  /** the game time the island was last simulated to — everything runs on
   * the game clock so the cars read the same light phases the lamps show */
  simTime = 0;
  active = false;
  /** the game's elapsed time when this island went dormant */
  private sleptAt = 0;

  constructor(scene: THREE.Scene, readonly bx: number, readonly by: number, private opts: SimOptions) {
    this.key = `${bx},${by}`;
    this.ox = bx * CITY_PITCH;
    this.oz = by * CITY_PITCH;
    this.cars = new IslandCars(scene, bx, by, this.ox, this.oz, opts.extraCars);
    this.walkers = new IslandWalkers(scene, bx, by, this.ox, this.oz, opts.pets, opts.people);
    this.fleet = new Fleet(scene, this.ox, this.oz, citySeed(bx, by), bx, by);
  }

  /** wake up (catching up on the time spent dormant) or go dormant */
  setActive(on: boolean, elapsed: number): void {
    if (on === this.active) return;
    this.active = on;
    if (!on) {
      this.sleptAt = elapsed;
      this.cars.hide();
      this.walkers.hide();
      this.fleet.hide();
      return;
    }
    // catch up: whatever happened while nobody was watching, fast (the
    // last CATCH_UP seconds of it, on the game clock)
    const gap = Math.min(CATCH_UP, elapsed - this.sleptAt);
    for (let t = elapsed - gap; t < elapsed; t += STEP) this.tick(STEP, t, null, null, false);
  }

  /** one frame: `player` is where the kid is (world), `threat` the ground
   * vehicle people scurry from (null when flying/sailing) */
  update(dt: number, elapsed: number, player: THREE.Vector3, threat: THREE.Vector3 | null): void {
    if (!this.active) return;
    this.tick(dt, elapsed, player, threat, true);
  }

  private tick(dt: number, t: number, player: THREE.Vector3 | null, threat: THREE.Vector3 | null, draw: boolean): void {
    this.simTime = t;
    this.cars.update(dt, t, this.opts.railway, player, draw);
    this.walkers.update(dt, threat, player, draw);
    if (draw) this.fleet.update(this.simTime);
  }

  dispose(): void {
    this.cars.dispose();
    this.walkers.dispose();
    this.fleet.dispose();
  }
}
