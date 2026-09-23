// World-rules audit — the executable half of AGENTS.md.
// Run: npx tsx tools/audit-world.ts [baseSeed]
// Every check maps to a rule in AGENTS.md; a FAIL means the change that
// caused it must be fixed before commit.
import { setCityBase, citySeed } from '../src/worlds/cityGrid.js';
import { cityPlanFor } from '../src/worlds/cityPlan.js';
import { railRouteFor } from '../src/worlds/railRoute.js';

const W = 14;
const baseSeed = Number(process.argv[2] ?? 4242) | 0;
setCityBase(baseSeed);

let failures = 0;
const fail = (rule: string, msg: string): void => {
  failures++;
  console.log(`FAIL [${rule}] ${msg}`);
};

// Spread of city cells around the origin — each (bx, by) is one full city.
const cells: Array<[number, number]> = [];
for (let bx = -2; bx <= 2; bx++) for (let by = -2; by <= 2; by++) {
  if ((bx + by) % 2 === 0 || Math.abs(bx) + Math.abs(by) <= 1) cells.push([bx, by]);
}

let crossingsTotal = 0;
let worstDevDeg = 0;
let worstLot = Infinity;
let deadEnds = 0;
let exitGaps = 0;
let corridorsUnattached = 0;
let railOnRoadSegs = 0;
let worstRide = 0;

for (const [bx, by] of cells) {
  const plan = cityPlanFor(bx, by);
  const route = railRouteFor(bx, by);

  // R1 + R19: no dead ends except the four causeway mouths; causeways intact
  const deg = (i: number, j: number): number =>
    (plan.segH(j, i - 1) ? 1 : 0) + (plan.segH(j, i) ? 1 : 0) +
    (plan.segV(i, j - 1) ? 1 : 0) + (plan.segV(i, j) ? 1 : 0);
  const tips = new Set([
    `${plan.exits.n},0`, `${plan.exits.s},${W}`, `0,${plan.exits.w}`, `${W},${plan.exits.e}`,
  ]);
  for (let i = 0; i <= W; i++) for (let j = 0; j <= W; j++) {
    if (deg(i, j) === 1 && !tips.has(`${i},${j}`)) deadEnds++;
  }
  for (const [vert, line, rimK] of [
    [true, plan.exits.n, 0], [true, plan.exits.s, W - 1],
    [false, plan.exits.w, 0], [false, plan.exits.e, W - 1],
  ] as Array<[boolean, number, number]>) {
    const rimOpen = vert ? plan.segV(line, rimK) : plan.segH(line, rimK);
    if (!rimOpen) { exitGaps++; continue; }
    // the corridor must meet the street web inland (a >=3-arm node on it)
    let attached = false;
    for (let k = 1; k < W; k++) {
      if ((vert ? deg(line, k) : deg(k, line)) >= 3) { attached = true; break; }
    }
    if (!attached) corridorsUnattached++;
  }

  // R7: every recorded crossing is square; R10: some crossings exist
  for (const c of plan.crossings) {
    crossingsTotal++;
    let best = route.pts[0];
    for (const q of route.pts) {
      if ((q.x - c.x) ** 2 + (q.z - c.z) ** 2 < (best.x - c.x) ** 2 + (best.z - c.z) ** 2) best = q;
    }
    const streetH = c.axis === 'h' ? Math.PI / 2 : 0;
    let dev = Math.abs(best.h - streetH);
    if (dev > Math.PI) dev = Math.PI * 2 - dev;
    while (dev > Math.PI / 2) dev = Math.PI - dev;
    const perpErrDeg = Math.abs(90 - (dev * 180) / Math.PI);
    if (perpErrDeg > 8) {
      console.log(`  R7 detail: city ${bx},${by} crossing at (${c.x.toFixed(0)},${c.z.toFixed(0)}) axis ${c.axis} deviates ${perpErrDeg.toFixed(1)} deg`);
    }
    worstDevDeg = Math.max(worstDevDeg, perpErrDeg);
  }

  // R8: no near-parallel rail run inside the road corridor (d < 7 m for
  // >= 12 m with the rail headed along the road — square crossings excluded)
  const scanSeg = (horiz: boolean, line: number, i: number): void => {
    const a = i * 64, c0 = line * 64;
    let run = 0;
    for (let t = 0; t <= 64; t += 2) {
      const x = horiz ? a + t : c0, z = horiz ? c0 : a + t;
      const h = route.headingAt(x, z);
      let dev = Math.abs(h - (horiz ? Math.PI / 2 : 0));
      if (dev > Math.PI) dev = Math.PI * 2 - dev;
      const parallel = Math.min(dev, Math.PI - dev) < Math.PI / 3;
      if (route.distTo(x, z) < 7 && parallel) {
        run += 2;
        if (run >= 12) {
          railOnRoadSegs++;
          worstRide = Math.max(worstRide, run);
          console.log(`  R8 detail: city ${bx},${by} ${horiz ? 'h' : 'v'} line at ${c0}, ride from t=${t - run} (run ${run} m)`);
          return;
        }
      } else run = 0;
    }
  };
  for (let j = 1; j < W; j++) for (let i = 0; i < W; i++) if (plan.segH(j, i)) scanSeg(true, j, i);
  for (let i = 1; i < W; i++) for (let j = 0; j < W; j++) if (plan.segV(i, j)) scanSeg(false, i, j);

  // R9: lots keep 16 m from the rail centreline (0.5 m tolerance)
  for (let cx = 0; cx < W; cx++) for (let cz = 0; cz < W; cz++) {
    for (const lot of plan.lots(cx, cz)) {
      worstLot = Math.min(worstLot, route.distTo(lot.x, lot.z));
    }
  }
}

if (deadEnds > 0) fail('R1', `${deadEnds} street tips end in open space`);
if (exitGaps > 0) fail('R19', `${exitGaps} causeway corridors do not reach the rim`);
if (corridorsUnattached > 0) fail('R19', `${corridorsUnattached} causeway corridors never meet the street web`);
if (crossingsTotal === 0) fail('R10', 'no level crossings found in any audited city');
if (worstDevDeg > 8) fail('R7', `crossing deviates ${worstDevDeg.toFixed(1)} deg from square`);
if (railOnRoadSegs > 0) fail('R8', `rail rides the road on ${railOnRoadSegs} segments (longest ${worstRide} m)`);
if (worstLot < 15.5) fail('R9', `lot centre only ${worstLot.toFixed(1)} m from the rail`);

console.log(`base seed ${baseSeed}: ${cells.length} cities, ${crossingsTotal} crossings, ` +
  `worst square-deviation ${worstDevDeg.toFixed(1)} deg, nearest lot ${worstLot === Infinity ? 'n/a' : worstLot.toFixed(1)} m, ` +
  `dead ends ${deadEnds}, rim gaps ${exitGaps}, unattached corridors ${corridorsUnattached}, rail-on-road ${railOnRoadSegs}`);
if (failures === 0) {
  console.log('PASS — all world rules hold');
} else {
  console.log(`FAIL — ${failures} rule violation(s); see AGENTS.md`);
  process.exitCode = 1;
}
