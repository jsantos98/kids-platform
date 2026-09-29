// G4 check: every mission scene can be won, can't be lost, and asks for the
// wheel. Builds each scene and variant on several seeds (headless: the kit
// models and character rigs don't load in node, so the scenes' own
// stand-ins do the work) and plays it at 60 Hz three ways —
//   · a perfect player (the scene's own `aim()`): must win within its limit;
//   · a wiggling little child (the wheel swung to and fro, now and then
//     held still): must still win, within three times the limit — nothing
//     is ever lost for good, nothing gets stuck;
//   · nobody at the wheel: a game that needs steering must not win as fast
//     as the perfect player (the stretcher rolls by itself, so the run is
//     exempt);
//   · the chase only (the one scene that can end without a win — the robber
//     gets away and the chase goes on in the world): the wheel held hard
//     away from the robber must end the scene, lost, by the escape time —
//     trying to fail got a child stuck in it for good. Every other scene
//     never ends lost.
// Every frame the camera and the prompt must be sane (no NaN, no empty
// prompt), and a scene must dispose cleanly.
//   npx tsx tools/check-scenes.ts
import './headless-dom.js';
import type { Activity } from '../src/games/city/activity/common.js';
import { HoseActivity } from '../src/games/city/activity/hose.js';
import { CatLadderActivity } from '../src/games/city/activity/catLadder.js';
import { RescueLadderActivity } from '../src/games/city/activity/rescueLadder.js';
import { RunActivity } from '../src/games/city/activity/run.js';
import { WinchActivity } from '../src/games/city/activity/winch.js';
import { ChaseActivity, ESCAPE_T } from '../src/games/city/activity/chase.js';
import { BattleActivity, BATTLE_T } from '../src/games/city/activity/battle.js';
import { DigActivity } from '../src/games/city/activity/dig.js';
import { TowActivity } from '../src/games/city/activity/tow.js';
import { BinsActivity } from '../src/games/city/activity/bins.js';
import { PullOverActivity } from '../src/games/city/activity/pullover.js';

interface Case { name: string; make: (seed: number) => Activity; limit: number; steers: boolean; escapes?: number }

const CASES: Case[] = [
  { name: 'fire: house', make: s => new HoseActivity(s, 'house'), limit: 30, steers: true },
  { name: 'fire: car', make: s => new HoseActivity(s, 'car'), limit: 30, steers: true },
  { name: 'fire: tree', make: s => new HoseActivity(s, 'tree'), limit: 30, steers: true },
  { name: 'cat: tree', make: s => new CatLadderActivity(s, 'tree'), limit: 30, steers: true },
  { name: 'cat: building', make: s => new CatLadderActivity(s, 'building'), limit: 30, steers: true },
  { name: 'burning building', make: s => new RescueLadderActivity(s), limit: 60, steers: true },
  { name: 'stretcher run', make: s => new RunActivity(s), limit: 40, steers: false },
  { name: 'winch: meadow', make: s => new WinchActivity(s, undefined, 'meadow'), limit: 15, steers: true },
  { name: 'winch: roof', make: s => new WinchActivity(s, undefined, 'roof'), limit: 15, steers: true },
  { name: 'winch: sea', make: s => new WinchActivity(s, undefined, 'sea'), limit: 15, steers: true },
  { name: 'caught: police car', make: s => new ChaseActivity(s, false), limit: 15, steers: true, escapes: ESCAPE_T },
  { name: 'caught: helicopter', make: s => new ChaseActivity(s, true), limit: 15, steers: true, escapes: ESCAPE_T },
  { name: 'battle: pirate', make: s => new BattleActivity(s, 'pirate'), limit: 13, steers: true, escapes: BATTLE_T },
  { name: 'battle: merchant', make: s => new BattleActivity(s, 'merchant'), limit: 12, steers: true, escapes: BATTLE_T },
  { name: 'dig: treasure', make: s => new DigActivity(s), limit: 15, steers: true },
  { name: 'tow: broken-down car', make: s => new TowActivity(s), limit: 20, steers: true },
  { name: 'bins: garbage truck', make: s => new BinsActivity(s), limit: 25, steers: true },
  { name: 'pull-over: speedboat', make: s => new PullOverActivity(s, 'speeder'), limit: 12, steers: true },
  { name: 'pull-over: pirates', make: s => new PullOverActivity(s, 'rival'), limit: 12, steers: true },
];
const SEEDS = [1, 2, 3, 7, 11, 42];
const DT = 1 / 60;

