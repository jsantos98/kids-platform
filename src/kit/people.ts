// People: natural-proportion villagers.
import * as THREE from 'three';
import { C, PRIMS as P } from '../engine/stage.js';
import type { Rng } from '../engine/rng.js';

const CANDY = [C.red, C.orange, C.yellow, C.lime, C.green, C.teal, C.blue, C.purple, C.pink, C.white];

export function makePerson(
  { shirt = 0x7fb2d9, pants = 0x5a6472, skin = C.skin, cap = null as number | null } = {},
): THREE.Group {
  const g = new THREE.Group();
  g.add(P.box(0.15, 0.5, 0.17, pants, -0.09, 0.25, 0));
  g.add(P.box(0.15, 0.5, 0.17, pants, 0.09, 0.25, 0));
  g.add(P.rbox(0.4, 0.58, 0.24, 0.08, shirt, 0, 0.79, 0));
  g.add(P.rbox(0.11, 0.48, 0.15, 0.04, shirt, -0.26, 0.81, 0));
  g.add(P.rbox(0.11, 0.48, 0.15, 0.04, shirt, 0.26, 0.81, 0));
  g.add(P.sphere(0.14, skin, 0, 1.24, 0));
  g.add(P.box(0.2, 0.12, 0.22, skin, 0, 1.16, 0)); // neck/shoulders filler
  const eye = { color: 0x222222, emissive: 0x000000 };
  g.add(P.sphere(0.025, 0x222222, -0.05, 1.27, 0.13, eye));
  g.add(P.sphere(0.025, 0x222222, 0.05, 1.27, 0.13, eye));
  if (cap) {
    g.add(P.cyl(0.15, 0.16, 0.09, 10, cap, 0, 1.34, 0));
    g.add(P.box(0.17, 0.03, 0.16, cap, 0, 1.31, 0.18));
  }
  return g;
}

export function makeVillager(r: Rng = Math.random): THREE.Group {
  const shirts = CANDY.filter(c => c !== C.white);
  const pants = [C.blue, C.dark, C.purple, C.brownDark, 0x5a6472];
  return makePerson({
    shirt: shirts[(r() * shirts.length) | 0],
    pants: pants[(r() * pants.length) | 0],
    cap: r() > 0.6 ? CANDY[(r() * CANDY.length) | 0] : null,
  });
}
