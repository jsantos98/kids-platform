// Keyboard + USB steering wheel input (Gamepad API).
// Wheels enumerate as generic DirectInput pads: steering = axes[0],
// pedals/paddles = trigger buttons[6]/[7], A = buttons[0].
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
  const gp = navigator.getGamepads?.()[0];
  if (gp) {
    if (Math.abs(gp.axes[0]) > 0.08) steer = -gp.axes[0];
    if (gp.buttons[7] && gp.buttons[7].value > 0.05) gas = Math.max(gas, gp.buttons[7].value);
    if (gp.buttons[6] && gp.buttons[6].value > 0.05) brake = Math.max(brake, gp.buttons[6].value);
    if (gp.buttons[0] && gp.buttons[0].pressed) spray = 1;
  }
  return { gas, brake, steer, spray };
}
