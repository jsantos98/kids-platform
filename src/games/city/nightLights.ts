// The city's lights at night (G10): glows, not real lights — every lamp a
// soft halo (a camera-facing quad, additive, fading with distance) and, for
// a street lamp, a warm pool on the ground beneath it. A few instanced
// meshes carry them all: the chunks' baked lamps (registered as chunks come
// and go) and the lights that change every frame — traffic-light lamps,
// level-crossing flashers, vehicles' lamps (`flash`). Everything scales
// with `night`, so by day nothing draws. A real PointLight per lamp would
// recompile and slow every shader in the city.
import * as THREE from 'three';
import { GLOW, type ChunkGlow } from '../../worlds/cityChunk.js';
import { cityPlanFor } from '../../worlds/cityPlan.js';
import type { CityRef } from '../../worlds/cityGrid.js';

/** a glow: where, its colour, halo size (m) and the pool it throws (m, 0 none) */
export interface Glow {
  x: number; y: number; z: number; color: number; size: number; pool: number; strength?: number;
  /** a lamp that shines one way (a signal's lens): its facing, horizontal
   * unit vector — the glow sits on the lens and shows only to an
   * eye in front of the lens, fading out as it turns side-on */
  face?: { x: number; z: number };
}

/** how each baked kind glows */
const KIND: Record<number, { color: number; size: number; pool: number }> = {
  [GLOW.lamp]: { color: 0xffc98a, size: 2.6, pool: 7.5 },
  // the race circuit's floodlights: a big white bank, and its pool on the track
  [GLOW.flood]: { color: 0xfff4e0, size: 6, pool: 0 },
  [GLOW.floodPool]: { color: 0xfff0d8, size: 0, pool: 15 },
};

const HALO_VS = /* glsl */`
varying vec2 vUv;
varying vec3 vColor;
varying float vFade;
uniform float uFar;
uniform float uPull;
void main() {
  vUv = uv;
  vColor = instanceColor;
  vec4 c = modelViewMatrix * instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0);
  float s = length(instanceMatrix[0].xyz);
  // (pulled a little toward the eye, so the lamp's own pole can't cut it)
  c.xyz += normalize(-c.xyz) * uPull * s;
  c.xy += position.xy * s;
  vFade = 1.0 - smoothstep(uFar * 0.6, uFar, -c.z);
  gl_Position = projectionMatrix * c;
}`;
const HALO_FS = /* glsl */`
varying vec2 vUv;
varying vec3 vColor;
varying float vFade;
uniform float uNight;
void main() {
  float r = length(vUv - 0.5) * 2.0;
  float a = pow(max(0.0, 1.0 - r), 2.4) * 0.85 + smoothstep(0.22, 0.0, r) * 0.9;
  gl_FragColor = vec4(vColor, a * uNight * vFade);
}`;
const POOL_VS = /* glsl */`
varying vec2 vUv;
varying vec3 vColor;
varying float vFade;
uniform float uFar;
void main() {
  vUv = uv;
  vColor = instanceColor;
  vec4 c = modelViewMatrix * instanceMatrix * vec4(position, 1.0);
  vFade = 1.0 - smoothstep(uFar * 0.6, uFar, -c.z);
  gl_Position = projectionMatrix * c;
}`;
const POOL_FS = /* glsl */`
varying vec2 vUv;
varying vec3 vColor;
varying float vFade;
uniform float uNight;
void main() {
  float r = length(vUv - 0.5) * 2.0;
  float a = pow(max(0.0, 1.0 - r), 1.4) * 0.8;
  gl_FragColor = vec4(vColor, a * uNight * vFade);
}`;

const MAX_STATIC = 6000, MAX_DYNAMIC = 2000, MAX_BEAMS = 400;

/** the lights the game draws (one at a time: the city's) */
let current: NightLights | null = null;
/** the game's night lights, if it has any (vehicles add their lamps here) */
export function nightLights(): NightLights | null { return current; }

function glowMesh(geo: THREE.BufferGeometry, vs: string, fs: string, max: number, night: { value: number }, far: number, order: number, pull = 0.6): THREE.InstancedMesh {
  const mat = new THREE.ShaderMaterial({
    vertexShader: vs, fragmentShader: fs,
    uniforms: { uNight: night, uFar: { value: far }, uPull: { value: pull } },
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false,
    polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2,
  });
  const m = new THREE.InstancedMesh(geo, mat, max);
  m.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(max * 3), 3);
  m.count = 0;
  m.frustumCulled = false;
  m.renderOrder = order;
  return m;
}

