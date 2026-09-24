// The one place that knows how big the world is. Every generator, the sea,
// the bridge, the minimap and the game loop derive their extents from here.
export const WORLD_CHUNKS = 21;              // 21×21 chunks of 64 m
export const ISLAND = WORLD_CHUNKS * 64;     // 1344 × 1344 m island cell
/** island size relative to the 896 m islands the world rules were first
 * tuned on: metre values that are proportions of the island scale by this
 * (radii, district rings), counts that grow with area by its square */
export const SCALE = ISLAND / 896;
export const CENTER = ISLAND / 2;
/** x centre of the causeway to the picnic island (south shore) */
export const BRIDGE_X = Math.round(ISLAND * 0.55);
