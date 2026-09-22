// RAILROAD — the little train loop diorama.
// params: seed, wobble (track irregularity), stations, animals
import * as THREE from 'three';
import { C, mat } from '../engine/stage.js';
import { Baked } from '../engine/baked.js';
import { rng, type Rng } from '../engine/rng.js';
import {
  makeTree, makeBush, makeFlower, makeCloud, makeConifer, makeVillager, makeCow,
  makeSheep, makeDuck, makeSailboat, makeWaterTower, makeTrainLoco, makeTrainCar,
  makeFenceRun, makeFlowerPatch,
} from '../kit/index.js';

const UP = new THREE.Vector3(0, 1, 0);
const j = (r: Rng, amp: number) => (r() - 0.5) * 2 * amp;
const pick = <T,>(r: Rng, arr: T[]): T => arr[(r() * arr.length) | 0];

export interface RailroadResult {
  group: THREE.Group;
  kind: 'railroad';
  seed: number;
  curve: THREE.CatmullRomCurve3;
  trackLen: number;
  railTop: number;
  headT: number;
  railcarGap: number;
  loco: THREE.Group;
  car1: THREE.Group;
  car2: THREE.Group;
  placeOnTrack(obj: THREE.Object3D, t: number): void;
  poi: { bridgeCenter: THREE.Vector3; stationTs: number[]; hillC: THREE.Vector3; riverZ: number; tunnelC: THREE.Vector3 };
}

