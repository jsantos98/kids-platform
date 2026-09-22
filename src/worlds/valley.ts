// VALLEY — the rescue helicopter diorama.
// params: seed, houses, lake, animals
import * as THREE from 'three';
import { C, mat } from '../engine/stage.js';
import { Baked } from '../engine/baked.js';
import { rng, type Rng } from '../engine/rng.js';
import {
  makeHouse, makeTree, makeBush, makeCloud, makeCar, makeConifer, makeVillager,
  makeFenceRun, makeHedge, makeFlowerPatch, makeHotAirBalloon, makeCow, makeSheep,
  makeDuck, makeSailboat,
} from '../kit/index.js';

const BUILDINGS = [0xf2e4cf, 0xf9d9bd, 0xc3ddef, 0xcfe8d8, 0xf3c4d3, 0xdcd0ec, 0xf9e7b0, 0xe8ddd0];
const ROOFS = [0xcf7d6d, 0x8ba7bf, 0xc4a687, 0x9dbd80, 0xb8a4d4];
const CARS = [0xfaf7ef, 0xd9dde2, 0x8f97a3, 0x5a6472, 0x7fb2d9, 0xe25c5c, 0x9cc76a, 0xf6c952];
const FENCES = [C.white, 0xd9dde2, 0xc4a687];

const j = (r: Rng, amp: number) => (r() - 0.5) * 2 * amp;
const pick = <T,>(r: Rng, arr: T[]): T => arr[(r() * arr.length) | 0];

export interface ValleyResult {
  group: THREE.Group;
  kind: 'valley';
  seed: number;
  poi: {
    hospPos: THREE.Vector3;
    heliPad: THREE.Vector3;
    patientPos: THREE.Vector3;
    townC: THREE.Vector3;
    lakeC: THREE.Vector3 | null;
    heliStart: THREE.Vector3;
  };
  balloon: THREE.Group;
}

