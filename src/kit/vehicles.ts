// Vehicles: procedural chunky kit (fallbacks + diorama-only models).
// Convention: every vehicle faces +Z.
import * as THREE from 'three';
import { C, PRIMS as P } from '../engine/stage.js';

const G = () => new THREE.Group();

function wheel(r: number, w: number, x: number, y: number, z: number): THREE.Group {
  const g = G();
  const tire = P.cyl(r, r, w, 12, C.tire, 0, 0, 0);
  tire.rotation.z = Math.PI / 2;
  g.add(tire);
  const hub = P.cyl(r * 0.45, r * 0.45, w + 0.02, 10, C.white, 0, 0, 0);
  hub.rotation.z = Math.PI / 2;
  g.add(hub);
  g.position.set(x, y, z);
  return g;
}

// friendly pastel car colors
export const CAR_COLORS = [0xfaf7ef, 0xd9dde2, 0x8f97a3, 0x5a6472, 0x7fb2d9, 0xe25c5c, 0x9cc76a, 0xf6c952];

export function makeCar({ body = 0xd9dde2 } = {}): THREE.Group {
  const g = G();
  const dark = 0x3c424c;
  // lower body slab
  g.add(P.rbox(1.78, 0.5, 4.4, 0.1, body, 0, 0.6, 0));
  // cabin with roof
  g.add(P.rbox(1.62, 0.48, 2.3, 0.12, body, 0, 1.06, -0.2));
  g.add(P.rbox(1.52, 0.1, 1.6, 0.06, body, 0, 1.32, -0.2));
  // windshield + rear window (slanted)
  const ws = P.box(1.5, 0.62, 0.07, C.glass, 0, 1.05, 0.93);
  ws.rotation.x = -0.42;
  g.add(ws);
  const rw = P.box(1.5, 0.55, 0.07, C.glass, 0, 1.05, -1.32);
  rw.rotation.x = 0.45;
  g.add(rw);
  // side windows (dark band)
  for (const sx of [-0.82, 0.82]) {
    g.add(P.box(0.03, 0.36, 1.85, 0x3e4550, sx, 1.04, -0.25));
  }
  // hood slope + trunk
  g.add(P.box(1.7, 0.08, 1.0, body, 0, 0.88, 1.68));
  // bumpers
  g.add(P.rbox(1.82, 0.22, 0.24, 0.06, dark, 0, 0.42, 2.24));
  g.add(P.rbox(1.82, 0.22, 0.24, 0.06, dark, 0, 0.42, -2.24));
  // grill + lights
  g.add(P.box(0.7, 0.16, 0.06, dark, 0, 0.62, 2.21));
  const lamp = { emissive: 0xfff6d8 };
  g.add(P.rbox(0.3, 0.12, 0.08, 0.03, 0xfff6d8, -0.62, 0.66, 2.2, lamp));
  g.add(P.rbox(0.3, 0.12, 0.08, 0.03, 0xfff6d8, 0.62, 0.66, 2.2, lamp));
  const tail = { emissive: 0xb01818 };
  g.add(P.rbox(0.34, 0.12, 0.07, 0.03, 0xb01818, -0.6, 0.7, -2.21, tail));
  g.add(P.rbox(0.34, 0.12, 0.07, 0.03, 0xb01818, 0.6, 0.7, -2.21, tail));
  // mirrors
  for (const sx of [-0.95, 0.95]) g.add(P.rbox(0.16, 0.1, 0.07, 0.02, body, sx, 1.06, 0.72));
  g.add(wheel(0.32, 0.22, -0.8, 0.32, 1.42));
  g.add(wheel(0.32, 0.22, 0.8, 0.32, 1.42));
  g.add(wheel(0.32, 0.22, -0.8, 0.32, -1.42));
  g.add(wheel(0.32, 0.22, 0.8, 0.32, -1.42));
  return g;
}

