// Shared bits of the mission scenes: the Activity contract the director runs,
// a pastel set (sky, sun, grass, a strip of road), flickering flames, the
// water jet, and the cat/person props. Every scene is its own THREE.Scene
// rendered on the game's renderer while the world keeps ticking behind it.
import * as THREE from 'three';
import { makeSceneDressing, C, PRIMS as P } from '../../../engine/stage.js';
import { bakedModel } from '../../../engine/assets.js';
import { templateToMesh } from '../../../engine/baked.js';
import { makePerson } from '../../../kit/index.js';
import { Particles } from '../particles.js';

/** what the kid does in a scene: the wheel only (+1 = right on screen) */
export interface ActivityInput {
  steer: number;
}

export interface ActivityState {
  /** 0..1 progress bar */
  progress: number;
  /** big prompt text */
  prompt: string;
  done: boolean;
}

export interface Activity {
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  update(dt: number, elapsed: number, inp: ActivityInput): ActivityState;
  /** the water pump sound is on */
  pumping?: boolean;
  /** celebrate in the scene (called once when done) */
  celebrate(): void;
  dispose(): void;
}

/** a scene set: sky + lights + grass, a road strip across the foreground,
 * confetti, and a camera */
export function makeSet(roadZ = 6): { scene: THREE.Scene; camera: THREE.PerspectiveCamera; particles: Particles } {
  const scene = new THREE.Scene();
  // (the game lights the scene for the world's time of day: userData.dressing)
  scene.userData.dressing = makeSceneDressing(scene, { sunPos: [-25, 40, 30], shadowSpan: 26, fogNear: 60, fogFar: 180, groundR: 160 });
  const road = new THREE.Mesh(new THREE.PlaneGeometry(90, 9), new THREE.MeshLambertMaterial({ color: C.road }));
  road.rotation.x = -Math.PI / 2;
  road.position.set(0, 0.02, roadZ);
  road.receiveShadow = true;
  scene.add(road);
  const walk = new THREE.Mesh(new THREE.PlaneGeometry(90, 2.2), new THREE.MeshLambertMaterial({ color: C.sidewalk }));
  walk.rotation.x = -Math.PI / 2;
  walk.position.set(0, 0.03, roadZ - 5.6);
  scene.add(walk);
  const camera = new THREE.PerspectiveCamera(45, innerWidth / innerHeight, 0.1, 1100); // past the 480 m sky dome
  return { scene, camera, particles: new Particles(scene) };
}

const FLAME_COLS = [C.fire1, C.fire2, C.fire3];

/** a flickering flame tuft (3 cones); `health` 0..1 scales it */
export class Flame {
  readonly group = new THREE.Group();
  health = 1;
  private cones: THREE.Mesh[] = [];

  constructor(public x: number, public y: number, public z: number, private size = 1, private seed = 0) {
    for (let k = 0; k < 3; k++) {
      const col = FLAME_COLS[k];
      const m = new THREE.Mesh(
        new THREE.ConeGeometry(0.42 * size * (1 - k * 0.22), 1.3 * size * (1 - k * 0.2), 7),
        new THREE.MeshLambertMaterial({ color: col, emissive: col, emissiveIntensity: 0.6, flatShading: true }),
      );
      m.position.set((k - 1) * 0.28 * size, 0.6 * size, (k % 2) * 0.12);
      this.cones.push(m);
      this.group.add(m);
    }
    this.group.position.set(x, y, z);
  }

  update(elapsed: number): void {
    const h = Math.max(0.001, this.health);
    this.group.visible = this.health > 0.02;
    this.cones.forEach((c, k) => {
      c.scale.set(h, h * (1 + 0.22 * Math.sin(elapsed * 11 + this.seed * 3 + k * 2.1)), h);
    });
  }
}

/** the water stream: droplet beads along an arc from a nozzle to a target */
export class WaterJet {
  private beads: THREE.Mesh[] = [];
  private steam: THREE.Mesh;

  constructor(scene: THREE.Scene) {
    const g = new THREE.SphereGeometry(0.2, 8, 6);
    const m = new THREE.MeshLambertMaterial({ color: 0xbfe3ff, transparent: true, opacity: 0.85 });
    for (let k = 0; k < 22; k++) {
      const b = new THREE.Mesh(g, m);
      scene.add(b);
      this.beads.push(b);
    }
    this.steam = new THREE.Mesh(new THREE.SphereGeometry(0.6, 10, 8),
      new THREE.MeshLambertMaterial({ color: 0xffffff, transparent: true, opacity: 0.7, flatShading: true }));
    scene.add(this.steam);
  }

  /** the pump stops: no stream, no steam */
  hide(): void {
    for (const b of this.beads) b.visible = false;
    this.steam.visible = false;
  }

  /** draw the arc; `hitting` puffs steam at the target */
  update(elapsed: number, from: THREE.Vector3, to: THREE.Vector3, hitting: boolean): void {
    const n = this.beads.length;
    for (const b of this.beads) b.visible = true;
    const lift = from.distanceTo(to) * 0.18;
    this.beads.forEach((b, k) => {
      // beads stream outward: phase slides along the arc
      const t = ((k / n) + elapsed * 1.6) % 1;
      b.position.lerpVectors(from, to, t);
      b.position.y += Math.sin(t * Math.PI) * lift;
      b.scale.setScalar(0.7 + t * 0.8);
    });
    this.steam.visible = hitting;
    this.steam.position.copy(to).add(new THREE.Vector3(0, 0.4, 0.3));
    this.steam.scale.setScalar(1 + Math.sin(elapsed * 14) * 0.25);
  }
}

/** a cat: the Kenney cube pet when it loaded, else a little procedural one */
export function makeCat(): THREE.Object3D {
  const tpl = bakedModel('pet-cat');
  if (tpl) {
    const m = templateToMesh(tpl);
    const s = 0.9 / Math.max(tpl.size.x, tpl.size.z);
    m.scale.setScalar(s);
    m.castShadow = true;
    return m;
  }
  const g = new THREE.Group();
  g.add(P.box(0.28, 0.24, 0.5, 0xff9f43, 0, 0.14, 0));
  g.add(P.sphere(0.15, 0xff9f43, 0, 0.32, 0.22));
  return g;
}

const PEOPLE = ['ped-ma', 'ped-fb', 'ped-mc', 'ped-fd', 'ped-me', 'ped-ff'];

/** a person: a Kenney mini-character (~1.6 m) when loaded, else procedural */
export function makeHuman(k: number): THREE.Object3D {
  const tpl = bakedModel(PEOPLE[k % PEOPLE.length]);
  if (tpl) {
    const m = templateToMesh(tpl);
    m.scale.setScalar(1.6 / tpl.size.y);
    m.castShadow = true;
    return m;
  }
  return makePerson({ shirt: [C.blue, C.pink, C.yellow][k % 3] });
}

/** dispose the scene's own geometries (scenes are one-shot). Subtrees marked
 * `userData.shared` (spawnVehicle clones share the cached GLB's geometry
 * with every other copy in the game) are left alone. */
export function disposeScene(scene: THREE.Scene): void {
  const walk = (o: THREE.Object3D): void => {
    if (o.userData.shared) return;
    const m = o as THREE.Mesh;
    if (m.isMesh) m.geometry?.dispose();
    for (const c of o.children) walk(c);
  };
  walk(scene);
}

/** ease a value toward a target at `rate` per second */
export const ease = (v: number, target: number, rate: number, dt: number): number =>
  v + (target - v) * Math.min(1, dt * rate);
