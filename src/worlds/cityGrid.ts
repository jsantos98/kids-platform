// The city grid: the world is an endless archipelago — one island city per
// (bx, by) cell, each grown from its own seed, joined to its four neighbours
// by causeways across the straits. The base seed comes from the URL, so city
// (3, -2) builds identically no matter which direction you reach it from.
//
// An edge's exit line is derived from the edge's owning cell, so the two cities
// sharing a strait always agree on where the bridge lands.
import { chunkSeed, rng } from '../engine/rng.js';
import { ISLAND, WORLD_CHUNKS, BRIDGE_X } from './world.js';

export const STRAIT = 128;                 // water between two cities (m)
export const CITY_PITCH = ISLAND + STRAIT; // world metres per city cell

let BASE = 11;
export function setCityBase(seed: number): void { BASE = seed | 0; }
export function cityBase(): number { return BASE; }

export function citySeed(bx: number, by: number): number {
  return chunkSeed(BASE, bx, by);
}

/** the seeded subset of lattice lines that carry streets in this city, plus
 * the four causeway avenues. One shared source: the city plan lays streets on
 * them, and the railway deforms itself to cross them all at right angles. */
export function streetLinesFor(bx: number, by: number): { H: number[]; V: number[] } {
  const seed = citySeed(bx, by);
  const r = rng(chunkSeed(seed, 0x511e, 0));
  // per-city street density: sparse towns and dense grids are both valid
  // rolls, so neighbouring seeds visibly differ in how built-up they read
  const keep = 0.38 + 0.34 * r();
  const pick = (): number[] => {
    const out: number[] = [];
    for (let l = 1; l < WORLD_CHUNKS; l++) if (r() < keep) out.push(l);
    return out;
  };
  const H = pick();
  const V = pick();
  for (const lines of [H, V]) {
    for (const missing of Array.from({ length: WORLD_CHUNKS - 1 }, (_, k) => k + 1)) {
      if (lines.length >= 3) break;
      if (!lines.includes(missing)) lines.push(missing);
    }
  }
  // race-corner access: keep the zone boundary line as a street
  if (!H.includes(WORLD_CHUNKS - 2) && !V.includes(WORLD_CHUNKS - 2)) H.push(WORLD_CHUNKS - 2);
  // the four causeway avenues are streets too
  for (const l of [southExit(bx, by - 1), southExit(bx, by)]) if (!V.includes(l)) V.push(l);
  for (const l of [eastExit(bx - 1, by), eastExit(bx, by)]) if (!H.includes(l)) H.push(l);
  H.sort((a, b) => a - b);
  V.sort((a, b) => a - b);
  return { H, V };
}

export interface CityRef { bx: number; by: number; ox: number; oz: number; key: string }

/** which city cell a world position falls in (straits belong to neither) */
export function cityAt(x: number, z: number): CityRef {
  const bx = Math.floor(x / CITY_PITCH);
  const by = Math.floor(z / CITY_PITCH);
  return { bx, by, ox: bx * CITY_PITCH, oz: by * CITY_PITCH, key: `${bx},${by}` };
}

/** exit roads live on these interior lattice lines (kept off the race corner) */
function exitCandidates(): number[] {
  const out: number[] = [];
  for (let l = 2; l <= WORLD_CHUNKS - 3; l++) out.push(l);
  return out;
}

/** lattice line (city-local) of the road leaving the SOUTH edge of a city.
 * Both this city and its southern neighbour read the same value. The picnic
 * causeway hangs off the south shore too, so its line keeps clear of it. */
export function southExit(bx: number, by: number): number {
  const opts = exitCandidates().filter(l => Math.abs(l * 64 - BRIDGE_X) >= 100);
  const h = chunkSeed(BASE ^ 0xa5a5a5a5, bx, by);
  return opts[h % opts.length];
}

/** lattice line of the road leaving the EAST edge of a city */
export function eastExit(bx: number, by: number): number {
  const opts = exitCandidates();
  const h = chunkSeed(BASE ^ 0x5a5a5a5a, bx, by);
  return opts[h % opts.length];
}
