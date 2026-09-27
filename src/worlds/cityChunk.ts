// The little island city — chunk baker. All design decisions live in the city
// plan (cityPlan.ts, seeded per world); this file just renders one 64 m chunk
// of that plan into a vertex-colored mesh: wide streets, node tiles, round-
// abouts and plazas, lamps, building lots, park ponds, the river with its
// banks, fords and street bridges, and nature scatter.
import * as THREE from 'three';
import { Baked, type BakedData } from '../engine/baked.js';
import { rng, chunkSeed, type Rng } from '../engine/rng.js';
import { bakedModel, type BakedTemplate } from '../engine/assets.js';
import { cityPlanFor, builtD, ROAD_HALF, ROUNDABOUT_REACH, type District, type Lot, type PNode, type PEdge } from './cityPlan.js';
import { segDist } from './streetGen.js';
import { railNetFor } from './railRoute.js';
import { riverFor } from './riverRoute.js';
import { citySeed } from './cityGrid.js';
import { occupancyFor, BLOCKED_FOR_PROPS, STRUCTURED, LOT, SEA } from './grid.js';
import { coastFor, clipToRect, insetShore } from './coast.js';
import { riverDecksFor, riverDeckProfile, type RiverDeck } from './riverDecks.js';
import { WORLD_CHUNKS, ISLAND } from './world.js';
import { raceTrackFor, UNIT, TRACK_HALF, type RaceTrack } from './raceIsland.js';
import { TILE } from './raceLoop.js';

/** the race track's surface height: flush with the street asphalt */
export const TRACK_TOP = 0.19;
import { STRAIT } from './cityGrid.js';
import { chunkRoadPieces, nodePiece, nodeReach, armDir, pieceOutline, trafficPoles } from './roadLayout.js';
import { crosswalksFor, CW_HALF, CW_W } from './crosswalks.js';

export { WORLD_CHUNKS }; // re-exported for the game layer


export interface CollisionBox {
  /** the axis-aligned bound (the whole box, when there is no obb) */
  x1: number; x2: number; z1: number; z2: number;
  small?: number;
  /** a building's roof height (m) — what a helicopter can hit */
  top?: number;
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
  glows: ChunkGlow[];
}

/** what lights up at night (G10) */
export const GLOW = { lamp: 0, flood: 1, floodPool: 2 } as const;
/** a light the chunk bakes (city-local): the game draws its glow at night */
export interface ChunkGlow { x: number; y: number; z: number; kind: number }

const j = (r: Rng, amp: number) => (r() - 0.5) * 2 * amp;
const pick = <T,>(r: Rng, arr: T[]): T => arr[(r() * arr.length) | 0];

// ---- Kenney kit placement helpers ----
const _km = new THREE.Matrix4();
const _kq = new THREE.Quaternion();
const _ke = new THREE.Euler();
const _kv = new THREE.Vector3();
const _ks = new THREE.Vector3();

/** metres per kit unit of Kenney's City Kits (Suburban, Commercial,
 * Industrial share one scale): the Industrial kit's shipping container is
 * 0.37 × 0.35 × 0.82 units, a real 20-ft one 2.44 × 2.6 × 6.1 m. Buildings
 * are baked at this size (±15 %), never stretched to their lot — scaled to
 * fill the lot, a house in a small lot was 2 m tall and a shed in a big one
 * three times a real one (R33) */
export const KIT_M = 7.2;
/** how far a building may be scaled from its true size to fit its lot */
const FIT_MIN = 0.85, FIT_MAX = 1.15;

/** the building for a lot `w` wide (along its street) and `d` deep: among
 * the templates that fit at their true size (±15 %), one of the three that
 * fill it best (picked by `v`, 0…1), with its scale — or null when none fits */
export function fitBuilding(tpls: readonly BakedTemplate[], w: number, d: number, v: number, room = 0.94): { tpl: BakedTemplate; s: number } | null {
  const fits: Array<{ tpl: BakedTemplate; s: number; fill: number }> = [];
  for (const tpl of tpls) {
    const sx = (w * room) / (tpl.size.x * KIT_M), sz = (d * room) / (tpl.size.z * KIT_M);
    const k = Math.min(FIT_MAX, sx, sz);
    if (k < FIT_MIN) continue;
    const s = k * KIT_M;
    fits.push({ tpl, s, fill: (tpl.size.x * s * tpl.size.z * s) / (w * d) });
  }
  if (!fits.length) return null;
  fits.sort((a, b) => b.fill - a.fill);
  const best = fits.slice(0, Math.min(3, fits.length));
  return best[Math.min(best.length - 1, Math.floor(v * best.length))];
}

const SHOP_NAMES = [...'abcdefghijklmn'].map(b => 'bldg-' + b);
const HOUSE_NAMES = [...'abcdefghijklmnopqrstu'].map(b => 'house-' + b);

/** the building a lot carries — the one the chunk baker bakes there (a City
 * Kit shop on a town `bldg` lot, a Suburban house on a `house` lot, R33) —
 * by its template name, with its scale, the centre of its footprint, its
 * half extents and its roof; null where the lot has none (a garden, a
 * court, a works yard, an industrial lot). The mission calls read it (G2):
 * a house fire burns at the real house, and its scene shows the same one. */
export function lotBuilding(lot: Lot, industrial: boolean): { name: string; s: number; x: number; z: number; ry: number; hx: number; hz: number; top: number } | null {
  if (lot.kind !== 'bldg' && lot.kind !== 'house') return null;
  if (lot.kind === 'bldg' && industrial) return null;
  const house = lot.kind === 'house';
  const names = (house ? HOUSE_NAMES : SHOP_NAMES).filter(n => bakedModel(n));
  const fit = fitBuilding(names.map(n => bakedModel(n)!), lot.w, lot.d, lot.v, house ? 0.86 : 0.94);
  if (!fit) return null;
  const name = names.find(n => bakedModel(n) === fit.tpl)!;
  const hx = (fit.tpl.size.x * fit.s) / 2, hz = (fit.tpl.size.z * fit.s) / 2;
  // (a house stands on the front of its lot, a shop in the middle)
  const off = house ? lot.d / 2 - hz - 0.5 : 0;
  const c = Math.cos(lot.ry), sn = Math.sin(lot.ry);
  return { name, s: fit.s, x: lot.x + off * sn, z: lot.z + off * c, ry: lot.ry, hx, hz, top: fit.tpl.size.y * fit.s + (house ? 0.12 : 0.1) };
}

