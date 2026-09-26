// Crosswalks (zebra crossings): the only places people and pets cross a
// street. One list per island, the single authority the chunk baker paints,
// the walkers cross on and the cars stop for.
//
// Some junctions have them — about half of those with traffic lights and a
// fifth of the rest, seeded per junction (on every arm of every junction
// there were too many) — on every arm (3+ arms; not a causeway mouth or a
// roundabout), square across the arm just beyond the junction's
// pad (its reach up that arm — 7 m at a kit pad, up to 15 m at an oblique
// one): CW_W metres wide, from reach + CW_GAP out. Not where the stripe would
// touch the track, the river, the sea or a causeway deck, or come near a
// level crossing. A walker either turns the corner (onto the next street's
// sidewalk, never leaving the pavement) or crosses on the crosswalk — to its
// near end, straight across it, onto the sidewalk beyond; nobody steps off
// the kerb anywhere else.
import { graphFor, leaving } from './streetGraph.js';
import { occupancyFor, RAIL, RIVER, SEA, DECK } from './grid.js';
import { cityPlanFor } from './cityPlan.js';
import { citySeed } from './cityGrid.js';
import { rng, chunkSeed } from '../engine/rng.js';

/** the share of junctions with crosswalks: with traffic lights, without */
const SHARE_LIT = 0.5, SHARE_PLAIN = 0.2;

/** the stripe starts this far past the pad's reach and is this wide (m) */
export const CW_GAP = 0.4, CW_W = 3;
/** half the carriageway the stripes span (the kerbs are at ±6.9) */
export const CW_HALF = 6.2;

export interface Crosswalk {
  id: number;
  node: number;
  edge: number;
  /** the arm's direction leaving the node (unit), and the stripe's centre
   * (city-local) */
  lx: number;
  lz: number;
  x: number;
  z: number;
  /** the stripe's near and far edges, metres out along the arm from the node */
  near: number;
  far: number;
}

export interface Crosswalks {
  list: Crosswalk[];
  /** the crosswalk on `edge` at `node`, if there is one */
  at(node: number, edge: number): Crosswalk | undefined;
}

const cache = new Map<string, Crosswalks>();

export function crosswalksFor(bx: number, by: number): Crosswalks {
  const key = `${bx},${by}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const g = graphFor(bx, by);
  const plan = cityPlanFor(bx, by);
  const occ = occupancyFor(bx, by);
  const list: Crosswalk[] = [];
  const byKey = new Map<string, Crosswalk>();
  for (const n of g.nodes) {
    if (n.plaza || n.mouth || n.edges.length < 3) continue;
    if (rng(chunkSeed(citySeed(bx, by), 0xc05, n.id))() >= (n.signalized ? SHARE_LIT : SHARE_PLAIN)) continue;
    const pn = plan.nodes[n.id];
    for (const id of n.edges) {
      const e = g.edges[id];
      const near = (pn.reach[pn.edges.indexOf(id)] ?? 7) + CW_GAP, far = near + CW_W;
      if (e.len < far + 8) continue;
      const l = leaving(g, e, n.id);
      const mid = (near + far) / 2;
      // (the stripe's s along the edge from node a, to keep off level crossings)
      const sMid = e.a === n.id ? mid : e.len - mid;
      if (e.crossings.some(c => Math.abs(c.s - sMid) < 16)) continue;
      // the whole stripe on plain street: no track, water, sea or deck under it
      const px = -l.z, pz = l.x;
      let clear = true;
      for (const along of [near, mid, far]) {
        for (const lat of [-CW_HALF, 0, CW_HALF]) {
          const x = n.x + l.x * along + px * lat, z = n.z + l.z * along + pz * lat;
          if (occ.bits(x, z) & (RAIL | RIVER | SEA | DECK)) { clear = false; break; }
        }
        if (!clear) break;
      }
      if (!clear) continue;
      const cw: Crosswalk = { id: list.length, node: n.id, edge: e.id, lx: l.x, lz: l.z, x: n.x + l.x * mid, z: n.z + l.z * mid, near, far };
      list.push(cw);
      byKey.set(`${n.id}:${e.id}`, cw);
    }
  }
  const out: Crosswalks = { list, at: (node, edge) => byKey.get(`${node}:${edge}`) };
  if (cache.size > 16) cache.delete(cache.keys().next().value!);
  cache.set(key, out);
  return out;
}
