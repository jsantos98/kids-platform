// Player vehicle: configs, arcade physics per movement kind (ground, heli,
// plane, boat), collision and crash-resume. The kid's train is driven by the Railway (railway.ts).
import * as THREE from 'three';
import { makeCar, makeFireTruck, makeHelicopter, makePlane } from '../../kit/index.js';
import { spawnVehicle, wheelNodes } from '../../engine/assets.js';
import { cityAt, southExit, eastExit } from '../../worlds/cityGrid.js';
import { CENTER } from '../../worlds/world.js';
import { coastFor } from '../../worlds/coast.js';
import { cityPlanFor } from '../../worlds/cityPlan.js';
import { bridgeLayout } from './bridge.js';
import { harbourBlocks } from './harbour.js';
import { onIslet } from './islets.js';
import { deckAt, BOAT_CLEAR } from '../../worlds/causeway.js';
import { inBox, type CollisionBox } from '../../worlds/cityChunk.js';

/** how a vehicle moves: on the streets, hovering, flying, sailing or on rails */
export type MoveKind = 'ground' | 'heli' | 'plane' | 'boat' | 'rail';

export interface VehicleConfig {
  /** procedural fallback model (shown until the GLB streams in) */
  make: () => THREE.Group;
  /** GLB swapped in when loaded ('' = procedural only) */
  glb: string;
  glbLen: number;
  /** the model's own turn to face +z (a kit that models its vehicles facing
   * -z, like the Toy Car Kit, needs π — R15) */
  glbYaw?: number;
  kind: MoveKind;
  /** airborne: ignores collisions, the camera rides at its altitude */
  fly: boolean;
  accel: number;
  brake: number;
  maxF: number;
  maxR: number;
  radius: number;
  camBack: number;
  camUp: number;
  highBack: number;
  highUp: number;
  highAhead: number;
  wheelbase: number;
  steerMax: number;
  cabF: number;
  cabY: number;
  /** how far ahead of the vehicle the chase camera looks (m) */
  camAhead: number;
  front: number;
  halfW: number;
  frontR: number;
  /** model scale (procedural aircraft are drawn small) */
  scale?: number;
}

const groundCar = (make: () => THREE.Group, glb: string, glbLen: number, over: Partial<VehicleConfig> = {}): VehicleConfig => ({
  make, glb, glbLen, kind: 'ground', fly: false,
  accel: 6.5, brake: 15, maxF: 12, maxR: 3, radius: 1.0,
  camBack: 11, camUp: 9.8, camAhead: 10, highBack: 12, highUp: 19, highAhead: 6,
  wheelbase: 2.7, steerMax: 0.5, cabF: 1.8, cabY: 1.6,
  front: 1.5, halfW: 0.95, frontR: 0.95,
  ...over,
});

const heli = (body: number, band: number): VehicleConfig => ({
  make: () => makeHelicopter({ body, band }), glb: '', glbLen: 7.8, kind: 'heli', fly: true,
  accel: 9, brake: 12, maxF: 13, maxR: 6, radius: 2.6,
  camBack: 17, camUp: 13, camAhead: 12, highBack: 20, highUp: 29, highAhead: 8,
  wheelbase: 4, steerMax: 1.0, cabF: 4.6, cabY: 3.4,
  front: 3, halfW: 2.2, frontR: 2, scale: 1.5,
});

