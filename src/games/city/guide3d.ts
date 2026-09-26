// In-world guidance, Crazy-Taxi style: a small arrow floating just above the
// vehicle (kept small and flat so it never covers the road ahead — the HUD
// badge points the way too) that swings to point the way (along the streets for road vehicles), and a
// tall glowing beacon pillar standing on every mission so it can be spotted
// over the rooftops from anywhere on the island.
import * as THREE from 'three';

const ARROW_RED = 0xe25c5c;
const ARROW_RIM = 0xfffdf8;
/** the arrow's size (its shape is ~2.8 m nose to tail at 1) */
const ARROW_SCALE = 0.55;

function arrowGeometry(scale: number, depth: number): THREE.ExtrudeGeometry {
  // chevron-headed arrow pointing along +y in shape space (+z after laying flat)
  const s = new THREE.Shape();
  const pts: Array<[number, number]> = [[0, 1.6], [1.25, 0.2], [0.5, 0.2], [0.5, -1.2], [-0.5, -1.2], [-0.5, 0.2], [-1.25, 0.2]];
  pts.forEach(([x, y], k) => (k === 0 ? s.moveTo(x * scale, y * scale) : s.lineTo(x * scale, y * scale)));
  s.closePath();
  const g = new THREE.ExtrudeGeometry(s, { depth, bevelEnabled: false });
  g.translate(0, 0, -depth / 2);
  return g;
}

export class GuideArrow {
  readonly group = new THREE.Group();
  private tilt = new THREE.Group();
  private yaw = 0;

  constructor(scene: THREE.Scene) {
    const body = new THREE.Mesh(arrowGeometry(ARROW_SCALE, 0.22), new THREE.MeshLambertMaterial({ color: ARROW_RED }));
    const rim = new THREE.Mesh(arrowGeometry(ARROW_SCALE * 1.18, 0.12), new THREE.MeshBasicMaterial({ color: ARROW_RIM }));
    rim.position.y = -0.07;
    // lay the arrow flat (rotating +90 deg about x maps shape +y onto world
    // +z, the heading-0 direction), then lift its nose so its face turns
    // toward the chase camera behind and above the vehicle
    for (const m of [rim, body]) {
      m.rotation.x = Math.PI / 2;
      m.castShadow = false;
      this.tilt.add(m);
    }
    // (only a little: tilted further it stands up across the view)
    this.tilt.rotation.x = -0.25;
    this.group.add(this.tilt);
    this.group.visible = false;
    scene.add(this.group);
  }

  /**
   * @param at   vehicle position (the arrow hovers above it)
   * @param lift metres above `at`
   * @param bearing world heading to point along (atan2(dx, dz)), or null to hide
   */
  update(dt: number, elapsed: number, at: THREE.Vector3, lift: number, bearing: number | null): void {
    this.group.visible = bearing !== null;
    if (bearing === null) return;
    // ease the swing so the arrow never snaps
    let d = bearing - this.yaw;
    while (d > Math.PI) d -= Math.PI * 2;
    while (d < -Math.PI) d += Math.PI * 2;
    this.yaw += d * Math.min(1, dt * 6);
    this.group.position.set(at.x, at.y + lift + Math.sin(elapsed * 3) * 0.12, at.z);
    this.group.rotation.y = this.yaw;
  }
}

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