export function generateRailroad(P: { seed?: number; wobble?: number; stations?: number; animals?: boolean } = {}): RailroadResult {
  const seed = P.seed ?? 42;
  const wobble = P.wobble ?? 1;
  const nStations = Math.max(1, Math.min(3, P.stations ?? 2));
  const withAnimals = P.animals ?? true;
  const r = rng(seed);
  const g = new THREE.Group();
  const add = (...m: THREE.Object3D[]) => { for (const x of m) g.add(x); };
  const RX = 26, RZ = 17;

  // track loop: ellipse + seeded wobble
  const pts: THREE.Vector3[] = [];
  for (let i = 0; i < 12; i++) {
    const a = (i / 12) * Math.PI * 2;
    pts.push(new THREE.Vector3(Math.cos(a) * RX, 0, Math.sin(a) * RZ));
  }
  pts[1].z -= 2.5 * wobble * (0.5 + r());
  pts[4].x += 2.5 * wobble * (0.5 + r());
  pts[7].z += 2 * wobble * (0.5 + r());
  pts[10].x -= 2.5 * wobble * (0.5 + r());
  const curve = new THREE.CatmullRomCurve3(pts, true, 'catmullrom', 0.5);
  const trackLen = curve.getLength();
  const RAIL_TOP = 0.44;

  // ballast + sleepers + rails
  {
    const geo = new THREE.TubeGeometry(curve, 240, 0.5, 7, true);
    geo.scale(1, 0.3, 1);
    const m = new THREE.Mesh(geo, mat(0xc9b28e));
    m.position.y = 0.1;
    m.receiveShadow = true;
    add(m);
  }
  {
    const count = Math.floor(trackLen / 0.7);
    const inst = new THREE.InstancedMesh(new THREE.BoxGeometry(1.4, 0.08, 0.4), mat(C.brownDark), count);
    const dummy = new THREE.Object3D();
    for (let i = 0; i < count; i++) {
      const t = i / count;
      dummy.position.copy(curve.getPointAt(t)); dummy.position.y = 0.26;
      dummy.lookAt(dummy.position.clone().add(curve.getTangentAt(t)));
      dummy.updateMatrix();
      inst.setMatrixAt(i, dummy.matrix);
    }
    inst.castShadow = true;
    inst.receiveShadow = true;
    add(inst);
  }
  for (const off of [-0.45, 0.45]) {
    const rp: THREE.Vector3[] = [];
    for (let i = 0; i < 140; i++) {
      const t = i / 140;
      const p = curve.getPointAt(t);
      const tan = curve.getTangentAt(t);
      const side = new THREE.Vector3().crossVectors(UP, tan).normalize();
      rp.push(p.clone().addScaledVector(side, off).setY(0.38));
    }
    const railCurve = new THREE.CatmullRomCurve3(rp, true);
    const rail = new THREE.Mesh(new THREE.TubeGeometry(railCurve, 240, 0.06, 8, true), mat(0x9aa5b5));
    rail.castShadow = true;
    add(rail);
  }

  // river + bridge where the track crosses it
  const riverZ = 6 + r() * 4;
  {
    const river = new THREE.Mesh(new THREE.BoxGeometry(96, 0.06, 6.4), mat(C.water));
    river.position.set(54, 0.03, riverZ); river.receiveShadow = true; add(river);
    for (const [px, pz] of [[6.6, riverZ], [101, riverZ]]) {
      const pond = new THREE.Mesh(new THREE.CircleGeometry(3.4, 20), mat(C.water));
      pond.rotation.x = -Math.PI / 2;
      pond.position.set(px, 0.03, pz);
      add(pond);
    }
    const boat = makeSailboat(pick(r, [C.red, C.blue]), C.white);
    boat.position.set(46, 0.08, riverZ + 0.6);
    boat.rotation.y = 0.5;
    add(boat);
    for (let i = 0; i < 3; i++) {
      const d = makeDuck();
      d.position.set(36 + i * 5, 0.08, riverZ + 1.2 + j(r, 0.8));
      d.rotation.y = r() * 6;
      add(d);
    }
  }
  let tBridgeA = 0, tBridgeB = 0;
  {
    let inside = false;
    for (let i = 0; i <= 400; i++) {
      const t = i / 400;
      const p = curve.getPointAt(t);
      const on = p.x > 17 && p.x < 30.5 && Math.abs(p.z - riverZ) < 2.4;
      if (on && !inside) { tBridgeA = t; inside = true; }
      if (!on && inside) { tBridgeB = t; break; }
    }
  }
  if (tBridgeB > tBridgeA) {
    const segs = 14;
    for (let i = 0; i <= segs; i++) {
      const tA = tBridgeA + (tBridgeB - tBridgeA) * (i / segs);
      const tB = tBridgeA + (tBridgeB - tBridgeA) * ((i + 1) / segs);
      const pA = curve.getPointAt(tA), pB = curve.getPointAt(tB);
      const mid = pA.clone().add(pB).multiplyScalar(0.5);
      const dir = pB.clone().sub(pA);
      const deck = new THREE.Mesh(new THREE.BoxGeometry(1.05, 0.22, 3), mat(0xb3703d));
      deck.position.set(mid.x, 0.28, mid.z);
      deck.rotation.y = Math.atan2(dir.x, dir.z) + Math.PI / 2;
      deck.castShadow = true; deck.receiveShadow = true;
      add(deck);
      const side = new THREE.Vector3().crossVectors(UP, dir.clone().normalize());
      if (i % 2 === 0) for (const s of [-1, 1]) {
        const post = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.55, 0.09), mat(i % 4 === 0 ? C.red : C.white));
        post.position.copy(mid).addScaledVector(side, s * 1.35).setY(0.62);
        post.castShadow = true;
        add(post);
      }
    }
    for (const f of [0.25, 0.5, 0.75]) {
      const t = tBridgeA + (tBridgeB - tBridgeA) * f;
      const p = curve.getPointAt(t);
      const pil = new THREE.Mesh(new THREE.CylinderGeometry(0.34, 0.4, 1.6, 10), mat(0xa8b2bd));
      pil.position.set(p.x, -0.35, p.z);
      pil.castShadow = true;
      add(pil);
    }
  }

  // tunnel through a seeded hill
  const hillT = 0.52 + r() * 0.12;
  const hillC = curve.getPointAt(hillT);
  const R_HILL = 7.6;
  {
    const hill = new THREE.Mesh(new THREE.SphereGeometry(R_HILL, 18, 14), mat(C.grassAlt));
    hill.position.set(hillC.x, -0.6, hillC.z);
    hill.scale.y = 0.68;
    hill.castShadow = true; hill.receiveShadow = true;
    add(hill);
    const hits: number[] = [];
    for (let i = 0; i <= 600; i++) {
      const t = i / 600;
      const p = curve.getPointAt(t);
      const d = Math.hypot(p.x - hillC.x, p.z - hillC.z);
      if (d < R_HILL * 0.96 && d > R_HILL * 0.72) hits.push(t);
    }
    if (hits.length) {
      for (const t of [hits[0], hits[hits.length - 1]]) {
        const p = curve.getPointAt(t);
        const tan = curve.getTangentAt(t);
        const arch = new THREE.Mesh(new THREE.TorusGeometry(1.55, 0.34, 8, 14, Math.PI), mat(0x9aa5b5));
        arch.position.set(p.x, 0.15, p.z);
        arch.rotation.y = Math.atan2(tan.x, tan.z);
        arch.castShadow = true;
        add(arch);
      }
    }
  }

  // stations at parametric t positions + signals before each
  const stationTs: number[] = [];
  for (let i = 0; i < nStations; i++) stationTs.push(((0.26 - i * 0.24) + j(r, 0.02) + 1) % 1);
  for (const t of stationTs) buildStation(t);
  for (const t of stationTs) buildSignal((t + 0.035) % 1);

  // siding + shed + switch lever
  buildSiding(0.86 + r() * 0.05);

  // water tower inside the loop
  const tower = makeWaterTower();
  tower.position.set(-12 + j(r, 4), 0, -3 + j(r, 3));
  add(tower);

  // animal paddock inside the loop
  if (withAnimals) {
    const pc = new THREE.Vector3(2 + j(r, 3), 0, 4 + j(r, 3));
    const w = 8, d = 6;
    const fN = makeFenceRun(w, C.white, r); fN.position.set(pc.x, 0.02, pc.z - d / 2); add(fN);
    const fS = makeFenceRun(w, C.white, r); fS.position.set(pc.x, 0.02, pc.z + d / 2); add(fS);
    const fW = makeFenceRun(d, C.white, r); fW.position.set(pc.x - w / 2, 0.02, pc.z); fW.rotation.y = Math.PI / 2; add(fW);
    const fE = makeFenceRun(d, C.white, r); fE.position.set(pc.x + w / 2, 0.02, pc.z); fE.rotation.y = Math.PI / 2; add(fE);
    for (let i = 0; i < 3; i++) {
      const cow = makeCow();
      cow.position.set(pc.x - 2 + i * 2, 0.02, pc.z + j(r, 1.6));
      cow.rotation.y = r() * 6;
      add(cow);
    }
    for (let i = 0; i < 2; i++) {
      const sh = makeSheep();
      sh.position.set(pc.x + j(r, 2.6), 0.02, pc.z + j(r, 1.8));
      sh.rotation.y = r() * 6;
      add(sh);
    }
  }

  // scenery: meadows, flowers, scattered nature, horizon ring, clouds
  for (const [px, pz, rad, col] of [[2, 4, 8, C.grassAlt], [-10, 6, 6, 0xa4cf85], [8, -6, 7, C.grass], [14, 2, 6, 0xa4cf85]]) {
    const patch = new THREE.Mesh(new THREE.CircleGeometry(rad, 22), mat(col));
    patch.rotation.x = -Math.PI / 2;
    patch.position.set(px + j(r, 2), 0.015, pz + j(r, 2));
    patch.receiveShadow = true;
    add(patch);
  }
  for (let i = 0; i < 5; i++) {
    const fp = makeFlowerPatch(1.6, 16, r);
    fp.position.set(j(r, 18), 0.02, j(r, 12));
    add(fp);
  }
  function scatter(n: number, keep: (x: number, z: number) => void): void {
    let placed = 0, guard = 0;
    while (placed < n && guard++ < n * 30) {
      const a = r() * Math.PI * 2, rad = 6 + r() * 46;
      const x = Math.cos(a) * rad, z = Math.sin(a) * rad * (RZ / RX);
      const e = Math.hypot(x / RX, z / RZ);
      if (Math.abs(e - 1) < 0.16) continue;
      if (x > 2 && Math.abs(z - riverZ) < 5) continue;
      if (Math.hypot(x - hillC.x, z - hillC.z) < R_HILL + 1.5) continue;
      keep(x, z);
      placed++;
    }
  }
  scatter(36, (x, z) => { const t = makeTree(r); t.position.set(x, 0, z); add(t); });
  scatter(14, (x, z) => { const t = makeConifer(r); t.position.set(x, 0, z); add(t); });
  scatter(24, (x, z) => { const b = makeBush(r); b.position.set(x, 0, z); add(b); });
  scatter(18, (x, z) => { const f = makeFlower(r); f.position.set(x, 0, z); add(f); });
  for (const [x, z, s] of [[-60, -55, 24], [55, -65, 28], [-80, 25, 22], [70, 60, 20], [0, -100, 30]]) {
    const hill = new THREE.Mesh(new THREE.SphereGeometry(s, 16, 12), mat(C.grass));
    hill.position.set(x + j(r, 6), -s * 0.72, z + j(r, 6));
    hill.scale.y = 0.5;
    add(hill);
  }
  const ring = new Baked();
  for (let i = 0; i < 30; i++) {
    const a = (i / 30) * Math.PI * 2 + r() * 0.18;
    const d = 92 + r() * 26, s = 1.8 + r() * 1.3;
    const x = Math.cos(a) * d * 1.15, z = Math.sin(a) * d * 0.85;
    ring.cyl(0.14 * s, 0.2 * s, 0.9 * s, 6, C.brown, x, 0.45 * s, z);
    ring.sphere(0.75 * s, C.leaf, x, 1.4 * s, z);
    ring.sphere(0.55 * s, C.leafLight, x + 0.4 * s, 1.1 * s, z);
  }
  add(ring.build());
  for (const [x, y, z, s] of [[-28, 26, -30, 3], [30, 30, -14, 3.4], [-6, 34, 30, 2.6], [52, 24, 30, 2.2]]) {
    const cl = makeCloud(r, s); cl.position.set(x + j(r, 3), y, z + j(r, 3)); add(cl);
  }
  // trackside marker posts (baked)
  {
    const posts = new Baked();
    for (let i = 0; i < 14; i++) {
      const t = i / 14;
      const p = curve.getPointAt(t);
      const tan = curve.getTangentAt(t);
      const side = new THREE.Vector3().crossVectors(UP, tan).normalize().multiplyScalar(-1.5);
      posts.box(0.12, 0.55, 0.12, i % 2 ? C.white : C.red, p.x + side.x, 0.28, p.z + side.z);
    }
    add(posts.build());
  }

  // the train (scaled chunky), staged mid-bridge
  const RAILCAR_GAP = 3.15 / trackLen;
  const TRAIN_SCALE = 1.28;
  const headT = tBridgeB > tBridgeA ? (tBridgeA + tBridgeB) / 2 - 0.012 : 0.07;
  const loco = makeTrainLoco();
  const car1 = makeTrainCar();
  const car2 = makeTrainCar({ color: 0xf0ece2, band: 0x7fb2d9 });
  loco.scale.setScalar(TRAIN_SCALE);
  car1.scale.setScalar(TRAIN_SCALE);
  car2.scale.setScalar(TRAIN_SCALE);
  add(loco, car1, car2);
  function placeOnTrack(obj: THREE.Object3D, t: number): void {
    const tt = ((t % 1) + 1) % 1;
    const p = curve.getPointAt(tt);
    const tan = curve.getTangentAt(tt);
    obj.position.copy(p).setY(RAIL_TOP);
    obj.lookAt(p.clone().add(tan).setY(RAIL_TOP));
  }
  placeOnTrack(loco, headT);
  placeOnTrack(car1, headT - RAILCAR_GAP);
  placeOnTrack(car2, headT - RAILCAR_GAP * 2);

  const bridgeCenter = curve.getPointAt((tBridgeA + tBridgeB) / 2);

  function buildStation(t: number): void {
    const p = curve.getPointAt(t);
    const tan = curve.getTangentAt(t);
    const out = p.clone().setY(0).normalize();
    const st = new THREE.Group();
    const plat = new THREE.Mesh(new THREE.BoxGeometry(2.1, 0.55, 7.5), mat(C.sidewalk));
    plat.position.y = 0.28; plat.castShadow = true; plat.receiveShadow = true; st.add(plat);
    const edge = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.58, 7.5), mat(C.yellow));
    edge.position.set(-0.9, 0.29, 0); st.add(edge);
    for (const [px, pz] of [[-0.6, -2.9], [0.6, -2.9], [-0.6, 2.9], [0.6, 2.9]]) {
      const post = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 2.2, 8), mat(C.silver));
      post.position.set(px, 1.6, pz); st.add(post);
    }
    const roofM = new THREE.Mesh(new THREE.BoxGeometry(2.5, 0.14, 7.8), mat(C.red));
    roofM.position.set(0, 2.75, 0); roofM.castShadow = true; st.add(roofM);
    const trim = new THREE.Mesh(new THREE.BoxGeometry(2.56, 0.1, 7.86), mat(C.white));
    trim.position.set(0, 2.62, 0); st.add(trim);
    const bench = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.1, 1.6), mat(C.brown));
    bench.position.set(0.6, 0.85, 1.4); bench.castShadow = true; st.add(bench);
    const signP = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, 1.5, 6), mat(C.dark));
    signP.position.set(-0.7, 1.3, -3.1); st.add(signP);
    const sign = new THREE.Mesh(new THREE.CylinderGeometry(0.32, 0.32, 0.1, 12), mat(C.yellow));
    sign.rotation.x = Math.PI / 2; sign.position.set(-0.7, 2.1, -3.1); st.add(sign);
    for (let i = 0; i < 2 + ((r() * 2) | 0); i++) {
      const per = makeVillager(r);
      per.position.set(j(r, 0.6), 0.55, -2.4 + i * 1.6);
      per.rotation.y = Math.PI + j(r, 1);
      st.add(per);
    }
    st.position.copy(p).addScaledVector(out, 2.3);
    st.lookAt(st.position.clone().add(tan));
    add(st);
  }
  function buildSignal(t: number): void {
    const p = curve.getPointAt(t);
    const tan = curve.getTangentAt(t);
    const side = new THREE.Vector3().crossVectors(UP, tan).normalize().multiplyScalar(-1.6);
    const sg = new THREE.Group();
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.08, 2.1, 8), mat(C.dark));
    pole.position.y = 1.05; pole.castShadow = true; sg.add(pole);
    const head = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.95, 0.3), mat(C.dark));
    head.position.y = 2.3; head.castShadow = true; sg.add(head);
    const red = new THREE.Mesh(new THREE.SphereGeometry(0.11, 10, 8), mat(0x6e1f1f));
    red.position.set(0, 2.55, 0.16); sg.add(red);
    const green = new THREE.Mesh(
      new THREE.SphereGeometry(0.11, 10, 8),
      new THREE.MeshLambertMaterial({ color: 0x2ecc40, emissive: 0x1faa30, emissiveIntensity: 1 }));
    green.position.set(0, 2.15, 0.16); sg.add(green);
    sg.position.copy(p).add(side).setY(0.05);
    add(sg);
  }
  function buildSiding(tSw: number): void {
    const p = curve.getPointAt(tSw);
    const out = p.clone().setY(0).normalize();
    const sd = new THREE.Group();
    for (const off of [-0.45, 0.45]) {
      const rail = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.08, 5.5), mat(0x9aa5b5));
      rail.position.set(off, 0.38, 2.75); sd.add(rail);
    }
    for (let z = 0.4; z < 5.5; z += 0.7) {
      const sl = new THREE.Mesh(new THREE.BoxGeometry(1.4, 0.08, 0.4), mat(C.brownDark));
      sl.position.set(0, 0.26, z); sd.add(sl);
    }
    const shed = new THREE.Mesh(new THREE.BoxGeometry(2.6, 2.2, 2.4), mat(0xd98a6a));
    shed.position.set(0, 1.1, 6.6); shed.castShadow = true; sd.add(shed);
    const shedRoof = new THREE.Mesh(new THREE.BoxGeometry(3, 0.2, 2.8), mat(C.dark));
    shedRoof.position.set(0, 2.3, 6.6); sd.add(shedRoof);
    const door = new THREE.Mesh(new THREE.BoxGeometry(1.6, 1.7, 0.08), mat(C.yellow));
    door.position.set(0, 0.85, 5.38); sd.add(door);
    const lever = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 1.1, 6), mat(C.yellow));
    lever.position.set(1.3, 0.55, 0.3); lever.rotation.z = 0.5; lever.castShadow = true; sd.add(lever);
    sd.position.copy(p).addScaledVector(out, 0.8).setY(0.02);
    sd.lookAt(sd.position.clone().add(out));
    add(sd);
  }

  return {
    group: g, kind: 'railroad', seed,
    curve, trackLen, railTop: RAIL_TOP, headT, railcarGap: RAILCAR_GAP,
    loco, car1, car2, placeOnTrack,
    poi: { bridgeCenter, stationTs, hillC, riverZ, tunnelC: hillC },
  };
}