export const VEHICLES: Record<string, VehicleConfig> = {
  truck: groundCar(makeFireTruck, '/assets/kenney/firetruck.glb', 6.6, {
    accel: 5, brake: 13, maxF: 9.5, radius: 1.35,
    camBack: 12.5, camUp: 10.4, highBack: 14, highUp: 21,
    wheelbase: 3.6, steerMax: 0.46, cabF: 3.0, cabY: 2.9,
    front: 1.95, halfW: 1.15, frontR: 1.05,
  }),
  police: groundCar(() => makeCar({ body: 0x5a7fb5 }), '/assets/kenney/police.glb', 4.6, {
    maxF: 12.5, radius: 1.05,
  }),
  ambulance: groundCar(() => makeCar({ body: 0xfaf7ef }), '/assets/kenney/ambulance.glb', 5.4, {
    accel: 5.8, maxF: 11, radius: 1.2, camBack: 12, camUp: 10.2,
    wheelbase: 3.1, steerMax: 0.48, cabF: 2.2, cabY: 2.3, front: 1.8, halfW: 1.05, frontR: 1.0,
  }),
  car: groundCar(() => makeCar({ body: 0x7fb2d9 }), '/assets/kenney/hatchback-sports.glb', 4.2),
  // the tow truck (G17): the Car Kit's red flatbed — the one in the traffic —
  // a little bigger than the traffic's (5.4 m) so a car fits on its bed
  tow: groundCar(() => makeCar({ body: 0xd8503a }), '/assets/kenney/delivery-flat.glb', 6.8, {
    accel: 5.5, brake: 14, maxF: 11, radius: 1.3,
    camBack: 12.5, camUp: 10.4, highBack: 14, highUp: 21,
    wheelbase: 3.4, steerMax: 0.47, cabF: 3.0, cabY: 2.5,
    front: 1.9, halfW: 1.1, frontR: 1.0,
  }),
  // the garbage truck (G17): the Car Kit's, the one in the traffic
  garbage: groundCar(() => makeCar({ body: 0x3f9a4a }), '/assets/kenney/garbage-truck.glb', 6.5, {
    accel: 5, brake: 13, maxF: 9.5, radius: 1.35,
    camBack: 12.5, camUp: 10.4, highBack: 14, highUp: 21,
    wheelbase: 3.6, steerMax: 0.46, cabF: 3.0, cabY: 2.8,
    front: 1.95, halfW: 1.15, frontR: 1.05,
  }),
  heli: heli(0xfaf7ef, 0xe25c5c),
  heliMedical: heli(0xfaf7ef, 0xe25c5c),
  heliPolice: heli(0x5a7fb5, 0xfaf7ef),
  plane: {
    make: () => makePlane(), glb: '', glbLen: 8, kind: 'plane', fly: true,
    accel: 6, brake: 7, maxF: 24, maxR: 0, radius: 3,
    // (a little lower than the others, 18°: the rings it climbs to stay in view)
    camBack: 22, camUp: 13, camAhead: 14, highBack: 28, highUp: 39, highAhead: 10,
    wheelbase: 4, steerMax: 0.9, cabF: 2.4, cabY: 1.6,
    front: 3, halfW: 3.6, frontR: 2, scale: 1.4,
  },
  boat: {
    make: () => new THREE.Group(), glb: '/assets/kenney/watercraft/boat-speed-a.glb', glbLen: 6.5, kind: 'boat', fly: false,
    accel: 6, brake: 8, maxF: 14, maxR: 3, radius: 2,
    camBack: 15, camUp: 12.2, camAhead: 12, highBack: 18, highUp: 27, highAhead: 8,
    wheelbase: 3.4, steerMax: 0.6, cabF: 1.2, cabY: 2.2,
    front: 3, halfW: 1.4, frontR: 1.4,
  },
  // the police boat (G15): the blue and white speedboat, quicker than the
  // speedboats it pulls over (they run at 10 m/s)
  policeBoat: {
    make: () => new THREE.Group(), glb: '/assets/kenney/watercraft/boat-speed-g.glb', glbLen: 7, kind: 'boat', fly: false,
    accel: 6.5, brake: 8, maxF: 15, maxR: 3, radius: 2,
    camBack: 15, camUp: 12.2, camAhead: 12, highBack: 18, highUp: 27, highAhead: 8,
    wheelbase: 3.4, steerMax: 0.6, cabF: 1.2, cabY: 2.2,
    front: 3, halfW: 1.4, frontR: 1.4,
  },
  // the pirate ship (G15): a boat on the same water, bigger and slower to turn
  pirate: {
    make: () => new THREE.Group(), glb: '/assets/kenney/pirate/ship-pirate-medium.glb', glbLen: 16, kind: 'boat', fly: false,
    accel: 3.2, brake: 4.5, maxF: 11, maxR: 2.5, radius: 4.2,
    camBack: 30, camUp: 20, camAhead: 16, highBack: 34, highUp: 48, highAhead: 10,
    wheelbase: 8, steerMax: 0.42, cabF: 5.5, cabY: 6,
    front: 8, halfW: 3.4, frontR: 3.4,
  },
  train: {
    make: () => new THREE.Group(), glb: '', glbLen: 9, kind: 'rail', fly: false,
    accel: 2.4, brake: 5.5, maxF: 12, maxR: 0, radius: 2,
    // the kid's train is ~30 m long: the chase camera rides behind all of it
    camBack: 40, camUp: 25.5, camAhead: 20, highBack: 48, highUp: 60, highAhead: 12,
    wheelbase: 9, steerMax: 0, cabF: 3.5, cabY: 3.1,
    front: 4.5, halfW: 1.6, frontR: 1.6,
  },
  // the race car: the Car Kit's F1 (race.glb, facing +z like the rest of
  // the kit), long and low — 4.4 m by 2.1 m, wheels 2.6 m apart
  kart: groundCar(() => makeCar({ body: 0xe25c5c }), '/assets/kenney/race.glb', 4.4, {
    accel: 10, brake: 14, maxF: 15, maxR: 4, radius: 1.2,
    camBack: 10, camUp: 9.4, highBack: 12, highUp: 19,
    wheelbase: 2.6, steerMax: 0.6, cabF: 1.2, cabY: 1.2, front: 2.2, halfW: 1.05, frontR: 1.0,
  }),
};

