// Nature models: trees, bushes, flowers, clouds.
import * as THREE from 'three';
import { C, PRIMS as P } from '../engine/stage.js';
import type { Rng } from '../engine/rng.js';

const G = () => new THREE.Group();

export function makeTree(r: Rng = Math.random, scale = 1): THREE.Group {
  const g = G();
  g.add(P.cyl(0.14, 0.2, 0.9, 8, C.brown, 0, 0.45, 0));
  const greens = [C.leaf, C.leafLight, 0xbcd9a0];
  const c = greens[(r() * greens.length) | 0];
  g.add(P.sphere(0.75, c, 0, 1.35, 0));
  g.add(P.sphere(0.55, c, 0.42, 1.05, 0.12));
  g.add(P.sphere(0.5, c, -0.4, 1.1, -0.1));
  g.add(P.sphere(0.45, c, 0.05, 1.8, -0.05));
  g.scale.setScalar(scale * (0.85 + r() * 0.4));
  g.rotation.y = r() * Math.PI * 2;
  return g;
}

export function makeBush(r: Rng = Math.random): THREE.Group {
  const g = G();
  g.add(P.sphere(0.45, C.leafLight, 0, 0.3, 0));
  g.add(P.sphere(0.32, C.leaf, 0.35, 0.2, 0.1));
  g.add(P.sphere(0.3, C.leaf, -0.3, 0.22, -0.08));
  g.scale.setScalar(0.8 + r() * 0.5);
  return g;
}

export function makeFlower(r: Rng = Math.random): THREE.Group {
  const g = G();
  const petals = [C.pink, C.yellow, C.purple, C.white, C.orange][(r() * 5) | 0];
  g.add(P.cyl(0.02, 0.03, 0.3, 5, C.leaf, 0, 0.15, 0));
  for (let i = 0; i < 5; i++) {
    const a = (i / 5) * Math.PI * 2;
    g.add(P.sphere(0.07, petals, Math.cos(a) * 0.09, 0.34, Math.sin(a) * 0.09));
  }
  g.add(P.sphere(0.06, C.yellow, 0, 0.36, 0));
  return g;
}

export function makeCloud(r: Rng = Math.random, scale = 1): THREE.Group {
  const g = G();
  const white = { emissive: 0x555555 };
  const n = 4 + ((r() * 3) | 0);
  for (let i = 0; i < n; i++) {
    const s = P.sphere(0.7 + r() * 0.8, C.white, (i - n / 2) * 0.9 + r() * 0.4, r() * 0.35, (r() - 0.5) * 1.2, white);
    s.scale.y = 0.6;
    s.castShadow = false;
    s.receiveShadow = false;
    g.add(s);
  }
  g.scale.setScalar(scale * (0.9 + r() * 0.8));
  return g;
}

export function makeConifer(r: Rng = Math.random, scale = 1): THREE.Group {
  const g = G();
  g.add(P.cyl(0.12, 0.16, 0.5, 7, C.brown, 0, 0.25, 0));
  g.add(P.cone(0.7, 0.9, 8, C.leaf, 0, 0.95, 0));
  g.add(P.cone(0.55, 0.8, 8, C.leafLight, 0, 1.5, 0));
  g.add(P.cone(0.38, 0.7, 8, C.leaf, 0, 2.05, 0));
  g.scale.setScalar(scale * (0.8 + r() * 0.5));
  g.rotation.y = r() * Math.PI * 2;
  return g;
}
