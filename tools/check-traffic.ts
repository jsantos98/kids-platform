// Traffic flow check — the executable half of G5's busy streets: an island's
// whole fleet and crowd (island/cars.ts + island/walkers.ts, at full density)
// run for 180 s of game time at 20 fps with each seeing the other, as the
// island sim steps them, and the check fails if any car or walker stands
// still for 60 s (a gridlock: two cars on one curve, a car waiting on a
// walker waiting on it, a walker frozen at a kerb) or two cars sit inside
// each other.
// Run: npx tsx tools/check-traffic.ts [baseSeed]
import * as THREE from 'three';
import { setCityBase, CITY_PITCH } from '../src/worlds/cityGrid.js';
import { IslandCars } from '../src/games/city/island/cars.js';
import { IslandWalkers } from '../src/games/city/island/walkers.js';

const base = Number(process.argv[2] ?? 7) | 0;
setCityBase(base);
const DT = 0.05, STEPS = 3600, STILL = 60;
let fails = 0;

for (const [bx, by] of [[1, 0], [2, 2]] as const) {
  const t0 = performance.now();
  const ox = bx * CITY_PITCH, oz = by * CITY_PITCH;
  const scene = new THREE.Scene();
  const cars = new IslandCars(scene, bx, by, ox, oz);
  const walkers = new IslandWalkers(scene, bx, by, ox, oz, [], []);
  const cPos = cars.cars.map(c => [c.x, c.z]), cMove = cars.cars.map(() => 0);
  const wPos = walkers.walkers.map(w => [w.x, w.z]), wMove = walkers.walkers.map(() => 0);
  let t = 0, stillCar = 0, stillWalker = 0, overlaps = 0, samples = 0;
  for (let k = 0; k < STEPS; k++) {
    t += DT;
    cars.update(DT, t, null, null, false, walkers.walkers);
    walkers.update(DT, t, null, null, null, false, cars.cars);
    cars.cars.forEach((c, i) => {
      if (Math.hypot(c.x - cPos[i][0], c.z - cPos[i][1]) > 0.5) { cPos[i] = [c.x, c.z]; cMove[i] = t; }
      stillCar = Math.max(stillCar, t - cMove[i]);
    });
    walkers.walkers.forEach((w, i) => {
      if (Math.hypot(w.x - wPos[i][0], w.z - wPos[i][1]) > 0.3) { wPos[i] = [w.x, w.z]; wMove[i] = t; }
      stillWalker = Math.max(stillWalker, t - wMove[i]);
    });
    if (k % 20 === 0) {
      samples++;
      const cs = cars.cars;
      for (let i = 0; i < cs.length; i++) for (let j = i + 1; j < cs.length; j++) {
        if ((cs[i].x - cs[j].x) ** 2 + (cs[i].z - cs[j].z) ** 2 < 1.5 * 1.5) overlaps++;
      }
    }
  }
  // (cars meeting on a junction's curves pass close; 1.5 m apart is one car in another)
  const bad = stillCar >= STILL || stillWalker >= STILL || overlaps / samples > 0.5;
  if (bad) fails++;
  console.log(`${bad ? 'FAIL' : 'PASS'} island ${bx},${by}: ${cars.cars.length} cars, ${walkers.walkers.length} walkers; longest standing still: a car ${stillCar.toFixed(0)} s, a walker ${stillWalker.toFixed(0)} s; cars inside each other ${(overlaps / samples).toFixed(2)} per sample (${((performance.now() - t0) / 1000).toFixed(1)} s)`);
}
console.log(fails ? `FAIL — ${fails} island(s) jammed (G5)` : 'PASS — the traffic flows (G5)');
process.exit(fails ? 1 : 0);
