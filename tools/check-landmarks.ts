// G16 check: every island has its places to take things to — hospitals, a
// prison, repair shops, a recycling depot and the police pier — each where
// the kid can reach it and stop:
//   · every island that has a town has ≥2 hospitals, a prison, a repair
//     shop and a depot; every island a police pier;
//   · no two landmarks on one lot or within LANDMARK_GAP of each other;
//   · each building's door is in a lane of its street (3.5 m off the
//     centre line), mid-block, clear of level crossings and the river, and
//     the street route reaches it from the island's spawn street;
//   · the pier's door is open water: off the land, the pier and its boats;
//   · the pick is the same every time (a pure function of the plan).
//   npx tsx tools/check-landmarks.ts [seed]   (no seed: four seeds)
import './headless-dom.js';
import { spawnSync } from 'node:child_process';
import { setCityBase, isRaceIsland } from '../src/worlds/cityGrid.js';
import { graphFor } from '../src/worlds/streetGraph.js';
import { riverFor } from '../src/worlds/riverRoute.js';
import { coastFor } from '../src/worlds/coast.js';
import { landmarksFor, freshLandmarks, LANDMARK_GAP, type Landmark } from '../src/games/city/landmarks.js';
import { harbourBlocks } from '../src/games/city/harbour.js';

const arg = process.argv[2];
if (!arg) {
  // (the world's caches are per island, not per seed: one seed a process)
  let bad = 0;
  for (const s of [7, 4242, 2024, 912064659]) {
    const r = spawnSync(process.execPath, [...process.execArgv, process.argv[1], String(s)], { stdio: 'inherit' });
    if (r.status !== 0) bad++;
  }
  console.log(bad ? `landmarks: FAIL on ${bad} seed(s) (G16)` : 'landmarks: PASS — every island has its hospitals, prison, repair shops, depot and pier, each reachable (G16)');
  process.exit(bad ? 1 : 0);
}
const seed = Number(arg);
setCityBase(seed);
let fails = 0;
const fail = (m: string): void => { fails++; if (fails < 30) console.log(`  FAIL seed ${seed} ${m}`); };
const ISLANDS: Array<[number, number]> = [[0, 0], [1, 0], [2, 0], [0, 1], [1, 1], [2, 1], [0, 2], [1, 2], [2, 2]];
for (const [bx, by] of ISLANDS) {
  const L = landmarksFor(bx, by);
  const at = `(${bx},${by})`;
  const count = (k: Landmark['kind']): number => L.filter(l => l.kind === k).length;
  if (count('pier') !== 1) fail(`${at}: ${count('pier')} police piers`);
  if (!isRaceIsland(bx, by)) {
    if (count('hospital') < 2) fail(`${at}: ${count('hospital')} hospitals`);
    for (const k of ['prison', 'repair', 'depot'] as const) if (count(k) < 1) fail(`${at}: no ${k}`);
  }
  const g = graphFor(bx, by), river = riverFor(bx, by), coast = coastFor(bx, by);
  const built = L.filter(l => l.lot);
  for (let i = 0; i < built.length; i++) {
    for (let j = i + 1; j < built.length; j++) {
      const a = built[i], b = built[j];
      if (a.lot === b.lot) fail(`${at}: ${a.kind} and ${b.kind} share a lot`);
      else if (Math.hypot(a.x - b.x, a.z - b.z) < LANDMARK_GAP - 0.01) fail(`${at}: ${a.kind} and ${b.kind} ${Math.hypot(a.x - b.x, a.z - b.z).toFixed(0)} m apart`);
    }
  }
  // the spawn street's node: every door must be reachable from it
  const from = g.nodes.find(n => !n.mouth && n.edges.length >= 3) ?? g.nodes[0];
  for (const l of built) {
    const p = g.nearest(l.door.x, l.door.z);
    if (!p || p.edge.id !== l.edge) { fail(`${at}: ${l.kind}'s door is off its street`); continue; }
    if (Math.abs(Math.abs(p.lateral) - 3.5) > 0.3) fail(`${at}: ${l.kind}'s door ${p.lateral.toFixed(1)} m off the centre line`);
    if (p.s < 18 || p.s > p.edge.len - 18) fail(`${at}: ${l.kind}'s door ${p.s.toFixed(0)} m from a junction`);
    if (p.edge.crossings.some(c => Math.abs(c.s - p.s) < 18)) fail(`${at}: ${l.kind}'s door by a level crossing`);
    if (river.inWater(l.door.x, l.door.z)) fail(`${at}: ${l.kind}'s door in the river`);
    // (driving the door's way, the lot is on the right)
    const hx = Math.sin(l.door.heading), hz = Math.cos(l.door.heading);
    if ((l.x - l.door.x) * -hz + (l.z - l.door.z) * hx < 0) fail(`${at}: ${l.kind} isn't on the right of its door's lane`);
    if (!g.route(from.id, p.edge.a)) fail(`${at}: ${l.kind} can't be reached`);
  }
  for (const l of L.filter(l => l.kind === 'pier')) {
    if (coast.inLand(l.door.x, l.door.z, -6)) fail(`${at}: the police pier's door is on land`);
    if (harbourBlocks(bx, by, l.door.x, l.door.z, 3)) fail(`${at}: the police pier's door is in the harbour`);
  }
}
// determinism: a second pick (fresh) is the same
{
  for (const [bx, by] of ISLANDS) {
    const a = JSON.stringify(landmarksFor(bx, by).map(l => [l.kind, l.x, l.z, l.door]));
    const b = JSON.stringify(freshLandmarks(bx, by).map(l => [l.kind, l.x, l.z, l.door]));
    if (a !== b) fail(`(${bx},${by}): the landmarks differ between two picks`);
  }
}
console.log(fails ? `  seed ${seed}: ${fails} failure(s)` : `  seed ${seed}: ok`);
process.exit(fails ? 1 : 0);
