// The archipelago's railway traffic: endless through lines, one north-south
// line per island column and one west-east line per island row, running
// island to island over the causeways. Trains are WORLD-level and run on a
// timetable, so they never teleport and every island agrees where they are:
//
//   - every line runs one way (seeded per column / row) with a train every
//     HEADWAY seconds entering each portal at the line's own phase;
//   - an island's stretch of a line (its "segment", portal to portal) is
//     timed to a whole number of headways: cruise speed is tuned a little
//     and station dwells absorb the rest, so a train that enters at phase
//     phi leaves at phase phi — the next island picks it up seamlessly;
//   - at the diamond the west-east trains hold (at the platform before it,
//     or a signal 30 m short) until the north-south train is well clear.
//
// Position is a pure function of the game clock, so anything can ask where
// the trains are at any time (the level crossings, the cars' catch-up after
// a dormant spell). Only trains near the player are drawn. In train mode the
// kid's own train runs on its column's line, which is then kept free of
// timetable trains; it yields at the diamond and can't stop on it.
import * as THREE from 'three';
import { nightLights } from './nightLights.js';
import { spawnVehicle } from '../../engine/assets.js';
import { rng, chunkSeed } from '../../engine/rng.js';
import { railNetFor, RAIL_TOP, type RailRoute, type LineKind } from '../../worlds/railRoute.js';
import { cityPlanFor, type Crossing } from '../../worlds/cityPlan.js';
import { CITY_PITCH, citySeed } from '../../worlds/cityGrid.js';
import { deckAt } from '../../worlds/causeway.js';
import type { CollisionBox } from '../../worlds/cityChunk.js';
/** may the railway reach into island (bx, by) this frame? The game gates
 * it on the world worker having delivered the island (islandReady), so a
 * train never builds an island mid-frame; left open, everything builds on
 * demand (the audit, node tools) */
let gate: (bx: number, by: number) => boolean = () => true;
export function setIslandGate(fn: (bx: number, by: number) => boolean): void { gate = fn; }

/** seconds between trains on every line, at every portal */
export const HEADWAY = 60;
const CRUISE = 10;     // m/s at the portals (and nominal cruise)
const ACC = 0.9;       // m/s^2 pulling away
const DEC = 1.1;       // m/s^2 braking for a stop
const DWELL = 12;      // s at a platform
const MAX_DWELL = HEADWAY - 24;
const DRAW_R = 320;    // draw trains whose head is this close (the fog ends at 260 m)

const LOCO_LEN = 9;
const CAR_LEN = 7.5;
const GAP = 1.1;

const LOCOS = ['/assets/kenney/train/train-diesel-a.glb', '/assets/kenney/train/train-locomotive-b.glb'];
const T = (f: string): string => `/assets/kenney/train/${f}.glb`;
const CARS = ['train-carriage-container-red', 'train-carriage-container-green', 'train-carriage-container-blue',
  'train-carriage-coal', 'train-carriage-box', 'train-carriage-flatbed', 'train-carriage-tank', 'train-carriage-lumber',
  'train-carriage-wood'].map(T);
/** passenger sets, cab front and back: electric city, double-decker, subway */
const PASSENGER_SETS = [
  ['train-electric-city-a', 'train-electric-city-b', 'train-electric-city-c'],
  ['train-electric-double-a', 'train-electric-double-b', 'train-electric-double-c'],
  ['train-electric-subway-a', 'train-electric-subway-b', 'train-electric-subway-c'],
].map(set => set.map(T));
const PASSENGER = PASSENGER_SETS[0];
/** how far along a platform a door may stand from the stop point and still
 * be served (the platform runs 7.5 m either side) */
const PLATFORM_REACH = 10;
const PLAYER_MAX = 12;   // m/s
const PLAYER_ACCEL = 2.4;
const PLAYER_BRAKE = 5.5;

/** a line of the world: column bx for north-south, row by for west-east */
export interface LineId { kind: LineKind; idx: number }
const lineKey = (l: LineId): string => `${l.kind}${l.idx}`;
const lineIndex = (k: LineKind): number => (k === 'ns' ? 0 : 1);

interface Leg {
  s0: number; len: number; t0: number; dur: number;
  u: number; w: number; c: number;   // start / end / cruise speeds
  t1: number; d1: number; a1: number; // first phase (u -> c)
  t3: number; d3: number; a3: number; // last phase (c -> w)
}
interface Stop { s: number; dwell: number; station: boolean }

/** one island's stretch of a line, as a timetable */
interface Segment {
  bx: number; by: number; kind: LineKind;
  route: RailRoute;
  dir: 1 | -1;
  /** timeline: legs and dwells, in order */
  legs: Leg[];
  stops: Stop[];
  /** portal-to-portal time: a whole number of headways */
  T: number;
  /** travel coordinate sigma (0 at the entry portal) -> arc along route */
  arc(sigma: number): number;
}

