// An island's generated world as plain, transferable data: the rail net,
// the race circuit, the street net, the plan and the occupancy grid — the
// heavy part of every island (~2 s). The world worker (worldWorker.ts)
// builds it off the main thread; the game installs it into the generators'
// own caches, so every synchronous getter (cityPlanFor, railNetFor, ...)
// then answers from the cache. The installed objects are assembled by the
// same code the generators use, so they are identical to a local build.
import { railNetFor, hasRailNet, installRailNet, clearRailCache, type RailNetData } from './railRoute.js';
import { raceTrackFor, hasRaceTrack, installRaceTrack, clearRaceCache, type RaceData } from './raceIsland.js';
import { streetNetFor, hasStreetNet, installStreetNet, clearStreetNetCache, type StreetNet } from './streetGen.js';
import { cityPlanFor, hasCityPlan, installCityPlan, clearCityPlanCache, type PlanData } from './cityPlan.js';
import { occupancyFor, hasOccupancy, installOccupancy, clearOccupancyCache } from './grid.js';
import { clearRiverCache } from './riverRoute.js';
import { clearCoastCache } from './coast.js';
import { clearStreetLineCache } from './streetLines.js';
import { clearGraphCache } from './streetGraph.js';
import { cityBase, setCityBase } from './cityGrid.js';

export interface IslandData {
  base: number;
  bx: number;
  by: number;
  rail: RailNetData;
  race: RaceData | null;
  streets: StreetNet;
  plan: PlanData;
  grid: Uint8Array;
}

/** build island (bx, by) (in the worker, or anywhere); `onProgress(f)`
 * after each stage, f the share of the work done (weighted by measured
 * stage times: the rail ~15%, the streets ~35%, the plan ~40%, the grid) */
export function buildIslandData(bx: number, by: number, onProgress?: (f: number) => void): IslandData {
  const rail = railNetFor(bx, by);
  onProgress?.(0.15);
  const race = raceTrackFor(bx, by);
  const streets = streetNetFor(bx, by);
  onProgress?.(0.5);
  const plan = cityPlanFor(bx, by);
  onProgress?.(0.9);
  const grid = occupancyFor(bx, by);
  onProgress?.(1);
  return { base: cityBase(), bx, by, rail: rail.data, race: race?.data ?? null, streets, plan: plan.data, grid: grid.raw.slice() };
}

/** everything heavy about island (bx, by) is already built here */
export function islandReady(bx: number, by: number): boolean {
  return hasRailNet(bx, by) && hasRaceTrack(bx, by) && hasStreetNet(bx, by) && hasCityPlan(bx, by) && hasOccupancy(bx, by);
}

/** install a worker's island (ignored if it was built for another base
 * seed; any piece already built here stays as it is) */
export function installIslandData(d: IslandData): void {
  if (d.base !== cityBase()) return;
  installRailNet(d.rail);
  installRaceTrack(d.bx, d.by, d.race);
  installStreetNet(d.bx, d.by, d.streets);
  installCityPlan(d.plan);
  installOccupancy(d.bx, d.by, d.grid);
}

/** switch the base seed, flushing every world cache (several are keyed by
 * cell only) */
export function useBase(base: number): void {
  if (base === cityBase()) return;
  setCityBase(base);
  clearRailCache(); clearRaceCache(); clearStreetNetCache(); clearCityPlanCache(); clearOccupancyCache();
  clearRiverCache(); clearCoastCache(); clearStreetLineCache(); clearGraphCache();
}
