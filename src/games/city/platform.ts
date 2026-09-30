// A station platform's place beside its track (G6), in metres out from the
// line's centreline on the platform's side: one set of numbers for the
// station baker (transit.ts), the queues (boarding.ts) and the check
// (tools/check-trains.ts). Everything a train passes stays clear of the
// widest train the railway runs (the subway set reaches 2.64 m out, as scaled):
// the canopy used to reach 1.3 m out and every train drove through it.
/** where the deck starts (its track edge) */
export const PLATFORM_EDGE = 2.8;
/** its width, and the middle across it */
export const PLATFORM_W = 3.4;
export const PLATFORM_MID = PLATFORM_EDGE + PLATFORM_W / 2;
/** the canopy: over the platform only, from here out to its far edge */
export const CANOPY_IN = 3.25;
export const CANOPY_OUT = PLATFORM_EDGE + PLATFORM_W + 0.05;
export const CANOPY_Y = 3.15;
/** the STOP board's post, and its panel's half-width across the track */
export const STOP_POST = 3.55;
export const STOP_HALF = 0.55;
/** the platform's length along the track, centred on the stop point */
export const PLATFORM_LEN = 15;
/** every part a passing train must clear: [inner edge out from the centreline, bottom, top] (m) */
export const PLATFORM_PARTS: Array<{ name: string; inner: number; y0: number; y1: number }> = [
  { name: 'deck', inner: PLATFORM_EDGE, y0: 0.1, y1: 0.46 },
  { name: 'canopy', inner: CANOPY_IN, y0: CANOPY_Y - 0.08, y1: CANOPY_Y + 0.08 },
  { name: 'canopy posts', inner: PLATFORM_MID - 1.0 - 0.11, y0: 0, y1: 3.1 },
  { name: 'STOP board', inner: STOP_POST - STOP_HALF, y0: 0, y1: 2.75 },
];