function makeLeg(s0: number, len: number, u: number, w: number, c: number, t0: number): Leg {
  const r1 = c >= u ? ACC : DEC, r3 = c >= w ? DEC : ACC;
  let t1 = Math.abs(c - u) / r1, t3 = Math.abs(c - w) / r3;
  let d1 = ((u + c) / 2) * t1, d3 = ((c + w) / 2) * t3;
  let cc = c;
  if (d1 + d3 > len) {
    // no room to reach cruise: a peak between the two ramps
    const vp2 = (len + (u * u) / (2 * ACC) + (w * w) / (2 * DEC)) / (1 / (2 * ACC) + 1 / (2 * DEC));
    const vp = Math.max(Math.max(u, w, 0.5), Math.sqrt(Math.max(0, vp2)));
    cc = vp;
    t1 = Math.abs(vp - u) / ACC; d1 = ((u + vp) / 2) * t1;
    t3 = Math.abs(vp - w) / DEC; d3 = ((vp + w) / 2) * t3;
    if (d1 + d3 > len && d1 + d3 > 0) { const k = len / (d1 + d3); d1 *= k; d3 *= k; }
  }
  const dc = Math.max(0, len - d1 - d3);
  const dur = t1 + dc / cc + t3;
  return {
    s0, len, t0, dur, u, w, c: cc,
    t1, d1, a1: t1 > 0 ? (cc - u) / t1 : 0,
    t3, d3, a3: t3 > 0 ? (w - cc) / t3 : 0,
  };
}

/** distance into a leg after tau seconds */
function legPos(L: Leg, tau: number): { s: number; v: number } {
  if (tau <= 0) return { s: 0, v: L.u };
  if (tau < L.t1) return { s: L.u * tau + 0.5 * L.a1 * tau * tau, v: L.u + L.a1 * tau };
  const tc = L.dur - L.t1 - L.t3;
  if (tau < L.t1 + tc) return { s: L.d1 + L.c * (tau - L.t1), v: L.c };
  const t = Math.min(L.t3, tau - L.t1 - tc);
  return { s: Math.min(L.len, L.len - L.d3 + L.c * t + 0.5 * L.a3 * t * t), v: L.c + L.a3 * t };
}

/** timeline for a stop list at cruise factor f */
function timeline(total: number, stops: Stop[], f: number): { legs: Leg[]; T: number } {
  const legs: Leg[] = [];
  let t = 0, s = 0, u = CRUISE;
  for (const st of stops) {
    const L = makeLeg(s, st.s - s, u, 0, CRUISE * f, t);
    legs.push(L);
    t += L.dur + st.dwell;
    s = st.s; u = 0;
  }
  const L = makeLeg(s, total - s, u, CRUISE, CRUISE * f, t);
  legs.push(L);
  return { legs, T: t + L.dur };
}

/** seconds after entering until the head reaches sigma */
function timeTo(legs: Leg[], stops: Stop[], sigma: number): number {
  for (let k = 0; k < legs.length; k++) {
    const L = legs[k];
    if (sigma > L.s0 + L.len) continue;
    // invert the leg by bisection (monotone)
    let lo = 0, hi = L.dur;
    for (let it = 0; it < 30; it++) {
      const mid = (lo + hi) / 2;
      if (legPos(L, mid).s < sigma - L.s0) lo = mid; else hi = mid;
    }
    return L.t0 + hi;
  }
  const last = legs[legs.length - 1];
  return last.t0 + last.dur;
  void stops;
}

const hash01 = (a: number, b: number, c: number): number => (chunkSeed(0x7a11, a, b + c * 7919) % 100000) / 100000;

/** each line runs one way, with its own phase */
export function lineDir(l: LineId): 1 | -1 { return hash01(l.kind === 'ns' ? 1 : 2, l.idx, 3) < 0.5 ? 1 : -1; }
function linePhase(l: LineId): number { return hash01(l.kind === 'ns' ? 1 : 2, l.idx, 5) * HEADWAY; }

const segCache = new Map<string, Segment>();

