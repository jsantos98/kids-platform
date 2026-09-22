// Ladder mini-scene: slide the ladder left/right until it reaches the cat, then
// hold there while the cat climbs down.
import * as THREE from 'three';

export interface LadderSession {
  obj: import('./missions.js').Objective;
  right: THREE.Vector3;
  catPerp: number;
}

const ladder = new THREE.Group();
{
  const railG = new THREE.BoxGeometry(0.09, 4.4, 0.09);
  const rungG = new THREE.BoxGeometry(0.68, 0.07, 0.07);
  const railM = new THREE.MeshLambertMaterial({ color: 0xd9dde2 });
  const rungM = new THREE.MeshLambertMaterial({ color: 0xe8e0d0 });
  for (const rx of [-0.3, 0.3]) {
    const rail = new THREE.Mesh(railG, railM);
    rail.position.set(rx, -2.2, 0);
    rail.castShadow = true;
    ladder.add(rail);
  }
  for (let i = 0; i < 11; i++) {
    const rung = new THREE.Mesh(rungG, rungM);
    rung.position.set(0, -0.2 - i * 0.38, 0);
    ladder.add(rung);
  }
}
ladder.visible = false;

export function getLadderMesh(): THREE.Group {
  return ladder;
}

export function beginLadder(
  scene: THREE.Scene, obj: import('./missions.js').Objective, car: THREE.Object3D,
): LadderSession {
  const d = obj.pos.clone().sub(car.position).setY(0).normalize();
  const right = new THREE.Vector3(-d.z, 0, d.x).normalize();
  const catPerp = 0.92 * right.x;
  ladder.visible = true;
  ladder.position.set(obj.pos.x + 0.92 * right.x, 4.35, obj.pos.z + 0.92 * right.z);
  if (!ladder.parent) scene.add(ladder);
  return { obj, right, catPerp };
}

export function endLadder(): void {
  ladder.visible = false;
}

/** Slide + rescue progress. Returns true when the cat is fully down. */
export function updateLadder(s: LadderSession, aim: number, dt: number): boolean {
  const slide = aim * 2.2;
  ladder.position.set(s.obj.pos.x + s.right.x * slide, 4.35, s.obj.pos.z + s.right.z * slide);
  const cat = s.obj.group.userData.cat as THREE.Object3D;
  if (Math.abs(slide - s.catPerp) < 0.7) {
    s.obj.progress += dt / 1.4;
    cat.position.y = Math.max(0.25, 1.85 - s.obj.progress * 1.5);
  }
  return s.obj.progress >= 1;
}
