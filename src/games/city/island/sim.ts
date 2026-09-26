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
import { IslandWalkers, type Threat } from './walkers.js';
import type { BakedTemplate } from '../../../engine/assets.js';
import type { Railway } from '../railway.js';

/** a dormant island catches up this much on waking, at most (seconds) */
const CATCH_UP = 90;
const STEP = 0.25;
/** the catch-up runs a few milliseconds a frame, not all in the waking
 * frame (a full 90 s catch-up is ~3 s of work): the island is still ~200 m
 * away when it wakes, and it steps exactly as it would have in one go */
const CATCH_UP_BUDGET_MS = 4;

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
  /** still catching up after waking (not drawn until it has) */
  private lagging = false;

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
    // last CATCH_UP seconds of it, on the game clock) — spread over the
    // next frames (update)
    const gap = Math.min(CATCH_UP, elapsed - this.sleptAt);
    // (the first catch-up step lands on elapsed - gap, as a single loop would)
    this.simTime = elapsed - gap - STEP;
    this.lagging = gap >= STEP;
  }

  /** still catching up after waking */
  get catchingUp(): boolean { return this.lagging; }

  /** one frame: `player` is where the kid is (world), `threat` the ground
   * vehicle people scurry from (null when flying/sailing) */
  update(dt: number, elapsed: number, player: THREE.Vector3, threat: Threat | null): void {
    if (!this.active) return;
    if (this.lagging) {
      const t0 = performance.now();
      while (this.simTime + STEP < elapsed && performance.now() - t0 < CATCH_UP_BUDGET_MS) {
        this.tick(STEP, this.simTime + STEP, null, null, false);
      }
      if (this.simTime + STEP < elapsed) return;
      this.lagging = false;
      dt = elapsed - this.simTime;
    }
    this.tick(dt, elapsed, player, threat, true);
  }

  private tick(dt: number, t: number, player: THREE.Vector3 | null, threat: Threat | null, draw: boolean): void {
    this.simTime = t;
    // (the cars stop for the walkers on their crossings, the walkers wait
    // at the corners for the cars — each sees the other's last step)
    // (cars queue behind the kid's road vehicle — its footprint is the
    // walkers' threat; a flying one passes nothing to wait behind)
    this.cars.update(dt, t, this.opts.railway, player, draw, this.walkers.walkers, threat);
    this.walkers.update(dt, t, this.opts.railway, threat, player, draw, this.cars.cars);
    if (draw) this.fleet.update(this.simTime);
  }

  dispose(): void {
    this.cars.dispose();
    this.walkers.dispose();
    this.fleet.dispose();
  }
}