/** cruise altitudes: the helicopter hovers low over the rooftops, the plane
 * flies higher (it climbs/dives to each ring on its own) */
export const HELI_ALT = 16;
/** the helicopter over the roofs: it clears the tallest ahead by HELI_CLEAR,
 * climbing up to HELI_CLIMB m/s and sinking back at HELI_SINK; its body
 * (radius HELI_BODY) hangs HELI_SKIDS below its origin */
const HELI_CLEAR = 4.5, HELI_CLIMB = 9, HELI_SINK = 3, HELI_BODY = 1.6, HELI_SKIDS = 1.5;
export const PLANE_ALT = 30;
const PLANE_MIN_V = 11;

export interface PlayerState {
  x: number;
  z: number;
  heading: number;
  v: number;
  /** altitude of the vehicle's origin (0 on the ground) */
  alt: number;
}

export interface Player {
  car: THREE.Group;
  V: VehicleConfig;
  state: PlayerState;
  wheels: THREE.Object3D[];
  /** >0 while flashing after a bump */
  crashT: number;
  /** where + how to resume (always on a road lane) */
  crash: { x: number; z: number; heading: number };
  /** the plane's steering, eased (keys are all-or-nothing): it turns and
   * banks into the turn smoothly */
  steerS: number;
}

export interface PhysicsInput {
  gas: number;
  brake: number;
  steer: number;
}

const CRASH_FLASH = 1.6;

export function createPlayer(V: VehicleConfig, x: number, z: number, heading: number): Player {
  const car = V.make();
  car.scale.setScalar(V.scale ?? 1);
  // (heading first, then the pitch and roll about the vehicle's own axes: in
  // the default order the nose-up of a boat speeding up, a helicopter's nose
  // dip or a car's pitch on a causeway ramp turned about the world's x axis,
  // a sideways lean whenever it headed east or west)
  car.rotation.order = 'YXZ';
  const p: Player = {
    car, V,
    state: {
      x, z, heading, v: V.kind === 'plane' ? PLANE_MIN_V : 0,
      alt: V.kind === 'heli' ? HELI_ALT : V.kind === 'plane' ? PLANE_ALT : 0,
    },
    wheels: [],
    crashT: 0,
    crash: { x: 0, z: 0, heading: 0 },
    steerS: 0,
  };
  if (V.glb) {
    // swap in the CC0 Kenney model once it streams in; procedural stays if it fails
    // (Kenney vehicles already face +Z — our forward — no flip needed)
    spawnVehicle(V.glb, { len: V.glbLen, yaw: V.glbYaw ?? 0 }).then(g => {
      // keep any extras the game hung on the car (lightbar, winch)
      for (const ch of [...car.children]) if (!ch.userData.extra) car.remove(ch);
      // roof height of the kit model (measured before parenting, so in car
      // space), so the lightbar can sit on it
      car.userData.top = new THREE.Box3().setFromObject(g).max.y;
      // its own roof lamps, flashed when the siren is on (index.ts)
      car.userData.siren = sirenLampsOf(g);
      car.add(g);
      p.wheels = wheelNodes(g) as THREE.Object3D[];
    }).catch(() => {});
  }
  return p;
}

/** a siren lamp flashes between its lit and dim colour (`userData.lit` /
 * `userData.dim`); `userData.always` keeps it showing while off (a lamp
 * built onto the vehicle, not an overlay on the model's own paint) */
