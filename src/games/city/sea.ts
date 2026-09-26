// The sea: a gently waving ocean plane that follows the player, and each
// island's own Kenney watercraft fleet sailing its offshore loop (Fleet —
// owned by the island's simulation, so boats never jump between islands).
// The per-city shoreline dressing (foam, pier, dinghies, buoys, the picnic
// causeway) lives in scenery.ts.
import * as THREE from 'three';
import { nightLights } from './nightLights.js';
import { C, mat } from '../../engine/stage.js';
import { bakedModel, prepBakedModels, type BakeDef } from '../../engine/assets.js';
import { templateToMesh } from '../../engine/baked.js';
import { makeSailboat, makeTugboat, makeRowboat } from '../../kit/boats.js';
import { ISLAND, CENTER, SCALE } from '../../worlds/world.js';
import { coastFor } from '../../worlds/coast.js';
import { southExit, eastExit } from '../../worlds/cityGrid.js';
import { RAIL_OFFSET } from '../../worlds/railRoute.js';

// gentle deterministic swell — crests stay under the island slabs (top y=0.1).
export function waveAt(x: number, z: number, t: number): number {
  return 0.032 * Math.sin(0.075 * x + t * 0.9)
       + 0.026 * Math.sin(0.105 * z - t * 0.7)
       + 0.018 * Math.sin(0.05 * (x + z) + t * 0.5);
}

// offshore lane: the island's shore pushed 26 m out to sea, resampled every
// ~3 m (city-local). Where it meets a causeway (the avenue and the rail deck
// 24 m beside it) it swings out to 44 m, under the raised span, where the
// decks are high enough to sail beneath.
const loops = new Map<string, Array<{ x: number; z: number }>>();

/** city (bx, by)'s offshore sailing lane (city-local coordinates) */
export function boatLoop(bx: number, by: number): Array<{ x: number; z: number }> {
  const key = `${bx},${by}`;
  let loop = loops.get(key);
  if (!loop) {
    const coast = coastFor(bx, by);
    // the four corridors that meet our shore: [vertical?, avenue coordinate]
    const corr: Array<[boolean, number, number]> = [
      [true, southExit(bx, by - 1) * 64, -1], [true, southExit(bx, by) * 64, 1],
      [false, eastExit(bx - 1, by) * 64, -1], [false, eastExit(bx, by) * 64, 1],
    ];
    const out = (p: { x: number; z: number }): number => {
      let w = 0;
      for (const [vert, at, side] of corr) {
        // only the shore on that corridor's side of the island
        if ((vert ? p.z - CENTER : p.x - CENTER) * side <= 0) continue;
        const a = vert ? p.x : p.z;
        const lat = a < at - 8 ? at - 8 - a : a > at + RAIL_OFFSET + 4 ? a - at - RAIL_OFFSET - 4 : 0;
        w = Math.max(w, 1 - Math.min(1, lat / 45));
      }
      return 26 + 18 * w * w * (3 - 2 * w);
    };
    const ring = coast.pts.map(p => coast.shoreToward(p.x, p.z, out(p)));
    loop = [];
    for (let i = 0; i < ring.length; i++) {
      const a = ring[i], b = ring[(i + 1) % ring.length];
      const steps = Math.max(1, Math.round(Math.hypot(b.x - a.x, b.z - a.z) / 3));
      for (let k = 0; k < steps; k++) loop.push({ x: a.x + (b.x - a.x) * (k / steps), z: a.z + (b.z - a.z) * (k / steps) });
    }
    loops.set(key, loop);
    if (loops.size > 16) loops.delete(loops.keys().next().value as string);
  }
  return loop;
}

const mod = (a: number, n: number) => ((a % n) + n) % n;

/** One merged, re-centred hull mesh at the requested length (y=0 waterline). */
export function hullObject(tplName: string, len: number, fallback: () => THREE.Object3D): THREE.Object3D {
  const tpl = bakedModel(tplName);
  if (!tpl) return fallback();
  const m = templateToMesh(tpl);
  const s = len / Math.max(tpl.size.x, tpl.size.z);
  m.geometry.scale(s, s, s);
  m.geometry.computeBoundingBox();
  const bb = m.geometry.boundingBox!;
  m.geometry.translate(-(bb.min.x + bb.max.x) / 2, -bb.min.y, -(bb.min.z + bb.max.z) / 2);
  m.castShadow = true;
  return m;
}

