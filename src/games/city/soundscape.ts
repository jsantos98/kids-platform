// The game's sound (G11): each frame the kid's engine (by vehicle, speed
// and gas), its siren (the vehicle's own two tones), the bells of a level
// crossing ringing nearby, the horns of cars stuck behind the kid, and the
// ambience (birds by day, crickets at night, waves near the sea); and the
// game's moments as events — a mission done, a star, a gate, a crash, the
// race's countdown and laps, a station stop, a splash — each its own sound.
// (The narrator's voice hangs off the same events: narrator.ts.)
import type { GameAudio, EngineKind, SirenStyle } from '../../engine/audio.js';
import type { SfxId } from '../../engine/sfxList.js';
import { honks } from './island/cars.js';
import { trainHorns } from './transit.js';

export type GameEvent =
  | 'missionDone' | 'star' | 'gate' | 'crash' | 'bumpCar' | 'countdown' | 'go' | 'lap' | 'finish'
  | 'station' | 'missed' | 'splash' | 'horn';

export interface FrameState {
  /** the kid's engine this frame (null: in a mission scene) */
  engine: EngineKind | null;
  /** 0 … 1 of top speed, and the gas pedal 0 … 1 */
  speed: number;
  gas: number;
  siren: boolean;
  sirenStyle: SirenStyle;
  pump: boolean;
  /** the kid (world), its heading, and the time of day */
  x: number;
  z: number;
  heading: number;
  night: number;
  /** 0 far from the sea … 1 on the beach */
  sea: number;
  /** the nearest level crossing warning a train, or null */
  crossing: { x: number; z: number; d: number } | null;
  /** a race car's own engine recording (the kid's) */
  engineRec?: SfxId;
  /** the race rivals: where they are, their car's engine, their speed 0 … 1 */
  rivals?: Array<{ x: number; z: number; id: SfxId; speed: number }>;
}

export class Soundscape {
  private lastHonk = -99;
  private lastTrainHorn = -99;
  private lastBump = -99;
  private t = 0;

  constructor(private audio: GameAudio) {}

  /** where a sound at world (x, z) sits for the kid: pan −1 … 1 and distance */
  private place(s: FrameState, x: number, z: number): { pan: number; dist: number } {
    const dx = x - s.x, dz = z - s.z, dist = Math.hypot(dx, dz) || 1;
    // (the kid's right is (-cos h, sin h) for a heading h facing (sin h, cos h))
    const right = (dx * -Math.cos(s.heading) + dz * Math.sin(s.heading)) / dist;
    return { pan: right, dist };
  }

  frame(dt: number, s: FrameState): void {
    this.t += dt;
    const a = this.audio;
    a.setEngine(s.engine, s.speed, s.gas, s.engineRec);
    a.setRivalEngines(s.engine && s.rivals ? s.rivals.map(r => ({ id: r.id, speed: r.speed, ...this.place(s, r.x, r.z) })) : []);
    a.setSiren(s.siren, s.sirenStyle);
    a.setPump(s.pump);
    if (s.crossing) {
      const p = this.place(s, s.crossing.x, s.crossing.z);
      a.crossingBell(true, p.pan, p.dist);
    } else a.crossingBell(false);
    a.setAmbience(s.night, s.sea);
    // the cars stuck behind the kid honk (one at a time, not every second)
    while (honks.length) {
      const h = honks.shift()!;
      if (this.t - this.lastHonk < 2.5) continue;
      const p = this.place(s, h.x, h.z);
      if (p.dist > 60) continue;
      this.lastHonk = this.t;
      a.honk(p.pan, p.dist);
    }
    // a train coming up to a crossing near the kid sounds its horn (from
    // the crossing, panned; one at a time)
    while (trainHorns.length) {
      const h = trainHorns.shift()!;
      const p = this.place(s, h.x, h.z);
      if (p.dist > 220 || this.t - this.lastTrainHorn < 3) continue;
      this.lastTrainHorn = this.t;
      a.trainHorn(p.pan, p.dist);
    }
  }

  /** a game moment's sound */
  event(e: GameEvent): void {
    const a = this.audio;
    switch (e) {
      case 'missionDone': a.jingle(); break;
      case 'star': a.star(); break;
      case 'gate': a.ding(); break;
      case 'crash': a.boing(); break;
      case 'bumpCar':
        // the car the kid bumped honks (not on every frame of a long push)
        if (this.t - this.lastBump > 2) { this.lastBump = this.t; a.honk(0, 4); }
        break;
      case 'countdown': a.beep(false); break;
      case 'go': a.beep(true); break;
      case 'lap': a.lap(); break;
      case 'finish': a.jingle(); break;
      case 'missed': a.boing(); break;
      case 'station': a.stationBell(); setTimeout(() => a.doorChime(), 900); break;
      case 'splash': a.splash(); break;
      case 'horn': a.trainHorn(); break;
    }
  }
}
