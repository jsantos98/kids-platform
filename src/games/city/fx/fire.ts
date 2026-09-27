// Cartoon fire (G4, G2): every fire is a cluster of flame tongues — camera-
// facing quads drawn by one instanced mesh, each a noise-licked teardrop in
// toon bands (a white-yellow core, yellow, orange, a red rim) that sways and
// flickers on its own phase — plus a soft glow on the ground at its base and
// embers drifting up. One FireSystem per scene draws all of its fires in
// three draw calls; a fire's `strength` (0…1) shrinks it as the water puts
// it out, `flare()` makes it jump when the water first hits it.
import * as THREE from 'three';
import { NOISE, FOG_VS, FOG_FS, fxMaterial, standingQuad } from './shader.js';

const TONGUE_VS = /* glsl */`
attribute vec4 aFire;          // seed, heat, alpha, lean
varying vec2 vUv;
varying vec4 vFire;
${FOG_VS}
void main() {
  vUv = uv;
  vFire = aFire;
  vec4 c = modelMatrix * instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0);
  float sx = length(instanceMatrix[0].xyz), sy = length(instanceMatrix[1].xyz);
  // camera right, and an up halfway between the world's and the camera's,
  // so a flame stands up yet never shrinks to a sliver seen from above
  vec3 right = vec3(viewMatrix[0][0], viewMatrix[1][0], viewMatrix[2][0]);
  vec3 camUp = vec3(viewMatrix[0][1], viewMatrix[1][1], viewMatrix[2][1]);
  vec3 up = normalize(mix(vec3(0.0, 1.0, 0.0), camUp, 0.45));
  vec3 p = c.xyz + right * (position.x * sx + position.y * sy * aFire.w) + up * position.y * sy;
  vec4 mv = viewMatrix * vec4(p, 1.0);
  vFogDepth = -mv.z;
  gl_Position = projectionMatrix * mv;
}`;

const TONGUE_FS = /* glsl */`
uniform float uTime;
varying vec2 vUv;
varying vec4 vFire;
${NOISE}
${FOG_FS}
void main() {
  float seed = vFire.x, heat = vFire.y;
  float y = vUv.y;
  float t = uTime * 1.6 + seed * 11.0;
  float u = vUv.x - 0.5;
  // the tongue bends and licks, more toward its tip
  u += (vnoise(vec2(seed * 7.3, y * 2.4 - t * 1.9)) - 0.5) * 0.55 * y * y;
  u += sin(t * 2.3 + y * 3.0) * 0.04 * y;
  // teardrop: round at the base, pointed at the tip, its edge nibbled by noise
  float w = 0.5 * pow(1.0 - y, 0.78) * sqrt(clamp(y / 0.22, 0.0, 1.0));
  w *= 0.82 + 0.36 * vnoise(vec2(u * 5.0 + seed * 3.0, y * 5.5 - t * 4.2));
  float d = abs(u) / max(w, 0.001);
  float aa = fwidth(d) * 1.4 + 0.001;
  float a = 1.0 - smoothstep(1.0 - aa, 1.0, d);
  if (a < 0.01) discard;
  // the bands narrow toward the tip, so the core is a flame inside the flame
  float m = d + smoothstep(0.3, 0.95, y) * (1.1 - heat * 0.5);
  vec3 rim = vec3(0.93, 0.26, 0.12);
  vec3 orange = vec3(1.0, 0.52, 0.12);
  vec3 yellow = vec3(1.0, 0.82, 0.22);
  vec3 core = vec3(1.0, 0.97, 0.78);
  float b1 = smoothstep(0.8 + aa, 0.8 - aa, m);
  float b2 = smoothstep(0.56 + aa, 0.56 - aa, m + (1.0 - heat) * 0.25);
  float b3 = smoothstep(0.3 + aa, 0.3 - aa, m + (1.0 - heat) * 0.4);
  vec3 col = mix(rim, orange, b1);
  col = mix(col, yellow, b2);
  col = mix(col, core, b3);
  gl_FragColor = vec4(mix(col, fogColor, fogAmount() * 0.85), a * vFire.z);
}`;

