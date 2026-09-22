// CITY — the fire truck street diorama.
// params: seed, size (street length multiplier), density (props multiplier)
import * as THREE from 'three';
import { C, mat } from '../engine/stage.js';
import { Baked } from '../engine/baked.js';
import { rng, type Rng } from '../engine/rng.js';
import {
  makeHouse, makeShop, makeTree, makeFlower, makeCloud, makeCar, makeFireTruck,
  makeConifer, makeVillager, makeFenceRun, makeHedge, makeFlowerPatch, makePlanter,
  makeStall, makeCafeSet, makeSignPost, makeStreetLamp, makeHydrant, makeTrafficLight,
  makeCatTree, makeBench, makeFire,
} from '../kit/index.js';

// pastel building / vehicle / prop palettes (Make Way-style)
const BUILDINGS = [0xf2e4cf, 0xf9d9bd, 0xc3ddef, 0xcfe8d8, 0xf3c4d3, 0xdcd0ec, 0xf9e7b0, 0xe8ddd0];
const ROOFS = [0xcf7d6d, 0x8ba7bf, 0xc4a687, 0x9dbd80, 0xb8a4d4];
const CARS = [0xfaf7ef, 0xd9dde2, 0x8f97a3, 0x5a6472, 0x7fb2d9, 0xe25c5c, 0x9cc76a, 0xf6c952];
const AWNINGS = [[0x63b0a8, C.cream], [0xe25c5c, C.cream], [0x7fb2d9, C.cream]];
const POTS = [0xcf7d6d, 0x8f97a3, 0x9cc76a];
const FENCES = [C.white, 0xd9dde2, 0xc4a687];

const j = (r: Rng, amp: number) => (r() - 0.5) * 2 * amp;
const pick = <T,>(r: Rng, arr: T[]): T => arr[(r() * arr.length) | 0];

export interface CityPOI {
  firePos: THREE.Vector3;
  truckPos: THREE.Vector3;
  catTreePos: { x: number; z: number };
  crossXs: number[];
  shops: Array<{ x: number; z: number; side: number }>;
}

export interface CityResult {
  group: THREE.Group;
  kind: 'city';
  seed: number;
  truck: THREE.Group;
  flames: THREE.Mesh[];
  smoke: THREE.Mesh[];
  beaconR: THREE.Object3D | undefined;
  beaconY: THREE.Object3D | undefined;
  poi: CityPOI;
}

