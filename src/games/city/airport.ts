// The airport (R41): every island has a small one on a reclaimed island off
// one of its corners — Singapore's Changi on its own land out in the sea —
// joined to the shore by a low causeway the cars drive out on. The game layer
// lays it from the coast alone (like the picnic island: the city plan, its
// streets and lots are untouched — tools/plan-hash.ts stays the same): in
// whichever of the NW / NE / SW corners has the most room (never the SE: the
// pier, the anchored ship and the big ships are there), a long island lying
// along the shore 70 m out — past the three boat lanes, which swing out
// round it (sea.ts) — inside the cell, clear of the causeway corridors, the
// picnic island and the harbour. On it a runway, a turning pad at each end,
// the terminal, the control tower, a hangar and a windsock, its edge lights
// lit at night (G10). The plane lands on it by itself whenever it lines up
// with it (landing.ts). City-local coordinates.
import * as THREE from 'three';
import { Baked } from '../../engine/baked.js';
import { ISLAND, CENTER } from '../../worlds/world.js';
import { coastFor } from '../../worlds/coast.js';
import { southExit, eastExit, citySeed, CITY_PITCH } from '../../worlds/cityGrid.js';
import { RAIL_OFFSET } from '../../worlds/railRoute.js';
import { riverFor } from '../../worlds/riverRoute.js';
import type { CollisionBox } from '../../worlds/cityChunk.js';
import { harbourFor, inSeaBox, type SeaBox } from './harbour.js';
import { makePlane } from '../../kit/vehicles.js';

/** the reclaimed island's half width (m) and its inner edge's way off the
 * shore (past the outer boat lane, 46 m, with room for its swing) */
const ISLE_HW = 24, GAP = 70;
/** the most and the least of it along the shore (half lengths, m) */
const MAX_HL = 215, MIN_HL = 100;
/** the runway: its half width, its way off the island's middle (seaward:
 * the apron with the buildings is on the shore side), the turning pads'
 * radius, and how far in from the island's ends it stops */
export const RUNWAY_HW = 9;
const RUNWAY_OFF = 6, PAD_R = 13, END = 5;
/** the causeway out to it */
const LINK_HW = 5.5;
/** the runway's surface: where a plane's wheels stand (m) */
export const RUNWAY_Y = 0.18;

export interface Airport {
  /** the corner it's off (0 SE, 1 SW, 2 NW, 3 NE: as islets.ts counts) */
  corner: number;
  /** the reclaimed island (yaw: the runway's heading) */
  isle: SeaBox;
  /** the causeway from the shore to the island's inner edge */
  link: SeaBox;
  /** the runway's centre line: its middle, heading and half length — the
   * thresholds are at ±hl along it, the turning pads just past them */
  runway: { cx: number; cz: number; yaw: number; hl: number; hw: number };
  /** the turning pads' radius */
  pad: number;
  /** the apron's side: the unit vector from the runway toward the shore */
  inward: { x: number; z: number };
}

const cache = new Map<string, Airport>();

/** a point `a` m along a turned box's length and `l` m across (to its right
 * when facing along it) */
export function boxPoint(b: { cx: number; cz: number; yaw: number }, a: number, l: number): { x: number; z: number } {
  const fx = Math.sin(b.yaw), fz = Math.cos(b.yaw);
  return { x: b.cx + fx * a + fz * l, z: b.cz + fz * a - fx * l };
}

