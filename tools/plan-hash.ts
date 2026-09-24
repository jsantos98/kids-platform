// Plan fingerprint — proves a refactor changed nothing about the generated
// world. Hashes a canonical dump of every city plan + railway for a set of
// seeds; run it before and after a "no visible change" refactor and compare.
// Run: npx tsx tools/plan-hash.ts [--dump dir] [seed ...]
import { createHash } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { setCityBase } from '../src/worlds/cityGrid.js';
import { cityPlanFor, clearCityPlanCache } from '../src/worlds/cityPlan.js';
import { railRouteFor, clearRailCache } from '../src/worlds/railRoute.js';
import { clearOccupancyCache } from '../src/worlds/grid.js';
import { clearRiverCache } from '../src/worlds/riverRoute.js';

const W = 14;
const args = process.argv.slice(2);
let dumpDir: string | null = null;
const seeds: number[] = [];
for (let k = 0; k < args.length; k++) {
  if (args[k] === '--dump') dumpDir = args[++k];
  else seeds.push(Number(args[k]) | 0);
}
if (!seeds.length) seeds.push(7, 777, 4242, 2024, 9999, 3, 21, 5);

const f2 = (v: number): string => v.toFixed(2);

/** a crossing's street direction as 'h' (runs along x) / 'v' (along z) —
 * derived from whichever representation the Crossing type carries */
function crossDir(c: Record<string, unknown>): string {
  if (typeof c.axis === 'string') return c.axis;
  const h = c.heading as number;
  return Math.abs(Math.sin(h)) > 0.5 ? 'h' : 'v';
}

function dumpCity(bx: number, by: number): string {
  const plan = cityPlanFor(bx, by);
  const rail = railRouteFor(bx, by);
  const out: string[] = [`city ${bx},${by} seed ${plan.seed}`];
  const segs: string[] = [];
  for (let j = 0; j <= W; j++) for (let i = 0; i < W; i++) if (plan.segH(j, i)) segs.push(`h${j},${i}`);
  for (let i = 0; i <= W; i++) for (let j = 0; j < W; j++) if (plan.segV(i, j)) segs.push(`v${i},${j}`);
  out.push('segs ' + segs.join(' '));
  const nodes: string[] = [];
  for (let i = 0; i <= W; i++) for (let j = 0; j <= W; j++) {
    if (plan.signalized(i, j)) nodes.push(`L${i},${j}`);
    if (plan.plaza(i, j)) nodes.push(`P${i},${j}`);
  }
  out.push('nodes ' + nodes.join(' '));
  const dist: string[] = [];
  for (let cx = 0; cx < W; cx++) for (let cz = 0; cz < W; cz++) dist.push(plan.district(cx, cz)[0] + plan.district(cx, cz)[1]);
  out.push('districts ' + dist.join(''));
  out.push('exits ' + JSON.stringify(plan.exits));
  out.push('crossings ' + plan.crossings.map(c => `${f2(c.x)},${f2(c.z)},${crossDir(c as unknown as Record<string, unknown>)},${f2(c.d)}`).join(' '));
  out.push('bridges ' + plan.riverBridges.map(b => `${f2(b.x)},${f2(b.z)},${b.axis},${b.exit ? 1 : 0}`).join(' '));
  out.push('stations ' + plan.stations.map(s => `${f2(s.x)},${f2(s.z)},${f2(s.d)}`).join(' '));
  const lots: string[] = [];
  for (let cx = 0; cx < W; cx++) for (let cz = 0; cz < W; cz++) {
    for (const l of plan.lots(cx, cz)) lots.push(`${l.kind[0]}${f2(l.x)},${f2(l.z)},${f2(l.w)},${f2(l.d)}`);
  }
  out.push('lots ' + lots.join(' '));
  out.push(`rail ${f2(rail.total)} ` + rail.pts.map(p => `${f2(p.x)},${f2(p.z)}`).join(' '));
  return out.join('\n');
}

for (const seed of seeds) {
  setCityBase(seed);
  clearCityPlanCache(); clearRailCache(); clearOccupancyCache(); clearRiverCache();
  const parts: string[] = [];
  for (const [bx, by] of [[0, 0], [1, 0], [0, 1], [-1, -1], [2, -1]] as Array<[number, number]>) parts.push(dumpCity(bx, by));
  const text = parts.join('\n');
  const hash = createHash('sha256').update(text).digest('hex').slice(0, 16);
  console.log(`seed ${seed}: ${hash}`);
  if (dumpDir) {
    mkdirSync(dumpDir, { recursive: true });
    writeFileSync(`${dumpDir}/seed-${seed}.txt`, text);
  }
}
