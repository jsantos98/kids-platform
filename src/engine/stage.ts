// Stage factory: renderer, sky, lights, camera, HUD stats chip.
import * as THREE from 'three';
import { C } from './palette.js';
import { Sky } from './sky.js';
import { dayState, NOON, type DayState } from './daylight.js';

export { C };

// Cached Lambert material factory — one material per color/options combination.
const matCache = new Map<string, THREE.MeshLambertMaterial>();
export function mat(color: number, opts: THREE.MeshLambertMaterialParameters = {}): THREE.MeshLambertMaterial {
  const key = color + '|' + JSON.stringify(opts);
  if (!matCache.has(key)) {
    matCache.set(key, new THREE.MeshLambertMaterial({ color, flatShading: true, ...opts }));
  }
  return matCache.get(key)!;
}

function shadowed<T extends THREE.Mesh>(m: T, cast = true, receive = true): T {
  m.castShadow = cast;
  m.receiveShadow = receive;
  return m;
}

// Primitive helpers used by the procedural kit (all meshes cast shadows).
export const PRIMS = {
  box(w: number, h: number, d: number, color: number, x = 0, y = 0, z = 0): THREE.Mesh {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat(color));
    m.position.set(x, y, z);
    return shadowed(m);
  },
  rbox(w: number, h: number, d: number, r: number, color: number, x = 0, y = 0, z = 0,
       opts: THREE.MeshLambertMaterialParameters = {}): THREE.Mesh {
    const m = new THREE.Mesh(new RoundedBox(w, h, d, 3, r), mat(color, opts));
    m.position.set(x, y, z);
    return shadowed(m);
  },
  cyl(rt: number, rb: number, h: number, seg: number, color: number, x = 0, y = 0, z = 0,
      rx = 0, ry = 0, rz = 0): THREE.Mesh {
    const m = new THREE.Mesh(new THREE.CylinderGeometry(rt, rb, h, seg), mat(color));
    m.position.set(x, y, z);
    m.rotation.set(rx, ry, rz);
    return shadowed(m);
  },
  cone(r: number, h: number, seg: number, color: number, x = 0, y = 0, z = 0,
       rx = 0, ry = 0, rz = 0): THREE.Mesh {
    const m = new THREE.Mesh(new THREE.ConeGeometry(r, h, seg), mat(color));
    m.position.set(x, y, z);
    m.rotation.set(rx, ry, rz);
    return shadowed(m);
  },
  sphere(r: number, color: number, x = 0, y = 0, z = 0,
         opts: THREE.MeshLambertMaterialParameters = {}): THREE.Mesh {
    const m = new THREE.Mesh(new THREE.SphereGeometry(r, 14, 10), mat(color, opts));
    m.position.set(x, y, z);
    return shadowed(m);
  },
  torus(r: number, t: number, color: number, x = 0, y = 0, z = 0,
        rx = 0, ry = 0, rz = 0): THREE.Mesh {
    const m = new THREE.Mesh(new THREE.TorusGeometry(r, t, 10, 24), mat(color));
    m.position.set(x, y, z);
    m.rotation.set(rx, ry, rz);
    return shadowed(m);
  },
};

import { RoundedBoxGeometry as RoundedBox } from 'three/addons/geometries/RoundedBoxGeometry.js';

export interface StageOptions {
  skyTop?: number;
  skyBottom?: number;
  fogNear?: number;
  fogFar?: number;
  sunPos?: [number, number, number];
  shadowSpan?: number;
  groundR?: number;
  groundColor?: number;
  showSun?: boolean;
  ground?: boolean;
  /** drifting clouds overhead */
  clouds?: boolean;
}

export interface Stage {
  renderer: THREE.WebGLRenderer;
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  sun: THREE.DirectionalLight;
  sky: Sky;
  /** the sky dome + sun disc follow the player across the infinite city */
  followSky(x: number, z: number): void;
  /** the lights and the sky for a time of day, round a centre (G10) */
  applyDay(day: DayState, cx: number, cz: number, time: number, cam?: THREE.Vector3): void;
}

export interface Dressing {
  sun: THREE.DirectionalLight;
  hemi: THREE.HemisphereLight;
  sky: Sky;
  /** the sky dome + sun disc follow a point (the player) */
  followSky(x: number, z: number): void;
  /** the lights, fog and sky for a time of day round centre (cx, cz): the
   * shadow-casting light becomes the moon at night (G10) */
  applyDay(day: DayState, cx: number, cz: number, time: number, cam?: THREE.Vector3): void;
}

