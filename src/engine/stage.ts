// Stage factory: renderer, sky, lights, camera, HUD stats chip.
import { TIERS, startQuality, type QualityTier, renderRatio } from './settings.js';
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
  applyDay(day: DayState, cx: number, cz: number, time: number, cam?: THREE.Vector3, shadow?: ShadowFocus): void;
}

/** where the shadow box sits and how far it reaches (m either side) */
export interface ShadowFocus { x: number; z: number; span: number }

export interface Dressing {
  sun: THREE.DirectionalLight;
  hemi: THREE.HemisphereLight;
  sky: Sky;
  /** the sky dome + sun disc follow a point (the player) */
  followSky(x: number, z: number): void;
  /** the lights, fog and sky for a time of day round centre (cx, cz): the
   * shadow-casting light becomes the moon at night (G10); `shadow` moves
   * the shadow box off the centre (ahead of a flying vehicle) */
  applyDay(day: DayState, cx: number, cz: number, time: number, cam?: THREE.Vector3, shadow?: ShadowFocus): void;
}

/** the shadow light holds its direction until the sun has moved this far
 * from it (rad), then catches up in one step: turned a little every frame,
 * the shadow map's texel grid turned with it and every shadow edge
 * shimmered; now nothing moves between steps (~1.2 a second at the day's
 * pace). Stepping azimuth and elevation apart stepped three times as often. */
const SUN_STEP = Math.cos((0.3 * Math.PI) / 180);

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
  // (its size and blur by the graphics quality, G13)
  const tier = TIERS[startQuality()];
  sun.shadow.mapSize.set(tier.shadowMap, tier.shadowMap);
  const s = shadowSpan;
  Object.assign(sun.shadow.camera, { left: -s, right: s, top: s, bottom: -s, near: 10, far: 400 });
  sun.shadow.bias = -0.0002;
  sun.shadow.normalBias = 0.04;
  // soft, filtered shadows (VSM, blurred): with hard-edged PCF a vehicle
  // driving over the fixed shadow texels crawled with grain — its own
  // shadow's cells showing on its body and its outline stepping cell to cell
  sun.shadow.radius = 4;
  sun.shadow.blurSamples = tier.shadowBlur;
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
  let span = shadowSpan;
  const _dir = new THREE.Vector3(), _r = new THREE.Vector3(), _u = new THREE.Vector3(), _c = new THREE.Vector3();
  /** the direction the shadow light holds (null: none yet) */
  let held: THREE.Vector3 | null = null;
  const _now = new THREE.Vector3();
  const applyDay = (day: DayState, cx: number, cz: number, time: number, cam?: THREE.Vector3, shadow?: ShadowFocus) => {
    (scene.fog as THREE.Fog).color.setHex(day.skyBottom);
    hemi.color.setHex(day.hemiSky);
    hemi.groundColor.setHex(day.hemiGround);
    hemi.intensity = day.hemiI;
    sun.color.setHex(day.lightColor);
    sun.intensity = day.lightI;
    // the shadow box: round the focus (by default the centre), its size, and
    // snapped to whole shadow texels across the light — else every step of
    // the kid slides the texel grid and the shadows' edges crawl; and the
    // light itself turns in SUN_STEP steps (the sky's sun disc still moves
    // smoothly): turned a hair every frame, the grid turned with it and the
    // shadows trembled
    // (the ground it covers shrinks at a lower graphics quality, G13)
    const sx = shadow?.x ?? cx, sz = shadow?.z ?? cz, want = (shadow?.span ?? shadowSpan) * ((sun.userData.spanScale as number | undefined) ?? 1);
    if (want !== span) {
      span = want;
      Object.assign(sun.shadow.camera, { left: -span, right: span, top: span, bottom: -span });
      sun.shadow.camera.updateProjectionMatrix();
    }
    const texel = (2 * span) / sun.shadow.mapSize.x;
    _now.set(...day.lightDir);
    if (!held || held.dot(_now) < SUN_STEP) held = (held ?? new THREE.Vector3()).copy(_now);
    _dir.copy(held);
    _r.set(0, 1, 0).cross(_dir).normalize();
    _u.copy(_dir).cross(_r);
    _c.set(sx, 0, sz);
    const a = Math.round(_c.dot(_r) / texel) * texel, b = Math.round(_c.dot(_u) / texel) * texel, w = _c.dot(_dir);
    _c.copy(_r).multiplyScalar(a).addScaledVector(_u, b).addScaledVector(_dir, w);
    sun.target.position.copy(_c);
    sun.position.copy(_c).addScaledVector(_dir, sunDist);
    sun.target.updateMatrixWorld();
    sky.update(day, cx, cz, time, cam);
  };
  return { sun, hemi, sky, followSky, applyDay };
}

