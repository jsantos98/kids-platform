// Street-level transit furniture: gated level crossings where the railway
// meets a road (twin flashing red signals — the car AI stops for them), the
// station platforms where trains dwell, the river trestles under the rails,
// and the downtown tram: inset tracks down the middle of the boulevard,
// sheltered stops on each side, and two trams ambling around the loop.
import * as THREE from 'three';
import { Baked, templateToMesh } from '../../engine/baked.js';
import { bakedModel } from '../../engine/assets.js';
import { rng, chunkSeed } from '../../engine/rng.js';
import { RAIL_Y, railRouteFor, type RailRoute } from '../../worlds/railRoute.js';
import { riverFor, type RiverRoute } from '../../worlds/riverRoute.js';
import { cityPlanFor, type Crossing, type Station, type TramPlan } from '../../worlds/cityPlan.js';
import { makePath, type WorldPath } from '../../worlds/spline.js';
import type { CollisionBox } from '../../worlds/cityChunk.js';
import type { Trains } from './train.js';

const LIT_RED = new THREE.MeshBasicMaterial({ color: 0xff3b30 });
const DIM_RED = new THREE.MeshBasicMaterial({ color: 0x4a2226 });
const STEEL = 0x5f6774;
const CREAM = 0xe8e4d8;
const WOOD = 0xc9b083;

interface Signal {
  a: THREE.Mesh[];            // lamp pair on the first pole
  b: THREE.Mesh[];            // lamp pair on the second pole
  c: Crossing;
}

interface Tram {
  obj: THREE.Object3D | null; // null until the kit template bakes
  s: number;                  // arc distance along the tram loop
  v: number;
  next: number;               // stop index
  hold: number;
}

export class Transit {
  /** small collision boxes (signal poles, tram shelters) for the physics */
  boxes: CollisionBox[] = [];
  private signals: Signal[] = [];
  private trams: Tram[] = [];
  private tramPath: WorldPath | null = null;
  private stopD: number[] = [];

  constructor(private scene: THREE.Scene, seed: number) {
    const route = railRouteFor(seed);
    const river = riverFor(seed);
    const plan = cityPlanFor(seed);
    const r = rng(chunkSeed(seed, 0x7b2, 9));
    const B = new Baked();
    let baked = 0;

    for (const st of plan.stations) { this.bakeStation(B, st, r); baked++; }
    baked += this.bakeTrestles(B, route, river);
    for (const c of plan.crossings) { this.makeCrossing(B, c); baked++; }
    if (plan.tram) { this.buildTram(B, plan.tram); baked++; }

    if (baked > 0) {
      const mesh = B.build();
      mesh.receiveShadow = true;
      scene.add(mesh);
    }
  }

  // ---- station platform beside a straight stretch of the line ----
  private bakeStation(B: Baked, st: Station, r: () => number): void {
    const side = r() < 0.5 ? 1 : -1;
    const nx = Math.cos(st.h), nz = -Math.sin(st.h);   // right of travel
    const px = st.x + nx * 3.5 * side, pz = st.z + nz * 3.5 * side;
    B.box(3.4, 0.36, 15, WOOD, px, 0.28, pz, 0, st.h, 0);
    B.box(0.55, 0.05, 15, CREAM, px - nx * 1.5 * side, 0.48, pz - nz * 1.5 * side, 0, st.h, 0);
    // canopy posts + roof
    for (const [al, ac] of [[5.4, 1.35], [5.4, -1.35], [-5.4, 1.35], [-5.4, -1.35]]) {
      B.cyl(0.09, 0.11, 3.1, 8, STEEL, px + Math.sin(st.h) * al + nx * ac, 1.55, pz + Math.cos(st.h) * al + nz * ac);
    }
    B.box(4.4, 0.16, 13.5, CREAM, px, 3.15, pz, 0, st.h, 0);
    // two benches + a name sign
    for (const al of [2.2, -2.2]) {
      B.box(1.6, 0.09, 0.45, 0xa9805a, px + Math.sin(st.h) * al, 0.62, pz + Math.cos(st.h) * al, 0, st.h, 0);
    }
    const sx = px + nx * 0.4 * side, sz = pz + nz * 0.4 * side;
    B.cyl(0.06, 0.08, 2.6, 8, STEEL, sx + Math.sin(st.h) * 6.8, 1.3, sz + Math.cos(st.h) * 6.8);
    B.cyl(0.55, 0.55, 0.08, 12, 0x4a90d9, sx + Math.sin(st.h) * 6.8, 2.5, sz + Math.cos(st.h) * 6.8, Math.PI / 2, st.h, 0);
    // platform collision: approximate AABB of the rotated deck
    const alongZ = Math.abs(Math.sin(st.h)) > Math.abs(Math.cos(st.h));
    this.boxes.push({
      x1: px - (alongZ ? 1.8 : 7.8), x2: px + (alongZ ? 1.8 : 7.8),
      z1: pz - (alongZ ? 7.8 : 1.8), z2: pz + (alongZ ? 7.8 : 1.8),
    });
  }

