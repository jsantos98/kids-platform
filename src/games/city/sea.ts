// The sea: a gently waving ocean plane that follows the player, and each
// island's own Kenney watercraft fleet (Fleet — owned by the island's
// simulation, so boats never jump between islands). The per-city shoreline
// dressing (foam, pier, dinghies, buoys, the picnic causeway) lives in
// scenery.ts; what stands in the water, in harbour.ts.
//
// The fleet (G5, G14): three lanes round the island — calm boats both ways
// round (26 m and 36 m out, one way each, so two never meet head-on) and
// the speedboats further out (46 m) — each lane's boats at one pace and
// spread evenly along it, so none ever runs into another; and the big ships
// (cargo ships, ocean liners) out beyond them, one on each stretch of coast
// between two causeways, going out along it and back on a loop. Every lane
// swings out round the picnic bridge and island (the old lane sailed through
// the bridge). A boat's place is a pure function of the clock (`footprints`),
// so the kid's boat can bump into it (G14). The fleet draws as one instanced
// mesh per model.
import * as THREE from 'three';
import { nightLights } from './nightLights.js';
import { mat } from '../../engine/stage.js';
import { bakedModel, prepBakedModels, type BakeDef } from '../../engine/assets.js';
import { templateToMesh } from '../../engine/baked.js';
import { rng } from '../../engine/rng.js';
import { ISLAND, CENTER, SCALE } from '../../worlds/world.js';
import { coastFor } from '../../worlds/coast.js';
import { southExit, eastExit, CITY_PITCH } from '../../worlds/cityGrid.js';
import { RAIL_OFFSET } from '../../worlds/railRoute.js';
import { harbourFor, inSeaBox } from './harbour.js';
import { isletsFor } from './islets.js';

// gentle deterministic swell — crests stay under the island slabs (top y=0.1).
export function waveAt(x: number, z: number, t: number): number {
  return 0.032 * Math.sin(0.075 * x + t * 0.9)
       + 0.026 * Math.sin(0.105 * z - t * 0.7)
       + 0.018 * Math.sin(0.05 * (x + z) + t * 0.5);
}

type Pt = { x: number; z: number };

const smooth = (t: number): number => { const c = Math.max(0, Math.min(1, t)); return c * c * (3 - 2 * c); };

/** the four corridors that meet island (bx, by)'s shore: [vertical?, avenue
 * coordinate, side] */
const corridors = (bx: number, by: number): Array<[boolean, number, number]> => [
  [true, southExit(bx, by - 1) * 64, -1], [true, southExit(bx, by) * 64, 1],
  [false, eastExit(bx - 1, by) * 64, -1], [false, eastExit(bx, by) * 64, 1],
];

/** the picnic bridge and island, as one rectangle (city-local) */
function picnicRect(bx: number, by: number): { x1: number; z1: number; x2: number; z2: number } {
  const h = harbourFor(bx, by);
  return {
    x1: Math.min(h.bridgeDeck.x1, h.isle.x1), x2: Math.max(h.bridgeDeck.x2, h.isle.x2),
    z1: Math.min(h.bridgeDeck.z1, h.isle.z1), z2: Math.max(h.bridgeDeck.z2, h.isle.z2),
  };
}
const nearRect = (R: { x1: number; z1: number; x2: number; z2: number }, p: Pt, m: number): boolean =>
  p.x > R.x1 - m && p.x < R.x2 + m && p.z > R.z1 - m && p.z < R.z2 + m;

const rings = new Map<string, Pt[]>();

/** the widest lane's distance past the sailing lane (the speedboats') */
const OUTER = 20;

/** a closed lane round island (bx, by), resampled every ~3 m (city-local):
 * the sailing lane — the shore pushed 26 m out, swinging out to 44 m under
 * the causeways' raised spans, round the picnic bridge and island with room
 * for the outer lanes too — and the others `extra` m further out along its
 * normal: parallel to it (pushed out from the island's centre instead, they
 * came within a boat's width of each other on a steep headland's flank, and
 * all met round the picnic island) */
