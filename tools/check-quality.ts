// G13 check: the graphics levels stay in order and each one's fog hides where
// its city ends (97 % thick there). Every setting must be no more expensive at a lower level
// (resolution, edge smoothing, shadow map, blur, the ground the shadows
// cover, how often they are drawn, how far the city, the traffic and the
// people are drawn), the fog must be thick by the edge of the chunks drawn
// (a chunk is 64 m and the kid can stand anywhere in the middle one, so the
// drawn city reaches at least viewR·64 m), and "auto" must start at medium —
// the game is for an older PC.
//   npx tsx tools/check-quality.ts
import { TIERS, type Quality } from '../src/engine/settings.js';

let fails = 0;
const fail = (m: string): void => { fails++; console.log('  FAIL ' + m); };
const order: Quality[] = ['low', 'medium', 'high'];
const cheaper: Array<keyof typeof TIERS.high> = ['pixelRatio', 'shadowMap', 'shadowBlur', 'shadowSpan', 'viewR', 'fogFar', 'drawScale'];
for (let i = 1; i < order.length; i++) {
  const lo = TIERS[order[i - 1]], hi = TIERS[order[i]];
  for (const k of cheaper) if ((lo[k] as number) > (hi[k] as number)) fail(`${order[i - 1]} ${k} ${lo[k]} is more than ${order[i]}'s ${hi[k]}`);
  if (lo.shadowEvery < hi.shadowEvery) fail(`${order[i - 1]} draws its shadows more often than ${order[i]}`);
  if (lo.antialias && !hi.antialias) fail(`${order[i - 1]} smooths edges and ${order[i]} doesn't`);
}
for (const q of order) {
  const t = TIERS[q];
  const thick = (t.viewR * 64 - t.fogNear) / (t.fogFar - t.fogNear);
  if (thick < 0.97) fail(`${q}: the fog is only ${(thick * 100).toFixed(0)} % thick where its city ends (${t.viewR * 64} m)`);
  if (t.fogNear >= t.fogFar) fail(`${q}: fog near ${t.fogNear} m is past its far ${t.fogFar} m`);
  if (t.shadowEvery < 1 || !Number.isInteger(t.shadowEvery)) fail(`${q}: shadows every ${t.shadowEvery} frames`);
}
// (auto's first level, without anything remembered)
const g = globalThis as unknown as { localStorage?: unknown; location?: unknown };
g.localStorage = { getItem: () => null, setItem: () => {} };
g.location = { search: '' };
const { startQuality } = await import('../src/engine/settings.js');
if (startQuality() !== 'medium') fail(`auto starts at ${startQuality()}, not medium`);

console.log(fails ? `FAIL — ${fails} problem(s) with the graphics levels (G13)` : 'PASS — the graphics levels are in order, the fog hides every city edge, auto starts at medium (G13)');
process.exit(fails ? 1 : 0);
