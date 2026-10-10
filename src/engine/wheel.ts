// The steering wheel (G20): any USB wheel, however it numbers its controls.
// Wheels show up as generic gamepads, and they disagree: the steering is
// nearly always axis 0, but the pedals may be buttons (a game-controller
// layout: 6 and 7) or axes of their own (resting at +1 or -1 or 0 and moving
// to the other end), or gas and brake may share one axis. So the game doesn't
// guess: `WheelCfg` says which control is which and what its resting and
// pressed values are, filled in by the calibration page (wheel.html) and kept
// in localStorage per wheel; without one the old layout (axis 0, buttons 7 and
// 6) is used. `Calibrator` is the guided calibration as plain logic, so it can
// be tested without a wheel (tools/check-wheel.ts).
//
// Conventions: steering is +1 turned RIGHT (the axis's own sign, as for a
// gamepad stick), gas and brake 0 … 1.

/** what a wheel button can do: stand in for the gas or the brake pedal (held,
 * for a child who doesn't take to pedals), or do a key's job — the siren (E),
 * the camera (C), the two mute buttons, back to the start (R), Enter and Esc */
export const WHEEL_ACTIONS = ['gas', 'brake', 'siren', 'camera', 'muteSound', 'muteMusic', 'reset', 'go', 'back'] as const;
export type WheelAction = typeof WHEEL_ACTIONS[number];
/** the actions that last as long as the button is held (the others are taps) */
export const HELD_ACTIONS: ReadonlySet<WheelAction> = new Set<WheelAction>(['gas', 'brake']);

/** one pedal: a button (its analogue value), an axis (resting at `rest`, `full` when pressed), or none (index −1) */
export interface PedalCfg { kind: 'axis' | 'button'; index: number; rest: number; full: number }
export interface WheelCfg {
  steerAxis: number;
  /** the axis's values at rest, fully left and fully right */
  center: number;
  left: number;
  right: number;
  gas: PedalCfg;
  brake: PedalCfg;
  /** the buttons given to each action — any number of them for one action
   * (two to turn the siren on and off, say); a button has one job */
  keys?: Partial<Record<WheelAction, number[]>>;
  /** saved for its buttons only: the axes and pedals are the standard layout, not calibrated */
  keysOnly?: boolean;
}

export const DEFAULT_CFG: WheelCfg = {
  steerAxis: 0, center: 0, left: -1, right: 1,
  gas: { kind: 'button', index: 7, rest: 0, full: 1 },
  brake: { kind: 'button', index: 6, rest: 0, full: 1 },
};

/** the values of a gamepad at one moment (what a calibration compares) */
export interface Snapshot { axes: number[]; buttons: number[] }

export function snapshot(gp: Gamepad): Snapshot {
  return { axes: Array.from(gp.axes), buttons: gp.buttons.map(b => b.value) };
}

const clamp = (v: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, v));

/** −1 (left) … +1 (right): the steering axis mapped through its calibration (a little dead zone round the middle) */
export function steerOf(s: Snapshot, c: WheelCfg): number {
  const raw = s.axes[c.steerAxis];
  if (raw === undefined || !Number.isFinite(raw)) return 0;
  const d = raw - c.center, toRight = c.right - c.center, toLeft = c.left - c.center;
  let v = 0;
  if (Math.abs(toRight) > 0.05 && d * toRight >= 0) v = d / toRight;
  else if (Math.abs(toLeft) > 0.05) v = -d / toLeft;
  v = clamp(v, -1, 1);
  return Math.abs(v) < 0.03 ? 0 : v;
}

/** 0 … 1: how far down a pedal is */
export function pedalOf(s: Snapshot, p: PedalCfg): number {
  if (p.index < 0) return 0;
  let v: number;
  if (p.kind === 'button') v = s.buttons[p.index] ?? 0;
  else {
    const raw = s.axes[p.index], span = p.full - p.rest;
    if (raw === undefined || !Number.isFinite(raw) || Math.abs(span) < 0.1) return 0;
    v = (raw - p.rest) / span;
  }
  v = clamp(v, 0, 1);
  return v < 0.04 ? 0 : v;
}

// ---- keeping the calibration ----
const STORE = 'wheel.cfg', PREFERRED = 'wheel.pad';

