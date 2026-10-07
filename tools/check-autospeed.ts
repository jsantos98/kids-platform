// G18 check: auto speed (autoSpeed.ts) with the real physics (player.ts).
//  · A fire truck, the rescue helicopter and the boat, each sent at a target
//    200 m ahead, come to a halt inside its reach slow enough for the game's
//    "stopped beside it" test (|v| < 1 m/s on the road, < 4 hovering, < 2 at
//    sea) — and never roll backwards on their own.
//  · A target they only pass by (never within reach) doesn't stop them.
//  · The pedals win: the brake held never gets gas, the gas held is full gas;
//    'go' is flat out, and 'off' (the train, a scene) leaves the input be.
//   npx tsx tools/check-autospeed.ts [baseSeed]
import './headless-dom.js';
import { setCityBase, CITY_PITCH } from '../src/worlds/cityGrid.js';
import { coastFor } from '../src/worlds/coast.js';
import { CENTER, ISLAND } from '../src/worlds/world.js';
import { createPlayer, physicsStep, onLand, VEHICLES, type VehicleConfig } from '../src/games/city/player.js';
import { autoInput, CRUISE, type AutoGoal } from '../src/games/city/autoSpeed.js';

const base = Number(process.argv.slice(2).find(a => !a.startsWith('--')) ?? 7) | 0;
setCityBase(base);
let fails = 0;
const fail = (m: string): void => { fails++; console.log('  FAIL ' + m); };
const DT = 1 / 60;
const NONE = { gas: 0, brake: 0, steer: 0 };
const ox = CITY_PITCH, oz = 0;

interface Run { name: string; V: VehicleConfig; x: number; z: number; h: number; reach: number; still: number }
const runs: Run[] = [
  // (east from the middle of island (1,0): dry land the whole way)
  { name: 'fire truck', V: VEHICLES.truck, x: ox + CENTER - 100, z: oz + CENTER - 40, h: Math.PI / 2, reach: 15, still: 1 },
  { name: 'rescue helicopter', V: VEHICLES.heliMedical, x: ox + CENTER - 100, z: oz + CENTER, h: Math.PI / 2, reach: 9, still: 4 },
  // (south down the strait east of the island, clear of the causeways)
  { name: 'boat', V: VEHICLES.boat, x: ox + ISLAND + 64, z: oz + 60, h: 0, reach: 25, still: 2 },
];
const land = coastFor(1, 0);

for (const r of runs) {
  const fx = Math.sin(r.h), fz = Math.cos(r.h);
  if (r.V.kind === 'ground' && !land.inLand(r.x - ox + fx * 210, r.z - oz + fz * 210, 0)) { fail(`${r.name}: the test road runs into the sea (pick another)`); continue; }
  if (r.V.kind === 'boat' && [0, 70, 140, 210].some(d => onLand(r.x + fx * d, r.z + fz * d, 3))) { fail(`${r.name}: the test water has land in it (pick another)`); continue; }
  // 1. a target straight ahead: it stops inside its reach
  {
    const p = createPlayer(r.V, r.x, r.z, r.h);
    p.graceT = 0;
    const goal: AutoGoal = { pace: 'stop', x: r.x + fx * 200, z: r.z + fz * 200, reach: r.reach };
    let arrived = -1, backwards = 0, top = 0;
    for (let k = 0; k < 90 / DT; k++) {
      const st = p.state;
      physicsStep(p, autoInput(NONE, st, r.V.maxF, goal), DT, []);
      top = Math.max(top, st.v);
      if (st.v < -0.05) backwards++;
      const d = Math.hypot(goal.x! - st.x, goal.z! - st.z);
      if (d < r.reach && Math.abs(st.v) < r.still) { arrived = k * DT; break; }
    }
    if (arrived < 0) fail(`${r.name}: never came to a halt inside ${r.reach} m of its target`);
    if (backwards) fail(`${r.name}: rolled backwards on its own (${backwards} frames)`);
    if (top > r.V.maxF * CRUISE + 1) fail(`${r.name}: cruised at ${top.toFixed(1)} m/s, over ${CRUISE * 100}% of its top speed`);
    console.log(`${r.name}: stopped at its target after ${arrived.toFixed(1)} s, cruising at ${top.toFixed(1)} m/s`);
  }
  // 2. a target it only passes, 45 m to the side: no stop
  {
    const p = createPlayer(r.V, r.x, r.z, r.h);
    p.graceT = 0;
    const goal: AutoGoal = { pace: 'stop', x: r.x + fx * 100 + fz * 45, z: r.z + fz * 100 - fx * 45, reach: r.reach };
    let slowest = Infinity;
    for (let k = 0; k < 20 / DT; k++) {
      physicsStep(p, autoInput(NONE, p.state, r.V.maxF, goal), DT, []);
      if (k * DT > 6) slowest = Math.min(slowest, p.state.v);
    }
    if (slowest < 1) fail(`${r.name}: stopped for a target it only passed by (down to ${slowest.toFixed(1)} m/s)`);
  }
}

// 3. the pedals win, 'go' is flat out, 'off' leaves the input be
const st = { x: 0, z: 0, heading: 0, v: 3 };
for (const pace of ['go', 'cruise', 'stop'] as const) {
  const goal: AutoGoal = { pace, x: 0, z: 5, reach: 10 };
  if (autoInput({ gas: 0, brake: 1, steer: 0 }, st, 20, goal).gas > 0) fail(`${pace}: gas with the brake held`);
  if (autoInput({ gas: 1, brake: 0, steer: 0 }, st, 20, goal).gas !== 1) fail(`${pace}: the gas held isn't full gas`);
  if (autoInput({ gas: 0, brake: 0, steer: 0.7 }, st, 20, goal).steer !== 0.7) fail(`${pace}: it touched the steering`);
}
if (autoInput(NONE, st, 20, { pace: 'go' }).gas !== 1) fail('go: not flat out');
const kid = { gas: 0.3, brake: 0, steer: -0.2 };
if (autoInput(kid, st, 20, { pace: 'off' }) !== kid) fail('off: the input was changed');

console.log(fails ? `FAIL — ${fails} problem(s) with auto speed (G18)` : 'PASS — auto speed stops at the targets, never reverses, and the pedals win (G18)');
process.exit(fails ? 1 : 0);
