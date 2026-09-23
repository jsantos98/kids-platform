// Street props, furniture and effect meshes (marker, fire, lamps, benches…).
import * as THREE from 'three';
import { C, PRIMS as P } from '../engine/stage.js';
import { Baked } from '../engine/baked.js';
import type { Rng } from '../engine/rng.js';

const G = () => new THREE.Group();

export const CANDY = [C.red, C.orange, C.yellow, C.lime, C.green, C.teal, C.blue, C.purple, C.pink, C.white];

// big unlit map-pin that hovers over objectives (always vivid, points down)
export function makeMarker(color: number = 0xffc93c): THREE.Group {
  const g = new THREE.Group();
  const m = new THREE.MeshBasicMaterial({ color });
  const head = new THREE.Mesh(new THREE.SphereGeometry(1.35, 20, 14), m);
  head.position.y = 2.05;
  const neck = new THREE.Mesh(new THREE.ConeGeometry(0.62, 1.5, 16), m);
  neck.rotation.x = Math.PI;
  neck.position.y = 0.55;
  const ring = new THREE.Mesh(
    new THREE.TorusGeometry(0.62, 0.22, 10, 20),
    new THREE.MeshBasicMaterial({ color: 0xfffdf8 }),
  );
  ring.rotation.x = Math.PI / 2;
  ring.position.y = 1.05;
  g.add(head);
  g.add(neck);
  g.add(ring);
  return g;
}

export function makeFenceRun(len = 4, color: number = C.white, r: Rng = Math.random): THREE.Mesh {
  const b = new Baked();
  const n = Math.max(2, Math.round(len / 0.9));
  for (let i = 0; i <= n; i++) b.box(0.09, 0.75, 0.09, color, -len / 2 + (i * len) / n, 0.38, 0);
  b.box(len, 0.07, 0.06, color, 0, 0.55, 0);
  b.box(len, 0.07, 0.06, color, 0, 0.28, 0);
  return b.build();
}

export function makeHedge(len = 3, r: Rng = Math.random): THREE.Mesh {
  const b = new Baked();
  const n = Math.max(2, Math.round(len / 0.55));
  for (let i = 0; i < n; i++) {
    const x = -len / 2 + (i + 0.5) * (len / n);
    b.sphere(0.34, C.leaf, x, 0.3, 0);
    b.sphere(0.26, C.leafLight, x + 0.1, 0.42, 0.06);
  }
  return b.build();
}

export function makeFlowerPatch(radius = 1.2, n = 14, r: Rng = Math.random): THREE.Mesh {
  const b = new Baked();
  for (let i = 0; i < n; i++) {
    const a = r() * Math.PI * 2, d = Math.sqrt(r()) * radius;
    const x = Math.cos(a) * d, z = Math.sin(a) * d;
    const petal = CANDY[(r() * CANDY.length) | 0];
    b.cyl(0.025, 0.03, 0.3, 5, C.leaf, x, 0.15, z);
    for (let k = 0; k < 4; k++) {
      const ka = (k / 4) * Math.PI * 2 + r();
      b.sphere(0.07, petal, x + Math.cos(ka) * 0.08, 0.33, z + Math.sin(ka) * 0.08);
    }
    b.sphere(0.055, C.yellow, x, 0.36, z);
  }
  return b.build();
}

export function makePlanter(color: number = C.teal): THREE.Mesh {
  const b = new Baked();
  b.box(0.8, 0.3, 0.34, color, 0, 0.15, 0);
  b.box(0.86, 0.08, 0.4, C.brownDark, 0, 0.05, 0);
  for (let i = 0; i < 3; i++) {
    const x = -0.22 + i * 0.22;
    b.cyl(0.02, 0.025, 0.22, 5, C.leaf, x, 0.4, 0);
    b.sphere(0.08, CANDY[i * 3 % CANDY.length], x, 0.55, 0);
  }
  return b.build();
}

export function makeStall(r: Rng = Math.random, canopy = [C.red, C.white] as number[]): THREE.Mesh {
  const b = new Baked();
  b.box(2.2, 0.9, 1, 0xc98d4e, 0, 0.45, 0);
  b.box(2.3, 0.08, 1.1, C.white, 0, 0.92, 0);
  for (const [px, pz] of [[-1.05, -0.45], [1.05, -0.45], [-1.05, 0.45], [1.05, 0.45]])
    b.cyl(0.05, 0.05, 2.2, 6, C.brownDark, px, 1.1, pz);
  const stripes = 6;
  for (let i = 0; i < stripes; i++)
    b.box(2.4 / stripes + 0.02, 0.06, 1.3, canopy[i % canopy.length],
      -1.2 + (i + 0.5) * (2.4 / stripes), 2.25, 0, -0.12);
  const fruits = [C.red, C.orange, C.lime];
  for (let c = 0; c < 3; c++) {
    const x = -0.7 + c * 0.7;
    b.box(0.5, 0.25, 0.4, 0xa06a3a, x, 1.08, 0);
    for (let k = 0; k < 6; k++)
      b.sphere(0.07, fruits[c], x - 0.15 + (k % 3) * 0.15, 1.24, k < 3 ? -0.1 : 0.1);
  }
  return b.build();
}

