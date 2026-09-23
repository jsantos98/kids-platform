// World-rules audit — the executable half of AGENTS.md.
// Run: npx tsx tools/audit-world.ts [baseSeed]
// Every check maps to a rule in AGENTS.md; a FAIL means the change that
// caused it must be fixed before commit.
import { setCityBase, citySeed, streetLinesFor } from '../src/worlds/cityGrid.js';
import { cityPlanFor, clearCityPlanCache } from '../src/worlds/cityPlan.js';
import { railRouteFor, clearRailCache } from '../src/worlds/railRoute.js';
import { occupancyFor, clearOccupancyCache, ROAD, RAIL, RIVER, LOT, PLAZA, TRAM } from '../src/worlds/grid.js';
import { clearRiverCache } from '../src/worlds/riverRoute.js';

const clearAllWorldCaches = (): void => {
  clearCityPlanCache();
  clearRailCache();
  clearOccupancyCache();
  clearRiverCache();
};

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
let railRiverRoadTotal = 0;
let lotClashTotal = 0;
let foldTotal = 0;

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

  // R7: every recorded crossing is square; R10: some crossings exist.
  // Squareness reads the rail's worst angle to the street WHILE ON ITS
  // asphalt near the crossing — the nearest-vertex reading misses a
  // diagonal chord that only tilts between wall-end vertices.
  for (const c of plan.crossings) {
    crossingsTotal++;
    const streetH = c.axis === 'h' ? Math.PI / 2 : 0;
    let worst = 0;
    for (const p of route.pts) {
      const pd = c.axis === 'h' ? Math.abs(p.z - c.z) : Math.abs(p.x - c.x);
      if (pd >= 6.5) continue;
      const pa = c.axis === 'h' ? p.x : p.z;
      if (Math.abs(pa - (c.axis === 'h' ? c.x : c.z)) >= 24) continue;
      let dev = Math.abs(p.h - streetH);
      if (dev > Math.PI) dev = Math.PI * 2 - dev;
      while (dev > Math.PI / 2) dev = Math.PI - dev;
      worst = Math.max(worst, Math.abs(90 - (dev * 180) / Math.PI));
    }
    const perpErrDeg = worst;
    if (perpErrDeg > 8) {
      console.log(`  R7 detail: city ${bx},${by} crossing at (${c.x.toFixed(0)},${c.z.toFixed(0)}) axis ${c.axis} deviates ${perpErrDeg.toFixed(1)} deg`);
    }
    worstDevDeg = Math.max(worstDevDeg, perpErrDeg);
  }

  // R8: no near-parallel rail run inside the road corridor (d < 7 m for
  // >= 8 m with the rail headed along the road — square crossings excluded;
  // 8 m of rail on asphalt is already an eye-catching brush)
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
        if (run >= 8) {
          railOnRoadSegs++;
          worstRide = Math.max(worstRide, run);
          console.log(`  R8 detail: city ${bx},${by} ${horiz ? 'h' : 'v'} line at ${c0}, ride from x=${horiz ? a + (t - run) : c0} z=${horiz ? c0 : a + (t - run)} (run ${run} m)`);
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

  // R24: the railway is one continuous welded loop — no hairpin folds where
  // the shipped path doubles straight back on itself (deformation's worst
  // mode; the tiles mitre vertex-to-vertex, so a fold is the one way the
  // track can stop reading as connected). A ~150-degree U-turn smeared over
  // 3-4 vertices turns <90 degrees per vertex, so also fail any >120-degree
  // heading swing across a tight window — square crossing walls never do it.
  const rpts = route.pts, RN = rpts.length;
  for (let k = 0; k < RN; k++) {
    const a = rpts[(k - 1 + RN) % RN], b = rpts[k], c = rpts[(k + 1) % RN];
    const l1 = Math.hypot(b.x - a.x, b.z - a.z), l2 = Math.hypot(c.x - b.x, c.z - b.z);
    if (l1 < 0.5 || l2 < 0.5) continue;
    if ((c.x - b.x) * (b.x - a.x) + (c.z - b.z) * (b.z - a.z) < 0) foldTotal++;
  }
  for (let k = 0; k < RN; k++) {
    const a = rpts[k], b = rpts[(k + 3) % RN];
    if (Math.hypot(b.x - a.x, b.z - a.z) > 12) continue;
    let dh = b.h - a.h;
    while (dh > Math.PI) dh -= Math.PI * 2;
    while (dh < -Math.PI) dh += Math.PI * 2;
    if (Math.abs(dh) > (120 * Math.PI) / 180) foldTotal++;
  }

  // R22/R23: occupancy-grid combination invariants. The grid paints every
  // generator's output into one 1 m bitmask map — the audit proves the
  // forbidden combinations never occur anywhere in the city:
  //   ROAD|RAIL|RIVER — a trestle sharing the water with a road bridge
  //   LOT over anything built/wet — a building or yard on street/track/water
  const occ = occupancyFor(bx, by);
  const raw = occ.raw;
  for (let i = 0; i < raw.length; i++) {
    const b = raw[i];
    if ((b & ROAD) && (b & RAIL) && (b & RIVER)) railRiverRoadTotal++;
    if ((b & LOT) && (b & (ROAD | RAIL | RIVER | PLAZA | TRAM))) lotClashTotal++;
  }
}

