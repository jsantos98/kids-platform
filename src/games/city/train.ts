// The city trains: several trains shuttle along the rail corridors that cross
// the world, driven purely by (time, player position) so they stream with the
// chunks. Each train is baked into a single mesh (one draw call per train).
import * as THREE from 'three';
import { Baked } from '../../engine/baked.js';
import { makeTrainCar, makeTrainLoco } from '../../kit/index.js';

const SPEED = 0.15;  // shuttle angular speed (rad/s)
const AMP = 40;      // shuttle amplitude around the player, in metres
const BANDS = [0x63b0a8, 0xe25c5c, 0x7fb2d9, 0xf6c952];

function bakeGroup(baked: Baked, g: THREE.Object3D): void {
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

function buildTrainMesh(band: number): THREE.Mesh {
  const g = new THREE.Group();
  const loco = makeTrainLoco();
  const car1 = makeTrainCar({ color: 0xf0ece2, band });
  const car2 = makeTrainCar({ color: 0xf0ece2, band });
  const parts: Array<[THREE.Object3D, number]> = [[loco, 6.6], [car1, 0], [car2, -6.6]];
  for (const [m, x] of parts) {
    m.rotation.y = Math.PI / 2; // face +X along the corridor
    m.position.x = x;
    g.add(m);
  }
  const b = new Baked();
  bakeGroup(b, g);
  const mesh = b.build();
  mesh.position.y = 0.15;
  return mesh;
}

export class Trains {
  private trains: Array<{ mesh: THREE.Mesh; index: number; phase: number; dirLast: number }> = [];

  constructor(scene: THREE.Scene, private CH: number, count = 4) {
    for (let i = 0; i < count; i++) {
      const mesh = buildTrainMesh(BANDS[i % BANDS.length]);
      scene.add(mesh);
      this.trains.push({ mesh, index: i, phase: i * 1.7, dirLast: 1 });
    }
  }

  update(elapsed: number, playerX: number, playerZ: number): void {
    const railStep = 4 * this.CH; // rail corridors every 4th grid line
    for (const t of this.trains) {
      const vertical = t.index % 2 === 0;
      // spread trains over the nearest rail lines: 0 = nearest, 1 = one step out
      const slotShift = t.index < 2 ? 0 : (t.index === 2 ? 1 : -1);
      const perp = vertical ? playerZ : playerX;
      const base = Math.round((perp / this.CH - 2) / 4) * 4 + 2;
      const lineIdx = base + slotShift * 4;
      const lineWorld = lineIdx * this.CH;

      const off = Math.sin(elapsed * SPEED + t.phase) * AMP;
      const dir = Math.cos(elapsed * SPEED + t.phase) >= 0 ? 1 : -1;
      t.mesh.rotation.y = vertical ? (dir > 0 ? Math.PI / 2 : -Math.PI / 2)
        : (dir > 0 ? 0 : Math.PI);
      if (vertical) {
        t.mesh.position.set(lineWorld, 0.15, playerZ + off);
      } else {
        t.mesh.position.set(playerX + off, 0.15, lineWorld);
      }
    }
  }
}
