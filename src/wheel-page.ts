// The wheel page (wheel.html, G20): is the wheel working, and which of its
// controls is which. Shows every axis and button live (so you can see what
// moves), walks through a short calibration (wheel left, wheel right, gas,
// brake — wheel.ts `Calibrator`) and keeps the result for the game, and has a
// small test to try it. Reached from the garage's ⚙️ panel.
import { applyI18n, t } from './i18n/index.js';
import {
  Calibrator, WHEEL_ACTIONS, actionOf, activePad, bindKey, cfgFor, isCalibrated, keysOf, pads, pedalOf, preferPad,
  resetCfg, saveCfg, saveKeys, snapshot, steerOf, unbindKey,
  type PedalCfg, type WheelAction, type WheelCfg,
} from './engine/wheel.js';

applyI18n('wheel.pageTitle');

const $ = <T extends HTMLElement>(id: string): T => document.getElementById(id) as T;
const statusEl = $('status'), devices = $('devices'), deviceSel = $<HTMLSelectElement>('deviceSel');
const axesEl = $('axes'), buttonsEl = $('buttons');
const calEl = $('cal'), instrEl = $('instr'), progEl = $('prog').firstElementChild as HTMLElement, noticedEl = $('noticed');
const startBtn = $<HTMLButtonElement>('start'), skipBtn = $<HTMLButtonElement>('skip'), cancelBtn = $<HTMLButtonElement>('cancel'), resetBtn = $<HTMLButtonElement>('reset');
const keysList = $('keysList'), keysMsg = $('keysMsg');
const wheelIcon = $('wheelIcon') as unknown as SVGElement, mappingEl = $('mapping');
const meter = (id: string): { fill: HTMLElement; val: HTMLElement } => {
  const bar = $(id);
  return { fill: bar.querySelector('i') as HTMLElement, val: bar.parentElement!.querySelector('.val') as HTMLElement };
};
const mSteer = meter('mSteer'), mGas = meter('mGas'), mBrake = meter('mBrake');

let cal: Calibrator | null = null;
let padId: string | null = null;

/** "Axis 2" / "Button 7" for a control */
const label = (kind: 'axis' | 'button', n: number): string => t(kind === 'axis' ? 'wheel.axis' : 'wheel.button', { n });
const pedalName = (p: PedalCfg): string => (p.index < 0 ? t('wheel.unset') : label(p.kind, p.index));

function currentPad(): Gamepad | null {
  const all = pads();
  return (padId ? all.find(g => g.id === padId) : null) ?? activePad();
}

// ---- the list of devices (a choice only when there are several) ----
function syncDevices(): void {
  const all = pads();
  devices.hidden = all.length < 2;
  const key = all.map(g => g.id).join('|');
  if (deviceSel.dataset.key !== key) {
    deviceSel.dataset.key = key;
    deviceSel.innerHTML = '';
    for (const g of all) { const o = document.createElement('option'); o.value = g.id; o.textContent = g.id; deviceSel.appendChild(o); }
  }
  const pad = currentPad();
  if (pad) { padId = pad.id; deviceSel.value = pad.id; }
}
deviceSel.addEventListener('change', () => { padId = deviceSel.value; preferPad(padId); });

// ---- the live view: one bar per axis, one dot per button ----
function drawLive(gp: Gamepad | null): void {
  const nAxes = gp ? gp.axes.length : 0, nButtons = gp ? gp.buttons.length : 0;
  if (axesEl.childElementCount !== nAxes) {
    axesEl.innerHTML = '';
    for (let i = 0; i < nAxes; i++) {
      const row = document.createElement('div');
      row.className = 'row';
      row.innerHTML = '<span></span><div class="bar"><b></b><i></i></div><span class="val"></span>';
      (row.firstElementChild as HTMLElement).textContent = label('axis', i);
      axesEl.appendChild(row);
    }
  }
  if (buttonsEl.childElementCount !== nButtons) {
    buttonsEl.innerHTML = '';
    for (let i = 0; i < nButtons; i++) { const s = document.createElement('span'); s.textContent = String(i); s.title = label('button', i); buttonsEl.appendChild(s); }
  }
  if (!gp) return;
  gp.axes.forEach((v, i) => {
    const row = axesEl.children[i] as HTMLElement;
    const fill = row.querySelector('i') as HTMLElement, c = Math.max(-1, Math.min(1, v));
    fill.style.left = `${50 + Math.min(0, c) * 50}%`;
    fill.style.width = `${Math.abs(c) * 50}%`;
    (row.querySelector('.val') as HTMLElement).textContent = v.toFixed(2);
  });
  gp.buttons.forEach((b, i) => {
    const s = buttonsEl.children[i] as HTMLElement;
    s.classList.toggle('on', b.pressed || b.value > 0.5);
    s.style.opacity = b.value > 0.05 && !b.pressed ? String(0.5 + b.value / 2) : '';
  });
}

