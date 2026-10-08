// Z-fighting check (R42): no two upward-facing surfaces of different colours
// may sit within MIN_GAP of each other where one lies over the other — they
// would flicker. The world's ground is built of thin layers by design (slab
// 0.10 – pavements and lots 0.12 – asphalt 0.14 – kerb bands 0.18 …), so the
// rule is a ladder: every layer at least MIN_GAP (3 mm: the float depth
// buffer — stage.ts reversedDepthBuffer — separates millimetres at any
// distance a frame draws) above the one it overlaps.
//  · Every chunk of four islands (a town, a river town, the race island, …),
//    two seeds: each chunk's baked ground (generateCityChunkData) is sampled
//    every 1.5 m by a ray straight down; the top surface and the ones within
//    MIN_GAP below it must all be one colour.
//  · Everything laid on or joined to them goes in the same scan: the surf foam
//    (foam.ts), the causeway decks (causewayDeck.ts), the picnic bridge
//    (bridge.ts) and the airport (airport.ts).
//  (The kit models' own layers — window glass 1 cm off a wall — are theirs.)
//   npx tsx tools/check-zfight.ts [baseSeed]
import './headless-dom.js';
import * as THREE from 'three';
import { setCityBase, CITY_PITCH } from '../src/worlds/cityGrid.js';
import { WORLD_CHUNKS } from '../src/worlds/world.js';
import { generateCityChunkData } from '../src/worlds/cityChunk.js';
import { buildAirport } from '../src/games/city/airport.js';
import { buildBridge } from '../src/games/city/bridge.js';
import { bakeFoam } from '../src/games/city/foam.js';
import { bakeCausewayDeck } from '../src/worlds/causewayDeck.js';
import { spansOf } from '../src/worlds/causeway.js';
import { Baked } from '../src/engine/baked.js';

const base = Number(process.argv.slice(2).find(a => !a.startsWith('--')) ?? 7) | 0;
/** the least gap between two overlapping layers of different colours (m) */
const MIN_GAP = 0.003;
const STEP = 1.5;
let fails = 0;
const fail = (m: string): void => { fails++; if (fails <= 40) console.log('  FAIL ' + m); };

/** a vertex colour (linear, as baked) as the sRGB hex the source wrote it in */
const srgb = (hex: number): string => [hex >> 16, (hex >> 8) & 255, hex & 255]
  .map(v => { const l = v / 255, s = l <= 0.0031308 ? 12.92 * l : 1.055 * l ** (1 / 2.4) - 0.055; return Math.round(s * 255).toString(16).padStart(2, '0'); }).join('');

interface Tri { ax: number; ay: number; az: number; bx: number; by: number; bz: number; cx: number; cy: number; cz: number; hex: number }

/** the upward-facing triangles of a non-indexed position / color pair (world offset ox, oz) */
function upTris(pos: ArrayLike<number>, col: ArrayLike<number> | null, ox: number, oz: number): Tri[] {
  const out: Tri[] = [];
  for (let i = 0; i + 8 < pos.length; i += 9) {
    const ax = pos[i] + ox, ay = pos[i + 1], az = pos[i + 2] + oz, bx = pos[i + 3] + ox, by = pos[i + 4], bz = pos[i + 5] + oz, cx = pos[i + 6] + ox, cy = pos[i + 7], cz = pos[i + 8] + oz;
    const ux = bx - ax, uy = by - ay, uz = bz - az, vx = cx - ax, vy = cy - ay, vz = cz - az;
    const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    const len = Math.hypot(nx, ny, nz);
    if (len < 1e-9 || ny / len < 0.3) continue; // (steep and downward faces aren't ground layers)
    const hex = col ? (Math.round(col[i] * 255) << 16) | (Math.round(col[i + 1] * 255) << 8) | Math.round(col[i + 2] * 255) : 0;
    out.push({ ax, ay, az, bx, by, bz, cx, cy, cz, hex });
  }
  return out;
}

