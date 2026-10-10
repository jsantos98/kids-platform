// G13 check: the graphics levels stay in order and each one's fog hides where
// its city ends (97 % thick there). Every setting must be no more expensive at a lower level
// (resolution, edge smoothing, shadow map, blur, the ground the shadows
// cover, how often they are drawn, how far the city, the traffic and the
// people are drawn), the fog must be thick by the edge of the chunks drawn
// (a chunk is 64 m and the kid can stand anywhere in the middle one, so the
// drawn city reaches at least viewR·64 m), and "auto" must start at medium —
// the game is for an older PC.
//   npx tsx tools/check-quality.ts
import { TIERS, renderRatio, type Quality } from '../src/engine/settings.js';

let fails = 0;
const fail = (m: string): void => { fails++; console.log('  FAIL ' + m); };
const order: Quality[] = ['minimal', 'low', 'medium', 'high'];
const cheaper: Array<keyof typeof TIERS.high> = ['pixelRatio', 'maxPixels', 'shadowMap', 'shadowBlur', 'shadowSpan', 'viewR', 'fogFar', 'drawScale'];
for (let i = 1; i < order.length; i++) {
  const lo = TIERS[order[i - 1]], hi = TIERS[order[i]];
  for (const k of cheaper) if ((lo[k] as number) > (hi[k] as number)) fail(`${order[i - 1]} ${k} ${lo[k]} is more than ${order[i]}'s ${hi[k]}`);
  if (lo.shadowEvery < hi.shadowEvery) fail(`${order[i - 1]} draws its shadows more often than ${order[i]}`);
  if (lo.shadows && !hi.shadows) fail(`${order[i - 1]} draws shadows and ${order[i]} doesn't`);
  if (lo.antialias && !hi.antialias) fail(`${order[i - 1]} smooths edges and ${order[i]} doesn't`);
}
for (const q of order) {
  const t = TIERS[q];
  const thick = (t.viewR * 64 - t.fogNear) / (t.fogFar - t.fogNear);
  if (thick < 0.97) fail(`${q}: the fog is only ${(thick * 100).toFixed(0)} % thick where its city ends (${t.viewR * 64} m)`);
  if (t.fogNear >= t.fogFar) fail(`${q}: fog near ${t.fogNear} m is past its far ${t.fogFar} m`);
  if (t.shadowEvery < 1 || !Number.isInteger(t.shadowEvery)) fail(`${q}: shadows every ${t.shadowEvery} frames`);
}
// the picture's size: whatever the screen — a small laptop, 1080p, 1440p, a
// 4K screen at 200 % — no level draws more pixels than its budget, a lower
// level never draws more than a higher one, and a screen smaller than the
// budget is drawn at the level's own ratio (a 1366×768 laptop looks as before)
for (const [w, h, dpr] of [[1366, 768, 1], [1536, 864, 1.25], [1920, 1080, 1], [1920, 1080, 1.5], [2560, 1440, 1], [3840, 2160, 2], [1280, 720, 1]] as const) {
  let prev = 0;
  for (const q of order) {
    const t = TIERS[q], r = renderRatio(t, w, h, dpr), px = w * h * r * r;
    if (px > t.maxPixels * 1.001 && r > 0.35) fail(`${q} on ${w}×${h} @${dpr} draws ${Math.round(px)} pixels, over its ${t.maxPixels}`);
    if (r > t.pixelRatio + 1e-9 || r > dpr + 1e-9) fail(`${q} on ${w}×${h} @${dpr}: ratio ${r.toFixed(2)} is over the level's ${t.pixelRatio} or the screen's ${dpr}`);
    if (px < prev - 1) fail(`${q} on ${w}×${h} @${dpr} draws fewer pixels (${Math.round(px)}) than the level below it (${Math.round(prev)})`);
    prev = px;
  }
}
{
  const t = TIERS.low;
  if (Math.abs(renderRatio(t, 1366, 768, 1) - t.pixelRatio) > 1e-9) fail(`low on 1366×768 is not at its own ratio ${t.pixelRatio} (${renderRatio(t, 1366, 768, 1).toFixed(2)})`);
  const big = 1920 * 1080 * renderRatio(t, 1920, 1080, 1) ** 2, small = 1366 * 768 * renderRatio(t, 1366, 768, 1) ** 2;
  if (big > small * 1.1) fail(`low draws ${Math.round(big)} pixels on 1080p against ${Math.round(small)} on 1366×768: a bigger screen must not cost more`);
}
// (auto's first level, without anything remembered)
const g = globalThis as unknown as { localStorage?: unknown; location?: unknown };
g.localStorage = { getItem: () => null, setItem: () => {} };
g.location = { search: '' };
const { startQuality } = await import('../src/engine/settings.js');
if (startQuality() !== 'medium') fail(`auto starts at ${startQuality()}, not medium`);

console.log(fails ? `FAIL — ${fails} problem(s) with the graphics levels (G13)` : 'PASS — the graphics levels are in order, the fog hides every city edge, auto starts at medium (G13)');
process.exit(fails ? 1 : 0);