function laneRing(bx: number, by: number, extra: number): Pt[] {
  const key = `${bx},${by},${extra}`;
  const hit = rings.get(key);
  if (hit) return hit;
  if (extra) {
    const B = laneRing(bx, by, 0), n = B.length;
    const off = B.map((p, i) => {
      const a = B[(i - 4 + n) % n], b = B[(i + 4) % n];
      const tx = b.x - a.x, tz = b.z - a.z, tl = Math.hypot(tx, tz) || 1;
      // (the outward normal: the ring runs counter-clockwise round the
      // centre, so outward is to the right of the way along it)
      let nx = tz / tl, nz = -tx / tl;
      if (nx * (p.x - CENTER) + nz * (p.z - CENTER) < 0) { nx = -nx; nz = -nz; }
      return { x: p.x + nx * extra, z: p.z + nz * extra };
    });
    const lane: Pt[] = [];
    for (let i = 0; i < off.length; i++) {
      const a = off[i], b = off[(i + 1) % off.length];
      const steps = Math.max(1, Math.round(Math.hypot(b.x - a.x, b.z - a.z) / 3));
      for (let k = 0; k < steps; k++) lane.push({ x: a.x + (b.x - a.x) * (k / steps), z: a.z + (b.z - a.z) * (k / steps) });
    }
    rings.set(key, lane);
    return lane;
  }
  const coast = coastFor(bx, by);
  const corr = corridors(bx, by);
  const out = (p: Pt): number => {
    let w = 0;
    for (const [vert, at, side] of corr) {
      // only the shore on that corridor's side of the island
      if ((vert ? p.z - CENTER : p.x - CENTER) * side <= 0) continue;
      const a = vert ? p.x : p.z;
      const lat = a < at - 8 ? at - 8 - a : a > at + RAIL_OFFSET + 4 ? a - at - RAIL_OFFSET - 4 : 0;
      w = Math.max(w, 1 - Math.min(1, lat / 45));
    }
    return 26 + 18 * smooth(w);
  };
  const P = coast.pts;
  const pic = picnicRect(bx, by);
  // how much further out each shore point's lane must go to clear the picnic
  // complex, spread smoothly 70 m along the shore either way
  const need = P.map(p => {
    const o = out(p);
    let d = 0;
    while (d < 200 && nearRect(pic, coast.shoreToward(p.x, p.z, o + d), 14)) d += 2;
    // (the outer lanes lie further out, parallel)
    return d;
  });
  const cum = [0];
  for (let i = 1; i <= P.length; i++) cum.push(cum[i - 1] + Math.hypot(P[i % P.length].x - P[i - 1].x, P[i % P.length].z - P[i - 1].z));
  const L = cum[P.length];
  const ring = P.map((p, i) => {
    let bulge = 0;
    for (let j = 0; j < P.length; j++) {
      if (!need[j]) continue;
      const dd = Math.abs(cum[i] - cum[j]), ad = Math.min(dd, L - dd);
      bulge = Math.max(bulge, need[j] * smooth(1 - ad / 70));
    }
    return coast.shoreToward(p.x, p.z, out(p) + bulge);
  });
  const lane: Pt[] = [];
  for (let i = 0; i < ring.length; i++) {
    const a = ring[i], b = ring[(i + 1) % ring.length];
    const steps = Math.max(1, Math.round(Math.hypot(b.x - a.x, b.z - a.z) / 3));
    for (let k = 0; k < steps; k++) lane.push({ x: a.x + (b.x - a.x) * (k / steps), z: a.z + (b.z - a.z) * (k / steps) });
  }
  rings.set(key, lane);
  if (rings.size > 48) rings.delete(rings.keys().next().value as string);
  return lane;
}