function readStore(): Record<string, WheelCfg> {
  try { return JSON.parse(localStorage.getItem(STORE) ?? '{}') as Record<string, WheelCfg>; } catch { return {}; }
}
const sane = (c: unknown): c is WheelCfg => {
  const o = c as WheelCfg | null;
  const ped = (p: PedalCfg | undefined): boolean => !!p && (p.kind === 'axis' || p.kind === 'button') && Number.isFinite(p.index) && Number.isFinite(p.rest) && Number.isFinite(p.full);
  return !!o && Number.isFinite(o.steerAxis) && Number.isFinite(o.center) && Number.isFinite(o.left) && Number.isFinite(o.right) && ped(o.gas) && ped(o.brake);
};
/** a stored button list cleaned up: whole numbers only, no repeats */
const cleanKeys = (k: WheelCfg['keys']): WheelCfg['keys'] => {
  const out: Partial<Record<WheelAction, number[]>> = {};
  for (const a of WHEEL_ACTIONS) {
    const l = k?.[a];
    if (Array.isArray(l)) { const u = [...new Set(l.filter(n => Number.isInteger(n) && n >= 0))]; if (u.length) out[a] = u; }
  }
  return Object.keys(out).length ? out : undefined;
};

/** the calibration saved for this wheel, or null */
export function savedCfg(id: string): WheelCfg | null {
  const c = readStore()[id];
  return sane(c) ? { ...c, keys: cleanKeys(c.keys) } : null;
}
/** was the wheel's steering and pedals calibrated (not just its buttons given jobs)? */
export function isCalibrated(id: string): boolean { const c = savedCfg(id); return !!c && !c.keysOnly; }
export function cfgFor(id: string): WheelCfg { return savedCfg(id) ?? DEFAULT_CFG; }
/** keep a calibration (the buttons already given jobs stay) */
export function saveCfg(id: string, cfg: WheelCfg): void {
  try {
    const all = readStore();
    all[id] = { ...cfg, keys: cleanKeys(cfg.keys ?? savedCfg(id)?.keys), keysOnly: undefined };
    localStorage.setItem(STORE, JSON.stringify(all)); localStorage.setItem(PREFERRED, id);
  } catch { /* no storage */ }
}
/** keep only the buttons' jobs, leaving the axes and pedals as they are */
export function saveKeys(id: string, keys: WheelCfg['keys']): void {
  try {
    const all = readStore(), cur = savedCfg(id);
    const next: WheelCfg = { ...(cur ?? DEFAULT_CFG), keys: cleanKeys(keys), keysOnly: cur ? cur.keysOnly : true };
    if (!next.keys && next.keysOnly) delete all[id]; else all[id] = next;
    localStorage.setItem(STORE, JSON.stringify(all)); localStorage.setItem(PREFERRED, id);
  } catch { /* no storage */ }
}
/** back to the standard axes and pedals (the buttons' jobs are kept) */
export function resetCfg(id: string): void {
  const keys = savedCfg(id)?.keys;
  try { const all = readStore(); delete all[id]; localStorage.setItem(STORE, JSON.stringify(all)); } catch { /* no storage */ }
  if (keys) saveKeys(id, keys);
}

// ---- the buttons' jobs ----
/** the buttons this wheel has for an action */
export function keysOf(cfg: WheelCfg, action: WheelAction): number[] { return cfg.keys?.[action] ?? []; }
/** which action a button has, if any */
export function actionOf(cfg: WheelCfg, button: number): WheelAction | null {
  return WHEEL_ACTIONS.find(a => keysOf(cfg, a).includes(button)) ?? null;
}
/** give a button to an action (it leaves the action it had: a button has one job) */
export function bindKey(cfg: WheelCfg, action: WheelAction, button: number): NonNullable<WheelCfg['keys']> {
  const out: Partial<Record<WheelAction, number[]>> = {};
  for (const a of WHEEL_ACTIONS) { const l = keysOf(cfg, a).filter(n => n !== button); if (l.length) out[a] = l; }
  out[action] = [...(out[action] ?? []), button];
  return out;
}
/** take one button off an action */
export function unbindKey(cfg: WheelCfg, action: WheelAction, button: number): NonNullable<WheelCfg['keys']> {
  const out: Partial<Record<WheelAction, number[]>> = {};
  for (const a of WHEEL_ACTIONS) { const l = keysOf(cfg, a).filter(n => !(a === action && n === button)); if (l.length) out[a] = l; }
  return out;
}
export function preferPad(id: string): void {
  try { localStorage.setItem(PREFERRED, id); } catch { /* no storage */ }
}

/** every connected pad */
export function pads(): Gamepad[] {
  const list = navigator.getGamepads?.() ?? [];
  return Array.from(list).filter((g): g is Gamepad => !!g && g.connected);
}

