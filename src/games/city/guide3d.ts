// In-world guidance, Crazy-Taxi style: a big arrow floating above the vehicle
// that swings to point the way (along the streets for road vehicles), and a
// tall glowing beacon pillar standing on every mission so it can be spotted
// over the rooftops from anywhere on the island.
import * as THREE from 'three';

const ARROW_RED = 0xe25c5c;
const ARROW_RIM = 0xfffdf8;

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
    const body = new THREE.Mesh(arrowGeometry(1, 0.34), new THREE.MeshLambertMaterial({ color: ARROW_RED }));
    const rim = new THREE.Mesh(arrowGeometry(1.18, 0.2), new THREE.MeshBasicMaterial({ color: ARROW_RIM }));
    rim.position.y = -0.1;
    // lay the arrow flat (rotating +90 deg about x maps shape +y onto world
    // +z, the heading-0 direction), then lift its nose so its face turns
    // toward the chase camera behind and above the vehicle
    for (const m of [rim, body]) {
      m.rotation.x = Math.PI / 2;
      m.castShadow = false;
      this.tilt.add(m);
    }
    this.tilt.rotation.x = -0.55;
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
    this.group.position.set(at.x, at.y + lift + Math.sin(elapsed * 3) * 0.25, at.z);
    this.group.rotation.y = this.yaw;
  }
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
