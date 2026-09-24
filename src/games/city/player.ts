// Player vehicle: configs, arcade physics per movement kind (ground, heli,
// plane, boat), collision and crash-resume. The kid's train is driven by the Railway (railway.ts).
import * as THREE from 'three';
import { makeCar, makeFireTruck, makeHelicopter, makePlane } from '../../kit/index.js';
import { spawnVehicle, wheelNodes } from '../../engine/assets.js';
import { cityAt } from '../../worlds/cityGrid.js';
import { CENTER } from '../../worlds/world.js';
import { coastFor } from '../../worlds/coast.js';
import { cityPlanFor } from '../../worlds/cityPlan.js';
import { bridgeLayout } from './bridge.js';
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
  front: number;
  halfW: number;
  frontR: number;
  /** model scale (procedural aircraft are drawn small) */
  scale?: number;
}

const groundCar = (make: () => THREE.Group, glb: string, glbLen: number, over: Partial<VehicleConfig> = {}): VehicleConfig => ({
  make, glb, glbLen, kind: 'ground', fly: false,
  accel: 6.5, brake: 15, maxF: 12, maxR: 3, radius: 1.0,
  camBack: 11, camUp: 5.2, highBack: 12, highUp: 11.5, highAhead: 6,
  wheelbase: 2.7, steerMax: 0.5, cabF: 1.8, cabY: 1.6,
  front: 1.5, halfW: 0.95, frontR: 0.95,
  ...over,
});

const heli = (body: number, band: number): VehicleConfig => ({
  make: () => makeHelicopter({ body, band }), glb: '', glbLen: 7.8, kind: 'heli', fly: true,
  accel: 9, brake: 12, maxF: 13, maxR: 6, radius: 2.6,
  camBack: 17, camUp: 8.5, highBack: 20, highUp: 15, highAhead: 8,
  wheelbase: 4, steerMax: 1.0, cabF: 4.6, cabY: 3.4,
  front: 3, halfW: 2.2, frontR: 2, scale: 1.5,
});

export const VEHICLES: Record<string, VehicleConfig> = {
  truck: groundCar(makeFireTruck, '/assets/kenney/firetruck.glb', 6.6, {
    accel: 5, brake: 13, maxF: 9.5, radius: 1.35,
    camBack: 12.5, camUp: 5.6, highBack: 14, highUp: 13,
    wheelbase: 3.6, steerMax: 0.46, cabF: 3.0, cabY: 2.9,
    front: 1.95, halfW: 1.15, frontR: 1.05,
  }),
  police: groundCar(() => makeCar({ body: 0x5a7fb5 }), '/assets/kenney/police.glb', 4.6, {
    maxF: 12.5, radius: 1.05,
  }),
  ambulance: groundCar(() => makeCar({ body: 0xfaf7ef }), '/assets/kenney/ambulance.glb', 5.4, {
    accel: 5.8, maxF: 11, radius: 1.2, camBack: 12, camUp: 5.4,
    wheelbase: 3.1, steerMax: 0.48, cabF: 2.2, cabY: 2.3, front: 1.8, halfW: 1.05, frontR: 1.0,
  }),
  car: groundCar(() => makeCar({ body: 0x7fb2d9 }), '/assets/kenney/hatchback-sports.glb', 4.2),
  heli: heli(0xfaf7ef, 0xe25c5c),
  heliMedical: heli(0xfaf7ef, 0xe25c5c),
  heliPolice: heli(0x5a7fb5, 0xfaf7ef),
  plane: {
    make: () => makePlane(), glb: '', glbLen: 8, kind: 'plane', fly: true,
    accel: 6, brake: 7, maxF: 24, maxR: 0, radius: 3,
    camBack: 22, camUp: 7.5, highBack: 28, highUp: 18, highAhead: 10,
    wheelbase: 4, steerMax: 0.9, cabF: 2.4, cabY: 1.6,
    front: 3, halfW: 3.6, frontR: 2, scale: 1.4,
  },
  boat: {
    make: () => new THREE.Group(), glb: '/assets/kenney/watercraft/boat-speed-a.glb', glbLen: 6.5, kind: 'boat', fly: false,
    accel: 6, brake: 8, maxF: 14, maxR: 3, radius: 2,
    camBack: 15, camUp: 6.5, highBack: 18, highUp: 14, highAhead: 8,
    wheelbase: 3.4, steerMax: 0.6, cabF: 1.2, cabY: 2.2,
    front: 3, halfW: 1.4, frontR: 1.4,
  },
  train: {
    make: () => new THREE.Group(), glb: '', glbLen: 9, kind: 'rail', fly: false,
    accel: 2.4, brake: 5.5, maxF: 12, maxR: 0, radius: 2,
    // the kid's train is ~30 m long: the chase camera rides behind all of it
    camBack: 40, camUp: 13, highBack: 48, highUp: 24, highAhead: 12,
    wheelbase: 9, steerMax: 0, cabF: 3.5, cabY: 3.1,
    front: 4.5, halfW: 1.6, frontR: 1.6,
  },
  kart: groundCar(() => makeCar({ body: 0xe25c5c }), '/assets/kenney/toycar/vehicle-racer.glb', 4, {
    accel: 10, brake: 14, maxF: 15, maxR: 4, radius: 1.2,
    camBack: 10, camUp: 4.6, highBack: 12, highUp: 11,
    wheelbase: 2.4, steerMax: 0.6, cabF: 1.6, cabY: 1.5, front: 1.4, halfW: 0.9, frontR: 0.9,
  }),
};