/** city (bx, by)'s sailing lane (city-local): the calm boats' inner lane,
 * where the kid's boat starts and the buoy course lies */
export function boatLoop(bx: number, by: number): Pt[] { return laneRing(bx, by, 0); }

const bigCache = new Map<string, Pt[][]>();

/** the big ships' loops (city-local): on each stretch of coast between two
 * causeways, out along it 80 m off the shore and back 120 m off, turning
 * round at both ends — kept clear of the corridors, the picnic complex, the
 * anchored ship and every other island's shore, on the island's own water
 * (its east- and south-facing shores); a stretch too short for a ship to
 * sail has none */
export function bigShipLoops(bx: number, by: number): Pt[][] {
  const key = `${bx},${by}`;
  const hit = bigCache.get(key);
  if (hit) return hit;
  const coast = coastFor(bx, by);
  const corr = corridors(bx, by);
  const pic = picnicRect(bx, by);
  const H = harbourFor(bx, by);
  const others: Array<[ReturnType<typeof coastFor>, number, number]> = [];
  for (let dx = -1; dx <= 1; dx++) for (let dz = -1; dz <= 1; dz++) {
    if (dx || dz) others.push([coastFor(bx + dx, by + dz), dx * CITY_PITCH, dz * CITY_PITCH]);
  }
  // (and 28 m off the speedboats' lane, the outermost of the three: the
  // lanes swing out under the causeways and round the picnic island, and a
  // long ship's ends swing wide as it turns)
  const outer = laneRing(bx, by, OUTER);
  const clearOfLanes = (p: Pt): boolean => {
    for (const q of outer) if (Math.abs(q.x - p.x) < 28 && Math.abs(q.z - p.z) < 28 && Math.hypot(q.x - p.x, q.z - p.z) < 28) return false;
    return true;
  };
  const ok = (p: Pt): boolean => {
    if (!clearOfLanes(p)) return false;
    for (const [vert, at, side] of corr) {
      if ((vert ? p.z - CENTER : p.x - CENTER) * side <= 0) continue;
      const a = vert ? p.x : p.z;
      if (a > at - 50 && a < at + RAIL_OFFSET + 50) return false;
    }
    if (nearRect(pic, p, 45)) return false;
    if (inSeaBox(H.ship, p.x, p.z, 30)) return false;
    // (the water off an island's east- and south-facing shores is its own,
    // like the straits its railway crosses (R30): only there, so two
    // islands' big ships never share a strait — and 80 m from every other
    // island's shore, clear of its small boats' lanes)
    const th = Math.atan2(p.z - CENTER, p.x - CENTER) * 180 / Math.PI;
    if (th < -40 || th > 130) return false;
    return others.every(([c, dx, dz]) => !c.inLand(p.x - dx, p.z - dz, -80));
  };
  const at = (th: number, o: number): Pt => coast.shoreToward(CENTER + Math.cos(th) * 100, CENTER + Math.sin(th) * 100, o);
  const N = 720, good: boolean[] = [];
  for (let k = 0; k < N; k++) {
    const th = (k / N) * Math.PI * 2;
    good.push(ok(at(th, 80)) && ok(at(th, 120)));
  }
  // the runs of good angles (round the wrap), longest first
  const runs: Array<[number, number]> = [];
  const start = good.findIndex(g => !g);
  if (start >= 0) {
    for (let k = 1, from = -1; k <= N; k++) {
      const i = (start + k) % N;
      if (good[i] && from < 0) from = start + k;
      if ((!good[i] || k === N) && from >= 0) { runs.push([from, start + k - (good[i] ? 0 : 1)]); from = -1; }
    }
  }
  const loops: Pt[][] = [];
  // turning round at each end on a half circle 20 m round
  const turn = (th: number, fwd: boolean): Pt[] => {
    const c = at(th, 100), r = { x: Math.cos(th), z: Math.sin(th) }, t = { x: -Math.sin(th), z: Math.cos(th) };
    const pts: Pt[] = [];
    for (let k = 1; k < 8; k++) {
      const psi = (k / 8) * Math.PI;
      const cr = -Math.cos(psi) * (fwd ? 1 : -1), ct = Math.sin(psi) * (fwd ? 1 : -1);
      pts.push({ x: c.x + 20 * (cr * r.x + ct * t.x), z: c.z + 20 * (cr * r.z + ct * t.z) });
    }
    return pts;
  };
  for (const [a, b] of runs) {
    let th0 = (a / N) * Math.PI * 2 + 0.02, th1 = (b / N) * Math.PI * 2 - 0.02;
    // (the turns reach past the ends: shorten the loop until they are clear)
    while (th1 > th0 && !turn(th1, true).every(ok)) th1 -= 0.005;
    while (th1 > th0 && !turn(th0, false).every(ok)) th0 += 0.005;
    if (th1 <= th0) continue;
    const outL: Pt[] = [], backL: Pt[] = [];
    for (let th = th0; th <= th1; th += 0.004) { outL.push(at(th, 80)); backL.push(at(th, 120)); }
    const len = outL.reduce((s, p, i) => (i ? s + Math.hypot(p.x - outL[i - 1].x, p.z - outL[i - 1].z) : 0), 0);
    if (len < 200) continue;
    loops.push([...outL, ...turn(th1, true), ...backL.reverse(), ...turn(th0, false)]);
  }
  bigCache.set(key, loops);
  if (bigCache.size > 32) bigCache.delete(bigCache.keys().next().value as string);
  return loops;
}

