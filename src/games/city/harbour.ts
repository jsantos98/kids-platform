// The things standing in an island's water, in one place (G14): the pier
// off the south-east shore, its moored dinghies, the cargo ship anchored off
// it, and the picnic bridge and island (bridge.ts). The scenery bakes them
// here, the kid's boat can't sail through them (a soft wall — or, for the
// ship, the lighthouse and the rest of the picnic island's solid things, a
// crash: player.ts), and the sailing lanes keep clear of them (sea.ts).
// City-local coordinates.
import { CENTER } from '../../worlds/world.js';
import { coastFor } from '../../worlds/coast.js';
import { bridgeLayout } from './bridge.js';

/** a turned rectangle: centre, heading of its length (+z at yaw 0), half
 * length and half width */
export interface SeaBox { cx: number; cz: number; yaw: number; hl: number; hw: number }

export interface Harbour {
  /** the pier's frame: where it leaves the beach, out to sea and across */
  shore: { x: number; z: number };
  out: { x: number; z: number };
  across: { x: number; z: number };
  yaw: number;
  /** a point `a` m across and `o` m out in the pier's frame */
  at(a: number, o: number): { x: number; z: number };
  /** the pier's deck (8 × 19 m) */
  pier: SeaBox;
  /** the dinghies moored at it: across, out, bob phase */
  dinghies: Array<[number, number, number]>;
  /** the cargo ship anchored off it (30 m) */
  ship: SeaBox;
  /** the picnic bridge's deck and the picnic island, as rectangles */
  bridgeDeck: { x1: number; z1: number; x2: number; z2: number };
  isle: { x1: number; z1: number; x2: number; z2: number };
}

const cache = new Map<string, Harbour>();

export function harbourFor(bx: number, by: number): Harbour {
  const key = `${bx},${by}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const coast = coastFor(bx, by);
  const shore = coast.shoreToward(CENTER + 1, CENTER + 1, -2);
  const out = { x: shore.x - CENTER, z: shore.z - CENTER };
  const ol = Math.hypot(out.x, out.z);
  out.x /= ol; out.z /= ol;
  const across = { x: out.z, z: -out.x };
  const yaw = Math.atan2(out.x, out.z);
  const at = (a: number, o: number): { x: number; z: number } =>
    ({ x: shore.x + across.x * a + out.x * o, z: shore.z + across.z * a + out.z * o });
  const pc = at(0, 9.5);
  // (115 m out: beyond the three small-boat lanes — at 70 m the
  // speedboats' lane ran into it)
  const sp = at(-40, 115);
  const B = bridgeLayout(bx, by);
  const h: Harbour = {
    shore, out, across, yaw, at,
    pier: { cx: pc.x, cz: pc.z, yaw, hl: 9.5, hw: 4 },
    dinghies: [[-7.5, 12, 1.2], [7.5, 16, 4.1]],
    // (ship-cargo-a is about a fifth as wide as it is long)
    ship: { cx: sp.x, cz: sp.z, yaw: 0.5, hl: 15, hw: 3.4 },
    bridgeDeck: { x1: B.X - B.HALF_W, z1: B.Z0, x2: B.X + B.HALF_W, z2: B.Z1 },
    isle: B.ISLE,
  };
  cache.set(key, h);
  if (cache.size > 32) cache.delete(cache.keys().next().value as string);
  return h;
}

/** is (x, z) — city-local — within r of the turned box */
export function inSeaBox(b: SeaBox, x: number, z: number, r: number): boolean {
  const dx = x - b.cx, dz = z - b.cz;
  const fx = Math.sin(b.yaw), fz = Math.cos(b.yaw);
  const a = dx * fx + dz * fz, l = dx * fz - dz * fx;
  return Math.abs(a) < b.hl + r && Math.abs(l) < b.hw + r;
}

const inRect = (R: { x1: number; z1: number; x2: number; z2: number }, x: number, z: number, r: number): boolean =>
  x > R.x1 - r && x < R.x2 + r && z > R.z1 - r && z < R.z2 + r;

/** something built stands in the water at (x, z) (city-local), within r:
 * the picnic bridge's deck, the picnic island, the pier or a moored dinghy —
 * a boat slides along it like the shore (the ship is a crash: `shipAt`) */
export function harbourBlocks(bx: number, by: number, x: number, z: number, r: number): boolean {
  const h = harbourFor(bx, by);
  if (inRect(h.bridgeDeck, x, z, r) || inRect(h.isle, x, z, r)) return true;
  if (inSeaBox(h.pier, x, z, r)) return true;
  for (const [a, o] of h.dinghies) {
    const p = h.at(a, o);
    if (Math.hypot(x - p.x, z - p.z) < 2.2 + r) return true;
  }
  return false;
}
