// Stage factory: renderer, gradient sky, lights, camera, HUD stats chip.
import * as THREE from 'three';
import { C } from './palette.js';

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
}

export interface Stage {
  renderer: THREE.WebGLRenderer;
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  sun: THREE.DirectionalLight;
  /** the sky dome + sun disc follow the player across the infinite city */
  followSky(x: number, z: number): void;
}

export interface Dressing {
  sun: THREE.DirectionalLight;
  /** the sky dome + sun disc follow a point (the player) */
  followSky(x: number, z: number): void;
}

/** Sky dome, fog, hemisphere fill, the warm shadow-casting sun, optional sun
 * disc and ground — everything a pastel scene needs besides its content.
 * Shared by the world stage and the mission scenes (same renderer). */
export function makeSceneDressing(scene: THREE.Scene, {
  skyTop = C.skyTop,
  skyBottom = C.skyBottom,
  fogNear = 70,
  fogFar = 240,
  sunPos = [60, 80, 40],
  shadowSpan = 60,
  groundR = 140,
  groundColor = C.grass,
  showSun = true,
  ground = true,
}: StageOptions = {}): Dressing {
  scene.fog = new THREE.Fog(skyBottom, fogNear, fogFar);

  // Gradient sky dome
  const sky = new THREE.Mesh(
    new THREE.SphereGeometry(480, 20, 12),
    new THREE.ShaderMaterial({
      side: THREE.BackSide,
      depthWrite: false,
      fog: false,
      uniforms: {
        top: { value: new THREE.Color(skyTop) },
        bottom: { value: new THREE.Color(skyBottom) },
      },
      vertexShader: `varying vec3 vP; void main(){ vP = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
      fragmentShader: `uniform vec3 top; uniform vec3 bottom; varying vec3 vP;
        void main(){ float h = normalize(vP + vec3(0.0,60.0,0.0)).y; gl_FragColor = vec4(mix(bottom, top, pow(max(h,0.0),0.85)), 1.0); }`,
    }),
  );
  scene.add(sky);

  // Lights: strong soft fill, gentle warm sun — pastel scenes read flat and clean
  scene.add(new THREE.HemisphereLight(0xeef7fb, 0xd9d0bd, 1.9));
  const sun = new THREE.DirectionalLight(0xfff1d8, 2.9);
  sun.position.set(...sunPos);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  const s = shadowSpan;
  Object.assign(sun.shadow.camera, { left: -s, right: s, top: s, bottom: -s, near: 10, far: 400 });
  sun.shadow.bias = -0.0002;
  sun.shadow.normalBias = 0.04;
  scene.add(sun);
  scene.add(sun.target);

  let disc: THREE.Mesh | null = null;
  const sunDiscOffset = new THREE.Vector3().copy(sun.position).normalize().multiplyScalar(420);
  if (showSun) {
    disc = new THREE.Mesh(
      new THREE.SphereGeometry(14, 16, 12),
      new THREE.MeshBasicMaterial({ color: C.sun, fog: false }),
    );
    disc.position.copy(sun.position).normalize().multiplyScalar(420);
    scene.add(disc);
  }

  // Ground
  if (ground) {
    const groundMesh = new THREE.Mesh(new THREE.CircleGeometry(groundR, 56), mat(groundColor));
    groundMesh.rotation.x = -Math.PI / 2;
    groundMesh.receiveShadow = true;
    scene.add(groundMesh);
  }

  // keep the sky dome and the sun disc centred on the player
  const followSky = (x: number, z: number) => {
    sky.position.set(x, 0, z);
    disc?.position.set(x + sunDiscOffset.x, sunDiscOffset.y, z + sunDiscOffset.z);
  };
  return { sun, followSky };
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
  const { sun, followSky } = makeSceneDressing(scene, opts);

  const camera = new THREE.PerspectiveCamera(45, innerWidth / innerHeight, 0.1, 1200);
  addEventListener('resize', () => {
    camera.aspect = innerWidth / innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(innerWidth, innerHeight);
  });

  return { renderer, scene, camera, sun, followSky };
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
