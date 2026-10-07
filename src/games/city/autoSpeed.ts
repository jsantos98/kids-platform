// Auto speed (G18): a setting for the youngest — the game works the gas and
// the kid only steers. What it does depends on the moment, which the game
// says each frame (`AutoGoal`):
//  · go      flat out: a chase, a course, the race after GO, the plane;
//  · cruise  a gentle 60 % of the vehicle's top speed: the free drive, or a
//            mission vehicle with nowhere to go yet;
//  · stop    cruise, and brake on the way into a target (a call, a delivery,
//            the treasure) to come to a halt inside its reach, where the
//            game's own "stopped beside it" test opens the mission;
//  · off     the train (stopping it is the kid's job: G6), a mission scene.
// The pedals always win: the brake held is the kid's brake (and reverse at a
// standstill), the gas held is full gas. It never brakes below a crawl, so it
// never reverses by itself (a road vehicle's brake at a standstill is
// reverse; the helicopter's and the boat's go backwards too).
import type { PhysicsInput } from './player.js';

export type Pace = 'off' | 'go' | 'cruise' | 'stop';
export interface AutoGoal {
  pace: Pace;
  /** stop: the target (world x, z) and how near counts as there (m) */
  x?: number;
  z?: number;
  reach?: number;
}

/** the cruise, as a share of the vehicle's top speed */
export const CRUISE = 0.6;
/** the braking it plans its stops with (m/s²) — well under any vehicle's */
const DECEL = 3;
/** below this it only coasts (never a brake that would turn into reverse) */
const CRAWL = 0.5;

export interface AutoState { x: number; z: number; heading: number; v: number }

/** the pedals auto speed would press, from the kid's input */
export function autoInput(input: PhysicsInput, st: AutoState, maxF: number, goal: AutoGoal): PhysicsInput {
  if (goal.pace === 'off') return input;
  if (input.brake > 0.05) return { ...input, gas: 0 };
  if (input.gas > 0.05) return { ...input, gas: 1 };
  if (goal.pace === 'go') return { ...input, gas: 1, brake: 0 };
  let want = maxF * CRUISE;
  let stopping = false;
  if (goal.pace === 'stop' && goal.x !== undefined && goal.z !== undefined) {
    const reach = goal.reach ?? 10;
    const dx = goal.x - st.x, dz = goal.z - st.z, d = Math.hypot(dx, dz);
    // (heading toward it — once past it, a target out of reach is left be)
    const closing = dx * Math.sin(st.heading) + dz * Math.cos(st.heading) > 0;
    if (d < reach) { want = 0; stopping = true; }
    else if (closing) {
      const curve = Math.sqrt(2 * DECEL * Math.max(0, d - reach * 0.5));
      if (curve < want) { want = curve; stopping = true; }
    }
  }
  if (st.v < want - 0.3) return { ...input, gas: 1, brake: 0 };
  // (over the cruise it only eases off; into a stop it brakes, down to a crawl)
  if (stopping && st.v > want + 0.5 && st.v > CRAWL) return { ...input, gas: 0, brake: 1 };
  return { ...input, gas: 0, brake: 0 };
}