export function makeFireTruck(): THREE.Group {
  const g = G();
  const red = C.red, white = C.white, dark = 0x3c424c, panel = 0xc24747, seam = 0xa83c3c;
  // chassis
  g.add(P.box(2.05, 0.42, 7.0, dark, 0, 0.52, 0));
  // cab
  g.add(P.rbox(2.3, 1.35, 2.0, 0.1, red, 0, 1.7, 2.35));
  g.add(P.rbox(2.3, 0.3, 2.1, 0.08, red, 0, 0.85, 2.35));
  // windshield (slanted) + side windows + mirrors
  const ws = P.box(2.05, 0.72, 0.08, C.glass, 0, 2.18, 3.38);
  ws.rotation.x = -0.16;
  g.add(ws);
  for (const sx of [-1.17, 1.17]) g.add(P.box(0.05, 0.6, 1.1, C.glass, sx, 2.05, 2.35));
  for (const sx of [-1.22, 1.22]) g.add(P.rbox(0.1, 0.14, 0.2, 0.02, dark, sx, 2.05, 3.1));
  // lightbar on the cab roof (red + blue, animated)
  g.add(P.box(1.9, 0.1, 0.32, dark, 0, 2.48, 2.5));
  const beacons: THREE.Mesh[] = [];
  for (let i = 0; i < 4; i++) {
    const isRed = i % 2 === 0;
    const m = new THREE.Mesh(
      new THREE.BoxGeometry(0.4, 0.16, 0.26),
      new THREE.MeshLambertMaterial({
        color: isRed ? 0xd42a2a : 0x2a52d4,
        emissive: isRed ? 0xd42a2a : 0x2a52d4,
        emissiveIntensity: 1.2,
      }));
    m.position.set(-0.66 + i * 0.44, 2.6, 2.5);
    g.add(m);
    beacons.push(m);
  }
  g.userData.beacons = beacons;
  // front: bumper, grill, headlights
  g.add(P.rbox(2.34, 0.4, 0.28, 0.06, C.silver, 0, 0.62, 3.42));
  g.add(P.box(0.8, 0.28, 0.07, dark, 0, 1.05, 3.4));
  const lamp = { emissive: 0xfff6d8 };
  g.add(P.rbox(0.4, 0.18, 0.1, 0.03, 0xfff6d8, -0.78, 1.15, 3.38, lamp));
  g.add(P.rbox(0.4, 0.18, 0.1, 0.03, 0xfff6d8, 0.78, 1.15, 3.38, lamp));
  // body behind the cab
  g.add(P.rbox(2.34, 1.55, 4.7, 0.08, red, 0, 1.85, -0.95));
  g.add(P.box(2.36, 0.14, 4.74, white, 0, 1.12, -0.95)); // white lower band
  // hose bed on the rear top
  g.add(P.box(2.0, 0.42, 1.7, 0xb04141, 0, 2.75, -1.85));
  for (const hx of [-0.45, 0.45]) {
    g.add(P.cyl(0.34, 0.34, 0.3, 12, white, hx, 2.95, -1.85));
  }
  // roof: water monitor + equipment boxes on the front top
  g.add(P.cyl(0.1, 0.14, 0.4, 8, C.silver, 0, 2.85, -0.1));
  g.add(P.box(0.8, 0.28, 0.9, C.redDeep, 0, 2.72, -0.35));
  // side lockers (roll-up doors) + pump panel near the cab
  for (const sx of [-1.18, 1.18]) {
    for (let i = 0; i < 4; i++) {
      g.add(P.box(0.03, 0.95, 0.82, panel, sx, 1.6, -0.2 + i * 0.98));
      for (let s2 = 1; s2 < 4; s2++) {
        g.add(P.box(0.035, 0.9, 0.02, seam, sx, 1.6, 0.17 + i * 0.98 - s2 * 0.2));
      }
    }
    // pump panel with gauges and valves
    const pumpX = sx * 1.19;
    g.add(P.box(0.06, 1.15, 0.85, 0xb04141, pumpX, 1.7, 1.75));
    for (let gi = 0; gi < 3; gi++) {
      const gauge = P.cyl(0.09, 0.09, 0.03, 10, C.silver, pumpX + sx * 0.04, 2.05, 1.5 + gi * 0.24);
      gauge.rotation.z = Math.PI / 2;
      g.add(gauge);
    }
    const valve = P.torus(0.11, 0.035, C.yellow, pumpX + sx * 0.06, 1.5, 1.7, 0, Math.PI / 2);
    g.add(valve);
  }
  // rear: step + lights
  g.add(P.rbox(2.1, 0.3, 0.3, 0.05, C.silver, 0, 0.55, -3.42));
  const tail = { emissive: 0xb01818 };
  g.add(P.rbox(0.36, 0.16, 0.08, 0.03, 0xb01818, -0.72, 1.05, -3.44, tail));
  g.add(P.rbox(0.36, 0.16, 0.08, 0.03, 0xb01818, 0.72, 1.05, -3.44, tail));
  // extension ladder on a roof rack
  const lad = G();
  lad.add(P.box(0.1, 0.09, 3.2, C.silver, -0.32, 0, 0));
  lad.add(P.box(0.1, 0.09, 3.2, C.silver, 0.32, 0, 0));
  for (let i = 0; i < 8; i++) lad.add(P.box(0.68, 0.05, 0.07, C.silver, 0, 0, -1.45 + i * 0.42));
  const rack = P.box(1.6, 0.16, 2.9, 0xa83c3c, 0, -0.18, 0);
  lad.add(rack);
  lad.position.set(0, 2.78, -0.75);
  g.add(lad);
  // wheels: single front axle, dual rear axles
  g.add(wheel(0.48, 0.3, -1.06, 0.48, 2.55));
  g.add(wheel(0.48, 0.3, 1.06, 0.48, 2.55));
  for (const z of [-1.55, -2.55]) {
    g.add(wheel(0.48, 0.3, -0.94, 0.48, z));
    g.add(wheel(0.48, 0.3, 0.94, 0.48, z));
    g.add(wheel(0.48, 0.26, -0.66, 0.48, z));
    g.add(wheel(0.48, 0.26, 0.66, 0.48, z));
  }
  return g;
}

