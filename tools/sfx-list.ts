// Prints the game's sound-effect list (src/engine/sfxList.ts) as JSON for
// tools/make-sfx.py, which records it. Run: npx tsx tools/sfx-list.ts
import { SFX } from '../src/engine/sfxList.js';

process.stdout.write(JSON.stringify(SFX, null, 2) + '\n');
