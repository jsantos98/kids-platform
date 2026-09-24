// Per-city shoreline scenery: the surf foam ring, the wooden pier with moored
// dinghies, the anchored cargo ship, the course buoys, and the picnic-island
// causeway. Each city builds its set the first time the player arrives; the
// three most recent cities stay alive so a strait never looks bare behind you.
import * as THREE from 'three';
import { C, mat } from '../../engine/stage.js';
import { Baked } from '../../engine/baked.js';
import { waveAt, hullObject, boatLoop } from './sea.js';
import { buildBridge } from './bridge.js';
import { makeRowboat } from '../../kit/boats.js';
import { ISLAND, CENTER } from '../../worlds/world.js';
import { coastFor } from '../../worlds/coast.js';
import type { CollisionBox } from '../../worlds/cityChunk.js';

interface Bobber { mesh: THREE.Object3D; x: number; z: number; amp: number; phase: number }

interface Inst { group: THREE.Group; boxes: CollisionBox[]; bobbers: Bobber[] }

export class CityScenery {
  private cities = new Map<string, Inst>();
  private foamMat = mat(0xffffff, { transparent: true, opacity: 0.4, depthWrite: false });

  constructor(private scene: THREE.Scene) {}

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

    // the picnic-island causeway
    const bridge = buildBridge(bx, by, ox, oz);
    group.add(bridge.group);
    boxes.push(...bridge.boxes);

    // wooden pier off the south-east shore + moored dinghies, facing out to
    // sea from wherever the coast is (pier frame: +z outward, x across)
    const shore = coast.shoreToward(CENTER + 1, CENTER + 1, -2);
    const out = { x: shore.x - CENTER, z: shore.z - CENTER };
    const ol = Math.hypot(out.x, out.z);
    out.x /= ol; out.z /= ol;
    const across = { x: out.z, z: -out.x };
    const yaw = Math.atan2(out.x, out.z);
    const at = (a: number, o: number): { x: number; z: number } =>
      ({ x: ox + shore.x + across.x * a + out.x * o, z: oz + shore.z + across.z * a + out.z * o });
    const pier = this.bakePier();
    const p0 = at(0, 0);
    pier.position.set(p0.x, 0, p0.z);
    pier.rotation.y = yaw;
    group.add(pier);
    for (const [a, o, phase] of [[-7.5, 12, 1.2], [7.5, 16, 4.1]] as Array<[number, number, number]>) {
      const boat = hullObject('boat-row-large', 4, () => makeRowboat({ hull: C.brown }));
      const p = at(a, o);
      boat.rotation.y = yaw + Math.PI / 2;
      boat.position.set(p.x, 0, p.z);
      group.add(boat);
      bobbers.push({ mesh: boat, x: p.x, z: p.z, amp: 1.6, phase });
    }

    // an anchored cargo ship further out off the same shore
    const sp = at(-40, 70);
    const sx = sp.x, sz = sp.z;
    const ship = hullObject('ship-cargo-a', 30, () => new THREE.Group());
    ship.rotation.y = 0.5;
    ship.position.set(sx, 0, sz);
    group.add(ship);
    bobbers.push({ mesh: ship, x: sx, z: sz, amp: 0.5, phase: 2.8 });

    // course buoys just outside the sailing lane
    const loop = boatLoop(bx, by);
    for (let k = 0; k < 6; k++) {
      const p = loop[Math.floor((k / 6) * loop.length)];
      const nx = p.x - CENTER, nz = p.z - CENTER;
      const nl = Math.hypot(nx, nz) || 1;
      const x = ox + p.x + (nx / nl) * 8, z = oz + p.z + (nz / nl) * 8;
      const name = k % 2 ? 'buoy' : 'buoy-flag';
      const buoy = hullObject(name, k % 2 ? 1.4 : 2.2, () => new THREE.Group());
      buoy.position.set(x, 0, z);
      buoy.rotation.y = (k * 1.9) % (Math.PI * 2);
      group.add(buoy);
      bobbers.push({ mesh: buoy, x, z, amp: 1.4, phase: k * 2.3 });
    }

    this.scene.add(group);
    this.cities.set(key, { group, boxes, bobbers });
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

  update(elapsed: number): void {
    for (const inst of this.cities.values()) {
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
