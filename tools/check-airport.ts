// R41 check: every island's airport (airport.ts) and the plane's landings
// (landing.ts).
//  · On the 25 islands round the origin: the airport's island lies inside
//    the cell (30 m in), off the shore (60 m+), clear of the causeway
//    corridors, the picnic island and the harbour; its runway is at least
//    160 m; its causeway lands on dry land, off the river's mouth; and it is
//    never in the SE corner (the harbour's).
//  · On three of them, the real plane (player.ts physics) flown by a kid who
//    steers at the map's mark (Landing.mark): from the edges of the approach
//    funnel (near / far, either side at 90 % of its width, either way along
//    the runway, 43° off either way; auto speed on, off, and off with the
//    brake held) and from all round 600 m out — each must come down, touch
//    down on the runway, never leave it or its pads on the ground, stop
//    before its end, turn round and take off again. (A mark at the runway's
//    middle brought the plane in square to it, and it never landed.)
//  · Descents called off — lined up 500 m out, coming down, then steering
//    away square to the runway or a tap of the gas: no landing, and it
//    climbs back to its cruise (the kid flies it in; it is never pulled in).
//   npx tsx tools/check-airport.ts [baseSeed]
import './headless-dom.js';
import { setCityBase, CITY_PITCH, southExit, eastExit } from '../src/worlds/cityGrid.js';
import { coastFor } from '../src/worlds/coast.js';
import { riverFor } from '../src/worlds/riverRoute.js';
import { RAIL_OFFSET } from '../src/worlds/railRoute.js';
import { ISLAND, CENTER } from '../src/worlds/world.js';
import { airportFor, boxPoint, RUNWAY_HW, RUNWAY_Y } from '../src/games/city/airport.js';
import { harbourFor, inSeaBox } from '../src/games/city/harbour.js';
import { Landing, type Runway, type LandEvent } from '../src/games/city/landing.js';
import { createPlayer, physicsStep, VEHICLES, type PlayerState } from '../src/games/city/player.js';

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

// ---- the landings: a kid flying the real plane (player.ts physics) ----
const DT = 1 / 60;
interface Flight { landed: boolean; airborne: boolean; offRunway: string; stopPast: number; minAlt: number; phases: string[]; endAlt: number }
/** fly the plane from `st` for up to `secs`: `kid` says each frame where it
 * steers for (a world point) and whether it presses the gas */
function flight(R: Runway, pad: number, start: PlayerState, secs: number, how: 'auto' | 'roll' | 'brake',
  kid: (t: number, st: PlayerState, L: Landing) => { to: { x: number; z: number } | null; gas: boolean }): Flight {
  const p = createPlayer(VEHICLES.plane, start.x, start.z, start.heading);
  Object.assign(p.state, start);
  const st = p.state, L = new Landing();
  const out: Flight = { landed: false, airborne: false, offRunway: '', stopPast: -Infinity, minAlt: Infinity, phases: [], endAlt: 0 };
  const fx = Math.sin(R.yaw), fz = Math.cos(R.yaw);
  for (let k = 0; k < secs / DT; k++) {
    const t = k * DT, want = kid(t, st, L);
    let steer = 0;
    if (want.to) {
      const d = Math.atan2(want.to.x - st.x, want.to.z - st.z) - st.heading;
      steer = Math.max(-1, Math.min(1, Math.atan2(Math.sin(d), Math.cos(d)) * 4));
    }
    const input = { gas: want.gas ? 1 : 0, brake: how === 'brake' ? 1 : 0, steer };
    const ev = (e: LandEvent): void => {
      if (out.phases[out.phases.length - 1] !== e) out.phases.push(e);
      if (e === 'landed') {
        out.landed = true;
        const dx = st.x - R.cx, dz = st.z - R.cz;
        out.stopPast = Math.max(Math.abs(dx * fx + dz * fz)) - R.hl;
      }
      if (e === 'airborne') out.airborne = true;
    };
    if (!L.ground(DT, input, st, how === 'auto', ev)) {
      const glide = L.fly(DT, st, [R], want.gas, 30, ev);
      if (L.phase !== 'roll') physicsStep(p, input, DT, [], glide ?? 30);
    }
    out.minAlt = Math.min(out.minAlt, st.alt);
    if (st.alt <= RUNWAY_Y + 0.01 && !out.offRunway) {
      const dx = st.x - R.cx, dz = st.z - R.cz, a = dx * fx + dz * fz, l = dx * fz - dz * fx;
      if (Math.abs(l) > RUNWAY_HW - 1 || Math.abs(a) > R.hl + pad) out.offRunway = `${a.toFixed(0)} along, ${l.toFixed(1)} across`;
    }
    if (out.airborne && st.alt > 20) break;
  }
  out.endAlt = st.alt;
  return out;
}
const runwayOf = (bx: number, by: number): { R: Runway; pad: number } => {
  const A = airportFor(bx, by);
  return { R: { key: `${bx},${by}`, cx: A.runway.cx + bx * CITY_PITCH, cz: A.runway.cz + by * CITY_PITCH, yaw: A.runway.yaw, hl: A.runway.hl }, pad: A.pad };
};
const atMark = (_t: number, st: PlayerState, L: Landing, R: Runway): { to: { x: number; z: number } | null; gas: boolean } => ({ to: L.mark(st, [R]), gas: false });

