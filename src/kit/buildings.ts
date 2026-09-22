// Buildings: gable-roof houses and shops.
import * as THREE from 'three';
import { C, mat, PRIMS as P } from '../engine/stage.js';

const G = () => new THREE.Group();

// Ridge runs along X. w = length (X), d = depth (Z), rh = ridge height above walls.
export function gableRoof(
  w: number, rh: number, d: number, color: number,
  x = 0, y = 0, z = 0, overhang = 1.15,
): THREE.Mesh {
  const geo = new THREE.CylinderGeometry(1, 1, 1, 3, 1, false, Math.PI / 2);
  const m = new THREE.Mesh(geo, mat(color));
  // after rotation.z = PI/2: local X -> world Y (height), local Y -> world X (ridge), Z stays depth
  m.scale.set(rh, w * overhang, d * 0.5774 * overhang);
  m.rotation.z = Math.PI / 2;
  m.position.set(x, y + rh / 2, z);
  m.castShadow = true;
  m.receiveShadow = true;
  return m;
}

export function makeHouse(
  { w = 3.6, d = 3.6, h = 2.6, body = C.pink, roof = C.purple, door = C.white, windows = 2, chimney = false }:
  { w?: number; d?: number; h?: number; body?: number; roof?: number; door?: number; windows?: number; chimney?: boolean } = {},
): THREE.Group {
  const g = G();
  g.add(P.box(w, h, d, body, 0, h / 2, 0));
  g.add(gableRoof(w, Math.min(w, d) * 0.45, d, roof, 0, h, 0));
  g.add(P.box(0.72, 1.25, 0.08, door, 0, 0.62, d / 2 + 0.02)); // door (+Z face)
  g.add(P.sphere(0.05, C.yellow, 0.24, 0.66, d / 2 + 0.07));
  for (let i = 0; i < windows; i++) { // windows (+Z face)
    const x = windows === 1 ? 0 : (i - (windows - 1) / 2) * (w * 0.42);
    if (Math.abs(x) < 0.75) continue;
    g.add(P.box(0.6, 0.6, 0.06, C.glass, x, h * 0.62, d / 2 + 0.02));
    for (const sx of [-0.42, 0.42]) // shutters
      g.add(P.box(0.18, 0.72, 0.05, roof, x + sx, h * 0.62, d / 2 + 0.03));
    g.add(P.box(0.72, 0.09, 0.1, C.white, x, h * 0.62 - 0.36, d / 2 + 0.02));
    g.add(P.box(0.66, 0.12, 0.15, C.brown, x, h * 0.62 - 0.46, d / 2 + 0.08)); // flower box
    for (const fx of [-0.2, 0, 0.2])
      g.add(P.sphere(0.07, C.pink, x + fx, h * 0.62 - 0.36, d / 2 + 0.08));
  }
  if (chimney) g.add(P.box(0.34, 0.7, 0.34, C.brownDark, w * 0.28, h + 0.45, 0));
  return g;
}

export function makeShop(
  { w = 4, d = 3.6, h = 3, body = C.teal, roof = C.white, awning = [C.red, C.white] as number[] }:
  { w?: number; d?: number; h?: number; body?: number; roof?: number; awning?: number[] } = {},
): THREE.Group {
  const g = G();
  g.add(P.box(w, h, d, body, 0, h / 2, 0));
  g.add(P.box(w + 0.3, 0.25, d + 0.3, roof, 0, h + 0.1, 0));
  g.add(P.box(w * 0.62, 1.1, 0.08, C.glass, -w * 0.14, 1.35, d / 2 + 0.02)); // shop window
  g.add(P.box(0.72, 1.35, 0.08, C.white, w * 0.32, 0.68, d / 2 + 0.02));     // door
  const stripes = 6;
  for (let i = 0; i < stripes; i++) {
    const s = P.box(w * 0.8 / stripes + 0.02, 0.06, 0.9, awning[i % awning.length],
      -w * 0.4 + (i + 0.5) * (w * 0.8 / stripes), 2.1, d / 2 + 0.4);
    s.rotation.x = 0.35;
    g.add(s);
  }
  return g;
}
