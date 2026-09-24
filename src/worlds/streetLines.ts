// Street lines: the candidate streets of a city as infinite straight lines —
// what the railway (and one day the river) deforms itself against. A line is
// an origin, a unit direction u and a unit normal n, so every test the rail
// runs ("how far across the asphalt am I", "how far along to the next
// junction", "how parallel am I") is the same code for any street angle.
//
// Today the candidates are the seeded lattice lines of streetLinesFor(); the
// non-grid street generator will hand in rotated lines through the same
// interface. Kept free of cityPlan imports (the plan builds the rail, which
// reads these) so there is no module cycle.
import { citySeed, streetLinesFor } from './cityGrid.js';
import { WORLD_CHUNKS } from './world.js';

const CH = 64;

export interface StreetLine {
  id: number;
  /** a point on the line, its unit direction and unit normal */
  ox: number; oz: number;
  ux: number; uz: number;
  nx: number; nz: number;
  /** street heading atan2(ux, uz) — a direction, meaningful modulo pi */
  heading: number;
  /** parallel lines share a family: a crossing of one line exempts its
   * whole family from the clearance push near that crossing */
  family: string;
  /** distance along the line from s to its nearest junction */
  nodeGap(s: number): number;
}

export interface StreetCandidates {
  lines: StreetLine[];
  /** nearest interior junction point to (x, z), or null out by the rim */
  nearestNode(x: number, z: number): { x: number; z: number } | null;
}

/** signed distance from the line (along its normal) */
export function across(L: StreetLine, x: number, z: number): number {
  return (x - L.ox) * L.nx + (z - L.oz) * L.nz;
}

/** position along the line (along its direction) */
export function along(L: StreetLine, x: number, z: number): number {
  return (x - L.ox) * L.ux + (z - L.oz) * L.uz;
}

/** the point at `s` along the line */
export function pointAt(L: StreetLine, s: number): { x: number; z: number } {
  return { x: L.ox + L.ux * s, z: L.oz + L.uz * s };
}

/** angle between heading h and the street's direction, folded to [0, pi/2]
 * (0 = running along the street, pi/2 = square across it) */
export function lineDev(L: StreetLine, h: number): number {
  let a = (h - L.heading) % Math.PI;
  if (a < 0) a += Math.PI;
  return Math.min(a, Math.PI - a);
}

const latticeGap = (s: number): number => Math.abs(s - Math.round(s / CH) * CH);

/** an east-west lattice street at z = j * 64 */
export function hLine(id: number, j: number): StreetLine {
  return { id, ox: 0, oz: j * CH, ux: 1, uz: 0, nx: 0, nz: 1, heading: Math.PI / 2, family: 'h', nodeGap: latticeGap };
}

/** a north-south lattice street at x = i * 64 */
export function vLine(id: number, i: number): StreetLine {
  return { id, ox: i * CH, oz: 0, ux: 0, uz: 1, nx: 1, nz: 0, heading: 0, family: 'v', nodeGap: latticeGap };
}

const cache = new Map<number, StreetCandidates>();

/** every candidate street line of city (bx, by): east-west lines first,
 * then north-south, in lattice order (the rail pipeline's hit ordering
 * depends on it) */
export function streetCandidatesFor(bx: number, by: number): StreetCandidates {
  const key = citySeed(bx, by);
  let c = cache.get(key);
  if (!c) {
    const { H, V } = streetLinesFor(bx, by);
    const lines: StreetLine[] = [];
    for (const j of H) lines.push(hLine(lines.length, j));
    for (const i of V) lines.push(vLine(lines.length, i));
    c = {
      lines,
      nearestNode(x, z) {
        const i = Math.round(x / CH), j = Math.round(z / CH);
        if (i < 1 || i >= WORLD_CHUNKS || j < 1 || j >= WORLD_CHUNKS) return null;
        return { x: i * CH, z: j * CH };
      },
    };
    cache.set(key, c);
    if (cache.size > 64) cache.delete(cache.keys().next().value as number);
  }
  return c;
}

/** test/audit hook: flush when the city base seed changes */
export function clearStreetLineCache(): void { cache.clear(); }
