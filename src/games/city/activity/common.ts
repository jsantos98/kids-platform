// The mission scenes' contract (G4): the Activity the director runs, what
// the kid does (the wheel, one steer axis) and what a scene hands back each
// frame — its progress, its prompt, the moments that want a sound or a word
// from the narrator — and `aim()`, the steer a perfect player would use,
// which tools/check-scenes.ts drives every scene with. Every scene is its
// own THREE.Scene (a street set, set.ts) rendered on the game's renderer
// while the world keeps ticking behind it.
import * as THREE from 'three';
import type { SetDistrict } from './set.js';

/** what the kid does in a scene: the wheel only (+1 = right on screen) */
export interface ActivityInput {
  steer: number;
  /** 0 by day … 1 at night (the world's time of day, G10) */
  night?: number;
}

export interface ActivityState {
  /** 0..1 progress bar */
  progress: number;
  /** big prompt text */
  prompt: string;
  done: boolean;
  /** over without a win (only the chase: the robber got away, and the chase
   * goes on in the world) */
  lost?: boolean;
}

/** a moment in a scene that the game gives a sound (and maybe a word) */
export type SceneCue =
  | 'hit'        // the water reaches a flame
  | 'out'        // a flame is out
  | 'pop'        // a new flame flares up
  | 'last'       // the last flame (one more!)
  | 'meow'       // the cat
  | 'catMoved'   // the cat went somewhere else
  | 'aboard'     // someone is in the basket / on the line / on the stretcher
  | 'safe'       // someone is down safe
  | 'cheer'      // the onlookers cheer
  | 'heart'      // a heart picked up
  | 'bump'       // the stretcher bumped something
  | 'bark'       // the dog
  | 'doors'      // the ambulance doors open
  | 'caught'     // the robber is caught
  | 'cuffs'      // handcuffs click
  | 'flutter'    // pigeons fly up
  | 'escaped'    // the robber got away
  | 'cannon'     // a cannon fires (G15)
  | 'splash'     // a cannonball falls in the sea
  | 'woodHit'    // a cannonball hits a ship
  | 'sink'       // the rival pirate ship goes down
  | 'surrender'  // the merchant ship waves its white flag
  | 'map'        // a treasure map
  | 'beep'       // the treasure detector
  | 'dig'        // a spadeful of sand
  | 'coins'      // the treasure's gold
  | 'clank'      // the tow truck's ramps drop (G17)
  | 'strap'      // the car strapped onto the bed
  | 'drift'      // the towed car pulled off its line ("keep it in the middle!")
  | 'tip'        // a bin tipped into the garbage truck
  | 'binSet'     // an emptied bin set back down
  | 'doorsSlide' // the train's doors slide open or shut (G6)
  | 'bell'       // everyone aboard: the bell
  | 'latecomer'; // somebody running late for the train

/** a sound a scene keeps going while it wants it */
export type SceneLoop = 'pump' | 'ladder' | 'winch' | 'steps' | 'rotor' | 'crackle' | 'waves';

export interface Activity {
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  update(dt: number, elapsed: number, inp: ActivityInput): ActivityState;
  /** the steer (−1…1) a perfect player would use now */
  aim(): number;
  /** the moments since the last frame (the game drains them) */
  cues: SceneCue[];
  /** the sounds the scene wants going now */
  loops: Set<SceneLoop>;
  /** the water pump sound is on (G11) */
  pumping?: boolean;
  /** celebrate in the scene (called once when done) */
  celebrate(): void;
  dispose(): void;
}

/** what the world's call looked like, so its scene shows the same thing
 * (missions.ts decides it when the call appears) */
export interface CallLook {
  kind: 'building' | 'car' | 'tree' | 'none';
  /** the kit template (house-*, bldg-*, car-*, tree-*) */
  model?: string;
  /** the district round the call: the set's neighbours */
  district?: SetDistrict;
}

/** ease a value toward a target at `rate` per second */
export const ease = (v: number, target: number, rate: number, dt: number): number =>
  v + (target - v) * Math.min(1, dt * rate);

/** a seeded pick */
export const pickOf = <T>(r: () => number, a: readonly T[]): T => a[Math.min(a.length - 1, (r() * a.length) | 0)];
