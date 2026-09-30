// Treasure islets (G15): a few small sand islands out at sea round every
// island — palms, rocks, a pirate's flag — where the pirate ship digs up
// its treasure, and where every boat keeps off (a soft shore: player.ts
// onLand). Seeded per island cell and placed in the cell's own water, so two
// cells never put one in the same place: at least 175 m out from the shore
// (beyond every boat lane and the big ships' loops: sea.ts), clear of the
// causeway corridors, the picnic island and the anchored ship, inside the
// cell (the straits carry the causeways), 120 m apart — up to ISLETS of them,
// two to each corner of the cell, so wherever a battle is won the islet its
// map marks is near (three at random left it a kilometre's sail away). City-local coordinates.
import { rng, chunkSeed } from '../../engine/rng.js';
import { ISLAND, CENTER } from '../../worlds/world.js';
import { coastFor } from '../../worlds/coast.js';
import { citySeed, southExit, eastExit } from '../../worlds/cityGrid.js';
import { RAIL_OFFSET } from '../../worlds/railRoute.js';
import { harbourFor, inSeaBox } from './harbour.js';

export interface Islet {
  /** centre (city-local) and radius of its sand (m) */
  x: number;
  z: number;
  r: number;
  /** where its treasure lies (city-local), on the sand */
  tx: number;
  tz: number;
  /** a salt for its dressing */
  v: number;
  /** nearer the shore than the rest (a corner the shore bulges into): no
   * boats circle it, they'd meet the big ships' loops */
  close?: boolean;
}

/** how far from the shore an islet may stand (m) */
const NEAR = 175, FAR = 300, CLOSE = 135;
/** how many islets an island has at most (one a sector) */
export const ISLETS = 8;
const cache = new Map<string, Islet[]>();

export function isletsFor(bx: number, by: number): Islet[] {
  const key = `${bx},${by}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const coast = coastFor(bx, by);
  const r = rng(chunkSeed(citySeed(bx, by), 0x151e7, 3));
  const H = harbourFor(bx, by);
  const pic = {
    x1: Math.min(H.bridgeDeck.x1, H.isle.x1), x2: Math.max(H.bridgeDeck.x2, H.isle.x2),
    z1: Math.min(H.bridgeDeck.z1, H.isle.z1), z2: Math.max(H.bridgeDeck.z2, H.isle.z2),
  };
  const lines = { n: southExit(bx, by - 1) * 64, s: southExit(bx, by) * 64, w: eastExit(bx - 1, by) * 64, e: eastExit(bx, by) * 64 };
  const offCorridors = (x: number, z: number, m: number): boolean => {
    // (each causeway runs from the avenue out over the strait, the railway
    // deck RAIL_OFFSET beside it)
    const inV = (at: number): boolean => x > at - m && x < at + RAIL_OFFSET + m;
    const inH = (at: number): boolean => z > at - m && z < at + RAIL_OFFSET + m;
    return !((z < CENTER && inV(lines.n)) || (z > CENTER && inV(lines.s)) || (x < CENTER && inH(lines.w)) || (x > CENTER && inH(lines.e)));
  };
  const out: Islet[] = [];
  // (the open water round an island is in the cell's four corners — along
  // its sides lies only the strait — so two slots in every corner, up to 60
  // tries each: every corner gets its islet, and the pirate's quarry, which
  // sails there too, is never far from one)
  // (a corner the shore bulges into, with no water that far out inside the
  // cell, gets a second go a little nearer in: CLOSE, still past the lanes)
  const corners = [0, 0, 0, 0];
  for (let slot = 0; slot < ISLETS + 4; slot++) for (let k = 0; k < 60; k++) {
    const c = slot < ISLETS ? slot >> 1 : slot - ISLETS;
    if (slot >= ISLETS && corners[c] > 0) break;
    const near = slot < ISLETS ? NEAR : CLOSE;
    const corner = c * (Math.PI / 2) + Math.PI / 4;
    const th = corner + (slot >= ISLETS ? (r() - 0.5) * 0.9 : (slot & 1 ? 0.3 : -0.3) + (r() - 0.5) * 0.35);
    const rad = 9 + r() * 6;
    const s = coast.shoreToward(CENTER + Math.cos(th) * 100, CENTER + Math.sin(th) * 100, 0);
    const d = near + rad + r() * (FAR - near);
    const x = s.x + Math.cos(th) * d, z = s.z + Math.sin(th) * d;
    const m = rad + 30;
    if (x < m || z < m || x > ISLAND - m || z > ISLAND - m) continue;
    if (coast.inLand(x, z, -(near + rad - 5))) continue;
    if (!offCorridors(x, z, rad + 60)) continue;
    if (x > pic.x1 - rad - 60 && x < pic.x2 + rad + 60 && z > pic.z1 - rad - 60 && z < pic.z2 + rad + 60) continue;
    if (inSeaBox(H.ship, x, z, rad + 40)) continue;
    if (out.some(o => Math.hypot(o.x - x, o.z - z) < 120)) continue;
    const ta = r() * Math.PI * 2, tr = rad * (0.25 + r() * 0.35);
    out.push({ x, z, r: rad, tx: x + Math.cos(ta) * tr, tz: z + Math.sin(ta) * tr, v: r(), close: near < NEAR });
    corners[c]++;
    break;
  }
  cache.set(key, out);
  if (cache.size > 32) cache.delete(cache.keys().next().value as string);
  return out;
}

/** is (x, z) — city-local — within r of an islet's sand */
export function onIslet(bx: number, by: number, x: number, z: number, r: number): Islet | null {
  for (const i of isletsFor(bx, by)) if (Math.hypot(x - i.x, z - i.z) < i.r + r) return i;
  return null;
}