/** Sky (sky.ts), fog, hemisphere fill, the warm shadow-casting sun, optional
 * sun disc and ground — everything a pastel scene needs besides its content.
 * Shared by the world stage and the mission scenes (same renderer). A scene
 * that never calls applyDay keeps the day's look with the sun at sunPos. */
export function makeSceneDressing(scene: THREE.Scene, {
  skyTop,
  skyBottom,
  fogNear = 70,
  fogFar = 240,
  sunPos = [60, 80, 40],
  shadowSpan = 60,
  groundR = 140,
  groundColor = C.grass,
  showSun = true,
  ground = true,
  clouds = false,
}: StageOptions = {}): Dressing {
  // the day's look, the sun where the scene put it
  const noon = dayState(0, NOON);
  const l = Math.hypot(...sunPos);
  const dir: [number, number, number] = [sunPos[0] / l, sunPos[1] / l, sunPos[2] / l];
  const still: DayState = {
    ...noon, skyTop: skyTop ?? noon.skyTop, skyBottom: skyBottom ?? noon.skyBottom, sunDir: dir, lightDir: dir,
  };
  scene.fog = new THREE.Fog(still.skyBottom, fogNear, fogFar);
  const sky = new Sky(scene, { showSun, clouds });

  // Lights: strong soft fill, gentle warm sun — pastel scenes read flat and clean
  const hemi = new THREE.HemisphereLight(still.hemiSky, still.hemiGround, still.hemiI);
  scene.add(hemi);
  const sun = new THREE.DirectionalLight(still.lightColor, still.lightI);
  sun.position.set(...sunPos);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  const s = shadowSpan;
  Object.assign(sun.shadow.camera, { left: -s, right: s, top: s, bottom: -s, near: 10, far: 400 });
  sun.shadow.bias = -0.0002;
  sun.shadow.normalBias = 0.04;
  scene.add(sun);
  scene.add(sun.target);
  sky.update(still, 0, 0, 0);

  // Ground
  if (ground) {
    const groundMesh = new THREE.Mesh(new THREE.CircleGeometry(groundR, 56), mat(groundColor));
    groundMesh.rotation.x = -Math.PI / 2;
    groundMesh.receiveShadow = true;
    scene.add(groundMesh);
  }

  // keep the sky centred on the player (the day's look)
  const followSky = (x: number, z: number) => sky.update(still, x, z, 0);
  const sunDist = Math.min(110, l);
  const applyDay = (day: DayState, cx: number, cz: number, time: number, cam?: THREE.Vector3) => {
    (scene.fog as THREE.Fog).color.setHex(day.skyBottom);
    hemi.color.setHex(day.hemiSky);
    hemi.groundColor.setHex(day.hemiGround);
    hemi.intensity = day.hemiI;
    sun.color.setHex(day.lightColor);
    sun.intensity = day.lightI;
    sun.position.set(cx + day.lightDir[0] * sunDist, day.lightDir[1] * sunDist, cz + day.lightDir[2] * sunDist);
    sun.target.position.set(cx, 0, cz);
    sun.target.updateMatrixWorld();
    sky.update(day, cx, cz, time, cam);
  };
  return { sun, hemi, sky, followSky, applyDay };
}

export function createStage(opts: StageOptions = {}): Stage {
  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));
  renderer.setSize(innerWidth, innerHeight);
  renderer.toneMapping = THREE.NeutralToneMapping; // gentle highlight roll-off, keeps pastels clean
  renderer.toneMappingExposure = 1.06;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  document.body.appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  const { sun, sky, followSky, applyDay } = makeSceneDressing(scene, opts);

  const camera = new THREE.PerspectiveCamera(45, innerWidth / innerHeight, 0.1, 1200);
  addEventListener('resize', () => {
    camera.aspect = innerWidth / innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(innerWidth, innerHeight);
  });

  return { renderer, scene, camera, sun, sky, followSky, applyDay };
}

// HUD stats chip (proves the real-time cost of each scene)
export function makeHUD(): { set(t: string): void } {
  const el = document.createElement('div');
  el.style.cssText =
    'position:fixed;left:12px;bottom:12px;padding:6px 12px;border-radius:999px;' +
    "background:rgba(255,252,244,.92);color:#5a6472;font:600 13px/1.4 'Segoe UI',sans-serif;" +
    'letter-spacing:.02em;pointer-events:none;z-index:9';
  document.body.appendChild(el);
  return { set(t: string) { el.textContent = t; } };
}
