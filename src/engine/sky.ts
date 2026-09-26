// The sky (G10): a gradient dome with the sun's glow and, at night,
// twinkling stars; the sun disc crossing it and setting; the moon rising
// opposite it, in its phase (drawn once per phase on a canvas); low-poly
// clouds drifting high over the kid, lit by the same lights (orange at dusk,
// grey-blue at night); and now and then a meteor streaking across the night.
// Everything follows a centre point (the kid) and is driven by a DayState.
import * as THREE from 'three';
import type { DayState } from './daylight.js';
import { MOON_PHASES } from './daylight.js';

const DOME_R = 480;
const SUN_R = 420, MOON_R = 400;

const DOME_VS = /* glsl */`varying vec3 vP;
void main(){ vP = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`;
const DOME_FS = /* glsl */`uniform vec3 top; uniform vec3 bottom; uniform vec3 sunDir; uniform vec3 sunColor;
uniform float sunGlow; uniform float stars; uniform float time;
varying vec3 vP;
float hash(vec3 p){ p = fract(p * 0.3183099 + 0.1); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
void main(){
  vec3 d = normalize(vP);
  float h = normalize(vP + vec3(0.0, 60.0, 0.0)).y;
  vec3 col = mix(bottom, top, pow(max(h, 0.0), 0.85));
  // the sun's glow round it (strong at dusk and dawn)
  float s = max(dot(d, sunDir), 0.0);
  col += sunColor * (pow(s, 10.0) * 0.45 + pow(s, 160.0) * 0.9) * sunGlow;
  // the stars: a sparse hash over the sky, twinkling, fading into the horizon
  if (stars > 0.01 && d.y > 0.0) {
    vec3 q = d * 150.0;
    vec3 c = floor(q);
    float r = hash(c);
    if (r > 0.975) {
      vec3 off = vec3(hash(c + 1.7), hash(c + 3.1), hash(c + 5.3)) * 0.6 + 0.2;
      float dist = length(fract(q) - off);
      float tw = 0.6 + 0.4 * sin(time * (1.3 + r * 3.5) + r * 60.0);
      float st = smoothstep(0.24, 0.0, dist) * tw * smoothstep(0.0, 0.25, d.y);
      col += vec3(0.9, 0.93, 1.0) * st * stars * (0.8 + 1.2 * fract(r * 37.0));
    }
  }
  gl_FragColor = vec4(col, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;

/** the moon in each of its phases (0 new … 4 full … 7), drawn once */
function moonTexture(phase: number): THREE.CanvasTexture {
  const S = 128, r = 44, c = S / 2;
  const cv = document.createElement('canvas');
  cv.width = cv.height = S;
  const g = cv.getContext('2d')!;
  // a soft glow round it
  const glow = g.createRadialGradient(c, c, r * 0.8, c, c, S / 2);
  glow.addColorStop(0, 'rgba(210, 222, 255, 0.35)');
  glow.addColorStop(1, 'rgba(210, 222, 255, 0)');
  g.fillStyle = glow;
  g.fillRect(0, 0, S, S);
  // the unlit disc, just visible
  g.beginPath();
  g.arc(c, c, r, 0, Math.PI * 2);
  g.fillStyle = 'rgba(120, 135, 175, 0.16)';
  g.fill();
  // the lit part, row by row: waxing lights the right from the terminator
  // (cos 2πf of the half-width) out; waning the left
  const f = phase / MOON_PHASES, cr = Math.cos(2 * Math.PI * f);
  g.fillStyle = '#f4f1e2';
  for (let y = -r; y <= r; y++) {
    const w = Math.sqrt(Math.max(0, r * r - y * y));
    const [x0, x1] = f <= 0.5 ? [cr * w, w] : [-w, -cr * w];
    if (x1 > x0) g.fillRect(c + x0, c + y, x1 - x0, 1);
  }
  // a few soft craters on the lit part
  g.globalCompositeOperation = 'source-atop';
  g.fillStyle = 'rgba(170, 170, 160, 0.35)';
  for (const [dx, dy, rr] of [[-12, -10, 7], [10, 6, 9], [-4, 16, 5], [16, -14, 4]]) {
    g.beginPath(); g.arc(c + dx, c + dy, rr, 0, Math.PI * 2); g.fill();
  }
  const t = new THREE.CanvasTexture(cv);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/** a meteor's streak: a bright head fading down its tail */
function meteorTexture(): THREE.CanvasTexture {
  const cv = document.createElement('canvas');
  cv.width = 256; cv.height = 16;
  const g = cv.getContext('2d')!;
  const grad = g.createLinearGradient(0, 0, 256, 0);
  grad.addColorStop(0, 'rgba(255,255,255,0)');
  grad.addColorStop(0.85, 'rgba(220,235,255,0.7)');
  grad.addColorStop(1, 'rgba(255,255,255,1)');
  g.fillStyle = grad;
  g.beginPath();
  g.moveTo(0, 8); g.lineTo(250, 3); g.lineTo(256, 8); g.lineTo(250, 13); g.closePath();
  g.fill();
  const t = new THREE.CanvasTexture(cv);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/** how far a sky body has risen over the skyline, 0 … 1: it fades in
 * between 4 and 14 deg up (y = sin of its elevation) */
const RISE0 = Math.sin((4 * Math.PI) / 180), RISE1 = Math.sin((14 * Math.PI) / 180);
function rise(y: number): number {
  const f = Math.min(1, Math.max(0, (y - RISE0) / (RISE1 - RISE0)));
  return f * f * (3 - 2 * f);
}

const hash1 = (n: number): number => { const x = Math.sin(n * 127.1 + 311.7) * 43758.5453; return x - Math.floor(x); };

export class Sky {
  readonly dome: THREE.Mesh;
  private domeMat: THREE.ShaderMaterial;
  private sun: THREE.Mesh | null = null;
  private moon: THREE.Sprite;
  private moonTex: THREE.CanvasTexture[] = [];
  /** every cloud's puffs in one instanced mesh (a mesh per puff was 70 draw calls) */
  private clouds: THREE.InstancedMesh | null = null;
  private cloudMat: THREE.MeshLambertMaterial;
  private cloudBase: Array<{ x: number; z: number; y: number; s: number }> = [];
  private puffs: Array<{ cloud: number; m: THREE.Matrix4 }> = [];
  private meteor: THREE.Mesh;

  constructor(scene: THREE.Scene, { showSun = true, clouds = true }: { showSun?: boolean; clouds?: boolean } = {}) {
    this.domeMat = new THREE.ShaderMaterial({
      side: THREE.BackSide, depthWrite: false, fog: false,
      uniforms: {
        top: { value: new THREE.Color() }, bottom: { value: new THREE.Color() },
        sunDir: { value: new THREE.Vector3(0, 1, 0) }, sunColor: { value: new THREE.Color() },
        sunGlow: { value: 0 }, stars: { value: 0 }, time: { value: 0 },
      },
      vertexShader: DOME_VS, fragmentShader: DOME_FS,
    });
    this.dome = new THREE.Mesh(new THREE.SphereGeometry(DOME_R, 32, 16), this.domeMat);
    scene.add(this.dome);
    if (showSun) {
      this.sun = new THREE.Mesh(new THREE.SphereGeometry(14, 16, 12), new THREE.MeshBasicMaterial({ color: 0xfff4d6, fog: false, toneMapped: false, transparent: true, depthWrite: false }));
      scene.add(this.sun);
    }
    this.moon = new THREE.Sprite(new THREE.SpriteMaterial({ transparent: true, fog: false, depthWrite: false, toneMapped: false }));
    this.moon.scale.setScalar(64);
    this.moon.visible = false;
    scene.add(this.moon);
    // clouds: a few low-poly puffs, lit by the scene's lights (fog-free, so
    // they read against the sky far off)
    this.cloudMat = new THREE.MeshLambertMaterial({ color: 0xffffff, emissive: 0x555555, flatShading: true, fog: false });
    if (clouds) {
      for (let k = 0; k < 14; k++) {
        const n = 4 + ((hash1(k * 7.3) * 3) | 0);
        for (let i = 0; i < n; i++) {
          const rr = 0.7 + hash1(k * 13 + i) * 0.8;
          const m = new THREE.Matrix4().compose(
            new THREE.Vector3((i - n / 2) * 0.9 + hash1(k + i * 3.1) * 0.4, hash1(k * 2 + i) * 0.35, (hash1(k * 5 + i) - 0.5) * 1.2),
            new THREE.Quaternion(), new THREE.Vector3(rr, rr * 0.6, rr));
          this.puffs.push({ cloud: k, m });
        }
        this.cloudBase.push({ x: (hash1(k * 1.9) - 0.5) * 900, z: (hash1(k * 2.3) - 0.5) * 900, y: 115 + hash1(k * 4.1) * 70, s: 9 + hash1(k * 3.7) * 9 });
      }
      this.clouds = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(1, 1), this.cloudMat, this.puffs.length);
      this.clouds.frustumCulled = false;
      scene.add(this.clouds);
    }
    this.meteor = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial({
      map: meteorTexture(), transparent: true, depthWrite: false, fog: false, toneMapped: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
    }));
    this.meteor.visible = false;
    scene.add(this.meteor);
  }

  /** the sky for time of day `d` round centre (cx, cz); `time` the game
   * clock (twinkle, drift, meteors); `cam` the camera (a meteor faces it) */
  update(d: DayState, cx: number, cz: number, time: number, cam?: THREE.Vector3): void {
    const u = this.domeMat.uniforms;
    (u.top.value as THREE.Color).setHex(d.skyTop);
    (u.bottom.value as THREE.Color).setHex(d.skyBottom);
    (u.sunDir.value as THREE.Vector3).set(...d.sunDir);
    (u.sunColor.value as THREE.Color).setHex(d.sunColor);
    u.sunGlow.value = d.sunGlow;
    u.stars.value = d.stars;
    u.time.value = time;
    this.dome.position.set(cx, 0, cz);
    // the sun, while it's up
    if (this.sun) {
      // (rising and setting it fades in over the skyline, 4-14 deg up: low
      // down, fogged-out buildings cut shapes out of it)
      const up = rise(d.sunDir[1]);
      this.sun.visible = up > 0.01;
      (this.sun.material as THREE.MeshBasicMaterial).opacity = up;
      this.sun.position.set(cx + d.sunDir[0] * SUN_R, d.sunDir[1] * SUN_R, cz + d.sunDir[2] * SUN_R);
      (this.sun.material as THREE.MeshBasicMaterial).color.setHex(d.sunColor);
    }
    // the moon, in tonight's phase (the new moon stays a faint disc)
    const moonUp = rise(d.moonDir[1]);
    this.moon.visible = moonUp > 0.01 && d.night > 0.05;
    if (this.moon.visible) {
      const tex = (this.moonTex[d.moonPhase] ??= moonTexture(d.moonPhase));
      const mm = this.moon.material as THREE.SpriteMaterial;
      if (mm.map !== tex) { mm.map = tex; mm.needsUpdate = true; }
      mm.opacity = Math.min(1, d.night * 1.4) * moonUp;
      this.moon.position.set(cx + d.moonDir[0] * MOON_R, d.moonDir[1] * MOON_R, cz + d.moonDir[2] * MOON_R);
    }
    // clouds drift with the wind, wrapped round the centre; lit by the day
    this.cloudMat.emissive.setScalar(0.33 * (1 - d.night) + 0.08);
    if (this.clouds) {
      // (each cloud shrinks away toward the wrap edge, so none pops in)
      const W = 900, drift = time * 2.2;
      const place = this.cloudBase.map(b => {
        const x = ((((b.x + drift - cx) % W) + W * 1.5) % W) - W / 2;
        const z = ((((b.z - cz) % W) + W * 1.5) % W) - W / 2;
        const edge = Math.min(1, Math.max(0, (W / 2 - Math.max(Math.abs(x), Math.abs(z))) / 70));
        return new THREE.Matrix4().compose(new THREE.Vector3(x + cx, b.y, z + cz), new THREE.Quaternion(), new THREE.Vector3().setScalar(b.s * Math.max(1e-3, edge)));
      });
      const m = new THREE.Matrix4();
      this.puffs.forEach((p, k) => this.clouds!.setMatrixAt(k, m.multiplyMatrices(place[p.cloud], p.m)));
      this.clouds.instanceMatrix.needsUpdate = true;
    }
    // a meteor now and then on a dark night: each 22 s slot may have one,
    // 0.8 s long, somewhere in the sky
    const slot = Math.floor(time / 22), at = time - slot * 22, start = 2 + hash1(slot) * 16;
    const live = d.night > 0.8 && hash1(slot * 3.3) < 0.7 && at >= start && at < start + 0.8;
    this.meteor.visible = live && !!cam;
    if (live && cam) {
      const f = (at - start) / 0.8;
      const az = hash1(slot * 5.1) * Math.PI * 2, el = 0.45 + hash1(slot * 7.7) * 0.5;
      const p0 = new THREE.Vector3(Math.cos(az) * Math.cos(el), Math.sin(el), Math.sin(az) * Math.cos(el));
      const v = new THREE.Vector3(-Math.sin(az), -0.35, Math.cos(az)).normalize();
      const pos = p0.clone().multiplyScalar(380).addScaledVector(v, (f - 0.5) * 120).add(new THREE.Vector3(cx, 0, cz));
      // (a streak along its path, its face turned to the camera)
      const toCam = cam.clone().sub(pos).normalize();
      const y = new THREE.Vector3().crossVectors(toCam, v).normalize();
      const z = new THREE.Vector3().crossVectors(v, y);
      this.meteor.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(v, y, z));
      this.meteor.position.copy(pos);
      this.meteor.scale.set(90, 3, 1);
      (this.meteor.material as THREE.MeshBasicMaterial).opacity = Math.sin(f * Math.PI);
    }
  }
}
