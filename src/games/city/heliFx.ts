// Helicopter extras: the police helicopter's searchlight (a soft cone from the
// belly to a bright disc on the ground just ahead) and the medical
// helicopter's winch (a line with a hook that pays out while rescuing).
import * as THREE from 'three';

export class Searchlight {
  private cone: THREE.Mesh;
  private spot: THREE.Mesh;

  constructor(scene: THREE.Scene) {
    // unit cone pointing down from its apex; scaled to the height each frame
    const geo = new THREE.ConeGeometry(1, 1, 24, 1, true);
    geo.translate(0, -0.5, 0);
    this.cone = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({
      color: 0xfff4c2, transparent: true, opacity: 0.16, depthWrite: false,
      side: THREE.DoubleSide, blending: THREE.AdditiveBlending,
    }));
    this.spot = new THREE.Mesh(new THREE.CircleGeometry(1, 32), new THREE.MeshBasicMaterial({
      color: 0xfff4c2, transparent: true, opacity: 0.4, depthWrite: false, blending: THREE.AdditiveBlending,
    }));
    this.spot.rotation.x = -Math.PI / 2;
    scene.add(this.cone, this.spot);
  }

  /** at night the beam turns bright white (0 day … 1 night, G10) */
  setNight(n: number): void {
    // (the cone passes near the camera: only a touch stronger, the spot much more)
    (this.cone.material as THREE.MeshBasicMaterial).opacity = 0.16 + 0.04 * n;
    (this.spot.material as THREE.MeshBasicMaterial).opacity = 0.4 + 0.45 * n;
    (this.spot.material as THREE.MeshBasicMaterial).color.setHex(n > 0.5 ? 0xffffff : 0xfff4c2);
  }

  /** light the ground `ahead` metres in front of the helicopter */
  update(x: number, alt: number, z: number, heading: number, ahead = 7, radius = 8): void {
    const gx = x + Math.sin(heading) * ahead, gz = z + Math.cos(heading) * ahead;
    const top = alt + 0.8;
    const len = Math.hypot(top, ahead);
    this.cone.position.set(x, top, z);
    this.cone.scale.set(radius, len, radius);
    // tilt the cone's axis from straight down toward the lit spot
    this.cone.rotation.set(0, heading, 0);
    this.cone.rotateX(-Math.atan2(ahead, top));
    this.spot.position.set(gx, 0.2, gz);
    this.spot.scale.setScalar(radius);
  }
}

export class Winch {
  private line: THREE.Mesh;
  private hook: THREE.Mesh;
  private len = 1.2;

  constructor(parent: THREE.Object3D, scale: number) {
    const mat = new THREE.MeshLambertMaterial({ color: 0x5a6472 });
    this.line = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, 1, 6), mat);
    this.hook = new THREE.Mesh(new THREE.TorusGeometry(0.22, 0.07, 6, 12, Math.PI * 1.5), new THREE.MeshLambertMaterial({ color: 0xe25c5c }));
    // hang from the right-hand door (model space; the heli group is scaled)
    for (const m of [this.line, this.hook]) {
      m.position.x = 0.85;
      m.scale.divideScalar(scale);
      parent.add(m);
    }
    this.line.scale.set(1 / scale, 1, 1 / scale);
    this.place(scale);
  }

  /** pay the line out toward `target` metres (eased) */
  update(dt: number, target: number, scale: number): void {
    this.len += (target - this.len) * Math.min(1, dt * 2.5);
    this.place(scale);
  }

  private place(scale: number): void {
    const l = this.len / scale;
    this.line.scale.y = l;
    this.line.position.y = 1.4 - l / 2;
    this.hook.position.y = 1.4 - l - 0.1;
  }
}
