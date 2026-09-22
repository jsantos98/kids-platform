// Animals and small living things: cow, sheep, duck, the rescue cat.
import * as THREE from 'three';
import { C, PRIMS as P } from '../engine/stage.js';
import type { Rng } from '../engine/rng.js';

const G = () => new THREE.Group();

export function makeCow(): THREE.Group {
  const g = G();
  g.add(P.rbox(0.9, 0.55, 1.5, 0.12, C.white, 0, 0.85, 0));
  for (const [px, pz] of [[-0.2, 0.4], [0.25, -0.1], [-0.1, -0.45], [0.15, 0.15]])
    g.add(P.box(0.3, 0.28, 0.02, C.dark, 0.46, 0.9 + px * 0.2, pz));
  g.add(P.rbox(0.42, 0.42, 0.45, 0.1, C.white, 0, 1.15, 0.95));
  g.add(P.box(0.3, 0.16, 0.1, C.pink, 0, 1.05, 1.2));
  for (const ex of [-0.16, 0.16]) g.add(P.sphere(0.05, C.dark, ex, 1.28, 1.12));
  for (const lx of [-0.28, 0.28]) for (const lz of [-0.5, 0.5])
    g.add(P.box(0.16, 0.6, 0.16, C.white, lx, 0.3, lz));
  for (const hx of [-0.18, 0.18]) g.add(P.cyl(0.04, 0.06, 0.2, 5, C.yellow, hx, 1.42, 0.88));
  return g;
}

export function makeSheep(): THREE.Group {
  const g = G();
  g.add(P.sphere(0.42, 0xf5efe0, 0, 0.62, 0));
  g.add(P.sphere(0.3, 0xf5efe0, 0.28, 0.52, 0.1));
  g.add(P.sphere(0.28, 0xf5efe0, -0.26, 0.55, -0.08));
  g.add(P.rbox(0.24, 0.3, 0.28, 0.08, 0x4a4a55, 0, 0.72, 0.42));
  for (const lx of [-0.16, 0.16]) for (const lz of [-0.18, 0.18])
    g.add(P.box(0.1, 0.34, 0.1, 0x4a4a55, lx, 0.17, lz));
  return g;
}

export function makeDuck(): THREE.Group {
  const g = G();
  g.add(P.sphere(0.16, C.white, 0, 0.14, 0));
  g.add(P.sphere(0.1, C.white, 0, 0.3, 0.1));
  const beak = P.cone(0.05, 0.12, 6, C.orange, 0, 0.29, 0.22);
  beak.rotation.x = Math.PI / 2;
  g.add(beak);
  return g;
}

// cat tree: the 🐱 rescue objective — cat sits on a branch, userData.cat holds it
export function makeCatTree(r: Rng = Math.random): THREE.Group {
  const g = G();
  g.add(P.cyl(0.16, 0.24, 2.6, 8, C.brown, 0, 1.3, 0));
  const branch = P.box(1.1, 0.13, 0.13, C.brown, 0.5, 1.75, 0);
  branch.rotation.z = 0.12;
  g.add(branch);
  g.add(P.sphere(1.05, C.leaf, 0, 3.3, 0));
  g.add(P.sphere(0.7, C.leafLight, 0.7, 2.9, 0.2));
  const cat = G();
  cat.add(P.box(0.28, 0.24, 0.5, 0xff9f43, 0, 0.14, 0));
  cat.add(P.sphere(0.15, 0xff9f43, 0, 0.32, 0.22));
  for (const ex of [-0.08, 0.08]) cat.add(P.cone(0.05, 0.1, 4, 0xff9f43, ex, 0.48, 0.22));
  const tail = P.cyl(0.04, 0.03, 0.45, 6, 0xff9f43, 0, 0.25, -0.3);
  tail.rotation.x = 0.9;
  cat.add(tail);
  cat.add(P.box(0.3, 0.05, 0.3, 0xe0821f, 0, 0.24, 0));
  cat.position.set(0.92, 1.85, 0);
  g.userData.cat = cat;
  g.add(cat);
  return g;
}

// little sailing boat for lakes and rivers
export function makeSailboat(hull: number = C.red, sail: number = C.white): THREE.Group {
  const g = G();
  g.add(P.rbox(0.6, 0.35, 1.7, 0.1, hull, 0, 0.18, 0));
  const prow = P.cone(0.3, 0.5, 4, hull, 0, 0.18, 1.05);
  prow.rotation.x = -Math.PI / 2;
  g.add(prow);
  g.add(P.cyl(0.03, 0.03, 1.5, 6, C.brownDark, 0, 1, 0));
  const s1 = P.box(0.04, 1.2, 0.7, sail, 0.02, 1.35, -0.32);
  s1.rotation.y = 0.15;
  g.add(s1);
  const s2 = P.box(0.04, 0.9, 0.5, C.cream, -0.02, 1.2, 0.3);
  s2.rotation.y = -0.12;
  g.add(s2);
  return g;
}
