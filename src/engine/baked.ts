// Baked props: merge hundreds of small primitives into ONE draw call.
// Every geometry gets a per-vertex color so a single Lambert material covers all.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

const _m4 = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _e = new THREE.Euler();
const _v = new THREE.Vector3();
const _sc = new THREE.Vector3();

function xformed(
  geo: THREE.BufferGeometry,
  x: number, y: number, z: number,
  rx: number, ry: number, rz: number,
  s: number,
): THREE.BufferGeometry {
  _e.set(rx, ry, rz);
  _q.setFromEuler(_e);
  _v.set(x, y, z);
  _sc.setScalar(s);
  _m4.compose(_v, _q, _sc);
  geo.applyMatrix4(_m4);
  return geo;
}

function tinted(geo: THREE.BufferGeometry, color: number): THREE.BufferGeometry {
  const c = new THREE.Color(color);
  const n = geo.attributes.position.count;
  const arr = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    arr[i * 3] = c.r;
    arr[i * 3 + 1] = c.g;
    arr[i * 3 + 2] = c.b;
  }
  geo.setAttribute('color', new THREE.BufferAttribute(arr, 3));
  return geo;
}

export interface BakedOptions {
  cast?: boolean;
  receive?: boolean;
}

export class Baked {
  private geos: THREE.BufferGeometry[] = [];

  /** Push a pre-colored, pre-transformed geometry (used by the asset baker). */
  raw(geo: THREE.BufferGeometry): this {
    this.geos.push(geo);
    return this;
  }

  add(
    geo: THREE.BufferGeometry, color: number,
    x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0, s = 1,
  ): this {
    this.geos.push(tinted(xformed(geo, x, y, z, rx, ry, rz, s), color));
    return this;
  }

  box(w: number, h: number, d: number, color: number, x: number, y: number, z: number,
      rx = 0, ry = 0, rz = 0): this {
    return this.add(new THREE.BoxGeometry(w, h, d), color, x, y, z, rx, ry, rz);
  }

  cyl(rt: number, rb: number, h: number, seg: number, color: number, x: number, y: number, z: number,
      rx = 0, ry = 0, rz = 0): this {
    return this.add(new THREE.CylinderGeometry(rt, rb, h, seg), color, x, y, z, rx, ry, rz);
  }

  cone(r: number, h: number, seg: number, color: number, x: number, y: number, z: number,
       rx = 0, ry = 0, rz = 0): this {
    return this.add(new THREE.ConeGeometry(r, h, seg), color, x, y, z, rx, ry, rz);
  }

  sphere(r: number, color: number, x: number, y: number, z: number): this {
    return this.add(new THREE.SphereGeometry(r, 10, 8), color, x, y, z);
  }

  torus(r: number, t: number, color: number, x: number, y: number, z: number,
        rx = 0, ry = 0, rz = 0): this {
    return this.add(new THREE.TorusGeometry(r, t, 8, 20), color, x, y, z, rx, ry, rz);
  }

  build({ cast = true, receive = true }: BakedOptions = {}): THREE.Mesh {
    // mergeGeometries requires uniform indexed-ness; normalize to non-indexed
    const parts = this.geos.map((g) => (g.index ? g.toNonIndexed() : g));
    const merged = mergeGeometries(parts);
    this.geos.length = 0;
    const m = new THREE.Mesh(
      merged,
      new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true }),
    );
    m.castShadow = cast;
    m.receiveShadow = receive;
    return m;
  }
}

/** Merge an object tree into a single vertex-colored mesh (one draw call). */
export function bakeObjectToMesh(g: THREE.Object3D): THREE.Mesh {
  const b = new Baked();
  g.updateMatrixWorld(true);
  g.traverse(node => {
    if (!(node instanceof THREE.Mesh) || !node.geometry) return;
    let geo = node.geometry.index ? node.geometry.toNonIndexed() : node.geometry.clone();
    for (const name of Object.keys(geo.attributes)) {
      if (name !== 'position' && name !== 'normal' && name !== 'uv') geo.deleteAttribute(name);
    }
    const mesh = node as THREE.Mesh;
    const std = (Array.isArray(mesh.material) ? mesh.material[0] : mesh.material) as THREE.MeshLambertMaterial;
    const col = std && std.color ? std.color : new THREE.Color(0x888888);
    const pos = geo.attributes.position as THREE.BufferAttribute;
    const colors = new Float32Array(pos.count * 3);
    for (let i = 0; i < pos.count; i++) {
      colors[i * 3] = col.r;
      colors[i * 3 + 1] = col.g;
      colors[i * 3 + 2] = col.b;
    }
    geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    geo.applyMatrix4(node.matrixWorld);
    b.raw(geo);
  });
  return b.build();
}
