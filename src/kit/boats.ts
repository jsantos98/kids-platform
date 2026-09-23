// Boats: procedural chunky kit for the island sea (pastel, Make-Way style).
// Convention: every boat faces +Z and sits with its hull at the y=0 waterline.
import * as THREE from 'three';
import { C, PRIMS as P, mat } from '../engine/stage.js';

const G = () => new THREE.Group();

// flat triangular panel (sails, flags) standing in the Y-Z plane at x=0.
// Both windings are added because boats get baked into single-sided meshes.
function tri(a: [number, number, number], b: [number, number, number], c: [number, number, number],
             color: number): THREE.Mesh {
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute([...a, ...b, ...c, ...a, ...c, ...b], 3));
  geo.computeVertexNormals();
  const m = new THREE.Mesh(geo, mat(color));
  m.castShadow = true;
  return m;
}

// chunky pointed bow: a 4-sided cone tipped forward and squashed flat
function bow(r: number, len: number, color: number, x: number, y: number, z: number): THREE.Mesh {
  const b = P.cone(r, len, 4, color, x, y, z, Math.PI / 2, Math.PI / 4, 0);
  b.scale.set(1, 1, 0.62); // local z maps to world -y after the x-rotation: lower the profile
  return b;
}

export function makeSailboat({ hull = C.red, sail = C.white }:
  { hull?: number; sail?: number } = {}): THREE.Group {
  const g = G();
  g.add(P.rbox(1.7, 0.7, 4.4, 0.18, hull, 0, 0.35, -0.3));
  g.add(bow(0.85, 1.5, hull, 0, 0.35, 1.9));
  g.add(P.box(1.74, 0.12, 3.9, C.cream, 0, 0.74, -0.35));       // deck
  g.add(P.rbox(1.1, 0.5, 1.2, 0.08, C.cream, 0, 1.0, -1.5));    // stern bench/cabin
  // mast + boom
  g.add(P.cyl(0.06, 0.09, 4.0, 8, C.brownDark, 0, 2.7, 0.5));
  const boom = P.cyl(0.045, 0.045, 2.4, 6, C.brownDark, 0, 1.05, -0.65);
  boom.rotation.x = Math.PI / 2;
  g.add(boom);
  // main sail (aft of the mast) + jib (forward) + pennant
  g.add(tri([0, 4.5, 0.5], [0, 1.05, 0.5], [0, 1.05, -1.85], sail));
  g.add(tri([0, 4.2, 0.55], [0, 1.05, 0.6], [0, 1.05, 2.15], sail));
  g.add(tri([0, 4.75, 0.5], [0, 4.45, 0.5], [0, 4.6, -0.45], C.red));
  return g;
}

export function makeTugboat({ hull = C.blue, trim = C.red }:
  { hull?: number; trim?: number } = {}): THREE.Group {
  const g = G();
  g.add(P.rbox(2.0, 0.9, 4.0, 0.2, hull, 0, 0.42, -0.3));
  g.add(bow(1.0, 1.6, hull, 0, 0.42, 1.75));
  g.add(P.box(2.04, 0.24, 3.5, C.white, 0, 0.92, -0.35));       // bulwark band
  g.add(P.box(1.7, 0.06, 3.2, C.cream, 0, 0.82, -0.35));        // deck
  // wheelhouse with windows and a trim roof
  g.add(P.rbox(1.5, 1.05, 1.5, 0.1, C.cream, 0, 1.55, -0.9));
  g.add(P.box(1.56, 0.14, 1.56, trim, 0, 2.12, -0.9));
  for (const sz of [-0.25, 0.45]) {
    g.add(P.box(1.2, 0.42, 0.06, C.glass, 0, 1.66, -0.9 + sz * 0.72));
  }
  for (const sx of [-0.76, 0.76]) g.add(P.box(0.06, 0.42, 0.9, C.glass, sx, 1.66, -0.95));
  // stubby funnel with a dark cap + mast light
  g.add(P.cyl(0.26, 0.32, 0.8, 10, trim, 0, 2.55, -1.6));
  g.add(P.cyl(0.28, 0.26, 0.12, 10, C.dark, 0, 2.98, -1.6));
  g.add(P.cyl(0.05, 0.05, 0.9, 6, C.silver, 0, 2.6, 0.4));
  g.add(P.sphere(0.1, C.yellow, 0, 3.05, 0.4));
  // lifebuoy on the side
  const ring = P.torus(0.26, 0.09, C.orange, 1.05, 1.3, 0.35, 0, Math.PI / 2, 0);
  g.add(ring);
  return g;
}

export function makeRowboat({ hull = C.teal }: { hull?: number } = {}): THREE.Group {
  const g = G();
  g.add(P.rbox(1.3, 0.55, 2.6, 0.15, hull, 0, 0.28, -0.2));
  g.add(bow(0.65, 1.0, hull, 0, 0.28, 1.25));
  g.add(P.box(1.02, 0.06, 2.0, C.cream, 0, 0.52, -0.25));       // floor boards
  g.add(P.box(1.14, 0.09, 0.3, C.brown, 0, 0.62, 0.25));        // bench
  g.add(P.box(1.14, 0.09, 0.3, C.brown, 0, 0.62, -1.0));
  // oars laid across the gunwales
  for (const sx of [-0.72, 0.72]) {
    const oar = P.cyl(0.04, 0.05, 1.6, 6, C.brown, sx, 0.62, -0.3);
    oar.rotation.z = Math.PI / 2;
    oar.rotation.y = sx * 0.25;
    g.add(oar);
  }
  return g;
}

export const BOATS = { makeSailboat, makeTugboat, makeRowboat };
