// Race mode: the kid's kart against seven AI karts round a race island's
// circuit (raceIsland.ts), the kid starting last on the grid. Three laps; the
// AI karts follow the centreline in their own lanes, keep out of each
// other's way and are rubber-banded to the kid (slower when ahead, quicker
// when behind), so every race is close and every finish is celebrated. Progress is the kid's unwrapped arc along the centreline, so
// laps count however the kart gets round.
import * as THREE from 'three';
import { nightLights } from './nightLights.js';
import { spawnVehicle } from '../../engine/assets.js';
import { TRACK_HALF, GRID_SLOTS, type RaceTrack } from '../../worlds/raceIsland.js';
import { rivalsFor, type RaceCar } from '../raceCars.js';

export const LAPS = 3;
const COUNTDOWN = 3.5;
const CHEER = 7;
/** the rivals on the grid */
const N_AI = GRID_SLOTS - 1;
/** each rival's pace, by its grid slot (the front row quickest) */
const AI_SKILL = Array.from({ length: N_AI }, (_, i) => 1 - (0.26 * i) / (N_AI - 1));
/** how close behind another rival one looks for a way past (m) */
const FOLLOW = 7;
/** two karts alongside each other keep this far apart across the track (m) */
const ABREAST = 2.8;
/** the AI karts' top speed: below the kid's kart flat out (15 m/s) */
export const AI_TOP = 13.6;
/** the kit tiles' walls stand this far either side of the centreline (m) */
const WALL = 9.2;

interface AiKart {
  group: THREE.Group;
  /** progress along the centreline from the start line (m, unwrapped) */
  s: number;
  lat: number;
  /** its own lane (m off the centreline): on its grid slot's side, the
   * outer lane or the inner one by row */
  lane: number;
  v: number;
  /** finishing place, once over the line for the last time */
  place: number;
  /** its car (the engine it sounds like) */
  car: RaceCar;
}

export type RacePhase = 'countdown' | 'racing' | 'finished';

export interface RaceView {
  phase: RacePhase;
  /** countdown number (3, 2, 1, 0 = GO) */
  count: number;
  lap: number;
  /** 1..8 */
  place: number;
  /** the kid's finishing place (phase 'finished') */
  finalPlace: number;
  /** 0..1 of the whole race */
  progress: number;
}

export class Race {
  readonly ai: AiKart[] = [];
  phase: RacePhase = 'countdown';
  private t = COUNTDOWN;
  /** the kid's progress (m from the start line, unwrapped) */
  private ps = 0;
  private lastRaw = 0;
  private finals = 0;
  private finalPlace = 0;

  /** `kid`: the car the kid picked in the garage; the rivals are seven others
   * from the line-up (raceCars.ts), every family among them, varied per island */
  constructor(private scene: THREE.Scene, readonly track: RaceTrack, readonly ox: number, readonly oz: number, kid: RaceCar) {
    const rivals = rivalsFor(kid, Math.round(ox * 7 + oz * 13), N_AI);
    for (let i = 0; i < rivals.length; i++) {
      const group = new THREE.Group();
      // a bright box (its colour) until the kit kart streams in
      const stub = new THREE.Mesh(new THREE.BoxGeometry(1.8, 0.9, 3.6), new THREE.MeshLambertMaterial({ color: new THREE.Color(rivals[i].color) }));
      stub.position.y = 0.6;
      group.add(stub);
      spawnVehicle(`/${rivals[i].glb}`, { len: rivals[i].len, yaw: rivals[i].yaw }).then(g => { group.remove(stub); group.add(g); }).catch(() => {});
      scene.add(group);
      this.ai.push({ group, s: 0, lat: 0, lane: 0, v: 0, place: 0, car: rivals[i] });
    }
  }

  /** everyone back on the grid: the AI karts in the slots in front, the kid
   * in the last (world coords); each rival waits on its own slot and moves
   * over to its lane once racing */
  reset(): { x: number; z: number; heading: number } {
    const T = this.track;
    const slots = T.grid;
    this.ai.forEach((k, i) => {
      const g = slots[i];
      k.s = this.arcOf(g.x, g.z);
      const p = T.sample(k.s + T.startS);
      k.lat = (g.x - p.x) * Math.cos(p.h) - (g.z - p.z) * Math.sin(p.h);
      k.lane = Math.sign(k.lat || 1) * (Math.floor(i / 2) % 2 ? 1.1 : 3.7);
      k.v = 0;
      k.place = 0;
    });
    const me = slots[slots.length - 1];
    this.lastRaw = T.nearest(me.x, me.z).s;
    this.ps = this.arcOf(me.x, me.z);
    this.phase = 'countdown';
    this.t = COUNTDOWN;
    this.finals = 0;
    this.finalPlace = 0;
    this.place();
    return { x: me.x + this.ox, z: me.z + this.oz, heading: me.h };
  }