if (deadEnds > 0) fail('R1', `${deadEnds} street tips end in open space`);
if (exitGaps > 0) fail('R19', `${exitGaps} causeway corridors do not reach the rim`);
if (corridorsUnattached > 0) fail('R19', `${corridorsUnattached} causeway corridors never meet the street web`);
if (crossingsTotal === 0) fail('R10', 'no level crossings found in any audited city');
if (worstDevDeg > 25) fail('R7', `crossing deviates ${worstDevDeg.toFixed(1)} deg from square`);
if (railOnRoadSegs > 0) fail('R8', `rail rides the road on ${railOnRoadSegs} segments (longest ${worstRide} m)`);
if (worstLot < 15.5) fail('R9', `lot centre only ${worstLot.toFixed(1)} m from the rail`);
if (railRiverRoadTotal > 0) fail('R22', `${railRiverRoadTotal} rail+river+road cells — a trestle shares the water with a road bridge`);
if (lotClashTotal > 0) fail('R23', `${lotClashTotal} lot cells overlap street/track/water/plaza`);
if (foldTotal > 0) fail('R24', `${foldTotal} hairpin folds — the railway doubles back on itself`);

// R25: neighbouring base seeds must produce significantly DIFFERENT cities.
// The hash tail used to leave adjacent integers partially correlated, and
// the fixed macro layout (same line odds, same corner biomes, same ring
// band) made every roll read alike. Thresholds sit far above measured
// cross-seed values (lineJ 0.29-0.81, segJ 0.18-0.63, districtJ 0.36-0.62,
// railNN 33-88 m) and far below clone values (1/1/1/0 m).
const jac = (a: Set<string>, b: Set<string>): number => {
  let inter = 0;
  for (const x of a) if (b.has(x)) inter++;
  return inter / (a.size + b.size - inter || 1);
};
const fingerprint = (bx: number, by: number) => {
  const { H, V } = streetLinesFor(bx, by);
  const plan = cityPlanFor(bx, by);
  const route = railRouteFor(bx, by);
  const segs = new Set<string>();
  for (let j = 0; j <= W; j++) for (let i = 0; i < W; i++) if (plan.segH(j, i)) segs.add(`h${j},${i}`);
  for (let i = 0; i <= W; i++) for (let j = 0; j < W; j++) if (plan.segV(i, j)) segs.add(`v${i},${j}`);
  const dists = new Set<string>();
  for (let cx = 0; cx < W; cx++) for (let cz = 0; cz < W; cz++) dists.add(`${cx},${cz}:${plan.district(cx, cz)}`);
  return { H: new Set(H.map(String)), V: new Set(V.map(String)), segs, dists, rail: route.pts };
};
for (const [sa, sb] of [[baseSeed, baseSeed + 1], [baseSeed + 1, baseSeed + 2]] as Array<[number, number]>) {
  for (const [bx, by] of [[0, 0], [1, 1]] as Array<[number, number]>) {
    setCityBase(sa); clearAllWorldCaches();
    const A = fingerprint(bx, by);
    setCityBase(sb); clearAllWorldCaches();
    const B = fingerprint(bx, by);
    setCityBase(baseSeed); clearAllWorldCaches();
    const lineJ = (jac(A.H, B.H) + jac(A.V, B.V)) / 2;
    const segJ = jac(A.segs, B.segs);
    const distJ = jac(A.dists, B.dists);
    let nn = 0, cnt = 0;
    for (let k = 0; k < A.rail.length; k += 5) {
      const p = A.rail[k];
      let best = Infinity;
      for (const q of B.rail) {
        const d = Math.hypot(p.x - q.x, p.z - q.z);
        if (d < best) best = d;
      }
      nn += best; cnt++;
    }
    nn /= cnt;
    if (lineJ > 0.88 || segJ > 0.75 || distJ > 0.8 || nn < 15) {
      fail('R25', `seeds ${sa} and ${sb} look alike on city (${bx},${by}): lineJ ${lineJ.toFixed(2)}, segJ ${segJ.toFixed(2)}, districtJ ${distJ.toFixed(2)}, railNN ${nn.toFixed(1)} m`);
    }
  }
}

console.log(`base seed ${baseSeed}: ${cells.length} cities, ${crossingsTotal} crossings, ` +
  `worst square-deviation ${worstDevDeg.toFixed(1)} deg, nearest lot ${worstLot === Infinity ? 'n/a' : worstLot.toFixed(1)} m, ` +
  `dead ends ${deadEnds}, rim gaps ${exitGaps}, unattached corridors ${corridorsUnattached}, rail-on-road ${railOnRoadSegs}, ` +
  `grid clashes ${railRiverRoadTotal}/${lotClashTotal}, folds ${foldTotal}`);
if (failures === 0) {
  console.log('PASS — all world rules hold');
} else {
  console.log(`FAIL — ${failures} rule violation(s); see AGENTS.md`);
  process.exitCode = 1;
}
