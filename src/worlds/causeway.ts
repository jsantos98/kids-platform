// The causeways: every island lays two across its own south and east straits
// — the avenue deck and, 24 m beside it, the railway deck — from its last dry
// land to the neighbour's first. Both rise into a raised middle span so
// boats sail underneath (the boat lane swings out to pass beneath the high
// part), and everything that rides a deck asks here for its height: the
// chunk baker lays the decks along deckProfile, the player's vehicle and the
// trains ride deckAt(), and a boat treats a deck too low to clear as a wall.
import { causewaySpan } from './coast.js';
import { cityAt, CITY_PITCH } from './cityGrid.js';
import { RAIL_OFFSET } from './railRoute.js';

/** top of the raised span above the water (m) */
export const SPAN_H = 5.5;
/** length of each ramp from the shore up to the span (m) */
export const RAMP = 48;
/** half-widths of the two decks (m) */
export const ROAD_DECK_HALF = 6.5;
export const RAIL_DECK_HALF = 2.6;
/** a boat needs this much deck height above the water to pass under */
export const BOAT_CLEAR = 3.4;

export interface Span {
  /** 's' runs +z across the south strait, 'e' runs +x across the east one */
  side: 's' | 'e';
  kind: 'road' | 'rail';
  /** across-axis coordinate of the deck centreline (city-local) */
  at: number;
  /** along-axis extent: last dry land on our side .. first on theirs */
  from: number;
  to: number;
}

/** the four decks city (bx, by) owns (city-local coordinates) */
export function spansOf(bx: number, by: number): Span[] {
  const out: Span[] = [];
  for (const side of ['s', 'e'] as const) {
    const road = causewaySpan(bx, by, side);
    out.push({ side, kind: 'road', ...road });
    const rail = causewaySpan(bx, by, side, RAIL_OFFSET);
    out.push({ side, kind: 'rail', ...rail });
  }
  return out;
}

/** deck height `t` metres along a span of length `len`: smooth ramps up
 * from the shore at both ends, flat on top in the middle */
export function deckProfile(t: number, len: number): number {
  const ramp = Math.min(RAMP, len / 2);
  const e = Math.min(t, len - t);
  if (e <= 0) return 0;
  if (e >= ramp) return SPAN_H;
  const u = e / ramp;
  return SPAN_H * u * u * (3 - 2 * u);
}

/** slope (rise per metre along +t) of the deck at t */
export function deckSlope(t: number, len: number): number {
  const h = 0.5;
  return (deckProfile(t + h, len) - deckProfile(t - h, len)) / (2 * h);
}

/**
 * The deck under world point (x, z), if any: its surface height, which deck
 * it is and how far along. Checks the decks this city owns and the ones its
 * north / west neighbours lay across onto our shore.
 */
export function deckAt(x: number, z: number): { y: number; kind: 'road' | 'rail'; span: Span; t: number } | null {
  const c = cityAt(x, z);
  const owners: Array<[number, number, number, number]> = [
    [c.bx, c.by, x - c.ox, z - c.oz],
    [c.bx, c.by - 1, x - c.ox, z - c.oz + CITY_PITCH],
    [c.bx - 1, c.by, x - c.ox + CITY_PITCH, z - c.oz],
  ];
  for (const [bx, by, lx, lz] of owners) {
    for (const s of spansOf(bx, by)) {
      const acr = s.side === 's' ? lx - s.at : lz - s.at;
      const alg = s.side === 's' ? lz : lx;
      const half = s.kind === 'road' ? ROAD_DECK_HALF : RAIL_DECK_HALF;
      if (Math.abs(acr) > half || alg < s.from || alg > s.to) continue;
      const t = alg - s.from;
      return { y: deckProfile(t, s.to - s.from), kind: s.kind, span: s, t };
    }
  }
  return null;
}
