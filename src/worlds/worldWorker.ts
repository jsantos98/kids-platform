// The world worker: builds islands off the main thread (islandData.ts) so
// waking a neighbouring island never stalls a frame. One request at a time:
// { base, bx, by } in, the island's IslandData out (its grid transferred).
import { buildIslandData, useBase } from './islandData.js';

interface Request { base: number; bx: number; by: number }

const post = (msg: unknown, transfer: Transferable[]): void =>
  (self as unknown as { postMessage(m: unknown, t: Transferable[]): void }).postMessage(msg, transfer);

self.onmessage = (e: MessageEvent<Request>): void => {
  const { base, bx, by } = e.data;
  try {
    useBase(base);
    const d = buildIslandData(bx, by);
    post({ ok: true, data: d }, [d.grid.buffer]);
  } catch (err) {
    post({ ok: false, bx, by, error: String(err) }, []);
  }
};
