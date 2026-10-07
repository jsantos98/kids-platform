// Per-city shoreline scenery: the surf foam ring, the wooden pier with moored
// dinghies, the anchored cargo ship, the course buoys, and the picnic-island
// causeway. Each city builds its set the first time the player arrives; the
// three most recent cities stay alive so a strait never looks bare behind you.
import * as THREE from 'three';
import { C, mat } from '../../engine/stage.js';
import { Baked } from '../../engine/baked.js';
import { waveAt, hullObject, boatLoop } from './sea.js';
import { buildBridge, type Lighthouse } from './bridge.js';
import { buildAirport } from './airport.js';
import { harbourFor } from './harbour.js';
import { isletsFor } from './islets.js';
import { PK_M } from './sea.js';
import { bakedModel } from '../../engine/assets.js';
import { templateToMesh } from '../../engine/baked.js';
import type { NightLights } from './nightLights.js';
import { makeRowboat } from '../../kit/boats.js';
import { ISLAND, CENTER } from '../../worlds/world.js';
import { coastFor } from '../../worlds/coast.js';
import type { CollisionBox } from '../../worlds/cityChunk.js';

interface Bobber { mesh: THREE.Object3D; x: number; z: number; amp: number; phase: number }

interface Inst { group: THREE.Group; boxes: CollisionBox[]; bobbers: Bobber[]; lighthouse: Lighthouse; marks: THREE.Object3D[]; runwayLights: THREE.Mesh }

/** a Pirate Kit model at its kit scale (PK_M m a unit), standing on y = 0
 * and centred, turned by ry — null until it is baked */
function pk(name: string, ry = 0, s = PK_M): THREE.Mesh | null {
  const t = bakedModel(`pk-${name}`);
  if (!t) return null;
  const m = templateToMesh(t);
  m.geometry.scale(s, s, s);
  m.geometry.computeBoundingBox();
  const bb = m.geometry.boundingBox!;
  m.geometry.translate(-(bb.min.x + bb.max.x) / 2, -bb.min.y, -(bb.min.z + bb.max.z) / 2);
  m.rotation.y = ry;
  m.castShadow = true;
  return m;
}

export class CityScenery {
  private cities = new Map<string, Inst>();
  private foamMat = mat(0xffffff, { transparent: true, opacity: 0.4, depthWrite: false });

  constructor(private scene: THREE.Scene) {}

  /** is island (bx, by)'s scenery (its airport too) built? */
  has(bx: number, by: number): boolean { return this.cities.has(`${bx},${by}`); }

