// Island prefetch: asks the world worker to build the islands the kid is
// about to reach — the eight round the one they're on and the four beyond
// those in line (an island's trains peek into its neighbours' timetables,
// so the next island's neighbours matter too) — one at a time, always the one
// nearest the kid next, and installs each into the world caches as it
// arrives —
// so crossing a strait, or a train or a car peeking over a portal, finds
// the island already built instead of building it in the middle of a frame.
// Without Worker support everything just builds on demand, as before.
import { cityBase, CITY_PITCH } from '../../worlds/cityGrid.js';
import { installIslandData, islandReady, type IslandData } from '../../worlds/islandData.js';

type Reply = { ok: true; data: IslandData } | { ok: false; bx: number; by: number; error: string };

export class IslandPrefetch {
  private worker: Worker | null = null;
  private queue: Array<[number, number]> = [];
  private inFlight: string | null = null;
  /** islands installed from the worker (debug) */
  readonly done: string[] = [];

  constructor() {
    try {
      this.worker = new Worker(new URL('../../worlds/worldWorker.ts', import.meta.url), { type: 'module' });
      this.worker.onmessage = (e: MessageEvent<Reply>) => {
        const r = e.data;
        if (r.ok) {
          installIslandData(r.data);
          this.done.push(`${r.data.bx},${r.data.by}`);
        } else console.warn('world worker failed on', r.bx, r.by, r.error);
        this.inFlight = null;
        this.pump();
      };
      this.worker.onerror = e => { console.warn('world worker error', e.message); this.worker = null; };
    } catch {
      this.worker = null;
    }
  }

  /** build these islands next (replacing whatever was still waiting) */
  want(cells: Array<[number, number]>): void {
    this.queue = cells.filter(([bx, by]) => !islandReady(bx, by) && `${bx},${by}` !== this.inFlight);
    this.pump();
  }

  /** re-rank the waiting islands by how close the kid (world x, z) is to
   * each one's cell — the next one built is always the nearest */
  rank(x: number, z: number): void {
    const d = ([bx, by]: [number, number]): number => {
      const x0 = bx * CITY_PITCH, z0 = by * CITY_PITCH;
      return Math.hypot(Math.max(x0 - x, 0, x - (x0 + CITY_PITCH)), Math.max(z0 - z, 0, z - (z0 + CITY_PITCH)));
    };
    this.queue.sort((a, b) => d(a) - d(b));
  }

  private pump(): void {
    if (!this.worker || this.inFlight) return;
    while (this.queue.length) {
      const [bx, by] = this.queue.shift()!;
      if (islandReady(bx, by)) continue;
      this.inFlight = `${bx},${by}`;
      this.worker.postMessage({ base: cityBase(), bx, by });
      return;
    }
  }

  /** the islands round (bx, by): its eight neighbours, and the four two
   * cells away across a neighbour (that neighbour's own trains run into
   * them) — twelve, which the world caches all hold at once */
  static around(bx: number, by: number): Array<[number, number]> {
    const out: Array<[number, number]> = [];
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) if (dx || dy) out.push([bx + dx, by + dy]);
    out.push([bx + 2, by], [bx - 2, by], [bx, by + 2], [bx, by - 2]);
    return out;
  }
}