const mod = (a: number, n: number) => ((a % n) + n) % n;

/** One merged, re-centred hull mesh at the requested length (y=0 waterline). */
export function hullObject(tplName: string, len: number, fallback: () => THREE.Object3D): THREE.Object3D {
  const tpl = bakedModel(tplName);
  if (!tpl) return fallback();
  const m = templateToMesh(tpl);
  const s = len / Math.max(tpl.size.x, tpl.size.z);
  m.geometry.scale(s, s, s);
  m.geometry.computeBoundingBox();
  const bb = m.geometry.boundingBox!;
  m.geometry.translate(-(bb.min.x + bb.max.x) / 2, -bb.min.y, -(bb.min.z + bb.max.z) / 2);
  m.castShadow = true;
  return m;
}

export class Sea {
  private water: THREE.Mesh;
  private waterBase: Float32Array;
  private ox = 0;
  private oz = 0;

  constructor(scene: THREE.Scene) {
    // ---- waving water plane (flat-shaded facets catch the light) ----
    // sized so its far edge is past full fog from any shore viewpoint
    this.water = new THREE.Mesh(
      new THREE.PlaneGeometry(ISLAND + 400, ISLAND + 400, 72, 72),
      mat(0x72c3de),
    );
    this.water.rotation.x = -Math.PI / 2;
    this.water.position.set(CENTER, -0.02, CENTER);
    this.water.receiveShadow = true;
    scene.add(this.water);
    this.waterBase = Float32Array.from(
      (this.water.geometry.attributes.position as THREE.BufferAttribute).array,
    );
  }

  /** move the water plane to the current city */
  setCity(ox: number, oz: number): void {
    this.ox = ox;
    this.oz = oz;
    this.water.position.set(ox + CENTER, -0.02, oz + CENTER);
  }

  update(elapsed: number): void {
    const pos = this.water.geometry.attributes.position as THREE.BufferAttribute;
    const arr = pos.array as Float32Array;
    for (let i = 0; i < arr.length; i += 3) {
      arr[i + 2] = waveAt(this.ox + CENTER + this.waterBase[i], this.oz + CENTER - this.waterBase[i + 1], elapsed);
    }
    pos.needsUpdate = true;
  }
}