/** the timetable of line `kind` across island (bx, by) */
function segment(bx: number, by: number, kind: LineKind): Segment {
  const key = `${bx},${by},${kind}`;
  const hit = segCache.get(key);
  if (hit) return hit;
  const net = railNetFor(bx, by);
  const li = lineIndex(kind);
  const route = net.lines[li];
  const id: LineId = { kind, idx: kind === 'ns' ? bx : by };
  const dir = lineDir(id);
  const total = route.total;
  const sig = (arc: number): number => (dir > 0 ? arc : total - arc);
  const plan = cityPlanFor(bx, by);
  const base: Stop[] = plan.stations.filter(s => s.line === li)
    .map(s => ({ s: sig(s.d), dwell: DWELL, station: true }))
    .sort((p, q) => p.s - q.s);
  const sD = sig(net.diamond.d[li]);
  let best: { stops: Stop[]; legs: Leg[]; T: number; score: number } | null = null;
  // halts (a hold at a signal) are placed so the waiting train covers no
  // level crossing, off the stems and the strait
  const trainLen = consistFor(id).length;
  const crossS = plan.crossings.filter(c => c.line === li).map(c => sig(c.d));
  const clearHalt = (from: number, to: number, stops: Stop[] = base): number | null => {
    const step = from < to ? 4 : -4;
    for (let h = from; step > 0 ? h <= to : h >= to; h += step) {
      if (h < 80 || h > total - 170) continue;
      if (stops.some(st => Math.abs(st.s - h) < 60)) continue;
      if (crossS.some(c => c > h - trainLen - 8 && c < h + 8)) continue;
      return h;
    }
    return null;
  };
  /** standing time still allowed at `st`: every stop within 200 m shares
   * one MAX_DWELL budget, so a train never stands long enough in one
   * stretch for the next one on its line to close up behind it */
  const room = (stops: Stop[], st: Stop): number =>
    MAX_DWELL - stops.filter(o => Math.abs(o.s - st.s) < 200).reduce((n, o) => n + o.dwell, 0);
  const addStop = (stops: Stop[], at: number, dwell: number): void => {
    stops.push({ s: at, dwell, station: false });
    stops.sort((p, q) => p.s - q.s);
  };
  for (let fi = 0; fi <= 36; fi++) {
    // cruise factors fanning out from 1: 1, 0.985, 1.015, 0.97, ...
    const f = 1 + (fi % 2 ? -1 : 1) * Math.ceil(fi / 2) * 0.015;
    if (f < 0.75 || f > 1.3) continue;
    const stops = base.map(s => ({ ...s }));
    if (kind === 'ew') {
      // the diamond: the west-east train's occupancy window (head 3 m short
      // until the tail is 3 m past) may never overlap a north-south one's,
      // modulo the headway — hold at the platform before it, or at a signal
      const nsSeg = segment(bx, by, 'ns');
      const nsLen = consistFor({ kind: 'ns', idx: bx }).length;
      const sN = nsSeg.dir > 0 ? net.diamond.d[0] : nsSeg.route.total - net.diamond.d[0];
      const phN = linePhase({ kind: 'ns', idx: bx }), phE = linePhase(id);
      const n0 = phN + timeTo(nsSeg.legs, nsSeg.stops, sN - 3) - 1.5;
      const n1 = phN + timeTo(nsSeg.legs, nsSeg.stops, sN + nsLen + 3) + 1.5;
      const clash = (e0: number, e1: number): boolean => {
        for (let k = -3; k <= 3; k++) if (e0 + k * HEADWAY < n1 && e1 + k * HEADWAY > n0) return true;
        return false;
      };
      let holdStop: Stop | null = null;
      for (let round = 0; round < 6; round++) {
        const tl = timeline(total, stops, f);
        const e0 = phE + timeTo(tl.legs, stops, sD - 3), e1 = phE + timeTo(tl.legs, stops, sD + trainLen + 3);
        if (!clash(e0, e1)) break;
        let delta = 0.5;
        while (delta < HEADWAY && clash(e0 + delta, e1 + delta)) delta += 0.5;
        if (!holdStop) {
          const before = stops.filter(st => st.s < sD);
          const last = before[before.length - 1];
          if (last && room(stops, last) >= delta) { holdStop = last; }
          else {
            const h = clearHalt(sD - 8, Math.max(sD - 220, (last?.s ?? 0) + 25), stops);
            if (h !== null) { addStop(stops, h, 0); holdStop = stops.find(st => st.s === h)!; }
            else if (last) holdStop = last;
          }
        }
        if (!holdStop) break;
        holdStop.dwell += delta;
      }
    }
    // the rest waits at platforms — only ones past the diamond on the
    // west-east line, whose diamond timing is fixed above — then at a
    // signal past the diamond. A new halt costs its own braking and
    // pull-away, so settle it over a few rounds.
    let rest = 0;
    for (let round = 0; round < 4; round++) {
      const tl = timeline(total, stops, f);
      rest = Math.max(1, Math.ceil(tl.T / HEADWAY - 1e-6)) * HEADWAY - tl.T;
      if (rest < 1e-6) { rest = 0; break; }
      const absorb = stops.filter(st => (kind === 'ns' || st.s > sD) && (st.station || round > 0));
      absorb.sort((p, q) => (q.s > sD ? 1 : 0) - (p.s > sD ? 1 : 0));
      for (const st of absorb) {
        const add = Math.min(rest, room(stops, st));
        if (add > 0) { st.dwell += add; rest -= add; }
      }
      if (rest < 1e-6) { rest = 0; break; }
      if (round === 0 && !stops.some(st => !st.station && st.s > sD)) {
        const h = clearHalt(sD + trainLen + 14, total - 170, stops);
        if (h !== null) addStop(stops, h, 0);
      }
    }
    const score = rest * 10 + Math.abs(f - 1) * 40;
    if (!best || score < best.score) {
      const fin = timeline(total, stops, f);
      best = { stops, legs: fin.legs, T: Math.ceil(fin.T / HEADWAY - 1e-6) * HEADWAY, score };
      if (rest < 1e-6 && Math.abs(f - 1) < 0.05) break;
    }
  }
  const b = best!;
  // any leftover (no platforms to absorb it) rides as a slower last leg's
  // tail: stretch the final leg in time — speeds stay continuous enough
  const legs = b.legs;
  const extra = b.T - (legs[legs.length - 1].t0 + legs[legs.length - 1].dur);
  if (extra > 1e-6) {
    const L = legs[legs.length - 1];
    legs[legs.length - 1] = makeLeg(L.s0, L.len, L.u, CRUISE, Math.max(2, (L.len / (L.dur + extra)) * 0.98), L.t0);
    // fine-tune: bisection on the last leg's cruise to land on T exactly
    let lo = 1, hi = CRUISE * 1.5;
    for (let it = 0; it < 40; it++) {
      const mid = (lo + hi) / 2;
      const t = makeLeg(L.s0, L.len, L.u, CRUISE, mid, L.t0);
      if (t.t0 + t.dur > b.T) lo = mid; else hi = mid;
    }
    legs[legs.length - 1] = makeLeg(L.s0, L.len, L.u, CRUISE, hi, L.t0);
  }
  const seg: Segment = {
    bx, by, kind, route, dir, legs, stops: b.stops, T: b.T,
    arc: s => (dir > 0 ? s : total - s),
  };
  segCache.set(key, seg);
  if (segCache.size > 64) segCache.delete(segCache.keys().next().value as string);
  return seg;
}