/** cruise altitudes: the helicopter hovers low over the rooftops, the plane
 * flies higher (it climbs/dives to each ring on its own) */
export const HELI_ALT = 16;
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
  const p: Player = {
    car, V,
    state: {
      x, z, heading, v: V.kind === 'plane' ? PLANE_MIN_V : 0,
      alt: V.kind === 'heli' ? HELI_ALT : V.kind === 'plane' ? PLANE_ALT : 0,
    },
    wheels: [],
    crashT: 0,
    crash: { x: 0, z: 0, heading: 0 },
  };
  if (V.glb) {
    // swap in the CC0 Kenney model once it streams in; procedural stays if it fails
    // (Kenney vehicles already face +Z — our forward — no flip needed)
    spawnVehicle(V.glb, { len: V.glbLen }).then(g => {
      // keep any extras the game hung on the car (lightbar, winch)
      for (const ch of [...car.children]) if (!ch.userData.extra) car.remove(ch);
      // roof height of the kit model (measured before parenting, so in car
      // space), so the lightbar can sit on it
      car.userData.top = new THREE.Box3().setFromObject(g).max.y;
      car.add(g);
      p.wheels = wheelNodes(g) as THREE.Object3D[];
    }).catch(() => {});
  }
  return p;
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
    // simplified helicopter: hover-drive at a fixed altitude, above it all
    if (input.gas) st.v = Math.min(V.maxF, st.v + V.accel * dt);
    if (input.brake) st.v = Math.max(-V.maxF * 0.5, st.v - V.brake * dt);
    st.v -= st.v * 0.5 * dt;
    st.heading += input.steer * 1.0 * dt * (0.35 + Math.abs(st.v) / V.maxF);
    st.x += Math.sin(st.heading) * st.v * dt;
    st.z += Math.cos(st.heading) * st.v * dt;
    st.alt = HELI_ALT;
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
    st.heading += input.steer * V.steerMax * dt;
    st.alt += Math.max(-6 * dt, Math.min(6 * dt, altTarget - st.alt));
    st.x += Math.sin(st.heading) * st.v * dt;
    st.z += Math.cos(st.heading) * st.v * dt;
    return { crashed: false };
  }

  if (V.kind === 'boat') {
    // on the water: gas/brake/steer like a light car with a long glide; the
    // shore (any island) is a soft wall — the boat slides along it and slows,
    // it never "crashes"
    if (input.gas) st.v = Math.min(V.maxF, st.v + V.accel * dt);
    if (input.brake) st.v = Math.max(-V.maxR, st.v - V.brake * dt);
    if (!input.gas && !input.brake) st.v -= st.v * 0.6 * dt;
    st.heading += input.steer * V.steerMax * dt * Math.min(1, 0.3 + Math.abs(st.v) / 6) * Math.sign(st.v || 1);
    const nx = st.x + Math.sin(st.heading) * st.v * dt;
    const nz = st.z + Math.cos(st.heading) * st.v * dt;
    const blockX = onLand(nx, st.z, V.radius), blockZ = onLand(st.x, nz, V.radius);
    if (!blockX) st.x = nx;
    if (!blockZ) st.z = nz;
    if (blockX || blockZ) st.v *= 1 - Math.min(0.9, dt * 3);
    st.alt = 0;
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

/** can a road vehicle stand at world (x, z)? Dry land, a causeway deck (the
 * exit corridors out over the strait) or the picnic bridge and its island. */
export function onGround(x: number, z: number): boolean {
  const c = cityAt(x, z);
  const lx = x - c.ox, lz = z - c.oz;
  if (coastFor(c.bx, c.by).inLand(lx, lz, -1)) return true;
  const ex = cityPlanFor(c.bx, c.by).exits;
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
  // a causeway deck too low to sail under is a wall too (the raised span
  // in the middle clears the boats)
  const dk = deckAt(x, z);
  return !!dk && dk.y < BOAT_CLEAR;
}