/** the watercraft kit's boats: template and length (m) */
const CALM: Array<[string, number]> = [
  ['boat-sail-a', 8], ['boat-sail-b', 7], ['boat-tug-a', 7], ['boat-tug-b', 6.5], ['boat-tug-c', 7.5],
  ['boat-fishing-small', 7], ['boat-row-large', 4.5], ['boat-house-a', 10], ['boat-house-b', 10],
  ['boat-house-c', 10], ['boat-house-d', 10], ['boat-tow-a', 8], ['boat-tow-b', 8], ['boat-fan', 5], ['ship-small', 13],
];
const FAST: Array<[string, number]> = 'bcdefghij'.split('').map(c => [`boat-speed-${c}`, 6]);
const BIG: Array<[string, number]> = [
  ['ship-cargo-a', 30], ['ship-cargo-b', 32], ['ship-cargo-c', 34], ['ship-large', 30],
  ['ship-ocean-liner-small', 36],
];
/** the Pirate Kit models the game bakes (as `pk-<name>`) */
export const PIRATE_MODELS = [
  'palm-straight', 'palm-bend', 'palm-detailed-straight', 'palm-detailed-bend', 'rocks-sand-a', 'rocks-sand-b',
  'rocks-sand-c', 'patch-sand', 'patch-sand-foliage', 'flag-pirate', 'flag', 'chest', 'barrel', 'crate', 'bottle',
  'ship-pirate-small', 'ship-pirate-medium', 'ship-pirate-large', 'ship-medium', 'ship-small', 'ship-wreck',
  'boat-row-small', 'cannon', 'cannon-ball', 'hole', 'tool-shovel',
];
/** metres per Pirate Kit unit (its medium ship, 10.6 units, sails at 16 m) */
export const PK_M = 1.5;

/** the little boats round the treasure islets */
const ISLET_BOATS: Array<[string, number]> = [['boat-fishing-small', 7], ['boat-row-large', 4.5], ['boat-sail-b', 7], ['boat-fan', 5]];

/** every template the fleet can use */
export const FLEET_MODELS = [...CALM, ...FAST, ...BIG].map(([t]) => t);

/** the lanes round the island: how far out past the sailing lane, which
 * way round, the pace (m/s) and the boats (a count per 896 m island) */
const LANES: Array<{ extra: number; dir: 1 | -1; speed: number; per: number; set: Array<[string, number]> }> = [
  // (a fourth lane further out met the neighbour island's in the narrow
  // straits under the causeways: the lanes carry more boats instead)
  { extra: 0, dir: 1, speed: 4.2, per: 16, set: CALM },
  { extra: 10, dir: -1, speed: 4.8, per: 16, set: CALM },
  { extra: 20, dir: 1, speed: 8.5, per: 5, set: FAST },
];
const BIG_SPEED = 3;

interface Lane { pts: Pt[]; cum: number[]; total: number }
function makeLane(pts: Pt[]): Lane {
  const cum = [0];
  for (let k = 0; k < pts.length; k++) {
    const a = pts[k], b = pts[(k + 1) % pts.length];
    cum.push(cum[k] + Math.hypot(b.x - a.x, b.z - a.z));
  }
  return { pts, cum, total: cum[pts.length] };
}
/** the point `s` metres round a lane (city-local) */
function laneAt(L: Lane, s: number): Pt {
  const P = L.pts, cum = L.cum;
  s = mod(s, L.total);
  let lo = 0, hi = P.length - 1;
  while (lo < hi) { const m = (lo + hi + 1) >> 1; if (cum[m] <= s) lo = m; else hi = m - 1; }
  const a = P[lo], b = P[(lo + 1) % P.length];
  const f = (s - cum[lo]) / ((cum[lo + 1] - cum[lo]) || 1);
  return { x: a.x + (b.x - a.x) * f, z: a.z + (b.z - a.z) * f };
}