export interface SirenLamps { red: THREE.Mesh[]; blue: THREE.Mesh[] }

const LIT = { red: 0xff2a1a, blue: 0x4a8cff }, DIM = { red: 0x3a1010, blue: 0x10183a };

/**
 * The lamps of a Car Kit model's roof light bar, as flash overlays: the faces
 * near the top of the model that sample the palette's bottom-row red / blue
 * swatches (probed: u 0.25-0.375 red, 0.375-0.5 blue, v > 0.75), copied into
 * meshes laid a hair over them. `red` flashes on one beat and `blue` on the
 * other; a model with lamps of one colour only (the fire truck's and the
 * ambulance's are all blue) flashes its left and right halves in turn —
 * asking for both colours sent them the game's invented roof bar. null when
 * the model has none.
 */
export function sirenLampsOf(root: THREE.Object3D): SirenLamps | null {
  root.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(root);
  const band = box.max.y - (box.max.y - box.min.y) * 0.2;
  const midX = (box.min.x + box.max.x) / 2;
  const meshes: THREE.Mesh[] = [];
  root.traverse(o => { if ((o as THREE.Mesh).isMesh) meshes.push(o as THREE.Mesh); });
  const v = new THREE.Vector3();
  // every lamp face: its mesh, colour, side and corners (mesh-local)
  const faces: Array<{ m: THREE.Mesh; kind: 'red' | 'blue'; left: boolean; pts: number[] }> = [];
  for (const m of meshes) {
    const g = m.geometry as THREE.BufferGeometry;
    const pos = g.attributes.position as THREE.BufferAttribute, uv = g.attributes.uv as THREE.BufferAttribute | undefined;
    if (!pos || !uv) continue;
    const idx = g.index;
    const n = idx ? idx.count : pos.count;
    const at = (k: number): number => (idx ? idx.getX(k) : k);
    for (let t = 0; t + 2 < n; t += 3) {
      let u = 0, w = 0, x = 0, y = 0;
      for (let k = 0; k < 3; k++) {
        const i = at(t + k);
        u += uv.getX(i) / 3; w += uv.getY(i) / 3;
        v.fromBufferAttribute(pos, i).applyMatrix4(m.matrixWorld);
        x += v.x / 3; y += v.y / 3;
      }
      if (y < band || w < 0.75) continue;
      const kind = u >= 0.25 && u < 0.375 ? 'red' : u >= 0.375 && u < 0.5 ? 'blue' : null;
      if (!kind) continue;
      const pts: number[] = [];
      for (let k = 0; k < 3; k++) { const i = at(t + k); pts.push(pos.getX(i), pos.getY(i), pos.getZ(i)); }
      faces.push({ m, kind, left: x < midX, pts });
    }
  }
  if (!faces.length) return null;
  const both = faces.some(f => f.kind === 'red') && faces.some(f => f.kind === 'blue');
  const out: SirenLamps = { red: [], blue: [] };
  // group the faces per mesh and beat, one overlay each
  const groups = new Map<string, { m: THREE.Mesh; beat: 'red' | 'blue'; colour: 'red' | 'blue'; pts: number[] }>();
  for (const f of faces) {
    const beat = both ? f.kind : f.left ? 'red' : 'blue';
    const key = `${f.m.uuid}:${beat}`;
    let gr = groups.get(key);
    if (!gr) groups.set(key, gr = { m: f.m, beat, colour: f.kind, pts: [] });
    gr.pts.push(...f.pts);
  }
  for (const gr of groups.values()) {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(gr.pts, 3));
    const lamp = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({
      color: LIT[gr.colour], polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2, toneMapped: false,
    }));
    lamp.userData.lit = LIT[gr.colour];
    lamp.userData.dim = DIM[gr.colour];
    lamp.visible = false;
    lamp.renderOrder = 1;
    gr.m.add(lamp);
    out[gr.beat].push(lamp);
  }
  return out;
}

/** a helicopter's own siren lamps: two small domes on the sides of its belly
 * band (red left, blue right on the police one; both blue on the medical
 * one), part of the model rather than a bar on its roof */
