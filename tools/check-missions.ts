// G2 check: a call belongs to the island it stands on, so crossing to another
// island brings that island's own calls. For every kind of call, over several
// crossings (east, south, west, north) between islands:
//  · the old island's calls are gone the moment the kid arrives (three of
//    them used to stay behind, 3 km off, counting toward the three alive: no
//    call spawned on the new island and the guide pointed home);
//  · three new calls spawn, every one standing on the new island;
//  · the first is near and ahead of the arrival (100–200 m out, as the very
//    first call of a game is) and none closer than MIN_CALL_DIST.
//   npx tsx tools/check-missions.ts [baseSeed]
(globalThis as unknown as { location: { search: string } }).location = { search: '' };
import './headless-dom.js';
import * as THREE from 'three';
import { setCityBase, cityAt, CITY_PITCH } from '../src/worlds/cityGrid.js';
import { CENTER } from '../src/worlds/world.js';
import { Missions, MIN_CALL_DIST, type ObjectiveType } from '../src/games/city/missions.js';

const base = Number(process.argv.slice(2).find(a => !a.startsWith('--')) ?? 7) | 0;
setCityBase(base);
let fails = 0;
const fail = (m: string): void => { fails++; console.log('  FAIL ' + m); };

let crossings = 0;
for (const calls of [['fire', 'fire', 'cat'], ['patient'], ['breakdown'], ['trash']] as ObjectiveType[][]) {
  const m = new Missions(new THREE.Scene(), calls);
  let [bx, by] = [1, 0];
  m.setCity(bx, by, bx * CITY_PITCH, by * CITY_PITCH);
  const spawnThree = (x: number, z: number): void => { for (let i = 0; i < 3; i++) m.spawn({ x, z, heading: 0.4 }, () => {}); };
  spawnThree(bx * CITY_PITCH + CENTER, by * CITY_PITCH + CENTER);
  for (const [dx, dy] of [[1, 0], [0, 1], [-1, 0], [0, -1], [1, 0]]) {
    bx += dx; by += dy;
    // (arriving at a causeway's end: the island's middle, on its side of it)
    const ax = bx * CITY_PITCH + CENTER - dx * 400, az = by * CITY_PITCH + CENTER - dy * 400;
    m.setCity(bx, by, bx * CITY_PITCH, by * CITY_PITCH);
    crossings++;
    const label = `${calls[0]}… crossing to island ${bx},${by}`;
    if (m.objectives.length) fail(`${label}: ${m.objectives.length} call(s) of the old island still stand`);
    spawnThree(ax, az);
    if (m.objectives.length !== 3) fail(`${label}: ${m.objectives.length} calls, not 3`);
    m.objectives.forEach((o, k) => {
      const c = cityAt(o.pos.x, o.pos.z);
      if (c.bx !== bx || c.by !== by) fail(`${label}: call ${k} stands on island ${c.bx},${c.by}`);
      const d = Math.hypot(o.pos.x - ax, o.pos.z - az);
      if (d < MIN_CALL_DIST - 1) fail(`${label}: call ${k} is ${d.toFixed(0)} m from the arrival (under ${MIN_CALL_DIST})`);
      if (k === 0 && d > 260) fail(`${label}: the first call is ${d.toFixed(0)} m from the arrival`);
    });
  }
}
console.log(`${crossings} crossings: the old calls go, three new ones stand on the new island`);
console.log(fails ? `FAIL — ${fails} problem(s) with the calls across islands (G2)` : 'PASS — crossing to another island brings that island\'s own calls (G2)');
process.exit(fails ? 1 : 0);