export class NightLights {
  /** 0 by day … 1 at night (shared by every glow material) */
  readonly night = { value: 0 };
  private halos: InstancedMesh;
  private pools: InstancedMesh;
  private flashes: InstancedMesh;
  /** the frame's headlight beams: soft stretched pools on the road */
  private beams: InstancedMesh;
  private frameBeams = 0;
  private chunks = new Map<string, Glow[]>();
  private dirty = false;
  private frame: Glow[] = [];
  private _m = new THREE.Matrix4();
  private _c = new THREE.Color();
  private _v = new THREE.Vector3();
  private _q = new THREE.Quaternion();
  private _s = new THREE.Vector3();
  private _up = new THREE.Vector3(0, 1, 0);

  /** @param eye the camera's position (live: a one-way lamp glows toward it) */
  constructor(scene: THREE.Scene, private eye: THREE.Vector3) {
    const pool = new THREE.PlaneGeometry(2, 2);
    pool.rotateX(-Math.PI / 2);
    this.halos = glowMesh(new THREE.PlaneGeometry(1, 1), HALO_VS, HALO_FS, MAX_STATIC, this.night, 340, 5);
    this.pools = glowMesh(pool, POOL_VS, POOL_FS, MAX_STATIC, this.night, 200, 4);
    // (the frame's glows sit on small lenses: pulled only a little toward the eye)
    this.flashes = glowMesh(new THREE.PlaneGeometry(1, 1), HALO_VS, HALO_FS, MAX_DYNAMIC, this.night, 340, 6, 0.02);
    this.beams = glowMesh(pool.clone(), POOL_VS, POOL_FS, MAX_BEAMS, this.night, 200, 4);
    scene.add(this.pools, this.beams, this.halos, this.flashes);
    current = this;
  }

  /** is it dark enough for lamps to show? */
  get dark(): boolean { return this.night.value > 0.01; }

  /** a headlight beam for this frame: a soft pool `len` long and `w` wide
   * centred at (x, z), along heading h, at height y */
  beam(x: number, y: number, z: number, h: number, w: number, len: number, color = 0xfff0d0, strength = 1): void {
    if (this.frameBeams >= MAX_BEAMS) return;
    this._m.compose(this._v.set(x, y, z), this._q.setFromAxisAngle(this._up, h), this._s.set(w / 2, 1, len / 2));
    this.beams.setMatrixAt(this.frameBeams, this._m);
    this.beams.setColorAt(this.frameBeams++, this._c.setHex(color).multiplyScalar(strength));
  }

  /** a road vehicle's lamps at (x, y, z) heading h (facing (sin h, cos h)):
   * two headlamps and two tail lamps, each shining one way, and its beam
   * on the road ahead */
  carLamps(x: number, y: number, z: number, h: number, halfLen: number, halfW: number, lampY = 0.75, beam = true): void {
    if (!this.dark) return;
    const fx = Math.sin(h), fz = Math.cos(h), rx = fz, rz = -fx;
    const front = { x: fx, z: fz }, back = { x: -fx, z: -fz };
    const wx = Math.max(0.35, halfW - 0.3);
    for (const side of [-1, 1]) {
      this.flash({ x: x + fx * (halfLen - 0.1) + rx * side * wx, y: y + lampY, z: z + fz * (halfLen - 0.1) + rz * side * wx,
        color: 0xfff4dc, size: 1.1, pool: 0, face: front });
      this.flash({ x: x - fx * (halfLen - 0.1) + rx * side * wx, y: y + lampY, z: z - fz * (halfLen - 0.1) + rz * side * wx,
        color: 0xff2a22, size: 0.75, pool: 0, face: back });
    }
    if (beam) this.beam(x + fx * (halfLen + 6), y + 0.3, z + fz * (halfLen + 6), h, halfW * 2 + 3, 14, 0xfff0d0, 0.9);
  }

  /** a chunk's baked lights join (world offset ox, oz) */
  addChunk(key: string, glows: ChunkGlow[], ox: number, oz: number): void {
    if (!glows.length) return;
    this.chunks.set(key, glows.map(g => ({ ...KIND[g.kind], x: g.x + ox, y: g.y, z: g.z + oz })));
    this.dirty = true;
  }

  dropChunk(key: string): void {
    if (this.chunks.delete(key)) this.dirty = true;
  }

