// The little island city — chunk baker. All design decisions live in the city
// plan (cityPlan.ts, seeded per world); this file just renders one 64 m chunk
// of that plan into a vertex-colored mesh: wide streets, node tiles, round-
// abouts and plazas, lamps, building lots, park ponds, the river with its
// banks, fords and street bridges, and nature scatter.
import * as THREE from 'three';
import { Baked } from '../engine/baked.js';
import { rng, chunkSeed, type Rng } from '../engine/rng.js';
import { bakedModel, type BakedTemplate } from '../engine/assets.js';
import { cityPlanFor, type District, type Lot } from './cityPlan.js';
import { railRouteFor } from './railRoute.js';
import { riverFor } from './riverRoute.js';
import { citySeed } from './cityGrid.js';
import { occupancyFor, BLOCKED_FOR_PROPS, STRUCTURED, LOT, SEA } from './grid.js';
import { coastFor, clipToRect, insetShore, causewaySpan } from './coast.js';
import { WORLD_CHUNKS, ISLAND } from './world.js';
import { STRAIT } from './cityGrid.js';
import { chunkRoadPieces, nodeArms, nodeReach, TRAFFIC_POLES, ROUNDABOUT_REACH } from './roadLayout.js';

export { WORLD_CHUNKS }; // re-exported for the game layer

const CAUSEWAY_ASPHALT = 0x5f6771;
const CAUSEWAY_DASH = 0xe8e4d8;
const CAUSEWAY_CURB = 0xcfc9ba;
const CAUSEWAY_CAP = 0x9a948a;

export interface CollisionBox {
  x1: number; x2: number; z1: number; z2: number;
  small?: number;
}

export interface CityChunkResult {
  mesh: THREE.Mesh;
  boxes: CollisionBox[];
}

const j = (r: Rng, amp: number) => (r() - 0.5) * 2 * amp;
const pick = <T,>(r: Rng, arr: T[]): T => arr[(r() * arr.length) | 0];

// ---- Kenney kit placement helpers ----
const _km = new THREE.Matrix4();
const _kq = new THREE.Quaternion();
const _ke = new THREE.Euler();
const _kv = new THREE.Vector3();
const _ks = new THREE.Vector3();

function bakeModel(B: Baked, tpl: BakedTemplate, x: number, y: number, z: number, ry: number, s: number, s3: [number, number, number] | null = null): void {
  _ke.set(0, ry, 0);
  _kq.setFromEuler(_ke);
  if (s3) _ks.set(s3[0], s3[1], s3[2]);
  else _ks.set(s, s, s);
  _km.compose(_kv.set(x, y, z), _kq, _ks);
  for (const g of tpl.geos) B.raw(g.clone().applyMatrix4(_km));
}

function kenneyTPL() {
  const names = ['bldg-a', 'bldg-b', 'bldg-c', 'bldg-d', 'bldg-e', 'bldg-f', 'bldg-g',
    'bldg-h', 'bldg-i', 'bldg-j', 'bldg-k', 'bldg-l', 'bldg-m', 'bldg-n'].map(bakedModel).filter((t): t is BakedTemplate => !!t);
  return {
    buildings: names,
    trees: ['tree-default', 'tree-oak', 'tree-detailed', 'tree-fat', 'tree-thin', 'tree-small']
      .map(bakedModel).filter((t): t is BakedTemplate => !!t),
    pines: ['pine-a', 'pine-b', 'pine-c'].map(bakedModel).filter((t): t is BakedTemplate => !!t),
    cacti: ['cactus-short', 'cactus-tall'].map(bakedModel).filter((t): t is BakedTemplate => !!t),
    rocks: ['rock-a', 'rock-b'].map(bakedModel).filter((t): t is BakedTemplate => !!t),
    lightCurved: bakedModel('light-curved'),
    road: {
      straight: bakedModel('road-straight'),
      pass: bakedModel('road-straight'),
      cross: bakedModel('road-crossroad'),
      crossPath: bakedModel('road-crossroad-path'),
      tee: bakedModel('road-intersection'),
      teePath: bakedModel('road-intersection-path'),
      bend: bakedModel('road-bend'),
      end: bakedModel('road-end'),
      round: bakedModel('road-roundabout'),
    },
    cars: ['car-sedan', 'car-suv', 'car-taxi', 'car-hatch'].map(bakedModel).filter((t): t is BakedTemplate => !!t),
    industrial: [...'abcdefghijklmnopqrst'].map(b => bakedModel('ind-' + b)).filter((t): t is BakedTemplate => !!t),
    indExtras: ['ind-tank', 'ind-tank-l', 'ind-box-a', 'ind-box-b', 'ind-box-c']
      .map(bakedModel).filter((t): t is BakedTemplate => !!t),
    chimney: bakedModel('ind-chimney-l') ?? bakedModel('ind-chimney-m'),
    waterTower: bakedModel('ind-tower'),
    windmill: bakedModel('ind-mill'),
  };
}

