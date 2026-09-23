// The race circuit: a closed 8×5-tile loop of Kenney racing-kit pieces laid on
// a 10 m grid inside a clear zone of the endless city (chunks cx/cz 4–5).
// The same definition drives the baked tiles, the lap gates and the AI path.
export const RACE_ORIGIN = { x: 256, z: 256 }; // zone base = chunk (4,4)
export const RACE_TILE = 10;

export type RaceTileKind = 'straight' | 'corner' | 'finish' | 'bump';

export interface RaceTile {
  kind: RaceTileKind;
  col: number;
  row: number;
  rot: number;
}

export function raceZoneChunk(cx: number, cz: number): boolean {
  return (cx === 4 || cx === 5) && (cz === 4 || cz === 5);
}

export function tileCenter(col: number, row: number): { x: number; z: number } {
  return {
    x: RACE_ORIGIN.x + col * RACE_TILE + RACE_TILE / 2,
    z: RACE_ORIGIN.z + row * RACE_TILE + RACE_TILE / 2,
  };
}

const HPI = Math.PI / 2;

/** The circuit tiles (8×5 loop). Corners connect the perimeter straights. */
export function raceTiles(): RaceTile[] {
  const t: RaceTile[] = [];
  // north row (z low): finish gantry on col 1, bump jump on col 4
  for (const col of [1, 2, 3, 5, 6]) t.push({ kind: col === 3 ? 'straight' : 'straight', col, row: 0, rot: 0 });
  t.push({ kind: 'finish', col: 1, row: 0, rot: 0 });
  t.push({ kind: 'bump', col: 4, row: 0, rot: 0 });
  // south row
  for (const col of [1, 2, 3, 5, 6]) t.push({ kind: 'straight', col, row: 4, rot: 0 });
  // west col (x low)
  for (const row of [1, 2, 3]) t.push({ kind: 'straight', col: 0, row, rot: HPI });
  // east col (x high)
  for (const row of [1, 2, 3]) t.push({ kind: 'straight', col: 7, row, rot: HPI });
  // corners — each connects its two adjacent perimeter straights
  t.push({ kind: 'corner', col: 0, row: 0, rot: HPI });          // NW: E+N
  t.push({ kind: 'corner', col: 7, row: 0, rot: 3 * HPI });      // SE: W+N
  t.push({ kind: 'corner', col: 7, row: 4, rot: 0 });            // NE: S+W
  t.push({ kind: 'corner', col: 0, row: 4, rot: Math.PI });      // SW: E+S
  return t;
}

/** ordered loop of tile centres — the racing line for AI and lap gates */
export function racePath(): Array<{ x: number; z: number }> {
  const pts: Array<{ x: number; z: number }> = [];
  for (const col of [1, 2, 3, 4, 5, 6, 7]) pts.push(tileCenter(col, 0));
  for (const row of [1, 2, 3, 4]) pts.push(tileCenter(7, row));
  for (const col of [6, 5, 4, 3, 2, 1, 0]) pts.push(tileCenter(col, 4));
  for (const row of [3, 2, 1]) pts.push(tileCenter(0, row));
  return pts;
}

/** the circuit path, computed once (static data) */
export const racePathPts = racePath();

/** Lap gates: finish line first, then one gate per half of the circuit. */
export function raceGates(): Array<{ x: number; z: number }> {
  return [tileCenter(1, 0), tileCenter(7, 2), tileCenter(0, 2)];
}

export const RACE_START = { ...tileCenter(1, 0), heading: Math.PI / 2 };