export function makeCafeSet(umbrellaColor: number = C.pink): THREE.Mesh {
  const b = new Baked();
  b.cyl(0.04, 0.04, 2.1, 6, C.white, 0, 1.05, 0);
  b.cone(1.15, 0.5, 8, umbrellaColor, 0, 2.1, 0);
  b.cyl(0.45, 0.45, 0.06, 12, C.white, 0, 0.72, 0);
  b.cyl(0.06, 0.06, 0.7, 6, C.white, 0, 0.35, 0);
  for (const a of [0.9, -0.9]) {
    const x = Math.cos(a) * 0.85, z = Math.sin(a) * 0.85;
    b.cyl(0.2, 0.2, 0.06, 10, C.blue, x, 0.45, z);
    b.cyl(0.05, 0.05, 0.45, 6, C.blue, x, 0.22, z);
  }
  b.sphere(0.07, C.red, 0.12, 0.8, 0.1);
  b.sphere(0.07, C.yellow, -0.1, 0.8, -0.08);
  return b.build();
}

export function makeBalloon(color: number = C.red): THREE.Group {
  const g = G();
  const env = P.sphere(0.55, color, 0, 1.55, 0);
  env.scale.y = 1.2;
  g.add(env);
  g.add(P.cyl(0.02, 0.02, 0.35, 5, 0x8a6a4a, 0, 0.85, 0));
  g.add(P.box(0.3, 0.22, 0.3, 0xa06a3a, 0, 0.55, 0));
  return g;
}

export function makeHotAirBalloon(color: number = C.purple, accent: number = C.yellow): THREE.Group {
  const g = G();
  const env = P.sphere(1.6, color, 0, 6.4, 0);
  env.scale.y = 1.15;
  g.add(env);
  g.add(P.cone(0.85, 1.1, 10, accent, 0, 4.95, 0));
  const band = P.torus(1.32, 0.12, accent, 0, 6.35, 0);
  band.rotation.x = Math.PI / 2;
  g.add(band);
  for (const [rx, rz] of [[-0.5, -0.5], [0.5, -0.5], [-0.5, 0.5], [0.5, 0.5]]) {
    g.add(P.cyl(0.03, 0.03, 1.5, 4, C.brownDark, rx * 0.7, 4.05, rz * 0.7));
  }
  g.add(P.box(1.1, 0.8, 1.1, 0xa06a3a, 0, 3.2, 0));
  g.add(P.box(1.2, 0.1, 1.2, C.brownDark, 0, 2.8, 0));
  return g;
}

export function makeSignPost(r: Rng = Math.random): THREE.Mesh {
  const b = new Baked();
  b.cyl(0.05, 0.06, 1.7, 6, C.brownDark, 0, 0.85, 0);
  b.box(0.85, 0.28, 0.06, C.teal, 0.12, 1.55, 0, 0, 0, -0.15);
  b.box(0.7, 0.26, 0.06, C.yellow, -0.05, 1.15, 0, 0, 0, 0.12);
  return b.build();
}

export function makeStreetBunting(width = 10, y = 4.2, colors = CANDY, r: Rng = Math.random): THREE.Group {
  const g = G();
  for (let i = 0; i <= 12; i++) {
    const f = i / 12;
    const x = -width / 2 + f * width;
    const yy = y - Math.sin(f * Math.PI) * 0.8;
    const flag = P.cone(0.22, 0.42, 3, colors[i % colors.length], x, yy - 0.2, 0);
    flag.rotation.x = Math.PI;
    flag.scale.z = 0.2;
    g.add(flag);
  }
  return g;
}

export function makeWaterTower(): THREE.Mesh {
  const b = new Baked();
  for (const [lx, lz] of [[-0.7, -0.7], [0.7, -0.7], [-0.7, 0.7], [0.7, 0.7]]) {
    b.cyl(0.08, 0.1, 3.2, 6, C.brownDark, lx, 1.6, lz);
    b.box(1.2, 0.12, 0.12, C.brownDark, lx * 0.5, 1, lz * 0.85, 0, lx > 0 ? 0.7 : -0.7, 0);
  }
  b.cyl(1.1, 1.1, 1.6, 14, C.teal, 0, 4.1, 0);
  b.torus(1.1, 0.07, C.white, 0, 3.45, 0, Math.PI / 2);
  b.torus(1.1, 0.07, C.white, 0, 4.75, 0, Math.PI / 2);
  b.cone(1.3, 0.7, 14, C.red, 0, 5.25, 0);
  return b.build();
}

