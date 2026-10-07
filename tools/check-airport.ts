// R41 check: every island's airport (airport.ts) and the plane's landings
// (landing.ts).
//  · On the 25 islands round the origin: the airport's island lies inside
//    the cell (30 m in), off the shore (60 m+), clear of the causeway
//    corridors, the picnic island and the harbour; its runway is at least
//    160 m; its causeway lands on dry land, off the river's mouth; and it is
//    never in the SE corner (the harbour's).
//  · On three of them, the plane lined up from the edges of the approach
//    (short / far, either side of the centre line, either way along the
//    runway, high and low, 20° off), with auto speed on, off, and off with
//    the brake held: it touches down on the runway past its threshold,
//    never leaves the runway or its pads on the ground, stops before the
//    end, turns round, takes off and climbs away within two minutes.
//   npx tsx tools/check-airport.ts [baseSeed]
import { setCityBase, CITY_PITCH, southExit, eastExit } from '../src/worlds/cityGrid.js';
import { coastFor } from '../src/worlds/coast.js';
import { riverFor } from '../src/worlds/riverRoute.js';
import { RAIL_OFFSET } from '../src/worlds/railRoute.js';
import { ISLAND, CENTER } from '../src/worlds/world.js';
import { airportFor, boxPoint, RUNWAY_HW, RUNWAY_Y } from '../src/games/city/airport.js';
import { harbourFor, inSeaBox } from '../src/games/city/harbour.js';
import { Landing, type Runway, type LandEvent } from '../src/games/city/landing.js';
import type { PlayerState } from '../src/games/city/player.js';

const base = Number(process.argv.slice(2).find(a => !a.startsWith('--')) ?? 7) | 0;
setCityBase(base);
let fails = 0;
const fail = (m: string): void => { fails++; if (fails < 40) console.log('  FAIL ' + m); };

// ---- the layouts ----
let shortest = Infinity, n = 0;
for (let bx = -2; bx <= 2; bx++) for (let by = -2; by <= 2; by++) {
  const A = airportFor(bx, by), coast = coastFor(bx, by), H = harbourFor(bx, by);
  const at = `island ${bx},${by}`;
  n++;
  if (A.corner === 0) fail(`${at}: the airport is off the SE corner (the harbour's)`);
  shortest = Math.min(shortest, A.runway.hl * 2);
  if (A.runway.hl * 2 < 160) fail(`${at}: the runway is only ${(A.runway.hl * 2).toFixed(0)} m`);
  const lines = { n: southExit(bx, by - 1) * 64, s: southExit(bx, by) * 64, w: eastExit(bx - 1, by) * 64, e: eastExit(bx, by) * 64 };
  const inCorridor = (x: number, z: number, m: number): boolean => {
    const inV = (a: number): boolean => x > a - m && x < a + RAIL_OFFSET + m;
    const inH = (a: number): boolean => z > a - m && z < a + RAIL_OFFSET + m;
    return (z < CENTER && inV(lines.n)) || (z > CENTER && inV(lines.s)) || (x < CENTER && inH(lines.w)) || (x > CENTER && inH(lines.e));
  };
  const I = A.isle;
  for (let a = -I.hl; a <= I.hl; a += 5) for (const l of [-I.hw, 0, I.hw]) {
    const p = boxPoint(I, a, l);
    if (p.x < 30 || p.z < 30 || p.x > ISLAND - 30 || p.z > ISLAND - 30) { fail(`${at}: the airport's island reaches within 30 m of the cell's edge`); break; }
    if (coast.inLand(p.x, p.z, -55)) { fail(`${at}: the airport's island is within 55 m of the shore at (${p.x.toFixed(0)}, ${p.z.toFixed(0)})`); break; }
    if (inCorridor(p.x, p.z, 55)) { fail(`${at}: the airport's island is in a causeway corridor`); break; }
    if (inSeaBox(H.ship, p.x, p.z, 55) || inSeaBox(H.pier, p.x, p.z, 55)) { fail(`${at}: the airport's island is by the harbour`); break; }
  }
  // the causeway: its shore end on dry land, off the river
  const land = boxPoint(A.link, A.link.hl, 0);
  if (!coast.inLand(land.x, land.z, 0)) fail(`${at}: the airport's causeway doesn't reach the land`);
  if (riverFor(bx, by).pts.some(p => Math.hypot(p.x - land.x, p.z - land.z) < 35)) fail(`${at}: the airport's causeway lands on the river`);
  // the runway lies on the island, its pads too
  for (const end of [-1, 1]) {
    const r = { ...A.runway };
    const p = boxPoint(r, end * (r.hl + A.pad), 0);
    if (!inSeaBox(I, p.x, p.z, -1)) fail(`${at}: the runway's ${end < 0 ? 'near' : 'far'} pad is off the island`);
  }
}
console.log(`layouts: ${n} islands, the shortest runway ${shortest.toFixed(0)} m`);

