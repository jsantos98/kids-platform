// Hose mini-scene: sweep the water jet across the spread-out flames until the
// fire is out. Owns the per-flame damage model and the jet/steam visuals.
import * as THREE from 'three';

export interface SpraySession {
  obj: import('./missions.js').Objective;
  /** world-space right vector across the flame line */
  sprayRight: THREE.Vector3;
  flamesMeta: Array<{ perp: number; health: number }>;
}

export interface JetVisuals {
  jet: THREE.Mesh;
  steam: THREE.Mesh;
}

export function beginSpray(obj: import('./missions.js').Objective, car: THREE.Object3D): SpraySession {
  const toFire = obj.pos.clone().sub(car.position).setY(0).normalize();
  const sprayRight = new THREE.Vector3(-toFire.z, 0, toFire.x).normalize();
  const flamesMeta = (obj.flames ?? []).map(f => {
    const wp = f.getWorldPosition(new THREE.Vector3());
    return { perp: wp.clone().sub(obj.pos).dot(sprayRight), health: 1 };
  });
  return { obj, sprayRight, flamesMeta };
}

/** Returns the extinguished fraction 0..1. */
export function updateSpray(
  s: SpraySession, dt: number, elapsed: number, hoseAim: number,
  car: THREE.Object3D, visuals: JetVisuals,
): number {
  const { jet, steam } = visuals;
  const toFire = s.obj.pos.clone().sub(new THREE.Vector3(car.position.x, 0, car.position.z));
  const dist = toFire.length();
  const aim = hoseAim * Math.min(3.2, dist * 0.3 + 0.9);
  let sum = 0;
  s.obj.flames!.forEach((f, i) => {
    const meta = s.flamesMeta[i];
    if (Math.abs(meta.perp - aim) < 0.55 && meta.health > 0) meta.health = Math.max(0, meta.health - dt / 1.6);
    sum += meta.health;
    const k = meta.health;
    f.visible = k > 0.01;
    f.scale.set(Math.max(0.01, k), Math.max(0.01, k) * (1 + 0.18 * Math.sin(elapsed * 11 + i * 2.1)), Math.max(0.01, k));
  });
  const doneFrac = 1 - sum / s.obj.flames!.length;
  jet.visible = true;
  const nozzle = car.localToWorld(new THREE.Vector3(0, 1.6, 2.2));
  const target = s.obj.pos.clone().addScaledVector(s.sprayRight, aim).add(new THREE.Vector3(0, 0.9, 0));
  jet.position.copy(nozzle).add(target).multiplyScalar(0.5);
  jet.lookAt(target);
  jet.rotateX(Math.PI / 2);
  jet.scale.set(1, Math.max(0.1, nozzle.distanceTo(target)), 1);
  steam.visible = true;
  steam.position.copy(target).add(new THREE.Vector3(0, 0.35, 0));
  steam.scale.setScalar(1 + Math.sin(elapsed * 14) * 0.25);
  s.obj.smoke!.forEach((sm, i) => {
    const ph = (elapsed * 0.45 + i * 0.75) % 2.3;
    sm.position.y = 1.2 + ph * 1.1;
    (sm.material as THREE.MeshLambertMaterial).opacity = 0.4 * (1 - ph / 2.3) * (1 - doneFrac);
  });
  return doneFrac;
}

export function endSpray(visuals: JetVisuals): void {
  visuals.jet.visible = false;
  visuals.steam.visible = false;
}