/** the wheel in use: the one chosen on the wheel page, else one with a
 * saved calibration, else the first connected (not simply slot 0 — a wheel
 * can sit in any slot) */
export function activePad(): Gamepad | null {
  const all = pads();
  if (!all.length) return null;
  let pref: string | null = null;
  try { pref = localStorage.getItem(PREFERRED); } catch { /* none */ }
  return all.find(g => g.id === pref) ?? all.find(g => savedCfg(g.id)) ?? all[0];
}

export interface WheelReading { pad: Gamepad; steer: number; gas: number; brake: number; snap: Snapshot; cfg: WheelCfg }

/** the active wheel through its calibration, or null when none is connected */
export function readWheel(): WheelReading | null {
  const pad = activePad();
  if (!pad) return null;
  const snap = snapshot(pad), cfg = cfgFor(pad.id);
  // (a button given to the gas or the brake counts as that pedal pressed all the way)
  const held = (a: WheelAction): number => (keysOf(cfg, a).some(i => pad.buttons[i]?.pressed) ? 1 : 0);
  return {
    pad, steer: steerOf(snap, cfg), snap, cfg,
    gas: Math.max(pedalOf(snap, cfg.gas), held('gas')), brake: Math.max(pedalOf(snap, cfg.brake), held('brake')),
  };
}

/** is any of these buttons held on the active wheel? */
export function wheelButton(indices: number[]): boolean {
  const pad = activePad();
  return !!pad && indices.some(i => pad.buttons[i]?.pressed);
}

/** is the action's button held on the active wheel: any button given to it,
 * or any of the `legacy` buttons the game used before buttons had jobs —
 * except those that now have another job (a button given to the siren
 * mustn't also start the game) */
export function wheelHeld(action: WheelAction, legacy: number[] = []): boolean {
  const pad = activePad();
  if (!pad) return false;
  const cfg = cfgFor(pad.id);
  const list = [...keysOf(cfg, action), ...legacy.filter(b => { const a = actionOf(cfg, b); return a === null || a === action; })];
  return list.some(i => pad.buttons[i]?.pressed);
}

// ---- the buttons at work: one watcher a page starts ----
let watching = false;
/** call `handler(action)` each time a button with a job goes down (not while
 * it is held, and not for a button already held when the page opened) */
export function watchWheelActions(handler: (action: WheelAction) => void): void {
  if (watching) return;
  watching = true;
  const down = new Set<WheelAction>();
  let primed = false;
  const frame = (): void => {
    const pad = activePad();
    if (!pad) { primed = false; down.clear(); }
    else {
      const cfg = cfgFor(pad.id);
      for (const a of WHEEL_ACTIONS) {
        if (HELD_ACTIONS.has(a)) continue; // (the gas and brake buttons are read as pedals)
        const held = keysOf(cfg, a).some(i => pad.buttons[i]?.pressed);
        if (held && !down.has(a)) { down.add(a); if (primed) handler(a); }
        else if (!held) down.delete(a);
      }
      primed = true;
    }
    requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);
}

// ---- the guided calibration ----
export type CalStep = 'rest' | 'left' | 'right' | 'gas' | 'brake' | 'done';

/** how far a control must move from rest to count (axes run −1 … 1: a pedal
 * or a wheel's lock moves at least 1 of that; a button 0 → 1), how long it
 * is held, how long the rest is sampled, and how near rest counts as let go */
const MOVE = 0.5, HOLD = 0.5, REST_T = 1.5, RELEASED = 0.25;

interface Mover { kind: 'axis' | 'button'; index: number; delta: number; value: number }

export class Calibrator {
  step: CalStep = 'rest';
  /** 0 … 1 through the present step (the rest sample, or the hold once it has moved) */
  progress = 0;
  /** waiting for everything to be let go before the next step */
  releasing = false;
  /** what the present step has noticed moving (for the page to show) */
  noticed: Mover | null = null;
  private rest: Snapshot | null = null;
  private samples: Snapshot[] = [];
  private t = 0;
  private held = 0;
  private best: Mover | null = null;
  private cfg: WheelCfg = { ...DEFAULT_CFG, gas: { ...DEFAULT_CFG.gas }, brake: { ...DEFAULT_CFG.brake } };
  private gasDelta = 0;
  private leftD = 0;

  /** the calibration so far (complete once `step` is 'done') */
  result(): WheelCfg { return this.cfg; }