function bakeModel(B: Baked, tpl: BakedTemplate, x: number, y: number, z: number, ry: number, s: number, s3: [number, number, number] | null = null): void {
  _ke.set(0, ry, 0);
  _kq.setFromEuler(_ke);
  if (s3) _ks.set(s3[0], s3[1], s3[2]);
  else _ks.set(s, s, s);
  _km.compose(_kv.set(x, y, z), _kq, _ks);
  // (window panes: shifted by this building's own amount, so no two
  // buildings light the same windows, G10)
  const shift = (Math.abs(Math.sin(x * 12.9898 + z * 78.233) * 43758.5453)) % 1;
  for (const g of tpl.geos) {
    const c = g.clone().applyMatrix4(_km);
    const glow = c.attributes.glow as THREE.BufferAttribute | undefined;
    if (glow) {
      const a = glow.array as Float32Array;
      for (let i = 0; i < a.length; i++) if (a[i] > 0) a[i] = ((a[i] + shift) % 1) || 0.5;
    }
    B.raw(c);
  }
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
    track: {
      straight: bakedModel('rk-straight'),
      corner: bakedModel('rk-corner'),
      finish: bakedModel('rk-finish'),
      tree: bakedModel('tc-tree'),
      pine: bakedModel('tc-pine'),
      tents: bakedModel('rk-tents'),
      forest: bakedModel('rk-forest'),
    },
    road: {
      straight: bakedModel('road-straight'),
      pass: bakedModel('road-straight'),
      cross: bakedModel('road-crossroad'),
      tee: bakedModel('road-intersection'),
      bend: bakedModel('road-bend'),
      end: bakedModel('road-end'),
      round: bakedModel('road-roundabout'),
    },
    cars: ['car-sedan', 'car-suv', 'car-taxi', 'car-hatch'].map(bakedModel).filter((t): t is BakedTemplate => !!t),
    industrial: [...'abcdefghijklmnopqrst'].map(b => bakedModel('ind-' + b)).filter((t): t is BakedTemplate => !!t),
    indTanks: ['ind-tank', 'ind-tank-l']
      .map(bakedModel).filter((t): t is BakedTemplate => !!t),
    containers: ['ind-box-a', 'ind-box-b', 'ind-box-c']
      .map(bakedModel).filter((t): t is BakedTemplate => !!t),
    chimney: bakedModel('ind-chimney-l') ?? bakedModel('ind-chimney-m'),
    // the block filler's lots: suburban houses, garden / courtyard / works-yard props
    houses: [...'abcdefghijklmnopqrstu'].map(b => bakedModel('house-' + b)).filter((t): t is BakedTemplate => !!t),
    gardenTrees: ['sub-tree-large', 'sub-tree-small', 'for-tree', 'for-tree-high', 'sv-tree-autumn']
      .map(bakedModel).filter((t): t is BakedTemplate => !!t),
    /** garden bits with their scale (kit units -> metres) */
    gardenBits: ([['for-plant', 4], ['sub-planter', 4.5], ['for-rocks-low', 2], ['for-stones', 2], ['sv-bucket', 3],
      ['for-tent', 2.2], ['sv-campfire-pit', 5]] as const)
      .map(([n, sc]) => ({ tpl: bakedModel(n), sc, solid: n === 'for-tent' || n === 'for-rocks-low' }))
      .filter((b): b is { tpl: BakedTemplate; sc: 4 | 4.5 | 2 | 3 | 2.2 | 5; solid: boolean } => !!b.tpl),
    planter: bakedModel('sub-planter'),
    flag: bakedModel('for-flag'),
    yardBits: ['sv-barrel', 'sv-barrel-open', 'sv-box', 'sv-box-large', 'sv-box-large-open', 'sv-chest', 'sv-workbench',
      'sv-workbench-anvil', 'sv-resource-planks', 'sv-resource-wood', 'sv-resource-stone-large', 'sv-signpost']
      .map(bakedModel).filter((t): t is BakedTemplate => !!t),
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
/** the kit road's own palette (city-roads colormap), for the procedural
 * polygon pads: asphalt, the darker gutter band, the kerb's top and face */
const ROAD_ASPHALT = 0x666b80;
const ROAD_GUTTER = 0x515566;
const ROAD_KERB = 0xbdc6ee;
const ROAD_KERB_FACE = 0x9da4c4;
/** the kit straight's cross-section (m from its edge): kerb, then gutter */
const KERB_W = 1.4, GUTTER_W = 1.4;

export function slabColor(d: District): number {
  switch (d) {
    case 'forest': return 0x7ba363;
    case 'desert': return 0xe8d29a;
    case 'meadow': return 0xa9c88b;
    case 'green': return 0xa9c88b;
    case 'park': return 0xa4cf85;
    case 'downtown': return 0xdcd6c6;
    case 'residential': return 0xcfe3b4; // lawns
    case 'raceway': return 0x9fcf7f; // the circuit's grass apron
    case 'industrial': return 0xcfccc2; // worn concrete aprons
    default: return 0xe9e1cf; // urban
  }
}

/** ground colour of a chunk (ocean blue outside the island) — for the minimap */
export function chunkGroundColor(bx: number, by: number, cx: number, cz: number): number {
  if (cx < 0 || cz < 0 || cx >= WORLD_CHUNKS || cz >= WORLD_CHUNKS) return 0x6fb7d9;
  return slabColor(cityPlanFor(bx, by).nature(cx, cz) ?? 'green');
}

export function generateCityChunk(bx: number, by: number, cx: number, cz: number): CityChunkResult {
  const { B, boxes, glows } = bakeCityChunk(bx, by, cx, cz);
  return { mesh: B.build(), boxes, glows };
}

/** the same chunk as plain data (the chunk worker's reply) */
export function generateCityChunkData(bx: number, by: number, cx: number, cz: number): { geo: BakedData; boxes: CollisionBox[]; glows: ChunkGlow[] } {
  const { B, boxes, glows } = bakeCityChunk(bx, by, cx, cz);
  return { geo: B.buildData(), boxes, glows };
}

function bakeCityChunk(bx: number, by: number, cx: number, cz: number): { B: Baked; boxes: CollisionBox[]; glows: ChunkGlow[] } {
  const seed = citySeed(bx, by);
  const r = rng(chunkSeed(seed, cx, cz));
  const CH = 64, X0 = cx * CH, Z0 = cz * CH;
  const B = new Baked();
  const boxes: CollisionBox[] = [];
  const glows: ChunkGlow[] = [];
  const TPL = kenneyTPL();
  const plan = cityPlanFor(bx, by);
  const rail = railNetFor(bx, by);
  const river = riverFor(bx, by);
  const occ = occupancyFor(bx, by);
  /** ground outside every block here: a nature corner, or seafront green */
  const ground: District = plan.nature(cx, cz) ?? 'green';

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
    B.box(CH, 0.1, CH, slabColor(ground), X0 + CH / 2, 0.05, Z0 + CH / 2);
  } else {
    slab(clipToRect(coast.pts, X0, Z0, X0 + CH, Z0 + CH), BEACH, 0.09);
    slab(clipToRect(insetShore(coast, 7), X0, Z0, X0 + CH, Z0 + CH), slabColor(ground), 0.1);
  }
  // every block's ground in its district's colour (the blocks meet under the
  // streets, which lie on top)
  for (const bl of plan.blocks) {
    if (bl.district === ground) continue;
    const piece = clipToRect(bl.poly, X0, Z0, X0 + CH, Z0 + CH);
    if (piece.length >= 3) slab(piece, slabColor(bl.district), 0.115);
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
  // (a street bridge with a real deck — riverDecks.ts — keeps the water
  // flowing on underneath; only a plain crossing hides it)
  const decks = riverDecksFor(bx, by);
  const onDeck = (x: number, z: number, kind: 'road' | 'rail', m = 0): boolean => decks.some(d => {
    if (d.kind !== kind) return false;
    const t = (x - d.ax) * d.ux + (z - d.az) * d.uz;
    return t > -m && t < d.len + m && Math.abs((x - d.ax) * d.uz - (z - d.az) * d.ux) < d.half + m;
  });
  const bridges = plan.riverBridges.filter(b => b.x > X0 - 30 && b.x < X0 + CH + 30 && b.z > Z0 - 30 && b.z < Z0 + CH + 30)
    .filter(b => !onDeck(b.x, b.z, 'road'));
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
      const bankD = plan.districtAt(tx, tz);
      const bankTpl = bankD === 'desert' ? pick(r, [...TPL.cacti, ...TPL.rocks])
        : bankD === 'forest' ? pick(r, TPL.pines) : pick(r, TPL.trees);
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

  // real bridges: the road rises onto a humped deck over the water
  for (const d of decks) {
    if (d.kind !== 'road') continue;
    const mx = d.ax + d.ux * d.len / 2, mz = d.az + d.uz * d.len / 2;
    if (mx >= X0 && mx < X0 + CH && mz >= Z0 && mz < Z0 + CH) bakeBridgeDeck(d);
  }
  /** a box `w` wide, `h` tall, `l` long, turned to the deck's heading and
   * tilted to its slope, centred `t` along it and `a` across (+ = right) */
  function deckBox(d: RiverDeck, t: number, l: number, a: number, w: number, h: number, lift: number, color: number): void {
    const y0 = riverDeckProfile(d, t - l / 2), y1 = riverDeckProfile(d, t + l / 2);
    const pitch = Math.atan2(y1 - y0, l);
    const g = new THREE.BoxGeometry(w, h, l / Math.cos(pitch) + 0.04);
    g.rotateX(-pitch);
    g.rotateY(d.heading);
    const rx = Math.cos(d.heading), rz = -Math.sin(d.heading);
    g.translate(d.ax + d.ux * t + rx * a, (y0 + y1) / 2 + lift, d.az + d.uz * t + rz * a);
    B.add(g, color);
  }
  function bakeBridgeDeck(d: RiverDeck): void {
    const TOP = 0.13; // the kit road's top (the tiles rest at 0.1)
    const STEP = 2;
    for (let t = 0; t < d.len - 1e-6; t += STEP) {
      const l = Math.min(STEP, d.len - t), tm = t + l / 2;
      deckBox(d, tm, l, 0, ROAD_HALF * 2, 0.5, TOP - 0.25, ROAD_ASPHALT);
      for (const sd of [-1, 1]) {
        // kerb, walkway and a cream parapet
        deckBox(d, tm, l, sd * (ROAD_HALF + 0.35), 0.7, 0.62, TOP - 0.19, ROAD_KERB);
        deckBox(d, tm, l, sd * (ROAD_HALF + 1.8), 2.2, 0.6, TOP - 0.2, SIDEWALK);
        deckBox(d, tm, l, sd * (d.half - 0.25), 0.5, 1.4, TOP + 0.4, 0xe8e4d8);
        // steel fascia girders under the raised part
        if (riverDeckProfile(d, tm) > 0.35) deckBox(d, tm, l, sd * (d.half - 0.6), 0.9, 0.9, TOP - 0.85, BRIDGE_STEEL);
      }
      if (Math.floor(t / STEP) % 3 === 0) deckBox(d, tm, Math.min(1.6, l), 0, 0.25, 0.04, TOP + 0.02, 0xe8e4d8);
    }
    // stone piers on both banks, down into the river bed
    const pts = river.pts;
    for (const sd of [-1, 1]) {
      // where the water's edge meets the deck
      let tb = -1;
      for (let t = d.len / 2; t > 0 && t < d.len; t += sd * 0.5) {
        const x = d.ax + d.ux * t, z = d.az + d.uz * t;
        if (!river.near(x, z, river.halfAt(x, z) + 0.5)) { tb = t; break; }
      }
      if (tb < 0 || !pts.length) continue;
      const y = riverDeckProfile(d, tb);
      const g = new THREE.BoxGeometry(d.half * 2 - 1, y + 0.4, 1.4);
      g.rotateY(d.heading);
      g.translate(d.ax + d.ux * tb, (y + 0.4) / 2 - 0.2 + TOP - 0.45, d.az + d.uz * tb);
      B.add(g, 0xbfb5a3);
    }
  }

  // (the causeway decks to the neighbouring islands are streamed on their
  // own — games/city/causeways.ts — not baked with a chunk, R29)

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
  // polygon pads: flush with the kit asphalt (0.01 native units x4 up from
  // ROAD_Y), the kerb band 4 cm higher, like the kit's
  const PAD_Y = ROAD_Y + 0.04, KERB_Y = ROAD_Y + 0.08;
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
  /** an oblique pad dressed as the kit straight is across: the kit's
   * asphalt, and along every kerb edge (all but the 14 m arm mouths) the
   * gutter band and the raised kerb, mitred where two kerbs meet — so the
   * straights' kerbs run on round the corner instead of stopping at a bare
   * slab */
  function padSurface(raw: Array<{ x: number; z: number }>): void {
    const poly = raw.filter((q, i) => Math.hypot(q.x - raw[(i + 1) % raw.length].x, q.z - raw[(i + 1) % raw.length].z) > 0.05);
    const N = poly.length;
    if (N < 3) return;
    flat(poly, ROAD_ASPHALT, PAD_Y);
    let area = 0;
    for (let i = 0; i < N; i++) { const a = poly[i], b = poly[(i + 1) % N]; area += a.x * b.z - b.x * a.z; }
    const inSg = area > 0 ? 1 : -1; // which side of each edge is inside
    const kerb = poly.map((a, i) => {
      const b = poly[(i + 1) % N];
      return Math.abs(Math.hypot(b.x - a.x, b.z - a.z) - ROAD_HALF * 2) >= 0.05;
    });
    /** vertex i moved in by w off every kerb edge meeting it (the mouths stay put) */
    const inset = (i: number, w: number): { x: number; z: number } => {
      const lines = [(i - 1 + N) % N, i].map(k => {
        const a = poly[k], b = poly[(k + 1) % N];
        const L = Math.hypot(b.x - a.x, b.z - a.z);
        const u = { x: (b.x - a.x) / L, z: (b.z - a.z) / L };
        const o = kerb[k] ? w : 0;
        // the edge's line moved in by o, through the moved vertex i
        return { p: { x: poly[i].x - u.z * inSg * o, z: poly[i].z + u.x * inSg * o }, u };
      });
      const [l1, l2] = lines;
      const den = l1.u.x * l2.u.z - l1.u.z * l2.u.x;
      // (in line: both moved the same way; take the one that moved)
      if (Math.abs(den) < 1e-6) return kerb[i] ? l2.p : l1.p;
      const t = ((l2.p.x - l1.p.x) * l2.u.z - (l2.p.z - l1.p.z) * l2.u.x) / den;
      return { x: l1.p.x + l1.u.x * t, z: l1.p.z + l1.u.z * t };
    };
    const k1 = poly.map((_, i) => inset(i, KERB_W));
    const k2 = poly.map((_, i) => inset(i, KERB_W + GUTTER_W));
    for (let i = 0; i < N; i++) {
      if (!kerb[i]) continue;
      const j = (i + 1) % N;
      flat([k1[i], k1[j], k2[j], k2[i]], ROAD_GUTTER, PAD_Y + 0.004);
      flat([poly[i], poly[j], k1[j], k1[i]], ROAD_KERB, KERB_Y);
      // the kerb's face, down to the gutter
      const a = k1[i], b = k1[j];
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute([
        a.x, PAD_Y, a.z, b.x, PAD_Y, b.z, b.x, KERB_Y, b.z,
        a.x, PAD_Y, a.z, b.x, KERB_Y, b.z, a.x, KERB_Y, a.z,
      ], 3));
      g.computeVertexNormals();
      // (face the pad's middle, whichever way the quad wound)
      const nrm = g.attributes.normal as THREE.BufferAttribute;
      const toIn = { x: k2[i].x - a.x, z: k2[i].z - a.z };
      if (nrm.getX(0) * toIn.x + nrm.getZ(0) * toIn.z < 0) {
        g.setAttribute('position', new THREE.Float32BufferAttribute([
          a.x, PAD_Y, a.z, b.x, KERB_Y, b.z, b.x, PAD_Y, b.z,
          a.x, PAD_Y, a.z, a.x, KERB_Y, a.z, b.x, KERB_Y, b.z,
        ], 3));
        g.computeVertexNormals();
      }
      g.setAttribute('uv', new THREE.Float32BufferAttribute(new Array(12).fill(0), 2)); // (merged with the rest)
      B.add(g, ROAD_KERB_FACE);
    }
  }
  for (const p of chunkRoadPieces(plan, cx, cz)) {
    // past the shore a causeway avenue is a deck, not road tiles; over the
    // river the bridge deck carries the street
    if (occ.bits(p.x, p.z) & SEA) continue;
    if (p.kind === 'straight' && onDeck(p.x, p.z, 'road', -0.5)) continue;
    if (p.kind === 'pad') {
      padSurface(p.poly!);
      continue;
    }
    if (hasRoadKit) {
      // (plain pads: the crosswalks are painted below, where people cross —
      // the kit's -path pads striped them inside the pad, beside it)
      const tpl = p.kind === 'cross' ? R.cross : p.kind === 'tee' ? R.tee : R[p.kind];
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

  // crosswalks (crosswalks.ts): white stripes along each arm, spread across
  // the carriageway just beyond the junction's pad — each painted by the
  // chunk holding its middle
  for (const cw of crosswalksFor(bx, by).list) {
    if (!inChunk(cw.x, cw.z)) continue;
    const ry = Math.atan2(cw.lx, cw.lz), px = -cw.lz, pz = cw.lx;
    const n = Math.floor((2 * CW_HALF) / 1.0);
    for (let k = 0; k < n; k++) {
      const lat = -CW_HALF + 0.5 + k * ((2 * CW_HALF - 1) / (n - 1));
      B.box(0.5, 0.02, CW_W, 0xf4f1ea, cw.x + px * lat, ROAD_Y + 0.052, cw.z + pz * lat, 0, ry, 0);
    }
  }

  // sidewalk bands in the built-up districts: the kit's kerb strip widened
  // out to the lot line (7 -> 8.1 m), in the kit's own pavement colour, along
  // every street span between pads (each street's bands belong to the chunk
  // holding its midpoint), broken at river bridges and at the shore
  /** a street is built up when either side of its middle is */
  const edgeBuilt = (e: PEdge): boolean => {
    const a = plan.nodes[e.a];
    const mx = a.x + e.ux * e.len / 2, mz = a.z + e.uz * e.len / 2;
    return builtD(plan.districtAt(mx - e.uz * 14, mz + e.ux * 14)) || builtD(plan.districtAt(mx + e.uz * 14, mz - e.ux * 14));
  };
  const nodeBuilt = (n: PNode): boolean =>
    [[-12, -12], [12, -12], [-12, 12], [12, 12]].some(([dx, dz]) => builtD(plan.districtAt(n.x + dx, n.z + dz)));
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
    if (!inChunk(mx, mz) || !edgeBuilt(e)) continue;
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
    if (!inChunk(n.x, n.z) || n.mouth || n.plaza || !nodeBuilt(n)) continue;
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
      if (!inChunk(mx, mz) || !edgeBuilt(e)) continue;
      const rx = -e.uz, rz = e.ux; // right of a -> b
      const s0 = nodeReach(plan, a, e) + 4, s1 = e.len - nodeReach(plan, b, e) - 4;
      for (let t = s0 + 7; t < s1; t += 18) {
        const x = a.x + e.ux * t + rx * 7.8, z = a.z + e.uz * t + rz * 7.8;
        if (rail.near(x, z, 9) || occ.claims(x, z, 0.9, LOT | SEA)) continue;
        if (plan.edges.some(o => o.id !== e.id && segDist({ x, z }, plan.nodes[o.a], plan.nodes[o.b]) < 8.5)) continue;
        // the lamp's arm (native -z) reaches back over the road
        bakeModel(B, TPL.lightCurved, x, 0.1, z, Math.atan2(-rx, -rz) - Math.PI, 5.5);
        boxes.push({ x1: x - 0.3, x2: x + 0.3, z1: z - 0.3, z2: z + 0.3, small: 1 });
        // (its bulb hangs under the arm's end: native (0, 0.66, -0.19) × 5.5)
        glows.push({ x: x - rx * 1.05, y: 3.55, z: z - rz * 1.05, kind: GLOW.lamp });
      }
    }
  }

  // ---- a race island's circuit (R32): the Toy Car Kit track, each piece
  // laid by the chunk holding its middle, flush with the street asphalt; the
  // finish gate, tents outside the start straight, forest in the infield,
  // cones round the corners and trees on the apron ----
  const race = raceTrackFor(bx, by);
  if (race) bakeCircuit(race);
  function bakeCircuit(T: RaceTrack): void {
    // the Racing Kit's 10-unit tiles at UNIT m a unit across, their low
    // walls and corner stands a little taller than native; the road surface
    // is the tile's base (its kerbs 0.1 units up, R15), laid just over the
    // ground slabs
    const SY = 1.4;
    const y = 0.16;
    for (const p of T.pieces) {
      if (!inChunk(p.mx, p.mz)) continue;
      const tpl = p.kind === 'finish' ? TPL.track.finish ?? TPL.track.straight : p.kind === 'straight' ? TPL.track.straight : TPL.track.corner;
      if (tpl) bakeModel(B, tpl, p.x, y, p.z, p.ry, 1, [UNIT, SY, UNIT]);
    }
    if (!TPL.track.straight) {
      // no kit: a plain asphalt ribbon along the centreline
      for (let k = 0; k < T.path.length; k++) {
        const a = T.path[k], b = T.path[(k + 1) % T.path.length];
        if (!inChunk(a.x, a.z)) continue;
        B.box(TRACK_HALF * 2, 0.08, Math.hypot(b.x - a.x, b.z - a.z) + 0.3, ROAD_ASPHALT, (a.x + b.x) / 2, TRACK_TOP - 0.04, (a.z + b.z) / 2, 0, a.h, 0);
      }
    }
    // a chequered start line across the finish tile
    const st = T.sample(T.startS);
    if (inChunk(st.x, st.z)) {
      const rx = Math.cos(st.h), rz = -Math.sin(st.h); // right of the heading
      for (let k = 0; k < 12; k++) {
        const off = -TRACK_HALF + (k + 0.5) * (TRACK_HALF * 2 / 12);
        B.box(TRACK_HALF * 2 / 12, 0.02, 1, k % 2 ? 0x2b2b2b : 0xf4f4f4, st.x + rx * off, TRACK_TOP + 0.02, st.z + rz * off, 0, st.h, 0);
      }
    }
    // the infield: the kit's forest and tent tiles, solid (a truck that
    // wanders in bumps them; the karts' soft walls keep them on the track)
    for (const d of T.decor) {
      if (!inChunk(d.x, d.z)) continue;
      const tpl = d.kind === 'tents' ? TPL.track.tents : TPL.track.forest;
      if (!tpl) continue;
      bakeModel(B, tpl, d.x, 0.1, d.z, d.ry, 1, [UNIT, SY, UNIT]);
      boxes.push(obbBox(d.x, d.z, TILE / 2 - 3, TILE / 2 - 3, d.ry));
    }
    // floodlight towers round the circuit (G10): every ~60 m of the loop,
    // 12 m off the centreline — outside the karts' soft walls (9.2 m) —, on
    // the side clear of the infield tiles, another stretch and anything
    // built; a pole, a lamp bank tilted down at the track, and at night the
    // bank's glow and a pool of light on the track
    for (let s = T.startS + 30; s < T.startS + 30 + T.length - 20; s += 60) {
      const p = T.sample(s);
      const rx = Math.cos(p.h), rz = -Math.sin(p.h);
      for (const side of [1, -1]) {
        const x = p.x + rx * side * 12, z = p.z + rz * side * 12;
        if (!T.inZone(x, z, -2) || T.nearest(x, z).d < 11) continue;
        if (T.decor.some(d => Math.hypot(d.x - x, d.z - z) < TILE * 0.62)) continue;
        if (occ.claims(x, z, 1, STRUCTURED)) continue;
        if (inChunk(x, z)) {
          const yaw = Math.atan2(p.x - x, p.z - z);
          B.cyl(0.22, 0.32, 12, 8, 0x8d939e, x, 6, z);
          B.box(0.6, 0.6, 0.6, 0x5a6472, x, 0.3, z);
          // the lamp bank faces the track, tilted down
          B.box(3, 1.1, 0.35, 0x3c4450, x + Math.sin(yaw) * 0.3, 12.2, z + Math.cos(yaw) * 0.3, -0.45, yaw, 0);
          boxes.push({ x1: x - 0.45, x2: x + 0.45, z1: z - 0.45, z2: z + 0.45, small: 1 });
          glows.push({ x: x + Math.sin(yaw) * 0.6, y: 12.1, z: z + Math.cos(yaw) * 0.6, kind: GLOW.flood });
          glows.push({ x: p.x + rx * side * 2, y: 0, z: p.z + rz * side * 2, kind: GLOW.floodPool });
        }
        break;
      }
    }
    // trees on the apron, clear of the track and the infield tiles
    const trees = [TPL.track.tree, TPL.track.pine].filter((t): t is BakedTemplate => !!t);
    for (let i = 0; i < 14 && trees.length; i++) {
      const x = X0 + 4 + r() * (CH - 8), z = Z0 + 4 + r() * (CH - 8);
      if (!T.inZone(x, z, -2) || T.nearest(x, z).d < TILE / 2 + 3) continue;
      if (T.decor.some(d => Math.hypot(d.x - x, d.z - z) < TILE * 0.72)) continue;
      if (occ.claims(x, z, 1.2, STRUCTURED)) continue;
      bakeModel(B, pick(r, trees), x, 0.1, z, r() * Math.PI * 2, (4.5 + r() * 2) / 0.83);
      boxes.push({ x1: x - 0.6, x2: x + 0.6, z1: z - 0.6, z2: z + 0.6, small: 1 });
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
      const industrial = plan.districtAt(lot.x, lot.z) === 'industrial';
      const tpls = industrial ? TPL.industrial : TPL.buildings;
      if (tpls.length) {
        // occasionally an industrial lot is a big tank (true size too)
        const tank = industrial && TPL.indTanks.length && r() < 0.22;
        // (a town building: the one lotBuilding names, so the calls agree)
        const town = !industrial ? lotBuilding(lot, false) : null;
        const fit = town ? { tpl: bakedModel(town.name)!, s: town.s } : industrial ? fitBuilding(tank ? TPL.indTanks : tpls, lot.w, lot.d, lot.v) : null;
        if (!fit) {
          // (no building fits this lot at its true size: a works yard / a
          // paved court instead of a stretched or shrunk one)
          if (industrial) bakeYard(lot); else bakeCourt(lot);
          return;
        }
        const { tpl, s } = fit;
        // (the lot around a building smaller than it is paved)
        if (!industrial) B.box(lot.w - 0.3, 0.04, lot.d - 0.3, 0xc9c6bd, lot.x, 0.12, lot.z, 0, lot.ry, 0);
        bakeModel(B, tpl, lot.x, 0.1, lot.z, lot.ry, s);
        boxes.push({ ...obbBox(lot.x, lot.z, (tpl.size.x * s) / 2, (tpl.size.z * s) / 2, lot.ry), top: tpl.size.y * s + 0.1 });
      } else {
        // procedural fallback house
        const h = 2.9 * (2 + ((lot.v * 3) | 0)) + 0.6;
        B.box(lot.w / 1.2, h, lot.d / 1.2, HOUSE_COLORS[(lot.v * HOUSE_COLORS.length) | 0], lot.x, h / 2, lot.z, 0, lot.ry, 0);
        B.box(lot.w / 1.2 + 0.3, 0.3, lot.d / 1.2 + 0.3, ROOFS[(lot.v * ROOFS.length) | 0], lot.x, h + 0.15, lot.z, 0, lot.ry, 0);
        boxes.push({ ...obbBox(lot.x, lot.z, lot.w / 2.4, lot.d / 2.4, lot.ry), top: h + 0.3 });
      }
    } else if (lot.kind === 'trees') {
      bakeTrees(lot.x, lot.z, 2 + ((lot.v * 2) | 0), lot.w / 2, lot);
    } else if (lot.kind === 'house') {
      bakeHouse(lot);
    } else if (lot.kind === 'garden') {
      bakeGarden(lot);
    } else if (lot.kind === 'court') {
      bakeCourt(lot);
    } else if (lot.kind === 'yard') {
      bakeYard(lot);
    } else {
      // parking lot: slab + rows of bays, nosed in from the street, about
      // two in three taken
      B.box(lot.w, 0.06, lot.d, 0x828a96, lot.x, 0.14, lot.z, 0, lot.ry, 0);
      const cols = Math.max(1, Math.floor(lot.w / 2.9)), rows = Math.max(1, Math.floor(lot.d / 5.6));
      for (let q = 0; q < rows; q++) for (let i = 0; i < cols; i++) {
        if (r() > 0.66 && cols * rows > 1) continue;
        const p = lotPt(lot, (i - (cols - 1) / 2) * (lot.w / cols), (q - (rows - 1) / 2) * (lot.d / rows));
        bakeParkedCar(p.x, p.z, lot.ry);
        boxes.push(obbBox(p.x, p.z, 1.0, 2.3, lot.ry));
      }
    }
  }

  /** a point in lot-local metres (x along its width, z along its depth) */
  function lotPt(lot: Lot, lx: number, lz: number): { x: number; z: number } {
    const c = Math.cos(lot.ry), sn = Math.sin(lot.ry);
    return { x: lot.x + lx * c + lz * sn, z: lot.z - lx * sn + lz * c };
  }
  /** a kit prop inside a lot: scaled to `h` metres tall, with a small box */
  function prop(lot: Lot, tpl: BakedTemplate | null | undefined, lx: number, lz: number, h: number, yaw = 0, solid = true, scale = 0): void {
    if (!tpl) return;
    const p = lotPt(lot, lx, lz);
    // scaled to a height, or (flat kit pieces: planks, logs) by a fixed factor
    const s = scale || h / Math.max(0.01, tpl.size.y);
    bakeModel(B, tpl, p.x, 0.12, p.z, lot.ry + yaw, s);
    if (solid) {
      const hx = Math.max(0.3, (tpl.size.x * s) / 2), hz = Math.max(0.3, (tpl.size.z * s) / 2);
      boxes.push({ ...obbBox(p.x, p.z, hx, hz, lot.ry + yaw), small: 1 });
    }
  }

  /** a suburban house (City Kit Suburban), front to the lot's street side */
  function bakeHouse(lot: Lot): void {
    // a house at its true size, or a garden where none fits (a small lot held
    // a 2 m "dog house")
    // (the house lotBuilding names, so the calls agree)
    const b = TPL.houses.length ? lotBuilding(lot, false) : null;
    if (!b) { bakeGarden(lot); return; }
    const tpl = bakedModel(b.name)!, s = b.s;
    // the house on the front of the lot, a strip of lawn behind
    const hd = (tpl.size.z * s) / 2;
    const p = lotPt(lot, 0, lot.d / 2 - hd - 0.5);
    B.box(lot.w - 0.3, 0.04, lot.d - 0.3, 0xa8d487, lot.x, 0.13, lot.z, 0, lot.ry, 0);
    bakeModel(B, tpl, p.x, 0.12, p.z, lot.ry, s);
    boxes.push({ ...obbBox(p.x, p.z, (tpl.size.x * s) / 2, hd, lot.ry), top: tpl.size.y * s + 0.12 });
    // and a tree in the back garden when there is room for one
    if (lot.d - hd * 2 > 3.5 && TPL.gardenTrees.length && lot.v > 0.35) {
      prop(lot, TPL.gardenTrees[((lot.v * 7) | 0) % TPL.gardenTrees.length], (lot.v - 0.5) * lot.w * 0.6, -lot.d / 2 + 1.8, 4.5 + lot.v * 1.5);
    }
  }

  /** a fenced lawn with trees and garden bits (Mini Forest, Survival Kit) */
  function bakeGarden(lot: Lot): void {
    B.box(lot.w - 0.3, 0.04, lot.d - 0.3, 0x9fd07a, lot.x, 0.13, lot.z, 0, lot.ry, 0);
    // a low white picket fence round it
    const hw = lot.w / 2 - 0.2, hd = lot.d / 2 - 0.2;
    for (const [lx, lz, len, along] of [[0, hd, lot.w - 0.4, true], [0, -hd, lot.w - 0.4, true], [hw, 0, lot.d - 0.4, false], [-hw, 0, lot.d - 0.4, false]] as const) {
      const p = lotPt(lot, lx, lz);
      B.box(along ? len : 0.08, 0.55, along ? 0.08 : len, 0xf4f1ea, p.x, 0.4, p.z, 0, lot.ry, 0);
    }
    const nT = lot.w * lot.d > 90 ? 2 : 1;
    for (let i = 0; i < nT && TPL.gardenTrees.length; i++) {
      const lx = (r() - 0.5) * (lot.w - 3.5), lz = (r() - 0.5) * (lot.d - 3.5);
      prop(lot, pick(r, TPL.gardenTrees), lx, lz, 4 + r() * 2.2, r() * Math.PI * 2);
    }
    if (TPL.gardenBits.length && lot.w > 6) {
      const bit = pick(r, TPL.gardenBits);
      prop(lot, bit.tpl, (r() - 0.5) * (lot.w - 3), (r() - 0.5) * (lot.d - 3), 0, r() * Math.PI * 2, bit.solid, bit.sc);
    }
  }

  /** a paved courtyard: planters with small trees, benches, a flag */
  function bakeCourt(lot: Lot): void {
    B.box(lot.w - 0.2, 0.05, lot.d - 0.2, 0xd9d1c1, lot.x, 0.14, lot.z, 0, lot.ry, 0);
    const n = lot.w > 10 ? 2 : 1;
    for (let i = 0; i < n; i++) {
      const lx = n === 1 ? 0 : (i - 0.5) * lot.w * 0.45;
      prop(lot, TPL.planter, lx, 0, 0.9);
      prop(lot, bakedModel('sub-tree-small') ?? TPL.gardenTrees[0], lx, 0, 3.6, r() * 6, false);
    }
    for (const sd of [-1, 1]) {
      const p = lotPt(lot, sd * lot.w * 0.3, sd * (lot.d / 2 - 1.3));
      B.box(1.6, 0.08, 0.45, 0xa9805a, p.x, 0.55, p.z, 0, lot.ry, 0);
    }
    if (TPL.flag && lot.v > 0.6) prop(lot, TPL.flag, lot.w / 2 - 1, -lot.d / 2 + 1, 3.2);
  }

  /** a works yard: crates, barrels, timber and stone (Survival Kit), and
   * rows of shipping containers — real-size, some stacked two high — on
   * the big ones */
  function bakeYard(lot: Lot): void {
    B.box(lot.w - 0.2, 0.05, lot.d - 0.2, 0xbdb29c, lot.x, 0.14, lot.z, 0, lot.ry, 0);
    if (lot.w >= 12 && TPL.containers.length && lot.v > 0.4) {
      const c0 = TPL.containers[0], cw = c0.size.x * KIT_M, cl = c0.size.z * KIT_M, ch = c0.size.y * KIT_M;
      // (the yard's left 45 %, the containers' long side along the lot)
      const cols = Math.max(1, Math.floor((lot.w * 0.45) / (cw + 0.4))), rows = Math.max(1, Math.floor((lot.d - 2) / (cl + 0.5)));
      for (let i = 0; i < cols; i++) for (let q = 0; q < rows; q++) {
        const lx = -lot.w / 2 + 1 + (cw + 0.4) * (i + 0.5), lz = (q - (rows - 1) / 2) * (cl + 0.5);
        const p = lotPt(lot, lx, lz), high = r() < 0.4 ? 2 : 1;
        for (let k = 0; k < high; k++) bakeModel(B, pick(r, TPL.containers), p.x, 0.12 + k * ch, p.z, lot.ry, KIT_M);
        boxes.push({ ...obbBox(p.x, p.z, cw / 2, cl / 2, lot.ry), top: high * ch + 0.12 });
      }
    }
    const n = Math.min(18, 3 + ((lot.w * lot.d) / 16 | 0));
    for (let i = 0; i < n && TPL.yardBits.length; i++) {
      const lx = (r() - 0.5) * (lot.w - 2.5) * (lot.w >= 12 && lot.v > 0.4 ? 0.4 : 1) + (lot.w >= 12 && lot.v > 0.4 ? lot.w * 0.25 : 0);
      const lz = (r() - 0.5) * (lot.d - 2.5);
      // the Survival Kit at 4x: a crate ~1 m, a plank stack ~2.5 m
      prop(lot, pick(r, TPL.yardBits), lx, lz, 0, ((r() * 4) | 0) * (Math.PI / 2), true, 3.6 + r() * 0.8);
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

  // ---- district dressing, by the district at each spot ----
  // parks: a pond at the park block's middle (the chunk holding it lays it)
  for (const bl of plan.blocks) {
    if (bl.district !== 'park' || !inChunk(bl.cx, bl.cz)) continue;
    const px = bl.cx, pz = bl.cz;
    const pr = 8 + r() * 3;
    if (occ.claims(px, pz, pr + 2, BLOCKED_FOR_PROPS)) continue;
    B.cyl(pr, pr, 0.08, 18, 0x7fc4de, px, 0.16, pz);
    B.cyl(pr + 1.4, pr + 1.4, 0.06, 18, 0xd9cdb4, px, 0.15, pz); // sandy rim
    for (let k = 0; k < 7; k++) {
      const ang = (k / 7) * Math.PI * 2 + r();
      bakeTrees(px + Math.cos(ang) * (pr + 6), pz + Math.sin(ang) * (pr + 6), 1, 2.5);
    }
    for (const sd of [-1, 1]) B.box(1.6, 0.08, 0.45, 0xa9805a, px + sd * (pr + 3.5), 0.55, pz + j(r, 3));
  }
  // trees, rocks and cacti on open ground: thick in the forest, a scatter in
  // meadows, desert and parks, a few on the green
  for (let i = 0; i < 30; i++) {
    const x = X0 + 5 + r() * (CH - 10), z = Z0 + 5 + r() * (CH - 10);
    const d = plan.districtAt(x, z);
    const keep = d === 'forest' ? 1 : d === 'meadow' ? 0.6 : d === 'desert' ? 0.45 : d === 'park' ? 0.4 : d === 'green' ? 0.27 : 0;
    const roll = r(), s = 3.5 + r() * 2.5, rot = r() * Math.PI * 2;
    if (roll >= keep || occ.claims(x, z, 1.2, BLOCKED_FOR_PROPS)) continue;
    const tpl = d === 'forest' ? pick(r, [...TPL.pines, ...TPL.trees])
      : d === 'desert' ? pick(r, [...TPL.cacti, ...TPL.rocks])
      : d === 'green' ? pick(r, [...TPL.trees, ...TPL.pines]) : pick(r, TPL.trees);
    if (!tpl) continue;
    bakeModel(B, tpl, x, 0.08, z, rot, s);
    boxes.push({ x1: x - 0.6, x2: x + 0.6, z1: z - 0.6, z2: z + 0.6, small: 1 });
  }
  // industry: a chimney or water tower on the works' open ground
  if (TPL.chimney || TPL.waterTower) {
    for (let t = 0; t < 6; t++) {
      const x = X0 + 12 + r() * (CH - 24), z = Z0 + 12 + r() * (CH - 24);
      if (plan.districtAt(x, z) !== 'industrial') continue;
      const big = r() < 0.5 && TPL.chimney ? TPL.chimney : TPL.waterTower;
      if (!big) continue;
      const s = big === TPL.chimney ? 3.2 + r() * 1.6 : 4.5 + r();
      // (the ground it stands on is its real footprint, not a token 1.6 m:
      // a 5 m water tower claimed 1.6 m and stood on a bridge's walkway)
      const half = (Math.max(big.size.x, big.size.z) * s) / 2;
      if (occ.claims(x, z, half + 0.5, BLOCKED_FOR_PROPS)) continue;
      bakeModel(B, big, x, 0.1, z, r() * Math.PI * 2, s);
      boxes.push({ x1: x - half, x2: x + half, z1: z - half, z2: z + half, top: big.size.y * s + 0.1 });
      break;
    }
  }

  return { B, boxes, glows };
}