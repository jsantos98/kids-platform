// Prints the game's music list (src/engine/musicList.ts) as JSON for
// tools/make-music.py, which records it. Run: npx tsx tools/music-list.ts
import { MUSIC } from '../src/engine/musicList.js';

process.stdout.write(JSON.stringify(MUSIC, null, 2) + '\n');