/** head position sigma + speed, tau seconds after entering the segment */
function segPos(seg: Segment, tau: number): { s: number; v: number } {
  for (let k = 0; k < seg.legs.length; k++) {
    const L = seg.legs[k];
    const end = L.t0 + L.dur;
    if (tau < end) return tau < L.t0 ? { s: L.s0, v: 0 } : { s: L.s0 + legPos(L, tau - L.t0).s, v: legPos(L, tau - L.t0).v };
    const next = seg.legs[k + 1];
    if (next && tau < next.t0) return { s: L.s0 + L.len, v: 0 }; // dwelling at the stop
  }
  const last = seg.legs[seg.legs.length - 1];
  return { s: last.s0 + last.len, v: CRUISE };
}

/** island of the next / previous segment along a line in travel direction */
const stepIsland = (kind: LineKind, bx: number, by: number, k: number): [number, number] =>
  kind === 'ns' ? [bx, by + k] : [bx + k, by];

/** every timetable train on a segment at time t: head sigma + speed */
function trainsOn(seg: Segment, t: number): Array<{ s: number; v: number; n: number }> {
  const phi = linePhase({ kind: seg.kind, idx: seg.kind === 'ns' ? seg.bx : seg.by });
  const out: Array<{ s: number; v: number; n: number }> = [];
  const n1 = Math.floor((t - phi) / HEADWAY);
  const n0 = Math.ceil((t - seg.T - phi) / HEADWAY);
  for (let n = n0; n <= n1; n++) {
    const tau = t - (phi + n * HEADWAY);
    if (tau < 0 || tau >= seg.T) continue;
    out.push({ ...segPos(seg, tau), n });
  }
  return out;
}

/** world pose at travel coordinate sigma of island (bx, by)'s segment,
 * walking into the neighbouring segments past either portal */
function linePose(kind: LineKind, bx: number, by: number, s: number): { x: number; z: number; h: number; y: number } {
  let seg = segment(bx, by, kind);
  for (let guard = 0; guard < 4; guard++) {
    if (s < 0) {
      const [pbx, pby] = stepIsland(kind, seg.bx, seg.by, -1);
      // (a neighbour the world worker hasn't delivered yet: hold the train's
      // tail at the portal for now rather than build it mid-frame)
      if (!gate(pbx, pby)) { s = 0; break; }
      const prev = segment(pbx, pby, kind);
      s += prev.route.total;
      seg = prev;
    } else if (s > seg.route.total) {
      const [nbx, nby] = stepIsland(kind, seg.bx, seg.by, 1);
      if (!gate(nbx, nby)) { s = seg.route.total; break; }
      s -= seg.route.total;
      seg = segment(nbx, nby, kind);
    } else break;
  }
  const p = seg.route.sample(seg.arc(s));
  const x = p.x + seg.bx * CITY_PITCH, z = p.z + seg.by * CITY_PITCH;
  const h = seg.dir > 0 ? p.h : p.h + Math.PI;
  return { x, z, h, y: deckAt(x, z)?.y ?? 0 };
}

/** audit hook: the world position of every timetable train head on island
 * (bx, by)'s `kind` line at time t */
export function timetableHeads(bx: number, by: number, kind: LineKind, t: number): Array<{ x: number; z: number; v: number }> {
  return trainsOn(segment(bx, by, kind), t).map(tr => ({ ...linePose(kind, bx, by, tr.s), v: tr.v }));
}

