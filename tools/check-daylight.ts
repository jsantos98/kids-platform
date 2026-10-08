// G10 check: the day/night cycle keeps its promises. Samples dayState over
// several days (and from every named start) and fails if nights run longer
// than a third of the day (the 24-hour clock: 6 h night, 2 h dusk and dawn), any output jumps between neighbouring samples,
// midnight falls under the brightness floor ("darker, not dark"), the sun is
// down outside the night (or up in it), the shadow light dips under LIGHT_MIN_ELEV, or
// the moon skips any of its eight phases.
//   npx tsx tools/check-daylight.ts
import { dayState, startPhase, rollStart, hourOf, DAY_LEN, MOON_PHASES, LIGHT_MIN_ELEV, type DayState } from '../src/engine/daylight.js';

let fails = 0;
const fail = (m: string): void => { fails++; if (fails < 30) console.log('  FAIL ' + m); };

const lum = (c: number): number => 0.2126 * ((c >> 16) & 255) / 255 + 0.7152 * ((c >> 8) & 255) / 255 + 0.0722 * (c & 255) / 255;
/** how much light reaches a street: the sky fill and the shadow light */
const bright = (d: DayState): number => d.hemiI * lum(d.hemiSky) + d.lightI * lum(d.lightColor) * Math.max(0, d.lightDir[1]);

const STEP = 0.25, DAYS = 8;
const samples: DayState[] = [];
for (let t = 0; t <= DAYS * DAY_LEN; t += STEP) samples.push(dayState(t, startPhase(null), 3));

// 1. short nights
const nightShare = samples.filter(d => d.night >= 0.5).length / samples.length;
console.log(`night share ${(nightShare * 100).toFixed(1)}% of the day`);
if (nightShare > 0.35) fail(`nights take ${(nightShare * 100).toFixed(1)}% of the day (max 35%: 6 h of night and half of dusk and dawn)`);
if (nightShare < 0.1) fail(`nights take only ${(nightShare * 100).toFixed(1)}% of the day — there is barely a night`);

// 2. no jumps (a quarter second apart, no output may leap)
const chan = (c: number, s: number): number => ((c >> s) & 255) / 255;
const colourJump = (a: number, b: number): number => Math.max(...[16, 8, 0].map(s => Math.abs(chan(a, s) - chan(b, s))));
const vecJump = (a: number[], b: number[]): number => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
let worst = { col: 0, num: 0, dir: 0, light: 0 };
for (let k = 1; k < samples.length; k++) {
  const a = samples[k - 1], b = samples[k];
  const col = Math.max(...(['skyTop', 'skyBottom', 'hemiSky', 'hemiGround', 'lightColor', 'sunColor'] as const).map(f => colourJump(a[f], b[f])));
  const num = Math.max(Math.abs(a.night - b.night), Math.abs(a.hemiI - b.hemiI) / 2, Math.abs(a.exposure - b.exposure), Math.abs(a.stars - b.stars), Math.abs(a.sunGlow - b.sunGlow));
  const light = Math.abs(a.lightI - b.lightI);
  const dir = Math.max(vecJump(a.sunDir, b.sunDir), vecJump(a.moonDir, b.moonDir));
  // the shadow light may hand over from sun to moon only while it's off
  const hand = vecJump(a.lightDir, b.lightDir) > 0.05 && Math.max(a.lightI, b.lightI) > 0.05;
  if (hand) fail(`the shadow light swings ${vecJump(a.lightDir, b.lightDir).toFixed(2)} while lit at t=${(k * STEP).toFixed(2)} s`);
  worst = { col: Math.max(worst.col, col), num: Math.max(worst.num, num), dir: Math.max(worst.dir, dir), light: Math.max(worst.light, light) };
}
console.log(`largest step in ${STEP} s: colour ${worst.col.toFixed(3)}, level ${worst.num.toFixed(3)}, light ${worst.light.toFixed(3)}, direction ${worst.dir.toFixed(4)}`);
if (worst.col > 0.03) fail(`a colour jumps ${worst.col.toFixed(3)} in ${STEP} s`);
if (worst.num > 0.03) fail(`a level jumps ${worst.num.toFixed(3)} in ${STEP} s`);
if (worst.light > 0.06) fail(`the shadow light's strength jumps ${worst.light.toFixed(3)} in ${STEP} s`);
if (worst.dir > 0.02) fail(`the sun or moon jumps ${worst.dir.toFixed(4)} in ${STEP} s`);

