// World-rules audit — the executable half of AGENTS.md.
// Run: npx tsx tools/audit-world.ts [baseSeed]
// Every check maps to a rule in AGENTS.md; a FAIL means the change that
// caused it must be fixed before commit.
import { setCityBase, citySeed, streetLinesFor } from '../src/worlds/cityGrid.js';
import { cityPlanFor, clearCityPlanCache } from '../src/worlds/cityPlan.js';
import { railRouteFor, clearRailCache } from '../src/worlds/railRoute.js';
import { occupancyFor, clearOccupancyCache, ROAD, RAIL, RIVER, LOT, PLAZA, SEA, DECK } from '../src/worlds/grid.js';
import { clearCoastCache } from '../src/worlds/coast.js';
import { clearRiverCache, riverFor } from '../src/worlds/riverRoute.js';
import { cityRoadPieces, pieceRect, segmentPieces, nodeReach } from '../src/worlds/roadLayout.js';
import { graphFor, clearGraphCache } from '../src/worlds/streetGraph.js';
import { clearStreetLineCache } from '../src/worlds/streetLines.js';

const clearAllWorldCaches = (): void => {
  clearCityPlanCache();
  clearRailCache();
  clearOccupancyCache();
  clearRiverCache();
  clearGraphCache();
  clearStreetLineCache();
  clearCoastCache();
};

