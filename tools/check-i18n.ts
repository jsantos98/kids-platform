// Translation check — the executable half of G9: every visible text goes
// through src/i18n. The typecheck already proves each language has every
// key (pt.ts is typed against en.ts) and every t('key') names a real one;
// this script catches what the types can't: a text typed straight into a
// page or a script again.
//  - the pages (index.html, play/city.html, diorama/*.html): no letters in
//    the body's text outside <script>/<style> (texts come from data-i18n*);
//  - the scripts that draw the UI: no string literal that reads like a
//    shouted prompt (two capitalised words, or a word plus "!"/"…").
// Run: npx tsx tools/check-i18n.ts
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { EN } from '../src/i18n/en.js';
import { PT } from '../src/i18n/pt.js';

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

for (const f of fails) console.log('FAIL', f);
console.log(fails.length ? `FAIL — ${fails.length} text(s) outside src/i18n (G9)` : `PASS — every text is translated (${Object.keys(EN).length} keys × 2 languages) (G9)`);
process.exit(fails.length ? 1 : 0);
