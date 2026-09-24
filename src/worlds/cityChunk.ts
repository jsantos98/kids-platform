// The little island city — chunk baker. All design decisions live in the city
// plan (cityPlan.ts, seeded per world); this file just renders one 64 m chunk
// of that plan into a vertex-colored mesh: wide streets, node tiles, round-
// abouts and plazas, lamps, building lots, park ponds, the river with its
// banks, fords and street bridges, and nature scatter.
import * as THREE from 'three';
import { Baked } from '../engine/baked.js';
import { rng, chunkSeed, type Rng } from '../engine/rng.js';
import { bakedModel, type BakedTemplate } from '../engine/assets.js';
import { cityPlanFor, ROAD_HALF, ROUNDABOUT_REACH, type District, type Lot, type PNode, type PEdge } from './cityPlan.js';
import { segDist } from './streetGen.js';
import { railNetFor } from './railRoute.js';
import { riverFor } from './riverRoute.js';
import { citySeed } from './cityGrid.js';
import { occupancyFor, BLOCKED_FOR_PROPS, STRUCTURED, LOT, SEA } from './grid.js';
import { coastFor, clipToRect, insetShore } from './coast.js';
import { spansOf, deckProfile, deckSlope, type Span } from './causeway.js';
import { WORLD_CHUNKS, ISLAND } from './world.js';
import { STRAIT } from './cityGrid.js';
import { chunkRoadPieces, nodePiece, nodeReach, armDir, pieceOutline, trafficPoles } from './roadLayout.js';

export { WORLD_CHUNKS }; // re-exported for the game layer

const CAUSEWAY_ASPHALT = 0x5f6771;
const CAUSEWAY_DASH = 0xe8e4d8;
const CAUSEWAY_CURB = 0xcfc9ba;
const CAUSEWAY_CAP = 0x9a948a;

export interface CollisionBox {
  /** the axis-aligned bound (the whole box, when there is no obb) */
  x1: number; x2: number; z1: number; z2: number;
  small?: number;
  /** a footprint turned to its street: centre, half extents, rotation */
  obb?: { cx: number; cz: number; hx: number; hz: number; ry: number };
}