/** the level each renderer is at (its pixel ratio follows the window's size) */
const tiers = new WeakMap<THREE.WebGLRenderer, QualityTier>();

/** switch a running stage to another graphics quality (G13): the render
 * resolution and the sun's shadow map (the edge smoothing stays as the page
 * started — it takes a new page) */
export function applyQuality(renderer: THREE.WebGLRenderer, sun: THREE.DirectionalLight, tier: QualityTier): void {
  tiers.set(renderer, tier);
  renderer.setPixelRatio(renderRatio(tier, innerWidth, innerHeight, window.devicePixelRatio));
  renderer.setSize(innerWidth, innerHeight);
  if (sun.shadow.mapSize.x !== tier.shadowMap) {
    sun.shadow.mapSize.set(tier.shadowMap, tier.shadowMap);
    sun.shadow.map?.dispose();
    sun.shadow.map = null;
    sun.shadow.mapPass?.dispose();
    sun.shadow.mapPass = null;
  }
  sun.shadow.blurSamples = tier.shadowBlur;
  sun.userData.spanScale = tier.shadowSpan;
  // (drawn every n-th frame: the caller sets shadowMap.needsUpdate)
  renderer.shadowMap.autoUpdate = tier.shadowEvery <= 1;
}

export function createStage(opts: StageOptions = {}): Stage {
  // (the resolution and edge smoothing by the graphics quality, G13)
  const tier = TIERS[startQuality()];
  // (a reversed floating-point depth buffer keeps the depth precision even
  // from the near plane to the far: with the usual one, the thin layers of
  // ground — road over slab, markings over road, 1–5 cm apart — flickered
  // against each other from ~100 m out. `?depth=standard` turns it off)
  const reversedDepthBuffer = new URLSearchParams(location.search).get('depth') !== 'standard';
  const renderer = new THREE.WebGLRenderer({ antialias: tier.antialias, powerPreference: 'high-performance', reversedDepthBuffer });
  tiers.set(renderer, tier);
  renderer.setPixelRatio(renderRatio(tier, innerWidth, innerHeight, window.devicePixelRatio));
  renderer.setSize(innerWidth, innerHeight);
  renderer.toneMapping = THREE.NeutralToneMapping; // gentle highlight roll-off, keeps pastels clean
  renderer.toneMappingExposure = 1.06;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.VSMShadowMap;
  document.body.appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  const { sun, sky, followSky, applyDay } = makeSceneDressing(scene, opts);

  const camera = new THREE.PerspectiveCamera(45, innerWidth / innerHeight, 0.1, 1200);
  addEventListener('resize', () => {
    camera.aspect = innerWidth / innerHeight;
    camera.updateProjectionMatrix();
    renderer.setPixelRatio(renderRatio(tiers.get(renderer) ?? TIERS.medium, innerWidth, innerHeight, window.devicePixelRatio));
    renderer.setSize(innerWidth, innerHeight);
  });

  return { renderer, scene, camera, sun, sky, followSky, applyDay };
}

/** what the renderer draws on: the graphics chip's name, flagged when it is
 * the browser's software fallback (SwiftShader, llvmpipe: no hardware
 * acceleration — the usual reason for a few frames a second) */
export function gpuName(renderer: THREE.WebGLRenderer): string {
  try {
    const gl = renderer.getContext();
    const info = gl.getExtension('WEBGL_debug_renderer_info');
    const raw = String(info ? gl.getParameter(info.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER));
    if (/swiftshader|llvmpipe|software|basic render/i.test(raw)) return '\u26a0 software';
    // "ANGLE (Intel, Intel(R) HD Graphics 620 (0x00005916) Direct3D11 vs_5_0 ps_5_0, D3D11)" -> "Intel(R) HD Graphics 620"
    const m = raw.match(/ANGLE \([^,]*, (.*?)(?: \(0x[0-9a-f]+\))?(?: Direct3D| vs_| OpenGL|,|\))/i);
    return (m ? m[1] : raw).slice(0, 40);
  } catch { return '?'; }
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