  /** signed arc from the start line to (local) x, z, in (-L/2, L/2] */
  private arcOf(x: number, z: number): number {
    const L = this.track.length;
    let d = this.track.nearest(x, z).s - this.track.startS;
    d = ((d % L) + L) % L;
    return d > L / 2 ? d - L : d;
  }

  /** the kid may not move yet */
  get frozen(): boolean { return this.phase === 'countdown'; }

  /** advance the race; (x, z) is the kid's kart (world). Returns what just
   * happened, for the HUD and the cheers. */
  update(dt: number, x: number, z: number): { go?: boolean; lap?: number; finished?: number; restart?: boolean } {
    const T = this.track, L = T.length;
    const lx = x - this.ox, lz = z - this.oz;
    const out: { go?: boolean; lap?: number; finished?: number; restart?: boolean } = {};
    // the kid's progress: unwrapped arc
    const raw = T.nearest(lx, lz).s;
    let d = raw - this.lastRaw;
    if (d > L / 2) d -= L;
    if (d < -L / 2) d += L;
    this.lastRaw = raw;
    const lapBefore = this.lap();
    if (this.phase !== 'countdown') this.ps += d;
    if (this.phase === 'countdown') {
      this.t -= dt;
      if (this.t <= 0) { this.phase = 'racing'; out.go = true; }
    } else if (this.phase === 'racing') {
      if (this.lap() > lapBefore && this.lap() >= 2 && this.lap() <= LAPS) out.lap = this.lap();
      if (this.ps >= LAPS * L) {
        this.finalPlace = ++this.finals;
        this.phase = 'finished';
        this.t = CHEER;
        out.finished = this.finalPlace;
      }
    } else {
      this.t -= dt;
      if (this.t <= 0) out.restart = true;
    }
    // the AI karts
    for (const [i, k] of this.ai.entries()) {
      let target = 0;
      if (this.phase !== 'countdown' && !(k.place && this.phase === 'finished' && k.s > LAPS * L + 40)) {
        // slower in the corners, rubber-banded to the kid
        const a = T.sample(k.s + T.startS + 6), b = T.sample(k.s + T.startS - 6);
        let dh = a.h - b.h;
        while (dh > Math.PI) dh -= Math.PI * 2;
        while (dh < -Math.PI) dh += Math.PI * 2;
        const corner = Math.min(1, Math.abs(dh) / 0.5);
        const gap = k.s - this.ps;
        // (a little quicker when behind, never faster than the kid's kart
        // flat out: a kid who drives well always wins)
        const band = gap > 0 ? 1 - Math.min(0.4, gap / 80) : 1 + Math.min(0.05, -gap / 200);
        target = Math.min(AI_TOP, 12.5 * AI_SKILL[i] * (1 - 0.18 * corner) * band);
        if (k.place) target = Math.min(target, 6); // over the line: a lap of honour
      }
      k.v += Math.max(-8 * dt, Math.min(4.5 * dt, target - k.v));
      k.s += k.v * dt;
      if (!k.place && k.s >= LAPS * L) k.place = ++this.finals;
      // its lane, easing aside when the kid is alongside
      const p = T.sample(k.s + T.startS);
      const rx = Math.cos(p.h), rz = -Math.sin(p.h);
      const kidLat = (lx - p.x) * rx + (lz - p.z) * rz;
      const kidAlong = (lx - p.x) * Math.sin(p.h) + (lz - p.z) * Math.cos(p.h);
      let want = k.lane;
      if (this.phase === 'countdown') want = k.lat;
      // (easing aside when the kid is alongside)
      if (Math.abs(kidAlong) < 6 && Math.abs(kidLat - want) < 2.6) want = kidLat > want ? kidLat - 3 : kidLat + 3;
      // (a rival just ahead in its lane: round it, on the side with more room,
      // or sit behind at its pace — the rivals never drive through each other)
      for (const o of this.ai) {
        const gap = o.s - k.s;
        if (o === k || gap <= 0 || gap > FOLLOW || Math.abs(o.lat - want) > 2.6) continue;
        const side = o.lat > 0 ? o.lat - 3.2 : o.lat + 3.2;
        if (Math.abs(side) <= TRACK_HALF - 1.5) want = side;
        // (right on its tail and not round it yet: no closer)
        if (gap < 5 && Math.abs(o.lat - k.lat) < 2.2) k.v = Math.min(k.v, o.v * 0.95);
      }
      // (one alongside: never move across into it — ease away instead; with
      // no room left on that side, the one behind drops back)
      for (const o of this.ai) {
        if (o === k || Math.abs(o.s - k.s) > 4.5) continue;
        const away = k.lat === o.lat ? (k.lane >= o.lane ? 1 : -1) : Math.sign(k.lat - o.lat);
        if (Math.abs(k.lat - o.lat) < ABREAST) want = k.lat + away;
        else if ((want - o.lat) * away < ABREAST) want = o.lat + away * ABREAST;
        if (Math.abs(want) > TRACK_HALF - 1.5 && Math.abs(k.lat - o.lat) < ABREAST && k.s <= o.s) k.v = Math.min(k.v, o.v * 0.9);
      }
      want = Math.max(-TRACK_HALF + 1.5, Math.min(TRACK_HALF - 1.5, want));
      k.lat += Math.max(-2 * dt, Math.min(2 * dt, want - k.lat));
      k.group.position.set(p.x + rx * k.lat + this.ox, 0.19, p.z + rz * k.lat + this.oz);
      k.group.rotation.y = p.h;
      // (at night: its lamps, G10)
      nightLights()?.carLamps(k.group.position.x, 0.19, k.group.position.z, p.h, 1.9, 0.9, 0.45);
    }
    return out;
  }

