// In-world guidance, Crazy-Taxi style: an arrow floating just above the
// vehicle that swings to point the way (along the streets for road
// vehicles), and a tall glowing beacon pillar standing on every mission so
// it can be spotted over the rooftops from anywhere on the island.
//
// The arrow is a chunky, rounded, glossy 3D piece: bevelled edges, a warm
// gradient from an orange tail to a golden nose, a gentle breathing pulse,
// and see-through enough that the street behind it shows. It lives in its
// own little scene with its own lights, drawn after the world over a
// cleared depth buffer (`drawOver`), so it is properly shaded yet never
// hidden by the vehicle, its rotor or a roof — and looks the same by day
// and night. It lies on a plane over the vehicle tipped toward the camera
// just enough to meet the line of sight at MIN_VIEW or more: from a high
// chase camera it lies flat over the street, from the plane's low one it
// stands up — "ahead" reads as up the screen, "behind" as down toward the
// kid, and it is never seen edge-on (G2).
import * as THREE from 'three';

/** the gradient: the tail's colour, the nose's */
const TAIL = new THREE.Color(0xf2410f);
const NOSE = new THREE.Color(0xffb400);
/** the arrow's size (its shape is ~2.7 m nose to tail at 1) */
const ARROW_SCALE = 0.42;
/** the arrow's plane always meets the line of sight at this angle or more */
const MIN_VIEW = (50 * Math.PI) / 180;
/** the shape's extent along its length (tail … nose, shape units) */
const TAIL_Y = -1.15, NOSE_Y = 1.55;

function norm(x: number, y: number): { x: number; y: number } {
  const l = Math.hypot(x, y) || 1;
  return { x: x / l, y: y / l };
}

/** the arrow's outline (pointing +y), every corner rounded; `grow` pushes
 * it outward */
function arrowShape(grow = 0): THREE.Shape {
  // [x, y, corner radius]: a swept-back chevron head on a short fat shaft
  const pts: Array<[number, number, number]> = [
    [0, NOSE_Y, 0.3], [1.38, 0.02, 0.24], [0.52, 0.34, 0.12], [0.52, TAIL_Y, 0.2],
    [-0.52, TAIL_Y, 0.2], [-0.52, 0.34, 0.12], [-1.38, 0.02, 0.24],
  ];
  const P = pts.map(([x, y, r], i) => {
    if (!grow) return { x, y, r };
    // (each corner moves along its bisector so both sides move out by `grow`;
    // the outline runs clockwise, so an edge's outward normal is (-ey, ex))
    const [px, py] = pts[(i + pts.length - 1) % pts.length], [nx, ny] = pts[(i + 1) % pts.length];
    const e1 = norm(x - px, y - py), e2 = norm(nx - x, ny - y);
    const n1 = { x: -e1.y, y: e1.x }, n2 = { x: -e2.y, y: e2.x };
    const b = norm(n1.x + n2.x, n1.y + n2.y);
    const k = grow / Math.max(0.35, b.x * n1.x + b.y * n1.y);
    return { x: x + b.x * k, y: y + b.y * k, r: r + grow * 0.6 };
  });
  const s = new THREE.Shape();
  P.forEach((c, i) => {
    const prev = P[(i + P.length - 1) % P.length], next = P[(i + 1) % P.length];
    const a = norm(prev.x - c.x, prev.y - c.y), b = norm(next.x - c.x, next.y - c.y);
    const r = Math.min(c.r, Math.hypot(prev.x - c.x, prev.y - c.y) / 2.2, Math.hypot(next.x - c.x, next.y - c.y) / 2.2);
    const p0 = { x: c.x + a.x * r, y: c.y + a.y * r }, p1 = { x: c.x + b.x * r, y: c.y + b.y * r };
    if (i === 0) s.moveTo(p0.x, p0.y); else s.lineTo(p0.x, p0.y);
    s.quadraticCurveTo(c.x, c.y, p1.x, p1.y);
  });
  s.closePath();
  return s;
}

/** a rounded, bevelled slab of the arrow's shape, centred on its thickness,
 * coloured along its length (0 tail … 1 nose) */
