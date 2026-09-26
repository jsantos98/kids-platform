// Race mode: the kid's kart against three AI karts round a race island's
// circuit (raceIsland.ts). Three laps; the AI karts follow the centreline in
// their own lanes and are rubber-banded to the kid (slower when ahead,
// quicker when behind), so every race is close and every finish is
// celebrated. Progress is the kid's unwrapped arc along the centreline, so
// laps count however the kart gets round.
import * as THREE from 'three';
import { nightLights } from './nightLights.js';
import { spawnVehicle } from '../../engine/assets.js';
import { TRACK_HALF, type RaceTrack } from '../../worlds/raceIsland.js';
import { rivalsFor, type RaceCar } from '../raceCars.js';

export const LAPS = 3;
const COUNTDOWN = 3.5;
const CHEER = 7;
const AI_LANE = [-3.5, 3.5, 0];
const AI_SKILL = [1.0, 0.95, 0.9];
/** the AI karts' top speed: below the kid's kart flat out (15 m/s) */
export const AI_TOP = 13.6;
/** the kit tiles' walls stand this far either side of the centreline (m) */
const WALL = 9.2;

interface AiKart {
  group: THREE.Group;
  /** progress along the centreline from the start line (m, unwrapped) */
  s: number;
  lat: number;
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
  /** 1..4 */
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

  /** `kid`: the car the kid picked in the garage; the rivals are three others
   * from the line-up (raceCars.ts), one from each family, varied per island */
  constructor(private scene: THREE.Scene, readonly track: RaceTrack, readonly ox: number, readonly oz: number, kid: RaceCar) {
    const rivals = rivalsFor(kid, Math.round(ox * 7 + oz * 13));
    for (let i = 0; i < 3; i++) {
      const group = new THREE.Group();
      // a bright box until the kit kart streams in
      const stub = new THREE.Mesh(new THREE.BoxGeometry(1.8, 0.9, 3.6), new THREE.MeshLambertMaterial({ color: [0xe25c5c, 0x3f7bff, 0xf2c14e][i] }));
      stub.position.y = 0.6;
      group.add(stub);
      spawnVehicle(`/${rivals[i].glb}`, { len: rivals[i].len, yaw: rivals[i].yaw }).then(g => { group.remove(stub); group.add(g); }).catch(() => {});
      scene.add(group);
      this.ai.push({ group, s: 0, lat: 0, v: 0, place: 0, car: rivals[i] });
    }
  }

  /** everyone back on the grid: the AI karts in slots 0, 2, 3, the kid in
   * slot 1 (world coords) */
  reset(): { x: number; z: number; heading: number } {
    const T = this.track;
    const slots = T.grid;
    [0, 2, 3].forEach((slot, i) => {
      const k = this.ai[i];
      const g = slots[slot];
      k.s = this.arcOf(g.x, g.z);
      k.lat = AI_LANE[i];
      k.v = 0;
      k.place = 0;
    });
    const me = slots[1];
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
        const band = gap > 0 ? 1 - Math.min(0.3, gap / 110) : 1 + Math.min(0.12, -gap / 110);
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
      let want = AI_LANE[i];
      if (Math.abs(kidAlong) < 6 && Math.abs(kidLat - want) < 2.6) want = kidLat > want ? kidLat - 3 : kidLat + 3;
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
