// G14 check: the sea is solid, and its boats never run into anything.
//  · Every island's fleet (sea.ts — its three lanes and the big ships) and
//    its neighbours' are sampled every 0.5 s for 180 s: no two boats may
//    overlap (turned boxes, island/obb.ts), and no boat may touch land (any
//    island), the picnic bridge or island, the pier, the anchored cargo ship,
//    the lighthouse, or a causeway deck too low to sail under.
//  · The kid's boat (player.ts, the real physics) is driven flat out at the
//    lighthouse, the anchored ship and the picnic island: the first two must
//    be a crash, the third a slide — never through any of them.
//   npx tsx tools/check-sea.ts [baseSeed]
import './headless-dom.js';
import * as THREE from 'three';
import { setCityBase, CITY_PITCH, cityAt } from '../src/worlds/cityGrid.js';
import { coastFor } from '../src/worlds/coast.js';
import { deckAt, BOAT_CLEAR } from '../src/worlds/causeway.js';
import { Fleet, type BoatFootprint } from '../src/games/city/sea.js';
import { harbourFor, harbourBlocks, inSeaBox } from '../src/games/city/harbour.js';
import { lighthouseAt } from '../src/games/city/bridge.js';
import { overlapDepth } from '../src/games/city/island/obb.js';
import { createPlayer, physicsStep, VEHICLES } from '../src/games/city/player.js';
import { citySeed } from '../src/worlds/cityGrid.js';
import type { CollisionBox } from '../src/worlds/cityChunk.js';

const base = Number(process.argv.slice(2).find(a => !a.startsWith('--')) ?? 7) | 0;
setCityBase(base);
let fails = 0;
const fail = (m: string): void => { fails++; if (fails < 30) console.log('  FAIL ' + m); };
const scene = new THREE.Scene();

/** the corners and middle of a boat's footprint */
const outline = (b: BoatFootprint): Array<{ x: number; z: number }> => {
  const fx = Math.sin(b.h), fz = Math.cos(b.h), rx = fz, rz = -fx;
  const pts = [{ x: b.x, z: b.z }];
  for (const a of [-1, 1]) for (const l of [-1, 1]) pts.push({ x: b.x + fx * b.hl * a + rx * b.hw * l, z: b.z + fz * b.hl * a + rz * b.hw * l });
  return pts;
};

/** what a boat point (world) touches, or null */
function touches(x: number, z: number): string | null {
  const c = cityAt(x, z), lx = x - c.ox, lz = z - c.oz;
  if (coastFor(c.bx, c.by).inLand(lx, lz, 0)) return 'land';
  if (harbourBlocks(c.bx, c.by, lx, lz, 0)) return 'the picnic bridge / island / pier';
  if (inSeaBox(harbourFor(c.bx, c.by).ship, lx, lz, 0)) return 'the anchored ship';
  const L = lighthouseAt(c.bx, c.by);
  if (Math.hypot(lx - L.x, lz - L.z) < 3.2) return 'the lighthouse';
  const dk = deckAt(x, z);
  if (dk && dk.y < BOAT_CLEAR) return 'a low causeway deck';
  return null;
}

