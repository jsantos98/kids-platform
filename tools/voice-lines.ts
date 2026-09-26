// Prints every spoken line in both languages as JSON — {"pt": {id: text},
// "en": {...}} — for tools/make-voice.py, which records them. The texts come
// from src/i18n, so the clips always say what the dictionaries say.
// Run: npx tsx tools/voice-lines.ts
import { setLang, LANGS } from '../src/i18n/index.js';
import { voiceLines } from '../src/i18n/voice.js';

const out: Record<string, Record<string, string>> = {};
for (const l of LANGS) {
  setLang(l.id);
  out[l.id] = voiceLines();
}
process.stdout.write(JSON.stringify(out, null, 2) + '\n');