interface Boat {
  mesh: THREE.Group;
  offset: number;
  speed: number;
  dir: 1 | -1;
  phase: number;
}

export class Sea {
  private water: THREE.Mesh;
  private waterBase: Float32Array;
  private ox = 0;
  private oz = 0;

  constructor(scene: THREE.Scene) {
    // ---- waving water plane (flat-shaded facets catch the light) ----
    // sized so its far edge is past full fog from any shore viewpoint
    this.water = new THREE.Mesh(
      new THREE.PlaneGeometry(ISLAND + 400, ISLAND + 400, 72, 72),
      mat(0x72c3de),
    );
    this.water.rotation.x = -Math.PI / 2;
    this.water.position.set(CENTER, -0.02, CENTER);
    this.water.receiveShadow = true;
    scene.add(this.water);
    this.waterBase = Float32Array.from(
      (this.water.geometry.attributes.position as THREE.BufferAttribute).array,
    );
  }

  /** move the water plane to the current city */
  setCity(ox: number, oz: number): void {
    this.ox = ox;
    this.oz = oz;
    this.water.position.set(ox + CENTER, -0.02, oz + CENTER);
  }

  update(elapsed: number): void {
    const pos = this.water.geometry.attributes.position as THREE.BufferAttribute;
    const arr = pos.array as Float32Array;
    for (let i = 0; i < arr.length; i += 3) {
      arr[i + 2] = waveAt(this.ox + CENTER + this.waterBase[i], this.oz + CENTER - this.waterBase[i + 1], elapsed);
    }
    pos.needsUpdate = true;
  }
}

interface Boat {
  mesh: THREE.Group;
  offset: number;
  speed: number;
  dir: 1 | -1;
  phase: number;
}

const FLEET: Array<{ tpl: string; len: number; speed: number; dir: 1 | -1; fb: () => THREE.Object3D }> = [
  { tpl: 'boat-sail-a', len: 8, speed: 5, dir: 1, fb: () => makeSailboat({ hull: C.blue }) },
  { tpl: 'boat-speed-c', len: 5, speed: 7.5, dir: -1, fb: () => makeRowboat({ hull: C.orange }) },
  { tpl: 'boat-tug-a', len: 7, speed: 3.6, dir: 1, fb: () => makeTugboat({ hull: C.red }) },
  { tpl: 'boat-sail-b', len: 6.5, speed: 4.4, dir: 1, fb: () => makeSailboat({ hull: C.teal, sail: C.cream }) },
  { tpl: 'boat-row-small', len: 3.2, speed: 2.4, dir: -1, fb: () => makeRowboat({ hull: C.teal }) },
  { tpl: 'boat-tug-b', len: 6, speed: 3.2, dir: 1, fb: () => makeTugboat({ hull: C.blue, trim: C.yellow }) },
];

/** one island's boats, sailing its offshore lane for good */
export class Fleet {
  private boats: Boat[] = [];
  private loop: Array<{ x: number; z: number }>;
  /** the loop's cumulative length at each point (closed: the last entry is
   * the whole way round), and the speed scale — boats move by distance, not
   * by points: point by point a boat sped up and slowed down with the
   * spacing, and one going the other way round jumped two points at each */
  private cum: number[] = [0];
  private total = 0;
  private perM = 1;

  constructor(private scene: THREE.Scene, private ox: number, private oz: number, seed: number, bx: number, by: number) {
    this.loop = boatLoop(bx, by);
    const LOOP = this.loop;
    for (let k = 0; k < LOOP.length; k++) {
      const a = LOOP[k], b = LOOP[(k + 1) % LOOP.length];
      this.cum.push(this.cum[k] + Math.hypot(b.x - a.x, b.z - a.z));
    }
    this.total = this.cum[LOOP.length];
    // (the old speeds were `speed / 3` points a second: the same pace on
    // average, now steady)
    this.perM = this.total / LOOP.length / 3;
    // (six boats round an 896 m island; more round a bigger one's longer lane)
    const count = Math.round(FLEET.length * SCALE);
    for (let i = 0; i < count; i++) {
      const d = FLEET[i % FLEET.length];
      const g = new THREE.Group();
      g.add(hullObject(d.tpl, d.len, d.fb));
      // foam wake trailing the stern
      const wake = new THREE.Mesh(
        new THREE.PlaneGeometry(d.len * 0.55, d.len * 1.4),
        mat(C.white, { transparent: true, opacity: 0.45, depthWrite: false }),
      );
      wake.rotation.x = -Math.PI / 2;
      wake.position.set(0, 0.06, -d.len * 0.72);
      g.add(wake);
      g.rotation.order = 'YXZ';
      scene.add(g);
      // each island's fleet starts at its own seeded spots on the loop
      const off = ((i / count) + ((seed >>> (i * 3)) & 7) / 64) * this.total;
      this.boats.push({ mesh: g, offset: off, speed: d.speed, dir: d.dir, phase: i * 1.7 });
    }
  }