export function generateCity(P: { seed?: number; size?: number; density?: number } = {}): CityResult {
  const seed = P.seed ?? 7;
  const size = P.size ?? 1;
  const density = P.density ?? 1;
  const r = rng(seed);
  const g = new THREE.Group();
  const add = (...m: THREE.Object3D[]) => { for (const x of m) g.add(x); };
  const half = Math.round(58 * size);
  const shops: Array<{ x: number; z: number; side: number }> = [];
  const parks: Array<{ x: number; z: number }> = [];

  // ---- roads ----
  const road = new THREE.Mesh(new THREE.BoxGeometry(half * 2 + 8, 0.06, 8), mat(C.road));
  road.position.y = 0.03;
  road.receiveShadow = true;
  add(road);
  const crossXs: number[] = [];
  const nCross = Math.max(1, Math.round(size));
  for (let i = 0; i < nCross; i++) {
    let x = 0, tries = 0;
    do { x = j(r, half - 18); } while (crossXs.some(o => Math.abs(o - x) < 25) && tries++ < 20);
    crossXs.push(x);
    const cross = new THREE.Mesh(new THREE.BoxGeometry(8, 0.06, 60), mat(C.road));
    cross.position.set(x, 0.035, 0);
    cross.receiveShadow = true;
    add(cross);
    const tl = makeTrafficLight();
    tl.position.set(x - 4.8, 0.1, -5.6);
    add(tl);
    for (let zz = -3.4; zz <= 3.4; zz += 1.15) { // zebra
      const bar = new THREE.Mesh(new THREE.BoxGeometry(0.55, 0.02, 2.9), mat(C.white));
      bar.position.set(x - 3.2, 0.09, zz);
      add(bar);
    }
  }
  // lane dashes + sidewalks (baked)
  {
    const b = new Baked();
    for (let x = -half; x <= half; x += 3.6) {
      if (crossXs.some(cx => Math.abs(x - cx) < 6)) continue;
      b.box(1.7, 0.02, 0.18, C.roadLine, x, 0.08, 0);
    }
    for (const cx of crossXs)
      for (let z = -26; z <= 26; z += 3.6) {
        if (Math.abs(z) < 5) continue;
        b.box(0.18, 0.02, 1.7, C.roadLine, cx, 0.08, z);
      }
    add(b.build());
    for (const z of [-5.2, 5.2]) {
      const sw = new THREE.Mesh(new THREE.BoxGeometry(half * 2 + 8, 0.1, 2.2), mat(C.sidewalk));
      sw.position.set(0, 0.05, z);
      sw.receiveShadow = true;
      add(sw);
    }
    const manholes = new Baked();
    for (let i = 0; i < Math.round(6 * density); i++) {
      const x = j(r, half - 6), z = j(r, 3);
      manholes.cyl(0.45, 0.45, 0.02, 14, 0x7c8492, x, 0.09, z);
    }
    add(manholes.build());
  }

  // ---- building lots along both sides ----
  const freeSpots: Array<{ x: number; z: number }> = [];
  for (const side of [-1, 1]) {
    const zc = side * -8.2;
    let x = -half + 4;
    while (x < half - 5) {
      const w = 4 + r() * 2;
      const roll = r();
      const facing = side === -1 ? 0 : Math.PI;
      const zPos = side === -1 ? zc : -zc;
      if (roll < 0.42) {
        const h = makeHouse({
          w: 3.8 + r(), d: 3.8 + r(), h: 2.6 + r() * 0.6,
          body: pick(r, BUILDINGS), roof: pick(r, ROOFS), door: C.white,
          windows: 2, chimney: r() > 0.6,
        });
        h.position.set(x + w / 2, 0, zPos);
        h.rotation.y = facing + j(r, 0.05);
        add(h);
      } else if (roll < 0.62) {
        const shop = makeShop({
          w: 4.4 + r(), d: 4.2, h: 3 + r() * 0.4,
          body: pick(r, BUILDINGS), roof: pick(r, [C.white, 0x5c6670, C.dark]),
          awning: pick(r, AWNINGS),
        });
        shop.position.set(x + w / 2, 0, side === -1 ? -8.4 : 8.4);
        shop.rotation.y = facing;
        add(shop);
        shops.push({ x: x + w / 2, z: side === -1 ? -6.3 : 6.3, side });
      } else if (roll < 0.74) {
        const park = new THREE.Group();
        const t1 = makeTree(r, 1.15); t1.position.set(-1.2, 0, 0); park.add(t1);
        const t2 = makeTree(r, 0.9); t2.position.set(1.4, 0, 0.5); park.add(t2);
        park.add(makeBench(C.brown));
        park.children[2].position.set(0, 0.1, 0.9);
        for (let k = 0; k < 4; k++) {
          const f = makeFlower(r); f.position.set(-1.5 + k, 0, 1.3); park.add(f);
        }
        park.position.set(x + w / 2, 0, side === -1 ? -8 : 8);
        add(park);
        parks.push({ x: x + w / 2, z: side === -1 ? -8 : 8 });
      } else if (roll < 0.84) {
        const stall = makeStall(r, pick(r, AWNINGS));
        stall.position.set(x + w / 2, 0.05, side === -1 ? -5.7 : 5.7);
        stall.rotation.y = side === -1 ? 0 : Math.PI;
        add(stall);
      } else if (roll < 0.92) {
        const cafe = makeCafeSet(pick(r, [0x8a4a3a, C.teal, 0x6d7378]));
        cafe.position.set(x + w / 2, 0.05, side === -1 ? -5.7 : 5.7);
        add(cafe);
      } else if (roll < 0.96) {
        const f = makeFenceRun(w, pick(r, FENCES), r);
        f.position.set(x + w / 2, 0.05, side === -1 ? -5.8 : 5.8);
        add(f);
      } // else: empty lot
      if (r() < 0.5) freeSpots.push({ x: x + w + 1, z: side * -5.6 });
      x += w + 1.5 + r() * 3.5;
    }
  }

  // ---- the fire: pick a shop, set its bin alight on the sidewalk ----
  if (!shops.length) {
    const shop = makeShop({ w: 5, d: 4.2, h: 3.2, body: C.pink, roof: C.white, awning: [C.teal, C.white] });
    shop.position.set(0, 0, -8.4);
    add(shop);
    shops.push({ x: 0, z: -6.3, side: -1 });
  }
  const fireShop = shops[(r() * shops.length) | 0];
  const firePos = new THREE.Vector3(fireShop.x, 0.1, fireShop.z + (fireShop.side === -1 ? 0.9 : -0.9));

  const fire = makeFire();
  const fireG = fire.group;
  fireG.position.copy(firePos);
  add(fireG);
  const hyd = makeHydrant();
  hyd.position.set(firePos.x + 3, 0.1, firePos.z);
  add(hyd);

  // ---- hero truck: parked on the road in front of the fire ----
  const truck = makeFireTruck();
  const truckPos = new THREE.Vector3(firePos.x + 5.5, 0.1, 1.9);
  truck.position.copy(truckPos);
  truck.rotation.y = -Math.PI / 2 + 0.3; // nose toward the fire
  add(truck);

  // ---- the cat: a tree near the fire (max 30 m away) ----
  let catTreePos: { x: number; z: number } | null = null;
  let best = 1e9;
  for (const p of parks) {
    const d = Math.hypot(p.x - firePos.x, p.z - firePos.z);
    if (d < best) { best = d; catTreePos = p; }
  }
  if (!catTreePos || best > 30) {
    catTreePos = { x: firePos.x + 12 + r() * 4, z: -6 + j(r, 1) };
    const t = makeCatTree(r); t.position.set(catTreePos.x, 0.1, catTreePos.z); add(t);
  } else {
    const t = makeCatTree(r); t.position.set(catTreePos.x, 0.1, catTreePos.z + 2); add(t);
  }

  // ---- street furniture ----
  for (let x = -half + 6; x < half; x += 15) {
    if (crossXs.some(cx => Math.abs(x - cx) < 8)) continue;
    const side = (Math.round(x / 15) % 2) ? -1 : 1;
    const lamp = makeStreetLamp(side); lamp.position.set(x, 0.1, side * 5.6); add(lamp);
  }
  for (let i = 0; i < Math.round(6 * density); i++) {
    const s = freeSpots[(r() * freeSpots.length) | 0];
    if (!s) break;
    const roll = r();
    const m = roll < 0.4 ? makePlanter(pick(r, POTS))
      : roll < 0.7 ? makeFlowerPatch(0.9, 10, r)
      : roll < 0.85 ? makeSignPost(r)
      : makeHedge(2.5 + r() * 1.5, r);
    m.position.set(s.x, 0.1, s.z);
    add(m);
  }
  // villagers on the sidewalks
  for (let i = 0; i < Math.round(9 * density); i++) {
    const per = makeVillager(r);
    per.position.set(j(r, half - 6), 0.1, (r() > 0.5 ? -5.9 : 5.9));
    per.rotation.y = r() * Math.PI * 2;
    add(per);
  }
  // one parked car per cross road + one random
  for (let i = 0; i <= crossXs.length; i++) {
    const car = makeCar({ body: pick(r, CARS) });
    car.position.set(crossXs[i] !== undefined ? crossXs[i] + j(r, 2) : j(r, half - 10), 0.06, 3.1);
    car.rotation.y = Math.PI / 2;
    add(car);
  }

  // ---- background + nature ----
  const nBack = Math.round(4 * Math.max(1, size));
  for (let i = 0; i < nBack; i++) {
    const h = makeHouse({
      w: 3.8, d: 3.8, h: 2.7, body: pick(r, BUILDINGS), roof: pick(r, ROOFS), door: C.white, windows: 2,
    });
    h.position.set(-half + 8 + (i + r() * 0.6) * ((half * 2 - 16) / nBack), 0, -16.5 - r() * 2);
    h.rotation.y = Math.PI + j(r, 0.15);
    add(h);
  }
  for (let i = 0; i < Math.round(26 * density); i++) {
    const x = j(r, half - 4), z = (r() > 0.5 ? 1 : -1) * (13 + r() * 28);
    const t = r() > 0.6 ? makeConifer(r) : makeTree(r);
    t.position.set(x, 0, z);
    add(t);
  }
  const ring = new Baked();
  for (let i = 0; i < 26; i++) {
    const a = (i / 26) * Math.PI * 2 + r() * 0.2;
    const d = 88 + r() * 22, s = 1.6 + r() * 1.2;
    const x = Math.cos(a) * d, z = Math.sin(a) * d;
    ring.cyl(0.14 * s, 0.2 * s, 0.9 * s, 6, C.brown, x, 0.45 * s, z);
    ring.sphere(0.75 * s, C.leaf, x, 1.4 * s, z);
    ring.sphere(0.55 * s, C.leafLight, x + 0.4 * s, 1.1 * s, z);
  }
  add(ring.build());
  for (const [x, y, z, s] of [[-30, 24, -34, 2.6], [18, 28, -20, 3.2], [42, 22, 8, 2.2], [-8, 30, 24, 2.4]]) {
    const cl = makeCloud(r, s); cl.position.set(x, y, z); add(cl);
  }

  const beaconMat = (ch: THREE.Object3D) => {
    const m = (ch as THREE.Mesh).material as THREE.MeshLambertMaterial | undefined;
    return m && m.emissive ? m.color.getHex() : -1;
  };
  const beaconR = truck.children.find(ch => beaconMat(ch) === 0xff5050);
  const beaconY = truck.children.find(ch => beaconMat(ch) === C.yellow);

  return {
    group: g, kind: 'city', seed, truck,
    flames: fire.flames, smoke: fire.smoke,
    beaconR, beaconY,
    poi: { firePos, truckPos, catTreePos: catTreePos!, crossXs, shops },
  };
}