/** city (bx, by)'s airport (city-local) */
export function airportFor(bx: number, by: number): Airport {
  // (keyed by the island's seed too: a tool sweeping seeds asks again)
  const key = `${bx},${by},${citySeed(bx, by)}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const coast = coastFor(bx, by);
  const H = harbourFor(bx, by);
  const pic = {
    x1: Math.min(H.bridgeDeck.x1, H.isle.x1), x2: Math.max(H.bridgeDeck.x2, H.isle.x2),
    z1: Math.min(H.bridgeDeck.z1, H.isle.z1), z2: Math.max(H.bridgeDeck.z2, H.isle.z2),
  };
  const lines = { n: southExit(bx, by - 1) * 64, s: southExit(bx, by) * 64, w: eastExit(bx - 1, by) * 64, e: eastExit(bx, by) * 64 };
  const offCorridors = (x: number, z: number, m: number): boolean => {
    const inV = (at: number): boolean => x > at - m && x < at + RAIL_OFFSET + m;
    const inH = (at: number): boolean => z > at - m && z < at + RAIL_OFFSET + m;
    return !((z < CENTER && inV(lines.n)) || (z > CENTER && inV(lines.s)) || (x < CENTER && inH(lines.w)) || (x > CENTER && inH(lines.e)));
  };
  const river = riverFor(bx, by).pts;
  /** every point of a turned box clear of the shore by `shoreM`, the cell's
   * edge, the corridors, the picnic island and the harbour */
  const clear = (b: SeaBox, shoreM: number): boolean => {
    for (let a = -b.hl; a <= b.hl + 0.01; a += Math.min(10, b.hl)) {
      for (const l of [-b.hw, 0, b.hw]) {
        const p = boxPoint(b, a, l);
        if (p.x < 30 || p.z < 30 || p.x > ISLAND - 30 || p.z > ISLAND - 30) return false;
        if (coast.inLand(p.x, p.z, -shoreM)) return false;
        if (!offCorridors(p.x, p.z, 60)) return false;
        if (p.x > pic.x1 - 60 && p.x < pic.x2 + 60 && p.z > pic.z1 - 60 && p.z < pic.z2 + 60) return false;
        if (inSeaBox(H.ship, p.x, p.z, 60) || inSeaBox(H.pier, p.x, p.z, 60)) return false;
      }
    }
    return true;
  };
  let best: Airport | null = null;
  for (const corner of [2, 3, 1]) {
    const th = corner * (Math.PI / 2) + Math.PI / 4;
    const ux = Math.cos(th), uz = Math.sin(th);
    // (along the shore: the tangent, turned a little either way to lie
    // along it where the corner's shore runs aslant)
    const R = coast.radius(Math.atan2(uz, ux));
    for (const turn of [0, 0.15, -0.15, 0.3, -0.3]) {
      const yaw = Math.atan2(-uz, ux) + turn;
      for (let D = R + GAP + ISLE_HW; D < R + GAP + ISLE_HW + 60; D += 6) {
        let found = 0;
        for (let hl = MAX_HL; hl >= MIN_HL; hl -= 5) {
          const isle: SeaBox = { cx: CENTER + ux * D, cz: CENTER + uz * D, yaw, hl, hw: ISLE_HW };
          if (clear(isle, GAP - 8)) { found = hl; break; }
        }
        if (!found || (best && found <= best.isle.hl)) continue;
        const isle: SeaBox = { cx: CENTER + ux * D, cz: CENTER + uz * D, yaw, hl: found, hw: ISLE_HW };
        // the causeway: from just inside the beach straight out to the
        // island's inner edge, square to it
        const fx = Math.sin(yaw), fz = Math.cos(yaw);
        let ix = fz, iz = -fx;
        if (ix * ux + iz * uz > 0) { ix = -ix; iz = -iz; }
        const edge = { x: isle.cx + ix * ISLE_HW, z: isle.cz + iz * ISLE_HW };
        let len = 0;
        while (len < 200 && !coast.inLand(edge.x + ix * len, edge.z + iz * len, 4)) len += 1;
        if (len >= 200) continue;
        const land = { x: edge.x + ix * len, z: edge.z + iz * len };
        // (never onto the river's mouth)
        if (river.some(p => Math.hypot(p.x - land.x, p.z - land.z) < 40)) continue;
        const link: SeaBox = { cx: (edge.x + land.x) / 2, cz: (edge.z + land.z) / 2, yaw: Math.atan2(ix, iz), hl: len / 2 + 2, hw: LINK_HW };
        if (!offCorridors(land.x, land.z, 40)) continue;
        // the runway: seaward of the island's middle, the apron shoreward
        const rc = { x: isle.cx - ix * RUNWAY_OFF, z: isle.cz - iz * RUNWAY_OFF };
        best = {
          corner, isle, link,
          runway: { cx: rc.x, cz: rc.z, yaw, hl: found - END - PAD_R, hw: RUNWAY_HW },
          pad: PAD_R,
          inward: { x: ix, z: iz },
        };
      }
      if (best && best.corner === corner && best.isle.hl >= MAX_HL) break;
    }
  }
  if (!best) throw new Error(`no room for island ${bx},${by}'s airport`);
  cache.set(key, best);
  if (cache.size > 32) cache.delete(cache.keys().next().value as string);
  return best;
}

