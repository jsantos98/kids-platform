// The road grid of the island city, backed by the seeded city plan
// (cityPlan.ts). Street lines are a random subset of the interior lattice, so
// "has a street" and "is a signalized intersection" are plan queries now.
// setCity() points it at another island of the archipelago.
import { cityPlanFor } from './cityPlan.js';

export class RoadGrid {
  private plan;
  constructor(bx = 0, by = 0) {
    this.plan = cityPlanFor(bx, by);
  }
  /** query a different city of the grid */
  setCity(bx: number, by: number): void {
    this.plan = cityPlanFor(bx, by);
  }
  /** vertical street line i (1..5) has any open segment */
  hasX(i: number): boolean {
    return this.plan.lineV(i);
  }
  /** horizontal street line j (1..5) has any open segment */
  hasZ(j: number): boolean {
    return this.plan.lineH(j);
  }
  /** signalized intersection (≥3 street arms) — where the lights live */
  cross(i: number, j: number): boolean {
    return this.plan.signalized(i, j);
  }
  /** open street segment: horizontal line j across chunk-column i */
  segH(j: number, i: number): boolean {
    return this.plan.segH(j, i);
  }
  /** open street segment: vertical line i across chunk-row j */
  segV(i: number, j: number): boolean {
    return this.plan.segV(i, j);
  }
}
