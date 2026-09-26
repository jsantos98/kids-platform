// G11 check: every sound effect the game lists (src/engine/sfxList.ts) has
// its recording in public/audio/sfx/, recorded from the prompt, length and
// loop the list gives now (tools/make-sfx.py records what's missing or
// changed). A missing recording would silently fall back to the synth.
//   npx tsx tools/check-sfx.ts
import { existsSync, readFileSync } from 'node:fs';
import { SFX } from '../src/engine/sfxList.js';

let fails = 0;
const fail = (m: string): void => { fails++; console.log('  FAIL ' + m); };
const dir = 'public/audio/sfx';
const manifest = existsSync(`${dir}/manifest.json`) ? JSON.parse(readFileSync(`${dir}/manifest.json`, 'utf-8')) as Record<string, unknown> : {};
for (const [id, d] of Object.entries(SFX)) {
  if (!existsSync(`${dir}/${id}.ogg`)) { fail(`${id}.ogg is missing (python tools/make-sfx.py)`); continue; }
  if (JSON.stringify(manifest[id]) !== JSON.stringify(d)) fail(`${id}.ogg was recorded from an older prompt (python tools/make-sfx.py)`);
}
console.log(fails ? `G11 FAIL (${fails})` : `G11 PASS — ${Object.keys(SFX).length} sound effects recorded`);
process.exit(fails ? 1 : 0);
