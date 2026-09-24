// Block filler: after the frontage lots line every street, the inside of
// each built block is packed with more — back buildings, courtyards,
// gardens, works yards, parking — so a block reads as a full neighbourhood,
// not a ring of houses around an empty field (R33).
//
// Pure geometry: the plan hands in the block outline and a `place` callback
// (its addLot, which owns every rule — streets, pads, track, water, the
// other lots); this only proposes rectangles, square to the block's sides,
// largest first, on a 1 m scan, pre-tested against the plan's LotRaster.
import { inBlock, type Block } from './blocks.js';

/** the gap the plan keeps between two lots (its overlap margin) */
export const LOT_GAP = 0.6;
const GAP = LOT_GAP + 0.05;

export interface FillSpec {
  /** footprints to try, largest first: [along, across] metres */
  sizes: Array<[number, number]>;
}

/** where lots may not reach (a footprint cell), may not centre, or already stand */
export const R_EDGE = 1, R_CENTRE = 2, R_LOT = 4;
/** conservative (painted wide) zones where the plan must ask the exact
 * track / water distance: for a lot's centre, and for its corners */
export const R_NEAR_C = 8, R_NEAR_E = 16;

/**
 * A 1 m raster of the plan's lot rules, painted a hair lenient so it only
 * rules out what the exact checks would: the filler asks it first (in O(1)
 * per rectangle, through a summed-area table) and only offers the plan the
 * candidates that can stand.
 */
export class LotRaster {
  readonly bits: Uint8Array;
  constructor(readonly size: number) { this.bits = new Uint8Array(size * size); }
  at(x: number, z: number): number {
    const i = Math.floor(x), j = Math.floor(z);
    return i < 0 || j < 0 || i >= this.size || j >= this.size ? R_EDGE | R_CENTRE : this.bits[j * this.size + i];
  }
  private put(i: number, j: number, bit: number): void {
    if (i >= 0 && j >= 0 && i < this.size && j < this.size) this.bits[j * this.size + i] |= bit;
  }
  disc(x: number, z: number, r: number, bit: number): void {
    for (let j = Math.floor(z - r); j <= Math.floor(z + r); j++) for (let i = Math.floor(x - r); i <= Math.floor(x + r); i++) {
      const dx = i + 0.5 - x, dz = j + 0.5 - z;
      if (dx * dx + dz * dz < r * r) this.put(i, j, bit);
    }
  }
  /** a band of half-width hw along segment a-b */
  band(a: { x: number; z: number }, b: { x: number; z: number }, hw: number, bit: number): void {
    const L = Math.hypot(b.x - a.x, b.z - a.z) || 1e-6;
    const ux = (b.x - a.x) / L, uz = (b.z - a.z) / L;
    const x0 = Math.floor(Math.min(a.x, b.x) - hw), x1 = Math.floor(Math.max(a.x, b.x) + hw);
    const z0 = Math.floor(Math.min(a.z, b.z) - hw), z1 = Math.floor(Math.max(a.z, b.z) + hw);
    for (let j = z0; j <= z1; j++) for (let i = x0; i <= x1; i++) {
      const px = i + 0.5 - a.x, pz = j + 0.5 - a.z;
      const t = Math.max(0, Math.min(L, px * ux + pz * uz));
      const dx = px - ux * t, dz = pz - uz * t;
      if (dx * dx + dz * dz < hw * hw) this.put(i, j, bit);
    }
  }
  /** a turned rectangle (a lot footprint, grown by g) */
  rect(x: number, z: number, ry: number, w: number, d: number, g: number, bit: number): void {
    const c = Math.cos(ry), sn = Math.sin(ry);
    const hw = w / 2 + g, hd = d / 2 + g;
    const e = Math.abs(hw * c) + Math.abs(hd * sn), f = Math.abs(hw * sn) + Math.abs(hd * c);
    for (let j = Math.floor(z - f); j <= Math.floor(z + f); j++) for (let i = Math.floor(x - e); i <= Math.floor(x + e); i++) {
      const dx = i + 0.5 - x, dz = j + 0.5 - z;
      // local x along (c, -s), local z along (s, c)
      if (Math.abs(dx * c - dz * sn) < hw && Math.abs(dx * sn + dz * c) < hd) this.put(i, j, bit);
    }
  }
}

/**
 * Propose interior lots for block `b`. `place(x, z, ry, w, d)` tries one
 * and says whether it was built.
 */
export function fillBlock(
  b: Block, spec: FillSpec, raster: LotRaster,
  place: (x: number, z: number, ry: number, w: number, d: number) => boolean,
): number {
  // one pass square to each distinct side, longest side first: the first
  // lays the block's main grain, the rest fill the wedges its grain leaves
  // along the sides that run askew
  const sides: Array<{ l: number; h: number }> = [];
  for (let i = 0; i < b.poly.length; i++) {
    const p = b.poly[i], q = b.poly[(i + 1) % b.poly.length];
    const l = Math.hypot(q.x - p.x, q.z - p.z);
    const h = Math.atan2(q.x - p.x, q.z - p.z);
    const same = sides.find(o => Math.abs(Math.sin(2 * (o.h - h))) < 0.1 && Math.cos(2 * (o.h - h)) > 0);
    if (same) same.l = Math.max(same.l, l);
    else if (l > 12) sides.push({ l, h });
  }
  sides.sort((p, q) => q.l - p.l);
  let n = 0;
  sides.forEach((sd, k) => { n += pass(b, sd.h, k === 0 ? spec.sizes : spec.sizes.slice(-7), raster, place); });
  return n;
}

