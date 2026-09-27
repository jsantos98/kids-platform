// The mission director: arriving at a call fades the world out and a focused
// mini-scene in (hose, ladders, stretcher run, winch, the chase); when the activity is done it
// celebrates for a moment, then fades back to the world. The world keeps
// simulating the whole time — only its rendering is swapped out.
import * as THREE from 'three';
import type { Activity, ActivityInput } from './common.js';
import { t as tr } from '../../../i18n/index.js';

const FADE = 0.4;       // seconds for each fade half
const REWARD = 1.8;     // seconds of celebration before returning

type Phase = 'idle' | 'out' | 'in' | 'play' | 'reward' | 'back' | 'return';

export interface DirectorView {
  /** an activity is showing (render its scene/camera) */
  scene: THREE.Scene | null;
  camera: THREE.PerspectiveCamera | null;
  prompt: string;
  progress: number;
  /** the world is paused for the player (no driving) */
  busy: boolean;
}

export class Director {
  private phase: Phase = 'idle';
  private t = 0;
  private act: Activity | null = null;
  private make: (() => Activity) | null = null;
  private onDone: (() => void) | null = null;
  private onWin: (() => void) | null = null;
  private last = { prompt: '', progress: 0 };
  /** the wheel as it was when the activity finished: held there during the
   * celebration so nothing slides away (a moved ladder would scare the cat) */
  private frozen: ActivityInput = { steer: 0 };

  constructor(private fade: HTMLElement) {
    addEventListener('resize', () => {
      if (!this.act) return;
      this.act.camera.aspect = innerWidth / innerHeight;
      this.act.camera.updateProjectionMatrix();
    });
  }

  get busy(): boolean { return this.phase !== 'idle'; }

  /** the scene is being played (not fading, not celebrating) */
  get playing(): boolean { return this.phase === 'play'; }

  /** the scene showing now (its cues and loops for the game's sound) */
  get activity(): Activity | null { return this.act; }

  /** the pump is running in the current scene */
  get pumping(): boolean { return this.phase === 'play' && !!this.act?.pumping; }

  /** fade out of the world into a new activity; `win` fires the moment it is
   * won (the cheering belongs there, over the scene's own celebration, not
   * after the fade back), `done` once the player is back in the world */
  start(make: () => Activity, done: () => void, win?: () => void): void {
    if (this.busy) return;
    this.make = make;
    this.onDone = done;
    this.onWin = win ?? null;
    this.phase = 'out';
    this.t = 0;
  }

  update(dt: number, elapsed: number, inp: ActivityInput): DirectorView {
    this.t += dt;
    let opacity = 0;
    switch (this.phase) {
      case 'idle':
        break;
      case 'out':
        opacity = Math.min(1, this.t / FADE);
        if (this.t >= FADE) {
          this.act = this.make!();
          this.act.camera.aspect = innerWidth / innerHeight;
          this.act.camera.updateProjectionMatrix();
          this.phase = 'in';
          this.t = 0;
        }
        break;
      case 'in':
        opacity = 1 - Math.min(1, this.t / FADE);
        this.step(dt, elapsed, inp);
        if (this.t >= FADE) { this.phase = 'play'; this.t = 0; }
        break;
      case 'play':
        if (this.step(dt, elapsed, inp)) {
          this.frozen = { ...inp };
          this.act!.celebrate();
          this.onWin?.();
          this.onWin = null;
          this.last.prompt = tr('scene.wellDone');
          this.last.progress = 1;
          this.phase = 'reward';
          this.t = 0;
        }
        break;
      case 'reward':
        this.act!.update(dt, elapsed, this.frozen);
        this.last.prompt = tr('scene.wellDone');
        if (this.t >= REWARD) { this.phase = 'back'; this.t = 0; }
        break;
      case 'back':
        opacity = Math.min(1, this.t / FADE);
        this.act!.update(dt, elapsed, this.frozen);
        if (this.t >= FADE) {
          this.act!.dispose();
          this.act = null;
          this.onDone?.();
          this.onDone = null;
          this.phase = 'return';
          this.t = 0;
        }
        break;
      case 'return':
        opacity = 1 - Math.min(1, this.t / FADE);
        if (this.t >= FADE) { this.phase = 'idle'; this.t = 0; }
        break;
    }
    this.fade.style.opacity = opacity.toFixed(3);
    return {
      scene: this.act?.scene ?? null,
      camera: this.act?.camera ?? null,
      prompt: this.last.prompt,
      progress: this.last.progress,
      busy: this.busy,
    };
  }

  /** run the activity one frame; true when it just finished */
  private step(dt: number, elapsed: number, inp: ActivityInput): boolean {
    const s = this.act!.update(dt, elapsed, inp);
    this.last = { prompt: s.prompt, progress: s.progress };
    return s.done;
  }
}
