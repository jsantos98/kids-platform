// Smoke and steam (G4, G2): soft round puffs — camera-facing quads drawn by
// one instanced mesh, each a lumpy, top-lit blob — that rise, swell, drift
// with the wind and fade. An emitter's `dark` makes it a fire's grey smoke
// (1) or the water's white steam (0); its `strength` thins it out as the
// fire dies. In the world a fire's emitter builds a column you can see over
// the roofs; in a scene the steam puffs where the water meets a flame.
import * as THREE from 'three';
import { NOISE, FOG_VS, FOG_FS, fxMaterial } from './shader.js';

const VS = /* glsl */`
attribute vec4 aPuff;          // seed, alpha, grey, spin
varying vec2 vUv;
varying vec4 vPuff;
${FOG_VS}
void main() {
  vUv = uv;
  vPuff = aPuff;
  vec4 c = modelMatrix * instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0);
  float s = length(instanceMatrix[0].xyz);
  vec4 mv = viewMatrix * c;
  float cs = cos(aPuff.w), sn = sin(aPuff.w);
  mv.xy += mat2(cs, sn, -sn, cs) * position.xy * s;
  vFogDepth = -mv.z;
  gl_Position = projectionMatrix * mv;
}`;

const FS = /* glsl */`
varying vec2 vUv;
varying vec4 vPuff;
uniform vec3 uLight;
${NOISE}
${FOG_FS}
void main() {
  vec2 p = vUv - 0.5;
  float r = length(p) * 2.0;
  // a lumpy outline: three or four bulges round the edge
  float ang = atan(p.y, p.x);
  float edge = 0.78 + 0.14 * vnoise(vec2(ang * 1.6 + vPuff.x * 5.0, vPuff.x)) + 0.06 * sin(ang * 3.0 + vPuff.x * 9.0);
  float aa = fwidth(r) * 1.5 + 0.01;
  float a = 1.0 - smoothstep(edge - aa, edge, r);
  if (a < 0.01) discard;
  // toon-lit from above: a lighter crown lobe, a darker belly
  float crown = 1.0 - smoothstep(-aa, aa, length(p - vec2(-0.07, 0.11)) * 2.0 - edge * 0.78);
  float belly = smoothstep(-aa, aa, length(p - vec2(0.04, 0.14)) * 2.0 - edge * 0.95);
  float g = vPuff.z;
  vec3 dark = vec3(0.5, 0.49, 0.54), light = vec3(0.96, 0.97, 0.99);
  vec3 base = mix(light, dark, g);
  vec3 col = base * (0.9 + crown * 0.16 - belly * 0.12) * uLight;
  // (thinned by the fog only halfway: a fire's column shows from across town)
  gl_FragColor = vec4(mix(col, fogColor, fogAmount() * 0.5), a * vPuff.y);
}`;

export interface SmokeOptions {
  x: number; y: number; z: number;
  /** puffs a second */
  rate?: number;
  /** starting and final puff diameter (m) */
  size0?: number;
  size1?: number;
  /** rise speed (m/s) and puff life (s): together, the column's height */
  rise?: number;
  life?: number;
  /** 1 grey smoke … 0 white steam */
  dark?: number;
  /** how far each puff starts from the emitter (m) */
  jitter?: number;
}

export class SmokeEmitter {
  strength = 1;
  on = true;
  acc = 0;
  constructor(public o: Required<SmokeOptions>) {}
}

interface Puff { x: number; y: number; z: number; vx: number; vy: number; vz: number; age: number; life: number; s0: number; s1: number; grey: number; seed: number; spin: number; alpha: number }

const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _p = new THREE.Vector3(), _s = new THREE.Vector3();

export class SmokeSystem {
  readonly emitters: SmokeEmitter[] = [];
  private puffs: Puff[] = [];
  private mesh: THREE.InstancedMesh;
  private aPuff: THREE.InstancedBufferAttribute;
  /** the wind (m/s), drifting every puff */
  wind = new THREE.Vector2(0.8, 0.2);
  private time = 0;

  constructor(private scene: THREE.Scene, readonly max = 260) {
    const mat = fxMaterial(VS, FS, { uLight: { value: new THREE.Color(1, 1, 1) } });
    this.mesh = new THREE.InstancedMesh(new THREE.PlaneGeometry(1, 1), mat, max);
    this.aPuff = new THREE.InstancedBufferAttribute(new Float32Array(max * 4), 4);
    this.mesh.geometry.setAttribute('aPuff', this.aPuff);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 5;
    this.mesh.count = 0;
    scene.add(this.mesh);
  }