  ensure(bx: number, by: number, ox: number, oz: number): void {
    const key = `${bx},${by}`;
    const have = this.cities.get(key);
    if (have) {
      // LRU touch
      this.cities.delete(key);
      this.cities.set(key, have);
      return;
    }
    const group = new THREE.Group();
    const boxes: CollisionBox[] = [];
    const bobbers: Bobber[] = [];

    const coast = coastFor(bx, by);
    // surf foam tracing the shore, just out from the beach
    {
      const F = new Baked();
      const ring = coast.pts.map(p => coast.shoreToward(p.x, p.z, 1.8));
      for (let i = 0; i < ring.length; i++) {
        const a = ring[i], b = ring[(i + 1) % ring.length];
        const len = Math.hypot(b.x - a.x, b.z - a.z) + 0.6;
        F.box(3, 0.1, len, 0xffffff, ox + (a.x + b.x) / 2, 0.05, oz + (a.z + b.z) / 2, 0, Math.atan2(b.x - a.x, b.z - a.z), 0);
      }
      const foam = F.build({ cast: false, receive: false });
      foam.material = this.foamMat;
      group.add(foam);
    }

    // the picnic-island causeway (its boxes are island-local: moved to the
    // world like the chunks' — they only stood right on island (0,0), so the
    // lighthouse, trees and rocks were nowhere anywhere else: G14)
    const bridge = buildBridge(bx, by, ox, oz);
    group.add(bridge.group);
    boxes.push(...bridge.boxes.map(b => ({ ...b, x1: b.x1 + ox, x2: b.x2 + ox, z1: b.z1 + oz, z2: b.z2 + oz })));

    // the airport on its own island off a corner (R41; its boxes are
    // world coordinates already)
    const airport = buildAirport(bx, by, ox, oz);
    group.add(airport.group);
    boxes.push(...airport.boxes);

    // wooden pier off the south-east shore + moored dinghies, facing out to
    // sea from wherever the coast is (pier frame: +z outward, x across —
    // harbour.ts, which the boats' physics and lanes read too)
    const H = harbourFor(bx, by);
    const yaw = H.yaw;
    const at = (a: number, o: number): { x: number; z: number } => { const p = H.at(a, o); return { x: ox + p.x, z: oz + p.z }; };
    const pier = this.bakePier();
    const p0 = at(0, 0);
    pier.position.set(p0.x, 0, p0.z);
    pier.rotation.y = yaw;
    group.add(pier);
    for (const [a, o, phase] of H.dinghies) {
      const boat = hullObject('boat-row-large', 4, () => makeRowboat({ hull: C.brown }));
      const p = at(a, o);
      boat.rotation.y = yaw + Math.PI / 2;
      boat.position.set(p.x, 0, p.z);
      group.add(boat);
      bobbers.push({ mesh: boat, x: p.x, z: p.z, amp: 1.6, phase });
    }

    // an anchored cargo ship further out off the same shore — solid: a boat
    // running into it crashes (G14)
    const sx = ox + H.ship.cx, sz = oz + H.ship.cz;
    const ship = hullObject('ship-cargo-a', 30, () => new THREE.Group());
    ship.rotation.y = H.ship.yaw;
    {
      const S = H.ship, ex = Math.abs(Math.sin(S.yaw)) * S.hl + Math.abs(Math.cos(S.yaw)) * S.hw, ez = Math.abs(Math.cos(S.yaw)) * S.hl + Math.abs(Math.sin(S.yaw)) * S.hw;
      boxes.push({ x1: sx - ex, x2: sx + ex, z1: sz - ez, z2: sz + ez, top: 9, obb: { cx: sx, cz: sz, hx: S.hw, hz: S.hl, ry: S.yaw } });
    }
    ship.position.set(sx, 0, sz);
    group.add(ship);
    bobbers.push({ mesh: ship, x: sx, z: sz, amp: 0.5, phase: 2.8 });

    // marker buoys just outside the sailing lane
    const loop = boatLoop(bx, by);
    for (let k = 0; k < 6; k++) {
      const p = loop[Math.floor((k / 6) * loop.length)];
      const nx = p.x - CENTER, nz = p.z - CENTER;
      const nl = Math.hypot(nx, nz) || 1;
      // (halfway between the calm boats' two lanes, 10 m apart: sea.ts)
      const x = ox + p.x + (nx / nl) * 5, z = oz + p.z + (nz / nl) * 5;
      const name = k % 2 ? 'buoy' : 'buoy-flag';
      const buoy = hullObject(name, k % 2 ? 1.4 : 2.2, () => new THREE.Group());
      buoy.position.set(x, 0, z);
      buoy.rotation.y = (k * 1.9) % (Math.PI * 2);
      group.add(buoy);
      bobbers.push({ mesh: buoy, x, z, amp: 1.4, phase: k * 2.3 });
    }

    // the treasure islets out at sea (G15): a sandy mound in a ring of foam,
    // palms, sand rocks, a pirate's flag, and a red ❌ over the treasure —
    // hidden until the pirate mode has its map (`showTreasure`)
    const marks: THREE.Object3D[] = [];
    for (const [k, I] of isletsFor(bx, by).entries()) {
      const x = ox + I.x, z = oz + I.z;
      const S = new Baked();
      S.cyl(I.r * 0.72, I.r, 0.9, 28, 0xf0e2c0, x, 0.1, z);
      S.cyl(I.r * 0.45, I.r * 0.72, 0.55, 24, 0xf5e8c8, x, 0.72, z);
      group.add(S.build());
      const F = new Baked();
      F.cyl(I.r + 1.6, I.r + 1.6, 0.08, 32, 0xffffff, x, 0.03, z);
      const foam = F.build({ cast: false, receive: false });
      foam.material = this.foamMat;
      group.add(foam);
      const put = (m: THREE.Mesh | null, a: number, d: number, y = 0.6): void => {
        if (!m) return;
        m.position.set(x + Math.cos(a) * d, y, z + Math.sin(a) * d);
        group.add(m);
      };
      const palms = ['palm-detailed-bend', 'palm-bend', 'palm-detailed-straight', 'palm-straight'];
      const n = 2 + Math.floor(I.v * 2.99);
      for (let j = 0; j < n; j++) {
        const a = I.v * 9 + j * 2.4;
        put(pk(palms[(j + Math.floor(I.v * 4)) % 4], a * 1.7), a, I.r * (0.35 + 0.3 * ((j * 0.37 + I.v) % 1)), 0.4);
      }
      put(pk(['rocks-sand-a', 'rocks-sand-b', 'rocks-sand-c'][k % 3], I.v * 6), I.v * 9 + 1.2, I.r * 0.82, 0.05);
      put(pk('patch-sand-foliage', I.v * 3), I.v * 9 + 3.6, I.r * 0.5, 0.9);
      put(pk('flag-pirate', I.v * 5 + 1), I.v * 9 + 4.9, I.r * 0.2, 1.1);
      // the ❌: two red planks crossed on the sand, standing a little proud
      const X = new Baked();
      for (const r of [Math.PI / 4, -Math.PI / 4]) X.box(1.1, 0.2, 5.4, 0xd8322a, 0, 0, 0, 0, r, 0);
      const mark = X.build({ cast: false });
      mark.position.set(ox + I.tx, 1.05, oz + I.tz);
      mark.visible = false;
      group.add(mark);
      marks.push(mark);
    }

    this.scene.add(group);
    this.cities.set(key, { group, boxes, bobbers, lighthouse: bridge.lighthouse, marks, runwayLights: airport.lights });
    while (this.cities.size > 3) {
      const oldest = this.cities.keys().next().value as string;
      const inst = this.cities.get(oldest)!;
      this.scene.remove(inst.group);
      inst.group.traverse(o => {
        const m = o as THREE.Mesh;
        if (m.isMesh) m.geometry.dispose();
      });
      this.cities.delete(oldest);
    }
  }