/** audit hook: flush the timetables (the city base seed changed) */
export function clearTimetableCache(): void { segCache.clear(); }

interface ConsistSpec { units: Array<{ url: string; len: number; back: number }>; length: number; passenger: boolean }

/** a train standing at a platform: which one, whether it carries people,
 * and its doors on the platform side (world) */
export interface Dwelling {
  id: string;
  passenger: boolean;
  /** the station stop point (world) */
  x: number;
  z: number;
  doors: Array<{ x: number; z: number }>;
}

function consistFor(l: LineId): ConsistSpec {
  const r = rng(chunkSeed(0x7a1, l.kind === 'ns' ? 1 : 2, l.idx));
  const units: ConsistSpec['units'] = [];
  let back = 0;
  // a passenger line (one of the three electric sets) or a freight line —
  // seeded per line: a line runs through many islands, so it can't follow
  // any one island's districts
  const passenger = r() < 0.55;
  if (passenger) {
    const set = PASSENGER_SETS[(r() * PASSENGER_SETS.length) | 0];
    for (const url of set) { units.push({ url, len: CAR_LEN + 1.5, back }); back += CAR_LEN + 1.5 + GAP; }
  } else {
    units.push({ url: LOCOS[(r() * LOCOS.length) | 0], len: LOCO_LEN, back: 0 });
    back = LOCO_LEN + GAP;
    const n = 2 + ((r() * 3) | 0);
    for (let k = 0; k < n; k++) {
      units.push({ url: CARS[(r() * CARS.length) | 0], len: CAR_LEN, back });
      back += CAR_LEN + GAP;
    }
  }
  return { units, length: back, passenger };
}

/** a drawn train: its unit objects (null until the GLB arrives) */
interface View { line: string; objs: Array<THREE.Object3D | null>; used: boolean; x: number; z: number }

/** the kid's train (train mode) */
interface Kid {
  line: LineId;
  bx: number; by: number;   // current segment's island
  s: number;                // head sigma on that segment
  v: number;
  spec: ConsistSpec;
  view: View | null;
}

export class Railway {
  private views: View[] = [];
  private specs = new Map<string, ConsistSpec>();
  private kid: Kid | null = null;
  private controls = { gas: 0, brake: 0, stationGap: Infinity };
  readonly group = new THREE.Group();
  private time = 0;

  constructor(scene: THREE.Scene) {
    scene.add(this.group);
  }

  private spec(l: LineId): ConsistSpec {
    const k = lineKey(l);
    let s = this.specs.get(k);
    if (!s) { s = consistFor(l); this.specs.set(k, s); }
    return s;
  }

  /** put the kid's train on the north-south line of island (bx, by), its
   * head at arc `arc` */
  addPlayer(bx: number, by: number, arc: number): void {
    const line: LineId = { kind: 'ns', idx: bx };
    const seg = segment(bx, by, 'ns');
    this.kid = {
      line, bx, by, s: seg.dir > 0 ? arc : seg.route.total - arc, v: 0,
      spec: { units: PASSENGER.map((url, k) => ({ url, len: CAR_LEN + 1.5, back: k * (CAR_LEN + 1.5 + GAP) })), length: 3 * (CAR_LEN + 1.5 + GAP), passenger: true },
      view: null,
    };
  }

  setControls(gas: number, brake: number, stationGap = Infinity): void {
    this.controls.gas = gas;
    this.controls.brake = brake;
    this.controls.stationGap = stationGap;
  }

  /** the kid's train: head position + heading (world), speed */
  playerPose(): { x: number; z: number; h: number; v: number; y: number } | null {
    const k = this.kid;
    if (!k) return null;
    const p = this.pose(k.line.kind, k.bx, k.by, k.s);
    return { x: p.x, z: p.z, h: p.h, v: k.v, y: p.y };
  }

  /** how far the kid's train's nose is ahead of its pose (its first unit's
   * centre sits at the arc point) */
  kidNose(): number {
    const u = this.kid?.spec.units[0];
    return u ? u.len / 2 - u.back : 0;
  }

  /** the next station ahead of the kid's train: world position + gap */
  nextStation(skip = 0): { x: number; z: number; gap: number } | null {
    const k = this.kid;
    if (!k) return null;
    let bx = k.bx, by = k.by, off = -k.s, found = 0;
    for (let hop = 0; hop < 4; hop++) {
      const seg = segment(bx, by, k.line.kind);
      for (const st of seg.stops) {
        if (!st.station) continue;
        const gap = off + st.s;
        if (gap < -12) continue;
        if (found++ < skip) continue;
        const p = this.pose(k.line.kind, bx, by, st.s);
        return { x: p.x, z: p.z, gap: Math.max(0, gap) };
      }
      off += seg.route.total;
      [bx, by] = stepIsland(k.line.kind, bx, by, 1);
    }
    return null;
  }

  private pose(kind: LineKind, bx: number, by: number, s: number): { x: number; z: number; h: number; y: number } {
    return linePose(kind, bx, by, s);
  }