  /** the kid's lap (1-based; 0 before the line) */
  lap(): number { return this.ps < 0 ? 0 : Math.floor(this.ps / this.track.length) + 1; }

  /** the kid's current place */
  place(): number {
    return 1 + this.ai.filter(k => (k.place && (!this.finalPlace || k.place < this.finalPlace)) || (!k.place && !this.finalPlace && k.s > this.ps)).length;
  }

  view(): RaceView {
    return {
      phase: this.phase,
      count: Math.max(0, Math.ceil(this.t - 0.5)),
      lap: Math.max(1, Math.min(LAPS, this.lap())),
      place: this.finalPlace || this.place(),
      finalPlace: this.finalPlace,
      progress: Math.max(0, Math.min(1, this.ps / (LAPS * this.track.length))),
    };
  }

  /** where the guide arrow points: the centreline a little ahead (world) */
  aheadPoint(dist = 28): { x: number; z: number } {
    const p = this.track.sample(this.ps + this.track.startS + dist);
    return { x: p.x + this.ox, z: p.z + this.oz };
  }

  /** a bump resumes the kart on the track just behind where it was (world) */
  resumeSpot(): { x: number; z: number; heading: number } {
    const p = this.track.sample(this.ps + this.track.startS - 6);
    return { x: p.x + this.ox, z: p.z + this.oz, heading: p.h };
  }

  /** how far (world x, z) is off the centreline */
  offTrack(x: number, z: number): number {
    return this.track.nearest(x - this.ox, z - this.oz).d - TRACK_HALF;
  }

  /** the kit tiles' low walls, as soft walls: a kart (radius r, world x, z)
   * reaching one is pushed back along it, never through it — only near the
   * track, so a kart that somehow left it isn't dragged across the infield */
  wall(x: number, z: number, r: number): { dx: number; dz: number } | null {
    const n = this.track.nearest(x - this.ox, z - this.oz);
    const lim = WALL - r;
    if (n.d <= lim || n.d > lim + 8) return null;
    const p = this.track.sample(n.s);
    const dx = p.x + this.ox - x, dz = p.z + this.oz - z, d = Math.hypot(dx, dz) || 1;
    return { dx: (dx / d) * (n.d - lim), dz: (dz / d) * (n.d - lim) };
  }

  /** soft bumps with the AI karts: returns a push for the kid's kart */
  bump(x: number, z: number): { dx: number; dz: number } | null {
    for (const k of this.ai) {
      const dx = x - k.group.position.x, dz = z - k.group.position.z;
      const d = Math.hypot(dx, dz);
      if (d < 2.6 && d > 1e-3) return { dx: (dx / d) * (2.6 - d), dz: (dz / d) * (2.6 - d) };
    }
    return null;
  }

  dispose(): void {
    for (const k of this.ai) this.scene.remove(k.group);
  }
}
