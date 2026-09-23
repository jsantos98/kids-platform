// The one place that knows how big the world is. Every generator, the sea,
// the bridge, the minimap and the game loop derive their extents from here.
export const WORLD_CHUNKS = 14;              // 14×14 chunks of 64 m
export const ISLAND = WORLD_CHUNKS * 64;     // 896 × 896 m island
export const CENTER = ISLAND / 2;
/** x centre of the causeway to the picnic island (south shore) */
export const BRIDGE_X = Math.round(ISLAND * 0.55);