const GLOW_VS = /* glsl */`
attribute float aGlow;
varying vec2 vUv;
varying float vGlow;
${FOG_VS}
void main() {
  vUv = uv;
  vGlow = aGlow;
  vec4 mv = modelViewMatrix * instanceMatrix * vec4(position, 1.0);
  vFogDepth = -mv.z;
  gl_Position = projectionMatrix * mv;
}`;
const GLOW_FS = /* glsl */`
varying vec2 vUv;
varying float vGlow;
uniform float uNight;
${FOG_FS}
void main() {
  float r = length(vUv - 0.5) * 2.0;
  float a = pow(max(0.0, 1.0 - r), 1.8) * vGlow * (0.25 + 0.75 * uNight) * (1.0 - fogAmount());
  gl_FragColor = vec4(vec3(1.0, 0.55, 0.2), a);
}`;

const EMBER_VS = /* glsl */`
attribute float aLife;
varying float vLife;
${FOG_VS}
void main() {
  vLife = aLife;
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  vFogDepth = -mv.z;
  gl_PointSize = (1.0 - aLife * 0.6) * 180.0 / max(1.0, -mv.z);
  gl_Position = projectionMatrix * mv;
}`;
const EMBER_FS = /* glsl */`
varying float vLife;
${FOG_FS}
void main() {
  float r = length(gl_PointCoord - 0.5) * 2.0;
  if (r > 1.0 || vLife >= 1.0) discard;
  vec3 col = mix(vec3(1.0, 0.9, 0.45), vec3(1.0, 0.4, 0.12), vLife);
  gl_FragColor = vec4(col, (1.0 - r * r) * (1.0 - vLife) * (1.0 - fogAmount()));
}`;

export interface FireOptions {
  /** base of the fire */
  x: number; y: number; z: number;
  /** its height scale (m): the tallest tongue is ~1.7 × size */
  size?: number;
  /** half-extents it spreads over (a car's roof, a window's width) */
  spreadX?: number;
  spreadZ?: number;
  /** tongues in the cluster */
  tongues?: number;
  seed?: number;
}

interface Tongue { dx: number; dz: number; h: number; w: number; seed: number; lean: number }

/** one fire: set `target` (0…1), it eases there; `strength` is where it is */
export class Fire {
  strength = 1;
  target = 1;
  visible = true;
  /** 0…1 flicker the caller can light things with */
  light = 1;
  flareT = 0;
  readonly tongues: Tongue[] = [];

  constructor(public x: number, public y: number, public z: number, public size: number, spreadX: number, spreadZ: number, n: number, seed: number) {
    let s = seed * 9301 + 49297;
    const rnd = (): number => { s = (s * 9301 + 49297) % 233280; return s / 233280; };
    for (let k = 0; k < n; k++) {
      // the tallest tongue in the middle, smaller ones round it
      const a = k === 0 ? 0 : rnd() * Math.PI * 2, rr = k === 0 ? 0 : 0.35 + rnd() * 0.65;
      this.tongues.push({
        dx: Math.cos(a) * rr * (spreadX + size * 0.28), dz: Math.sin(a) * rr * (spreadZ + size * 0.2),
        h: k === 0 ? 1.7 : 0.8 + rnd() * 0.7, w: k === 0 ? 1.05 : 0.6 + rnd() * 0.35,
        seed: rnd() * 100, lean: (rnd() - 0.5) * 0.3,
      });
    }
  }

  /** the water first hits it: it jumps up for a moment */
  flare(): void { this.flareT = 0.35; }

  get out(): boolean { return this.strength < 0.03 && this.target <= 0; }
}

const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _p = new THREE.Vector3(), _s = new THREE.Vector3();

