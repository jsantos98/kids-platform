// Translation check — the executable half of G9: every visible text goes
// through src/i18n. The typecheck already proves each language has every
// key (pt.ts is typed against en.ts) and every t('key') names a real one;
// this script catches what the types can't: a text typed straight into a
// page or a script again.
//  - the pages (index.html, play/city.html, diorama/*.html): no letters in
//    the body's text outside <script>/<style> (texts come from data-i18n*);
//  - the scripts that draw the UI: no string literal that reads like a
//    shouted prompt (two capitalised words, or a word plus "!"/"…");
//  - the garage's key help: each mode's controls (registry.ts) match its
//    ModeDef (siren = lightbar, the train = the rail vehicle);
//  - the recorded voice: a clip for every spoken line, recorded from the
//    dictionaries' current text (tools/make-voice.py).
// Run: npx tsx tools/check-i18n.ts
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import path from 'node:path';
import { EN } from '../src/i18n/en.js';
import { PT } from '../src/i18n/pt.js';
import { setLang, LANGS } from '../src/i18n/index.js';
import { voiceLines } from '../src/i18n/voice.js';

const ROOT = path.resolve(import.meta.dirname, '..');
const fails: string[] = [];

// ---- the dictionaries: the same keys, nothing left blank ----
for (const k of Object.keys(EN)) if (!(k in PT) || !(PT as Record<string, string>)[k].trim()) fails.push(`pt.ts: '${k}' is missing or empty`);
for (const k of Object.keys(PT)) if (!(k in EN)) fails.push(`pt.ts: '${k}' is not an English key`);

// ---- the pages ----
const pages = ['index.html', 'play/city.html', ...readdirSync(path.join(ROOT, 'diorama')).filter(f => f.endsWith('.html')).map(f => `diorama/${f}`)];
for (const p of pages) {
  const html = readFileSync(path.join(ROOT, p), 'utf8');
  const body = html.slice(html.indexOf('<body'))
    .replace(/<script[\s\S]*?<\/script>/g, '').replace(/<style[\s\S]*?<\/style>/g, '').replace(/<svg[\s\S]*?<\/svg>/g, '');
  const text = body.replace(/<[^>]*>/g, ' ');
  for (const m of text.matchAll(/[A-Za-zÀ-ÿ]{2,}[^<]*/g)) fails.push(`${p}: hard-coded text "${m[0].trim().slice(0, 50)}"`);
  if (/\stitle="[^"]*[A-Za-z]/.test(body)) fails.push(`${p}: a hard-coded title="…" (use data-i18n-title)`);
}

