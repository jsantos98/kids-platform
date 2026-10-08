// G19 check: steering is easy for a 4-year-old — no turn has to be planned
// ahead. With the real physics (player.ts):
//  · every road vehicle at full steering turns on a circle of at most 9 m at
//    every speed from 2 m/s to its top speed (the fire truck's was 8.9 m at
//    a crawl and 13 m flat out), and swings round from a standstill at
//    ≥ 0.25 rad/s;
//  · a boat turns on ≤ 14 m (the pirate ship ≤ 13 m) at every speed it sails;
//  · a helicopter hovering yaws at ≥ 0.8 rad/s; the plane turns on ≤ 10 m at
//    12 m/s and ≤ 20 m flat out;
//  · the steering is eased in, not snapped (half of it within 0.1 s, all of it
//    within 0.4 s);
//  · the street assist (streetAssist.ts): a car 25° off a street's line,
//    wheel centred, is along it within 3 s; with the wheel turned, or 50° off,
//    or standing, it does nothing.
//   npx tsx tools/check-steering.ts [baseSeed]
import './headless-dom.js';
import { setCityBase, cityAt } from '../src/worlds/cityGrid.js';
import { graphFor } from '../src/worlds/streetGraph.js';
import { CENTER } from '../src/worlds/world.js';
import { createPlayer, physicsStep, VEHICLES, type Player } from '../src/games/city/player.js';
import { StreetAssist } from '../src/games/city/streetAssist.js';

const base = Number(process.argv.slice(2).find(a => !a.startsWith('--')) ?? 7) | 0;
setCityBase(base);
let fails = 0;
const fail = (m: string): void => { fails++; console.log('  FAIL ' + m); };
const DT = 1 / 60;
const ox = 1472, oz = 0; // island (1, 0)
const wrap = (a: number): number => Math.atan2(Math.sin(a), Math.cos(a));

/** hold speed v and full steering for `secs`; returns the turning radius over the last 2 s and the yaw rate from the start */
function circle(p: Player, v: number, secs: number, steer = 1): { radius: number; early: number } {
  let s = 0, dh = 0, early = 0, h1 = p.state.heading;
  for (let k = 0; k < secs / DT; k++) {
    p.state.v = v;
    const before = p.state.heading;
    physicsStep(p, { gas: 0, brake: 0, steer }, DT, []);
    const dd = wrap(p.state.heading - before);
    if (k * DT < 0.5) early += dd;
    if (k * DT >= secs - 2) { dh += dd; s += Math.hypot(Math.sin(p.state.heading) * v * DT, Math.cos(p.state.heading) * v * DT); }
    h1 = p.state.heading;
  }
  void h1;
  return { radius: s / Math.max(1e-6, Math.abs(dh)), early: Math.abs(early) / 0.5 };
}
const fresh = (V: typeof VEHICLES[string], alt = 0): Player => {
  const p = createPlayer(V, ox + CENTER, oz + CENTER, 0);
  p.graceT = 0; p.state.alt = alt;
  return p;
};

