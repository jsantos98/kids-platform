// The hose's water (G4): a stream, not a string of beads — a tapered ribbon
// along the arc from the nozzle to where it lands, turned to the camera,
// its foam streaks racing along it (a shader), spray droplets shaken off
// it and a splash where it lands: droplets bursting up and a puff of mist.
// Turned on it shoots out from the nozzle; turned off it falls away.
import * as THREE from 'three';
import { NOISE, FOG_VS, FOG_FS, fxMaterial } from './shader.js';
import type { SmokeSystem } from './smoke.js';

const SEG = 48;

const RIBBON_VS = /* glsl */`
varying vec2 vUv;
${FOG_VS}
void main() {
  vUv = uv;
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  vFogDepth = -mv.z;
  gl_Position = projectionMatrix * mv;
}`;
const RIBBON_FS = /* glsl */`
uniform float uTime;
uniform float uLen;
varying vec2 vUv;
${NOISE}
${FOG_FS}
void main() {
  float along = vUv.x, across = abs(vUv.y - 0.5) * 2.0;
  if (along > uLen) discard;
  // the stream frays toward its end
  float fray = smoothstep(0.55, 1.0, along / max(uLen, 0.001));
  float n = vnoise(vec2(along * 26.0 - uTime * 14.0, vUv.y * 3.0));
  float edge = 1.0 - fray * 0.55 * n;
  float a = 1.0 - smoothstep(edge - 0.25, edge, across);
  if (a < 0.02) discard;
  float streak = smoothstep(0.55, 0.9, vnoise(vec2(along * 40.0 - uTime * 22.0, vUv.y * 6.0)));
  vec3 blue = vec3(0.55, 0.8, 0.98), foam = vec3(0.96, 0.99, 1.0);
  vec3 col = mix(blue, foam, clamp(streak + (1.0 - across) * 0.45, 0.0, 1.0));
  gl_FragColor = vec4(fogged(col), a * (0.9 - fray * 0.35));
}`;

const DROP_VS = /* glsl */`
attribute float aLife;
varying float vLife;
${FOG_VS}
void main() {
  vLife = aLife;
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  vFogDepth = -mv.z;
  gl_PointSize = 110.0 / max(1.0, -mv.z);
  gl_Position = projectionMatrix * mv;
}`;
const DROP_FS = /* glsl */`
varying float vLife;
${FOG_FS}
void main() {
  float r = length(gl_PointCoord - 0.5) * 2.0;
  if (r > 1.0 || vLife >= 1.0) discard;
  vec3 col = mix(vec3(1.0), vec3(0.62, 0.84, 1.0), r);
  gl_FragColor = vec4(fogged(col), (1.0 - vLife) * 0.9);
}`;

const MAX_DROPS = 160;
const G = 9.8;

export class WaterJet {
  on = false;
  /** 0…1 how far out the stream has shot */
  private len = 0;
  private from = new THREE.Vector3();
  private to = new THREE.Vector3();
  private lift = 1;
  private ribbon: THREE.Mesh;
  private pos: Float32Array;
  private drops: THREE.Points;
  private dPos = new Float32Array(MAX_DROPS * 3);
  private dVel = new Float32Array(MAX_DROPS * 3);
  private dLife = new Float32Array(MAX_DROPS).fill(1);
  private dNext = 0;
  private time = 0;
  private mistT = 0;
  private arc: THREE.Vector3[] = Array.from({ length: SEG + 1 }, () => new THREE.Vector3());