function arrowSlab(grow: number, depth: number, bevel: number, colour: (along: number) => THREE.Color): THREE.BufferGeometry {
  const g = new THREE.ExtrudeGeometry(arrowShape(grow), {
    depth, bevelEnabled: true, bevelThickness: bevel, bevelSize: bevel * 0.8, bevelSegments: 4, curveSegments: 10,
  });
  g.translate(0, 0, -depth / 2);
  g.scale(ARROW_SCALE, ARROW_SCALE, ARROW_SCALE);
  const pos = g.attributes.position;
  const col = new Float32Array(pos.count * 3);
  for (let i = 0; i < pos.count; i++) {
    const c = colour((pos.getY(i) / ARROW_SCALE - TAIL_Y) / (NOSE_Y - TAIL_Y));
    col.set([c.r, c.g, c.b], i * 3);
  }
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  return g;
}

export class GuideArrow {
  /** the arrow's own scene (drawn over the world: drawOver) */
  readonly overlay = new THREE.Scene();
  readonly group = new THREE.Group();
  /** tips the arrow's plane toward the camera (about the camera's right) */
  private tilt = new THREE.Group();
  /** turns the arrow in its plane */
  private spin = new THREE.Group();
  private glow = { value: 0 };
  private yaw = 0;
  /** the key light rides over the camera's shoulder, so the gloss always catches it */
  private key = new THREE.DirectionalLight(0xffffff, 1.7);

  constructor() {
    // the body: glossy, its gradient lit by its own lights, with a soft
    // breathing glow
    // (see-through, but still writing depth, so its own far side stays hidden)
    const mat = new THREE.MeshPhongMaterial({ vertexColors: true, shininess: 60, specular: 0x4a4a4a, fog: false, transparent: true, opacity: 0.72 });
    mat.onBeforeCompile = sh => {
      sh.uniforms.uGlow = this.glow;
      sh.fragmentShader = sh.fragmentShader
        .replace('#include <common>', '#include <common>\nuniform float uGlow;')
        .replace('#include <opaque_fragment>', 'outgoingLight += diffuseColor.rgb * uGlow;\n#include <opaque_fragment>');
    };
    const body = new THREE.Mesh(arrowSlab(0, 0.3, 0.14, f => TAIL.clone().lerp(NOSE, f)), mat);
    // (lay it flat: rotating +90 deg about x maps shape +y onto +z, the
    // heading-0 direction, and the shape's face onto +y)
    for (const m of [body]) {
      m.rotation.x = Math.PI / 2;
      m.frustumCulled = false;
      this.spin.add(m);
    }
    this.tilt.add(this.spin);
    this.group.add(this.tilt);
    this.group.visible = false;
    this.overlay.add(this.group);
    this.overlay.add(new THREE.HemisphereLight(0xfff4e6, 0x7a5040, 1.05));
    this.overlay.add(this.key, this.key.target);
  }

  /**
   * @param at   vehicle position (the arrow hovers above it)
   * @param lift metres above `at`
   * @param bearing world heading to point along (atan2(dx, dz)), or null to hide
   * @param size   scale (the game keeps it the same size on screen whatever
   *               the camera's distance)
   * @param cam    the camera's position (the arrow tips toward it)
   */
  update(dt: number, elapsed: number, at: THREE.Vector3, lift: number, bearing: number | null, size: number, cam: THREE.Vector3): void {
    this.group.visible = bearing !== null;
    if (bearing === null) return;
    // ease the swing so the arrow never snaps
    let d = bearing - this.yaw;
    while (d > Math.PI) d -= Math.PI * 2;
    while (d < -Math.PI) d += Math.PI * 2;
    this.yaw += d * Math.min(1, dt * 6);
    // the camera's view of the arrow: which way it looks (yaw) and how far
    // down (pitch); tip the plane by what the pitch lacks of MIN_VIEW
    const y = at.y + lift + Math.sin(elapsed * 3) * 0.12 * size;
    const dx = at.x - cam.x, dz = at.z - cam.z;
    const camYaw = Math.atan2(dx, dz);
    const pitch = Math.atan2(cam.y - y, Math.hypot(dx, dz));
    const tip = Math.min(MIN_VIEW, Math.max(0, MIN_VIEW - pitch));
    const rel = this.yaw - camYaw;
    // (pointing back, the tipped arrow's nose dips toward the vehicle: lift it clear)
    const dip = Math.max(0, -Math.cos(rel)) * Math.sin(tip) * 1.6 * ARROW_SCALE * size;
    this.group.position.set(at.x, y + dip, at.z);
    this.group.rotation.set(0, camYaw, 0);
    this.tilt.rotation.x = -tip;
    this.spin.rotation.y = rel;
    // a breath: a touch bigger and brighter, then back
    const breath = 0.5 + 0.5 * Math.sin(elapsed * 4);
    this.group.scale.setScalar(size * (1 + 0.05 * breath));
    this.glow.value = 0.04 + 0.1 * breath;
    // the key light from over the camera's shoulder
    this.key.position.set(cam.x - dz * 0.3, cam.y + 30, cam.z + dx * 0.3);
    this.key.target.position.copy(this.group.position);
    this.key.target.updateMatrixWorld();
  }