// ---- what the game will read: the wheel through its calibration ----
function drawTest(gp: Gamepad | null, cfg: WheelCfg): void {
  if (!gp) { mappingEl.textContent = ''; return; }
  const s = snapshot(gp);
  const steer = steerOf(s, cfg), gas = pedalOf(s, cfg.gas), brake = pedalOf(s, cfg.brake);
  wheelIcon.style.transform = `rotate(${(steer * 120).toFixed(1)}deg)`;
  mSteer.fill.style.left = `${50 + Math.min(0, steer) * 50}%`;
  mSteer.fill.style.width = `${Math.abs(steer) * 50}%`;
  mSteer.val.textContent = `${Math.round(steer * 100)}%`;
  mGas.fill.style.width = `${gas * 100}%`; mGas.val.textContent = `${Math.round(gas * 100)}%`;
  mBrake.fill.style.width = `${brake * 100}%`; mBrake.val.textContent = `${Math.round(brake * 100)}%`;
  mappingEl.textContent = t('wheel.mapping', { steer: label('axis', cfg.steerAxis), gas: pedalName(cfg.gas), brake: pedalName(cfg.brake) });
}

// ---- the calibration ----
function showCal(on: boolean): void {
  calEl.hidden = !on;
  startBtn.hidden = on && !!cal;
  cancelBtn.hidden = !cal;
  skipBtn.hidden = !(cal && (cal.step === 'gas' || cal.step === 'brake'));
}
startBtn.addEventListener('click', () => {
  if (!currentPad()) return;
  cal = new Calibrator();
  showCal(true);
});
cancelBtn.addEventListener('click', () => { cal = null; showCal(false); });
skipBtn.addEventListener('click', () => { cal?.skip(); });
resetBtn.addEventListener('click', () => {
  const pad = currentPad();
  if (pad) resetCfg(pad.id);
  cal = null;
  showCal(true);
  instrEl.textContent = t('wheel.resetDone');
  progEl.style.width = '0';
  noticedEl.textContent = '';
});

// ---- the buttons' jobs: any number of buttons for each action ----
const actName = (a: WheelAction): string => t(`wheel.act.${a}` as 'wheel.act.siren');
let assigning: WheelAction | null = null;
/** the buttons held when "Assign" was pressed, and since (a new press is one not in it) */
let heldBefore = new Set<number>();
let keysShown = '';
const rows = new Map<WheelAction, HTMLElement>();

function buildKeys(): void {
  keysList.innerHTML = '';
  rows.clear();
  for (const a of WHEEL_ACTIONS) {
    const row = document.createElement('div');
    row.className = 'act';
    row.innerHTML = '<span class="name"></span><button type="button"></button><div class="chips"></div>';
    (row.querySelector('.name') as HTMLElement).textContent = actName(a);
    (row.querySelector('button') as HTMLButtonElement).addEventListener('click', () => {
      assigning = assigning === a ? null : a;
      heldBefore = new Set(currentPad()?.buttons.flatMap((b, i) => (b.pressed ? [i] : [])) ?? []);
      keysMsg.textContent = '';
      keysShown = '';
    });
    keysList.appendChild(row);
    rows.set(a, row);
  }
}
buildKeys();

