// Prints every spoken line in both languages as JSON — {"lines": {"pt":
// {id: text}, "en": {...}}, "moods": {id: mood}} — for tools/make-voice.py,
// which records them, each in its mood. The texts come from src/i18n, so
// the clips always say what the dictionaries say.
// Run: npx tsx tools/voice-lines.ts
import { setLang, LANGS } from '../src/i18n/index.js';
import { voiceLines, voiceMood } from '../src/i18n/voice.js';

const lines: Record<string, Record<string, string>> = {};
for (const l of LANGS) {
  setLang(l.id);
  lines[l.id] = voiceLines();
}
const moods: Record<string, string> = {};
for (const id of Object.keys(lines[LANGS[0].id])) moods[id] = voiceMood(id);
process.stdout.write(JSON.stringify({ lines, moods }, null, 2) + '\n');
