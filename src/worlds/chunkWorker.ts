// The chunk worker: bakes the city's 64 m chunks off the main thread (a bake
// is 20-50 ms), running the very same chunk baker (cityChunk.ts). The main
// thread sends it the baked Kenney templates once, the islands it already
// has (so the plans needn't be rebuilt here), then chunk requests; each
// reply is the merged geometry's arrays (transferred) and the collision
// boxes. An island it hasn't been sent is simply built here.
import { importBakedTemplates, type TemplatePack } from '../engine/assets.js';
import { generateCityChunkData } from './cityChunk.js';
import { installIslandData, useBase, type IslandData } from './islandData.js';
import { chunkLights } from './roadLayout.js';

type Msg =
  | { type: 'templates'; pack: TemplatePack }
  | { type: 'island'; data: IslandData }
  | { type: 'chunk'; base: number; bx: number; by: number; cx: number; cz: number; key: string };

const post = (msg: unknown, transfer: Transferable[]): void =>
  (self as unknown as { postMessage(m: unknown, t: Transferable[]): void }).postMessage(msg, transfer);

self.onmessage = (e: MessageEvent<Msg>): void => {
  const m = e.data;
  if (m.type === 'templates') { importBakedTemplates(m.pack); return; }
  if (m.type === 'island') { useBase(m.data.base); installIslandData(m.data); return; }
  try {
    useBase(m.base);
    const { geo, boxes, glows } = generateCityChunkData(m.bx, m.by, m.cx, m.cz);
    post({ ok: true, key: m.key, geo, boxes, glows, lights: chunkLights(m.bx, m.by, m.cx, m.cz) }, Object.values(geo).map(a => a.array.buffer));
  } catch (err) {
    post({ ok: false, key: m.key, error: String(err) }, []);
  }
};
