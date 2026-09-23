// Working traffic lights. The phase is a pure function of (intersection, time),
// so every light and every car agrees without any communication. Lights are
// SYNCHRONIZED into a green wave: each junction's offset shifts by 8 s per
// 64 m of (x + z), so a car cruising at ~8 m/s along any street meets green
// after green instead of the old random per-node phases.
// E-W green first, then N-S green, per cycle.

export type LightState = 'ew' | 'ewY' | 'ns' | 'nsY';

export const LIGHT_PERIOD = 15; // 6.5 green / 1.5 yellow each direction

const CH = 64; // lattice spacing in metres

/** wave offset per metre of (x + z): 64 m of street ≈ 8 s at cruise speed */
const WAVE_STEP = 0.125;

export function lightState(ix: number, iz: number, t: number): LightState {
  const off = ((ix + iz) * WAVE_STEP * CH) % LIGHT_PERIOD;
  const p = (t + off + LIGHT_PERIOD) % LIGHT_PERIOD;
  if (p < 6.5) return 'ew';
  if (p < 8) return 'ewY';
  if (p < 14.5) return 'ns';
  return 'nsY';
}

/** metres from the intersection centre where cars stop (before the crosswalk) */
export const STOP_LINE = 18.5;
