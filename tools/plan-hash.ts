// Plan fingerprint — proves a refactor changed nothing about the generated
// world. Hashes a canonical dump of every city plan + railway for a set of
// seeds; run it before and after a "no visible change" refactor and compare.
// Run: npx tsx tools/plan-hash.ts [--dump dir] [seed ...]
import { createHash } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { setCityBase } from '../src/worlds/cityGrid.js';
import { cityPlanFor, clearCityPlanCache } from '../src/worlds/cityPlan.js';
import { railNetFor, clearRailCache } from '../src/worlds/railRoute.js';
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
  const net = railNetFor(bx, by);
  const out: string[] = [`city ${bx},${by} seed ${plan.seed}`];
  out.push('nodes ' + plan.nodes.map(n => `${f2(n.x)},${f2(n.z)}${n.mouth ? 'M' : ''}${n.signalized ? 'L' : ''}${n.plaza ? 'P' : ''}`).join(' '));
  out.push('edges ' + plan.edges.map(e => `${e.a}-${e.b}${e.kind[0]}`).join(' '));
  const dist: string[] = [];
  for (let cx = 0; cx < W; cx++) for (let cz = 0; cz < W; cz++) dist.push(plan.district(cx, cz)[0] + plan.district(cx, cz)[1]);
  out.push('districts ' + dist.join(''));
  out.push('exits ' + JSON.stringify(plan.exits));
  out.push('crossings ' + plan.crossings.map(c => `${f2(c.x)},${f2(c.z)},${crossDir(c as unknown as Record<string, unknown>)},${f2(c.d)}`).join(' '));
  out.push('bridges ' + plan.riverBridges.map(b => `${f2(b.x)},${f2(b.z)},${f2(b.heading)},${b.exit ? 1 : 0}`).join(' '));
  out.push('stations ' + plan.stations.map(s => `${f2(s.x)},${f2(s.z)},${f2(s.d)}`).join(' '));
  const lots: string[] = [];
  for (let cx = 0; cx < W; cx++) for (let cz = 0; cz < W; cz++) {
    for (const l of plan.lots(cx, cz)) lots.push(`${l.kind[0]}${f2(l.x)},${f2(l.z)},${f2(l.w)},${f2(l.d)},${f2(l.ry)}`);
  }
  out.push('lots ' + lots.join(' '));
  for (const rail of net.lines) out.push(`rail ${rail.kind} ${f2(rail.total)} ` + rail.pts.map(p => `${f2(p.x)},${f2(p.z)}`).join(" "));
  return out.join('\n');
}

for (const seed of seeds) {
  setCityBase(seed);
  clearCityPlanCache(); clearRailCache(); clearOccupancyCache(); clearRiverCache();
  const parts: string[] = [];
  // the 3x3 ring around the origin plus four farther cities
  const cells: Array<[number, number]> = [[2, -1], [-2, 1], [3, 3], [-3, -2]];
  for (let bx = -1; bx <= 1; bx++) for (let by = -1; by <= 1; by++) cells.push([bx, by]);
  for (const [bx, by] of cells) parts.push(dumpCity(bx, by));
  const text = parts.join('\n');
  const hash = createHash('sha256').update(text).digest('hex').slice(0, 16);
  console.log(`seed ${seed}: ${hash}`);
  if (dumpDir) {
    mkdirSync(dumpDir, { recursive: true });
    writeFileSync(`${dumpDir}/seed-${seed}.txt`, text);
  }
}