for (const [bx, by] of [[1, 0], [2, 2]] as const) {
  // the island's fleet and its eight neighbours'
  const fleets: Fleet[] = [];
  for (let dx = -1; dx <= 1; dx++) for (let dz = -1; dz <= 1; dz++) {
    const cx = bx + dx, cz = by + dz;
    fleets.push(new Fleet(scene, cx * CITY_PITCH, cz * CITY_PITCH, citySeed(cx, cz), cx, cz));
  }
  const own = fleets[4];
  let overlaps = 0, grounded = 0, samples = 0, count = 0;
  const seen = new Set<string>();
  for (let t = 0; t < 180; t += 0.5) {
    const all = fleets.flatMap((f, fi) => f.footprints(t).map((b, bi) => ({ ...b, fi, bi })));
    count = own.footprints(t).length;
    samples++;
    for (let i = 0; i < all.length; i++) for (let j = i + 1; j < all.length; j++) {
      const a = all[i], b = all[j];
      if (Math.abs(a.x - b.x) > a.hl + b.hl || Math.abs(a.z - b.z) > a.hl + b.hl) continue;
      if (overlapDepth(a, b) > 0) {
        overlaps++;
        const k = `o${Math.round(a.x / 50)},${Math.round(a.z / 50)}`;
        if (!seen.has(k)) { seen.add(k); fail(`island ${bx},${by}: two boats overlap at (${a.x.toFixed(0)}, ${a.z.toFixed(0)}) t=${t} — fleet ${a.fi} boat ${a.bi} (${(a.hl * 2).toFixed(0)} m) and fleet ${b.fi} boat ${b.bi} (${(b.hl * 2).toFixed(0)} m)`); }
      }
    }
    for (const b of own.footprints(t)) {
      for (const p of outline(b)) {
        const hit = touches(p.x, p.z);
        if (!hit) continue;
        grounded++;
        const k = `g${Math.round(p.x / 50)},${Math.round(p.z / 50)}`;
        if (!seen.has(k)) { seen.add(k); fail(`island ${bx},${by}: a ${(b.hl * 2).toFixed(0)} m boat touches ${hit} at (${p.x.toFixed(0)}, ${p.z.toFixed(0)}) t=${t}`); }
        break;
      }
    }
  }
  console.log(`island ${bx},${by}: ${count} boats; ${overlaps} overlapping pairs and ${grounded} boats aground in ${samples} samples`);

  // the kid's boat, flat out at the lighthouse, the ship and the picnic isle
  const ox = bx * CITY_PITCH, oz = by * CITY_PITCH;
  const H = harbourFor(bx, by), L = lighthouseAt(bx, by);
  const boxes: CollisionBox[] = [
    { x1: ox + L.x - 3.2, x2: ox + L.x + 3.2, z1: oz + L.z - 3.2, z2: oz + L.z + 3.2, top: 19 },
    (() => {
      const S = H.ship, sx = ox + S.cx, sz = oz + S.cz;
      const ex = Math.abs(Math.sin(S.yaw)) * S.hl + Math.abs(Math.cos(S.yaw)) * S.hw, ez = Math.abs(Math.cos(S.yaw)) * S.hl + Math.abs(Math.sin(S.yaw)) * S.hw;
      return { x1: sx - ex, x2: sx + ex, z1: sz - ez, z2: sz + ez, obb: { cx: sx, cz: sz, hx: S.hw, hz: S.hl, ry: S.yaw } };
    })(),
  ];
  const run = (label: string, tx: number, tz: number, from: { x: number; z: number }, expectCrash: boolean, inside: (x: number, z: number) => boolean): void => {
    const h = Math.atan2(tx - from.x, tz - from.z);
    const p = createPlayer(VEHICLES.boat, ox + from.x, oz + from.z, h);
    p.state.v = VEHICLES.boat.maxF;
    let crashed = false, through = false;
    for (let k = 0; k < 60 * 8 && !crashed; k++) {
      const s = physicsStep(p, { gas: 1, brake: 0, steer: 0 }, 1 / 60, boxes);
      if (s.crashed) crashed = true;
      if (inside(p.state.x - ox, p.state.z - oz)) through = true;
    }
    if (through) fail(`island ${bx},${by}: the kid's boat sailed into ${label}`);
    else if (expectCrash && !crashed) fail(`island ${bx},${by}: running into ${label} flat out was no crash`);
    console.log(`  the boat at ${label}: ${crashed ? 'crashed' : 'slid along'}${through ? ' — and went THROUGH' : ''}`);
  };
  // (from 40 m off each, on the sea side)
  const away = (x: number, z: number, d: number): { x: number; z: number } => {
    const c = coastFor(bx, by), s = c.shoreToward(x, z, 0), dx = x - s.x, dz = z - s.z, l = Math.hypot(dx, dz) || 1;
    return { x: x + (dx / l) * d, z: z + (dz / l) * d };
  };
  run('the lighthouse', L.x, L.z, away(L.x, L.z, 40), false, (x, z) => Math.hypot(x - L.x, z - L.z) < 3.2);
  run('the anchored ship', H.ship.cx, H.ship.cz, away(H.ship.cx, H.ship.cz, 40), true, (x, z) => inSeaBox(H.ship, x, z, 0));
  const I = H.isle;
  run('the picnic island', (I.x1 + I.x2) / 2, (I.z1 + I.z2) / 2, { x: (I.x1 + I.x2) / 2 + 60, z: I.z2 + 30 }, false,
    (x, z) => x > I.x1 + 0.5 && x < I.x2 - 0.5 && z > I.z1 + 0.5 && z < I.z2 - 0.5);
}

console.log(fails ? `FAIL — ${fails} problem(s) at sea (G14)` : 'PASS — the boats never run into anything, and the sea is solid (G14)');
process.exit(fails ? 1 : 0);