const W = 14;
/** the crossing's street runs east-west */
const horizCross = (c: { heading: number }): boolean => Math.abs(Math.sin(c.heading)) > 0.5;
const ISLAND = 14 * 64; // city side length in metres
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
let seaBuiltTotal = 0;
let seaRoadTotal = 0;
let foldTotal = 0;
let strayNodes = 0;
let bareCrossings = 0;
let selfOverlap = 0;
let riverFails = 0;
let worstTrestleSkew = 0;
let roadOverlaps = 0;
let graphFaults = 0;
let roadGaps = 0;

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
    const streetH = c.heading;
    const ux = Math.sin(streetH), uz = Math.cos(streetH);
    let worst = 0;
    for (const p of route.pts) {
      // across the street (normal distance) and along it, from the crossing
      const pd = Math.abs((p.x - c.x) * uz - (p.z - c.z) * ux);
      if (pd >= 6.5) continue;
      if (Math.abs((p.x - c.x) * ux + (p.z - c.z) * uz) >= 24) continue;
      let dev = Math.abs(p.h - streetH);
      if (dev > Math.PI) dev = Math.PI * 2 - dev;
      while (dev > Math.PI / 2) dev = Math.PI - dev;
      worst = Math.max(worst, Math.abs(90 - (dev * 180) / Math.PI));
    }
    const perpErrDeg = worst;
    if (perpErrDeg > 8) {
      console.log(`  R7 detail: city ${bx},${by} crossing at (${c.x.toFixed(0)},${c.z.toFixed(0)}) street heading ${(c.heading * 180 / Math.PI).toFixed(0)} deviates ${perpErrDeg.toFixed(1)} deg`);
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


  // R1b: ONE connected street web — the R22/R22b vetoes used to strand
  // little "private" roads away from the network
  {
    const adj = new Map<string, Set<string>>();
    const link = (i: number, j: number, ni: number, nj: number): void => {
      const k = `${i},${j}`;
      if (!adj.has(k)) adj.set(k, new Set());
      adj.get(k)!.add(`${ni},${nj}`);
    };
    for (let j = 0; j <= W; j++) for (let i = 0; i < W; i++) if (plan.segH(j, i)) { link(i, j, i + 1, j); link(i + 1, j, i, j); }
    for (let i = 0; i <= W; i++) for (let j = 0; j < W; j++) if (plan.segV(i, j)) { link(i, j, i, j + 1); link(i, j + 1, i, j); }
    const seen = new Set<string>();
    const comps: number[] = [];
    for (const n0 of adj.keys()) {
      if (seen.has(n0)) continue;
      let size = 0;
      const q = [n0];
      seen.add(n0);
      while (q.length) {
        const cur = q.pop()!; size++;
        for (const nx of adj.get(cur) ?? []) if (!seen.has(nx)) { seen.add(nx); q.push(nx); }
      }
      comps.push(size);
    }
    comps.sort((a, b) => b - a);
    for (let k = 1; k < comps.length; k++) strayNodes += comps[k];
  }

  // R10b: every rail x open-street crossing carries a recorded crossing —
  // no barrierless bumps where the track meets asphalt. A rail vertex
  // pinned exactly ON the street line counts as a crossing too (the
  // deformers land pins dead-centre; a strict sign test misses those).
  {
    const pts = route.pts;
    for (let k = 0; k < pts.length; k++) {
      const p = pts[k], q = pts[(k + 1) % pts.length];
      for (let j = 0; j <= W; j++) {
        const c = j * 64;
        if (p.z !== q.z && (p.z - c) * (q.z - c) <= 0) {
          const t = (c - p.z) / (q.z - p.z);
          const x = p.x + (q.x - p.x) * t, i = Math.floor(x / 64);
          if (plan.segH(j, i) && !plan.crossings.some(cc =>
            horizCross(cc) && Math.abs(cc.x - x) < 4 && Math.abs(cc.z - c) < 4)) bareCrossings++;
        }
      }
      for (let i = 0; i <= W; i++) {
        const c = i * 64;
        if (p.x !== q.x && (p.x - c) * (q.x - c) <= 0) {
          const t = (c - p.x) / (q.x - p.x);
          const z = p.z + (q.z - p.z) * t, j = Math.floor(z / 64);
          if (plan.segV(i, j) && !plan.crossings.some(cc =>
            !horizCross(cc) && Math.abs(cc.z - z) < 4 && Math.abs(cc.x - c) < 4)) bareCrossings++;
        }
      }
    }
  }

  // R26: the river spans shore to shore, lives inside one N-S lane (never
  // crossing or riding beneath a N-S street), and flows due south across
  // every E-W street line so bridges meet it at a right angle
  {
    const river = riverFor(citySeed(bx, by));
    let zmin = Infinity, zmax = -Infinity, laneMin = Infinity, hDev = 0;
    for (const p of river.pts) {
      zmin = Math.min(zmin, p.z); zmax = Math.max(zmax, p.z);
      laneMin = Math.min(laneMin, Math.abs(p.x - Math.round(p.x / 64) * 64));
      const jn = Math.round(p.z / 64);
      if (jn >= 1 && jn <= 13 && Math.abs(p.z - jn * 64) < 8) {
        hDev = Math.max(hDev, Math.abs(p.h) > Math.PI / 2 ? Math.PI - Math.abs(p.h) : Math.abs(p.h));
      }
    }
    if (zmin > 0 || zmax < ISLAND || laneMin < 12 || (hDev * 180) / Math.PI > 12) {
      riverFails++;
      console.log(`  R26 detail: city ${bx},${by} z ${zmin.toFixed(0)}..${zmax.toFixed(0)}, lane margin ${laneMin.toFixed(1)} m, street-crossing flow dev ${(hDev * 180 / Math.PI).toFixed(1)} deg`);
    }
    // R27: trestles meet the water at a right angle too
    let skew = 0;
    for (const p of route.pts) {
      if (!river.inWater(p.x, p.z)) continue;
      const near = river.path.nearest(p.x, p.z);
      const nx = river.pts[near.i].h + Math.PI / 2;
      let d = Math.abs(p.h - nx) % Math.PI;
      if (d > Math.PI / 2) d = Math.PI - d;
      skew = Math.max(skew, (d * 180) / Math.PI);
    }
    if (skew > 30) console.log(`  R27 detail: city ${bx},${by} trestle skew ${skew.toFixed(1)} deg near (${route.pts.find(p => river.inWater(p.x, p.z))?.x.toFixed(0)},${route.pts.find(p => river.inWater(p.x, p.z))?.z.toFixed(0)})`);
    worstTrestleSkew = Math.max(worstTrestleSkew, skew);
  }

  // R35: road pieces never overlap, and together they cover every open
  // street segment end to end (node pad reach + straights = 64 m)
  {
    const pieces = cityRoadPieces(plan);
    const rects = pieces.map(pieceRect);
    for (let a = 0; a < rects.length; a++) {
      for (let b = a + 1; b < rects.length; b++) {
        const ox = Math.min(rects[a].x2, rects[b].x2) - Math.max(rects[a].x1, rects[b].x1);
        const oz = Math.min(rects[a].z2, rects[b].z2) - Math.max(rects[a].z1, rects[b].z1);
        if (ox > 0.05 && oz > 0.05) {
          roadOverlaps++;
          if (roadOverlaps <= 3) console.log(`  R35 detail: city ${bx},${by} ${pieces[a].kind}@(${pieces[a].x.toFixed(0)},${pieces[a].z.toFixed(0)}) overlaps ${pieces[b].kind}@(${pieces[b].x.toFixed(0)},${pieces[b].z.toFixed(0)})`);
        }
      }
    }
    const cover = (horiz: boolean, line: number, k: number): void => {
      const [ia, ja, ib, jb] = horiz ? [k, line, k + 1, line] : [line, k, line, k + 1];
      const len = segmentPieces(plan, horiz, line, k).reduce((s, p) => s + p.lx, 0);
      if (Math.abs(len + nodeReach(plan, ia, ja) + nodeReach(plan, ib, jb) - 64) > 0.05) roadGaps++;
    };
    for (let j = 0; j <= W; j++) for (let i = 0; i < W; i++) if (plan.segH(j, i)) cover(true, j, i);
    for (let i = 0; i <= W; i++) for (let j = 0; j < W; j++) if (plan.segV(i, j)) cover(false, i, j);
  }

  // G-graph: the street graph mirrors the plan — one edge per open segment,
  // every level crossing seated on an edge, one connected piece, and the
  // only dead ends are causeway mouths
  {
    const g = graphFor(bx, by);
    let segs = 0;
    for (let j = 0; j <= W; j++) for (let i = 0; i < W; i++) if (plan.segH(j, i)) segs++;
    for (let i = 0; i <= W; i++) for (let j = 0; j < W; j++) if (plan.segV(i, j)) segs++;
    const seated = g.edges.reduce((n, e) => n + e.crossings.length, 0);
    const seen = new Set<number>([0]);
    const stack = [0];
    while (stack.length) {
      const n = stack.pop()!;
      for (const eid of g.nodes[n]?.edges ?? []) {
        const o = g.other(g.edges[eid], n).id;
        if (!seen.has(o)) { seen.add(o); stack.push(o); }
      }
    }
    const tips = g.nodes.filter(n => n.edges.length === 1 && !n.mouth).length;
    const faults = (g.edges.length !== segs ? 1 : 0) + (seated !== plan.crossings.length ? 1 : 0)
      + (g.nodes.length && seen.size !== g.nodes.length ? 1 : 0) + tips;
    if (faults) console.log(`  graph detail: city ${bx},${by} edges ${g.edges.length}/${segs}, crossings seated ${seated}/${plan.crossings.length}, reached ${seen.size}/${g.nodes.length}, stray tips ${tips}`);
    graphFaults += faults;
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
    if ((b & LOT) && (b & (ROAD | RAIL | RIVER | PLAZA))) lotClashTotal++;
    // R29: the sea carries nothing built but the causeway decks
    if ((b & SEA) && (b & (LOT | RAIL | PLAZA))) seaBuiltTotal++;
    if ((b & SEA) && (b & ROAD) && !(b & DECK)) seaRoadTotal++;
  }
}