export function heliSirenLamps(car: THREE.Object3D, police: boolean): SirenLamps {
  const out: SirenLamps = { red: [], blue: [] };
  for (const [side, colour] of [[1, police ? 'red' : 'blue'], [-1, 'blue']] as Array<[number, 'red' | 'blue']>) {
    const lamp = new THREE.Mesh(new THREE.SphereGeometry(0.16, 10, 8), new THREE.MeshBasicMaterial({ color: DIM[colour], toneMapped: false }));
    lamp.position.set(side * 0.8, 1.08, 1.25);
    lamp.scale.set(0.6, 1, 1.3);
    lamp.userData.lit = LIT[colour];
    lamp.userData.dim = DIM[colour];
    lamp.userData.always = true;
    car.add(lamp);
    out[side > 0 ? 'red' : 'blue'].push(lamp);
  }
  return out;
}

/** begin the flash-and-resume sequence (bump or stuck). The caller sets
 * `p.crash` to the resume spot; the vehicle jumps there when the flashing ends. */
export function startCrash(p: Player): void {
  p.crashT = CRASH_FLASH;
  p.state.v = 0;
  p.crash.x = p.state.x; p.crash.z = p.state.z; p.crash.heading = p.state.heading;
}

export interface PhysicsStep {
  /** true when a crash was just registered (caller shows OOPS + thud) */
  crashed: boolean;
}

