// The island train: three trains circle the island on the perimeter loop,
// evenly spaced, purely a function of time.
import * as THREE from 'three';
import { Baked } from '../../engine/baked.js';
import { makeTrainCar, makeTrainLoco } from '../../kit/index.js';

const SPEED = 9;       // m/s
const LO = 12;         // loop inset from the island edge
const HI = 384 - LO;
const CUT = 20;        // octagon corner cut

// octagon vertices of the loop (clockwise from the bottom-left)
const V: Array<{ x: number; z: number }> = [
  { x: LO + CUT, z: LO }, { x: HI - CUT, z: LO },
  { x: HI, z: LO + CUT }, { x: HI, z: HI - CUT },
  { x: HI - CUT, z: HI }, { x: LO + CUT, z: HI },
  { x: LO, z: HI - CUT }, { x: LO, z: LO + CUT },
];

// sample the octagon edges into a closed path every ~3 m
function buildLoop(): Array<{ x: number; z: number }> {
  const pts: Array<{ x: number; z: number }> = [];
  for (let i = 0; i < V.length; i++) {
    const a = V[i], b = V[(i + 1) % V.length];
    const len = Math.hypot(b.x - a.x, b.z - a.z);
    const steps = Math.max(1, Math.round(len / 3));
    for (let k = 0; k < steps; k++) {
      const f = k / steps;
      pts.push({ x: a.x + (b.x - a.x) * f, z: a.z + (b.z - a.z) * f });
    }
  }
  return pts;
}

const LOOP_PTS = buildLoop();

export class Trains {
  private trains: Array<{ mesh: THREE.Mesh; offset: number }> = [];

  constructor(scene: THREE.Scene, count = 3) {
    const bands = [0x63b0a8, 0xe25c5c, 0x7fb2d9];
    for (let i = 0; i < count; i++) {
      const g = new THREE.Group();
      const loco = makeTrainLoco();
      const car1 = makeTrainCar({ color: 0xf0ece2, band: bands[i % bands.length] });
      const car2 = makeTrainCar({ color: 0xf0ece2, band: bands[(i + 1) % bands.length] });
      for (const [m, x] of [[loco, 6.6], [car1, 0], [car2, -6.6]] as Array<[THREE.Object3D, number]>) {
        m.rotation.y = Math.PI / 2;
        m.position.x = x;
        g.add(m);
      }
      const b = new Baked();
      bakeGroupInto(b, g);
      const mesh = b.build();
      mesh.position.y = 0.15;
      scene.add(mesh);
      this.trains.push({ mesh, offset: (i * LOOP_PTS.length) / count });
    }
  }

  update(elapsed: number): void {
    const total = LOOP_PTS.length;
    for (const t of this.trains) {
      // SPEED m/s along a path with points every ~3 m → 3 points per second
      const f = (elapsed * (SPEED / 3) + t.offset) % total;
      const i0 = Math.floor(f) % total;
      const i1 = (i0 + 1) % total;
      const fr = f - i0;
      const a = LOOP_PTS[i0], b = LOOP_PTS[i1];
      t.mesh.position.set(a.x + (b.x - a.x) * fr, 0.15, a.z + (b.z - a.z) * fr);
      t.mesh.rotation.y = Math.atan2(b.x - a.x, b.z - a.z);
    }
  }
}

function bakeGroupInto(baked: Baked, g: THREE.Object3D): void {
  g.updateMatrixWorld(true);
  g.traverse(node => {
    if (!(node instanceof THREE.Mesh) || !node.geometry) return;
    let geo = node.geometry.index ? node.geometry.toNonIndexed() : node.geometry.clone();
    for (const name of Object.keys(geo.attributes)) {
      if (name !== 'position' && name !== 'normal' && name !== 'uv') geo.deleteAttribute(name);
    }
    const mat = (Array.isArray(node.material) ? node.material[0] : node.material) as THREE.MeshLambertMaterial;
    const col = mat && mat.color ? mat.color : new THREE.Color(0x888888);
    const pos = geo.attributes.position as THREE.BufferAttribute;
    const colors = new Float32Array(pos.count * 3);
    for (let i = 0; i < pos.count; i++) {
      colors[i * 3] = col.r;
      colors[i * 3 + 1] = col.g;
      colors[i * 3 + 2] = col.b;
    }
    geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    geo.applyMatrix4(node.matrixWorld);
    baked.raw(geo);
  });
}
