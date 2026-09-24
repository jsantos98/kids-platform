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
  /** the node is a roundabout (plaza) — traffic circles its island */
  plaza(i: number, j: number): boolean {
    return this.plan.plaza(i, j);
  }
  /** signalized intersection (≥3 street arms) — where the lights live */
  cross(i: number, j: number): boolean {
    return this.plan.signalized(i, j);
  }
  /** shortest node path over open segments from lattice node a to node b
   * (inclusive), or null when b can't be reached. Every edge is one 64 m
   * block, so a breadth-first search is exact. */
  route(ai: number, aj: number, bi: number, bj: number): Array<[number, number]> | null {
    const key = (i: number, j: number) => i * 1000 + j;
    const prev = new Map<number, number>([[key(ai, aj), -1]]);
    const queue: Array<[number, number]> = [[ai, aj]];
    const goal = key(bi, bj);
    while (queue.length) {
      const [i, j] = queue.shift()!;
      if (key(i, j) === goal) {
        const out: Array<[number, number]> = [];
        for (let k = goal; k !== -1; k = prev.get(k)!) out.unshift([Math.floor(k / 1000), k % 1000]);
        return out;
      }
      const step = (ni: number, nj: number, open: boolean): void => {
        const nk = key(ni, nj);
        if (open && !prev.has(nk)) { prev.set(nk, key(i, j)); queue.push([ni, nj]); }
      };
      step(i + 1, j, this.segH(j, i));
      step(i - 1, j, this.segH(j, i - 1));
      step(i, j + 1, this.segV(i, j));
      step(i, j - 1, this.segV(i, j - 1));
    }
    return null;
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
