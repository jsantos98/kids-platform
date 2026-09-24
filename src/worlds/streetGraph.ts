// The street graph: a city's roads as nodes (junctions, bends, mouths) joined
// by straight edges. Everything that moves on or navigates the roads —
// traffic, pedestrians, mission sites, crash resumes, the guide route — asks
// THIS, never the lattice (segH/segV) directly, so the non-grid street
// generator only has to hand in a different graph.
//
// graphFromPlan() lifts the city plan's street web (streetGen.ts + the
// plan's vetoes) into the graph, node and edge order as the plan has them.
import { cityPlanFor, type CityPlan, type Crossing } from './cityPlan.js';
import { citySeed } from './cityGrid.js';

export interface SNode {
  id: number;
  /** city-local position */
  x: number;
  z: number;
  /** incident edge ids */
  edges: number[];
  /** traffic lights stand here (>= 3 arms in built-up surroundings) */
  signalized: boolean;
  /** a roundabout */
  plaza: boolean;
  /** a causeway mouth on the shore (the only sanctioned dead end) */
  mouth: boolean;
  /** heading of the node's reference axis: arms within 45 degrees of it
   * (either way) share the 'ew' light phase, the rest 'ns' */
  frame: number;
}

export interface SEdge {
  id: number;
  a: number;
  b: number;
  /** unit direction a -> b and length */
  ux: number;
  uz: number;
  len: number;
  /** street heading a -> b, atan2(ux, uz) */
  heading: number;
  /** level crossings on this edge, s measured from node a */
  crossings: Array<{ s: number; c: Crossing }>;
}

export interface EdgePos { edge: SEdge; s: number; dist: number; lateral: number }

export interface StreetGraph {
  bx: number;
  by: number;
  nodes: SNode[];
  edges: SEdge[];
  totalLen: number;
  /** node exactly at (or within r of) a city-local point */
  nodeAt(x: number, z: number, r?: number): SNode | null;
  /** closest node to a city-local point */
  nearestNode(x: number, z: number, filter?: (n: SNode) => boolean): SNode | null;
  /** the node at the far end of edge e from node n */
  other(e: SEdge, n: number): SNode;
  /** point on edge e at distance s from node a, pushed `lateral` metres to
   * the right of the a -> b direction */
  sample(e: SEdge, s: number, lateral?: number): { x: number; z: number };
  /** closest edge to a city-local point */
  nearest(x: number, z: number): EdgePos | null;
  /** within the carriageway (plus margin) of some street */
  onRoad(x: number, z: number, margin?: number): boolean;
  /** shortest node path from node a to node b (inclusive), or null */
  route(a: number, b: number): number[] | null;
  /** 'ew' or 'ns': which light phase an arm leaving node n along e obeys */
  phaseOf(n: SNode, e: SEdge): 'ew' | 'ns';
}

/** direction of edge e seen leaving node n */
export function leaving(g: StreetGraph, e: SEdge, n: number): { x: number; z: number } {
  return e.a === n ? { x: e.ux, z: e.uz } : { x: -e.ux, z: -e.uz };
}

function graphFromPlan(plan: CityPlan): StreetGraph {
  const nodes: SNode[] = plan.nodes.map(n => ({
    id: n.id, x: n.x, z: n.z, edges: [...n.edges],
    signalized: n.signalized, plaza: n.plaza, mouth: n.mouth, frame: n.frame,
  }));
  const edges: SEdge[] = plan.edges.map(e => ({
    id: e.id, a: e.a, b: e.b, ux: e.ux, uz: e.uz, len: e.len, heading: e.heading, crossings: [],
  }));
  // level crossings onto the edges they were recorded on
  for (const c of plan.crossings) edges[c.edge].crossings.push({ s: c.s, c });
  for (const e of edges) e.crossings.sort((p, q) => p.s - q.s);
  return makeGraph(plan.bx, plan.by, nodes, edges);
}

function makeGraph(bx: number, by: number, nodes: SNode[], edges: SEdge[]): StreetGraph {
  const totalLen = edges.reduce((s, e) => s + e.len, 0);
  const g: StreetGraph = {
    bx, by, nodes, edges, totalLen,
    nodeAt(x, z, r = 1) {
      let best: SNode | null = null, bd = r;
      for (const n of nodes) {
        const d = Math.hypot(n.x - x, n.z - z);
        if (d <= bd) { bd = d; best = n; }
      }
      return best;
    },
    nearestNode(x, z, filter) {
      let best: SNode | null = null, bd = Infinity;
      for (const n of nodes) {
        if (filter && !filter(n)) continue;
        const d = (n.x - x) ** 2 + (n.z - z) ** 2;
        if (d < bd) { bd = d; best = n; }
      }
      return best;
    },
    other(e, n) {
      return nodes[e.a === n ? e.b : e.a];
    },
    sample(e, s, lateral = 0) {
      const a = nodes[e.a];
      // right of the a -> b direction (screen coordinates, +z south)
      return { x: a.x + e.ux * s - e.uz * lateral, z: a.z + e.uz * s + e.ux * lateral };
    },
    nearest(x, z) {
      let best: EdgePos | null = null;
      for (const e of edges) {
        const a = nodes[e.a];
        const s = Math.max(0, Math.min(e.len, (x - a.x) * e.ux + (z - a.z) * e.uz));
        const px = a.x + e.ux * s, pz = a.z + e.uz * s;
        const dist = Math.hypot(x - px, z - pz);
        if (!best || dist < best.dist) {
          best = { edge: e, s, dist, lateral: -(x - a.x) * e.uz + (z - a.z) * e.ux };
        }
      }
      return best;
    },
    onRoad(x, z, margin = 0) {
      const p = g.nearest(x, z);
      return !!p && p.dist <= 7 + margin;
    },
    route(from, to) {
      // Dijkstra over edge lengths (tiny graphs: a linear scan is plenty)
      const dist = new Map<number, number>([[from, 0]]);
      const prev = new Map<number, number>();
      const done = new Set<number>();
      for (;;) {
        let cur = -1, cd = Infinity;
        for (const [n, d] of dist) if (!done.has(n) && d < cd) { cd = d; cur = n; }
        if (cur < 0) return null;
        if (cur === to) break;
        done.add(cur);
        for (const eid of nodes[cur].edges) {
          const e = edges[eid];
          const nb = e.a === cur ? e.b : e.a;
          const nd = cd + e.len;
          if (nd < (dist.get(nb) ?? Infinity)) { dist.set(nb, nd); prev.set(nb, cur); }
        }
      }
      const out = [to];
      while (out[0] !== from) out.unshift(prev.get(out[0])!);
      return out;
    },
    phaseOf(n, e) {
      return Math.abs(Math.sin(e.heading - n.frame)) < Math.SQRT1_2 ? 'ew' : 'ns';
    },
  };
  return g;
}

const cache = new Map<string, StreetGraph>();

/** the street graph of city (bx, by), built once and cached */
export function graphFor(bx: number, by: number): StreetGraph {
  const key = `${bx},${by},${citySeed(bx, by)}`;
  let g = cache.get(key);
  if (!g) {
    g = graphFromPlan(cityPlanFor(bx, by));
    cache.set(key, g);
    if (cache.size > 8) cache.delete(cache.keys().next().value as string);
  }
  return g;
}

/** test/audit hook: flush when the city base seed changes */
export function clearGraphCache(): void { cache.clear(); }
