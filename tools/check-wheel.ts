// G20 check: the wheel works whatever its layout (src/engine/wheel.ts).
// Simulated wheels — a pad that follows the game's old layout, pedals as
// axes resting at +1, gas and brake sharing one axis, an inverted steering
// axis, an off-centre one, pedals on other buttons, noise, a hat switch —
// are each driven through the guided calibration the way a person would
// (let go, wheel left, wheel right, gas, brake: ramping to each position and
// holding it), and then read through the result:
//  · the calibration finishes, and the wheel's full left reads −1, centre 0,
//    full right +1 (to 3 %);
//  · each pedal reads 0 at rest and 1 pressed, and pressing one never moves
//    the other;
//  · with nothing calibrated the old layout still reads (axis 0 steering,
//    buttons 7 gas and 6 brake) so a wheel that already worked still does;
//  · skipping the brake leaves it none (0); a wheel's steering can't be skipped;
//  · the buttons' jobs: any number of buttons for one action (two for the
//    siren), a button has one job (giving it another takes it off the first),
//    they survive recalibrating and going back to the standard axes, a button
//    given to the gas or brake reads as that pedal pressed, and a tap action
//    fires once per press — not while held, not for a button already down
//    when the page opened, not for the gas / brake buttons — and a button
//    with another job no longer also starts the garage.
//   npx tsx tools/check-wheel.ts
import {
  Calibrator, DEFAULT_CFG, steerOf, pedalOf, bindKey, unbindKey, actionOf, keysOf, saveKeys, saveCfg, resetCfg, savedCfg, isCalibrated, cfgFor,
  readWheel, wheelHeld, watchWheelActions, type Snapshot, type WheelCfg, type WheelAction,
} from '../src/engine/wheel.js';

// (a stand-in browser: storage, one gamepad, and an animation frame we step by hand)
const store = new Map<string, string>();
Object.defineProperty(globalThis, 'localStorage', { value: { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => { store.set(k, v); }, removeItem: (k: string) => { store.delete(k); } }, configurable: true });
const fakePad = { id: 'Test Wheel (Vendor: 1 Product: 2)', connected: true, axes: [0, 1, 1], buttons: Array.from({ length: 14 }, () => ({ pressed: false, value: 0 })) };
let padPresent = true;
Object.defineProperty(globalThis, 'navigator', { value: { getGamepads: () => (padPresent ? [null, fakePad] : [null]) }, configurable: true });
const frames: Array<() => void> = [];
(globalThis as unknown as { requestAnimationFrame: (f: () => void) => number }).requestAnimationFrame = f => frames.push(f);
const press = (...n: number[]): void => { for (const i of n) { fakePad.buttons[i].pressed = true; fakePad.buttons[i].value = 1; } };
const release = (...n: number[]): void => { for (const i of n) { fakePad.buttons[i].pressed = false; fakePad.buttons[i].value = 0; } };
const releaseAll = (): void => release(...fakePad.buttons.keys());
const step = (): void => { const f = frames.splice(0); for (const g of f) g(); };

let fails = 0;
const fail = (m: string): void => { fails++; console.log('  FAIL ' + m); };
const near = (a: number, b: number, tol: number): boolean => Math.abs(a - b) <= tol;

interface Sim {
  name: string;
  /** the values at rest, and with each control pushed fully */
  rest: Snapshot;
  left: Partial<Snapshot>; right: Partial<Snapshot>; gas: Partial<Snapshot>; brake: Partial<Snapshot>;
  /** random wobble on every axis */
  noise?: number;
  skipBrake?: boolean;
}
const snap = (axes: number[], buttons: number[]): Snapshot => ({ axes, buttons });
const set = (base: number[], idx: number, v: number): number[] => base.map((x, i) => (i === idx ? v : x));

