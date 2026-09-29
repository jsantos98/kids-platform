// The island's landmarks (G16): the places a pickup is taken to — the
// hospitals (a patient), the prison (a caught thief), the repair shops (a
// broken-down car), the recycling depot (a full garbage truck) and the
// police pier (the police boat's catch). Each is a real building the city
// already bakes, picked from the plan's lots — never a lot the plan lays
// for it: the world is untouched (R17, R38; plan-hash stays the same) —
// and dressed on top by the game (landmarkLayer.ts). The pick is a pure
// function of the plan and its own seeded stream, so every run, and the
// check (tools/check-landmarks.ts), sees the same places.
// City-local coordinates.
import { cityPlanFor, ROAD_HALF, type Lot, type District } from '../../worlds/cityPlan.js';
import { graphFor, type SEdge } from '../../worlds/streetGraph.js';
import { citySeed, isRaceIsland, CITY_PITCH } from '../../worlds/cityGrid.js';
import { rng, chunkSeed } from '../../engine/rng.js';
import { SCALE } from '../../worlds/world.js';
import { riverFor } from '../../worlds/riverRoute.js';
import { harbourFor } from './harbour.js';

export type LandmarkKind = 'hospital' | 'prison' | 'repair' | 'depot' | 'pier';

/** each landmark's icon: its sign, the badge and the goal it floats */
export const LANDMARK_ICON: Record<LandmarkKind, string> = {
  hospital: '🏥', prison: '🚔', repair: '🔧', depot: '♻️', pier: '⚓',
};

export interface Landmark {
  kind: LandmarkKind;
  /** its lot (the pier has none) */
  lot: Lot | null;
  /** the lot's centre, or the pier's end */
  x: number;
  z: number;
  /** where the kid stops to hand over: in the lane at the building's front
   * (heading along it), or the water off the pier's end */
  door: { x: number; z: number; heading: number };
  /** the street it fronts (not for the pier) */
  edge: number;
}

/** landmarks keep this far apart (m) */
export const LANDMARK_GAP = 120;
/** a door keeps this far from both ends of its street and from a level crossing (m) */
const DOOR_CLEAR = 20;

const TOWN: District[] = ['downtown', 'urban'];

const cache = new Map<string, Landmark[]>();