/** where the map marks island (bx, by)'s airport: its runway's middle (world) */
export function airportMark(bx: number, by: number): { x: number; z: number } {
  const r = airportFor(bx, by).runway;
  return { x: r.cx + bx * CITY_PITCH, z: r.cz + by * CITY_PITCH };
}

/** is (x, z) — city-local — on the airport's island or its causeway
 * (within r of either) */
export function onAirport(bx: number, by: number, x: number, z: number, r: number): boolean {
  const A = airportFor(bx, by);
  return inSeaBox(A.isle, x, z, r) || inSeaBox(A.link, x, z, r);
}

const SLAB = 0xcfc9ba, GRASS = 0xa9c88b, ASPHALT = 0x4f5660, DASH = 0xf2efe6, CURB = 0xcfc9ba,
  CONCRETE = 0xb9b4aa, GLASS = 0x7fb2d9, ROOF = 0xe8e4d8, RED = 0xd9473f, WHITE = 0xf7f3ea, STEEL = 0x8f97a3;

export interface BuiltAirport {
  group: THREE.Group;
  /** the buildings (G14: solid) — world coordinates */
  boxes: CollisionBox[];
  /** the runway's edge lights (lit at night, G10) */
  lights: THREE.Mesh;
}

/** Build city (bx, by)'s airport, offset into world space. */
export function buildAirport(bx: number, by: number, ox: number, oz: number): BuiltAirport {
  const A = airportFor(bx, by);
  const { isle, link, runway } = A;
  const B = new Baked();
  const boxes: CollisionBox[] = [];
  const yaw = isle.yaw;
  /** a box `w` across, `d` along the runway, at a along / l across the island */
  const at = (a: number, l: number): { x: number; z: number } => boxPoint(isle, a, l);
  // (which way across the island the shore lies: +1 to the right of the
  // runway's heading; the runway is seaward of the middle, the apron shoreward)
  const side = A.inward.x * Math.cos(yaw) - A.inward.z * Math.sin(yaw) > 0 ? 1 : -1;
  const rl = -side * RUNWAY_OFF;
  // the island: a concrete slab with a grass edge, the causeway
  B.box(isle.hw * 2, 0.5, isle.hl * 2, SLAB, isle.cx, -0.15, isle.cz, 0, yaw, 0);
  B.box(isle.hw * 2 - 3, 0.12, isle.hl * 2 - 3, GRASS, isle.cx, 0.06, isle.cz, 0, yaw, 0);
  B.box(link.hw * 2, 0.7, link.hl * 2, ASPHALT, link.cx, -0.25, link.cz, 0, link.yaw, 0);
  for (const side of [-1, 1]) {
    const p = boxPoint(link, 0, side * (link.hw - 0.2));
    B.box(0.4, 0.55, link.hl * 2, CURB, p.x, 0.375, p.z, 0, link.yaw, 0);
  }
  for (let a = -link.hl + 3; a < link.hl - 2; a += 4) {
    const p = boxPoint(link, a, 0);
    B.box(0.25, 0.02, 1.8, DASH, p.x, 0.11, p.z, 0, link.yaw, 0);
  }
  // the runway, its pads, the centre line and the thresholds' piano keys
  const rw = (a: number, l: number): { x: number; z: number } => at(a, rl + l);
  const rm = rw(0, 0);
  B.box(RUNWAY_HW * 2, 0.04, runway.hl * 2 + 4, ASPHALT, rm.x, 0.14, rm.z, 0, yaw, 0);
  for (const end of [-1, 1]) {
    const c = rw(end * (runway.hl + 2), 0);
    B.cyl(A.pad, A.pad, 0.04, 24, ASPHALT, c.x, 0.141, c.z);
    for (let k = -3; k <= 3; k++) {
      const p = rw(end * (runway.hl - 6), k * 2.4);
      B.box(1.2, 0.02, 8, DASH, p.x, 0.17, p.z, 0, yaw, 0);
    }
  }
  for (let a = -runway.hl + 16; a < runway.hl - 15; a += 12) {
    const p = rw(a, 0);
    B.box(0.5, 0.02, 6, DASH, p.x, 0.17, p.z, 0, yaw, 0);
  }
  // the apron: the terminal (glass front), the control tower, a hangar, a
  // windsock — shoreward of the runway, clear of the causeway's landing
  const lA = side * (isle.hw - 8);
  const solid = (a: number, l: number, hw: number, hd: number, top: number): void => {
    const c = at(a, l);
    const ex = Math.abs(Math.sin(yaw)) * hd + Math.abs(Math.cos(yaw)) * hw;
    const ez = Math.abs(Math.cos(yaw)) * hd + Math.abs(Math.sin(yaw)) * hw;
    boxes.push({ x1: c.x - ex + ox, x2: c.x + ex + ox, z1: c.z - ez + oz, z2: c.z + ez + oz, top });
  };
  const termA = Math.min(60, isle.hl * 0.45);
  {
    const c = at(termA, lA);
    B.box(10, 6, 34, CONCRETE, c.x, 3, c.z, 0, yaw, 0);
    const g = at(termA, lA - side * 5.05);
    B.box(0.2, 3.4, 32, GLASS, g.x, 3.2, g.z, 0, yaw, 0);
    B.box(11, 0.5, 35, ROOF, c.x, 6.2, c.z, 0, yaw, 0);
    solid(termA, lA, 5, 17, 6.5);
  }
  {
    const tA = termA + 26;
    const c = at(tA, lA);
    B.cyl(1.8, 2.2, 16, 12, WHITE, c.x, 8, c.z);
    B.cyl(3.4, 2.6, 3, 12, GLASS, c.x, 17.5, c.z);
    B.cyl(3.7, 3.7, 0.5, 12, RED, c.x, 19.2, c.z);
    solid(tA, lA, 2.4, 2.4, 19.5);
  }
  {
    const hA = -Math.min(55, isle.hl * 0.4);
    const c = at(hA, lA - side * 1);
    B.box(14, 7, 24, STEEL, c.x, 3.5, c.z, 0, yaw, 0);
    B.cyl(7.2, 7.2, 24, 16, ROOF, c.x, 7, c.z, 0, yaw, Math.PI / 2);
    solid(hA, lA - side * 1, 7, 12, 10);
  }
  {
    const c = at(-termA, lA + side * 2);
    B.cyl(0.12, 0.12, 6, 6, STEEL, c.x, 3, c.z);
    B.cone(0.7, 3, 10, 0xf07a3a, c.x + 1.4, 5.6, c.z, 0, 0, Math.PI / 2);
  }
  const mesh = B.build();
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  const group = new THREE.Group();
  group.add(mesh);
  // the runway's edge lights, both sides every 20 m (one mesh: lit at night)
  const L = new Baked();
  for (let a = -runway.hl; a <= runway.hl + 0.1; a += 20) {
    for (const s of [-1, 1]) {
      const p = rw(a, s * (RUNWAY_HW + 0.6));
      L.box(0.35, 0.35, 0.35, 0xffffff, p.x, 0.3, p.z);
    }
  }
  const lights = L.build({ cast: false, receive: false });
  lights.material = new THREE.MeshBasicMaterial({ color: 0xbfc4c9, toneMapped: false });
  group.add(lights);
  // two planes parked at the terminal's gates, between it and the runway
  for (const [a, col] of [[termA - 9, 0x7fb2d9], [termA + 9, 0xe25c5c]] as Array<[number, number]>) {
    const pl = makePlane({ body: 0xf7f3ea, wing: col });
    const c = at(a, rl + side * (RUNWAY_HW + 4.2));
    pl.position.set(c.x, RUNWAY_Y, c.z);
    pl.rotation.y = yaw;
    group.add(pl);
  }
  group.position.set(ox, 0, oz);
  return { group, boxes, lights };
}