export function makeBench(color: number = C.brown): THREE.Mesh {
  const b = new Baked();
  b.box(1.6, 0.08, 0.45, color, 0, 0.45, 0);
  b.box(1.6, 0.5, 0.07, color, 0, 0.7, -0.2, -0.15);
  for (const lx of [-0.65, 0.65]) b.box(0.09, 0.45, 0.4, C.brownDark, lx, 0.22, 0);
  return b.build();
}

export function makeStreetLamp(dir = 1): THREE.Mesh {
  const b = new Baked();
  b.cyl(0.08, 0.1, 3.2, 8, C.dark, 0, 1.6, 0);
  b.box(1, 0.1, 0.1, C.dark, 0.45 * dir, 3.2, 0);
  b.sphere(0.18, 0xfff6cf, 0.9 * dir, 3.1, 0);
  return b.build();
}

export function makeHydrant(): THREE.Mesh {
  const b = new Baked();
  b.cyl(0.17, 0.2, 0.55, 10, C.red, 0, 0.28, 0);
  b.sphere(0.17, C.red, 0, 0.58, 0);
  for (const x of [-0.19, 0.19]) b.cyl(0.07, 0.07, 0.1, 8, C.yellow, x, 0.38, 0, 0, 0, Math.PI / 2);
  return b.build();
}

// static decorative traffic light (the city game uses dynamic working ones)
export function makeTrafficLight(): THREE.Mesh {
  const b = new Baked();
  b.cyl(0.09, 0.11, 3.4, 8, C.dark, 0, 1.7, 0);
  b.box(0.5, 1.3, 0.4, C.dark, 0, 3.6, 0);
  b.sphere(0.14, 0xff3b30, 0, 4.0, 0.22);
  b.sphere(0.14, 0x8a6a10, 0, 3.6, 0.22);
  b.sphere(0.14, 0x1a6e28, 0, 3.2, 0.22);
  return b.build();
}

// burning bin: flames + smoke + scorch; flames are spread sideways so the hose
// must sweep left/right to reach them all. Returns refs for animation.
export interface FireResult {
  group: THREE.Group;
  flames: THREE.Mesh[];
  smoke: THREE.Mesh[];
}

export function makeFire(): FireResult {
  const g = G();
  const flames: THREE.Mesh[] = [];
  const flameDefs: Array<[number, number, number, number, number, number]> = [
    [C.fire1, 0.68, 1.6, 0, 0, 0], [C.fire2, 0.5, 1.15, 0.85, 0, 0.2],
    [C.fire3, 0.36, 0.8, -0.95, 0, 0.14], [C.fire2, 0.42, 0.95, 1.55, 0, -0.38],
    [C.fire3, 0.3, 0.7, -1.6, 0, -0.1],
  ];
  for (const [col, rad, hh, x, y, z] of flameDefs) {
    const f = new THREE.Mesh(
      new THREE.ConeGeometry(rad, hh, 8),
      new THREE.MeshLambertMaterial({ color: col, emissive: col, emissiveIntensity: 0.55, flatShading: true }));
    f.position.set(x, hh / 2, z);
    f.castShadow = true;
    g.add(f);
    flames.push(f);
  }
  const bin = new THREE.Mesh(
    new THREE.CylinderGeometry(0.32, 0.28, 0.55, 10),
    new THREE.MeshLambertMaterial({ color: 0x5a6472, flatShading: true }));
  bin.position.set(0.55, 0.28, 0.1);
  bin.castShadow = true;
  g.add(bin);
  const scorch = new THREE.Mesh(
    new THREE.CircleGeometry(0.95, 18),
    new THREE.MeshLambertMaterial({ color: 0x4a4a55 }));
  scorch.rotation.x = -Math.PI / 2;
  scorch.position.y = 0.02;
  g.add(scorch);
  const smoke: THREE.Mesh[] = [];
  for (let i = 0; i < 3; i++) {
    const s = new THREE.Mesh(
      new THREE.SphereGeometry(0.3 + i * 0.08, 10, 8),
      new THREE.MeshLambertMaterial({ color: C.smoke, transparent: true, opacity: 0.4, flatShading: true }));
    s.position.set(0.1 * i, 1.2 + i * 0.7, 0);
    g.add(s);
    smoke.push(s);
  }
  return { group: g, flames, smoke };
}