// ---- road vehicles ----
for (const name of ['truck', 'police', 'ambulance', 'tow', 'garbage', 'car', 'kart']) {
  const V = VEHICLES[name];
  let worst = 0;
  for (const v of [2, 3.5, 5, 7, V.maxF * 0.9]) {
    const { radius } = circle(fresh(V), v, 4);
    worst = Math.max(worst, radius);
    if (radius > 9) fail(`${name} at ${v.toFixed(1)} m/s turns on ${radius.toFixed(1)} m (more than 9)`);
  }
  // from a standstill: it swings round, if slowly
  const p = fresh(V);
  let turned = 0;
  for (let k = 0; k < 90; k++) { const b = p.state.heading; p.state.v = 0; physicsStep(p, { gas: 0, brake: 0, steer: 1 }, DT, []); turned += Math.abs(wrap(p.state.heading - b)); }
  if (turned / 1.5 < 0.25) fail(`${name} standing still turns only ${(turned / 1.5).toFixed(2)} rad/s`);
  console.log(`${name}: tightest-to-widest turn ${worst.toFixed(1)} m, ${(turned / 1.5).toFixed(2)} rad/s from standing`);
}
// ---- boats ----
for (const [name, lim] of [['boat', 14], ['policeBoat', 14], ['pirate', 13]] as const) {
  const V = VEHICLES[name];
  let worst = 0;
  for (const v of [3, 5, V.maxF * 0.9]) {
    // (open water: a sea physics test needs no land — the boat is far from every shore)
    const p = createPlayer(V, ox + CENTER + 3000, oz + CENTER + 3000, 0);
    const { radius } = circle(p, v, 5);
    worst = Math.max(worst, radius);
    if (radius > lim) fail(`${name} at ${v.toFixed(1)} m/s turns on ${radius.toFixed(1)} m (more than ${lim})`);
  }
  console.log(`${name}: widest turn ${worst.toFixed(1)} m`);
}
// ---- the helicopter and the plane ----
{
  const p = fresh(VEHICLES.heliMedical, 16);
  let turned = 0;
  for (let k = 0; k < 120; k++) { const b = p.state.heading; p.state.v = 0; physicsStep(p, { gas: 0, brake: 0, steer: 1 }, DT, []); if (k >= 30) turned += wrap(p.state.heading - b); }
  const rate = Math.abs(turned) / 1.5;
  if (rate < 0.8) fail(`the helicopter hovering yaws at ${rate.toFixed(2)} rad/s (less than 0.8)`);
  console.log(`helicopter: ${rate.toFixed(2)} rad/s hovering`);
  for (const [v, lim] of [[12, 10], [24, 20]] as const) {
    const q = fresh(VEHICLES.plane, 30);
    const { radius } = circle(q, v, 4);
    if (radius > lim) fail(`the plane at ${v} m/s turns on ${radius.toFixed(1)} m (more than ${lim})`);
    console.log(`plane at ${v} m/s: ${radius.toFixed(1)} m`);
  }
}
// ---- the steering is eased in ----
{
  const p = fresh(VEHICLES.truck);
  let half = -1, full = -1;
  for (let k = 0; k < 60; k++) {
    p.state.v = 6; physicsStep(p, { gas: 0, brake: 0, steer: 1 }, DT, []);
    if (half < 0 && p.steerS >= 0.5) half = k * DT;
    if (full < 0 && p.steerS >= 0.98) full = k * DT;
  }
  if (half > 0.1 || full > 0.4 || half < 0) fail(`the steering reaches half in ${half.toFixed(2)} s and full in ${full.toFixed(2)} s (≤ 0.1 / 0.4)`);
  console.log(`steering eased: half in ${half.toFixed(2)} s, full in ${full.toFixed(2)} s`);
}

// ---- the street assist ----
{
  const c = cityAt(ox + CENTER, oz + CENTER), g = graphFor(c.bx, c.by);
  // a long street edge near the middle
  const e = [...g.edges].filter(q => q.len > 80).sort((a, b) => Math.hypot(g.nodes[a.a].x - CENTER, g.nodes[a.a].z - CENTER) - Math.hypot(g.nodes[b.a].x - CENTER, g.nodes[b.a].z - CENTER))[0];
  const mid = g.sample(e, e.len / 2, 3.5);
  const run = (off: number, steer: number, v: number, secs: number): number => {
    const st = { x: c.ox + mid.x, z: c.oz + mid.z, heading: e.heading + off, v, alt: 0 };
    const A = new StreetAssist();
    for (let k = 0; k < secs / DT; k++) { A.update(DT, st, steer); st.x += Math.sin(st.heading) * v * DT * 0; st.z += Math.cos(st.heading) * v * DT * 0; }
    return Math.abs(wrap(st.heading - e.heading));
  };
  const near = run(25 * Math.PI / 180, 0, 8, 3);
  if (near > 3 * Math.PI / 180) fail(`the assist left a car 25° off the street ${(near * 57.3).toFixed(1)}° off after 3 s`);
  const steered = run(25 * Math.PI / 180, 0.5, 8, 3);
  if (Math.abs(steered - 25 * Math.PI / 180) > 0.01) fail('the assist pulled the heading while the wheel was turned');
  const far = run(50 * Math.PI / 180, 0, 8, 3);
  if (Math.abs(far - 50 * Math.PI / 180) > 0.01) fail('the assist pulled a car 50° off the street');
  const still = run(25 * Math.PI / 180, 0, 0.5, 3);
  if (Math.abs(still - 25 * Math.PI / 180) > 0.01) fail('the assist turned a standing car');
  const back = run(Math.PI + 20 * Math.PI / 180, 0, 8, 3);
  if (back > 3 * Math.PI / 180 && Math.abs(back - Math.PI) > 3 * Math.PI / 180) fail('the assist left a car along the street the other way off the line');
  console.log(`street assist: 25° off → ${(near * 57.3).toFixed(1)}° after 3 s; wheel turned, 50° off and standing: left alone`);
}

console.log(fails ? `FAIL — ${fails} problem(s) with the steering (G19)` : 'PASS — every vehicle turns tight and easy, and the street assist only helps (G19)');
process.exit(fails ? 1 : 0);