// R28: different parts of the loop never overlap — two non-adjacent
// stretches of track closer than the bed width read as one mangled double
// track (needle folds the de-overlapper exists to splice out). Cheap
// (rail routes only), so it runs over a much wider city ring than the
// rest of the audit.
for (let wx = -4; wx <= 4; wx++) for (let wy = -4; wy <= 4; wy++) {
  const route = railRouteFor(wx, wy);
  const rpts = route.pts, RN = rpts.length;
  const cell = 8;
  const cum: number[] = [0];
  for (let k = 1; k <= RN; k++) {
    const a = rpts[k - 1], b = rpts[k % RN];
    cum.push(cum[k - 1] + Math.hypot(b.x - a.x, b.z - a.z));
  }
  const total = cum[RN];
  const grid = new Map<string, number[]>();
  for (let k = 0; k < RN; k++) {
    const kk = `${Math.floor(rpts[k].x / cell)},${Math.floor(rpts[k].z / cell)}`;
    if (!grid.has(kk)) grid.set(kk, []);
    grid.get(kk)!.push(k);
  }
  for (let k = 0; k < RN; k++) {
    const gx = Math.floor(rpts[k].x / cell), gz = Math.floor(rpts[k].z / cell);
    for (let ox = -1; ox <= 1; ox++) for (let oz = -1; oz <= 1; oz++) {
      const arr = grid.get(`${gx + ox},${gz + oz}`);
      if (!arr) continue;
      for (const m of arr) {
        const darc = Math.abs(cum[k] - cum[m]);
        const sep = Math.min(darc, total - darc);
        if (sep < 14) continue; // neighbours along the loop
        const d = Math.hypot(rpts[m].x - rpts[k].x, rpts[m].z - rpts[k].z);
        if (d < 3.6) selfOverlap++; // beds are 3.4 m wide: closer means they intersect
      }
    }
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
if (seaBuiltTotal > 0) fail('R29', `${seaBuiltTotal} lot/rail/plaza cells stand in the sea`);
if (seaRoadTotal > 0) fail('R29', `${seaRoadTotal} street cells run out over the sea off the causeway decks`);
if (lotClashTotal > 0) fail('R23', `${lotClashTotal} lot cells overlap street/track/water/plaza`);
if (foldTotal > 0) fail('R24', `${foldTotal} hairpin folds — the railway doubles back on itself`);
if (strayNodes > 0) fail('R1', `${strayNodes} nodes on disconnected "private" roads — the island web must be one piece`);
if (bareCrossings > 0) fail('R10', `${bareCrossings} rail x road crossings have no barriers recorded`);
if (selfOverlap > 0) fail('R28', `${selfOverlap} rail samples overlap a different part of the loop (beds on beds)`);
if (riverFails > 0) fail('R26', `${riverFails} cities violate the river rules (shore-to-shore, inside one lane, perpendicular street crossings)`);
if (worstTrestleSkew > 30) fail('R27', `trestle meets the water at ${worstTrestleSkew.toFixed(1)} deg off perpendicular`);
if (roadOverlaps > 0) fail('R35', `${roadOverlaps} pairs of road pieces overlap`);
if (graphFaults > 0) fail('R1', `${graphFaults} street-graph faults (edges/crossings/connectivity/dead ends disagree with the plan)`);
if (roadGaps > 0) fail('R35', `${roadGaps} street segments not covered end to end by road pieces`);

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
  `grid clashes ${railRiverRoadTotal}/${lotClashTotal}, folds ${foldTotal}, strays ${strayNodes}, bare crossings ${bareCrossings}, river fails ${riverFails}, trestle skew ${worstTrestleSkew.toFixed(1)} deg, ` +
  `road overlaps ${roadOverlaps}, road gaps ${roadGaps}`);
if (failures === 0) {
  console.log('PASS — all world rules hold');
} else {
  console.log(`FAIL — ${failures} rule violation(s); see AGENTS.md`);
  process.exitCode = 1;
}