  // ---- wooden trestle decks where the line crosses the water ----
  private bakeTrestles(B: Baked, route: RailRoute, river: RiverRoute): number {
    let decks = 0;
    const pts = route.pts;
    let k = 0;
    while (k < pts.length) {
      if (!river.inWater(pts[k].x, pts[k].z)) { k++; continue; }
      let end = k;
      let sx = 0, sz = 0, sh = 0;
      while (end < pts.length && river.inWater(pts[end].x, pts[end].z)) {
        sx += pts[end].x; sz += pts[end].z; sh += pts[end].h;
        end++;
      }
      const n = end - k;
      const mx = sx / n, mz = sz / n;
      const mh = sh / n;
      const a = pts[k], b = pts[Math.min(pts.length - 1, end - 1)];
      const len = Math.hypot(b.x - a.x, b.z - a.z) + 3;
      B.box(3.8, 0.16, len, 0x8a6a4a, mx, RAIL_Y - 0.03, mz, 0, mh, 0);
      for (const al of [-len / 4, 0, len / 4]) {
        B.box(0.22, 0.3, 0.22, 0x7a5c40, mx + Math.sin(mh) * al, RAIL_Y - 0.2, mz + Math.cos(mh) * al);
      }
      decks++;
      k = end;
    }
    return decks;
  }

  // ---- level crossing: twin poles with a crossbuck and flashing lamps ----
  private makeCrossing(B: Baked, c: Crossing): void {
    const alongX = c.axis === 'h'; // the street runs along X
    const ry = alongX ? Math.PI / 2 : 0;
    const lamps: THREE.Mesh[][] = [[], []];
    const spots: Array<[number, number]> = alongX
      ? [[c.x + 8.8, c.z + 8.2], [c.x - 8.8, c.z - 8.2]]
      : [[c.x + 8.2, c.z + 8.8], [c.x - 8.2, c.z - 8.8]];
    for (let i = 0; i < 2; i++) {
      const [px, pz] = spots[i];
      B.cyl(0.07, 0.09, 2.9, 8, STEEL, px, 1.45, pz);
      // white crossbuck facing down the street
      B.box(1.5, 0.22, 0.09, 0xfaf7ef, px, 2.75, pz, 0, ry + Math.PI / 4, 0);
      B.box(1.5, 0.22, 0.09, 0xfaf7ef, px, 2.75, pz, 0, ry - Math.PI / 4, 0);
      // pair of signal lamps (kept dynamic so they can flash)
      for (const s of [-0.34, 0.34]) {
        const lamp = new THREE.Mesh(new THREE.SphereGeometry(0.17, 10, 8), DIM_RED);
        lamp.position.set(px + (alongX ? s : 0), 2.2, pz + (alongX ? 0 : s));
        this.scene.add(lamp);
        lamps[i].push(lamp);
      }
      this.boxes.push({ x1: px - 0.35, x2: px + 0.35, z1: pz - 0.35, z2: pz + 0.35, small: 1 });
    }
    this.signals.push({ a: lamps[0], b: lamps[1], c });
  }