  /** leave out this step (a wheel without a brake pedal, say): its control is none */
  skip(): void {
    if (this.step === 'left' || this.step === 'right') return; // the steering can't be skipped
    if (this.step === 'gas') this.cfg.gas = { kind: 'button', index: -1, rest: 0, full: 1 };
    else if (this.step === 'brake') this.cfg.brake = { kind: 'button', index: -1, rest: 0, full: 1 };
    this.advance();
  }

  private advance(): void {
    this.releasing = true;
    this.held = 0; this.progress = 0; this.best = null; this.noticed = null;
    this.step = this.step === 'rest' ? 'left' : this.step === 'left' ? 'right' : this.step === 'right' ? 'gas' : this.step === 'gas' ? 'brake' : 'done';
    if (this.step === 'done') this.releasing = false;
  }

  /** feed the wheel's values every frame; true when a step has just finished */
  update(s: Snapshot, dt: number): boolean {
    if (this.step === 'done') return false;
    if (this.step === 'rest') {
      this.samples.push(s);
      this.t += dt;
      this.progress = Math.min(1, this.t / REST_T);
      if (this.t < REST_T) return false;
      const n = this.samples.length;
      this.rest = {
        axes: s.axes.map((_, i) => this.samples.reduce((a, q) => a + (q.axes[i] ?? 0), 0) / n),
        buttons: s.buttons.map((_, i) => this.samples.reduce((a, q) => a + (q.buttons[i] ?? 0), 0) / n),
      };
      this.cfg.center = 0; // (set from the steering axis once it is known)
      this.advance();
      return true;
    }
    const rest = this.rest!;
    // after a step, everything must come back to rest first
    if (this.releasing) {
      const back = s.axes.every((v, i) => Math.abs(v - (rest.axes[i] ?? 0)) < RELEASED) && s.buttons.every((v, i) => Math.abs(v - (rest.buttons[i] ?? 0)) < RELEASED);
      if (back) this.releasing = false;
      return false;
    }
    // what has moved furthest from rest, among the controls this step may use
    const steerOnly = this.step === 'left' || this.step === 'right';
    let top: Mover | null = null;
    const consider = (kind: 'axis' | 'button', index: number, value: number, base: number): void => {
      const delta = value - base;
      if (Math.abs(delta) < MOVE) return;
      if (steerOnly && kind !== 'axis') return; // (the steering is an axis)
      // the right turn: the same axis, the other way
      if (this.step === 'right' && (index !== this.cfg.steerAxis || delta * this.leftD >= 0)) return;
      // a pedal isn't the steering axis
      if ((this.step === 'gas' || this.step === 'brake') && kind === 'axis' && index === this.cfg.steerAxis) return;
      if (this.step === 'brake') {
        // the gas pedal again doesn't count: the same button, or the same axis the same way
        if (kind === 'button' && this.cfg.gas.kind === 'button' && this.cfg.gas.index === index) return;
        if (kind === 'axis' && this.cfg.gas.kind === 'axis' && this.cfg.gas.index === index && delta * this.gasDelta > 0) return;
      }
      if (!top || Math.abs(delta) > Math.abs(top.delta)) top = { kind, index, delta, value };
    };
    s.axes.forEach((v, i) => { if (Number.isFinite(v)) consider('axis', i, v, rest.axes[i] ?? 0); });
    s.buttons.forEach((v, i) => consider('button', i, v, rest.buttons[i] ?? 0));
    const t2 = top as Mover | null;
    this.noticed = t2;
    if (!t2) { this.held = 0; this.progress = 0; this.best = null; return false; }
    // the same control for a moment, at its furthest
    if (this.best && this.best.kind === t2.kind && this.best.index === t2.index) {
      this.held += dt;
      if (Math.abs(t2.delta) > Math.abs(this.best.delta)) this.best = t2;
    } else { this.best = t2; this.held = 0; }
    this.progress = Math.min(1, this.held / HOLD);
    if (this.held < HOLD) return false;
    this.commit(this.best, rest);
    this.advance();
    return true;
  }

  private commit(m: Mover, rest: Snapshot): void {
    if (this.step === 'left') {
      this.cfg.steerAxis = m.index;
      this.cfg.center = rest.axes[m.index] ?? 0;
      this.cfg.left = m.value;
      this.leftD = m.delta;
    } else if (this.step === 'right') {
      this.cfg.right = m.value;
    } else {
      const base = m.kind === 'axis' ? rest.axes[m.index] ?? 0 : 0;
      const p: PedalCfg = { kind: m.kind, index: m.index, rest: base, full: m.kind === 'axis' ? m.value : 1 };
      if (this.step === 'gas') { this.cfg.gas = p; this.gasDelta = m.delta; } else this.cfg.brake = p;
    }
  }
}