export function generateValley(P: { seed?: number; houses?: number; lake?: boolean; animals?: boolean } = {}): ValleyResult {
  const seed = P.seed ?? 21;
  const nHouses = P.houses ?? 8;
  const withLake = P.lake ?? true;
  const withAnimals = P.animals ?? true;
  const r = rng(seed);
  const g = new THREE.Group();
  const add = (...m: THREE.Object3D[]) => { for (const x of m) g.add(x); };

  // hills ring
  for (const [x, z, s] of [[-70, -50, 22], [75, -60, 26], [-85, 30, 24], [90, 45, 20], [0, -95, 30], [-40, 85, 18], [55, 90, 22]]) {
    const hill = new THREE.Mesh(new THREE.SphereGeometry(s, 16, 12), mat(r() > 0.5 ? C.grass : C.grassAlt));
    hill.position.set(x + j(r, 8), -s * 0.72, z + j(r, 8));
    hill.scale.y = 0.55;
    hill.receiveShadow = true;
    add(hill);
  }

  // town: cross roads + houses with yards
  const townC = new THREE.Vector3(10 + j(r, 3), 0, 8 + j(r, 3));
  const road1 = new THREE.Mesh(new THREE.BoxGeometry(46, 0.05, 3.2), mat(C.road));
  road1.position.set(townC.x, 0.03, townC.z + 5);
  road1.receiveShadow = true;
  add(road1);
  const road2 = new THREE.Mesh(new THREE.BoxGeometry(3.2, 0.05, 30), mat(C.road));
  road2.position.set(townC.x - 2, 0.03, townC.z - 7);
  road2.receiveShadow = true;
  add(road2);

  const houses: Array<{ x: number; z: number; ry: number; body: number; roof: number }> = [];
  let guard = 0;
  while (houses.length < nHouses && guard++ < 300) {
    const x = townC.x + j(r, 16), z = townC.z + j(r, 12);
    if (houses.some(h => Math.hypot(h.x - x, h.z - z) < 7)) continue;
    if (Math.hypot(x - (townC.x - 2), z - (townC.z - 7)) < 4) continue;
    houses.push({ x, z, ry: j(r, 0.5), body: pick(r, BUILDINGS), roof: pick(r, ROOFS) });
  }
  for (const h of houses) {
    const m = makeHouse({ w: 3.4, d: 3.4, h: 2.4, body: h.body, roof: h.roof, door: C.white, windows: 2 });
    m.position.set(h.x, 0, h.z);
    m.rotation.y = h.ry;
    add(m);
  }
  for (let i = 0; i < houses.length; i += 2) {
    const h = houses[i];
    const yard = r() > 0.5 ? makeFenceRun(4.5, pick(r, FENCES), r) : makeHedge(4, r);
    yard.position.set(h.x + Math.sin(h.ry) * 2.6, 0.05, h.z + Math.cos(h.ry) * 2.6);
    yard.rotation.y = h.ry;
    add(yard);
  }
  for (let i = 0; i < 2; i++) {
    const car = makeCar({ body: pick(r, CARS) });
    car.position.set(townC.x - 12 + i * 14, 0.06, townC.z + 5.6);
    car.rotation.y = i ? -Math.PI / 2 : Math.PI / 2;
    add(car);
  }

  // hospital (slightly apart from the town, facing it)
  const hospPos = new THREE.Vector3(24 + j(r, 3), 0, -4 + j(r, 3));
  const hosp = new THREE.Group();
  {
    const body = new THREE.Mesh(new THREE.BoxGeometry(9, 7.5, 8), mat(C.white));
    body.position.y = 3.75;
    body.castShadow = true;
    body.receiveShadow = true;
    hosp.add(body);
    for (let row = 0; row < 3; row++) for (let col = 0; col < 4; col++) {
      const w = new THREE.Mesh(new THREE.BoxGeometry(1.1, 0.9, 0.06), mat(C.glass));
      w.position.set(-3.2 + col * 2.1, 1.6 + row * 1.9, 4.03); hosp.add(w);
      const w2 = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.9, 1.1), mat(C.glass));
      w2.position.set(4.53, 1.6 + row * 1.9, -2.6 + col * 1.7); hosp.add(w2);
    }
    const crossV = new THREE.Mesh(new THREE.BoxGeometry(0.7, 2.2, 0.1), mat(C.red));
    crossV.position.set(0, 5.6, 4.05); hosp.add(crossV);
    const crossH = new THREE.Mesh(new THREE.BoxGeometry(2.2, 0.7, 0.1), mat(C.red));
    crossH.position.set(0, 5.6, 4.05); hosp.add(crossH);
    const can = new THREE.Mesh(new THREE.BoxGeometry(3.4, 0.25, 1.6), mat(C.blue));
    can.position.set(0, 2.6, 4.7); can.castShadow = true; hosp.add(can);
    const door = new THREE.Mesh(new THREE.BoxGeometry(1.8, 1.7, 0.1), mat(C.glass));
    door.position.set(0, 0.85, 4.05); hosp.add(door);
    const pad = new THREE.Mesh(new THREE.CylinderGeometry(2.7, 2.9, 0.35, 24), mat(0x8f9aa8));
    pad.position.set(2.2, 7.65, 1.6); pad.castShadow = true; hosp.add(pad);
    const circle = new THREE.Mesh(new THREE.CylinderGeometry(2.15, 2.15, 0.06, 24), mat(C.white));
    circle.position.set(2.2, 7.85, 1.6); hosp.add(circle);
    const H = new THREE.Group();
    const bar = (w: number, d: number, x: number, z: number) => {
      const m = new THREE.Mesh(new THREE.BoxGeometry(w, 0.07, d), mat(C.red));
      m.position.set(x, 0, z); H.add(m);
    };
    bar(0.3, 1.3, -0.55, 0); bar(0.3, 1.3, 0.55, 0); bar(0.8, 0.3, 0, 0);
    H.position.set(2.2, 7.92, 1.6); hosp.add(H);
    for (const [lx, lz] of [[-0.3, -0.9], [4.7, -0.9], [-0.3, 4.1], [4.7, 4.1]]) {
      const l = new THREE.Mesh(
        new THREE.SphereGeometry(0.14, 8, 6),
        new THREE.MeshLambertMaterial({ color: C.yellow, emissive: 0xffcc00, emissiveIntensity: 1 }));
      l.position.set(lx, 7.95, lz); hosp.add(l);
    }
  }
  hosp.position.copy(hospPos);
  hosp.rotation.y = Math.PI + j(r, 0.3);
  add(hosp);
  const heliPad = new THREE.Vector3(hospPos.x + 2.2, 8, hospPos.z + 1.6);

  // ambulance at the entrance
  {
    const am = new THREE.Group();
    const body = new THREE.Mesh(new THREE.BoxGeometry(1.5, 1.1, 3), mat(C.white));
    body.position.y = 0.85; body.castShadow = true; am.add(body);
    const stripe = new THREE.Mesh(new THREE.BoxGeometry(1.54, 0.25, 3.04), mat(C.red));
    stripe.position.y = 0.7; am.add(stripe);
    const glass = new THREE.Mesh(new THREE.BoxGeometry(1.3, 0.5, 0.08), mat(C.glass));
    glass.position.set(0, 1.05, 1.53); am.add(glass);
    const cv = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.9, 0.06), mat(C.red));
    cv.position.set(0, 1.35, -1.53); am.add(cv);
    const ch = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.3, 0.06), mat(C.red));
    ch.position.set(0, 1.35, -1.53); am.add(ch);
    const beacon = new THREE.Mesh(
      new THREE.BoxGeometry(0.4, 0.16, 0.2),
      new THREE.MeshLambertMaterial({ color: 0xff5050, emissive: 0xff2222 }));
    beacon.position.set(0, 1.5, 0.4); am.add(beacon);
    for (const [wx, wz] of [[-0.75, 0.95], [0.75, 0.95], [-0.75, -0.95], [0.75, -0.95]]) {
      const tire = new THREE.Mesh(new THREE.CylinderGeometry(0.26, 0.26, 0.18, 12), mat(C.tire));
      tire.rotation.z = Math.PI / 2; tire.position.set(wx, 0.26, wz); am.add(tire);
    }
    am.position.set(hospPos.x - 4 + j(r, 1), 0.05, hospPos.z + 8);
    am.rotation.y = 0.35;
    add(am);
  }

  // lake + boat + ducks (west side)
  let lakeC: THREE.Vector3 | null = null;
  if (withLake) {
    lakeC = new THREE.Vector3(-20 + j(r, 5), 0, j(r, 5));
    const lake = new THREE.Mesh(new THREE.CircleGeometry(4.5 + r() * 1.5, 24), mat(C.water));
    lake.rotation.x = -Math.PI / 2;
    lake.position.set(lakeC.x, 0.04, lakeC.z);
    lake.scale.x = 1.25;
    lake.receiveShadow = true;
    add(lake);
    const boat = makeSailboat(pick(r, [C.red, C.blue]), C.white);
    boat.position.set(lakeC.x - 1, 0.08, lakeC.z - 1);
    boat.rotation.y = r() * 6;
    add(boat);
    for (let i = 0; i < 2; i++) {
      const d = makeDuck();
      d.position.set(lakeC.x + 3 + i, 0.08, lakeC.z + 2 - i * 2);
      d.rotation.y = r() * 6;
      add(d);
    }
  }

  // paddock with cows and sheep
  if (withAnimals) {
    const pc = new THREE.Vector3(townC.x - 8 + j(r, 3), 0, townC.z + 12 + j(r, 2));
    const w = 7, d = 5;
    const fN = makeFenceRun(w, C.white, r); fN.position.set(pc.x, 0.05, pc.z - d / 2); add(fN);
    const fS = makeFenceRun(w, C.white, r); fS.position.set(pc.x, 0.05, pc.z + d / 2); add(fS);
    const fW = makeFenceRun(d, C.white, r); fW.position.set(pc.x - w / 2, 0.05, pc.z); fW.rotation.y = Math.PI / 2; add(fW);
    const fE = makeFenceRun(d, C.white, r); fE.position.set(pc.x + w / 2, 0.05, pc.z); fE.rotation.y = Math.PI / 2; add(fE);
    for (let i = 0; i < 3; i++) {
      const cow = makeCow();
      cow.position.set(pc.x - 2 + i * 2, 0.05, pc.z + j(r, 1.4));
      cow.rotation.y = r() * 6;
      add(cow);
    }
    for (let i = 0; i < 2; i++) {
      const sh = makeSheep();
      sh.position.set(pc.x + j(r, 2.4), 0.05, pc.z + j(r, 1.6));
      sh.rotation.y = r() * 6;
      add(sh);
    }
  }

  // the patient: next to a random house + a bystander
  const patientHouse = houses[(r() * houses.length) | 0] || { x: townC.x, z: townC.z, ry: 0 };
  const patientPos = new THREE.Vector3(
    patientHouse.x + Math.sin(patientHouse.ry) * 3 + j(r, 1.5), 0.05,
    patientHouse.z + Math.cos(patientHouse.ry) * 3 + j(r, 1.5),
  );

  // nature: flower beds, bushes, mixed trees, horizon ring, clouds
  for (let i = 0; i < 6; i++) {
    const fp = makeFlowerPatch(1, 10, r);
    fp.position.set(townC.x + j(r, 18), 0.05, townC.z + j(r, 14));
    add(fp);
  }
  for (let i = 0; i < Math.round(10 + nHouses * 1.5); i++) {
    const t = r() > 0.45 ? makeConifer(r) : makeTree(r);
    t.position.set(townC.x + j(r, 26), 0, townC.z + j(r, 20));
    add(t);
  }
  for (let i = 0; i < 8; i++) {
    const b = makeBush(r);
    b.position.set(townC.x + j(r, 24), 0, townC.z + j(r, 18));
    add(b);
  }
  for (let i = 0; i < 4; i++) {
    const per = makeVillager(r);
    per.position.set(townC.x + j(r, 14), 0.05, townC.z + j(r, 10));
    per.rotation.y = r() * 6;
    add(per);
  }
  const ring = new Baked();
  for (let i = 0; i < 30; i++) {
    const a = (i / 30) * Math.PI * 2 + r() * 0.18;
    const d = 95 + r() * 25, s = 1.8 + r() * 1.3;
    const x = Math.cos(a) * d, z = Math.sin(a) * d;
    ring.cyl(0.14 * s, 0.2 * s, 0.9 * s, 6, C.brown, x, 0.45 * s, z);
    ring.sphere(0.75 * s, C.leaf, x, 1.4 * s, z);
    ring.sphere(0.55 * s, C.leafLight, x + 0.4 * s, 1.1 * s, z);
  }
  add(ring.build());
  for (const [x, y, z, s] of [[-30, 26, -28, 3], [34, 30, 18, 3.6], [-45, 22, 25, 2.4], [8, 34, -45, 2.8], [10, 25, 5, 2.6], [-12, 28, 12, 2.2], [26, 26, -12, 2.6]]) {
    const cl = makeCloud(r, s); cl.position.set(x + j(r, 4), y, z + j(r, 4)); add(cl);
  }
  const balloon = makeHotAirBalloon(pick(r, [C.red, C.blue, C.purple]), C.cream);
  balloon.position.set(-8 + j(r, 4), 7, -22 + j(r, 4));
  balloon.rotation.y = r() * 6;
  add(balloon);

  return {
    group: g, kind: 'valley', seed,
    poi: {
      hospPos, heliPad, patientPos, townC, lakeC,
      heliStart: new THREE.Vector3(-16 + j(r, 2), 11, 6 + j(r, 2)),
    },
    balloon,
  };
}
