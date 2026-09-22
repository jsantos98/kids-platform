// Deterministic RNG so every render is identical: same seed => same world.
export type Rng = () => number;

export function rng(seed: number): Rng {
  let a = seed >>> 0;
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Hash a world coordinate triple into a seed (used by the chunk streamer so
// revisiting a chunk always rebuilds the identical block).
export function chunkSeed(seed: number, cx: number, cz: number): number {
  let h = (seed | 0) ^ Math.imul(cx | 0, 374761393) ^ Math.imul(cz | 0, 668265263);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return (h ^ (h >>> 16)) >>> 0;
}
