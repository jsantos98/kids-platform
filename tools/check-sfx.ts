// G11 check: every sound effect the game lists (src/engine/sfxList.ts) has
// its recording in public/audio/sfx/, recorded from the prompt, length and
// loop the list gives now (tools/make-sfx.py records what's missing or
// changed) — a missing recording would silently fall back to the synth — and
// every loop is 44.1 kHz and wraps without a click. And the music (G12):
// every track of every moment in src/engine/musicList.ts has its loop in public/audio/music/,
// cut from a take recorded from the prompt the list gives now
// (tools/make-music.py), 44.1 kHz stereo, a whole number of bars, wrapping
// without a click in either channel.
//   npx tsx tools/check-sfx.ts
import { existsSync, readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { SFX } from '../src/engine/sfxList.js';
import { MUSIC, trackFile, type MusicDef, type MusicId } from '../src/engine/musicList.js';

let fails = 0;
const fail = (m: string): void => { fails++; console.log('  FAIL ' + m); };
const dir = 'public/audio/sfx';
const manifest = existsSync(`${dir}/manifest.json`) ? JSON.parse(readFileSync(`${dir}/manifest.json`, 'utf-8')) as Record<string, unknown> : {};
for (const [id, d] of Object.entries(SFX)) {
  if (!existsSync(`${dir}/${id}.ogg`)) { fail(`${id}.ogg is missing (python tools/make-sfx.py)`); continue; }
  if (JSON.stringify(manifest[id]) !== JSON.stringify(d)) fail(`${id}.ogg was recorded from an older prompt (python tools/make-sfx.py)`);
  if (!d.loop) continue;
  if (clicks(`${dir}/${id}.ogg`, 1)) fail(`${id}.ogg clicks where it loops`);
}
const sfxFails = fails;

// ---- the music (G12) ----
const mdir = 'public/audio/music';
const mman = existsSync(`${mdir}/manifest.json`) ? JSON.parse(readFileSync(`${mdir}/manifest.json`, 'utf-8')) as Record<string, { prompt: string; seconds: number; bpm: number; take: number; loop: { beats: number } }> : {};
const music = (Object.keys(MUSIC) as MusicId[]).flatMap(m => MUSIC[m].map((d, n) => [trackFile(m, n), d as MusicDef] as const));
for (const [id, d] of music) {
  if (!existsSync(`${mdir}/${id}.ogg`)) { fail(`music ${id}.ogg is missing (python tools/make-music.py)`); continue; }
  const m = mman[id];
  if (!m || m.prompt !== d.prompt || m.seconds !== d.seconds || m.bpm !== d.bpm || m.take !== (d.take ?? 1)) { fail(`music ${id}.ogg was made from an older prompt (python tools/make-music.py)`); continue; }
  const bars = m.loop.beats / 4;
  if (Math.abs(bars - Math.round(bars)) > 0.1) fail(`music ${id}.ogg loops after ${bars.toFixed(2)} bars, not a whole number`);
  if (clicks(`${mdir}/${id}.ogg`, 2)) fail(`music ${id}.ogg clicks where it loops`);
}

/** a loop must be 44.1 kHz (ffmpeg's loudnorm had silently made them 192 kHz,
 * resampled in a way that isn't loop-aware) and wrap without a click: in each
 * channel the step from its last sample to its first no bigger than 99.9 % of
 * its own */
function clicks(file: string, channels: number): boolean {
  const rate = execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'stream=sample_rate', '-of', 'csv=p=0', file]).toString().trim();
  if (rate !== '44100') { fail(`${file} is ${rate} Hz, not 44100`); return false; }
  const raw = execFileSync('ffmpeg', ['-loglevel', 'error', '-i', file, '-ac', String(channels), '-f', 'f32le', '-'], { maxBuffer: 1 << 30 });
  const y = new Float32Array(raw.buffer, raw.byteOffset, raw.byteLength / 4);
  const n = y.length / channels;
  for (let c = 0; c < channels; c++) {
    const steps = new Float32Array(n - 1);
    for (let i = 1; i < n; i++) steps[i - 1] = Math.abs(y[i * channels + c] - y[(i - 1) * channels + c]);
    steps.sort();
    const p999 = steps[Math.floor(steps.length * 0.999)];
    if (Math.abs(y[c] - y[(n - 1) * channels + c]) > p999) return true;
  }
  return false;
}
console.log(sfxFails ? `G11 FAIL (${sfxFails})` : `G11 PASS — ${Object.keys(SFX).length} sound effects recorded`);
console.log(fails - sfxFails ? `G12 FAIL (${fails - sfxFails})` : `G12 PASS — ${music.length} music loops for ${Object.keys(MUSIC).length} moments, whole bars, seamless`);
process.exit(fails ? 1 : 0);
