// How deep two vehicles' footprints overlap: turned rectangles (centre,
// heading, half length, half width), by separating axes — the smallest
// push along any of the four edge normals that parts them. ≤ 0: clear.
// The getaway cars, the traffic and tools/check-traffic.ts all measure with
// it (a same-frame approximation read a car crossing square to a getaway
// car as far narrower than it is — G7).

export interface Footprint { x: number; z: number; h: number; hl: number; hw: number }

export function overlapDepth(a: Footprint, b: Footprint): number {
  let depth = Infinity;
  const axes: Array<[number, number]> = [
    [Math.sin(a.h), Math.cos(a.h)], [Math.cos(a.h), -Math.sin(a.h)],
    [Math.sin(b.h), Math.cos(b.h)], [Math.cos(b.h), -Math.sin(b.h)],
  ];
  const dx = b.x - a.x, dz = b.z - a.z;
  for (const [ax, az] of axes) {
    // each box's half extent along the axis
    const ra = a.hl * Math.abs(Math.sin(a.h) * ax + Math.cos(a.h) * az) + a.hw * Math.abs(Math.cos(a.h) * ax - Math.sin(a.h) * az);
    const rb = b.hl * Math.abs(Math.sin(b.h) * ax + Math.cos(b.h) * az) + b.hw * Math.abs(Math.cos(b.h) * ax - Math.sin(b.h) * az);
    depth = Math.min(depth, ra + rb - Math.abs(dx * ax + dz * az));
    if (depth <= 0) return depth;
  }
  return depth;
}