export function makeHelicopter(): THREE.Group {
  const g = G();
  const red = C.red, white = C.white;
  g.add(P.rbox(1.5, 1.5, 3.3, 0.42, white, 0, 1.62, 0.35));
  g.add(P.rbox(1.3, 1.0, 1.1, 0.3, white, 0, 1.5, 1.95));
  g.add(P.rbox(1.54, 0.35, 3.34, 0.16, red, 0, 1.08, 0.35)); // red belly band
  const ws = P.box(1.28, 0.85, 0.09, C.glass, 0, 1.98, 2.28);
  ws.rotation.x = -0.5;
  g.add(ws);
  const chin = P.sphere(0.55, C.glass, 0, 1.55, 2.42);
  chin.scale.set(0.85, 0.6, 0.9);
  g.add(chin);
  for (const sx of [-0.77, 0.77]) {
    g.add(P.box(0.04, 0.6, 1.15, C.glass, sx, 1.85, 0.75));
    g.add(P.box(0.05, 0.06, 1.25, red, sx, 1.5, 0.75));
  }
  const boom = P.cyl(0.13, 0.3, 2.7, 10, white, 0, 1.8, -2.9);
  boom.rotation.x = Math.PI / 2;
  g.add(boom);
  g.add(P.rbox(0.12, 1.15, 0.65, 0.08, red, 0, 2.45, -4.05));
  g.add(P.box(0.1, 0.09, 1.15, white, 0, 1.95, -3.7));
  const tr = G();
  tr.add(P.cyl(0.05, 0.05, 0.16, 8, 0x5a6472, 0, 0, 0, 0, 0, Math.PI / 2));
  tr.add(P.box(0.05, 1.05, 0.07, 0x5a6472, 0, 0.4, 0.08));
  tr.add(P.box(0.05, 1.05, 0.07, 0x5a6472, 0, -0.4, -0.08));
  tr.position.set(0.14, 2.45, -4.02);
  g.add(tr);
  g.userData.tailRotor = tr;
  const mr = G();
  mr.add(P.cyl(0.09, 0.11, 0.34, 8, 0x5a6472, 0, 0, 0));
  mr.add(P.cyl(0.22, 0.22, 0.1, 10, 0x5a6472, 0, -0.16, 0));
  for (let i = 0; i < 4; i++) {
    const blade = P.box(0.24, 0.04, 2.6, 0x5a6472, Math.sin(i * Math.PI / 2) * 1.35, 0.18, Math.cos(i * Math.PI / 2) * 1.35);
    blade.rotation.y = i * Math.PI / 2;
    mr.add(blade);
  }
  mr.position.set(0, 2.62, 0.15);
  g.add(mr);
  g.userData.mainRotor = mr;
  for (const x of [-0.62, 0.62]) {
    const skid = P.cyl(0.06, 0.06, 2.9, 8, C.silver, x, 0.48, 0.3);
    skid.rotation.x = Math.PI / 2;
    g.add(skid);
    for (const sz of [0.85, -0.35]) {
      const strut = P.cyl(0.05, 0.05, 0.85, 8, C.silver, x, 0.95, sz);
      strut.rotation.x = 0.25 * Math.sign(sz);
      g.add(strut);
    }
  }
  for (const x of [-0.81, 0.81]) {
    const d = P.cyl(0.3, 0.3, 0.05, 16, white, x, 1.62, -0.35);
    d.rotation.z = Math.PI / 2;
    g.add(d);
    g.add(P.box(0.07, 0.36, 0.14, red, x, 1.62, -0.35));
    g.add(P.box(0.07, 0.14, 0.36, red, x, 1.62, -0.35));
  }
  g.add(P.cyl(0.12, 0.14, 0.14, 10, 0x5a6472, 0, 1.02, 2.3));
  return g;
}