let landings = 0, worstStop = -Infinity, followed = 0, cancels = 0;
const judge = (label: string, f: Flight): void => {
  if (f.offRunway) fail(`${label}: on the ground off the runway (${f.offRunway})`);
  else if (!f.landed) fail(`${label}: never landed (${f.phases.join(' → ') || 'no descent'})`);
  else if (!f.airborne) fail(`${label}: landed but never took off again (${f.phases.join(' → ')})`);
  else if (f.stopPast > 0) fail(`${label}: stopped ${f.stopPast.toFixed(0)} m past the runway's end`);
  else { landings++; worstStop = Math.max(worstStop, f.stopPast); }
};
for (const [bx, by] of [[1, 0], [2, 2], [0, 1]] as const) {
  const { R, pad } = runwayOf(bx, by);
  // from the funnel's edges, flying at the mark
  for (const dir of [0, Math.PI]) for (const short of [210, 690]) for (const side of [-0.9, 0.9]) for (const turn of [-0.75, 0.75]) for (const how of ['auto', 'roll', 'brake'] as const) {
    const yaw = R.yaw + dir, fx = Math.sin(yaw), fz = Math.cos(yaw);
    const a0 = -R.hl - short, off = side * (40 + 0.35 * short);
    const start: PlayerState = { x: R.cx + fx * a0 + fz * off, z: R.cz + fz * a0 - fx * off, heading: yaw + turn, v: 14, alt: 30 };
    judge(`${bx},${by} ${dir ? 'back' : 'along'} ${short} m short, ${off.toFixed(0)} m off, ${turn > 0 ? '+' : '-'}43°, ${how}`,
      flight(R, pad, start, 150, how, (t, st, L) => atMark(t, st, L, R)));
  }
  // a kid who just flies at the mark, from all round, 600 m out
  for (let k = 0; k < 8; k++) {
    const ang = (k / 8) * Math.PI * 2;
    const start: PlayerState = { x: R.cx + Math.cos(ang) * 600, z: R.cz + Math.sin(ang) * 600, heading: ang + Math.PI, v: 16, alt: 30 };
    const f = flight(R, pad, start, 240, 'auto', (t, st, L) => atMark(t, st, L, R));
    if (f.landed && f.airborne && !f.offRunway) followed++;
    else fail(`${bx},${by}: flying at the mark from ${(ang * 180 / Math.PI).toFixed(0)}° round, 600 m out: ${f.offRunway ? 'off the runway' : f.phases.join(' → ') || 'no descent'}`);
  }
  // calling it off: lined up 500 m out, coming down — then steering away
  // (square to the runway) or pressing the gas: no landing, and it climbs
  // back to its cruise
  for (const how of ['steer', 'gas'] as const) for (const dir of [0, Math.PI]) {
    const yaw = R.yaw + dir, fx = Math.sin(yaw), fz = Math.cos(yaw), a0 = -R.hl - 500;
    const start: PlayerState = { x: R.cx + fx * a0, z: R.cz + fz * a0, heading: yaw, v: 14, alt: 30 };
    let descending = false, calledOff = -1;
    const label = `${R.key} ${dir ? 'back' : 'along'}: called off by ${how === 'steer' ? 'steering away' : 'the gas'}`;
    const f = flight(R, pad, start, 40, 'auto', (t, st, L) => {
      if (L.phase === 'descend') descending = true;
      if (t < 12) return { to: L.mark(st, [R]), gas: false };
      if (calledOff < 0 && L.phase === 'fly') calledOff = t;
      return how === 'steer'
        ? { to: { x: st.x + fz * 1000, z: st.z - fx * 1000 }, gas: false }
        : { to: { x: st.x + fx * 1000, z: st.z + fz * 1000 }, gas: t < 13.5 };
    });
    if (!descending) fail(`${label}: it never began to come down`);
    else if (f.landed || f.minAlt < 1) fail(`${label}: it landed anyway`);
    else if (calledOff < 0 || calledOff > 14) fail(`${label}: the descent wasn't called off (${calledOff.toFixed(1)} s)`);
    else if (f.endAlt < 25) fail(`${label}: it didn't climb back (${f.endAlt.toFixed(1)} m)`);
    else cancels++;
  }
}
console.log(`following the mark: ${followed} of 24 landed; ${cancels} of 12 descents called off (steering away, the gas) climbed back`);
console.log(`landings: ${landings} flown — every one down on the runway, stopped (the furthest ${(-worstStop).toFixed(0)} m short of its end), turned and back in the air`);

console.log(fails ? `FAIL — ${fails} problem(s) with the airports (R41)` : 'PASS — every island has its airport, and the plane lands, stops, turns and takes off (R41)');
process.exit(fails ? 1 : 0);
