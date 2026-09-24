// Street lines: the candidate streets of a city as straight pieces — what the
// railway deforms itself against. A line is an origin, a unit direction u,
// a unit normal n and a SPAN [s0, s1] along u (the street edge it is), so
// every test the rail runs ("how far across the asphalt am I", "how far
// along to the next junction", "how parallel am I") is the same code for
// any street angle; outside its span a line is no street at all.
//
// The railway is laid BEFORE the streets (streetGen.ts lays every street
// around it, crossing it square), so its only street context is the four
// causeway avenues, which exist first and which it must cross square.
// Kept free of cityPlan / streetGen imports (they read the rail) so there is
// no module cycle.
import { citySeed, southExit, eastExit } from './cityGrid.js';
import { ISLAND } from './world.js';

/** how far the causeway avenues run inland from the rim (streetGen lays them) */
export const EXIT_IN = 300;

export interface StreetLine {
  id: number;
  /** a point on the line (the edge's first node), its unit direction and unit normal */
  ox: number; oz: number;
  ux: number; uz: number;
  nx: number; nz: number;
  /** the street's extent along u (0 .. edge length) */
  s0: number; s1: number;
  /** street heading atan2(ux, uz) — a direction, meaningful modulo pi */
  heading: number;
  /** parallel lines share a family: a crossing of one line exempts its
   * whole family from the clearance push near that crossing */
  family: string;
  /** distance along the line from s to its nearest junction */
  nodeGap(s: number): number;
  /** which kind of street */
  kind: 'exit';
}

export interface StreetCandidates {
  lines: StreetLine[];
  /** lines whose span passes within r of (x, z) */
  near(x: number, z: number, r: number): StreetLine[];
  /** nearest junction to (x, z), or null */
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

/** within the street's span (plus margin m, which may be negative) */
export function inSpan(L: StreetLine, s: number, m = 0): boolean {
  return s >= L.s0 - m && s <= L.s1 + m;
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

const CELL = 32;
const cache = new Map<string, StreetCandidates>();

/** the streets the railway deforms against: the four causeway avenues,
 * straight in from the rim (EXIT_IN m) */
export function streetCandidatesFor(bx: number, by: number): StreetCandidates {
  const key = `${bx},${by},${citySeed(bx, by)}`;
  let c = cache.get(key);
  if (!c) {
    const exN = southExit(bx, by - 1) * 64, exS = southExit(bx, by) * 64;
    const exW = eastExit(bx - 1, by) * 64, exE = eastExit(bx, by) * 64;
    const segs: Array<[number, number, number, number]> = [
      [exN, 0, exN, EXIT_IN], [exS, ISLAND - EXIT_IN, exS, ISLAND],
      [0, exW, EXIT_IN, exW], [ISLAND - EXIT_IN, exE, ISLAND, exE],
    ];
    const lines: StreetLine[] = segs.map(([ax, az, bx2, bz], id) => {
      const len = Math.hypot(bx2 - ax, bz - az);
      const ux = (bx2 - ax) / len, uz = (bz - az) / len;
      let hd = Math.atan2(ux, uz) % Math.PI;
      if (hd < 0) hd += Math.PI;
      return {
        id, ox: ax, oz: az, ux, uz, nx: uz, nz: -ux, s0: 0, s1: len,
        heading: Math.atan2(ux, uz),
        family: `f${Math.round((hd * 180) / Math.PI) % 180}`,
        // a rim end is a causeway mouth, not a junction
        nodeGap: (s: number) => (az === 0 || ax === 0 ? Math.abs(len - s) : Math.abs(s)),
        kind: 'exit' as const,
      };
    });
    // spatial hash: each line in every cell its span passes
    const grid = new Map<string, StreetLine[]>();
    for (const L of lines) {
      const steps = Math.ceil(L.s1 / (CELL / 2));
      const seen = new Set<string>();
      for (let k = 0; k <= steps; k++) {
        const p = pointAt(L, (L.s1 * k) / steps);
        const kk = `${Math.floor(p.x / CELL)},${Math.floor(p.z / CELL)}`;
        if (seen.has(kk)) continue;
        seen.add(kk);
        if (!grid.has(kk)) grid.set(kk, []);
        grid.get(kk)!.push(L);
      }
    }
    c = {
      lines,
      near(x, z, r) {
        const out: StreetLine[] = [];
        const seen = new Set<number>();
        const g0 = Math.floor((x - r) / CELL) - 1, g1 = Math.floor((x + r) / CELL) + 1;
        const h0 = Math.floor((z - r) / CELL) - 1, h1 = Math.floor((z + r) / CELL) + 1;
        for (let gx = g0; gx <= g1; gx++) for (let gz = h0; gz <= h1; gz++) {
          for (const L of grid.get(`${gx},${gz}`) ?? []) {
            if (seen.has(L.id)) continue;
            seen.add(L.id);
            const s = Math.max(L.s0, Math.min(L.s1, along(L, x, z)));
            const p = pointAt(L, s);
            if (Math.hypot(p.x - x, p.z - z) <= r) out.push(L);
          }
        }
        out.sort((p, q) => p.id - q.id);
        return out;
      },
      // no junctions exist yet when the rail is laid
      nearestNode() { return null; },
    };
    cache.set(key, c);
    if (cache.size > 64) cache.delete(cache.keys().next().value as string);
  }
  return c;
}

/** test/audit hook: flush when the city base seed changes */
export function clearStreetLineCache(): void { cache.clear(); }