// 3. darker, not dark: the darkest moment keeps a floor of the day's light
const noon = bright(dayState(0, startPhase('noon')));
const darkest = Math.min(...samples.map(bright));
console.log(`darkest ${(100 * darkest / noon).toFixed(0)}% of noon's light`);
if (darkest < 0.15 * noon) fail(`the night falls to ${(100 * darkest / noon).toFixed(0)}% of noon's light (floor 15%)`);
if (darkest > 0.45 * noon) fail(`the night keeps ${(100 * darkest / noon).toFixed(0)}% of noon's light — it doesn't read as night`);

// 4. the sun is up by day and down at night; the shadow light never low
for (const d of samples) {
  if (d.night < 0.05 && d.sunDir[1] < 0) fail(`the sun is below the horizon by day (phase ${d.phase.toFixed(3)})`);
  if (d.night > 0.95 && d.sunDir[1] > 0) fail(`the sun is up at night (phase ${d.phase.toFixed(3)})`);
  if (d.night > 0.95 && d.moonDir[1] < 0) fail(`the moon is down mid-night (phase ${d.phase.toFixed(3)})`);
  if (d.lightDir[1] < Math.sin(LIGHT_MIN_ELEV) - 1e-6) fail(`the shadow light lies at ${(Math.asin(d.lightDir[1]) * 180 / Math.PI).toFixed(1)}°`);
}

// 5. the moon walks through every phase, one step a night
const seen = new Set<number>();
let last = -1;
for (const d of samples) {
  if (d.night < 0.95) continue;
  if (last >= 0 && d.moonPhase !== last && d.moonPhase !== (last + 1) % MOON_PHASES) fail(`the moon skips from phase ${last} to ${d.moonPhase}`);
  last = d.moonPhase;
  seen.add(d.moonPhase);
}
console.log(`moon phases seen over ${DAYS} nights: ${[...seen].sort().join(' ')}`);
if (seen.size !== MOON_PHASES) fail(`only ${seen.size} of ${MOON_PHASES} moon phases over ${DAYS} nights`);

// 6. every game starts in the morning; the named times land where they say
const first = dayState(0);
if (first.night > 0.01 || first.sunDir[1] <= 0) fail('a new game does not start in daylight');
// a new game's random start: a fraction of the day the game reads back as
// that time, and every hour of the 24 comes up
{
  const hours = new Set<number>();
  for (let k = 0; k < 2400; k++) {
    const r = k / 2400, s = rollStart(() => r), p = startPhase(s);
    if (Math.abs(p - Math.floor(r * 1000) / 1000) > 1e-9) fail(`a rolled start ${s} reads back as ${p}`);
    hours.add(Math.floor(hourOf(p)));
  }
  if (hours.size !== 24) fail(`a new game's random start reaches only ${hours.size} of the 24 hours`);
  const draws = new Set<string>(); for (let k = 0; k < 50; k++) draws.add(rollStart());
  if (draws.size < 30) fail(`fifty random starts gave only ${draws.size} different times`);
  console.log(`random start: all 24 hours reachable, ${draws.size} different times in 50 draws`);
}

// the clock: 8:00 at the start, the hours land where they say
if (Math.abs(hourOf(dayState(0).phase) - 8) > 1e-6) fail(`a new game starts at ${hourOf(dayState(0).phase).toFixed(2)}h, not 8:00`);
if (Math.abs(hourOf(dayState(30).phase) - 9) > 1e-6) fail('a game hour is not 30 s');
for (const [h, night] of [[3, 1], [13, 0], [23.5, 1]] as const) {
  const d = dayState(0, startPhase(String(h)));
  if (Math.abs(d.night - night) > 0.01) fail(`?time=${h} gives night ${d.night.toFixed(2)}`);
}
for (const [name, night] of [['night', 1], ['midnight', 1], ['noon', 0], ['day', 0]] as const) {
  const d = dayState(0, startPhase(name));
  if (Math.abs(d.night - night) > 0.01) fail(`?time=${name} gives night ${d.night.toFixed(2)}`);
}

console.log(fails ? `G10 FAIL (${fails})` : 'G10 PASS');
process.exit(fails ? 1 : 0);