const sims: Sim[] = [
  { // a game-controller layout: wheel axis 0, pedals analogue buttons 7 / 6
    name: 'controller layout (axis 0, buttons 7 and 6)',
    rest: snap([0, 0, 0, 0], new Array(12).fill(0)),
    left: { axes: [-1, 0, 0, 0] }, right: { axes: [1, 0, 0, 0] },
    gas: { buttons: set(new Array(12).fill(0), 7, 1) }, brake: { buttons: set(new Array(12).fill(0), 6, 1) },
  },
  { // pedals as axes resting at +1 and going to −1
    name: 'pedals on axes 1 and 2, resting at +1',
    rest: snap([0, 1, 1, 0], new Array(8).fill(0)),
    left: { axes: [-1, 1, 1, 0] }, right: { axes: [1, 1, 1, 0] },
    gas: { axes: [0, -1, 1, 0] }, brake: { axes: [0, 1, -1, 0] },
  },
  { // gas and brake on ONE axis: resting in the middle, gas one way, brake the other
    name: 'gas and brake sharing axis 1',
    rest: snap([0, 0, 0], new Array(6).fill(0)),
    left: { axes: [-1, 0, 0] }, right: { axes: [1, 0, 0] },
    gas: { axes: [0, -1, 0] }, brake: { axes: [0, 1, 0] },
  },
  { // the steering axis the other way round, a wheel that locks at 0.8 and sits a little off centre
    name: 'inverted steering, off centre, short lock',
    rest: snap([0.1, -1, -1], new Array(4).fill(0)),
    left: { axes: [0.9, -1, -1] }, right: { axes: [-0.7, -1, -1] },
    gas: { axes: [0.1, 1, -1] }, brake: { axes: [0.1, -1, 1] },
  },
  { // pedals on other buttons (2 and 3), noisy axes, and a hat switch resting at 3.29
    name: 'buttons 2 and 3, noise, a hat switch',
    rest: snap([0, 0.3, -0.3, 3.2857], new Array(10).fill(0)),
    left: { axes: [-1, 0.3, -0.3, 3.2857] }, right: { axes: [1, 0.3, -0.3, 3.2857] },
    gas: { buttons: set(new Array(10).fill(0), 2, 1) }, brake: { buttons: set(new Array(10).fill(0), 3, 1) },
    noise: 0.04,
  },
  { // a wheel with no brake pedal: the brake step is skipped
    name: 'no brake pedal (skipped)',
    rest: snap([0, 0, 0], new Array(4).fill(0)),
    left: { axes: [-1, 0, 0] }, right: { axes: [1, 0, 0] },
    gas: { buttons: set(new Array(4).fill(0), 1, 1) }, brake: {},
    skipBrake: true,
  },
];

function pose(sim: Sim, part: Partial<Snapshot> | null): Snapshot {
  return { axes: part?.axes ?? sim.rest.axes, buttons: part?.buttons ?? sim.rest.buttons };
}

for (const sim of sims) {
  const cal = new Calibrator();
  let cur: Snapshot = { axes: [...sim.rest.axes], buttons: [...sim.rest.buttons] };
  let t = 0, finished = false;
  const lerpTo = (target: Snapshot, dt: number): void => {
    // (a person ramps to a position in about 0.3 s)
    const k = Math.min(1, dt / 0.3);
    cur = { axes: cur.axes.map((v, i) => v + (target.axes[i] - v) * k), buttons: cur.buttons.map((v, i) => v + (target.buttons[i] - v) * k) };
  };
  for (let f = 0; f < 60 * 60 && !finished; f++) {
    const dt = 1 / 60; t += dt;
    // what the person does for this step
    let target: Snapshot;
    if (cal.releasing || cal.step === 'rest') target = sim.rest;
    else if (cal.step === 'left') target = pose(sim, sim.left);
    else if (cal.step === 'right') target = pose(sim, sim.right);
    else if (cal.step === 'gas') target = pose(sim, sim.gas);
    else if (cal.step === 'brake') target = sim.skipBrake ? sim.rest : pose(sim, sim.brake);
    else target = sim.rest;
    lerpTo(target, dt);
    const noisy: Snapshot = sim.noise
      ? { axes: cur.axes.map(v => v + (Math.random() - 0.5) * sim.noise! * (v === 3.2857 ? 0 : 1)), buttons: cur.buttons }
      : cur;
    if (sim.skipBrake && cal.step === 'brake' && t > 0) cal.skip();
    cal.update(noisy, dt);
    if (cal.step === 'done') finished = true;
  }
  if (!finished) { fail(`${sim.name}: the calibration never finished (stuck at '${cal.step}')`); continue; }
  const c: WheelCfg = cal.result();
  const read = (part: Partial<Snapshot> | null): { steer: number; gas: number; brake: number } => {
    const s = pose(sim, part);
    return { steer: steerOf(s, c), gas: pedalOf(s, c.gas), brake: pedalOf(s, c.brake) };
  };
  const rest = read(null), left = read(sim.left), right = read(sim.right), gas = read(sim.gas), brake = read(sim.brake);
  if (!near(rest.steer, 0, 0.03) || rest.gas !== 0 || rest.brake !== 0) fail(`${sim.name}: at rest it reads steer ${rest.steer.toFixed(2)}, gas ${rest.gas.toFixed(2)}, brake ${rest.brake.toFixed(2)}`);
  if (!near(left.steer, -1, 0.04)) fail(`${sim.name}: full left reads ${left.steer.toFixed(2)}`);
  if (!near(right.steer, 1, 0.04)) fail(`${sim.name}: full right reads ${right.steer.toFixed(2)}`);
  if (!near(gas.gas, 1, 0.05) || gas.brake > 0.05) fail(`${sim.name}: the gas pedal reads gas ${gas.gas.toFixed(2)} and brake ${gas.brake.toFixed(2)}`);
  if (sim.skipBrake) { if (brake.brake !== 0) fail(`${sim.name}: the skipped brake reads ${brake.brake.toFixed(2)}`); }
  else if (!near(brake.brake, 1, 0.05) || brake.gas > 0.05) fail(`${sim.name}: the brake pedal reads brake ${brake.brake.toFixed(2)} and gas ${brake.gas.toFixed(2)}`);
  console.log(`${sim.name}: calibrated — steering axis ${c.steerAxis}, gas ${c.gas.index < 0 ? 'none' : c.gas.kind + ' ' + c.gas.index}, brake ${c.brake.index < 0 ? 'none' : c.brake.kind + ' ' + c.brake.index}`);
}