  constructor(private scene: THREE.Scene, private smoke?: SmokeSystem, private width = 0.32) {
    const g = new THREE.BufferGeometry();
    this.pos = new Float32Array((SEG + 1) * 2 * 3);
    const uv = new Float32Array((SEG + 1) * 2 * 2);
    const idx: number[] = [];
    for (let i = 0; i <= SEG; i++) {
      uv.set([i / SEG, 0, i / SEG, 1], i * 4);
      if (i < SEG) idx.push(i * 2, i * 2 + 1, i * 2 + 2, i * 2 + 1, i * 2 + 3, i * 2 + 2);
    }
    g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3));
    g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    g.setIndex(idx);
    this.ribbon = new THREE.Mesh(g, fxMaterial(RIBBON_VS, RIBBON_FS, { uTime: { value: 0 }, uLen: { value: 0 } }, { side: THREE.DoubleSide }));
    this.ribbon.frustumCulled = false;
    this.ribbon.renderOrder = 6;
    const dg = new THREE.BufferGeometry();
    dg.setAttribute('position', new THREE.BufferAttribute(this.dPos, 3));
    dg.setAttribute('aLife', new THREE.BufferAttribute(this.dLife, 1));
    this.drops = new THREE.Points(dg, fxMaterial(DROP_VS, DROP_FS, {}));
    this.drops.frustumCulled = false;
    this.drops.renderOrder = 6;
    scene.add(this.ribbon, this.drops);
  }

  /** aim it: from the nozzle to where it lands, arcing `lift` m up midway */
  aim(from: THREE.Vector3, to: THREE.Vector3, lift = from.distanceTo(to) * 0.16): void {
    this.from.copy(from);
    this.to.copy(to);
    this.lift = lift;
  }

  /** where the stream is landing now (only meaningful while it's out) */
  get landing(): THREE.Vector3 { return this.to; }
  /** the stream reaches its target (it has shot all the way out) */
  get reaching(): boolean { return this.on && this.len > 0.95; }

  private point(t: number, out: THREE.Vector3): THREE.Vector3 {
    out.lerpVectors(this.from, this.to, t);
    out.y += 4 * this.lift * t * (1 - t);
    return out;
  }

  update(dt: number, camera: THREE.Camera): void {
    this.time += dt;
    this.len = Math.max(0, Math.min(1, this.len + (this.on ? dt / 0.25 : -dt / 0.35)));
    const mat = this.ribbon.material as THREE.ShaderMaterial;
    mat.uniforms.uTime.value = this.time;
    mat.uniforms.uLen.value = this.len;
    this.ribbon.visible = this.len > 0.01;
    // the ribbon, turned to face the camera along its length
    const side = new THREE.Vector3(), tan = new THREE.Vector3(), eye = new THREE.Vector3();
    for (let i = 0; i <= SEG; i++) this.point(i / SEG, this.arc[i]);
    for (let i = 0; i <= SEG; i++) {
      const a = this.arc[Math.max(0, i - 1)], b = this.arc[Math.min(SEG, i + 1)];
      tan.subVectors(b, a).normalize();
      eye.subVectors(camera.position, this.arc[i]).normalize();
      side.crossVectors(tan, eye).normalize();
      const t = i / SEG;
      // thin at the nozzle, fanning out as it travels, a gentle pulse along it
      const w = this.width * (0.45 + t * 1.1) * (1 + 0.08 * Math.sin(this.time * 30 - t * 20));
      const p = this.arc[i];
      this.pos.set([p.x + side.x * w, p.y + side.y * w, p.z + side.z * w, p.x - side.x * w, p.y - side.y * w, p.z - side.z * w], i * 6);
    }
    this.ribbon.geometry.attributes.position.needsUpdate = true;
    // droplets shaken off along the stream, and the splash where it lands
    if (this.on && this.len > 0.2) {
      for (let k = 0; k < 3; k++) {
        const t = Math.random() * this.len;
        this.point(t, eye);
        this.point(Math.min(1, t + 0.02), side);
        tan.subVectors(side, eye).normalize().multiplyScalar(6);
        this.drop(eye, tan.x + (Math.random() - 0.5), tan.y + Math.random(), tan.z + (Math.random() - 0.5));
      }
      if (this.len > 0.95) {
        for (let k = 0; k < 3; k++) {
          const a = Math.random() * Math.PI * 2, s = 1.2 + Math.random() * 1.8;
          this.drop(this.to, Math.cos(a) * s, 2 + Math.random() * 2.5, Math.sin(a) * s);
        }
        this.mistT -= dt;
        if (this.smoke && this.mistT <= 0) {
          this.mistT = 0.12;
          this.smoke.puff(this.to.x, this.to.y, this.to.z, 0.9, 0, 0.9);
        }
      }
    }
    for (let i = 0; i < MAX_DROPS; i++) {
      if (this.dLife[i] >= 1) continue;
      this.dLife[i] = Math.min(1, this.dLife[i] + dt / 0.7);
      this.dVel[i * 3 + 1] -= G * dt;
      this.dPos[i * 3] += this.dVel[i * 3] * dt;
      this.dPos[i * 3 + 1] += this.dVel[i * 3 + 1] * dt;
      this.dPos[i * 3 + 2] += this.dVel[i * 3 + 2] * dt;
      if (this.dPos[i * 3 + 1] < 0) this.dLife[i] = 1;
    }
    this.drops.geometry.attributes.position.needsUpdate = true;
    this.drops.geometry.attributes.aLife.needsUpdate = true;
  }

  private drop(p: THREE.Vector3, vx: number, vy: number, vz: number): void {
    const i = this.dNext;
    this.dNext = (this.dNext + 1) % MAX_DROPS;
    this.dPos.set([p.x, p.y, p.z], i * 3);
    this.dVel.set([vx, vy, vz], i * 3);
    this.dLife[i] = 0;
  }

  dispose(): void {
    this.scene.remove(this.ribbon, this.drops);
    for (const o of [this.ribbon, this.drops]) {
      o.geometry.dispose();
      (o.material as THREE.Material).dispose();
    }
  }
}