/** island (bx, by)'s landmarks (none on a race island: it has no town) */
export function landmarksFor(bx: number, by: number): Landmark[] {
  const key = `${bx},${by},${citySeed(bx, by)}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const out = pick(bx, by);
  cache.set(key, out);
  if (cache.size > 24) cache.delete(cache.keys().next().value as string);
  return out;
}

/** a fresh pick, bypassing the cache (the check's determinism test) */
export function freshLandmarks(bx: number, by: number): Landmark[] { return pick(bx, by); }

interface Cand { lot: Lot; district: District; door: Landmark['door']; edge: SEdge }

function pick(bx: number, by: number): Landmark[] {
  const out: Landmark[] = [];
  // the police pier: the harbour's, its end out at sea (every island has one)
  {
    const H = harbourFor(bx, by);
    const end = H.at(0, 19), off = H.at(0, 27);
    out.push({ kind: 'pier', lot: null, x: end.x, z: end.z, door: { x: off.x, z: off.z, heading: H.yaw + Math.PI }, edge: -1 });
  }
  if (isRaceIsland(bx, by)) return out;
  const plan = cityPlanFor(bx, by), g = graphFor(bx, by), river = riverFor(bx, by);
  const r = rng(chunkSeed(citySeed(bx, by), 0x1a4d, 77));
  // every town building that fronts a street, with the lane spot before it
  const cands: Cand[] = [];
  for (const lot of plan.data.lots) {
    if (lot.kind !== 'bldg') continue;
    const district = plan.districtAt(lot.x, lot.z);
    if (district !== 'industrial' && !TOWN.includes(district)) continue;
    // (a frontage lot: its front edge 1.1 m past the kerb)
    const nx = Math.sin(lot.ry), nz = Math.cos(lot.ry);
    const fx = lot.x + nx * (lot.d / 2), fz = lot.z + nz * (lot.d / 2);
    const at = g.nearest(fx, fz);
    if (!at || Math.abs(at.dist - (ROAD_HALF + 1.1)) > 1.5) continue;
    const e = at.edge;
    if (at.s < DOOR_CLEAR || at.s > e.len - DOOR_CLEAR) continue;
    if (e.crossings.some(c => Math.abs(c.s - at.s) < DOOR_CLEAR)) continue;
    if (g.nodes[e.a].mouth || g.nodes[e.b].mouth) continue;
    const side = at.lateral > 0 ? 1 : -1;
    const p = g.sample(e, at.s, side * 3.5);
    if (river.inWater(p.x, p.z) || river.inWater(fx, fz)) continue;
    cands.push({ lot, district, edge: e, door: { x: p.x, z: p.z, heading: side > 0 ? e.heading : e.heading + Math.PI } });
  }
  // (a seeded shuffle, so ties go a different way on every island)
  for (let k = cands.length - 1; k > 0; k--) {
    const m = (r() * (k + 1)) | 0;
    [cands[k], cands[m]] = [cands[m], cands[k]];
  }
  const far = (c: Cand): number => Math.min(Infinity, ...out.filter(l => l.lot).map(l => Math.hypot(l.x - c.lot.x, l.z - c.lot.z)));
  const take = (kind: LandmarkKind, c: Cand): void => {
    out.push({ kind, lot: c.lot, x: c.lot.x, z: c.lot.z, door: c.door, edge: c.edge.id });
  };
  const free = (c: Cand): boolean => !out.some(l => l.lot === c.lot) && far(c) >= LANDMARK_GAP;
  // the industry's middle: the depot and the repair shops stand by it
  let ix = 0, iz = 0, ia = 0;
  for (const b of plan.blocks) if (b.district === 'industrial') { ix += b.cx * b.area; iz += b.cz * b.area; ia += b.area; }
  const town = cands.filter(c => TOWN.includes(c.district));
  const byIndustry = (list: Cand[]): Cand[] => (ia > 0
    ? [...list].sort((p, q) => Math.hypot(p.lot.x - ix / ia, p.lot.z - iz / ia) - Math.hypot(q.lot.x - ix / ia, q.lot.z - iz / ia))
    : list);
  // hospitals: big town lots, spread over the island (each next one as far
  // from those already chosen as it can be)
  const big = town.filter(c => c.lot.w >= 10.5 && c.lot.d >= 11);
  const hospitals = Math.max(2, Math.round(2 * SCALE));
  for (let k = 0; k < hospitals; k++) {
    let best: Cand | null = null, bd = -1;
    for (const c of big.length >= hospitals ? big : town) {
      if (!free(c)) continue;
      const d = out.filter(l => l.lot).length ? far(c) : r();
      if (d > bd) { bd = d; best = c; }
    }
    if (best) take('hospital', best);
  }
  // the recycling depot: the building nearest the industry (a works lot counts)
  const depot = byIndustry(cands).find(free);
  if (depot) take('depot', depot);
  // the repair shops: town buildings nearest the industry
  for (let k = 0; k < 2; k++) {
    const c = byIndustry(town).find(free);
    if (c) take('repair', c);
  }
  // the prison: a town building as far from the others as can be
  {
    let best: Cand | null = null, bd = -1;
    for (const c of town) if (free(c) && far(c) > bd) { bd = far(c); best = c; }
    if (best) take('prison', best);
  }
  return out;
}

/** the nearest landmark of a kind to world (x, z), on its island or one of
 * the eight round it (a race island has no town), in world coordinates */
export function nearestLandmark(kind: LandmarkKind, x: number, z: number, bx: number, by: number): (Landmark & { ox: number; oz: number; bx: number; by: number }) | null {
  let best: (Landmark & { ox: number; oz: number; bx: number; by: number }) | null = null, bd = Infinity;
  for (let dx = -1; dx <= 1; dx++) {
    for (let dy = -1; dy <= 1; dy++) {
      const cx = bx + dx, cy = by + dy, ox = cx * CITY_PITCH, oz = cy * CITY_PITCH;
      // (the neighbours only when this island has none of the kind)
      if ((dx || dy) && best) continue;
      for (const l of landmarksFor(cx, cy)) {
        if (l.kind !== kind) continue;
        const d = Math.hypot(l.door.x + ox - x, l.door.z + oz - z);
        if (d < bd) { bd = d; best = { ...l, ox, oz, bx: cx, by: cy }; }
      }
    }
  }
  return best;
}

/** is this lot one of the island's landmarks (no fire call burns a hospital) */
export function isLandmarkLot(bx: number, by: number, lot: Lot): boolean {
  return landmarksFor(bx, by).some(l => l.lot && Math.abs(l.lot.x - lot.x) < 0.01 && Math.abs(l.lot.z - lot.z) < 0.01);
}