const BEACH = 0xf0e2c0;
const RIVER_WATER = 0x5fadc9;
const RIVER_BANK = 0xdfd3b4;
const RIVER_PATH = 0xd9cdb4;
const BRIDGE_STEEL = 0x8f97a3;
const SIDEWALK = 0xa1a9c9; // the road kit's pavement (tile-low) colour
const HOUSE_COLORS = [0xf2e4cf, 0xf9d9bd, 0xc3ddef, 0xcfe8d8, 0xf3c4d3, 0xdcd0ec, 0xf9e7b0, 0xe8ddd0];
const ROOFS = [0xcf7d6d, 0x8ba7bf, 0xc4a687, 0x9dbd80, 0xb8a4d4];
const ROAD_HALF = 7;      // 14 m carriageway — roomy for little drivers

export function slabColor(d: District): number {
  switch (d) {
    case 'forest': return 0x7ba363;
    case 'desert': return 0xe8d29a;
    case 'meadow': return 0xa9c88b;
    case 'green': return 0xa9c88b;
    case 'park': return 0xa4cf85;
    case 'downtown': return 0xdcd6c6;
    case 'industrial': return 0xcfccc2; // worn concrete aprons
    default: return 0xe9e1cf; // urban
  }
}

/** ground colour of a chunk (ocean blue outside the island) — for the minimap */
export function chunkGroundColor(bx: number, by: number, cx: number, cz: number): number {
  if (cx < 0 || cz < 0 || cx >= WORLD_CHUNKS || cz >= WORLD_CHUNKS) return 0x6fb7d9;
  return slabColor(cityPlanFor(bx, by).district(cx, cz));
}