export function physicsStep(
  p: Player, input: PhysicsInput, dt: number, boxes: CollisionBox[],
  /** plane only: the altitude to climb/dive toward (the next ring) */
  altTarget = PLANE_ALT,
): PhysicsStep {
  const { state: st, V } = p;

  if (V.kind === 'heli') {
    // simplified helicopter: hover-drive at HELI_ALT, and forgiving — it
    // climbs over any roof in its way by itself (looking ahead along its
    // path, slowing down if a tower needs a longer climb) and sinks back
    // once past; brushing a wall only slides it along; just flying head-on
    // into a wall it hasn't cleared is a bump like the truck's: it flashes,
    // then carries on from just back along its path, still facing the same
    // way (G1)
    if (p.crashT > 0) {
      p.crashT -= dt;
      p.car.visible = (Math.floor(performance.now() / 1000 * 9) % 2) === 0;
      if (p.crashT <= 0) {
        st.x = p.crash.x; st.z = p.crash.z; st.heading = p.crash.heading;
        st.v = 0;
        p.car.visible = true;
      }
      return { crashed: false };
    }
    if (input.gas) st.v = Math.min(V.maxF, st.v + V.accel * dt);
    if (input.brake) st.v = Math.max(-V.maxF * 0.5, st.v - V.brake * dt);
    st.v -= st.v * 0.5 * dt;
    st.heading += input.steer * 1.0 * dt * (0.35 + Math.abs(st.v) / V.maxF);
    // the roofs ahead: climb to clear the tallest by HELI_CLEAR
    const dir = st.v < 0 ? -1 : 1;
    const fx = Math.sin(st.heading) * dir, fz = Math.cos(st.heading) * dir;
    const reach = 10 + Math.abs(st.v) * 2.5;
    let roof = 0, roofD = Infinity;
    for (const b of boxes) {
      const top = b.top ?? 0;
      if (top + HELI_CLEAR <= HELI_ALT || top <= roof) continue;
      for (let d = 0; d <= reach; d += 2) {
        if (inBox(b, st.x + fx * d, st.z + fz * d, HELI_BODY + 1.5)) { roof = top; roofD = d; break; }
      }
    }
    const want = Math.max(HELI_ALT, roof + HELI_CLEAR);
    st.alt += Math.max(-HELI_SINK * dt, Math.min(HELI_CLIMB * dt, want - st.alt));
    // (a tower that needs a longer climb than the way to it allows: ease off)
    if (want > st.alt + 0.5 && roofD < Infinity) {
      const vMax = Math.max(2, (roofD - HELI_BODY) / ((want - st.alt) / HELI_CLIMB));
      if (Math.abs(st.v) > vMax) st.v = Math.sign(st.v) * vMax;
    }
    // only the body counts (the rotor tips over a roof edge are forgiven),
    // against what still reaches up to the skids
    const hits = (x: number, z: number): boolean =>
      boxes.some(b => (b.top ?? 0) > st.alt - HELI_SKIDS && inBox(b, x, z, HELI_BODY));
    const nx = st.x + Math.sin(st.heading) * st.v * dt;
    const nz = st.z + Math.cos(st.heading) * st.v * dt;
    if (!hits(nx, nz)) { st.x = nx; st.z = nz; return { crashed: false }; }
    // a glancing touch: slide along the wall
    if (!hits(nx, st.z)) { st.x = nx; st.v *= 1 - Math.min(0.5, dt * 2); return { crashed: false }; }
    if (!hits(st.x, nz)) { st.z = nz; st.v *= 1 - Math.min(0.5, dt * 2); return { crashed: false }; }
    if (Math.abs(st.v) > 5) {
      startCrash(p);
      // resume just back along the path, at the first clear spot
      const bx = -Math.sin(p.crash.heading), bz = -Math.cos(p.crash.heading);
      for (let d = 6; d <= 60; d += 1) {
        const x = p.crash.x + bx * d, z = p.crash.z + bz * d;
        if (!hits(x, z)) { p.crash.x = x; p.crash.z = z; break; }
      }
      return { crashed: true };
    }
    st.v = 0; // nudging it slowly just stops
    return { crashed: false };
  }

  if (V.kind === 'plane') {
    // the plane can never stall or crash: it always flies at least
    // PLANE_MIN_V, gas speeds it up, brake slows it back down, the wheel
    // banks it round, and it finds each ring's height by itself
    if (input.gas) st.v = Math.min(V.maxF, st.v + V.accel * dt);
    else if (input.brake) st.v = Math.max(PLANE_MIN_V, st.v - V.brake * dt);
    else st.v += (Math.max(PLANE_MIN_V, Math.min(st.v, 18)) - st.v) * Math.min(1, dt * 0.3);
    st.v = Math.max(PLANE_MIN_V, st.v);
    p.steerS += (input.steer - p.steerS) * Math.min(1, dt * 2.5);
    st.heading += p.steerS * V.steerMax * dt;
    st.alt += Math.max(-6 * dt, Math.min(6 * dt, altTarget - st.alt));
    st.x += Math.sin(st.heading) * st.v * dt;
    st.z += Math.cos(st.heading) * st.v * dt;
    return { crashed: false };
  }

  if (V.kind === 'boat') {
    // on the water: gas/brake/steer like a light car with a long glide; the
    // shore (any island), the picnic bridge and island and the pier are a
    // soft wall — the boat slides along them and slows; running into the
    // lighthouse, the anchored ship or anything else standing up out of the
    // water above 2 m/s is a crash: it flashes and the caller resumes it on
    // clear water behind (G14 — before, it sailed through all of them)
    st.alt = 0;
    if (p.crashT > 0) {
      p.crashT -= dt;
      p.car.visible = (Math.floor(performance.now() / 1000 * 9) % 2) === 0;
      if (p.crashT <= 0) {
        st.x = p.crash.x; st.z = p.crash.z;
        st.heading = p.crash.heading;
        st.v = 0;
        p.car.visible = true;
      }
      return { crashed: false };
    }
    if (input.gas) st.v = Math.min(V.maxF, st.v + V.accel * dt);
    if (input.brake) st.v = Math.max(-V.maxR, st.v - V.brake * dt);
    if (!input.gas && !input.brake) st.v -= st.v * 0.6 * dt;
    const h0 = st.heading;
    const h1 = h0 + input.steer * V.steerMax * dt * Math.min(1, 0.3 + Math.abs(st.v) / 6) * Math.sign(st.v || 1);
    const nx = st.x + Math.sin(h1) * st.v * dt;
    const nz = st.z + Math.cos(h1) * st.v * dt;
    // (only what stands up out of the water counts: a box a boat can hit,
    // not the little ones round the picnic island's trees)
    const hit = boxes.some(b => !b.small && inBox(b, nx, nz, V.radius) && !inBox(b, st.x, st.z, V.radius));
    if (hit) {
      if (Math.abs(st.v) > 2) { startCrash(p); return { crashed: true }; }
      st.v *= 0.3;
      st.heading = h1;
      return { crashed: false };
    }
    // the hull against the shore, the pier and the picnic island: a long
    // ship (the pirate's, 16 m) has its bow and stern too, not just its
    // middle — the middle alone let its ends swing into the pier (G14); and
    // a ship already touching may always move so long as it goes no deeper
    // (it backs out from however deep it got): moving x and z apart, a diagonal step slipped it into
    // the pier's edge and every step after that counted as blocked, so it
    // was stuck there for good
    const len = V.glbLen ?? 0;
    const blocked = (x: number, z: number, h: number, give: number): boolean => {
      if (onLand(x, z, V.radius - give)) return true;
      if (len < 10) return false;
      const e = len / 2 - V.halfW, r = V.halfW - give;
      return onLand(x + Math.sin(h) * e, z + Math.cos(h) * e, r) || onLand(x - Math.sin(h) * e, z - Math.cos(h) * e, r);
    };
    // (how deep in it is: the least it must give to be clear)
    const depth = (x: number, z: number, h: number): number => {
      for (const g of [0, 0.4, 0.8, 1.2, 1.8, 2.5, 3.2, 4]) if (!blocked(x, z, h, g)) return g;
      return 9;
    };
    const d0 = depth(st.x, st.z, h0);
    const ok = (x: number, z: number, h: number): boolean => (d0 === 0 ? !blocked(x, z, h, 0) : depth(x, z, h) <= d0);
    if (ok(nx, nz, h1)) { st.x = nx; st.z = nz; st.heading = h1; return { crashed: false }; }
    // (sliding along it: one way or the other, or only turning)
    if (ok(nx, st.z, h1)) { st.x = nx; st.heading = h1; }
    else if (ok(st.x, nz, h1)) { st.z = nz; st.heading = h1; }
    else if (ok(st.x, st.z, h1)) st.heading = h1;
    st.v *= 1 - Math.min(0.9, dt * 3);
    return { crashed: false };
  }

  // arcade physics (heavier for the truck)
  if (input.gas) st.v += V.accel * dt;
  if (input.brake) st.v -= (st.v > 0 ? V.brake : 7) * dt;
  if (!input.gas && !input.brake) st.v -= Math.sign(st.v) * Math.min(Math.abs(st.v), 6 * dt);
  st.v -= st.v * 0.35 * dt;
  st.v = Math.max(-V.maxR, Math.min(V.maxF, st.v));

  const steerMax = V.steerMax / (1 + Math.abs(st.v) * 0.07);
  st.heading += input.steer * steerMax * (st.v / V.wheelbase) * dt;

  let crashed = false;
  if (p.crashT > 0) {
    // bumped into something: flash, then continue from a few meters back
    p.crashT -= dt;
    p.car.visible = (Math.floor(performance.now() / 1000 * 9) % 2) === 0;
    if (p.crashT <= 0) {
      st.x = p.crash.x; st.z = p.crash.z;
      st.heading = p.crash.heading;
      st.v = 0;
      p.car.visible = true;
    }
  } else {
    const nx = st.x + Math.sin(st.heading) * st.v * dt;
    const nz = st.z + Math.cos(st.heading) * st.v * dt;
    let hitX = false, hitZ = false, poleHit = false;
    for (const b of boxes) {
      if (b.small) {
        // poles (lights, lamps, trees): only a direct hit with the front of the
        // vehicle counts; side scratches are ignored
        const px2 = (b.x1 + b.x2) / 2, pz2 = (b.z1 + b.z2) / 2;
        const pr = Math.max(b.x2 - b.x1, b.z2 - b.z1) / 2 + V.frontR;
        const ddx = st.x + Math.sin(st.heading) * V.front - px2;
        const ddz = st.z + Math.cos(st.heading) * V.front - pz2;
        if (ddx * ddx + ddz * ddz < pr * pr) poleHit = true;
        continue;
      }
      if (b.obb) {
        // a footprint turned to its street: tested in its own frame
        if (inBox(b, nx, st.z, V.radius)) hitX = true;
        if (inBox(b, st.x, nz, V.radius)) hitZ = true;
        continue;
      }
      if (nx > b.x1 - V.radius && nx < b.x2 + V.radius && st.z > b.z1 - 0.8 && st.z < b.z2 + 0.8) hitX = true;
      if (st.x > b.x1 - 0.8 && st.x < b.x2 + 0.8 && nz > b.z1 - V.radius && nz < b.z2 + V.radius) hitZ = true;
    }
    // the shore is a soft wall: the sea stops the wheels like a scrape
    // (never a crash), so a kid who leaves the road on a beach just slides
    // along the waterline
    // (already off the land — a resume gone wrong — it may always move)
    // the parapets of a raised bridge deck are the same soft wall: up on
    // a river bridge the vehicle slides along its sides, never over them
    if (offDeckSide(st.x, st.z, nx, nz, V.halfW)) {
      if (!offDeckSide(st.x, st.z, nx, st.z, V.halfW)) st.x = nx;
      else if (!offDeckSide(st.x, st.z, st.x, nz, V.halfW)) st.z = nz;
      st.v *= 1 - Math.min(0.9, dt * 4);
      return { crashed: false };
    }
    if (!onGround(nx, nz) && onGround(st.x, st.z)) {
      if (onGround(nx, st.z)) st.x = nx;
      else if (onGround(st.x, nz)) st.z = nz;
      st.v *= 1 - Math.min(0.9, dt * 4);
      return { crashed: false };
    }
    if ((hitX || hitZ || (poleHit && Math.abs(st.v) > 1.0)) && Math.abs(st.v) > 1.4) {
      // crash! flash in place; the caller picks the resume spot (a
      // breadcrumb on the road behind — see breadcrumb.ts)
      startCrash(p);
      crashed = true;
    } else {
      if (!hitX) st.x = nx;
      if (!hitZ) st.z = nz;
      if (hitX || hitZ) st.v *= 0.4; // gentle scrape
    }
  }
  return { crashed };
}