  /** show (or hide) the ❌ over island (bx, by)'s islet k's treasure */
  showTreasure(bx: number, by: number, k: number, on: boolean): void {
    const m = this.cities.get(`${bx},${by}`)?.marks[k];
    if (m) m.visible = on;
  }

  /** at night the lighthouses' lamps glow here (G10) */
  night: NightLights | null = null;
  private _lamp = new THREE.Color();

  update(elapsed: number, night = 0): void {
    for (const inst of this.cities.values()) {
      // the lighthouse: its lamp comes on and its beam sweeps round at night
      const L = inst.lighthouse;
      L.beam.visible = night > 0.02;
      L.beam.rotation.y = elapsed * 0.7;
      ((L.beam.children[0] as THREE.Mesh).material as THREE.MeshBasicMaterial).opacity = night * 0.22;
      (L.lamp.material as THREE.MeshBasicMaterial).color.copy(this._lamp.setHex(0xcfe3ea).lerp(new THREE.Color(0xfff0b8), night));
      if (night > 0.02) this.night?.flash({ x: L.x, y: L.y, z: L.z, color: 0xfff0c0, size: 9, pool: 0, strength: night });
      // the runway's edge lights: grey studs by day, a glowing double row at night
      (inst.runwayLights.material as THREE.MeshBasicMaterial).color.copy(this._lamp.setHex(0xbfc4c9).lerp(new THREE.Color(0xffe9a0), night));
      for (const b of inst.bobbers) {
        b.mesh.position.y = waveAt(b.x, b.z, elapsed) * b.amp + 0.03;
        b.mesh.rotation.x = Math.sin(elapsed * 0.8 + b.phase) * 0.02 * b.amp;
        b.mesh.rotation.z = Math.sin(elapsed * 0.65 + b.phase) * 0.03 * b.amp;
      }
    }
  }

  /** static collision from the built cities (picnic-island trees and rocks) */
  boxesNear(): CollisionBox[] {
    const out: CollisionBox[] = [];
    for (const inst of this.cities.values()) out.push(...inst.boxes);
    return out;
  }

  /** pier deck, beams, posts and bollards in one baked mesh, in the pier's
   * own frame: the deck runs from the beach (z = -2) out to sea (+z) */
  private bakePier(): THREE.Mesh {
    const wood = C.brown, dark = C.brownDark;
    const ox = 0, oz = -ISLAND;
    const px = ox, zc = oz + ISLAND + 9.5;
    const B = new Baked();
    B.box(8, 0.16, 19, wood, px, 0.42, zc);
    for (const x of [px - 3.5, px - 0.5, px + 2.5]) B.box(0.14, 0.04, 19, dark, x, 0.51, zc);
    for (const x of [px - 3.8, px + 3.8]) B.box(0.32, 0.2, 19, dark, x, 0.45, zc);
    for (const z of [oz + ISLAND + 2.5, zc, oz + ISLAND + 16.5]) {
      for (const x of [px - 3.1, px + 3.1]) B.cyl(0.18, 0.22, 2.4, 8, dark, x, -0.4, z);
    }
    for (const x of [px - 1.6, px + 1.6]) B.cyl(0.14, 0.18, 0.5, 8, dark, x, 0.75, oz + ISLAND + 17.5);
    return B.build();
  }
}