export function generateCityChunk(bx: number, by: number, cx: number, cz: number): CityChunkResult {
  const seed = citySeed(bx, by);
  const r = rng(chunkSeed(seed, cx, cz));
  const CH = 64, X0 = cx * CH, Z0 = cz * CH;
  const B = new Baked();
  const boxes: CollisionBox[] = [];
  const TPL = kenneyTPL();
  const plan = cityPlanFor(bx, by);
  const rail = railRouteFor(bx, by);
  const river = riverFor(seed);
  const occ = occupancyFor(bx, by);
  const district = plan.district(cx, cz);

  // base slab — district ground cut to the island's shore, with a sand beach
  // band along it (R29). A chunk well inside the shore is one plain box.
  const coast = coastFor(bx, by);
  let inland = true;
  for (let t = 0; t <= CH && inland; t += 8) {
    for (const [px, pz] of [[X0 + t, Z0], [X0 + t, Z0 + CH], [X0, Z0 + t], [X0 + CH, Z0 + t]]) {
      if (!coast.inLand(px, pz, 9)) { inland = false; break; }
    }
  }
  if (inland) {
    B.box(CH, 0.1, CH, slabColor(district), X0 + CH / 2, 0.05, Z0 + CH / 2);
  } else {
    slab(clipToRect(coast.pts, X0, Z0, X0 + CH, Z0 + CH), BEACH, 0.09);
    slab(clipToRect(insetShore(coast, 7), X0, Z0, X0 + CH, Z0 + CH), slabColor(district), 0.1);
  }
  /** a flat slab of ground over polygon `poly`, top at `top`, reaching down
   * below the waterline so its edge never shows a gap */
  function slab(poly: Array<{ x: number; z: number }>, color: number, top: number): void {
    if (poly.length < 3) return;
    const shape = new THREE.Shape(poly.map(p => new THREE.Vector2(p.x, -p.z)));
    const geo = new THREE.ExtrudeGeometry(shape, { depth: 0.5, bevelEnabled: false });
    geo.rotateX(-Math.PI / 2);
    geo.translate(0, top - 0.5, 0);
    B.add(geo, color);
  }

  // ---- the river: water ribbon, sandy banks and a footpath, interrupted
  // where a street bridges it ----
  const bridges = plan.riverBridges.filter(b => b.x > X0 - 30 && b.x < X0 + CH + 30 && b.z > Z0 - 30 && b.z < Z0 + CH + 30);
  const nearBridge = (x: number, z: number): boolean =>
    bridges.some(b => Math.hypot(b.x - x, b.z - z) < (b.exit ? 16 : 11));
  {
    const rp = river.pts;
    for (let k = 0; k + 1 < rp.length; k++) {
      const a = rp[k], b = rp[k + 1];
      const mx = (a.x + b.x) / 2, mz = (a.z + b.z) / 2;
      if (mx < X0 - 10 || mx > X0 + CH + 10 || mz < Z0 - 10 || mz > Z0 + CH + 10) continue;
      if (!coast.inLand(mx, mz, -1)) continue; // the river has met the sea
      const len = Math.hypot(b.x - a.x, b.z - a.z) + 1.4;
      const ry = Math.atan2(b.x - a.x, b.z - a.z);
      if (nearBridge(mx, mz)) continue; // the street bridge owns this stretch
      const w = (a.w + b.w) / 2;
      B.box(w, 0.09, len, RIVER_WATER, mx, 0.105, mz, 0, ry, 0);
      // sandy banks + a footpath on one side
      const rx = Math.cos(ry), rz = -Math.sin(ry);
      for (const s of [-1, 1]) {
        B.box(2.8, 0.05, len, RIVER_BANK, mx + rx * s * (w / 2 + 1.4), 0.1, mz + rz * s * (w / 2 + 1.4), 0, ry, 0);
      }
      B.box(1.9, 0.045, len, RIVER_PATH, mx + rx * (w / 2 + 3.4), 0.1, mz + rz * (w / 2 + 3.4), 0, ry, 0);
    }
    // greenway: trees and benches along the banks that pass through this chunk
    for (let k = 2; k + 2 < rp.length; k += 5) {
      const p = rp[k];
      if (p.x < X0 + 4 || p.x > X0 + CH - 4 || p.z < Z0 + 4 || p.z > Z0 + CH - 4) continue;
      if (nearBridge(p.x, p.z)) continue;
      const side = (k % 2) * 2 - 1;
      const rx = Math.cos(p.h), rz = -Math.sin(p.h);
      const tx = p.x + rx * side * (p.w / 2 + 5 + r() * 4);
      const tz = p.z + rz * side * (p.w / 2 + 5 + r() * 4);
      // the occupancy grid knows about the riverside lots the plan only
      // checks at their centre — a tree past the bank line lands in a yard
      if (occ.claims(tx, tz, 1.2, BLOCKED_FOR_PROPS)) continue;
      const bankTpl = district === 'desert' ? pick(r, [...TPL.cacti, ...TPL.rocks])
        : district === 'forest' ? pick(r, TPL.pines) : pick(r, TPL.trees);
      if (bankTpl) {
        bakeModel(B, bankTpl, tx, 0.08, tz, r() * Math.PI * 2, 4 + r() * 3);
        boxes.push({ x1: tx - 0.6, x2: tx + 0.6, z1: tz - 0.6, z2: tz + 0.6, small: 1 });
      }
      if (r() < 0.4) {
        const bx2 = p.x + rx * side * (p.w / 2 + 2.9), bz2 = p.z + rz * side * (p.w / 2 + 2.9);
        B.box(1.6, 0.08, 0.45, 0xa9805a, bx2, 0.55, bz2, 0, p.h, 0);
      }
    }
  }
  // street bridges over the river: steel girders + cream rail caps + abutments
  for (const b of bridges) {
    const alongX = b.axis === 'h';
    const hw = river.halfAt(b.x, b.z) + 5.5; // span past the water
    for (const s of [-1, 1]) {
      const off = ROAD_HALF + 0.9;
      const gx = b.x + (alongX ? 0 : s * off);
      const gz = b.z + (alongX ? s * off : 0);
      B.box(alongX ? 20 : 0.55, 0.62, alongX ? 0.55 : 20, BRIDGE_STEEL, gx, 0.4, gz);
      B.box(alongX ? 20 : 0.34, 0.14, alongX ? 0.34 : 20, 0xe8e4d8, gx, 0.78, gz);
    }
    for (const s of [-1, 1]) {
      const ax = b.x + (alongX ? s * 10.2 : 0);
      const az = b.z + (alongX ? 0 : s * 10.2);
      B.box(alongX ? 1.3 : hw * 2 + 6, 0.55, alongX ? hw * 2 + 6 : 1.3, BRIDGE_STEEL, ax, 0.28, az);
    }
  }

  // ---- causeways to the neighbouring cities: each city draws its own south
  // and east decks, from the last dry land on its exit corridor across the
  // strait to the first dry land on the neighbour's; the neighbours' decks
  // land on our north/west shores. The chunk holding the corridor's shore
  // crossing lays it. ----
  for (const side of ['s', 'e'] as const) {
    const span = causewaySpan(bx, by, side);
    const [px, pz] = side === 's' ? [span.at, span.from] : [span.from, span.at];
    if (px >= X0 && px < X0 + CH && pz >= Z0 && pz < Z0 + CH) {
      bakeCauseway(span.at, side === 's' ? 'v' : 'h', span.from - 2, span.to + 2);
    }
  }

  /** flush deck across the strait — flat physics can't arch, so parapets,
   * fender piles and dashes do the looking (collision-free like the picnic
   * causeway: splashing into the shallows is half the fun) */
  function bakeCauseway(at: number, dir: 'h' | 'v', start: number, end: number): void {
    const len = end - start, mid = start + len / 2;
    if (dir === 'v') {
      B.box(11, 0.7, len, CAUSEWAY_ASPHALT, at, -0.25, mid);
      for (let z = start + 3; z < start + len - 2; z += 4) B.box(0.25, 0.02, 1.8, CAUSEWAY_DASH, at, 0.11, z);
      for (const side of [-1, 1]) {
        B.box(0.4, 0.55, len, CAUSEWAY_CURB, at + side * 5.3, 0.375, mid);
        B.box(0.55, 0.12, len, CAUSEWAY_CAP, at + side * 5.3, 0.71, mid);
      }
      for (let z = start + 6; z < start + len; z += 12) {
        for (const side of [-1, 1]) B.box(0.7, 2, 0.7, 0x8a6a4a, at + side * 6.3, -0.6, z);
      }
    } else {
      B.box(len, 0.7, 11, CAUSEWAY_ASPHALT, mid, -0.25, at);
      for (let x = start + 3; x < start + len - 2; x += 4) B.box(1.8, 0.02, 0.25, CAUSEWAY_DASH, x, 0.11, at);
      for (const side of [-1, 1]) {
        B.box(len, 0.55, 0.4, CAUSEWAY_CURB, mid, 0.375, at + side * 5.3);
        B.box(len, 0.12, 0.55, CAUSEWAY_CAP, mid, 0.71, at + side * 5.3);
      }
      for (let x = start + 6; x < start + len; x += 12) {
        for (const side of [-1, 1]) B.box(0.7, 2, 0.7, 0x8a6a4a, x, -0.6, at + side * 6.3);
      }
    }
  }

  // ---- roads: the complete Kenney City Kit Roads where it loaded, the
  // procedural pastel slabs otherwise. roadLayout.ts decides every piece:
  // each street node owns ONE pad (crossroad / T / bend / in-line straight /
  // roundabout) and straights fill only the span between two pads, so no
  // piece ever lies on another (R35). Every piece is laid at the uniform
  // 14 m unit — the kit straight's full cross-section IS the R5 carriageway.
  // Thickness is scaled x4 (0.08 m) so the surface clears the slab without
  // z-fighting, while the rail heads (RAIL_TOP) still ride above it.
  const TY = 0.11;                   // legacy slab surface height
  const ROAD_Y = 0.1;                // kit pieces rest on the slab top
  const ROAD_THICK = 4;
  const R = TPL.road;
  const hasRoadKit = !!(R.straight && R.cross && R.tee && R.bend && R.end && R.round);
  const roadS = plan.segH(cz, cx);
  const roadW = plan.segV(cx, cz);
  // the TRUE [west, east, north, south] arms of this chunk's SW node —
  // plan.arms() filters out the closed arms (legacy fillet path below)
  const a0 = nodeArms(plan, cx, cz);
  const armN = a0.filter(Boolean).length;
  if (hasRoadKit) {
    for (const p of chunkRoadPieces(plan, cx, cz)) {
      // past the shore a causeway corridor is a deck, not road tiles
      if (occ.bits(p.x, p.z) & SEA) continue;
      const tpl = p.kind === 'cross' ? (p.crosswalks ? R.crossPath ?? R.cross : R.cross)
        : p.kind === 'tee' ? (p.crosswalks ? R.teePath ?? R.tee : R.tee)
          : R[p.kind];
      if (!tpl) continue;
      // native pieces are 1 unit per side (the roundabout 3): scale so the
      // placed piece spans exactly p.lx x p.lz
      const units = p.kind === 'round' ? 3 : 1;
      bakeModel(B, tpl, p.x, ROAD_Y, p.z, p.ry, 1, [p.lx / units, ROAD_THICK, p.lz / units]);
    }
    // sidewalk bands in the built-up districts: the kit's kerb strip
    // widened out to the lot line (7 -> 8.1 m), in the kit's own pavement
    // colour, running only along the span between node pads
    if (district === 'urban' || district === 'downtown' || district === 'industrial') {
      // the roundabout's arms keep a straight kerb for their outer 5.8 m
      // before the ring flares, so the band runs on up to the flare
      // (and straight through an in-line node, whose pad is a plain straight)
      const walkReach = (i: number, j: number): number => {
        if (plan.plaza(i, j)) return ROUNDABOUT_REACH - 5.8;
        const a = nodeArms(plan, i, j);
        if (a.filter(Boolean).length === 2 && ((a[0] && a[1]) || (a[2] && a[3]))) return 0;
        return nodeReach(plan, i, j);
      };
      const walk = (horiz: boolean, line: number, k: number): void => {
        const [ia, ja, ib, jb] = horiz ? [k, line, k + 1, line] : [line, k, line, k + 1];
        const s0 = k * CH + walkReach(ia, ja), s1 = (k + 1) * CH - walkReach(ib, jb);
        // the band breaks where the street bridges the river
        const cuts: Array<[number, number]> = [];
        for (const b of plan.riverBridges) {
          if ((b.axis === 'h') !== horiz || Math.abs((horiz ? b.z : b.x) - line * CH) > 1) continue;
          const at = horiz ? b.x : b.z;
          cuts.push([at - 13, at + 13]);
        }
        let a = s0;
        const runs: Array<[number, number]> = [];
        for (const [c0, c1] of cuts.sort((p, q) => p[0] - q[0])) {
          if (c1 <= a || c0 >= s1) continue;
          if (c0 > a) runs.push([a, c0]);
          a = Math.max(a, c1);
        }
        if (s1 > a) runs.push([a, s1]);
        // and nothing past the shore (a causeway corridor goes out to sea)
        const landRuns: Array<[number, number]> = [];
        for (const [r0, r1] of runs) {
          let a0: number | null = null;
          for (let t = r0; t <= r1; t += 2) {
            const [wx, wz] = horiz ? [t, line * CH] : [line * CH, t];
            const dry = coast.inLand(wx, wz, 10);
            if (dry && a0 === null) a0 = t;
            if (!dry && a0 !== null) { landRuns.push([a0, t]); a0 = null; }
          }
          if (a0 !== null) landRuns.push([a0, r1]);
        }
        for (const [r0, r1] of landRuns) {
          if (r1 - r0 < 1) continue;
          const mid = (r0 + r1) / 2, len = r1 - r0;
          for (const side of [-1, 1]) {
            const off = line * CH + side * 7.55;
            if (horiz) B.box(len, 0.06, 1.1, SIDEWALK, mid, 0.13, off);
            else B.box(1.1, 0.06, len, SIDEWALK, off, 0.13, mid);
          }
        }
      };
      if (roadS) walk(true, cz, cx);
      if (roadW) walk(false, cx, cz);
      // corner squares where two bands meet at this chunk's SW junction
      if (!plan.plaza(cx, cz)) {
        for (const [ea, eb, sx, sz] of [[0, 2, -1, -1], [1, 2, 1, -1], [0, 3, -1, 1], [1, 3, 1, 1]] as const) {
          if (a0[ea] && a0[eb]) B.box(1.1, 0.06, 1.1, SIDEWALK, X0 + sx * 7.55, 0.13, Z0 + sz * 7.55);
        }
        // a T's closed side: the through street's band runs past the pad
        if (armN === 3) {
          const miss = a0.indexOf(false);
          if (miss === 2) B.box(14, 0.06, 1.1, SIDEWALK, X0, 0.13, Z0 - 7.55);
          if (miss === 3) B.box(14, 0.06, 1.1, SIDEWALK, X0, 0.13, Z0 + 7.55);
          if (miss === 0) B.box(1.1, 0.06, 14, SIDEWALK, X0 - 7.55, 0.13, Z0);
          if (miss === 1) B.box(1.1, 0.06, 14, SIDEWALK, X0 + 7.55, 0.13, Z0);
        }
      }
    }
  } else {
    const openJunction = (i: number, j: number): boolean => {
      // unfiltered [west, east, north, south] — bends must read as junctions
      const a = [plan.segH(j, i - 1), plan.segH(j, i), plan.segV(i, j - 1), plan.segV(i, j)];
      const n = a.filter(Boolean).length;
      if (plan.plaza(i, j) || n >= 3) return true;
      return n === 2 && !((a[0] && a[1]) || (a[2] && a[3]));
    };
    const TS = 64 / 6;
    const jSW = openJunction(cx, cz);
    const jS = openJunction(cx + 1, cz);
    const jW = openJunction(cx, cz + 1);
    for (let k = 0; k < 6; k++) {
      const c = TS / 2 + k * TS;
      const markS = (k > 0 && k < 5) || (k === 0 && !jSW) || (k === 5 && !jS);
      const markW = (k > 0 && k < 5) || (k === 0 && !jSW) || (k === 5 && !jW);
      if (roadS) {
        B.box(TS + 0.02, 0.04, 14, CAUSEWAY_ASPHALT, X0 + c, TY, Z0);
        if (markS) {
          for (const side of [-6.9, 6.9]) B.box(TS + 0.02, 0.09, 0.5, CAUSEWAY_CURB, X0 + c, TY + 0.02, Z0 + side);
          for (const d of [c - TS / 3, c, c + TS / 3]) B.box(2.8, 0.02, 0.3, CAUSEWAY_DASH, X0 + d, TY + 0.03, Z0);
        }
      }
      if (roadW) {
        B.box(14, 0.04, TS + 0.02, CAUSEWAY_ASPHALT, X0, TY, Z0 + c);
        if (markW) {
          for (const side of [-6.9, 6.9]) B.box(0.5, 0.09, TS + 0.02, CAUSEWAY_CURB, X0 + side, TY + 0.02, Z0 + c);
          for (const d of [c - TS / 3, c, c + TS / 3]) B.box(0.3, 0.02, 2.8, CAUSEWAY_DASH, X0, TY + 0.03, Z0 + d);
        }
      }
    }
    // corner fillets: wherever two arms meet, an asphalt disc rounds the
    // inner corner, and the elbow of an L-bend gets a bigger disc curving
    // the outer edge — no hard 90-degree asphalt corners anywhere
    {
      const corners: Array<[boolean, boolean, number, number]> = [
        [a0[0], a0[2], -1, -1], // NW: west + north
        [a0[1], a0[2], 1, -1],  // NE: east + north
        [a0[0], a0[3], -1, 1],  // SW: west + south
        [a0[1], a0[3], 1, 1],   // SE: east + south
      ];
      const armCount = armN;
      for (const [armA, armB, sx, sz] of corners) {
        if (armA && armB) {
          B.cyl(5, 5, 0.04, 12, CAUSEWAY_ASPHALT, X0 + sx * 5, TY, Z0 + sz * 5);
        } else if (!armA && !armB && armCount === 2) {
          B.cyl(7, 7, 0.04, 14, CAUSEWAY_ASPHALT, X0 + sx * 7, TY, Z0 + sz * 7);
        }
      }
    }
  }

  // ---- junction dressing at the chunk's SW corner (X0, Z0) ----
  if (plan.plaza(cx, cz)) {
    // kit roundabout: a little fountain on its centre island; the legacy
    // slab path keeps the paved fountain square
    if (hasRoadKit) bakeIslandFountain(X0, Z0);
    else bakePlaza(X0, Z0);
  }

  // working traffic lights are dynamic objects (chunks.ts) at signalized nodes;
  // chunks only keep the poles' collision boxes: one pole per approach arm
  // (roadLayout TRAFFIC_POLES — the same spots chunks.ts plants the kit
  // lights on)
  if (plan.signalized(cx, cz)) {
    for (const [dx, dz, , arm] of TRAFFIC_POLES) {
      if (!a0[arm]) continue;
      const tx = X0 + dx, tz = Z0 + dz;
      boxes.push({ x1: tx - 0.4, x2: tx + 0.4, z1: tz - 0.4, z2: tz + 0.4, small: 1 });
    }
  }

  // street lamps along surviving streets (urban fabric + industry), kept
  // clear of the railway corridor, off the junction pads (a roundabout's
  // ring reaches 21 m up its arms) and out of the front corners of corner lots
  const lampDistrict = district === 'urban' || district === 'downtown' || district === 'industrial';
  if (lampDistrict) {
    const padH0 = nodeReach(plan, cx, cz), padH1 = nodeReach(plan, cx + 1, cz);
    const padV1 = nodeReach(plan, cx, cz + 1);
    for (let d = 11; d < CH; d += 18) {
      const offH = d < padH0 + 1.5 || d > CH - padH1 - 1.5;
      const offV = d < padH0 + 1.5 || d > CH - padV1 - 1.5;
      const clearH = roadS && !offH && !rail.near(X0 + d, Z0 + 7.8, 9) && !occ.claims(X0 + d, Z0 + 7.8, 0.9, LOT | SEA);
      const clearV = roadW && !offV && !rail.near(X0 + 7.8, Z0 + d, 9) && !occ.claims(X0 + 7.8, Z0 + d, 0.9, LOT | SEA);
      if (clearH && TPL.lightCurved) bakeModel(B, TPL.lightCurved, X0 + d, 0.1, Z0 + 7.8, 0, 5.5);
      if (clearV && TPL.lightCurved) bakeModel(B, TPL.lightCurved, X0 + 7.8, 0.1, Z0 + d, Math.PI / 2, 5.5);
      if (clearH) boxes.push({ x1: X0 + d - 0.3, x2: X0 + d + 0.3, z1: Z0 + 7.5, z2: Z0 + 8.1, small: 1 });
      if (clearV) boxes.push({ x1: X0 + 7.5, x2: X0 + 8.1, z1: Z0 + d - 0.3, z2: Z0 + d + 0.3, small: 1 });
    }
  }

  // ---- lots: buildings, tree rows and parking, laid out by the plan ----
  for (const lot of plan.lots(cx, cz)) bakeLot(lot);

  function bakeLot(lot: Lot): void {
    if (lot.kind === 'bldg') {
      const industrial = district === 'industrial';
      const tpls = industrial ? TPL.industrial : TPL.buildings;
      if (tpls.length) {
        // occasionally an industrial lot is just stacked containers / a tank
        const tpl = industrial && TPL.indExtras.length && r() < 0.22
          ? pick(r, TPL.indExtras)
          : tpls[((lot.v * tpls.length) | 0) % tpls.length];
        const s = Math.min((lot.w * 0.92) / tpl.size.x, (lot.d * 0.92) / tpl.size.z);
        bakeModel(B, tpl, lot.x, 0.1, lot.z, lot.ry, s);
        // collision AABB from the rotated footprint (ry is axis-aligned)
        const flip = Math.abs(Math.abs(lot.ry) - Math.PI / 2) < 0.01;
        const hx = (flip ? lot.d : lot.w) / 2, hz = (flip ? lot.w : lot.d) / 2;
        boxes.push({ x1: lot.x - hx, x2: lot.x + hx, z1: lot.z - hz, z2: lot.z + hz });
      } else {
        // procedural fallback house
        const h = 2.9 * (2 + ((lot.v * 3) | 0)) + 0.6;
        const flip = Math.abs(Math.abs(lot.ry) - Math.PI / 2) < 0.01;
        const hx = (flip ? lot.d : lot.w) / 2.4, hz = (flip ? lot.w : lot.d) / 2.4;
        B.box(hx * 2, h, hz * 2, HOUSE_COLORS[(lot.v * HOUSE_COLORS.length) | 0], lot.x, h / 2, lot.z);
        B.box(hx * 2 + 0.3, 0.3, hz * 2 + 0.3, ROOFS[(lot.v * ROOFS.length) | 0], lot.x, h + 0.15, lot.z);
        boxes.push({ x1: lot.x - hx, x2: lot.x + hx, z1: lot.z - hz, z2: lot.z + hz });
      }
    } else if (lot.kind === 'trees') {
      bakeTrees(lot.x, lot.z, 2 + ((lot.v * 2) | 0), lot.w / 2, lot);
    } else {
      // parking lot: slab + a car or two
      const flip = Math.abs(Math.abs(lot.ry) - Math.PI / 2) < 0.01;
      const wx = flip ? lot.d : lot.w, wz = flip ? lot.w : lot.d;
      B.box(wx, 0.06, wz, 0x828a96, lot.x, 0.14, lot.z);
      const n = 1 + ((lot.v * 2) | 0);
      for (let i = 0; i < n; i++) {
        const off = (i - (n - 1) / 2) * (lot.w / 2.2);
        const cxx = flip ? lot.x : lot.x + off;
        const czz = flip ? lot.z + off : lot.z;
        bakeParkedCar(cxx, czz, flip ? Math.PI / 2 : 0);
        boxes.push({
          x1: cxx - (flip ? 2.3 : 1.0), x2: cxx + (flip ? 2.3 : 1.0),
          z1: czz - (flip ? 1.0 : 2.3), z2: czz + (flip ? 1.0 : 2.3),
        });
      }
    }
  }

  function bakeTrees(
    x: number, z: number, n = 3, spread = 3,
    /** the tree row's own lot: its LOT cells are fair ground, everything
     * built around it is not — a wandering tree must never land in a
     * neighbouring building */
    own?: Lot,
  ): void {
    for (let i = 0; i < n; i++) {
      const tx = x + j(r, spread), tz = z + j(r, spread);
      // inside its own lot, but still not on the road, track, water — or in
      // any other lot's building
      if (occ.claims(tx, tz, 0.8, STRUCTURED)) continue;
      if (occ.claims(tx, tz, 0.9, LOT)) {
        const inOwn = own && tx > own.x - own.w / 2 - 1 && tx < own.x + own.w / 2 + 1
          && tz > own.z - own.d / 2 - 1 && tz < own.z + own.d / 2 + 1;
        if (!inOwn) continue;
      }
      if (TPL.trees.length) {
        bakeModel(B, pick(r, TPL.trees), tx, 0.08, tz, r() * Math.PI * 2, 5 + r() * 2.5);
      }
      boxes.push({ x1: tx - 0.55, x2: tx + 0.55, z1: tz - 0.55, z2: tz + 0.55, small: 1 });
    }
  }

  /** fountain on the roundabout's centre island (the island is ~3.5 m in
   * radius; traffic circles it on the ring) */
  function bakeIslandFountain(x: number, z: number): void {
    B.cyl(2.5, 2.6, 0.45, 16, 0x9aa1ab, x, 0.35, z);   // basin wall
    B.cyl(2.2, 2.2, 0.4, 16, 0x6fb7d9, x, 0.4, z);     // water
    B.cyl(0.6, 0.8, 1.3, 12, 0xcfccc2, x, 0.8, z);     // pedestal
    B.cyl(1.1, 1.1, 0.16, 12, 0x9fd8ef, x, 1.5, z);    // upper dish
    B.sphere(0.25, 0xbfe3ff, x, 1.75, z);              // finial
    boxes.push({ x1: x - 2.6, x2: x + 2.6, z1: z - 2.6, z2: z + 2.6, small: 1 });
  }

  /** paved plaza with a fountain, benches and planters — the meeting place */
  function bakePlaza(x: number, z: number): void {
    B.cyl(9.4, 9.4, 0.055, 26, 0xcfc6b0, x, 0.14, z);    // apron
    B.cyl(9.0, 9.0, 0.07, 26, 0xd8d0bc, x, 0.145, z);    // paved circle
    B.cyl(6.4, 6.4, 0.06, 26, 0xcfc6b0, x, 0.1475, z);   // ring pattern
    B.cyl(5.9, 5.9, 0.065, 26, 0xd8d0bc, x, 0.15, z);
    // the fountain
    B.cyl(2.9, 3.1, 0.5, 16, 0x9aa1ab, x, 0.35, z);      // basin wall
    B.cyl(2.6, 2.6, 0.44, 16, 0x6fb7d9, x, 0.4, z);      // water
    B.cyl(0.9, 1.15, 1.4, 12, 0xcfccc2, x, 0.8, z);      // pedestal
    B.cyl(1.55, 1.55, 0.18, 12, 0x9fd8ef, x, 1.55, z);   // upper dish
    B.sphere(0.3, 0xbfe3ff, x, 1.8, z);                  // finial
    boxes.push({ x1: x - 2.2, x2: x + 2.2, z1: z - 2.2, z2: z + 2.2, small: 1 });
    // benches + planter pots around the circle
    for (let k = 0; k < 4; k++) {
      const ang = k * Math.PI / 2 + Math.PI / 4;
      const bx = x + Math.cos(ang) * 4.9, bz = z + Math.sin(ang) * 4.9;
      B.box(1.7, 0.1, 0.5, 0xa9805a, bx, 0.55, bz, 0, -ang, 0);
      const px = x + Math.cos(ang + Math.PI / 4) * 7.6, pz = z + Math.sin(ang + Math.PI / 4) * 7.6;
      B.cyl(0.55, 0.7, 0.5, 10, 0xb5651d, px, 0.35, pz); // terracotta pot
      B.cyl(0.4, 0.4, 0.45, 8, 0xa4cf85, px, 0.72, pz);  // shrub
      boxes.push({ x1: px - 0.7, x2: px + 0.7, z1: pz - 0.7, z2: pz + 0.7, small: 1 });
    }
  }

  function bakeParkedCar(x: number, z: number, ry: number): void {
    if (TPL.cars.length) {
      const tpl = pick(r, TPL.cars);
      bakeModel(B, tpl, x, 0.17, z, ry, 4.3 / Math.max(tpl.size.x, tpl.size.z));
    }
  }

  // ---- district dressing ----
  if (district === 'park') {
    // a pond with a tree ring and a couple of benches
    const px = X0 + CH / 2 + j(r, 6), pz = Z0 + CH / 2 + j(r, 6);
    const pr = 8 + r() * 3;
    B.cyl(pr, pr, 0.08, 18, 0x7fc4de, px, 0.13, pz);
    B.cyl(pr + 1.4, pr + 1.4, 0.06, 18, 0xd9cdb4, px, 0.12, pz); // sandy rim
    for (let k = 0; k < 7; k++) {
      const ang = (k / 7) * Math.PI * 2 + r();
      bakeTrees(px + Math.cos(ang) * 15, pz + Math.sin(ang) * 15, 1, 2.5);
    }
    for (const s of [-1, 1]) {
      B.box(1.6, 0.08, 0.45, 0xa9805a, px + s * 11.5, 0.55, pz + j(r, 3));
    }
  } else if (district === 'forest' || district === 'desert' || district === 'meadow') {
    scatterNature(district);
  } else if (district === 'green') {
    // streetless block: a little wooded green
    for (let k = 0; k < 8; k++) {
      const x = X0 + 10 + r() * (CH - 20), z = Z0 + 10 + r() * (CH - 20);
      if (occ.claims(x, z, 1.2, BLOCKED_FOR_PROPS)) continue;
      bakeModel(B, pick(r, [...TPL.trees, ...TPL.pines]), x, 0.08, z, r() * Math.PI * 2, 4 + r() * 3);
      boxes.push({ x1: x - 0.6, x2: x + 0.6, z1: z - 0.6, z2: z + 0.6, small: 1 });
    }
  } else if (district === 'industrial') {
    // works yard dressing: a chimney or water tower plus scattered junk
    // on ground the occupancy grid shows is free of streets, lots and track
    if (TPL.chimney || TPL.waterTower) {
      for (let t = 0; t < 6; t++) {
        const x = X0 + 12 + r() * (CH - 24), z = Z0 + 12 + r() * (CH - 24);
        if (occ.claims(x, z, 1.6, BLOCKED_FOR_PROPS)) continue;
        const big = r() < 0.5 && TPL.chimney ? TPL.chimney : TPL.waterTower;
        if (!big) continue;
        const s = big === TPL.chimney ? 3.2 + r() * 1.6 : 4.5 + r();
        bakeModel(B, big, x, 0.1, z, r() * Math.PI * 2, s);
        boxes.push({ x1: x - 1.2, x2: x + 1.2, z1: z - 1.2, z2: z + 1.2, small: 1 });
        break;
      }
    }
    if (TPL.windmill && r() < 0.3) {
      const x = X0 + 12 + r() * (CH - 24), z = Z0 + 12 + r() * (CH - 24);
      if (!occ.claims(x, z, 1.4, BLOCKED_FOR_PROPS)) {
        bakeModel(B, TPL.windmill, x, 0.1, z, r() * Math.PI * 2, 4 + r() * 2);
        boxes.push({ x1: x - 1, x2: x + 1, z1: z - 1, z2: z + 1, small: 1 });
      }
    }
    for (let k = 0; k < 3; k++) {
      const x = X0 + 9 + r() * (CH - 18), z = Z0 + 9 + r() * (CH - 18);
      if (occ.claims(x, z, 1.2, BLOCKED_FOR_PROPS) || !TPL.indExtras.length) continue;
      const tpl = pick(r, TPL.indExtras);
      const s = 2.6 + r() * 1.4;
      bakeModel(B, tpl, x, 0.1, z, r() * Math.PI * 2, s);
      boxes.push({ x1: x - 1.4, x2: x + 1.4, z1: z - 1.4, z2: z + 1.4, small: 1 });
    }
  }

  function scatterNature(kind: 'forest' | 'desert' | 'meadow'): void {
    const tries = kind === 'forest' ? 30 : kind === 'desert' ? 14 : 18;
    for (let i = 0; i < tries; i++) {
      const x = X0 + 7 + r() * (CH - 14);
      const z = Z0 + 7 + r() * (CH - 14);
      if (occ.claims(x, z, 1.2, BLOCKED_FOR_PROPS)) continue;
      let tpl: BakedTemplate | null = null;
      const s = 3.5 + r() * 2.5;
      if (kind === 'forest') tpl = pick(r, [...TPL.pines, ...TPL.trees]);
      else if (kind === 'desert') tpl = pick(r, [...TPL.cacti, ...TPL.rocks]);
      else tpl = pick(r, TPL.trees);
      if (!tpl) continue;
      bakeModel(B, tpl, x, 0.08, z, r() * Math.PI * 2, s);
      boxes.push({ x1: x - 0.6, x2: x + 0.6, z1: z - 0.6, z2: z + 0.6, small: 1 });
    }
  }

  return { mesh: B.build(), boxes };
}