// ---- nothing calibrated: the old layout still reads ----
{
  const s = snap([-0.5, 0, 0], set(new Array(10).fill(0), 7, 0.8).map((v, i) => (i === 6 ? 0.3 : v)));
  if (!near(steerOf(s, DEFAULT_CFG), -0.5, 0.01)) fail(`the standard setup reads steering ${steerOf(s, DEFAULT_CFG)}, not -0.5`);
  if (!near(pedalOf(s, DEFAULT_CFG.gas), 0.8, 0.01)) fail(`the standard setup reads gas ${pedalOf(s, DEFAULT_CFG.gas)}, not 0.8 (button 7)`);
  if (!near(pedalOf(s, DEFAULT_CFG.brake), 0.3, 0.01)) fail(`the standard setup reads brake ${pedalOf(s, DEFAULT_CFG.brake)}, not 0.3 (button 6)`);
}
// ---- the steering can't be skipped ----
{
  const cal = new Calibrator();
  for (let f = 0; f < 120; f++) cal.update(snap([0, 0], [0]), 1 / 60);
  if (cal.step !== 'left') fail(`after the rest sample the step is '${cal.step}', not 'left'`);
  cal.skip();
  if (cal.step !== 'left') fail('the steering step was skipped');
}


// ---- the buttons' jobs ----
{
  // several buttons for one action; a button has one job
  let cfg: WheelCfg = { ...DEFAULT_CFG };
  cfg = { ...cfg, keys: bindKey(cfg, 'siren', 3) };
  cfg = { ...cfg, keys: bindKey(cfg, 'siren', 4) };
  cfg = { ...cfg, keys: bindKey(cfg, 'siren', 11) };
  if (keysOf(cfg, 'siren').join() !== '3,4,11') fail(`three buttons for the siren read ${keysOf(cfg, 'siren').join()}`);
  cfg = { ...cfg, keys: bindKey(cfg, 'camera', 4) };
  if (keysOf(cfg, 'siren').join() !== '3,11' || keysOf(cfg, 'camera').join() !== '4' || actionOf(cfg, 4) !== 'camera') fail('giving button 4 to the camera did not take it off the siren');
  cfg = { ...cfg, keys: unbindKey(cfg, 'siren', 3) };
  if (keysOf(cfg, 'siren').join() !== '11' || actionOf(cfg, 3) !== null) fail('removing button 3 from the siren failed');
}
{
  // saved per wheel: buttons only, then a calibration, then back to standard — the jobs stay
  const id = fakePad.id;
  saveKeys(id, { siren: [3, 5], muteMusic: [6] });
  if (isCalibrated(id)) fail('a wheel with only its buttons set counts as calibrated');
  if (keysOf(cfgFor(id), 'siren').join() !== '3,5') fail('the buttons were not kept');
  if (cfgFor(id).steerAxis !== 0 || cfgFor(id).gas.index !== 7) fail('saving buttons changed the standard axes and pedals');
  const calibrated: WheelCfg = { ...DEFAULT_CFG, gas: { kind: 'axis', index: 1, rest: 1, full: -1 }, brake: { kind: 'axis', index: 2, rest: 1, full: -1 } };
  saveCfg(id, calibrated);
  if (!isCalibrated(id) || keysOf(cfgFor(id), 'siren').join() !== '3,5') fail('calibrating lost the buttons\' jobs or did not count as calibrated');
  resetCfg(id);
  if (isCalibrated(id) || keysOf(cfgFor(id), 'muteMusic').join() !== '6') fail('going back to the standard axes lost the buttons\' jobs');
  saveKeys(id, undefined);
  if (savedCfg(id)) fail('a wheel with no buttons and no calibration should leave nothing saved');
}
{
  // the gas and brake buttons read as the pedals pressed; with a pedal on an axis too, whichever is further
  const id = fakePad.id;
  saveCfg(id, { ...DEFAULT_CFG, gas: { kind: 'axis', index: 1, rest: 1, full: -1 }, brake: { kind: 'axis', index: 2, rest: 1, full: -1 }, keys: { gas: [8, 9], brake: [10] } });
  releaseAll(); fakePad.axes = [0, 1, 1];
  let w = readWheel()!;
  if (w.gas !== 0 || w.brake !== 0) fail(`at rest the wheel reads gas ${w.gas}, brake ${w.brake}`);
  press(9); w = readWheel()!;
  if (w.gas !== 1 || w.brake !== 0) fail(`a button given to the gas reads gas ${w.gas}, brake ${w.brake}`);
  release(9); press(10); w = readWheel()!;
  if (w.brake !== 1 || w.gas !== 0) fail(`a button given to the brake reads brake ${w.brake}, gas ${w.gas}`);
  releaseAll(); fakePad.axes = [0, 0, 1]; w = readWheel()!;
  if (Math.abs(w.gas - 0.5) > 0.02) fail(`the gas pedal half down reads ${w.gas}`);
  press(8); w = readWheel()!;
  if (w.gas !== 1) fail(`the pedal half down and a gas button together read ${w.gas}, not 1`);
  releaseAll(); fakePad.axes = [0, 1, 1];
}
{
  // the watcher: one tap per press
  const id = fakePad.id;
  saveCfg(id, { ...DEFAULT_CFG, keys: { siren: [3, 4], muteMusic: [6], gas: [8], go: [7] } });
  releaseAll(); press(6); // (muteMusic's button is already down as the page opens)
  const fired: WheelAction[] = [];
  watchWheelActions(a => fired.push(a));
  step(); step();
  if (fired.length) fail(`a button held as the page opened fired ${fired.join()}`);
  release(6); step();
  press(3); step(); step(); step(); step();
  if (fired.join() !== 'siren') fail(`one press of a siren button fired ${fired.join() || 'nothing'} over four frames`);
  press(4); step(); step();
  if (fired.join() !== 'siren') fail(`a second siren button pressed while the first is held fired again (${fired.join()})`);
  release(3, 4); step(); press(4); step();
  if (fired.join() !== 'siren,siren') fail(`the second siren button alone did not fire the siren (${fired.join()})`);
  release(4); step();
  press(8); step(); step();
  if (fired.length !== 2) fail(`the gas button fired a tap action (${fired.join()})`);
  release(8); press(6); step();
  if (fired.join() !== 'siren,siren,muteMusic') fail(`the music button did not fire (${fired.join()})`);
  release(6); step();
  // no wheel: nothing fires and nothing breaks
  padPresent = false; step(); step(); padPresent = true;
  if (fired.length !== 3) fail(`unplugged, something fired: ${fired.join()}`);
  // a button with another job no longer starts the garage; the gas pedal's own legacy buttons still do
  releaseAll(); press(2);
  saveCfg(id, { ...DEFAULT_CFG, keys: { siren: [2] } });
  if (wheelHeld('go', [0, 1, 2, 3, 9])) fail('button 2 (the siren) still counts as go');
  release(2); press(1);
  if (!wheelHeld('go', [0, 1, 2, 3, 9])) fail('button 1 no longer counts as go');
  release(1); press(7);
  saveCfg(id, { ...DEFAULT_CFG, keys: { go: [7] } });
  if (!wheelHeld('go', [0, 1, 2, 3, 9])) fail('a button given to go does not count as go');
  releaseAll();
  console.log('buttons: several to one action, one job each, kept through recalibration; taps fire once; the gas / brake buttons read as pedals');
}

console.log(fails ? `FAIL — ${fails} problem(s) with the wheel (G20)` : 'PASS — every wheel layout calibrates and reads right, and the standard one still works (G20)');
process.exit(fails ? 1 : 0);
