// The mission scenes' street set (G4): a stretch of the city built from the
// city's own kits — the Road Kit's straight tiles with the pavement and kerb
// in its colours, curved street lamps, the neighbours either side of the
// stage (suburban houses or City Kit shops by district), street trees, cars
// parked at the kerb, a second row of buildings behind fading into the fog
// — so a scene looks like the street the kid just drove up. People watch
// from behind cones and hazard tape (animated, cheering at every success).
// The road runs along x at z = roadZ; the stage is the ground behind the
// pavement (z < roadZ − 10), its middle kept clear (`keep`) for the scene's
// own burning house, tree or building. The scene plays at the world's time
// of day: at night the lamps glow and a warm light can play off a fire.
import * as THREE from 'three';
import { makeSceneDressing, PRIMS as P, mat } from '../../../engine/stage.js';
import { bakedModel } from '../../../engine/assets.js';
import { templateToMesh } from '../../../engine/baked.js';
import { rng, type Rng } from '../../../engine/rng.js';
import { person, type Rig } from '../../../engine/rig.js';
import { KIT_M } from '../../../worlds/cityChunk.js';
import { Particles } from '../particles.js';
import { FireSystem } from '../fx/fire.js';
import { SmokeSystem } from '../fx/smoke.js';
import { Sparkles } from '../fx/sparkle.js';
import { makeIconSprite } from '../guide3d.js';

export type SetDistrict = 'residential' | 'urban' | 'downtown' | 'park';

export interface SetOptions {
  seed: number;
  district?: SetDistrict;
  /** the road's centreline (z) */
  roadZ?: number;
  /** the x span behind the pavement left clear for the scene's own subject */
  keep?: [number, number];
  /** onlookers behind the tape, and where the crowd stands */
  onlookers?: number;
  crowdX?: number;
  /** cars parked at the far kerb (outside `keep`) */
  parked?: number;
  /** street lamps along the pavement */
  lamps?: boolean;
  /** buildings across the road too (a camera looking along the street) */
  bothSides?: boolean;
  /** the seafront: water behind the near pavement, over a quay wall */
  sea?: boolean;
}

const SIDEWALK = 0xa1a9c9;     // the road kit's pavement
const KERB = 0xb9c0da;
const LAWN = 0xa8d487;
const PAVED = 0xc9c6bd;
const ROAD_TILE = 14;
const HOUSES = [...'abcdefghijklmnopqrstu'].map(c => 'house-' + c);
const SHOPS = [...'abcdefghijklmn'].map(c => 'bldg-' + c);
const TREES = ['tree-default', 'tree-oak', 'tree-detailed', 'tree-fat', 'tree-small'];
const CARS = ['car-sedan', 'car-suv', 'car-taxi', 'car-hatch'];

/** a kit template as a mesh, standing at (x, y, z), turned ry, scaled s (null when not baked) */
export function kit(name: string, x: number, y: number, z: number, ry = 0, s = KIT_M): THREE.Mesh | null {
  const tpl = bakedModel(name);
  if (!tpl) return null;
  const m = templateToMesh(tpl);
  m.position.set(x, y, z);
  m.rotation.y = ry;
  m.scale.setScalar(s);
  return m;
}

/** a kit template's footprint and height at scale s (m) */
export function kitSize(name: string, s = KIT_M): THREE.Vector3 | null {
  const tpl = bakedModel(name);
  return tpl ? new THREE.Vector3(tpl.size.x * s, tpl.size.y * s, tpl.size.z * s) : null;
}

const HALO_FS = /* glsl */`
varying vec2 vUv;
uniform float uNight;
void main() {
  float r = length(vUv - 0.5) * 2.0;
  float a = pow(max(0.0, 1.0 - r), 2.2) * 0.8 + smoothstep(0.25, 0.0, r) * 0.9;
  gl_FragColor = vec4(1.0, 0.8, 0.55, a * uNight);
}`;
const HALO_VS = /* glsl */`
varying vec2 vUv;
void main() {
  vUv = uv;
  vec4 c = modelViewMatrix * vec4(0.0, 0.0, 0.0, 1.0);
  c.xy += position.xy * length(modelMatrix[0].xyz);
  gl_Position = projectionMatrix * c;
}`;