/** the pirate ship the boats run from (world), or null (G15) */
let threat: Pt | null = null;
export function setFleetThreat(t: Pt | null): void { threat = t; }
/** where the player is (world): only boats within DRAW_R of it are drawn —
 * the fog hides the rest, and an old PC needn't draw them (G13) */
let viewer: Pt | null = null;
export function setFleetViewer(v: Pt | null): void { viewer = v; }
const DRAW_R = 600;

interface Boat {
  /** running from the pirate ship (G15): metres gained along its lane (its
   * lane's spacing a third either way at most, so it never reaches the boat
   * ahead or behind) and metres swerved aside */
  extra: number;
  dodge: number;
  /** the most it may gain or lose */
  room: number;
  tpl: string;
  len: number;
  /** half width (from the model's own proportions) */
  hw: number;
  lane: Lane;
  offset: number;
  speed: number;
  dir: 1 | -1;
  phase: number;
  /** its slot in its model's instanced mesh */
  slot: number;
}

/** a fleet boat where it is at a moment (world): the kid's boat bumps into
 * it (G14) */
export interface BoatFootprint { x: number; z: number; h: number; hl: number; hw: number; v: number }

/** one island's boats, sailing their lanes for good */
export class Fleet {
  private boats: Boat[] = [];
  private meshes = new Map<string, THREE.InstancedMesh>();
  private wakes: THREE.InstancedMesh;
  private _m = new THREE.Matrix4();
  private _q = new THREE.Quaternion();
  private _e = new THREE.Euler(0, 0, 0, 'YXZ');
  private _p = new THREE.Vector3();
  private _s = new THREE.Vector3();

  constructor(private scene: THREE.Scene, private ox: number, private oz: number, seed: number, bx: number, by: number) {
    const r = rng(seed ^ 0x5ea);
    const pick = (set: Array<[string, number]>): [string, number] => set[(r() * set.length) | 0];
    const add = (lane: Lane, [tpl, len]: [string, number], offset: number, speed: number, dir: 1 | -1): void => {
      const t = bakedModel(tpl);
      // (half width from the model's proportions, a little to spare)
      const hw = t ? (len * Math.min(t.size.x, t.size.z)) / Math.max(t.size.x, t.size.z) / 2 + 0.2 : len * 0.2;
      this.boats.push({ tpl, len, hw, lane, offset, speed, dir, phase: this.boats.length * 1.7, slot: 0, extra: 0, dodge: 0, room: 0 });
    };
    for (const L of LANES) {
      const lane = makeLane(laneRing(bx, by, L.extra));
      const count = Math.round(L.per * SCALE);
      // spread evenly round the lane, all at the lane's pace: none catches up
      // with another (a seeded shift keeps the islands' fleets apart)
      const shift = r() * lane.total;
      for (let i = 0; i < count; i++) {
        add(lane, pick(L.set), shift + (i / count) * lane.total, L.speed, L.dir);
        this.boats[this.boats.length - 1].room = lane.total / count / 3;
      }
    }
    // two big ships on each loop, half its length apart
    for (const pts of bigShipLoops(bx, by)) {
      const lane = makeLane(pts);
      const s0 = r() * lane.total;
      for (const k of [0, 1]) {
        add(lane, pick(BIG), s0 + (k * lane.total) / 2, BIG_SPEED, 1);
        this.boats[this.boats.length - 1].room = lane.total / 6;
      }
    }
    // a small boat or two circling every treasure islet, 13 m off its sand
    for (const I of isletsFor(bx, by)) {
      const R = I.r + 13, pts: Pt[] = [];
      for (let k = 0; k < 48; k++) pts.push({ x: I.x + Math.cos((k / 48) * Math.PI * 2) * R, z: I.z + Math.sin((k / 48) * Math.PI * 2) * R });
      const lane = makeLane(pts);
      const n = I.r >= 12 ? 2 : 1;
      for (let k = 0; k < n; k++) {
        add(lane, pick(ISLET_BOATS), (k * lane.total) / n, 2.2, 1);
        this.boats[this.boats.length - 1].room = lane.total / n / 4;
      }
    }
    // one instanced mesh per model (the templates normalised to 1 m long,
    // the waterline at y = 0; each boat scaled to its length)
    const per = new Map<string, number>();
    for (const b of this.boats) { b.slot = per.get(b.tpl) ?? 0; per.set(b.tpl, b.slot + 1); }
    for (const [tpl, n] of per) {
      const t = bakedModel(tpl);
      if (!t) continue;
      const m = templateToMesh(t);
      const s = 1 / Math.max(t.size.x, t.size.z);
      m.geometry.scale(s, s, s);
      m.geometry.computeBoundingBox();
      const bb = m.geometry.boundingBox!;
      m.geometry.translate(-(bb.min.x + bb.max.x) / 2, -bb.min.y, -(bb.min.z + bb.max.z) / 2);
      const im = new THREE.InstancedMesh(m.geometry, m.material, n);
      im.castShadow = true;
      im.frustumCulled = false;
      im.visible = false;
      scene.add(im);
      this.meshes.set(tpl, im);
    }
    // foam wakes trailing every stern
    const wg = new THREE.PlaneGeometry(1, 1);
    wg.rotateX(-Math.PI / 2);
    this.wakes = new THREE.InstancedMesh(wg, mat(0xffffff, { transparent: true, opacity: 0.45, depthWrite: false }), this.boats.length);
    this.wakes.frustumCulled = false;
    this.wakes.visible = false;
    scene.add(this.wakes);
  }