function drawKeys(gp: Gamepad): void {
  const cfg = cfgFor(gp.id);
  // a button pressed while one is being given a job
  if (assigning) {
    for (let i = 0; i < gp.buttons.length; i++) {
      const down = gp.buttons[i].pressed;
      if (!down) { heldBefore.delete(i); continue; }
      if (heldBefore.has(i)) continue;
      heldBefore.add(i);
      if ((cfg.gas.kind === 'button' && cfg.gas.index === i) || (cfg.brake.kind === 'button' && cfg.brake.index === i)) {
        keysMsg.textContent = t('wheel.isPedal', { n: i });
        continue;
      }
      const from = actionOf(cfg, i);
      saveKeys(gp.id, bindKey(cfg, assigning, i));
      keysMsg.textContent = from && from !== assigning ? t('wheel.moved', { n: i, to: actName(assigning), from: actName(from) }) : '';
      keysShown = '';
      break;
    }
  }
  const now = cfgFor(gp.id);
  const sig = `${assigning}|${WHEEL_ACTIONS.map(a => keysOf(now, a).join(',')).join(';')}`;
  if (sig !== keysShown) {
    keysShown = sig;
    for (const a of WHEEL_ACTIONS) {
      const row = rows.get(a)!;
      row.classList.toggle('listening', assigning === a);
      (row.querySelector('button') as HTMLButtonElement).textContent = assigning === a ? t('wheel.assignDone') : t('wheel.assign');
      const chips = row.querySelector('.chips') as HTMLElement;
      chips.innerHTML = '';
      if (assigning === a) { const em = document.createElement('em'); em.textContent = t('wheel.listening'); chips.appendChild(em); }
      for (const n of keysOf(now, a)) {
        const chip = document.createElement('span');
        chip.dataset.n = String(n);
        chip.append(label('button', n));
        const x = document.createElement('button');
        x.type = 'button'; x.textContent = '\u2715'; x.title = t('wheel.removeKey');
        x.addEventListener('click', () => { const g = currentPad(); if (g) { saveKeys(g.id, unbindKey(cfgFor(g.id), a, n)); keysShown = ''; } });
        chip.appendChild(x);
        chips.appendChild(chip);
      }
      if (!keysOf(now, a).length && assigning !== a) { const em = document.createElement('em'); em.textContent = t('wheel.unset'); chips.appendChild(em); }
    }
  }
  // a button with a job lights up its chip as it is pressed
  for (const a of WHEEL_ACTIONS) for (const chip of rows.get(a)!.querySelectorAll<HTMLElement>('.chips span')) {
    chip.classList.toggle('flash', !!gp.buttons[Number(chip.dataset.n)]?.pressed);
  }
}

let last = performance.now();
function frame(now: number): void {
  const dt = Math.min(0.1, (now - last) / 1000);
  last = now;
  syncDevices();
  const gp = currentPad();
  drawLive(gp);
  if (!gp) {
    statusEl.className = 'note';
    statusEl.textContent = t('wheel.none');
    if (cal) { cal = null; showCal(false); }
  } else {
    const saved = isCalibrated(gp.id);
    statusEl.className = saved ? 'note ok' : 'note';
    statusEl.textContent = `${t('wheel.found', { id: gp.id })} — ${saved ? t('wheel.calibrated') : t('wheel.standard')}`;
    if (cal) {
      cal.update(snapshot(gp), dt);
      if (cal.step === 'done') {
        saveCfg(gp.id, cal.result());
        cal = null;
        showCal(true);
        instrEl.textContent = t('wheel.done');
        progEl.style.width = '100%';
        noticedEl.textContent = '';
      } else {
        instrEl.textContent = cal.step === 'rest' ? t('wheel.step.rest') : cal.releasing ? t('wheel.step.release') : t(`wheel.step.${cal.step}` as 'wheel.step.left');
        progEl.style.width = `${Math.round(cal.progress * 100)}%`;
        const n = cal.noticed;
        noticedEl.textContent = n && !cal.releasing ? t('wheel.noticed', { what: label(n.kind, n.index) }) : '';
        skipBtn.hidden = !(cal.step === 'gas' || cal.step === 'brake');
      }
    }
    drawTest(gp, cfgFor(gp.id));
    drawKeys(gp);
  }
  requestAnimationFrame(frame);
}
showCal(false);
requestAnimationFrame(frame);
