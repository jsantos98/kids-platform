// Little bursts of joy (G4): gold stars, pink hearts and white twinkles
// thrown out at a success — a flame out, a cat in the basket, a heart
// picked up, a robber caught — camera-facing quads drawn by one instanced
// mesh, each shape drawn by its shader, spinning, rising and fading.
import * as THREE from 'three';
import { fxMaterial } from './shader.js';

const VS = /* glsl */`
attribute vec3 aSpark;         // kind, alpha, spin
varying vec2 vUv;
varying vec3 vSpark;
void main() {
  vUv = uv;
  vSpark = aSpark;
  vec4 c = modelMatrix * instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0);
  float s = length(instanceMatrix[0].xyz);
  vec4 mv = viewMatrix * c;
  float cs = cos(aSpark.z), sn = sin(aSpark.z);
  mv.xy += mat2(cs, sn, -sn, cs) * position.xy * s;
  gl_Position = projectionMatrix * mv;
}`;
const FS = /* glsl */`
varying vec2 vUv;
varying vec3 vSpark;
float star(vec2 p) {
  float a = atan(p.y, p.x), r = length(p);
  float k = 0.55 + 0.45 * cos(a * 5.0);          // five points
  return r / mix(0.42, 1.0, pow(k, 3.0));
}
float heart(vec2 p) {
  p.y -= 0.12;
  p.x = abs(p.x);
  vec2 q = vec2(p.x, 1.2 * p.y + 0.35 - sqrt(p.x) * 0.55);
  return length(q) / 0.62;
}
void main() {
  vec2 p = (vUv - 0.5) * 2.0;
  float kind = vSpark.x;
  float d = kind < 0.5 ? star(p) : kind < 1.5 ? heart(p) : length(p) * 1.6;
  float aa = fwidth(d) * 1.5 + 0.001;
  float a = 1.0 - smoothstep(1.0 - aa, 1.0, d);
  if (a < 0.01) discard;
  vec3 col = kind < 0.5 ? mix(vec3(1.0, 0.98, 0.72), vec3(1.0, 0.76, 0.18), smoothstep(0.2, 0.9, d))
    : kind < 1.5 ? mix(vec3(1.0, 0.72, 0.8), vec3(0.93, 0.25, 0.42), smoothstep(0.1, 0.95, d))
    : vec3(1.0);
  // a white rim so it reads on any background
  col = mix(col, vec3(1.0), smoothstep(0.82, 0.95, d) * 0.6);
  gl_FragColor = vec4(col, a * vSpark.y);
}`;

export type SparkKind = 'star' | 'heart' | 'twinkle';
const KIND: Record<SparkKind, number> = { star: 0, heart: 1, twinkle: 2 };

interface Spark { x: number; y: number; z: number; vx: number; vy: number; vz: number; age: number; life: number; size: number; kind: number; spin: number; vs: number }

const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _p = new THREE.Vector3(), _s = new THREE.Vector3();

export class Sparkles {
  private sparks: Spark[] = [];
  private mesh: THREE.InstancedMesh;
  private attr: THREE.InstancedBufferAttribute;

  constructor(private scene: THREE.Scene, readonly max = 120) {
    const mat = fxMaterial(VS, FS, {}, { fog: false, depthTest: false });
    this.mesh = new THREE.InstancedMesh(new THREE.PlaneGeometry(1, 1), mat, max);
    this.attr = new THREE.InstancedBufferAttribute(new Float32Array(max * 3), 3);
    this.mesh.geometry.setAttribute('aSpark', this.attr);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 20;
    this.mesh.count = 0;
    scene.add(this.mesh);
  }

  /** n sparks of a kind thrown out from a point */
  burst(pos: THREE.Vector3, kind: SparkKind = 'star', n = 12, size = 0.55, speed = 3.2): void {
    for (let k = 0; k < n; k++) {
      if (this.sparks.length >= this.max) this.sparks.shift();
      const a = (k / n) * Math.PI * 2 + Math.random() * 0.4, up = 0.6 + Math.random() * 0.8;
      this.sparks.push({
        x: pos.x, y: pos.y, z: pos.z,
        vx: Math.cos(a) * speed * (0.6 + Math.random() * 0.5), vy: speed * up, vz: Math.sin(a) * speed * (0.6 + Math.random() * 0.5),
        age: 0, life: 0.9 + Math.random() * 0.5, size: size * (0.7 + Math.random() * 0.6), kind: KIND[kind],
        spin: Math.random() * 6, vs: (Math.random() - 0.5) * 6,
      });
    }
  }

  /** one spark floating straight up (a picked-up heart) */
  rise(pos: THREE.Vector3, kind: SparkKind = 'heart', size = 0.9): void {
    this.sparks.push({ x: pos.x, y: pos.y, z: pos.z, vx: 0, vy: 2.2, vz: 0, age: 0, life: 1, size, kind: KIND[kind], spin: 0, vs: 0 });
  }

  update(dt: number): void {
    for (const s of this.sparks) {
      s.age += dt;
      s.vy -= 4 * dt;
      s.vx *= 1 - dt * 1.5;
      s.vz *= 1 - dt * 1.5;
      s.x += s.vx * dt;
      s.y += s.vy * dt;
      s.z += s.vz * dt;
      s.spin += s.vs * dt;
    }
    this.sparks = this.sparks.filter(s => s.age < s.life);
    let n = 0;
    for (const s of this.sparks) {
      const k = s.age / s.life;
      // pop in, hold, shrink away
      const sc = s.size * Math.min(1, k * 8) * (1 - Math.max(0, k - 0.6) / 0.4 * 0.7);
      _p.set(s.x, s.y, s.z);
      _s.set(sc, sc, sc);
      _m.compose(_p, _q, _s);
      this.mesh.setMatrixAt(n, _m);
      this.attr.setXYZ(n, s.kind, 1 - Math.max(0, k - 0.7) / 0.3, s.spin);
      n++;
    }
    this.mesh.count = n;
    this.mesh.instanceMatrix.needsUpdate = true;
    this.attr.needsUpdate = true;
  }

  dispose(): void {
    this.scene.remove(this.mesh);
    this.mesh.geometry.dispose();
    (this.mesh.material as THREE.Material).dispose();
  }
}