  /** draw the arrow over the rendered world (call right after rendering it) */
  drawOver(renderer: THREE.WebGLRenderer, camera: THREE.Camera): void {
    if (!this.group.visible) return;
    const auto = renderer.autoClear, reset = renderer.info.autoReset;
    // (the frame's stats keep the world's draw calls, plus the arrow's)
    renderer.autoClear = false;
    renderer.info.autoReset = false;
    renderer.clearDepth();
    renderer.render(this.overlay, camera);
    renderer.autoClear = auto;
    renderer.info.autoReset = reset;
  }
}

/** each goal's icon — the HUD badge shows it and the goal floats it over
 * itself (makeIconSprite), so the kid sees there is a goal and what it is */
export const GOAL_ICON = { robber: '🦹', gates: '🏁', rings: '⭕', buoys: '🚩', station: '🚉' } as const;

const iconTex = new Map<string, THREE.CanvasTexture>();

/** the icon drawn on a soft white badge (one texture per icon) */
function iconTexture(icon: string): THREE.CanvasTexture {
  let t = iconTex.get(icon);
  if (t) return t;
  const S = 256;
  const cv = document.createElement('canvas');
  cv.width = S;
  cv.height = S;
  const g = cv.getContext('2d')!;
  g.beginPath();
  g.arc(S / 2, S / 2, S / 2 - 18, 0, Math.PI * 2);
  g.fillStyle = 'rgba(255, 253, 248, 0.94)';
  g.fill();
  g.lineWidth = 5;
  g.strokeStyle = 'rgba(60, 40, 30, 0.18)';
  g.stroke();
  g.font = '148px "Segoe UI Emoji", "Apple Color Emoji", "Noto Color Emoji", sans-serif';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText(icon, S / 2, S / 2 + 8);
  t = new THREE.CanvasTexture(cv);
  t.colorSpace = THREE.SRGBColorSpace;
  iconTex.set(icon, t);
  return t;
}

/** a call's icon floating over it — the same one the HUD badge shows — so
 * two calls side by side can be told apart (always faces the camera) */
export function makeIconSprite(icon: string, world = 3.2): THREE.Sprite {
  const s = new THREE.Sprite(new THREE.SpriteMaterial({
    map: iconTexture(icon), transparent: true, depthWrite: false, fog: false,
  }));
  s.scale.setScalar(world);
  s.renderOrder = 3;
  return s;
}

const beaconGeo = new THREE.CylinderGeometry(1.7, 1.7, 90, 20, 1, true);
beaconGeo.translate(0, 45, 0);

/** a tall translucent light pillar in a mission's colour (not fogged, so it
 * shows over the rooftops from far across the island) */
export function makeBeacon(color: number): THREE.Mesh {
  const m = new THREE.Mesh(beaconGeo, new THREE.MeshBasicMaterial({
    color, transparent: true, opacity: 0.35, depthWrite: false, fog: false,
    side: THREE.DoubleSide, blending: THREE.AdditiveBlending,
  }));
  m.renderOrder = 2;
  return m;
}

/** gentle pulse; brighter when the mission is far so it stays findable */
export function pulseBeacon(b: THREE.Mesh, elapsed: number, index: number, dist: number): void {
  const far = Math.min(1, dist / 180);
  (b.material as THREE.MeshBasicMaterial).opacity = (0.18 + 0.2 * far) * (0.8 + 0.2 * Math.sin(elapsed * 3 + index));
  // melt away up close: the mission itself is right there
  b.visible = dist > 14;
}