let fails = 0;
const fail = (m: string): void => { fails++; if (fails < 40) console.log('  FAIL ' + m); };

/** play a scene with a player; the seconds it took to win (Infinity: not in
 * `max`; −seconds: it ended without a win then) */
function play(make: () => Activity, player: (a: Activity, t: number) => number, max: number, label: string, mayLose = false): number {
  const a = make();
  let t = 0;
  try {
    for (; t < max; t += DT) {
      const s = a.update(DT, t, { steer: Math.max(-1, Math.min(1, player(a, t))), night: 0 });
      a.cues.length = 0;
      const p = a.camera.position;
      if (!Number.isFinite(p.x + p.y + p.z)) { fail(`${label}: the camera went to NaN at ${t.toFixed(1)} s`); return NaN; }
      if (!Number.isFinite(s.progress) || s.progress < 0 || s.progress > 1) { fail(`${label}: progress ${s.progress} at ${t.toFixed(1)} s`); return NaN; }
      if (!s.prompt) { fail(`${label}: no prompt at ${t.toFixed(1)} s`); return NaN; }
      if (s.lost && !s.done) {
        if (!mayLose) { fail(`${label}: the scene ended lost at ${t.toFixed(1)} s`); return NaN; }
        return -t;
      }
      if (s.done) {
        // the celebration runs on the frozen wheel: it must not blow up either
        a.celebrate();
        for (let k = 0; k < 110; k++) a.update(DT, t + k * DT, { steer: 0, night: 0 });
        return t;
      }
    }
    return Infinity;
  } finally {
    a.dispose();
  }
}

/** a little child at the wheel: swings it to and fro, sometimes lets go */
const child = (seed: number) => (_a: Activity, t: number): number => {
  const hold = Math.sin(t * 0.37 + seed) > 0.6;
  return hold ? 0 : Math.sin(t * (0.9 + (seed % 5) * 0.13) + seed) * 0.95;
};

for (const c of CASES) {
  const times: number[] = [], kids: number[] = [], idle: number[] = [];
  for (const seed of SEEDS) {
    const label = `${c.name} (seed ${seed})`;
    const tAim = play(() => c.make(seed), a => a.aim(), c.limit, label + ', perfect player');
    if (tAim === Infinity) fail(`${label}: the perfect player didn't win within ${c.limit} s`);
    const tKid = play(() => c.make(seed), child(seed), c.limit * 3, label + ', a child', !!c.escapes);
    if (tKid === Infinity || tKid < 0) fail(`${label}: a child swinging the wheel didn't win within ${c.limit * 3} s — stuck, or lost?`);
    if (c.escapes) {
      // the wheel held hard over, away from the robber (whichever side that is)
      const away = (a: Activity): number => (a.aim() > 0 ? -1 : 1);
      const tAway = play(() => c.make(seed), away, c.escapes + 4, label + ', holding away', true);
      // (it may still win — the robber ran into the officer — but it must end)
      if (tAway === Infinity) fail(`${label}: the wheel held away from the robber and the scene never ended — stuck`);
      else console.log(`${label.padEnd(34)} held away: ${tAway > 0 ? 'caught anyway' : 'got away'}, the scene over at ${Math.abs(tAway).toFixed(1)} s`);
    }
    const tIdle = c.steers ? play(() => c.make(seed), () => 0, c.limit, label + ', nobody') : Infinity;
    if (c.steers && Number.isFinite(tAim) && tIdle < tAim * 1.5) fail(`${label}: won with nobody at the wheel in ${tIdle.toFixed(1)} s (the perfect player took ${tAim.toFixed(1)} s)`);
    times.push(tAim); kids.push(tKid); idle.push(tIdle);
  }
  const f = (a: number[]): string => a.map(v => (Number.isFinite(v) ? v.toFixed(1) : '—')).join(' ');
  console.log(`${c.name.padEnd(20)} perfect ${f(times)} s · child ${f(kids)} s${c.steers ? ` · nobody ${f(idle)} s` : ''}`);
}

if (fails) { console.log(`FAIL — ${fails} problem(s) in the mission scenes (G4)`); process.exit(1); }
console.log('PASS — every mission scene can be won, can\'t be lost (the chase ends, the chase going on), and asks for the wheel (G4)');