  hide(): void {
    for (const im of this.meshes.values()) im.visible = false;
    this.wakes.visible = false;
  }

  dispose(): void {
    for (const im of this.meshes.values()) { this.scene.remove(im); im.dispose(); }
    this.scene.remove(this.wakes);
    this.wakes.dispose();
  }

  /** boat b at time t: city-local place and heading */
  private pose(b: Boat, t: number): { x: number; z: number; h: number } {
    const s = b.offset + (t * b.speed + b.extra) * b.dir;
    const p = laneAt(b.lane, s);
    // (heading along the lane a few metres either side, so it swings round
    // a bend instead of snapping at each point)
    const ahead = laneAt(b.lane, s + b.dir * 7), behind = laneAt(b.lane, s - b.dir * 3);
    const h = Math.atan2(ahead.x - behind.x, ahead.z - behind.z);
    // (swerved aside: to the right of its heading is (-cos h, sin h))
    return { x: p.x - Math.cos(h) * b.dodge, z: p.z + Math.sin(h) * b.dodge, h };
  }

  private lastT = -1;

  /** run from the pirate ship (G15): a boat it is coming up behind speeds
   * away along its lane; one it is ahead of slows and swerves aside */
  private flee(t: number): void {
    const dt = this.lastT < 0 ? 0 : Math.max(0, Math.min(0.2, t - this.lastT));
    this.lastT = t;
    for (const b of this.boats) {
      let fx = 0, sideDodge = 0;
      if (threat) {
        const p = this.pose(b, t), x = this.ox + p.x, z = this.oz + p.z;
        const d = Math.hypot(threat.x - x, threat.z - z);
        if (d < 70) {
          const hx = Math.sin(p.h), hz = Math.cos(p.h);
          const ahead = (threat.x - x) * hx + (threat.z - z) * hz;
          const side = (threat.x - x) * hz - (threat.z - z) * hx;
          fx = ahead < 0 ? 0.9 : -0.75;
          if (ahead >= 0) sideDodge = side > 0 ? 3 : -3;
        }
      }
      b.extra = Math.max(-b.room, Math.min(b.room, b.extra + fx * b.speed * dt));
      b.dodge += (sideDodge - b.dodge) * Math.min(1, dt * 0.8);
    }
  }