  /** arc distance from arc `d` on island (bx, by)'s line to the nearest
   * train unit at time t (timetable trains on this and both neighbouring
   * segments, plus the kid's train) — level crossings + car AI ask this */
  distTo(bx: number, by: number, line: number, d: number, t = this.time): number {
    const kind: LineKind = line === 0 ? 'ns' : 'ew';
    const seg = segment(bx, by, kind);
    const sD = seg.dir > 0 ? d : seg.route.total - d;
    const id: LineId = { kind, idx: kind === 'ns' ? bx : by };
    let best = Infinity;
    const reserved = this.kid && lineKey(this.kid.line) === lineKey(id);
    const len = this.spec(id).length;
    // a neighbouring segment only matters near the shared portal
    const near: number[] = [0];
    if (sD < len + 80) near.push(-1);
    if (sD > seg.route.total - 80) near.push(1);
    if (!reserved) {
      for (const k of near) {
        const [ibx, iby] = stepIsland(kind, bx, by, k);
        if (k !== 0 && !gate(ibx, iby)) continue; // not here yet
        const sg = k === 0 ? seg : segment(ibx, iby, kind);
        // offset of that segment's sigma into ours
        const off = k === 0 ? 0 : k < 0 ? -sg.route.total : seg.route.total;
        for (const tr of trainsOn(sg, t)) {
          const head = tr.s + off, tail = head - len;
          const g = sD > head ? sD - head : sD < tail ? tail - sD : 0;
          if (g < best) best = g;
        }
      }
    }
    const kd = this.kid;
    if (kd && lineKey(kd.line) === lineKey(id)) {
      const di = kind === 'ns' ? kd.by - by : kd.bx - bx;
      if (Math.abs(di) <= 1) {
        const off = di === 0 ? 0 : di < 0 ? -segment(kd.bx, kd.by, kind).route.total : seg.route.total;
        const head = kd.s + off, tail = head - kd.spec.length;
        const g = sD > head ? sD - head : sD < tail ? tail - sD : 0;
        best = Math.min(best, g);
      }
    }
    return best;
  }

  /** is a level crossing's warning on (train within `warn` m) at time t */
  warns(bx: number, by: number, c: Crossing, warn: number, t = this.time): boolean {
    return this.distTo(bx, by, c.line, c.d, t) < warn;
  }

  /** every train standing at one of island (bx, by)'s platforms right now
   * (timetable trains in their dwell, the kid's train stopped at the stop
   * board), with the doors that open onto the platform */
  dwelling(bx: number, by: number): Dwelling[] {
    const out: Dwelling[] = [];
    const doorsOf = (spec: ConsistSpec, kind: LineKind, sbx: number, sby: number, s: number, stop: { x: number; z: number }): Array<{ x: number; z: number }> => {
      const doors: Array<{ x: number; z: number }> = [];
      for (const u of spec.units) {
        for (const f of [0.3, 0.7]) {
          const p = this.pose(kind, sbx, sby, s - u.back - u.len * f);
          if (Math.hypot(p.x - stop.x, p.z - stop.z) < PLATFORM_REACH) doors.push({ x: p.x, z: p.z });
        }
      }
      return doors;
    };
    for (const kind of ['ns', 'ew'] as const) {
      const id: LineId = { kind, idx: kind === 'ns' ? bx : by };
      if (this.kid && lineKey(this.kid.line) === lineKey(id)) continue;
      const seg = segment(bx, by, kind);
      const spec = this.spec(id);
      for (const tr of trainsOn(seg, this.time)) {
        if (tr.v > 0.05) continue;
        const st = seg.stops.find(o => o.station && Math.abs(o.s - tr.s) < 0.6);
        if (!st) continue;
        const stop = this.pose(kind, bx, by, st.s);
        out.push({ id: `${lineKey(id)}:${tr.n}`, passenger: spec.passenger, x: stop.x, z: stop.z, doors: doorsOf(spec, kind, bx, by, tr.s, stop) });
      }
    }
    const k = this.kid;
    if (k && k.bx === bx && k.by === by && k.v < 0.3) {
      const seg = segment(k.bx, k.by, 'ns');
      const st = seg.stops.find(o => o.station && Math.abs(o.s - k.s) < 12);
      if (st) {
        const stop = this.pose('ns', k.bx, k.by, st.s);
        out.push({ id: 'kid', passenger: true, x: stop.x, z: stop.z, doors: doorsOf(k.spec, 'ns', k.bx, k.by, k.s, stop) });
      }
    }
    return out;
  }

  /** debug: the timetable trains around island (bx, by) */
  list(bx: number, by: number): unknown {
    return (['ns', 'ew'] as const).map(kind => {
      const seg = segment(bx, by, kind);
      return {
        kind, dir: seg.dir, T: +seg.T.toFixed(1), total: +seg.route.total.toFixed(0),
        stops: seg.stops.map(s => ({ s: +s.s.toFixed(0), dwell: +s.dwell.toFixed(1), station: s.station })),
        trains: trainsOn(seg, this.time).map(t => ({ s: +t.s.toFixed(1), v: +t.v.toFixed(1) })),
      };
    });
  }