/** would moving from (x, z) to (nx, nz) take a road vehicle off the side of
 * the river bridge it is on (anywhere but the ramp ends)? */
function offDeckSide(x: number, z: number, nx: number, nz: number, r: number): boolean {
  const dk = deckAt(x, z);
  if (!dk || !dk.river || dk.kind !== 'road' || dk.y < 0.25) return false;
  const d = dk.river, c = cityAt(x, z);
  // across the deck, the vehicle's side stays inside the parapet (moving
  // back inward is always fine)
  const acr = (px: number, pz: number): number => Math.abs((px - c.ox - d.ax) * d.uz - (pz - c.oz - d.az) * d.ux);
  const a1 = acr(nx, nz);
  return a1 > d.half - 0.6 - r && a1 > acr(x, z);
}

/** can a road vehicle stand at world (x, z)? Dry land, a causeway deck (the
 * exit corridors out over the strait) or the picnic bridge and its island. */
export function onGround(x: number, z: number): boolean {
  const c = cityAt(x, z);
  const lx = x - c.ox, lz = z - c.oz;
  if (coastFor(c.bx, c.by).inLand(lx, lz, -1)) return true;
  // (the exit lines straight from the grid: asking the plan could build a
  // neighbour island in the middle of a frame)
  const ex = { n: southExit(c.bx, c.by - 1), s: southExit(c.bx, c.by), w: eastExit(c.bx - 1, c.by), e: eastExit(c.bx, c.by) };
  const ON = 7.5;
  if (Math.abs(lx - ex.n * 64) < ON && lz < CENTER) return true;
  if (Math.abs(lx - ex.s * 64) < ON && lz > CENTER) return true;
  if (Math.abs(lz - ex.w * 64) < ON && lx < CENTER) return true;
  if (Math.abs(lz - ex.e * 64) < ON && lx > CENTER) return true;
  const b = bridgeLayout(c.bx, c.by);
  if (Math.abs(lx - b.X) < b.HALF_W && lz > b.Z0 - 2 && lz < b.Z1 + 2) return true;
  return lx > b.ISLE.x1 && lx < b.ISLE.x2 && lz > b.ISLE.z1 && lz < b.ISLE.z2;
}

/** would a boat of radius r at world (x, z) touch an island (beach
 * included)? The shore is each island's coast (coast.ts); the causeways are
 * bridges the boat passes under. */
export function onLand(x: number, z: number, r: number): boolean {
  const c = cityAt(x, z);
  if (coastFor(c.bx, c.by).inLand(x - c.ox, z - c.oz, -(r + 1.5))) return true;
  // the picnic bridge and island, the pier and its dinghies (G14), and the
  // treasure islets (G15)
  if (harbourBlocks(c.bx, c.by, x - c.ox, z - c.oz, r)) return true;
  if (onIslet(c.bx, c.by, x - c.ox, z - c.oz, r + 1)) return true;
  // a causeway deck too low to sail under is a wall too (the raised span
  // in the middle clears the boats)
  const dk = deckAt(x, z);
  return !!dk && dk.y < BOAT_CLEAR;
}