  // ---- the tram: inset track down the boulevard centre + stops + vehicles ----
  private buildTram(B: Baked, tram: TramPlan): void {
    const path = makePath(tram.pts, true);
    this.tramPath = path;
    for (let k = 0; k < path.pts.length; k++) {
      const p = path.pts[k], q = path.pts[(k + 1) % path.pts.length];
      const len = Math.hypot(q.x - p.x, q.z - p.z) + 0.7;
      const ry = Math.atan2(q.x - p.x, q.z - p.z);
      const rx = Math.cos(ry), rz = -Math.sin(ry);
      B.box(3.4, 0.045, len, 0xdfd8c8, p.x, 0.126, p.z, 0, ry, 0);   // inset paving
      for (const s of [-0.78, 0.78]) {
        B.box(0.13, 0.05, len, 0x8d939e, p.x + rx * s, 0.16, p.z + rz * s, 0, ry, 0);
      }
    }
    // sheltered stops
    for (const st of tram.stops) {
      for (const s of [-1.6, 1.6]) {
        const px = st.x + Math.cos(st.ry) * s, pz = st.z - Math.sin(st.ry) * s;
        B.cyl(0.08, 0.1, 2.7, 8, STEEL, px, 1.35, pz);
      }
      B.box(4.4, 0.16, 2.0, CREAM, st.x, 2.75, st.z, 0, st.ry, 0);
      B.box(3.2, 0.09, 0.45, 0xa9805a, st.x, 0.62, st.z, 0, st.ry, 0);
      // amber stop sign between the shelter and the track
      const n0 = path.nearest(st.x, st.z);
      const sdx = n0.p.x - st.x, sdz = n0.p.z - st.z;
      const sdl = Math.hypot(sdx, sdz) || 1;
      B.cyl(0.05, 0.07, 2.4, 8, STEEL, st.x + sdx / sdl * 2.4, 1.2, st.z + sdz / sdl * 2.4);
      B.cyl(0.42, 0.42, 0.07, 12, 0xf6c952, st.x + sdx / sdl * 2.4, 2.35, st.z + sdz / sdl * 2.4, Math.PI / 2, 0, 0);
      this.boxes.push({ x1: st.x - 1.1, x2: st.x + 1.1, z1: st.z - 1.1, z2: st.z + 1.1, small: 1 });
    }
    // arc distance of each stop along the loop
    this.stopD = tram.stops.map(st => {
      const n = path.nearest(st.x, st.z);
      return (n.i / path.pts.length) * path.total;
    }).sort((a, b) => a - b);
    // two trams, opposite sides of the loop
    const tpl = bakedModel('tram-car');
    const tints: Array<[number, number, number]> = [[1, 0.96, 0.86], [1, 0.84, 0.84]];
    for (let i = 0; i < 2; i++) {
      const tram0: Tram = { obj: null, s: (i * path.total) / 2, v: 0, next: 0, hold: 0 };
      if (tpl) {
        const m = templateToMesh(tpl);
        const mat = (m.material as THREE.MeshLambertMaterial).clone();
        mat.color.setRGB(...tints[i]);
        m.material = mat;
        m.geometry.scale(0.78, 0.78, 0.78);
        m.castShadow = true;
        m.position.y = 0.17;
        this.scene.add(m);
        tram0.obj = m;
      }
      tram0.next = this.nextStop(tram0.s);
      this.trams.push(tram0);
    }
  }

  private nextStop(s: number): number {
    const path = this.tramPath;
    if (!path || !this.stopD.length) return 0;
    let best = 0, bestGap = Infinity;
    for (let i = 0; i < this.stopD.length; i++) {
      const g = ((this.stopD[i] - s) % path.total + path.total) % path.total;
      if (g < bestGap) { bestGap = g; best = i; }
    }
    return best;
  }

  /** true while a train is close enough to the crossing to hold traffic */
  blocked(c: Crossing, trains: Trains): boolean {
    return trains.distTo(c.d) < 42;
  }

  update(dt: number, elapsed: number, trains: Trains): void {
    // crossing lamps: alternate flash while a train is near, dim otherwise
    for (const sig of this.signals) {
      const warn = this.blocked(sig.c, trains);
      const phase = Math.floor(elapsed * 2.6) % 2;
      for (const l of sig.a) l.material = warn && phase === 0 ? LIT_RED : DIM_RED;
      for (const l of sig.b) l.material = warn && phase === 1 ? LIT_RED : DIM_RED;
    }
    // trams: amble around the loop, dwelling at each shelter
    const path = this.tramPath;
    if (!path) return;
    for (const t of this.trams) {
      if (!t.obj) continue;
      if (this.stopD.length) {
        const gap = ((this.stopD[t.next] - t.s) % path.total + path.total) % path.total;
        if (gap < 1.4) {
          t.v = 0;
          t.hold += dt;
          if (t.hold >= 2.6) {
            t.hold = 0;
            t.next = (t.next + 1) % this.stopD.length;
          }
        } else {
          const target = gap < 18 ? Math.max(0.4, gap * 0.45) : 6.5;
          t.v += Math.max(-5 * dt, Math.min(2.5 * dt, target - t.v));
        }
      } else {
        t.v = 6.5;
      }
      t.s += t.v * dt;
      const p = path.sample(t.s);
      t.obj.position.set(p.x, 0.17, p.z);
      t.obj.rotation.y = p.h;
    }
  }

  /** debug probe */
  list(): unknown {
    return {
      crossings: this.signals.map(s => ({ x: +s.c.x.toFixed(1), z: +s.c.z.toFixed(1), axis: s.c.axis })),
      trams: this.trams.filter(t => t.obj).map(t => ({ x: +t.obj!.position.x.toFixed(1), z: +t.obj!.position.z.toFixed(1) })),
    };
  }
}
