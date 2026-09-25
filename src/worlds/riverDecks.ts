// River bridges as real decks: where a street crosses the river its road
// rises onto a humped bridge (parapets, girders, the water flowing on
// underneath), and where a railway line crosses it the track runs up onto a
// raised trestle. Pure geometry, shared by the chunk baker (the road deck
// replaces the kit road tiles it covers), transit (the trestle replaces the
// track pieces it covers) and causeway.deckAt() — so the kid's vehicle, the
// island's cars and walkers and every train ride up and over, exactly as
// they ride the causeways.
import { cityPlanFor, hasCityPlan } from './cityPlan.js';
import { edgePieces } from './roadLayout.js';
import { riverFor } from './riverRoute.js';
import { railNetFor, hasRailNet } from './railRoute.js';
import { citySeed } from './cityGrid.js';
import { segDist } from './streetGen.js';

/** the road deck's crown above the street, and the trestle's (m) */
export const BRIDGE_H = 1.4;
export const TRESTLE_H = 1.2;
/** ramp length at each end of a deck (m) */
export const DECK_RAMP = 9;
/** half-widths: the carriageway plus a walkway each side / the track bed */
export const BRIDGE_HALF = 10;
export const TRESTLE_HALF = 2.4;

export interface RiverDeck {
  kind: 'road' | 'rail';
  /** start of the deck (city-local), its unit direction and length */
  ax: number;
  az: number;
  ux: number;
  uz: number;
  len: number;
  heading: number;
  half: number;
  /** crown height above the ground */
  h: number;
  /** road decks: the street edge they carry */
  edge: number;
}

/** height of a deck above the ground `t` m along it: smooth ramps at both
 * ends, flat across the water */
export function riverDeckProfile(d: RiverDeck, t: number): number {
  const e = Math.min(t, d.len - t);
  if (e <= 0) return 0;
  const u = Math.min(1, e / DECK_RAMP);
  return d.h * u * u * (3 - 2 * u);
}

const cache = new Map<string, RiverDeck[]>();
export function clearRiverDeckCache(): void { cache.clear(); }

/** island (bx, by)'s river decks (builds its plan if need be) */
export function riverDecksFor(bx: number, by: number): RiverDeck[] {
  const key = `${bx},${by},${citySeed(bx, by)}`;
  let out = cache.get(key);
  if (out) return out;
  out = [];
  const plan = cityPlanFor(bx, by);
  const river = riverFor(bx, by);
  if (river.pts.length) {
    // ---- road decks: the kit tiles over the water and a ramp's length
    // either side, replaced by one deck spanning exactly those tiles ----
    for (const br of plan.riverBridges) {
      const e = plan.edges.find(ed => segDist(br, plan.nodes[ed.a], plan.nodes[ed.b]) < 1.5);
      if (!e) continue;
      const a = plan.nodes[e.a];
      const sc = (br.x - a.x) * e.ux + (br.z - a.z) * e.uz;
      // (a long avenue pass records several bridges: one deck carries them)
      if (out.some(d => d.edge === e.id && sc >= (d.ax - a.x) * e.ux + (d.az - a.z) * e.uz && sc <= (d.ax - a.x) * e.ux + (d.az - a.z) * e.uz + d.len)) continue;
      const hw = river.halfAt(br.x, br.z) + 2.5;
      let s0 = Infinity, s1 = -Infinity;
      for (const p of edgePieces(plan, e)) {
        const s = (p.x - a.x) * e.ux + (p.z - a.z) * e.uz;
        if (s + p.lx / 2 < sc - hw - DECK_RAMP || s - p.lx / 2 > sc + hw + DECK_RAMP) continue;
        s0 = Math.min(s0, s - p.lx / 2);
        s1 = Math.max(s1, s + p.lx / 2);
      }
      // (the tiles must reach a ramp past the water both ways, or the
      // street keeps its plain crossing)
      if (!(s0 <= sc - hw - DECK_RAMP + 0.5 && s1 >= sc + hw + DECK_RAMP - 0.5)) continue;
      out.push({
        kind: 'road', ax: a.x + e.ux * s0, az: a.z + e.uz * s0, ux: e.ux, uz: e.uz, len: s1 - s0,
        heading: e.heading, half: BRIDGE_HALF, h: BRIDGE_H, edge: e.id,
      });
    }
    // ---- rail decks: each in-water run of a line, a ramp past the banks
    // either way, along its (straight: R27) chord ----
    const rail = railNetFor(bx, by);
    for (const L of rail.lines) {
      const pts = L.pts;
      for (let k = 0; k < pts.length;) {
        if (!river.near(pts[k].x, pts[k].z, river.halfAt(pts[k].x, pts[k].z) + 1.5)) { k++; continue; }
        let end = k;
        while (end + 1 < pts.length && river.near(pts[end + 1].x, pts[end + 1].z, river.halfAt(pts[end + 1].x, pts[end + 1].z) + 1.5)) end++;
        const p = pts[k], q = pts[end];
        const cl = Math.hypot(q.x - p.x, q.z - p.z) || 1;
        const ux = (q.x - p.x) / cl, uz = (q.z - p.z) / cl;
        const ext = DECK_RAMP + 3;
        const ax = p.x - ux * ext, az = p.z - uz * ext, len = cl + 2 * ext;
        // the track must follow the chord, and no level crossing may sit on
        // a ramp; otherwise the line keeps its low trestle
        let dev = 0;
        for (const o of pts) {
          const t = (o.x - ax) * ux + (o.z - az) * uz;
          if (t < 0 || t > len) continue;
          const acr = Math.abs((o.x - ax) * uz - (o.z - az) * ux);
          if (acr < 6) dev = Math.max(dev, acr);
        }
        const clash = plan.crossings.some(c => {
          const t = (c.x - ax) * ux + (c.z - az) * uz;
          return t > -8 && t < len + 8 && Math.abs((c.x - ax) * uz - (c.z - az) * ux) < 12;
        });
        if (dev < 0.8 && !clash) {
          out.push({ kind: 'rail', ax, az, ux, uz, len, heading: Math.atan2(ux, uz), half: TRESTLE_HALF, h: TRESTLE_H, edge: -1 });
        }
        k = end + 1;
      }
    }
  }
  cache.set(key, out);
  if (cache.size > 32) cache.delete(cache.keys().next().value as string);
  return out;
}

/** the river deck under city-local (x, z) of island (bx, by), if any — only
 * on an island already built (a neighbour still being built has none yet:
 * nothing may build it here, mid-frame — R21) */
export function riverDeckAt(bx: number, by: number, x: number, z: number): { y: number; deck: RiverDeck; t: number } | null {
  if (!hasCityPlan(bx, by) || !hasRailNet(bx, by)) return null;
  for (const d of riverDecksFor(bx, by)) {
    const t = (x - d.ax) * d.ux + (z - d.az) * d.uz;
    if (t < 0 || t > d.len) continue;
    if (Math.abs((x - d.ax) * d.uz - (z - d.az) * d.ux) > d.half) continue;
    return { y: riverDeckProfile(d, t), deck: d, t };
  }
  return null;
}
