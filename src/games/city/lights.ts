// Working traffic lights. The phase is a pure function of (intersection, time),
// so every light and every car agrees without any communication.
// E-W green first, then N-S green, per cycle.

export type LightState = 'ew' | 'ewY' | 'ns' | 'nsY';

export const LIGHT_PERIOD = 15; // 6.5 green / 1.5 yellow each direction

export function lightState(ix: number, iz: number, t: number): LightState {
  const h = Math.abs((Math.imul(ix, 73856093) ^ Math.imul(iz, 19349663)) | 0) % LIGHT_PERIOD;
  const p = (t + h) % LIGHT_PERIOD;
  if (p < 6.5) return 'ew';
  if (p < 8) return 'ewY';
  if (p < 14.5) return 'ns';
  return 'nsY';
}

/** metres from the intersection centre where cars stop (before the crosswalk) */
export const STOP_LINE = 16.5;
