// Player vehicle: configs, arcade physics, collision and crash-resume.
import * as THREE from 'three';
import { makeCar, makeFireTruck, makeHelicopter } from '../../kit/index.js';
import { spawnVehicle, wheelNodes } from '../../engine/assets.js';
import type { CollisionBox } from '../../worlds/cityChunk.js';

export interface VehicleConfig {
  /** procedural fallback model (shown until the GLB streams in) */
  make: () => THREE.Group;
  /** GLB swapped in when loaded ('' = procedural only) */
  glb: string;
  glbLen: number;
  /** flying vehicles hover at a fixed altitude and ignore collisions */
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
}

export const VEHICLES: Record<string, VehicleConfig> = {
  truck: {
    make: makeFireTruck, glb: '/assets/kenney/firetruck.glb', glbLen: 6.6, fly: false,
    accel: 5, brake: 13, maxF: 9.5, maxR: 3, radius: 1.35,
    camBack: 12.5, camUp: 5.6, highBack: 14, highUp: 13, highAhead: 6,
    wheelbase: 3.6, steerMax: 0.46, cabF: 3.0, cabY: 2.9,
    front: 1.95, halfW: 1.15, frontR: 1.05,
  },
  car: {
    make: () => makeCar({ body: 0x7fb2d9 }), glb: '/assets/kenney/hatchback-sports.glb', glbLen: 4.2, fly: false,
    accel: 6.5, brake: 15, maxF: 12, maxR: 3, radius: 1.0,
    camBack: 11, camUp: 5.2, highBack: 12, highUp: 11.5, highAhead: 6,
    wheelbase: 2.7, steerMax: 0.5, cabF: 1.8, cabY: 1.6,
    front: 1.5, halfW: 0.95, frontR: 0.95,
  },
  heli: {
    make: makeHelicopter, glb: '', glbLen: 7.8, fly: true,
    accel: 9, brake: 12, maxF: 13, maxR: 6, radius: 2.6,
    camBack: 17, camUp: 8.5, highBack: 20, highUp: 15, highAhead: 8,
    wheelbase: 4, steerMax: 1.0, cabF: 4.6, cabY: 3.4,
    front: 3, halfW: 2.2, frontR: 2,
  },
  kart: {
    make: makeCar, glb: '/assets/kenney/racing/vehicle-truck-red.glb', glbLen: 3.2, fly: false,
    accel: 10, brake: 14, maxF: 15, maxR: 4, radius: 1.2,
    camBack: 10, camUp: 4.6, highBack: 12, highUp: 11, highAhead: 6,
    wheelbase: 2.4, steerMax: 0.6, cabF: 1.6, cabY: 1.5,
    front: 1.4, halfW: 0.9, frontR: 0.9,
  },
};

export interface PlayerState {
  x: number;
  z: number;
  heading: number;
  v: number;
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
  car.scale.setScalar(V.fly ? 1.5 : 1);
  const p: Player = {
    car, V,
    state: { x, z, heading, v: 0 },
    wheels: [],
    crashT: 0,
    crash: { x: 0, z: 0, heading: 0 },
  };
  if (V.glb) {
    // swap in the CC0 Kenney model once it streams in; procedural stays if it fails
    // (Kenney vehicles already face +Z — our forward — no flip needed)
    spawnVehicle(V.glb, { len: V.glbLen }).then(g => {
      car.clear();
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
): PhysicsStep {
  const { state: st, V } = p;

  if (V.fly) {
    // simplified helicopter: hover-drive at a fixed altitude, above it all
    if (input.gas) st.v = Math.min(V.maxF, st.v + V.accel * dt);
    if (input.brake) st.v = Math.max(-V.maxF * 0.5, st.v - V.brake * dt);
    st.v -= st.v * 0.5 * dt;
    st.heading += input.steer * 1.0 * dt * (0.35 + Math.abs(st.v) / V.maxF);
    st.x += Math.sin(st.heading) * st.v * dt;
    st.z += Math.cos(st.heading) * st.v * dt;
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
      if (nx > b.x1 - V.radius && nx < b.x2 + V.radius && st.z > b.z1 - 0.8 && st.z < b.z2 + 0.8) hitX = true;
      if (st.x > b.x1 - 0.8 && st.x < b.x2 + 0.8 && nz > b.z1 - V.radius && nz < b.z2 + V.radius) hitZ = true;
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