  private makeView(spec: ConsistSpec, line: string): View {
    const view: View = { line, objs: spec.units.map(() => null), used: true, x: 0, z: 0 };
    spec.units.forEach((u, i) => {
      spawnVehicle(u.url, { len: u.len }).then(obj => {
        obj.userData.shared = true;
        obj.traverse(o => { if ((o as THREE.Mesh).isMesh) o.castShadow = true; });
        obj.visible = false;
        this.group.add(obj);
        view.objs[i] = obj;
      }).catch(() => { /* stays invisible */ });
    });
    return view;
  }

  /** lay one consist along its line: every unit at its own arc distance, on
   * the causeway decks lifted and pitched to the ramp */
  private place(view: View, spec: ConsistSpec, kind: LineKind, bx: number, by: number, s: number): void {
    spec.units.forEach((u, i) => {
      const obj = view.objs[i];
      if (!obj) return;
      const mid = s - u.back - u.len / 2 + u.len / 2;
      const p = this.pose(kind, bx, by, mid);
      const f = this.pose(kind, bx, by, mid + u.len * 0.4), b = this.pose(kind, bx, by, mid - u.len * 0.4);
      obj.position.set(p.x, RAIL_TOP + p.y, p.z);
      obj.rotation.set(0, 0, 0);
      obj.rotation.y = p.h;
      obj.userData.h = p.h;
      obj.userData.len = u.len;
      obj.rotateX(-Math.atan2(f.y - b.y, u.len * 0.8));
      obj.visible = true;
    });
    const h = this.pose(kind, bx, by, s);
    view.x = h.x; view.z = h.z;
    // at night: two headlamps and a beam at the head, red tail lamps at the
    // end (G10)
    const nl = nightLights();
    if (nl?.dark && view.objs[0]) {
      // (each unit's centre sits at its arc point: the nose is half a unit on)
      const u0 = spec.units[0], uN = spec.units[spec.units.length - 1];
      const n = this.pose(kind, bx, by, s - u0.back + u0.len / 2 + 0.15);
      const fx = Math.sin(n.h), fz = Math.cos(n.h), rx = fz, rz = -fx, y = RAIL_TOP + n.y;
      for (const side of [-1, 1]) {
        nl.flash({ x: n.x + rx * side * 0.75, y: y + 1.1, z: n.z + rz * side * 0.75, color: 0xfff4dc, size: 1.3, pool: 0, face: { x: fx, z: fz } });
      }
      nl.flash({ x: n.x, y: y + 3.1, z: n.z, color: 0xfff4dc, size: 1.0, pool: 0, face: { x: fx, z: fz } });
      nl.beam(n.x + fx * 11, y + 0.3, n.z + fz * 11, n.h, 5, 22, 0xfff0d0, 1);
      const t = this.pose(kind, bx, by, s - uN.back - uN.len / 2 - 0.15);
      const bxv = -Math.sin(t.h), bzv = -Math.cos(t.h);
      for (const side of [-1, 1]) {
        nl.flash({ x: t.x + bzv * side * -0.75, y: RAIL_TOP + t.y + 1.0, z: t.z - bxv * side * -0.75, color: 0xff2a22, size: 0.9, pool: 0, face: { x: bxv, z: bzv } });
      }
    }
  }

  /** the kid's train this frame: gas / brake with a station-approach assist,
   * a red signal at the diamond while a west-east train is due, and no
   * stopping on the diamond itself */
  private driveKid(dt: number, t: number): void {
    const k = this.kid!;
    const seg = segment(k.bx, k.by, 'ns');
    const { gas, brake, stationGap } = this.controls;
    let vTarget = gas > 0.05 ? PLAYER_MAX : brake > 0.05 ? 0 : Math.max(0, k.v - 0.5);
    if (stationGap < 80) vTarget = Math.min(vTarget, Math.max(1.6, stationGap * 0.3));
    const net = railNetFor(k.bx, k.by);
    const sD = seg.dir > 0 ? net.diamond.d[0] : seg.route.total - net.diamond.d[0];
    const toD = sD - k.s;                 // head to the diamond
    const past = k.s - k.spec.length - sD; // tail past the diamond
    if (toD > -2 && toD < 90) {
      // a west-east train on (or approaching) the diamond soon? stop short
      const ew = segment(k.bx, k.by, 'ew');
      const eD = ew.dir > 0 ? net.diamond.d[1] : ew.route.total - net.diamond.d[1];
      const ewLen = this.spec({ kind: 'ew', idx: k.by }).length;
      const clearIn = Math.max(4, k.v) > 0 ? (toD + k.spec.length + 16) / Math.max(4, k.v) : 99;
      let red = false;
      for (const tr of trainsOn(ew, t)) {
        const ahead = eD - tr.s;              // distance still to the diamond
        if (ahead < -(ewLen + 8)) continue;    // long gone
        if (ahead < 0) { red = true; break; }  // on it right now
        const eta = ahead / Math.max(1, tr.v || CRUISE);
        if (eta < clearIn + 3) { red = true; break; }
      }
      if (red && toD > 12) vTarget = Math.min(vTarget, Math.max(0, (toD - 14) * 0.4));
    }
    // committed: never stop on the diamond
    if (toD <= 12 && past < 4) vTarget = Math.max(vTarget, 4);
    const dv = vTarget - k.v;
    k.v += Math.max(-PLAYER_BRAKE * dt, Math.min(PLAYER_ACCEL * dt, dv));
    k.s += k.v * dt;
    if (k.s > seg.route.total) {
      k.s -= seg.route.total;
      [k.bx, k.by] = stepIsland('ns', k.bx, k.by, 1);
    }
  }

