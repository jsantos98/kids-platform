// The pirate scenes' stage (G15, G4): open sea to the horizon under the
// world's sky and time of day — a waving water plane, the kid's pirate ship
// and whatever the scene puts on the water or the beach — with the same
// helpers the street set gives the other scenes: the camera's resting shot
// and a gentle push toward a success, sparkles, splashes and smoke, and the
// animated characters stepped every frame. Pirate Kit models come from the
// sea's bake (`pk-*`, sea.ts) at their kit scale.
import * as THREE from 'three';
import { makeSceneDressing, mat } from '../../../engine/stage.js';
import { bakedModel } from '../../../engine/assets.js';
import { templateToMesh } from '../../../engine/baked.js';
import { rng, type Rng } from '../../../engine/rng.js';
import type { Rig } from '../../../engine/rig.js';
import { Particles } from '../particles.js';
import { SmokeSystem } from '../fx/smoke.js';
import { Sparkles } from '../fx/sparkle.js';
import { PK_M } from '../sea.js';

/** a Pirate Kit model as a mesh at scale s (PK_M m a unit), standing on
 * y = 0 and centred, turned ry — a group with a stand-in box when it isn't
 * baked (the headless checks) */
export function pkModel(name: string, s = PK_M, ry = 0): THREE.Object3D {
  const t = bakedModel(`pk-${name}`);
  if (!t) {
    const g = new THREE.Group();
    g.add(new THREE.Mesh(new THREE.BoxGeometry(s, s, s), mat(0x8a6a4a)));
    g.rotation.y = ry;
    return g;
  }
  const m = templateToMesh(t);
  m.geometry.scale(s, s, s);
  m.geometry.computeBoundingBox();
  const bb = m.geometry.boundingBox!;
  m.geometry.translate(-(bb.min.x + bb.max.x) / 2, -bb.min.y, -(bb.min.z + bb.max.z) / 2);
  m.rotation.y = ry;
  m.castShadow = true;
  m.receiveShadow = true;
  return m;
}

/** the swell the scene's water and everything floating on it ride */
export function swell(x: number, z: number, t: number): number {
  return 0.22 * Math.sin(0.11 * x + t * 1.1) + 0.16 * Math.sin(0.09 * z - t * 0.8) + 0.08 * Math.sin(0.2 * (x + z) + t * 1.7);
}

export class SeaSet {
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(45, 16 / 9, 0.1, 1100);
  readonly particles: Particles;
  readonly sparkles: Sparkles;
  readonly smoke: SmokeSystem;
  readonly rigs: Rig[] = [];
  readonly r: Rng;
  night = 0;
  private water: THREE.Mesh;
  private base: Float32Array;
  private time = 0;
  private camPos = new THREE.Vector3(0, 8, 20);
  private camLook = new THREE.Vector3(0, 2, 0);
  private push = 0;
  private pushTo = new THREE.Vector3();
  private rings: Array<{ m: THREE.Mesh; t: number }> = [];

  constructor(seed: number, opts: { fogFar?: number } = {}) {
    this.r = rng(seed * 7919 + 31);
    const scene = this.scene;
    scene.userData.dressing = makeSceneDressing(scene, {
      sunPos: [-30, 45, 38], shadowSpan: 45, fogNear: 60, fogFar: opts.fogFar ?? 230, ground: false,
    });
    this.particles = new Particles(scene);
    this.sparkles = new Sparkles(scene);
    this.smoke = new SmokeSystem(scene);
    this.water = new THREE.Mesh(new THREE.PlaneGeometry(420, 420, 64, 64), mat(0x72c3de));
    this.water.rotation.x = -Math.PI / 2;
    this.water.receiveShadow = true;
    scene.add(this.water);
    this.base = Float32Array.from((this.water.geometry.attributes.position as THREE.BufferAttribute).array);
  }

  /** the sea's height at (x, z) now */
  sea(x: number, z: number): number { return swell(x, z, this.time); }

  /** add an animated character the set should step */
  addRig(r: Rig, x: number, y: number, z: number, ry = 0, parent: THREE.Object3D = this.scene): Rig {
    r.root.position.set(x, y, z);
    r.root.rotation.y = ry;
    parent.add(r.root);
    this.rigs.push(r);
    return r;
  }

  /** a splash where something falls in: spray and a ring of foam spreading */
  splash(x: number, z: number, size = 1): void {
    this.particles.splash(new THREE.Vector3(x, 0.4, z));
    for (let k = 0; k < 3; k++) this.smoke.puff(x + (this.r() - 0.5) * size, 0.6 + k * 0.5 * size, z + (this.r() - 0.5) * size, 0.9 * size, 0, 0.8);
    const ring = new THREE.Mesh(new THREE.RingGeometry(0.6, 1.1, 24), mat(0xffffff, { transparent: true, opacity: 0.8, depthWrite: false }));
    ring.rotation.x = -Math.PI / 2;
    ring.position.set(x, 0.25, z);
    ring.scale.setScalar(size);
    this.scene.add(ring);
    this.rings.push({ m: ring, t: 0 });
  }

  /** where the camera rests and what it looks at */
  shot(pos: THREE.Vector3Like, look: THREE.Vector3Like): void {
    this.camPos.set(pos.x, pos.y, pos.z);
    this.camLook.set(look.x, look.y, look.z);
    this.camera.position.copy(this.camPos);
    this.camera.lookAt(this.camLook);
    this.camera.updateMatrixWorld(true);
  }

  /** ease the camera a little toward a point (the success moment) */
  pushIn(to: THREE.Vector3Like): void {
    this.pushTo.set(to.x, to.y, to.z);
    this.push = 0.001;
  }

  update(dt: number): void {
    this.time += dt;
    const t = this.time;
    this.smoke.light = 1 - this.night * 0.55;
    const pos = this.water.geometry.attributes.position as THREE.BufferAttribute;
    const arr = pos.array as Float32Array;
    for (let i = 0; i < arr.length; i += 3) arr[i + 2] = swell(this.base[i], -this.base[i + 1], t);
    pos.needsUpdate = true;
    for (const r of this.rigs) r.update(dt);
    for (let i = this.rings.length - 1; i >= 0; i--) {
      const g = this.rings[i];
      g.t += dt;
      g.m.scale.setScalar(1 + g.t * 5);
      (g.m.material as THREE.MeshLambertMaterial).opacity = Math.max(0, 0.8 - g.t * 0.9);
      if (g.t > 0.9) { this.scene.remove(g.m); g.m.geometry.dispose(); this.rings.splice(i, 1); }
    }
    this.smoke.update(dt, this.camera);
    this.sparkles.update(dt);
    this.particles.update(dt);
    // a slow drift with the swell, and the push toward the success
    if (this.push > 0) this.push = Math.min(1, this.push + dt / 1.2);
    const k = this.push * this.push * (3 - 2 * this.push) * 0.28;
    this.camera.position.set(
      this.camPos.x + Math.sin(t * 0.23) * 0.4,
      this.camPos.y + Math.sin(t * 0.7) * 0.25,
      this.camPos.z,
    ).lerp(this.pushTo, this.push > 0 ? k : 0);
    this.camera.lookAt(this.camLook);
  }

  dispose(): void {
    this.smoke.dispose();
    this.sparkles.dispose();
    const walk = (o: THREE.Object3D): void => {
      if (o.userData.shared) return;
      const m = o as THREE.Mesh;
      if (m.isMesh) m.geometry?.dispose();
      for (const c of o.children) walk(c);
    };
    walk(this.scene);
  }
}