export class StreetSet {
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(45, 16 / 9, 0.1, 1100);
  readonly particles: Particles;
  readonly sparkles: Sparkles;
  readonly fires: FireSystem;
  readonly smoke: SmokeSystem;
  /** every animated character in the scene (the set steps them) */
  readonly rigs: Rig[] = [];
  readonly onlookers: Rig[] = [];
  /** a warm light for a fire at night (placed by the scene) */
  readonly fireLight = new THREE.PointLight(0xff8a3c, 0, 26, 1.6);
  readonly roadZ: number;
  readonly r: Rng;
  private halo: { value: number } = { value: 0 };
  private cheerT = 0;
  private time = 0;
  /** the camera's resting pose; the set drifts it gently round that */
  private camPos = new THREE.Vector3(0, 6, 20);
  private camLook = new THREE.Vector3(0, 2, 0);
  private push = 0;
  private pushTo = new THREE.Vector3();
  night = 0;
  /** the sea's surface (a seafront set) */
  water: THREE.Mesh | null = null;

  constructor(o: SetOptions) {
    this.r = rng(o.seed * 7919 + 17);
    const r = this.r;
    const district = o.district ?? 'residential';
    const roadZ = this.roadZ = o.roadZ ?? 8;
    const keep = o.keep ?? [-9, 9];
    const scene = this.scene;
    scene.userData.dressing = makeSceneDressing(scene, {
      sunPos: [-30, 45, 38], shadowSpan: 34, fogNear: 55, fogFar: 150, groundR: 170,
      groundColor: district === 'downtown' ? PAVED : 0xa9c88b,
    });
    this.particles = new Particles(scene);
    this.sparkles = new Sparkles(scene);
    this.fires = new FireSystem(scene);
    this.smoke = new SmokeSystem(scene);
    scene.add(this.fireLight);

    // ---- the street: kit road tiles, both pavements with their kerbs ----
    for (let k = -5; k <= 5; k++) {
      const t = kit('road-straight', k * ROAD_TILE, 0.1, roadZ, 0, 1);
      if (t) { t.scale.set(ROAD_TILE, 4, ROAD_TILE); t.receiveShadow = true; scene.add(t); }
    }
    if (!bakedModel('road-straight')) {
      const road = new THREE.Mesh(new THREE.PlaneGeometry(160, 14), mat(0x666b80));
      road.rotation.x = -Math.PI / 2;
      road.position.set(0, 0.11, roadZ);
      road.receiveShadow = true;
      scene.add(road);
    }
    for (const side of [-1, 1]) {
      const z = roadZ + side * 8.6;
      const walk = P.box(160, 0.14, 3.2, SIDEWALK, 0, 0.1, z);
      walk.castShadow = false;
      scene.add(walk);
      const kerb = P.box(160, 0.18, 0.3, KERB, 0, 0.1, roadZ + side * 7.1);
      kerb.castShadow = false;
      scene.add(kerb);
    }
    // the ground behind the pavement: lawns in the suburbs, paving in town
    const ground = district === 'residential' || district === 'park' ? LAWN : PAVED;
    for (const side of o.bothSides ? [-1, 1] : [-1]) {
      if (side < 0 && o.sea) continue;
      const back = P.box(160, 0.06, 60, ground, 0, 0.05, roadZ + side * (10.2 + 30));
      back.castShadow = false;
      scene.add(back);
    }

    // ---- street lamps along the near pavement, arms over the road ----
    if (o.lamps !== false) {
      const hm = fxHaloMaterial(this.halo);
      for (let x = -54; x <= 54; x += 18) {
        if (x > keep[0] - 2 && x < keep[1] + 2) continue;
        const lamp = kit('light-curved', x, 0.1, roadZ - 7.8, -Math.PI, 5.5);
        if (!lamp) continue;
        lamp.castShadow = true;
        scene.add(lamp);
        const h = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), hm);
        h.position.set(x, 3.55, roadZ - 7.8 + 1.05);
        h.scale.setScalar(2.8);
        h.renderOrder = 8;
        scene.add(h);
      }
    }

    // ---- the neighbours either side of the stage, a second row behind ----
    const names = district === 'residential' || district === 'park' ? HOUSES : SHOPS;
    const lotFront = roadZ - 10.4;
    // (a row faces the road: `face` −1 for the near side, +1 across it)
    const row = (x0: number, dir: number, z0: number, count: number, pool: string[], face = -1): void => {
      let x = x0;
      for (let k = 0; k < count; k++) {
        const name = pool[(r() * pool.length) | 0];
        const sz = kitSize(name);
        if (!sz) return;
        const cx = x + dir * (sz.x / 2);
        const m = kit(name, cx, 0.1, z0 + face * sz.z / 2, face < 0 ? 0 : Math.PI);
        if (m) { m.castShadow = true; m.receiveShadow = true; scene.add(m); }
        // a tree in the gap now and then
        if (r() < 0.45) {
          const tr = kit(TREES[(r() * TREES.length) | 0], x + dir * (sz.x + 1.6), 0.1, z0 + face * 2.2, r() * 6, 5 + r() * 2);
          if (tr) { tr.castShadow = true; scene.add(tr); }
        }
        x += dir * (sz.x + 3 + r() * 2);
      }
    };
    const front = names === HOUSES ? lotFront - 2.5 : lotFront;
    if (o.sea) {
      // the sea beyond a stone quay, with a railing along its edge
      const water = new THREE.Mesh(new THREE.PlaneGeometry(400, 200), new THREE.MeshLambertMaterial({ color: 0x5aa9d6 }));
      water.rotation.x = -Math.PI / 2;
      water.position.set(0, 0.03, roadZ - 10.8 - 100);
      water.receiveShadow = true;
      scene.add(water);
      this.water = water;
      scene.add(P.box(160, 0.3, 0.8, 0xb8b2a4, 0, 0.05, roadZ - 10.6));
      for (let x = -60; x <= 60; x += 2.5) scene.add(P.box(0.08, 0.9, 0.08, 0x8b93a3, x, 0.6, roadZ - 10.4));
      scene.add(P.box(160, 0.08, 0.08, 0x8b93a3, 0, 1.05, roadZ - 10.4));
    } else {
      row(keep[1] + 2, 1, front, 5, names);
      row(keep[0] - 2, -1, front, 5, names);
      // behind: taller town buildings (or more houses), fading into the fog
      row(-70, 1, lotFront - 34, 12, district === 'residential' ? HOUSES.concat(SHOPS.slice(0, 4)) : SHOPS);
    }
    if (o.bothSides) {
      const far = roadZ + 10.4 + (names === HOUSES ? 2.5 : 0);
      row(-70, 1, far, 12, names, 1);
      row(-70, 1, far + 34, 12, SHOPS, 1);
    }

    // ---- a few cars parked at the far kerb, clear of the action ----
    for (let k = 0; k < (o.parked ?? 2); k++) {
      const side = k % 2 ? 1 : -1;
      const x = side > 0 ? keep[1] + 8 + r() * 14 : keep[0] - 8 - r() * 14;
      const name = CARS[(r() * CARS.length) | 0];
      const sz = kitSize(name, 1);
      if (!sz) break;
      const car = kit(name, x, 0.17, roadZ + 4.4, Math.PI / 2 * (side > 0 ? -1 : 1), 4.3 / Math.max(sz.x, sz.z));
      if (car) { car.castShadow = true; scene.add(car); }
    }

    // ---- the crowd behind cones and tape ----
    const n = o.onlookers ?? 4;
    if (n > 0) {
      const cx = o.crowdX ?? (keep[1] + 3.5);
      this.tape(cx - 3.2, cx + 3.2, roadZ - 9.2);
      for (let k = 0; k < n; k++) {
        const who = person((o.seed + k * 5) % 12);
        who.root.position.set(cx - 2.4 + (k / Math.max(1, n - 1)) * 4.8 + (r() - 0.5) * 0.4, 0.17, roadZ - 10 - r() * 1.4);
        who.root.rotation.y = Math.atan2(-who.root.position.x * 0.2, 1) + (r() - 0.5) * 0.3;
        who.play('idle', { speed: 0.8 + r() * 0.4 });
        scene.add(who.root);
        this.rigs.push(who);
        this.onlookers.push(who);
      }
    }
  }

  /** a row of traffic cones joined by hazard tape along x at z */
  tape(x0: number, x1: number, z: number): void {
    const n = Math.max(2, Math.round((x1 - x0) / 2.1) + 1);
    for (let k = 0; k < n; k++) this.scene.add(cone(x0 + (k / (n - 1)) * (x1 - x0), z));
    const band = P.box(x1 - x0, 0.1, 0.03, 0xf6c952, (x0 + x1) / 2, 0.72, z);
    band.castShadow = false;
    this.scene.add(band);
  }

  /** add an animated character the set should step */
  addRig(r: Rig, x: number, y: number, z: number, ry = 0): Rig {
    r.root.position.set(x, y, z);
    r.root.rotation.y = ry;
    this.scene.add(r.root);
    this.rigs.push(r);
    return r;
  }

  /** the onlookers cheer for a moment */
  cheer(t = 2.4): void {
    this.cheerT = t;
    this.onlookers.forEach((o, k) => o.play(k % 2 ? 'jump' : 'emote-yes', { fade: 0.15 }));
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
    this.halo.value = this.night;
    this.smoke.light = 1 - this.night * 0.55;
    this.fires.night = this.night;
    for (const r of this.rigs) r.update(dt);
    if (this.cheerT > 0) {
      this.cheerT -= dt;
      if (this.cheerT <= 0) this.onlookers.forEach(o => o.play('idle', { fade: 0.3 }));
    }
    this.fires.update(dt, this.camera);
    this.smoke.update(dt, this.camera);
    this.sparkles.update(dt);
    this.particles.update(dt);
    // a slow handheld drift, and the push toward the success
    if (this.push > 0) this.push = Math.min(1, this.push + dt / 1.2);
    const k = this.push * this.push * (3 - 2 * this.push) * 0.28;
    this.camera.position.set(
      this.camPos.x + Math.sin(t * 0.23) * 0.35,
      this.camPos.y + Math.sin(t * 0.31) * 0.18,
      this.camPos.z,
    ).lerp(this.pushTo, this.push > 0 ? k : 0);
    this.camera.lookAt(this.camLook);
  }

  dispose(): void {
    this.fires.dispose();
    this.smoke.dispose();
    this.sparkles.dispose();
    const walk = (o: THREE.Object3D): void => {
      if (o.userData.shared) return;
      const m = o as THREE.Mesh;
      if (m.isMesh && !(m as unknown as THREE.InstancedMesh).isInstancedMesh) m.geometry?.dispose();
      for (const c of o.children) walk(c);
    };
    walk(this.scene);
  }
}

function fxHaloMaterial(night: { value: number }): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    vertexShader: HALO_VS, fragmentShader: HALO_FS, uniforms: { uNight: night },
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
  });
}

/** the goal's icon floating over it (the HUD's own: 🐱, 🆘, 🦹…), so a
 * small child sees where to go; nothing where there is no page (node tools) */
export function marker(icon: string, size = 1.6): THREE.Object3D {
  if (typeof document === 'undefined') return new THREE.Object3D();
  return makeIconSprite(icon, size);
}

/** a traffic cone: orange, a white band, a dark foot */
export function cone(x: number, z: number): THREE.Group {
  const g = new THREE.Group();
  g.add(P.box(0.5, 0.05, 0.5, 0x4a4f5a, 0, 0.14, 0));
  g.add(P.cone(0.2, 0.62, 12, 0xf2804c, 0, 0.47, 0));
  g.add(P.cyl(0.12, 0.15, 0.1, 12, 0xfaf7ef, 0, 0.5, 0));
  g.position.set(x, 0.02, z);
  return g;
}