/** is (x, z) within r of box b? (turned footprints tested in their frame) */
export function inBox(b: CollisionBox, x: number, z: number, r: number): boolean {
  if (x < b.x1 - r || x > b.x2 + r || z < b.z1 - r || z > b.z2 + r) return false;
  const o = b.obb;
  if (!o) return true;
  const dx = x - o.cx, dz = z - o.cz;
  const c = Math.cos(o.ry), s = Math.sin(o.ry);
  // local x = along (cos, -sin), local z = depth (sin, cos)
  const lx = dx * c - dz * s, lz = dx * s + dz * c;
  return Math.abs(lx) < o.hx + r && Math.abs(lz) < o.hz + r;
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
/** the kit road's asphalt, for the procedural polygon pads */
const ROAD_ASPHALT = 0x5b6170;

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
  const rail = railNetFor(bx, by);
  const river = riverFor(bx, by);
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
  // street bridges over the river: steel girders + cream rail caps + abutments,
  // turned to the street
  for (const b of bridges) {
    const ux = Math.sin(b.heading), uz = Math.cos(b.heading);
    const nx = uz, nz = -ux;
    const hw = river.halfAt(b.x, b.z) + 5.5; // span past the water
    for (const sd of [-1, 1]) {
      const off = ROAD_HALF + 0.9;
      B.box(0.55, 0.62, 20, BRIDGE_STEEL, b.x + nx * sd * off, 0.4, b.z + nz * sd * off, 0, b.heading, 0);
      B.box(0.34, 0.14, 20, 0xe8e4d8, b.x + nx * sd * off, 0.78, b.z + nz * sd * off, 0, b.heading, 0);
    }
    for (const sd of [-1, 1]) {
      B.box(hw * 2 + 6, 0.55, 1.3, BRIDGE_STEEL, b.x + ux * sd * 10.2, 0.28, b.z + uz * sd * 10.2, 0, b.heading, 0);
    }
  }

  // ---- causeways to the neighbouring cities: each city draws its own south
  // and east decks, from the last dry land on its exit corridor across the
  // strait to the first dry land on the neighbour's; the neighbours' decks
  // land on our north/west shores. The chunk holding the corridor's shore
  // crossing lays it. ----
  for (const span of spansOf(bx, by)) {
    const [px, pz] = span.side === 's' ? [span.at, span.from] : [span.from, span.at];
    if (px >= X0 && px < X0 + CH && pz >= Z0 && pz < Z0 + CH) bakeDeck(span);
  }

  /** a deck across the strait, following the raised-span profile (boats
   * sail under the middle): 4 m slab pieces tilted to the local slope,
   * parapets, piers down into the water. The avenue deck carries lane
   * dashes; the railway deck carries timber, sleepers and two rails. */
  function bakeDeck(span: Span): void {
    const start = span.from - 2, end = span.to + 2;
    const len = span.to - span.from;
    const road = span.kind === 'road';
    const v = span.side === 's';
    const put = (w: number, h: number, t0: number, t1: number, color: number, across: number, lift: number): void => {
      const tm = (t0 + t1) / 2 - span.from;
      const y = deckProfile(tm, len) + lift;
      const pitch = Math.atan(deckSlope(tm, len));
      const segLen = (t1 - t0) / Math.cos(pitch) + 0.06;
      const along = (t0 + t1) / 2;
      if (v) B.box(w, h, segLen, color, span.at + across, y, along, -pitch, 0, 0);
      else B.box(segLen, h, w, color, along, y, span.at + across, 0, 0, pitch);
    };
    const STEP = 4;
    for (let t = start; t < end; t += STEP) {
      const t1 = Math.min(end, t + STEP);
      if (road) {
        put(11, 0.7, t, t1, CAUSEWAY_ASPHALT, 0, -0.25);
        for (const side of [-1, 1]) {
          put(0.4, 0.55, t, t1, CAUSEWAY_CURB, side * 5.3, 0.375);
          put(0.55, 0.12, t, t1, CAUSEWAY_CAP, side * 5.3, 0.71);
        }
        put(0.25, 0.02, t + 1.1, t + 2.9, CAUSEWAY_DASH, 0, 0.11);
      } else {
        put(4.6, 0.5, t, t1, 0x8a6a4a, 0, -0.15);
        for (const side of [-1, 1]) {
          put(0.3, 0.45, t, t1, CAUSEWAY_CURB, side * 2.25, 0.3);
          put(0.12, 0.12, t, t1, 0x8d939e, side * 0.72, 0.3);
        }
        for (let q = t + 0.5; q < t1; q += 1.2) put(2.2, 0.1, q, q + 0.35, 0x6e5238, 0, 0.16);
      }
    }
    // piers: pairs of posts from the water up under the deck
    const half = road ? 6.3 : 2.1;
    for (let t = start + 6; t < end - 2; t += 12) {
      const y = deckProfile(t - span.from, len);
      const hgt = y + 1.6;
      for (const side of [-1, 1]) {
        const [x, z] = v ? [span.at + side * half, t] : [t, span.at + side * half];
        B.box(0.7, hgt, 0.7, 0x8a6a4a, x, y - 0.6 - hgt / 2, z);
      }
      // a cross beam under the raised part
      if (y > 1.5) {
        if (v) B.box(half * 2 + 0.7, 0.4, 0.6, 0x7a5c40, span.at, y - 0.75, t);
        else B.box(0.6, 0.4, half * 2 + 0.7, 0x7a5c40, t, y - 0.75, span.at);
      }
    }
  }

  // ---- roads: the complete Kenney City Kit Roads where it loaded, the
  // procedural pastel slabs otherwise. roadLayout.ts decides every piece:
  // each street node owns ONE pad (a kit piece rotated to a square node's
  // frame, or a polygon pad at an oblique junction) and straights fill only
  // the span between two pads, so no piece ever lies on another (R35). Every
  // piece is laid at the uniform 14 m unit — the kit straight's full
  // cross-section IS the R5 carriageway. Thickness is scaled x4 (0.08 m) so
  // the surface clears the slab without z-fighting, while the rail heads
  // (RAIL_TOP) still ride above it.
  const ROAD_Y = 0.1;                // kit pieces rest on the slab top
  const ROAD_THICK = 4;
  const PAD_Y = 0.18;                // polygon pads: flush with the kit asphalt
  const R = TPL.road;
  const hasRoadKit = !!(R.straight && R.cross && R.tee && R.bend && R.end && R.round);
  const inChunk = (x: number, z: number): boolean => x >= X0 && x < X0 + CH && z >= Z0 && z < Z0 + CH;
  const flat = (poly: Array<{ x: number; z: number }>, color: number, y: number): void => {
    if (poly.length < 3) return;
    // wind counter-clockwise in shape space so the face looks up
    let area = 0;
    for (let i = 0; i < poly.length; i++) {
      const p = poly[i], q = poly[(i + 1) % poly.length];
      area += p.x * -q.z - q.x * -p.z;
    }
    const pts = area < 0 ? [...poly].reverse() : poly;
    const geo = new THREE.ShapeGeometry(new THREE.Shape(pts.map(p => new THREE.Vector2(p.x, -p.z))));
    geo.rotateX(-Math.PI / 2);
    geo.translate(0, y, 0);
    B.add(geo, color);
  };
  /** a thin strip from p to q (kerbs, sidewalks) */
  const strip = (p: { x: number; z: number }, q: { x: number; z: number }, w: number, h: number, color: number, y: number): void => {
    const len = Math.hypot(q.x - p.x, q.z - p.z);
    if (len < 0.05) return;
    B.box(w, h, len, color, (p.x + q.x) / 2, y, (p.z + q.z) / 2, 0, Math.atan2(q.x - p.x, q.z - p.z), 0);
  };
  for (const p of chunkRoadPieces(plan, cx, cz)) {
    // past the shore a causeway avenue is a deck, not road tiles
    if (occ.bits(p.x, p.z) & SEA) continue;
    if (p.kind === 'pad') {
      flat(p.poly!, ROAD_ASPHALT, PAD_Y);
      // kerb strips along the corners between arms
      const poly = p.poly!;
      for (let i = 0; i < poly.length; i++) {
        const a = poly[i], b = poly[(i + 1) % poly.length];
        // the arm ends (carriageway mouths) carry no kerb: they are exactly
        // 14 m across and look out along an arm
        if (Math.abs(Math.hypot(b.x - a.x, b.z - a.z) - ROAD_HALF * 2) < 0.05) continue;
        strip(a, b, 0.45, 0.12, CAUSEWAY_CURB, PAD_Y + 0.02);
      }
      continue;
    }
    if (hasRoadKit) {
      const tpl = p.kind === 'cross' ? (p.crosswalks ? R.crossPath ?? R.cross : R.cross)
        : p.kind === 'tee' ? (p.crosswalks ? R.teePath ?? R.tee : R.tee)
          : R[p.kind];
      if (!tpl) continue;
      // native pieces are 1 unit per side (the roundabout 3): scale so the
      // placed piece spans exactly p.lx x p.lz
      const units = p.kind === 'round' ? 3 : 1;
      bakeModel(B, tpl, p.x, ROAD_Y, p.z, p.ry, 1, [p.lx / units, ROAD_THICK, p.lz / units]);
    } else {
      // no kit: a plain slab with kerbs
      flat(pieceOutline(p), ROAD_ASPHALT, PAD_Y);
    }
  }

  // sidewalk bands in the built-up districts: the kit's kerb strip widened
  // out to the lot line (7 -> 8.1 m), in the kit's own pavement colour, along
  // every street span between pads (each street's bands belong to the chunk
  // holding its midpoint), broken at river bridges and at the shore
  const builtD = (d: string): boolean => d === 'urban' || d === 'downtown' || d === 'industrial';
  const walkReach = (n: PNode, e: PEdge): number => {
    if (n.mouth) return 0;
    if (n.plaza) return ROUNDABOUT_REACH - 5.8;
    if (n.square && n.edges.length === 2) {
      const [p, q] = n.edges.map(id => armDir(plan, n, plan.edges[id]));
      if (p.x * q.x + p.z * q.z < -0.9) return 0; // an in-line straight pad
    }
    return nodeReach(plan, n, e);
  };
  for (const e of plan.edges) {
    const a = plan.nodes[e.a], b = plan.nodes[e.b];
    const mx = a.x + e.ux * e.len / 2, mz = a.z + e.uz * e.len / 2;
    if (!inChunk(mx, mz) || !builtD(plan.district(cx, cz))) continue;
    const s0 = walkReach(a, e), s1 = e.len - walkReach(b, e);
    const cuts: Array<[number, number]> = [];
    for (const br of plan.riverBridges) {
      const along = (br.x - a.x) * e.ux + (br.z - a.z) * e.uz;
      const acr = Math.abs((br.x - a.x) * e.uz - (br.z - a.z) * e.ux);
      if (acr > 1.5 || along < -2 || along > e.len + 2) continue;
      cuts.push([along - 13, along + 13]);
    }
    let t0 = s0;
    const runs: Array<[number, number]> = [];
    for (const [c0, c1] of cuts.sort((p, q) => p[0] - q[0])) {
      if (c1 <= t0 || c0 >= s1) continue;
      if (c0 > t0) runs.push([t0, c0]);
      t0 = Math.max(t0, c1);
    }
    if (s1 > t0) runs.push([t0, s1]);
    const nx = -e.uz, nz = e.ux;
    for (const [r0, r1] of runs) {
      // and nothing past the shore
      let open: number | null = null;
      const flush = (end: number): void => {
        if (open === null || end - open < 1) { open = null; return; }
        for (const side of [-1, 1]) {
          strip({ x: a.x + e.ux * open + nx * side * 7.55, z: a.z + e.uz * open + nz * side * 7.55 },
            { x: a.x + e.ux * end + nx * side * 7.55, z: a.z + e.uz * end + nz * side * 7.55 }, 1.1, 0.06, SIDEWALK, 0.13);
        }
        open = null;
      };
      for (let t = r0; t <= r1; t += 2) {
        const dry = coast.inLand(a.x + e.ux * t, a.z + e.uz * t, 10);
        if (dry && open === null) open = t;
        if (!dry) flush(t);
      }
      flush(r1);
    }
  }
  // sidewalk corners around this chunk's junction pads
  for (const n of plan.nodes) {
    if (!inChunk(n.x, n.z) || n.mouth || n.plaza || !builtD(plan.district(cx, cz))) continue;
    const arms = n.edges.map(id => armDir(plan, n, plan.edges[id]));
    const k = arms.length;
    if (n.square) {
      // corner squares where two perpendicular bands meet
      for (let i = 0; i < k; i++) {
        const u = arms[i], v = arms[(i + 1) % k];
        if (Math.abs(u.x * v.x + u.z * v.z) > 0.2) continue;
        B.box(1.1, 0.06, 1.1, SIDEWALK, n.x + (u.x + v.x) * 7.55, 0.13, n.z + (u.z + v.z) * 7.55, 0, Math.atan2(u.x, u.z), 0);
      }
      // a T's closed side: the through street's band runs past the pad
      if (k === 3) {
        const f = n.frame;
        for (let q = 0; q < 4; q++) {
          const d = { x: Math.sin(f + (q * Math.PI) / 2), z: Math.cos(f + (q * Math.PI) / 2) };
          if (arms.some(a => a.x * d.x + a.z * d.z > 0.9)) continue;
          const t = { x: d.z, z: -d.x };
          strip({ x: n.x + d.x * 7.55 - t.x * 7, z: n.z + d.z * 7.55 - t.z * 7 },
            { x: n.x + d.x * 7.55 + t.x * 7, z: n.z + d.z * 7.55 + t.z * 7 }, 1.1, 0.06, SIDEWALK, 0.13);
        }
      }
    } else {
      // an oblique pad: the band follows its kerbs, 0.55 m outside them
      const pad = nodePiece(plan, n);
      const poly = pad?.poly ?? [];
      for (let i = 0; i < poly.length; i++) {
        const a = poly[i], b = poly[(i + 1) % poly.length];
        if (Math.abs(Math.hypot(b.x - a.x, b.z - a.z) - ROAD_HALF * 2) < 0.05) continue;
        const mx = (a.x + b.x) / 2 - n.x, mz = (a.z + b.z) / 2 - n.z;
        const ml = Math.hypot(mx, mz) || 1;
        const o = { x: (mx / ml) * 0.55, z: (mz / ml) * 0.55 };
        strip({ x: a.x + o.x, z: a.z + o.z }, { x: b.x + o.x, z: b.z + o.z }, 1.1, 0.06, SIDEWALK, 0.13);
      }
    }
  }

  // ---- junction dressing ----
  for (const n of plan.nodes) {
    if (!inChunk(n.x, n.z)) continue;
    // kit roundabout: a little fountain on its centre island
    if (n.plaza) bakeIslandFountain(n.x, n.z);
    // working traffic lights are dynamic objects (chunks.ts) at signalized
    // nodes; chunks only keep the poles' collision boxes
    if (n.signalized) {
      for (const tp of trafficPoles(plan, n)) boxes.push({ x1: tp.x - 0.4, x2: tp.x + 0.4, z1: tp.z - 0.4, z2: tp.z + 0.4, small: 1 });
    }
  }

  // street lamps along the streets of the built-up districts (each street's
  // belong to the chunk holding its midpoint), on its right-hand side,
  // clear of the pads, the track, the lots, the sea and other streets
  if (TPL.lightCurved) {
    for (const e of plan.edges) {
      const a = plan.nodes[e.a], b = plan.nodes[e.b];
      const mx = a.x + e.ux * e.len / 2, mz = a.z + e.uz * e.len / 2;
      if (!inChunk(mx, mz) || !builtD(plan.district(cx, cz))) continue;
      const rx = -e.uz, rz = e.ux; // right of a -> b
      const s0 = nodeReach(plan, a, e) + 4, s1 = e.len - nodeReach(plan, b, e) - 4;
      for (let t = s0 + 7; t < s1; t += 18) {
        const x = a.x + e.ux * t + rx * 7.8, z = a.z + e.uz * t + rz * 7.8;
        if (rail.near(x, z, 9) || occ.claims(x, z, 0.9, LOT | SEA)) continue;
        if (plan.edges.some(o => o.id !== e.id && segDist({ x, z }, plan.nodes[o.a], plan.nodes[o.b]) < 8.5)) continue;
        // the lamp's arm (native -z) reaches back over the road
        bakeModel(B, TPL.lightCurved, x, 0.1, z, Math.atan2(-rx, -rz) - Math.PI, 5.5);
        boxes.push({ x1: x - 0.3, x2: x + 0.3, z1: z - 0.3, z2: z + 0.3, small: 1 });
      }
    }
  }

  // ---- lots: buildings, tree rows and parking, laid out by the plan ----
  for (const lot of plan.lots(cx, cz)) bakeLot(lot);

  /** a collision box for a footprint turned by ry (an AABB bound + the OBB) */
  function obbBox(x: number, z: number, hx: number, hz: number, ry: number): CollisionBox {
    const c = Math.abs(Math.cos(ry)), s = Math.abs(Math.sin(ry));
    const ex = hx * c + hz * s, ez = hx * s + hz * c;
    return { x1: x - ex, x2: x + ex, z1: z - ez, z2: z + ez, obb: { cx: x, cz: z, hx, hz, ry } };
  }

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
        boxes.push(obbBox(lot.x, lot.z, lot.w / 2, lot.d / 2, lot.ry));
      } else {
        // procedural fallback house
        const h = 2.9 * (2 + ((lot.v * 3) | 0)) + 0.6;
        B.box(lot.w / 1.2, h, lot.d / 1.2, HOUSE_COLORS[(lot.v * HOUSE_COLORS.length) | 0], lot.x, h / 2, lot.z, 0, lot.ry, 0);
        B.box(lot.w / 1.2 + 0.3, 0.3, lot.d / 1.2 + 0.3, ROOFS[(lot.v * ROOFS.length) | 0], lot.x, h + 0.15, lot.z, 0, lot.ry, 0);
        boxes.push(obbBox(lot.x, lot.z, lot.w / 2.4, lot.d / 2.4, lot.ry));
      }
    } else if (lot.kind === 'trees') {
      bakeTrees(lot.x, lot.z, 2 + ((lot.v * 2) | 0), lot.w / 2, lot);
    } else {
      // parking lot: slab + a car or two, nosed in from the street
      B.box(lot.w, 0.06, lot.d, 0x828a96, lot.x, 0.14, lot.z, 0, lot.ry, 0);
      const n = 1 + ((lot.v * 2) | 0);
      const ax = Math.cos(lot.ry), az = -Math.sin(lot.ry); // along the street
      for (let i = 0; i < n; i++) {
        const off = (i - (n - 1) / 2) * (lot.w / 2.2);
        const x = lot.x + ax * off, z = lot.z + az * off;
        bakeParkedCar(x, z, lot.ry);
        boxes.push(obbBox(x, z, 1.0, 2.3, lot.ry));
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
        const inOwn = own && inBox(obbBox(own.x, own.z, own.w / 2 + 1, own.d / 2 + 1, own.ry), tx, tz, 0);
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