// ---- the scripts that draw the UI ----
const scripts = [
  'src/main.ts', 'src/games/registry.ts',
  ...readdirSync(path.join(ROOT, 'src/games/city')).filter(f => f.endsWith('.ts')).map(f => `src/games/city/${f}`),
  ...readdirSync(path.join(ROOT, 'src/games/city/activity')).map(f => `src/games/city/activity/${f}`),
  ...readdirSync(path.join(ROOT, 'src/games/diorama')).map(f => `src/games/diorama/${f}`),
];
// a prompt-like literal: two upper-case words in a row, or an upper-case word ending in ! / …
const SHOUT = /['"`][^'"`\n]*\b[A-ZÀ-Ý]{2,}(?:[ '][A-ZÀ-Ý]{2,})+[^'"`\n]*['"`]|['"`][^'"`\n]*\b[A-ZÀ-Ý]{3,}[!…][^'"`\n]*['"`]/;
// …or plain sentence-case words like 'waiting for a call…'
const SENTENCE = /['"`](?:[A-Z]?[a-z]{2,} ){2,}[a-z]*[.!…]?['"`]/;
const ALLOW = /STATS|SAVED|CAPFAIL|console\.|throw new|import |from '|KeyboardEvent|__dbg/;
for (const f of scripts) {
  readFileSync(path.join(ROOT, f), 'utf8').split(/\r?\n/).forEach((line, i) => {
    const code = line.replace(/\/\/.*$/, '');
    if (/^\s*(\*|\/\*)/.test(line) || ALLOW.test(code)) return;
    if (SHOUT.test(code) || SENTENCE.test(code)) fails.push(`${f}:${i + 1}: hard-coded text: ${line.trim().slice(0, 90)}`);
  });
}

// ---- the recorded voice: a clip for every spoken line, saying today's text ----
{
  const dir = path.join(ROOT, 'public/audio/voice');
  let manifest: Record<string, Record<string, string>> = {};
  try { manifest = JSON.parse(readFileSync(path.join(dir, 'manifest.json'), 'utf8')); } catch { fails.push('public/audio/voice/manifest.json is missing (run tools/make-voice.py)'); }
  for (const l of LANGS) {
    setLang(l.id);
    for (const [id, text] of Object.entries(voiceLines())) {
      if (!existsSync(path.join(dir, l.id, `${id}.mp3`))) fails.push(`voice: ${l.id}/${id}.mp3 is missing (run tools/make-voice.py)`);
      else if (manifest[l.id]?.[id] !== text) fails.push(`voice: ${l.id}/${id}.mp3 says "${manifest[l.id]?.[id]}", the text is now "${text}" (run tools/make-voice.py)`);
    }
  }
}

// ---- every line the narrator can say is one of the recorded lines ----
// (a name it builds that isn't — `say-hold-1` for `say-hold` — found no clip,
// and the system's speech voice read the name out, in a Brazilian accent)
{
  const { MOMENTS, lineIds } = await import('../src/games/city/narrator.js');
  const { MODES } = await import('../src/games/city/modes.js');
  const DESTS = ['hospital', 'prison', 'repair', 'depot', 'pier'];
  const details: Partial<Record<string, Array<string | number>>> = {
    start: Object.keys(MODES), call: ['fire', 'cat', 'patient', 'rescue', 'breakdown', 'trash'], place: [1, 2, 3, 4],
    toDest: DESTS, delivered: DESTS, first: DESTS,
    spotted: ['left', 'right', 'ahead', 'behind'], raceUp: [1, 2, 3],
  };
  const lines = voiceLines();
  let n = 0;
  for (const m of MOMENTS) {
    for (const d of details[m] ?? [undefined]) {
      const ids = lineIds(m, d);
      if (!ids.length) fails.push(`narrator: '${m}'${d === undefined ? '' : ` (${d})`} has no line`);
      for (const id of ids) { n++; if (!(id in lines)) fails.push(`narrator: '${m}'${d === undefined ? '' : ` (${d})`} would say '${id}', which is no recorded line`); }
    }
  }
  if (!fails.length) console.log(`narrator: all ${n} lines it can say are recorded`);
}

// ---- the garage's key help says what each mode really answers to ----
{
  const { GAMES } = await import('../src/games/registry.js');
  const { MODES } = await import('../src/games/city/modes.js');
  for (const g of GAMES) {
    const m = (MODES as Record<string, { lightbar: boolean; vehicle: { kind: string } }>)[g.id];
    if (!m) { fails.push(`registry: '${g.id}' is not a play mode`); continue; }
    if (g.controls.siren !== m.lightbar) fails.push(`registry: '${g.id}' lists the siren key ${g.controls.siren ? 'but has no siren' : 'but leaves it out'}`);
    if ((g.controls.drive === 'train') !== (m.vehicle.kind === 'rail')) fails.push(`registry: '${g.id}' drive '${g.controls.drive}' doesn't match its vehicle (${m.vehicle.kind})`);
    const kinds: Record<string, string> = { heli: 'heli', plane: 'plane', boat: 'boat', train: 'rail', road: 'ground', race: 'ground' };
    if (kinds[g.controls.drive] !== m.vehicle.kind) fails.push(`registry: '${g.id}' drive '${g.controls.drive}' but its vehicle moves as '${m.vehicle.kind}'`);
  }
}

for (const f of fails) console.log('FAIL', f);
console.log(fails.length ? `FAIL — ${fails.length} problem(s) with the texts, voice or key help (G9)` : `PASS — every text is translated (${Object.keys(EN).length} keys × 2 languages) (G9)`);
process.exit(fails.length ? 1 : 0);
