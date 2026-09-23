// The road grid: which street lines exist in the endless city.
// Lines live on a 64 m grid; every 4th line is a rail corridor, and of the
// remaining lines each seed drops ~1/3 (never two in a row), so the street
// layout is irregular per seed instead of a perfect lattice. Pure functions
// of (index, seed) — chunk streaming, traffic, missions and the minimap all
// agree on the same city without shared state.
export class RoadGrid {
  constructor(private seed: number) {}

  /** rail corridors run along lines ≡ 2 (mod 4) — never through the spawn area */
  static isRail(i: number): boolean {
    return ((((i - 2) % 4) + 4) % 4) === 0;
  }

  private hash(i: number, salt: number): number {
    let h = ((this.seed | 0) ^ Math.imul(i | 0, 374761393) ^ salt) | 0;
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
  }

  /** ~1/3 of lines are dropped, and never two adjacent ones. */
  private dropped(i: number, salt: number): boolean {
    return this.hash(i, salt) < 0.34 && this.hash(i - 1, salt) >= 0.34;
  }

  /** vertical street at x = i*CH exists (line 0 is always kept — spawn street) */
  hasX(i: number): boolean {
    if (i === 0) return true;
    return !RoadGrid.isRail(i) && !this.dropped(i, 0x51ed);
  }

  /** horizontal street at z = j*CH exists (line 0 is always kept — spawn street) */
  hasZ(j: number): boolean {
    if (j === 0) return true;
    return !RoadGrid.isRail(j) && !this.dropped(j, 0x2b99);
  }

  /** a real intersection (both streets exist) */
  cross(i: number, j: number): boolean {
    return this.hasX(i) && this.hasZ(j);
  }
}