  hide(): void { for (const b of this.boats) b.mesh.visible = false; }

  dispose(): void { for (const b of this.boats) this.scene.remove(b.mesh); }

  /** the point `s` metres round the loop (city-local) */
  private at(s: number): { x: number; z: number } {
    const L = this.loop, cum = this.cum;
    s = mod(s, this.total);
    let lo = 0, hi = L.length - 1;
    while (lo < hi) { const m = (lo + hi + 1) >> 1; if (cum[m] <= s) lo = m; else hi = m - 1; }
    const a = L[lo], b = L[(lo + 1) % L.length];
    const f = (s - cum[lo]) / ((cum[lo + 1] - cum[lo]) || 1);
    return { x: a.x + (b.x - a.x) * f, z: a.z + (b.z - a.z) * f };
  }

  update(elapsed: number): void {
    if (!this.total) return;
    for (const b of this.boats) {
      b.mesh.visible = true;
      // a steady pace by distance, either way round
      const sM = b.offset + elapsed * b.speed * this.perM * b.dir;
      const p = this.at(sM);
      const x = this.ox + p.x, z = this.oz + p.z;
      b.mesh.position.set(x, waveAt(x, z, elapsed) * 1.6 + 0.05, z);
      // (heading along the loop a few metres either side, so it swings
      // round a bend instead of snapping at each point)
      const ahead = this.at(sM + b.dir * 7), behind = this.at(sM - b.dir * 3);
      b.mesh.rotation.y = Math.atan2(ahead.x - behind.x, ahead.z - behind.z);
      b.mesh.rotation.x = Math.sin(elapsed * 0.7 + b.phase) * 0.035;
      b.mesh.rotation.z = Math.sin(elapsed * 0.9 + b.phase) * 0.05;
      // at night: a white masthead light and red / green side lights (G10)
      const nl = nightLights();
      if (nl?.dark) {
        const h = b.mesh.rotation.y, fx = Math.sin(h), fz = Math.cos(h), y = b.mesh.position.y;
        nl.flash({ x, y: y + 3, z, color: 0xfff4dc, size: 1.2, pool: 0 });
        // (the right-hand side of a heading (fx, fz) is (-fz, fx): green; the left red)
        nl.flash({ x: x - fz * 1.1, y: y + 1.2, z: z + fx * 1.1, color: 0x33ff66, size: 0.9, pool: 0, face: { x: -fz, z: fx } });
        nl.flash({ x: x + fz * 1.1, y: y + 1.2, z: z - fx * 1.1, color: 0xff2a22, size: 0.9, pool: 0, face: { x: fz, z: -fx } });
      }
    }
  }
}

/** Bake the watercraft kit templates, then build the sea. */
export async function createSea(scene: THREE.Scene): Promise<Sea> {
  const WC = '/assets/kenney/watercraft';
  const MAP = `${WC}/Textures/colormap.png`;
  const def = (n: string): BakeDef => [`${WC}/${n}.glb`, MAP];
  await prepBakedModels({
    'boat-sail-a': def('boat-sail-a'),
    'boat-sail-b': def('boat-sail-b'),
    'boat-tug-a': def('boat-tug-a'),
    'boat-tug-b': def('boat-tug-b'),
    'boat-speed-c': def('boat-speed-c'),
    'boat-row-small': def('boat-row-small'),
    'boat-row-large': def('boat-row-large'),
    'buoy': def('buoy'),
    'buoy-flag': def('buoy-flag'),
    'ship-cargo-a': def('ship-cargo-a'),
  }).catch(() => {});
  return new Sea(scene);
}