  /** every boat where it is at time t (world) — its turned footprint */
  footprints(t: number): BoatFootprint[] {
    return this.boats.map(b => {
      const p = this.pose(b, t);
      return { x: this.ox + p.x, z: this.oz + p.z, h: p.h, hl: b.len / 2, hw: b.hw, v: b.speed };
    });
  }

  update(elapsed: number): void {
    this.flee(elapsed);
    const nl = nightLights();
    this.wakes.visible = true;
    for (const im of this.meshes.values()) im.visible = true;
    const used = new Map<string, number>();
    let wakes = 0;
    this.boats.forEach(b => {
      const p = this.pose(b, elapsed);
      const x = this.ox + p.x, z = this.oz + p.z;
      if (viewer && Math.hypot(x - viewer.x, z - viewer.z) > DRAW_R) return;
      const y = waveAt(x, z, elapsed) * 1.6 + 0.05;
      this._e.set(Math.sin(elapsed * 0.7 + b.phase) * 0.035, p.h, Math.sin(elapsed * 0.9 + b.phase) * 0.05 * Math.min(1, 8 / b.len));
      this._q.setFromEuler(this._e);
      const im = this.meshes.get(b.tpl);
      if (im) {
        const k = used.get(b.tpl) ?? 0;
        used.set(b.tpl, k + 1);
        im.setMatrixAt(k, this._m.compose(this._p.set(x, y, z), this._q, this._s.set(b.len, b.len, b.len)));
      }
      const fx = Math.sin(p.h), fz = Math.cos(p.h);
      this._e.set(0, p.h, 0);
      this._q.setFromEuler(this._e);
      this.wakes.setMatrixAt(wakes++, this._m.compose(this._p.set(x - fx * b.len * 0.72, 0.06, z - fz * b.len * 0.72), this._q,
        this._s.set(Math.min(b.len * 0.55, b.hw * 2.2), 1, b.len * 1.4)));
      // at night: a white masthead light and red / green side lights (G10)
      if (nl?.dark) {
        const top = Math.min(3 + b.len * 0.1, 9);
        nl.flash({ x, y: y + top, z, color: 0xfff4dc, size: 1.2, pool: 0 });
        // (the right-hand side of a heading (fx, fz) is (-fz, fx): green; the left red)
        const w = b.hw * 0.9;
        nl.flash({ x: x - fz * w, y: y + 1.2, z: z + fx * w, color: 0x33ff66, size: 0.9, pool: 0, face: { x: -fz, z: fx } });
        nl.flash({ x: x + fz * w, y: y + 1.2, z: z - fx * w, color: 0xff2a22, size: 0.9, pool: 0, face: { x: fz, z: -fx } });
      }
    });
    for (const [tpl, im] of this.meshes) { im.count = used.get(tpl) ?? 0; im.instanceMatrix.needsUpdate = true; }
    this.wakes.count = wakes;
    this.wakes.instanceMatrix.needsUpdate = true;
  }
}

/** Bake the watercraft kit templates, then build the sea. */
export async function createSea(scene: THREE.Scene): Promise<Sea> {
  const WC = '/assets/kenney/watercraft';
  const MAP = `${WC}/Textures/colormap.png`;
  const def = (n: string): BakeDef => [`${WC}/${n}.glb`, MAP];
  const defs: Record<string, BakeDef> = {};
  for (const n of [...FLEET_MODELS, 'boat-row-small', 'buoy', 'buoy-flag']) defs[n] = def(n);
  // the Pirate Kit's islet dressing and ships (pk-*: the treasure islets and
  // the pirate mode, G15)
  const PK = '/assets/kenney/pirate';
  for (const n of PIRATE_MODELS) defs[`pk-${n}`] = [`${PK}/${n}.glb`, `${PK}/Textures/colormap.png`];
  await prepBakedModels(defs).catch(() => {});
  return new Sea(scene);
}