/** sample the triangles' tops every STEP m; returns the conflicts by key */
function scan(tris: Tri[], x0: number, z0: number, x1: number, z1: number, into: Map<string, { n: number; at: string }>, tag: string): number {
  if (!tris.length) return 0;
  const CELL = 8, grid = new Map<number, number[]>();
  tris.forEach((t, id) => {
    for (let gx = Math.floor(Math.min(t.ax, t.bx, t.cx) / CELL); gx <= Math.floor(Math.max(t.ax, t.bx, t.cx) / CELL); gx++) {
      for (let gz = Math.floor(Math.min(t.az, t.bz, t.cz) / CELL); gz <= Math.floor(Math.max(t.az, t.bz, t.cz) / CELL); gz++) {
        const k = gx * 100003 + gz; let l = grid.get(k); if (!l) grid.set(k, l = []); l.push(id);
      }
    }
  });
  let rays = 0;
  for (let x = x0; x < x1; x += STEP) for (let z = z0; z < z1; z += STEP) {
    const px = x + 0.37 * STEP, pz = z + 0.61 * STEP; rays++;
    const l = grid.get(Math.floor(px / CELL) * 100003 + Math.floor(pz / CELL)); if (!l) continue;
    const hits: Array<{ y: number; hex: number }> = [];
    for (const id of l) {
      const t = tris[id];
      const d0 = (t.bz - t.az) * (t.cx - t.ax) - (t.bx - t.ax) * (t.cz - t.az);
      const w1 = ((pz - t.az) * (t.cx - t.ax) - (px - t.ax) * (t.cz - t.az)) / d0;
      const w2 = ((t.bz - t.az) * (px - t.ax) - (t.bx - t.ax) * (pz - t.az)) / d0;
      const w0 = 1 - w1 - w2;
      if (w0 < 1e-3 || w1 < 1e-3 || w2 < 1e-3) continue; // (a seam)
      hits.push({ y: w0 * t.ay + w1 * t.by + w2 * t.cy, hex: t.hex });
    }
    if (hits.length < 2) continue;
    hits.sort((a, b) => b.y - a.y);
    const top = hits[0];
    for (let i = 1; i < hits.length && top.y - hits[i].y < MIN_GAP; i++) {
      if (hits[i].hex === top.hex) continue;
      const key = `${srgb(top.hex)} over ${srgb(hits[i].hex)} (${(top.y - hits[i].y).toFixed(4)} m) at y ${top.y.toFixed(3)}`;
      const e = into.get(key);
      if (e) e.n++; else into.set(key, { n: 1, at: `${tag} ${px.toFixed(0)}, ${pz.toFixed(0)}` });
      break;
    }
  }
  return rays;
}

const found = new Map<string, { n: number; at: string }>();
let rays = 0, chunks = 0;

/** a Baked builder's up-facing triangles (city-local) */
function bakedTris(B: Baked): Tri[] {
  const d = B.buildData();
  return d.position ? upTris(d.position.array, d.color?.array ?? null, 0, 0) : [];
}
/** a built group's up-facing triangles (its meshes' world matrices applied) */
function groupTris(g: THREE.Group): Tri[] {
  const out: Tri[] = [];
  g.updateWorldMatrix(true, true);
  g.traverse(o => {
    const m = o as THREE.Mesh;
    if (!m.isMesh) return;
    const ng = m.geometry.index ? m.geometry.toNonIndexed() : m.geometry;
    const p = ng.attributes.position.array, c = ng.attributes.color ? ng.attributes.color.array : null;
    const e = m.matrixWorld.elements, q = new Float32Array(p.length);
    for (let i = 0; i < p.length; i += 3) { const x = p[i], y = p[i + 1], z = p[i + 2]; q[i] = e[0] * x + e[4] * y + e[8] * z + e[12]; q[i + 1] = e[1] * x + e[5] * y + e[9] * z + e[13]; q[i + 2] = e[2] * x + e[6] * y + e[10] * z + e[14]; }
    out.push(...upTris(q, c, 0, 0));
  });
  return out;
}
const near = (t: Tri, x0: number, z0: number, x1: number, z1: number): boolean =>
  Math.max(t.ax, t.bx, t.cx) > x0 && Math.min(t.ax, t.bx, t.cx) < x1 && Math.max(t.az, t.bz, t.cz) > z0 && Math.min(t.az, t.bz, t.cz) < z1;

// ---- every island's ground, with what stands on or joins it: the surf foam,
// the causeway decks, the picnic bridge and the airport ----
for (const seed of [base, base + 770]) {
  setCityBase(seed);
  for (const [bx, by] of [[1, 0], [2, 2], [0, 0], [0, 1]] as const) {
    const extras: Tri[] = [];
    const F = new Baked(); bakeFoam(F, bx, by, 0, 0); extras.push(...bakedTris(F));
    for (const span of spansOf(bx, by)) { const D = new Baked(); bakeCausewayDeck(D, span); extras.push(...bakedTris(D)); }
    extras.push(...groupTris(buildBridge(bx, by, 0, 0).group), ...groupTris(buildAirport(bx, by, 0, 0).group));
    for (let cx = 0; cx < WORLD_CHUNKS; cx++) for (let cz = 0; cz < WORLD_CHUNKS; cz++) {
      const x0 = cx * 64, z0 = cz * 64, x1 = x0 + 64, z1 = z0 + 64;
      const here = extras.filter(t => near(t, x0, z0, x1, z1));
      if (!here.length && (cx + cz) % 2) continue; // (a chunk with nothing added: every other one — the check runs in a minute)
      const { geo } = generateCityChunkData(bx, by, cx, cz);
      const tris = [...(geo.position ? upTris(geo.position.array, geo.color?.array ?? null, 0, 0) : []), ...here];
      if (!tris.length) continue;
      chunks++;
      rays += scan(tris, x0, z0, x1, z1, found, `seed ${seed} island ${bx},${by} chunk ${cx},${cz}:`);
    }
  }
}
void CITY_PITCH;
for (const [k, v] of [...found.entries()].sort((a, b) => b[1].n - a[1].n)) fail(`${v.n}× ${k} — first: ${v.at}`);
console.log(`${chunks} chunks, ${rays} samples: ${found.size} kinds of layers closer than ${MIN_GAP * 1000} mm`);
console.log(fails ? `FAIL — ${fails} z-fighting layer pair(s) (R42)` : 'PASS — every ground layer clears the one under it (R42)');
process.exit(fails ? 1 : 0);