  /** a glow for this frame only (a lit traffic lamp, a flasher, a headlamp) */
  flash(g: Glow): void {
    if (this.frame.length >= MAX_DYNAMIC) return;
    if (g.face) {
      const dx = this.eye.x - g.x, dy = this.eye.y - g.y, dz = this.eye.z - g.z;
      const facing = (g.face.x * dx + g.face.z * dz) / (Math.hypot(dx, dy, dz) || 1);
      const k = Math.min(1, Math.max(0, (facing - 0.15) / 0.45));
      if (k <= 0) return;
      g = { ...g, x: g.x + g.face.x * 0.08, z: g.z + g.face.z * 0.08, strength: (g.strength ?? 1) * k * k * (3 - 2 * k) };
    }
    this.frame.push(g);
  }

  /** after the frame's flashes: draw at `night` (0 … 1) */
  update(night: number): void {
    this.night.value = night;
    const on = night > 0.01;
    this.halos.visible = this.pools.visible = this.flashes.visible = on;
    if (on && this.dirty) {
      this.dirty = false;
      let h = 0, p = 0;
      for (const list of this.chunks.values()) {
        for (const g of list) {
          if (g.size > 0 && h < MAX_STATIC) this.put(this.halos, h++, g, g.size, g.y);
          if (g.pool > 0 && p < MAX_STATIC) this.put(this.pools, p++, g, g.pool, 0.3);
        }
      }
      this.halos.count = h;
      this.pools.count = p;
      for (const m of [this.halos, this.pools]) {
        m.instanceMatrix.needsUpdate = true;
        m.instanceColor!.needsUpdate = true;
      }
    }
    this.beams.visible = on;
    this.beams.count = on ? this.frameBeams : 0;
    if (on && this.frameBeams) {
      this.beams.instanceMatrix.needsUpdate = true;
      this.beams.instanceColor!.needsUpdate = true;
    }
    this.frameBeams = 0;
    const f = this.flashes;
    f.count = on ? this.frame.length : 0;
    if (on) {
      this.frame.forEach((g, k) => this.put(f, k, g, g.size, g.y));
      f.instanceMatrix.needsUpdate = true;
      f.instanceColor!.needsUpdate = true;
    }
    this.frame.length = 0;
  }

  /** the island's green blocks (parks, woods, meadows), where fireflies dance */
  private greens: { key: string; spots: Array<{ x: number; z: number; r: number }> } = { key: '', spots: [] };

  /** fireflies over the green blocks near the kid (a dozen or so to a
   * block, each drifting on its own loop and blinking now and then) */
  fireflies(city: CityRef, px: number, pz: number, t: number): void {
    const night = this.night.value;
    if (night < 0.3) return;
    if (this.greens.key !== city.key) {
      const plan = cityPlanFor(city.bx, city.by);
      this.greens = {
        key: city.key,
        spots: plan.blocks.filter(b => b.district === 'park' || b.district === 'forest' || b.district === 'meadow')
          .map(b => ({ x: b.cx + city.ox, z: b.cz + city.oz, r: Math.min(40, Math.sqrt(b.area) / 3) })),
      };
    }
    this.greens.spots.forEach((b, k) => {
      if (Math.abs(b.x - px) > 160 || Math.abs(b.z - pz) > 160) return;
      for (let i = 0; i < 22; i++) {
        const ph = k * 7.13 + i * 2.39;
        const blink = Math.max(0, Math.sin(t * (1.1 + (i % 5) * 0.23) + ph));
        if (blink < 0.25) continue;
        const a = t * (0.12 + (i % 3) * 0.05) + ph, rr = b.r * (0.3 + ((i * 0.618) % 0.7));
        this.flash({
          x: b.x + Math.cos(a) * rr + Math.sin(t * 0.7 + ph) * 1.5,
          y: 0.9 + ((i * 0.37) % 1.6) + Math.sin(t * 1.3 + ph) * 0.3,
          z: b.z + Math.sin(a * 1.3) * rr,
          color: 0xe0ff66, size: 1.0, pool: 0, strength: 1.4 * Math.pow(blink, 2) * Math.min(1, (night - 0.3) * 2),
        });
      }
    });
  }

  private put(m: THREE.InstancedMesh, k: number, g: Glow, size: number, y: number): void {
    this._m.makeScale(size, size, size).setPosition(g.x, y, g.z);
    m.setMatrixAt(k, this._m);
    this._c.setHex(g.color).multiplyScalar(g.strength ?? 1);
    m.setColorAt(k, this._c);
  }
}

type InstancedMesh = THREE.InstancedMesh;