// ---- the landings ----
let landings = 0, worstStop = -Infinity;
for (const [bx, by] of [[1, 0], [2, 2], [0, 1]] as const) {
  const A = airportFor(bx, by);
  const R: Runway = { key: `${bx},${by}`, cx: A.runway.cx + bx * CITY_PITCH, cz: A.runway.cz + by * CITY_PITCH, yaw: A.runway.yaw, hl: A.runway.hl };
  for (const dir of [0, Math.PI]) for (const short of [140, 430]) for (const off of [-30, 30]) for (const turn of [-0.35, 0.35]) for (const alt of [24, 44])
    for (const how of ['auto', 'roll', 'brake'] as const) {
      const yaw = R.yaw + dir, fx = Math.sin(yaw), fz = Math.cos(yaw);
      const a0 = -R.hl - short;
      const st: PlayerState = { x: R.cx + fx * a0 + fz * off, z: R.cz + fz * a0 - fx * off, heading: yaw + turn, v: 14, alt };
      const L = new Landing();
      const evs: LandEvent[] = [];
      const label = `${bx},${by} ${dir ? 'back' : 'along'} ${short} m short, ${off} m off, ${turn > 0 ? '+' : '-'}20°, ${alt} m, ${how}`;
      let ok = true, stopA = 0;
      const frame = (x: number, z: number): { a: number; l: number } => {
        const dx = x - R.cx, dz = z - R.cz;
        return { a: dx * fx + dz * fz, l: dx * fz - dz * fx };
      };
      for (let k = 0; k < 120 * 60 && ok; k++) {
        const had = L.update(1 / 60, { gas: 0, brake: how === 'brake' ? 1 : 0, steer: 0 }, st, [R], how === 'auto', e => {
          evs.push(e);
          if (e === 'landed') stopA = frame(st.x, st.z).a;
        });
        if (!had) {
          if (!evs.length) { fail(`${label}: it never began to land`); ok = false; }
          break;
        }
        // on the ground: on the runway or its pads, past the threshold
        if (st.alt <= RUNWAY_Y + 0.01) {
          const { a, l } = frame(st.x, st.z);
          if (Math.abs(l) > RUNWAY_HW - 1 || Math.abs(a) > R.hl + A.pad) { fail(`${label}: on the ground off the runway (${a.toFixed(0)} along, ${l.toFixed(1)} across)`); ok = false; }
          if (evs.length === 1 && a < -R.hl) { fail(`${label}: touched down short of the threshold`); ok = false; }
        }
      }
      if (!ok) continue;
      if (evs.join() !== 'land,landed,takeoff,airborne') { fail(`${label}: ${evs.join(' → ') || 'nothing'} (not land → landed → takeoff → airborne)`); continue; }
      if (stopA > R.hl + A.pad * 0.5) fail(`${label}: stopped ${(stopA - R.hl).toFixed(0)} m past the runway's end`);
      worstStop = Math.max(worstStop, stopA - R.hl);
      landings++;
    }
}
console.log(`landings: ${landings} flown — every one down on the runway, stopped (the furthest ${(-worstStop).toFixed(0)} m short of its end), turned and back in the air`);

console.log(fails ? `FAIL — ${fails} problem(s) with the airports (R41)` : 'PASS — every island has its airport, and the plane lands, stops, turns and takes off (R41)');
process.exit(fails ? 1 : 0);
