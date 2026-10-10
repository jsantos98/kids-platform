// Keyboard + USB steering wheel input (Gamepad API). Which control of the
// wheel is the steering, the gas and the brake comes from its calibration
// (wheel.ts, set up on wheel.html — G20); uncalibrated it is the usual
// gamepad layout: steering axis 0, pedals buttons 7 (gas) and 6 (brake),
// A = button 0.
import { readWheel } from './wheel.js';

export interface DriveInput {
  gas: number;
  brake: number;
  steer: number;
  spray: number;
}

const keys: Record<string, boolean> = {};
let mouseX = 0;
let initialized = false;

export function initInput(onKey?: (code: string) => void): void {
  if (initialized) return;
  initialized = true;
  addEventListener('keydown', e => {
    keys[e.code] = true;
    if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space'].includes(e.code)) e.preventDefault();
    onKey?.(e.code);
  });
  addEventListener('keyup', e => { keys[e.code] = false; });
  addEventListener('pointermove', e => { mouseX = (e.clientX / innerWidth) * 2 - 1; });
}

export function isDown(code: string): boolean {
  return !!keys[code];
}

/** Normalized mouse X (-1..1), used as a fallback aim input. */
export function pointerX(): number {
  return mouseX;
}

export function readDriveInput(): DriveInput {
  let gas = keys.KeyW || keys.ArrowUp ? 1 : 0;
  let brake = keys.KeyS || keys.ArrowDown ? 1 : 0;
  let steer = (keys.KeyA || keys.ArrowLeft ? 1 : 0) - (keys.KeyD || keys.ArrowRight ? 1 : 0);
  let spray = keys.Space ? 1 : 0;
  const w = readWheel();
  if (w) {
    if (Math.abs(w.steer) > 0.08) steer = -w.steer;
    if (w.gas > 0.05) gas = Math.max(gas, w.gas);
    if (w.brake > 0.05) brake = Math.max(brake, w.brake);
    if (w.pad.buttons[0]?.pressed) spray = 1;
  }
  return { gas, brake, steer, spray };
}
