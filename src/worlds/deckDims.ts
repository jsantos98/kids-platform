// A river bridge deck's dimensions (R40), shared by the decks themselves
// (riverDecks.ts), the plan — which keeps every lot off them before the decks
// exist — the occupancy grid and the audit.

/** the road deck's crown above the street, and the trestle's (m) */
export const BRIDGE_H = 1.4;
export const TRESTLE_H = 1.2;
/** ramp length at each end of a deck (m) */
export const DECK_RAMP = 9;
/** half-widths: the carriageway plus a walkway each side / the track bed */
export const BRIDGE_HALF = 10;
export const TRESTLE_HALF = 2.4;
/** how far along its street a road deck can reach from the bridge point:
 * the river's half-width, 2.5 m of bank, the ramp, and up to one kit tile
 * more (the deck spans whole 14 m tiles) */
export const deckReach = (riverHalf: number): number => riverHalf + 2.5 + DECK_RAMP + 14;
