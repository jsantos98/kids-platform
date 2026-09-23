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

    // surf foam hugging the beach rim
    const strip = (w: number, d: number, x: number, z: number): void => {
      const m = new THREE.Mesh(new THREE.BoxGeometry(w, 0.1, d), this.foamMat);
      m.position.set(x, 0.05, z);
      group.add(m);
    };
    strip(3, ISLAND + 6, ox - 1.8, oz + CENTER);
    strip(3, ISLAND + 6, ox + ISLAND + 1.8, oz + CENTER);
    strip(ISLAND + 6, 3, ox + CENTER, oz - 1.8);
    strip(ISLAND + 6, 3, ox + CENTER, oz + ISLAND + 1.8);

    // the picnic-island causeway
    const bridge = buildBridge(ox, oz);
    group.add(bridge.group);
    boxes.push(...bridge.boxes);

    // wooden pier off the south-east shore + moored dinghies
    group.add(this.bakePier(ox, oz));
    const px = ox + ISLAND - 50;
    for (const [dx, dz, phase] of [[-7.5, 10, 1.2], [7.5, 14, 4.1]] as Array<[number, number, number]>) {
      const boat = hullObject('boat-row-large', 4, () => makeRowboat({ hull: C.brown }));
      boat.rotation.y = Math.PI / 2;
      boat.position.set(px + dx, 0, oz + ISLAND + dz);
      group.add(boat);
      bobbers.push({ mesh: boat, x: px + dx, z: oz + ISLAND + dz, amp: 1.6, phase });
    }

    // an anchored cargo ship off the south-east shore
    const sx = ox + ISLAND + 34, sz = oz + ISLAND - 36;
    const ship = hullObject('ship-cargo-a', 30, () => new THREE.Group());
    ship.rotation.y = 0.5;
    ship.position.set(sx, 0, sz);
    group.add(ship);
    bobbers.push({ mesh: ship, x: sx, z: sz, amp: 0.5, phase: 2.8 });

    // course buoys just outside the sailing lane
    const loop = boatLoop();
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

  /** pier deck, beams, posts and bollards in one baked mesh (south-east shore) */
  private bakePier(ox: number, oz: number): THREE.Mesh {
    const wood = C.brown, dark = C.brownDark;
    const px = ox + ISLAND - 50, zc = oz + ISLAND + 9.5;
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
