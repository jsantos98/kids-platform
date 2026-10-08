// A causeway deck's geometry (R29): across the strait along the raised-span
// profile (boats sail under the middle) — 4 m slab pieces tilted to the
// local slope, parapets, piers down into the water. The avenue deck carries
// lane dashes; the railway deck carries timber, sleepers and two rails.
// Baked whole by the game's causeway layer (causeways.ts), city-local: it
// used to live in the one chunk holding its shore point, so it only existed
// while that chunk was in view and popped in at the last moment.
import type { Baked } from '../engine/baked.js';
import { deckProfile, deckSlope, type Span } from './causeway.js';

const ASPHALT = 0x5f6771;
const DASH = 0xe8e4d8;
const CURB = 0xcfc9ba;
const CAP = 0x9a948a;

export function bakeCausewayDeck(B: Baked, span: Span): void {
  const start = span.from - 2, end = span.to + 2;
  const len = span.to - span.from;
  const road = span.kind === 'road';
  const v = span.side === 's';
  const put = (w: number, h: number, t0: number, t1: number, color: number, across: number, lift: number): void => {
    const tm = (t0 + t1) / 2 - span.from;
    const y = deckProfile(tm, len) + lift;
    const pitch = Math.atan(deckSlope(tm, len));
    const segLen = (t1 - t0) / Math.cos(pitch) + 0.06;
    const along = (t0 + t1) / 2;
    if (v) B.box(w, h, segLen, color, span.at + across, y, along, -pitch, 0, 0);
    else B.box(segLen, h, w, color, along, y, span.at + across, 0, 0, pitch);
  };
  const STEP = 4;
  for (let t = start; t < end; t += STEP) {
    const t1 = Math.min(end, t + STEP);
    if (road) {
      // (the deck's top 0.11 at the shore: 1 cm over the island's grass slab
      // (0.10) it overlaps for 2 m there — exactly coplanar, they flickered:
      // R42; likewise the railway deck's timber below)
      put(11, 0.7, t, t1, ASPHALT, 0, -0.24);
      for (const side of [-1, 1]) {
        put(0.4, 0.55, t, t1, CURB, side * 5.3, 0.375);
        put(0.55, 0.12, t, t1, CAP, side * 5.3, 0.71);
      }
      put(0.25, 0.02, t + 1.1, t + 2.9, DASH, 0, 0.12);
    } else {
      put(4.6, 0.5, t, t1, 0x8a6a4a, 0, -0.14);
      for (const side of [-1, 1]) {
        put(0.3, 0.45, t, t1, CURB, side * 2.25, 0.3);
        put(0.12, 0.12, t, t1, 0x8d939e, side * 0.72, 0.3);
      }
      for (let q = t + 0.5; q < t1; q += 1.2) put(2.2, 0.1, q, q + 0.35, 0x6e5238, 0, 0.16);
    }
  }
  // piers: pairs of posts from the water up under the deck
  const half = road ? 6.3 : 2.1;
  for (let t = start + 6; t < end - 2; t += 12) {
    const y = deckProfile(t - span.from, len);
    const hgt = y + 1.6;
    for (const side of [-1, 1]) {
      const [x, z] = v ? [span.at + side * half, t] : [t, span.at + side * half];
      B.box(0.7, hgt, 0.7, 0x8a6a4a, x, y - 0.6 - hgt / 2, z);
    }
    // a cross beam under the raised part
    if (y > 1.5) {
      if (v) B.box(half * 2 + 0.7, 0.4, 0.6, 0x7a5c40, span.at, y - 0.75, t);
      else B.box(0.6, 0.4, half * 2 + 0.7, 0x7a5c40, t, y - 0.75, span.at);
    }
  }
}
