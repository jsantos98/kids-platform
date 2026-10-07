// R32 race check: the eight-car race (race.ts) on every race island near the
// origin, a kid going round the centreline at a steady 9, 10.5, 12 and 13.5
// m/s. The kid starts last (place 8 on the grid); no two rivals ever come
// closer than 2.6 m (they never drive through each other); a kid at 13.5
// m/s wins and at 12 finishes first or second; a slower kid still
// finishes; and slower is never a better place (the rubber band keeps it
// fair, G3).
//   npx tsx tools/check-race.ts [baseSeed]
import './headless-dom.js';
import * as THREE from 'three';
import { setCityBase } from '../src/worlds/cityGrid.js';
import { raceTrackFor } from '../src/worlds/raceIsland.js';
import { Race } from '../src/games/city/race.js';
import { RACE_CARS } from '../src/games/raceCars.js';

const base = Number(process.argv.slice(2).find(a => !a.startsWith('--')) ?? 7) | 0;
setCityBase(base);
let fails = 0;
const fail = (m: string): void => { fails++; console.log('  FAIL ' + m); };
const DT = 1 / 30;

for (const [bx, by] of [[0, 0], [10, 0], [0, 10]] as const) {
  const T = raceTrackFor(bx, by);
  if (!T) { fail(`island ${bx},${by} has no circuit`); continue; }
  const places: number[] = [];
  for (const vk of [9, 10.5, 12, 13.5]) {
    const race = new Race(new THREE.Scene(), T, 0, 0, RACE_CARS[(bx + by) % RACE_CARS.length]);
    const start = race.reset();
    if (race.view().place !== 8) fail(`${bx},${by}: the kid starts ${race.view().place}th on the grid, not last`);
    let s = T.nearest(start.x, start.z).s - T.startS;
    let closest = Infinity, place = 0, t = 0;
    for (let k = 0; k < 600 / DT && !place; k++) {
      t += DT;
      const p = T.sample(s + T.startS);
      const ev = race.update(DT, p.x, p.z);
      if (!race.frozen) s += vk * DT;
      for (let i = 0; i < race.ai.length; i++) for (let j = i + 1; j < race.ai.length; j++) {
        const A = race.ai[i], B = race.ai[j];
        // (finished rivals stop off on the lap of honour: no longer racing)
        if (A.place || B.place || race.frozen) continue;
        closest = Math.min(closest, A.group.position.distanceTo(B.group.position));
      }
      if (ev.finished) place = ev.finished;
    }
    if (!place) fail(`${bx},${by}: a kid at ${vk} m/s never finished`);
    if (closest < 2.6) fail(`${bx},${by}: two rivals came ${closest.toFixed(2)} m apart (through each other)`);
    places.push(place);
    console.log(`island ${bx},${by}: kid at ${vk} m/s finished #${place} in ${t.toFixed(0)} s; rivals never closer than ${closest.toFixed(1)} m`);
  }
  if (places[2] > 2 || places[3] !== 1) fail(`${bx},${by}: a kid at 13.5 m/s didn't win, or at 12 wasn't first or second (${places.join(', ')})`);
  if (places.some((p, i) => i && p > places[i - 1])) fail(`${bx},${by}: driving faster came in a worse place (${places.join(', ')})`);
}

console.log(fails ? `FAIL — ${fails} problem(s) with the race (R32)` : 'PASS — eight on the grid, the kid last, fair and never through each other (R32)');
process.exit(fails ? 1 : 0);
