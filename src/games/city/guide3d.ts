// In-world guidance, Crazy-Taxi style: a small arrow floating just above the
// vehicle that swings to point the way (along the streets for road
// vehicles), and a tall glowing beacon pillar standing on every mission so
// it can be spotted over the rooftops from anywhere on the island.
//
// The arrow lies on a plane over the vehicle that is tipped toward the
// camera just enough to be seen at a good angle (at least MIN_VIEW): from a
// high chase camera it lies flat over the street, from the plane's low one
// it stands up — so "ahead" reads as up the screen, "behind" as down toward
// the kid, "left" / "right" as left / right, and it is never seen edge-on
// (laid flat, an arrow pointing back at the plane's camera vanished). It is
// drawn over everything, flat-coloured with a white rim and a soft shadow,
// so no vehicle, rotor or roof hides it, by day or night (G2).
import * as THREE from 'three';

const ARROW_RED = 0xe25c5c;
const ARROW_RIM = 0xfffdf8;
const ARROW_SHADOW = 0x3a1d1d;
/** the arrow's size (its shape is ~2.8 m nose to tail at 1) */
const ARROW_SCALE = 0.55;
/** the arrow's plane always meets the line of sight at this angle or more */
const MIN_VIEW = (50 * Math.PI) / 180;

function arrowGeometry(scale: number): THREE.ShapeGeometry {
  // chevron-headed arrow pointing along +y in shape space (+z after laying flat)
  const s = new THREE.Shape();
  const pts: Array<[number, number]> = [[0, 1.6], [1.4, 0.1], [0.55, 0.1], [0.55, -1.2], [-0.55, -1.2], [-0.55, 0.1], [-1.4, 0.1]];
  pts.forEach(([x, y], k) => (k === 0 ? s.moveTo(x * scale, y * scale) : s.lineTo(x * scale, y * scale)));
  s.closePath();
  return new THREE.ShapeGeometry(s);
}

export class GuideArrow {
  readonly group = new THREE.Group();
  /** tips the arrow's plane toward the camera (about the camera's right) */
  private tilt = new THREE.Group();
  /** turns the arrow in its plane */
  private spin = new THREE.Group();
  private yaw = 0;

  constructor(scene: THREE.Scene) {
    const layer = (geo: THREE.BufferGeometry, color: number, order: number, y: number, opacity = 1): THREE.Mesh => {
      const m = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({
        color, depthTest: false, depthWrite: false, fog: false, side: THREE.DoubleSide,
        transparent: opacity < 1, opacity, toneMapped: false,
      }));
      // lay it flat: rotating +90 deg about x maps shape +y onto +z, the
      // heading-0 direction (and the shape's face onto +y)
      m.rotation.x = Math.PI / 2;
      m.position.y = y;
      m.renderOrder = 1000 + order;
      m.frustumCulled = false;
      this.spin.add(m);
      return m;
    };
    // (a soft shadow a little below and behind, the white rim, the body)
    const shadow = layer(arrowGeometry(ARROW_SCALE * 1.18), ARROW_SHADOW, 0, -0.06, 0.35);
    shadow.position.z = -0.12;
    layer(arrowGeometry(ARROW_SCALE * 1.18), ARROW_RIM, 1, 0);
    layer(arrowGeometry(ARROW_SCALE), ARROW_RED, 2, 0.01);
    this.tilt.add(this.spin);
    this.group.add(this.tilt);
    this.group.visible = false;
    scene.add(this.group);
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
    this.group.scale.setScalar(size);
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
