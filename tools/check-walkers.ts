// Walker safety check — the executable half of G8: nobody can be run over.
// Drives a vehicle (the fire truck's footprint, at a kart's 15 m/s) down
// every street of a few islands, both ways, in both lanes and along both
// sidewalks (where the walkers are), stepping the island's real crowd
// (island/walkers.ts) at 60 fps, and fails if any walker is ever inside the
// footprint, or a walker the vehicle displaced ever stands on a lot, in the
// river or in the sea.
// Run: npx tsx tools/check-walkers.ts [baseSeed]
import * as THREE from 'three';
import { setCityBase, CITY_PITCH } from '../src/worlds/cityGrid.js';
import { graphFor } from '../src/worlds/streetGraph.js';
import { occupancyFor, LOT, RIVER, SEA } from '../src/worlds/grid.js';
import { IslandWalkers, type Threat } from '../src/games/city/island/walkers.js';

const base = Number(process.argv[2] ?? 7) | 0;
setCityBase(base);
const HALF_L = 3.3, HALF_W = 1.15; // the fire truck (player.ts: glbLen 6.6, halfW 1.15)
const V = 15;
const DT = 1 / 60;
let fails = 0;

for (const [bx, by] of [[1, 0], [0, 1], [2, 2]] as const) {
  const t0 = performance.now();
  const ox = bx * CITY_PITCH, oz = by * CITY_PITCH;
  const g = graphFor(bx, by);
  const occ = occupancyFor(bx, by);
  const crowd = new IslandWalkers(new THREE.Scene(), bx, by, ox, oz, [], []);
  let inside = 0, offGround = 0, frames = 0, encounters = 0, t = 0;
  const met = new Set<number>();
  for (const e of g.edges) {
    for (const dir of [1, -1] as const) {
      for (const lane of [3.5, 8.8]) {
        met.clear();
        // drive a -> b (dir 1) or b -> a in the right-hand lane / sidewalk
        for (let s = 0; s <= e.len; s += V * DT) {
          const along = dir > 0 ? s : e.len - s;
          const p = g.sample(e, along, dir * lane);
          const th: Threat = {
            x: ox + p.x, z: oz + p.z, heading: Math.atan2(e.ux * dir, e.uz * dir), v: V,
            halfL: HALF_L, halfW: HALF_W,
          };
          t += DT;
          frames++;
          crowd.update(DT, t, null, th, null, false);
          const fx = Math.sin(th.heading), fz = Math.cos(th.heading);
          crowd.walkers.forEach((w, k) => {
            const dx = w.x - th.x, dz = w.z - th.z;
            if (dx * dx + dz * dz > 100) return;
            const a = dx * fx + dz * fz, l = dx * fz - dz * fx;
            if (Math.abs(a) < HALF_L + 3 && Math.abs(l) < HALF_W + 3 && !met.has(k)) { met.add(k); encounters++; }
            if (Math.abs(a) < HALF_L + 0.3 && Math.abs(l) < HALF_W + 0.3) {
              if (inside++ < 5) console.log(`  inside: island ${bx},${by} edge ${e.id} walker ${k} a=${a.toFixed(2)} l=${l.toFixed(2)}`);
            }
            if (Math.hypot(w.fx, w.fz) > 0.5 && occ.claims(w.x - ox, w.z - oz, 0, LOT | RIVER | SEA)) {
              if (offGround++ < 5) console.log(`  off ground: island ${bx},${by} walker ${k} at ${(w.x - ox).toFixed(1)},${(w.z - oz).toFixed(1)}`);
            }
          });
        }
      }
    }
  }
  const ok = inside === 0 && offGround === 0 && encounters > 0;
  if (!ok) fails++;
  console.log(`${ok ? 'PASS' : 'FAIL'} island ${bx},${by}: ${crowd.walkers.length} walkers, ${frames} frames, ${encounters} close encounters, `
    + `${inside} inside the footprint, ${offGround} pushed off the ground (${((performance.now() - t0) / 1000).toFixed(1)} s)`);
}
console.log(fails ? `FAIL — ${fails} island(s)` : 'PASS — nobody was run over (G8)');
process.exit(fails ? 1 : 0);