function pass(
  b: Block, th: number, sizes: Array<[number, number]>, raster: LotRaster,
  place: (x: number, z: number, ry: number, w: number, d: number) => boolean,
): number {
  const ax = { x: Math.sin(th), z: Math.cos(th) }, nx = { x: Math.cos(th), z: -Math.sin(th) };
  // a lot's local x (its w) runs along (cos ry, -sin ry): ry = th - pi/2 lays it along the side
  const ry = th - Math.PI / 2;
  let s0 = Infinity, s1 = -Infinity, t0 = Infinity, t1 = -Infinity;
  for (const p of b.poly) {
    const s = p.x * ax.x + p.z * ax.z, t = p.x * nx.x + p.z * nx.z;
    s0 = Math.min(s0, s); s1 = Math.max(s1, s); t0 = Math.min(t0, t); t1 = Math.max(t1, t);
  }
  s0 = Math.floor(s0); t0 = Math.floor(t0);
  // the raster resampled into this pass's frame, as a summed-area table of
  // the cells no footprint may touch
  const W = Math.ceil(s1 - s0) + 1, H = Math.ceil(t1 - t0) + 1;
  const sat = new Int32Array((W + 1) * (H + 1));
  const centreOk = new Uint8Array(W * H);
  /** cells a footprint can't start on: ruled out, or taken this pass */
  const taken = new Uint8Array(W * H);
  for (let j = 0; j < H; j++) {
    let row = 0;
    for (let i = 0; i < W; i++) {
      const s = s0 + i + 0.5, t = t0 + j + 0.5;
      const v = raster.at(ax.x * s + nx.x * t, ax.z * s + nx.z * t);
      if (v & (R_EDGE | R_LOT)) { row++; taken[j * W + i] = 1; }
      else if (!(v & R_CENTRE)) centreOk[j * W + i] = 1;
      sat[(j + 1) * (W + 1) + i + 1] = sat[j * (W + 1) + i + 1] + row;
    }
  }
  const blockedIn = (cs: number, ct: number, w: number, d: number): boolean => {
    const i0 = Math.max(0, Math.floor(cs - w / 2 - s0 + 0.25)), i1 = Math.min(W, Math.ceil(cs + w / 2 - s0 - 0.25));
    const j0 = Math.max(0, Math.floor(ct - d / 2 - t0 + 0.25)), j1 = Math.min(H, Math.ceil(ct + d / 2 - t0 - 0.25));
    if (i1 <= i0 || j1 <= j0) return true;
    return sat[j1 * (W + 1) + i1] - sat[j0 * (W + 1) + i1] - sat[j1 * (W + 1) + i0] + sat[j0 * (W + 1) + i0] > 0;
  };
  // what this pass has built, in the frame (all share its rotation),
  // bucketed by 4 m bands of t
  const BAND = 4;
  const mine = new Map<number, Array<[number, number, number, number]>>();
  const free = (s: number, t: number, w: number, d: number): boolean => {
    for (let k = Math.floor((t - d / 2 - GAP) / BAND); k <= Math.floor((t + d / 2 + GAP) / BAND); k++) {
      for (const [ms, mt, mw, md] of mine.get(k) ?? []) {
        if (Math.abs(ms - s) < (mw + w) / 2 + GAP && Math.abs(mt - t) < (md + d) / 2 + GAP) return false;
      }
    }
    return true;
  };
  const claim = (s: number, t: number, w: number, d: number): void => {
    for (let j = Math.max(0, Math.floor(t - d / 2 - t0)); j < Math.min(H, Math.ceil(t + d / 2 - t0)); j++) {
      for (let i = Math.max(0, Math.floor(s - w / 2 - s0)); i < Math.min(W, Math.ceil(s + w / 2 - s0)); i++) taken[j * W + i] = 1;
    }
    for (let k = Math.floor((t - d / 2) / BAND); k <= Math.floor((t + d / 2) / BAND); k++) {
      if (!mine.has(k)) mine.set(k, []);
      mine.get(k)!.push([s, t, w, d]);
    }
  };
  let n = 0;
  const STEP = 1;
  for (let t = t0 + 4; t <= t1 - 4; t += STEP) {
    for (let s = s0 + 4; s <= s1 - 4; s += STEP) {
      // the footprint's first cell (its low corner) must be open ground
      if (taken[Math.floor(t - t0 + 0.5) * W + Math.floor(s - s0 + 0.5)]) continue;
      for (const [w, d] of sizes) {
        // grow from this corner of the scan: the footprint's centre sits
        // half a size on, so neighbours tile edge to edge
        const cs = s + w / 2, ct = t + d / 2;
        const ci = Math.floor(cs - s0), cj = Math.floor(ct - t0);
        if (ci < 0 || cj < 0 || ci >= W || cj >= H || !centreOk[cj * W + ci]) continue;
        if (blockedIn(cs, ct, w, d) || !free(cs, ct, w, d)) continue;
        const cx = ax.x * cs + nx.x * ct, cz = ax.z * cs + nx.z * ct;
        if (!inBlock(b, cx, cz)) continue;
        if (place(cx, cz, ry, w, d)) {
          claim(cs, ct, w, d);
          n++;
          break;
        }
      }
    }
  }
  return n;
}