export class FireSystem {
  readonly fires: Fire[] = [];
  private tongues: THREE.InstancedMesh;
  private glows: THREE.InstancedMesh;
  private embers: THREE.Points;
  private aFire: THREE.InstancedBufferAttribute;
  private aGlow: THREE.InstancedBufferAttribute;
  private emberPos: Float32Array;
  private emberLife: Float32Array;
  private emberVel: Float32Array;
  private emberNext = 0;
  private time = 0;
  private order: Array<{ i: number; d: number }> = [];

  constructor(private scene: THREE.Scene, readonly max = 180, readonly maxEmbers = 90) {
    const tm = fxMaterial(TONGUE_VS, TONGUE_FS, { uTime: { value: 0 } }, { side: THREE.DoubleSide });
    this.tongues = new THREE.InstancedMesh(standingQuad(), tm, max);
    this.aFire = new THREE.InstancedBufferAttribute(new Float32Array(max * 4), 4);
    this.tongues.geometry.setAttribute('aFire', this.aFire);
    this.tongues.frustumCulled = false;
    this.tongues.renderOrder = 3;
    this.tongues.count = 0;

    const gm = fxMaterial(GLOW_VS, GLOW_FS, { uNight: { value: 0 } }, { blending: THREE.AdditiveBlending });
    const disc = new THREE.PlaneGeometry(1, 1);
    disc.rotateX(-Math.PI / 2);
    this.glows = new THREE.InstancedMesh(disc, gm, 48);
    this.aGlow = new THREE.InstancedBufferAttribute(new Float32Array(48), 1);
    this.glows.geometry.setAttribute('aGlow', this.aGlow);
    this.glows.frustumCulled = false;
    this.glows.renderOrder = 2;
    this.glows.count = 0;

    this.emberPos = new Float32Array(maxEmbers * 3);
    this.emberLife = new Float32Array(maxEmbers).fill(1);
    this.emberVel = new Float32Array(maxEmbers * 3);
    const eg = new THREE.BufferGeometry();
    eg.setAttribute('position', new THREE.BufferAttribute(this.emberPos, 3));
    eg.setAttribute('aLife', new THREE.BufferAttribute(this.emberLife, 1));
    this.embers = new THREE.Points(eg, fxMaterial(EMBER_VS, EMBER_FS, {}, { blending: THREE.AdditiveBlending }));
    this.embers.frustumCulled = false;
    this.embers.renderOrder = 4;
    scene.add(this.glows, this.tongues, this.embers);
  }

  add(o: FireOptions): Fire {
    const f = new Fire(o.x, o.y, o.z, o.size ?? 1, o.spreadX ?? 0, o.spreadZ ?? 0, o.tongues ?? 6, o.seed ?? this.fires.length + 1);
    this.fires.push(f);
    return f;
  }

  remove(f: Fire): void {
    const i = this.fires.indexOf(f);
    if (i >= 0) this.fires.splice(i, 1);
  }

  /** 0 by day … 1 at night: the ground glow shows more in the dark */
  set night(v: number) { (this.glows.material as THREE.ShaderMaterial).uniforms.uNight.value = v; }