  /** the drawn train units within r of world (x, z), as solid footprints
   * (a road vehicle can't drive through a train — index.ts) */
  unitBoxes(x: number, z: number, r = 40): CollisionBox[] {
    const out: CollisionBox[] = [];
    const views = this.kid?.view ? [...this.views, this.kid.view] : this.views;
    for (const v of views) {
      if (!v.used) continue;
      for (const o of v.objs) {
        if (!o || !o.visible) continue;
        const dx = o.position.x - x, dz = o.position.z - z;
        if (dx * dx + dz * dz > r * r) continue;
        const h = (o.userData.h as number) ?? 0, hz = ((o.userData.len as number) ?? 8) / 2, hx = 1.5;
        const ca = Math.abs(Math.cos(h)), sa = Math.abs(Math.sin(h));
        const ex = hx * ca + hz * sa, ez = hx * sa + hz * ca;
        out.push({
          x1: o.position.x - ex, x2: o.position.x + ex, z1: o.position.z - ez, z2: o.position.z + ez,
          obb: { cx: o.position.x, cz: o.position.z, hx, hz, ry: h },
        });
      }
    }
    return out;
  }

  /** advance to game time t, drawing the trains near the player */
  update(dt: number, t: number, px: number, pz: number): void {
    this.time = t;
    if (this.kid) this.driveKid(dt, t);
    for (const v of this.views) v.used = false;
    const want: Array<{ spec: ConsistSpec; line: string; kind: LineKind; bx: number; by: number; s: number; x: number; z: number }> = [];
    const pbx = Math.floor(px / CITY_PITCH), pby = Math.floor(pz / CITY_PITCH);
    for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) {
      const bx = pbx + dx, by = pby + dy;
      // only islands whose cell comes within the draw radius (their segments
      // run inside their own cell)
      const x0 = bx * CITY_PITCH, z0 = by * CITY_PITCH;
      const ddx = Math.max(x0 - px, 0, px - (x0 + CITY_PITCH)), ddz = Math.max(z0 - pz, 0, pz - (z0 + CITY_PITCH));
      if (Math.hypot(ddx, ddz) > DRAW_R) continue;
      // a neighbour still being built by the world worker: its trains are
      // drawn once it's here (building it now would stall the frame)
      if ((dx || dy) && !gate(bx, by)) continue;
      for (const kind of ['ns', 'ew'] as const) {
        const id: LineId = { kind, idx: kind === 'ns' ? bx : by };
        if (this.kid && lineKey(this.kid.line) === lineKey(id)) continue;
        const seg = segment(bx, by, kind);
        for (const tr of trainsOn(seg, t)) {
          const h = this.pose(kind, bx, by, tr.s);
          if (Math.hypot(h.x - px, h.z - pz) > DRAW_R) continue;
          want.push({ spec: this.spec(id), line: lineKey(id), kind, bx, by, s: tr.s, x: h.x, z: h.z });
        }
      }
    }
    // reuse the nearest free view of the same line (a train crossing a
    // portal changes timetable slot, never its look)
    for (const w of want) {
      let view: View | null = null, bd = Infinity;
      for (const v of this.views) {
        if (v.used || v.line !== w.line) continue;
        const d = Math.hypot(v.x - w.x, v.z - w.z);
        if (d < bd) { bd = d; view = v; }
      }
      if (!view) { view = this.makeView(w.spec, w.line); this.views.push(view); }
      view.used = true;
      this.place(view, w.spec, w.kind, w.bx, w.by, w.s);
    }
    if (this.kid) {
      const k = this.kid;
      if (!k.view) k.view = this.makeView(k.spec, 'kid');
      k.view.used = true;
      this.place(k.view, k.spec, 'ns', k.bx, k.by, k.s);
    }
    for (const v of this.views) if (!v.used) for (const o of v.objs) if (o) o.visible = false;
  }
}

/** seed-derived salt so tests can tell cities' railway traffic apart */
export function railSalt(bx: number, by: number): number { return citySeed(bx, by) & 0xffff; }
