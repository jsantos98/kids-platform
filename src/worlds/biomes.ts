// Biomes: coherent terrain regions of the endless city. The world is divided
// into coarse cells (each CELL×CELL chunks = CELL*64 m square); every cell
// hashes to a biome from the seed, so regions are large, stable and purely
// deterministic. The cell containing the spawn is always 'city'.
export type Biome = 'city' | 'forest' | 'desert' | 'meadow';

export const BIOME_CELL = 6; // chunks per biome cell (384 m)

export function biomeAt(cx: number, cz: number, seed: number): Biome {
  const cellX = Math.floor(cx / BIOME_CELL);
  const cellZ = Math.floor(cz / BIOME_CELL);
  if (cellX === 0 && cellZ === 0) return 'city';
  let h = ((seed | 0) ^ Math.imul(cellX, 2654435761) ^ Math.imul(cellZ, 97531)) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  const v = ((h ^ (h >>> 16)) >>> 0) / 4294967296;
  if (v < 0.30) return 'forest';
  if (v < 0.52) return 'meadow';
  if (v < 0.68) return 'city';
  return 'desert';
}

/** slab / ground colour per biome */
export function biomeGround(b: Biome): number {
  switch (b) {
    case 'forest': return 0x7ba363;
    case 'desert': return 0xe8d29a;
    case 'meadow': return 0xa9c88b;
    default: return 0xe9e1cf; // city concrete
  }
}

/** minimap tint per biome */
export function biomeMapColor(b: Biome): string {
  switch (b) {
    case 'forest': return '#8fba74';
    case 'desert': return '#eedaa4';
    case 'meadow': return '#b5d194';
    default: return '#e9e1cf';
  }
}

export function biomeOfCell(cellX: number, cellZ: number, seed: number): Biome {
  return biomeAt(cellX * BIOME_CELL, cellZ * BIOME_CELL, seed);
}
