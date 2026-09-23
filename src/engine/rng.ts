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
// revisiting a chunk always rebuilds the identical block). Each coordinate
// is folded in through its own imul avalanche: a plain XOR of multiplied
// terms mapped opposite corners onto each other (imul(-1,A)^imul(-1,B)
// equals imul(1,A)^imul(1,B) for those constants, so city (-1,-1) and city
// (1,1) came out identical). The tail is murmur3's fmix32: multiplication
// alone keeps the low bits linear in the seed, so adjacent seeds (7 vs 8)
// stayed partially correlated through the chain — the finaliser fully
// avalanches, and neighbouring seeds hash independently.
export function chunkSeed(seed: number, cx: number, cz: number): number {
  let h = Math.imul(seed | 0, 0x9e3779b1) ^ 0x85ebca6b;
  h = Math.imul(h ^ (cx | 0), 0xc2b2ae35);
  h ^= h >>> 13;
  h = Math.imul(h ^ (cz | 0), 0x27d4eb2f);
  h ^= h >>> 16;
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b);
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35);
  h ^= h >>> 16;
  return h >>> 0;
}
