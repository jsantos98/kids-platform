// City blocks: the faces of the street web. Every closed ring of streets
// bounds one block — the unit districts are assigned to and the block filler
// packs. Traced by the usual planar-graph walk: leaving each node along a
// half-edge, the next half-edge is the one turning most sharply one way at
// the far node, so every face is walked once in the same winding; the outer
// face (walked the other way) is dropped.
type P = { x: number; z: number };

export interface Block {
  id: number;
  /** outline along the street centrelines */
  poly: P[];
  /** area (m²) and centre of mass */
  area: number;
  cx: number;
  cz: number;
  /** the street edges around it */
  edges: number[];
}

interface Web { nodes: Array<{ x: number; z: number; edges: number[] }>; edges: Array<{ a: number; b: number }> }

export function blocksOf(web: Web): Block[] {
  const { nodes, edges } = web;
  // outgoing half-edges per node, sorted by heading
  const hdg = (from: number, to: number): number => Math.atan2(nodes[to].x - nodes[from].x, nodes[to].z - nodes[from].z);
  const out = nodes.map((n, id) => n.edges.map(eid => {
    const e = edges[eid];
    const to = e.a === id ? e.b : e.a;
    return { eid, to, h: hdg(id, to) };
  }).sort((p, q) => p.h - q.h));
  const used = new Set<string>();
  const blocks: Block[] = [];
  for (let s = 0; s < nodes.length; s++) {
    for (const start of out[s]) {
      const key0 = `${s}>${start.to}:${start.eid}`;
      if (used.has(key0)) continue;
      const poly: P[] = [];
      const eids: number[] = [];
      let from = s, he = start;
      for (let guard = 0; guard < 2000; guard++) {
        const key = `${from}>${he.to}:${he.eid}`;
        if (used.has(key)) break;
        used.add(key);
        poly.push({ x: nodes[from].x, z: nodes[from].z });
        eids.push(he.eid);
        // at the far node: the next arm clockwise from the way back
        const at = he.to;
        const back = hdg(at, from);
        const arms = out[at];
        let next = arms[0];
        let best = Infinity;
        for (const a of arms) {
          let d = back - a.h;
          while (d <= 1e-9) d += Math.PI * 2;
          if (a.eid === he.eid && a.to === from && arms.length > 1) continue;
          if (d < best) { best = d; next = a; }
        }
        from = at;
        he = next;
      }
      // signed area and centroid (x-z plane)
      let area = 0, cx = 0, cz = 0;
      for (let i = 0; i < poly.length; i++) {
        const p = poly[i], q = poly[(i + 1) % poly.length];
        const c = p.x * q.z - q.x * p.z;
        area += c; cx += (p.x + q.x) * c; cz += (p.z + q.z) * c;
      }
      // the inner faces come out negative in this winding; the outer face
      // (and any sliver) is dropped
      area /= 2;
      if (area >= -50) continue;
      blocks.push({ id: blocks.length, poly, area: -area, cx: cx / (6 * area), cz: cz / (6 * area), edges: [...new Set(eids)] });
    }
  }
  return blocks;
}

/** is (x, z) inside the block's outline? */
export function inBlock(b: Block, x: number, z: number): boolean {
  let inside = false;
  const p = b.poly;
  for (let i = 0, j = p.length - 1; i < p.length; j = i++) {
    if ((p[i].z > z) !== (p[j].z > z) && x < ((p[j].x - p[i].x) * (z - p[i].z)) / (p[j].z - p[i].z) + p[i].x) inside = !inside;
  }
  return inside;
}