  /** the light on the smoke (dimmer at night) */
  set light(v: number) { ((this.mesh.material as THREE.ShaderMaterial).uniforms.uLight.value as THREE.Color).setScalar(v); }

  add(o: SmokeOptions): SmokeEmitter {
    const e = new SmokeEmitter({
      rate: 4, size0: 0.8, size1: 3, rise: 1.6, life: 4, dark: 1, jitter: 0.3, ...o,
    });
    this.emitters.push(e);
    return e;
  }

  remove(e: SmokeEmitter): void {
    const i = this.emitters.indexOf(e);
    if (i >= 0) this.emitters.splice(i, 1);
  }

  /** a puff of steam (or smoke) at a point, right now */
  puff(x: number, y: number, z: number, size = 1, dark = 0, life = 1.2): void {
    this.spawn(x, y, z, size * 0.6, size * 1.8, 1.4, life, dark, 0.2, 1);
  }

  private spawn(x: number, y: number, z: number, s0: number, s1: number, rise: number, life: number, dark: number, jitter: number, alpha: number): void {
    if (this.puffs.length >= this.max) this.puffs.shift();
    this.puffs.push({
      x: x + (Math.random() - 0.5) * jitter * 2, y, z: z + (Math.random() - 0.5) * jitter * 2,
      vx: (Math.random() - 0.5) * 0.4, vy: rise * (0.8 + Math.random() * 0.4), vz: (Math.random() - 0.5) * 0.4,
      age: 0, life: life * (0.8 + Math.random() * 0.4), s0, s1, grey: dark, seed: Math.random() * 10,
      spin: Math.random() * Math.PI * 2, alpha,
    });
  }

  update(dt: number, camera: THREE.Camera): void {
    this.time += dt;
    for (const e of this.emitters) {
      if (!e.on || e.strength < 0.02) continue;
      e.acc += dt * e.o.rate * (0.35 + 0.65 * e.strength);
      while (e.acc >= 1) {
        e.acc -= 1;
        const o = e.o;
        // a weakening fire's smoke pales toward steam
        this.spawn(o.x, o.y, o.z, o.size0, o.size1 * (0.6 + 0.4 * e.strength), o.rise, o.life, o.dark * (0.35 + 0.65 * e.strength), o.jitter, 0.6 + 0.35 * e.strength);
      }
    }
    for (const p of this.puffs) {
      p.age += dt;
      p.vy *= 1 - dt * 0.15;
      p.x += (p.vx + this.wind.x * Math.min(1, p.age / 1.5)) * dt;
      p.y += p.vy * dt;
      p.z += (p.vz + this.wind.y * Math.min(1, p.age / 1.5)) * dt;
      p.spin += dt * 0.25;
    }
    this.puffs = this.puffs.filter(p => p.age < p.life);
    // far puffs first, so near ones draw over them
    this.puffs.sort((a, b) =>
      (b.x - camera.position.x) ** 2 + (b.y - camera.position.y) ** 2 + (b.z - camera.position.z) ** 2
      - ((a.x - camera.position.x) ** 2 + (a.y - camera.position.y) ** 2 + (a.z - camera.position.z) ** 2));
    let n = 0;
    for (const p of this.puffs) {
      const k = p.age / p.life;
      const s = p.s0 + (p.s1 - p.s0) * Math.sqrt(k);
      _p.set(p.x, p.y, p.z);
      _s.set(s, s, s);
      _m.compose(_p, _q, _s);
      this.mesh.setMatrixAt(n, _m);
      // fade in quickly, out slowly
      const a = p.alpha * Math.min(1, k * 6) * (1 - k * k);
      this.aPuff.setXYZW(n, p.seed, a, p.grey, p.spin);
      n++;
    }
    this.mesh.count = n;
    this.mesh.instanceMatrix.needsUpdate = true;
    this.aPuff.needsUpdate = true;
  }

  dispose(): void {
    this.scene.remove(this.mesh);
    this.mesh.geometry.dispose();
    (this.mesh.material as THREE.Material).dispose();
  }
}
