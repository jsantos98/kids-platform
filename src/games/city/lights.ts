// Working traffic lights. The phase is a pure function of (intersection, time),
// so every light and every car agrees without any communication. Lights are
// SYNCHRONIZED into a green wave: each junction's offset shifts by 8 s per
// 64 m of (x + z), so a car cruising at ~8 m/s along any street meets green
// after green instead of the old random per-node phases.
// E-W green first, then N-S green, per cycle.

export type LightState = 'ew' | 'ewY' | 'ns' | 'nsY';

export const LIGHT_PERIOD = 15; // 6.5 green / 1.5 yellow each direction

/** wave offset per metre of (x + z): 64 m of street ≈ 8 s at cruise speed */
const WAVE_STEP = 0.125;

/** phase of the junction at city-local (x, z) at time t. Which heads show
 * 'ew' vs 'ns' is the street graph's call (StreetGraph.phaseOf). */
export function lightState(x: number, z: number, t: number): LightState {
  const off = ((x + z) * WAVE_STEP) % LIGHT_PERIOD;
  const p = (t + off + LIGHT_PERIOD) % LIGHT_PERIOD;
  if (p < 6.5) return 'ew';
  if (p < 8) return 'ewY';
  if (p < 14.5) return 'ns';
  return 'nsY';
}

/** seconds of green left for heads showing `phase` (0: not green now) — a
 * car only starts over a level crossing just short of the lights if it will
 * reach the stop line on this green (island/cars.ts) */
export function greenLeft(x: number, z: number, t: number, phase: 'ew' | 'ns'): number {
  const off = ((x + z) * WAVE_STEP) % LIGHT_PERIOD;
  const p = (t + off + LIGHT_PERIOD) % LIGHT_PERIOD;
  if (phase === 'ew') return p < 6.5 ? 6.5 - p : 0;
  return p >= 8 && p < 14.5 ? 14.5 - p : 0;
}

/** metres from the intersection centre where cars stop (before the crosswalk) */
export const STOP_LINE = 18.5;