export function makeTrainLoco(
  { body = 0xd9534f, roof = 0x5a6472, skirt = 0xb8bec6 }:
  { body?: number; roof?: number; skirt?: number } = {},
): THREE.Group {
  const g = G();
  g.add(P.rbox(1.7, 1.6, 5.6, 0.12, body, 0, 1.62, 0));
  g.add(P.rbox(1.74, 0.3, 5.64, 0.08, skirt, 0, 0.68, 0));
  g.add(P.box(1.76, 0.12, 5.66, roof, 0, 2.44, 0));
  for (const fz of [-1.4, 0.6]) g.add(P.box(1.0, 0.1, 0.9, 0x5a6472, 0, 2.55, fz));
  g.add(P.cyl(0.05, 0.05, 0.5, 6, C.dark, -0.5, 2.7, 1.6, 0.5, 0, -0.4));
  g.add(P.rbox(1.3, 0.55, 0.07, 0.03, C.glass, 0, 2.25, 2.72));
  g.add(P.rbox(1.3, 0.55, 0.07, 0.03, C.glass, 0, 2.25, -2.72));
  for (const sx of [-0.87, 0.87]) {
    g.add(P.box(0.04, 0.45, 0.7, C.glass, sx, 2.15, 2.0));
    g.add(P.box(0.04, 0.45, 0.7, C.glass, sx, 2.15, -2.0));
    for (const gz of [0.2, -0.9, -2.0]) g.add(P.box(0.04, 0.75, 0.85, 0x5a6472, sx, 1.35, gz));
  }
  const lamp = { emissive: 0xfff6d8 };
  g.add(P.rbox(0.26, 0.18, 0.08, 0.03, 0xfff6d8, -0.5, 1.35, 2.84, lamp));
  g.add(P.rbox(0.26, 0.18, 0.08, 0.03, 0xfff6d8, 0.5, 1.35, 2.84, lamp));
  g.add(P.rbox(0.18, 0.12, 0.07, 0.03, 0xb01818, -0.5, 1.85, 2.85));
  g.add(P.rbox(0.18, 0.12, 0.07, 0.03, 0xb01818, 0.5, 1.85, 2.85));
  for (const bx of [-0.55, 0.55]) {
    g.add(P.cyl(0.09, 0.09, 0.24, 8, C.dark, bx, 0.72, 2.92, Math.PI / 2, 0, 0));
    g.add(P.cyl(0.09, 0.09, 0.24, 8, C.dark, bx, 0.72, -2.92, Math.PI / 2, 0, 0));
  }
  g.add(P.box(1.5, 0.42, 1.15, 0x5a6472, 0, 0.62, 1.95));
  g.add(P.box(1.5, 0.42, 1.15, 0x5a6472, 0, 0.62, -1.95));
  g.add(P.rbox(1.1, 0.5, 1.6, 0.08, 0x4a5058, 0, 0.62, 0));
  for (const bz of [1.95, -1.95]) {
    for (const wz of [0.62, 0, -0.62]) {
      g.add(wheel(0.31, 0.12, -0.72, 0.31, bz + wz));
      g.add(wheel(0.31, 0.12, 0.72, 0.31, bz + wz));
    }
  }
  return g;
}

export function makeTrainCar({ color = 0xf0ece2, band = 0xd9534f } = {}): THREE.Group {
  const g = G();
  g.add(P.rbox(1.7, 1.45, 5.4, 0.1, color, 0, 1.6, 0));
  g.add(P.box(1.76, 0.1, 5.46, 0x5a6472, 0, 2.36, 0));
  g.add(P.box(1.78, 0.16, 5.46, band, 0, 1.02, 0));
  for (const sx of [-0.87, 0.87]) {
    g.add(P.box(0.04, 0.55, 3.6, C.glass, sx, 1.85, 0));
    for (const dz of [-1.95, 1.95]) g.add(P.box(0.05, 1.15, 0.62, 0x5a6472, sx, 1.35, dz));
  }
  g.add(P.box(1.5, 0.42, 1.0, 0x5a6472, 0, 0.62, 1.85));
  g.add(P.box(1.5, 0.42, 1.0, 0x5a6472, 0, 0.62, -1.85));
  for (const bz of [1.85, -1.85]) {
    for (const wz of [0.5, -0.5]) {
      g.add(wheel(0.31, 0.12, -0.72, 0.31, bz + wz));
      g.add(wheel(0.31, 0.12, 0.72, 0.31, bz + wz));
    }
  }
  return g;
}