  update(dt: number, camera: THREE.Camera): void {
    this.time += dt;
    (this.tongues.material as THREE.ShaderMaterial).uniforms.uTime.value = this.time;
    const t = this.time;
    let n = 0, g = 0;
    this.order.length = 0;
    for (const f of this.fires) {
      f.strength += (f.target - f.strength) * Math.min(1, dt * (f.target < f.strength ? 3.5 : 1.2));
      if (f.target <= 0 && f.strength < 0.03) f.strength = 0;
      f.flareT = Math.max(0, f.flareT - dt);
      const flare = 1 + Math.sin((f.flareT / 0.35) * Math.PI) * 0.35;
      const s = Math.pow(f.strength, 0.7) * flare;
      f.light = f.strength * (0.8 + 0.2 * Math.sin(t * 13 + f.x) * Math.sin(t * 7.3 + f.z));
      if (!f.visible || s < 0.02) continue;
      for (const tg of f.tongues) {
        if (n >= this.max) break;
        const flick = 1 + 0.16 * Math.sin(t * 9 + tg.seed) + 0.08 * Math.sin(t * 23 + tg.seed * 2);
        const h = tg.h * f.size * s * flick, w = tg.w * f.size * Math.max(0.35, s) * 1.15;
        _p.set(f.x + tg.dx * Math.max(0.5, s), f.y, f.z + tg.dz * Math.max(0.5, s));
        _s.set(w, h, 1);
        _m.compose(_p, _q, _s);
        this.tongues.setMatrixAt(n, _m);
        this.aFire.setXYZW(n, tg.seed, Math.min(1, 0.45 + f.strength * 0.55), Math.min(1, s * 3), tg.lean);
        this.order.push({ i: n, d: _p.distanceToSquared(camera.position) });
        n++;
      }
      if (g < 48) {
        const r = f.size * (2.6 + 0.3 * Math.sin(t * 11 + f.x));
        _p.set(f.x, f.y + 0.05, f.z);
        _s.set(r * 2, 1, r * 2);
        _m.compose(_p, _q, _s);
        this.glows.setMatrixAt(g, _m);
        this.aGlow.setX(g, Math.min(1, s));
        g++;
      }
      // embers: a few a second per fire, more from a big one
      if (Math.random() < dt * 7 * s * f.size) this.ember(f);
    }
    // far tongues first, so the near ones draw over them
    if (this.order.length > 1) this.sortTongues(n);
    this.tongues.count = n;
    this.tongues.instanceMatrix.needsUpdate = true;
    this.aFire.needsUpdate = true;
    this.glows.count = g;
    this.glows.instanceMatrix.needsUpdate = true;
    this.aGlow.needsUpdate = true;
    for (let i = 0; i < this.maxEmbers; i++) {
      if (this.emberLife[i] >= 1) continue;
      this.emberLife[i] = Math.min(1, this.emberLife[i] + dt / 1.4);
      this.emberVel[i * 3] += Math.sin(t * 3 + i) * dt * 0.8;
      this.emberPos[i * 3] += this.emberVel[i * 3] * dt;
      this.emberPos[i * 3 + 1] += this.emberVel[i * 3 + 1] * dt;
      this.emberPos[i * 3 + 2] += this.emberVel[i * 3 + 2] * dt;
    }
    this.embers.geometry.attributes.position.needsUpdate = true;
    this.embers.geometry.attributes.aLife.needsUpdate = true;
  }

  private sortTongues(n: number): void {
    const mats = new Float32Array(this.tongues.instanceMatrix.array as Float32Array);
    const fire = new Float32Array(this.aFire.array as Float32Array);
    this.order.sort((a, b) => b.d - a.d);
    const im = this.tongues.instanceMatrix.array as Float32Array, fa = this.aFire.array as Float32Array;
    for (let k = 0; k < n; k++) {
      const i = this.order[k].i;
      im.set(mats.subarray(i * 16, i * 16 + 16), k * 16);
      fa.set(fire.subarray(i * 4, i * 4 + 4), k * 4);
    }
  }

  private ember(f: Fire): void {
    const i = this.emberNext;
    this.emberNext = (this.emberNext + 1) % this.maxEmbers;
    const tg = f.tongues[(Math.random() * f.tongues.length) | 0];
    this.emberPos[i * 3] = f.x + tg.dx;
    this.emberPos[i * 3 + 1] = f.y + f.size * (0.6 + Math.random() * 0.8);
    this.emberPos[i * 3 + 2] = f.z + tg.dz;
    this.emberVel[i * 3] = (Math.random() - 0.5) * 0.8;
    this.emberVel[i * 3 + 1] = 1.6 + Math.random() * 1.8;
    this.emberVel[i * 3 + 2] = (Math.random() - 0.5) * 0.8;
    this.emberLife[i] = 0;
  }

  dispose(): void {
    this.scene.remove(this.glows, this.tongues, this.embers);
    for (const o of [this.glows, this.tongues, this.embers]) {
      o.geometry.dispose();
      (o.material as THREE.Material).dispose();
    }
  }
}
