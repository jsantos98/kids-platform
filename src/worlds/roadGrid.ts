// The road grid of the island city: interior street lines 1..5 (every 64 m).
// Roads run along all interior grid lines; the island border (line 0) is beach.
export class RoadGrid {
  hasX(i: number): boolean {
    return i >= 1 && i <= 5;
  }
  hasZ(j: number): boolean {
    return j >= 1 && j <= 5;
  }
  cross(i: number, j: number): boolean {
    return this.hasX(i) && this.hasZ(j);
  }
}
