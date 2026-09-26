// G11 check: every sound effect the game lists (src/engine/sfxList.ts) has
// its recording in public/audio/sfx/, recorded from the prompt, length and
// loop the list gives now (tools/make-sfx.py records what's missing or
// changed) — a missing recording would silently fall back to the synth — and
// every loop is 44.1 kHz and wraps without a click.
//   npx tsx tools/check-sfx.ts
import { existsSync, readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { SFX } from '../src/engine/sfxList.js';

let fails = 0;
const fail = (m: string): void => { fails++; console.log('  FAIL ' + m); };
const dir = 'public/audio/sfx';
const manifest = existsSync(`${dir}/manifest.json`) ? JSON.parse(readFileSync(`${dir}/manifest.json`, 'utf-8')) as Record<string, unknown> : {};
for (const [id, d] of Object.entries(SFX)) {
  if (!existsSync(`${dir}/${id}.ogg`)) { fail(`${id}.ogg is missing (python tools/make-sfx.py)`); continue; }
  if (JSON.stringify(manifest[id]) !== JSON.stringify(d)) fail(`${id}.ogg was recorded from an older prompt (python tools/make-sfx.py)`);
  if (!d.loop) continue;
  // a loop must be 44.1 kHz (ffmpeg's loudnorm had silently made them 192 kHz,
  // resampled in a way that isn't loop-aware) and wrap without a click: the
  // step from its last sample to its first no bigger than 99.9 % of its own
  const rate = execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'stream=sample_rate', '-of', 'csv=p=0', `${dir}/${id}.ogg`]).toString().trim();
  if (rate !== '44100') fail(`${id}.ogg is ${rate} Hz, not 44100`);
  const raw = execFileSync('ffmpeg', ['-loglevel', 'error', '-i', `${dir}/${id}.ogg`, '-f', 'f32le', '-'], { maxBuffer: 1 << 28 });
  const y = new Float32Array(raw.buffer, raw.byteOffset, raw.byteLength / 4);
  const steps = new Float32Array(y.length - 1);
  for (let i = 1; i < y.length; i++) steps[i - 1] = Math.abs(y[i] - y[i - 1]);
  const sorted = Array.from(steps).sort((a, b) => a - b);
  const p999 = sorted[Math.floor(sorted.length * 0.999)];
  const seam = Math.abs(y[0] - y[y.length - 1]);
  if (seam > p999) fail(`${id}.ogg clicks where it loops (step ${seam.toFixed(4)} > ${p999.toFixed(4)})`);
}
console.log(fails ? `G11 FAIL (${fails})` : `G11 PASS — ${Object.keys(SFX).length} sound effects recorded`);
process.exit(fails ? 1 : 0);
