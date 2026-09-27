// What the crews wear on their heads (G4): a Kenney character is a skinned
// model whose head is a bone in the model's own units, so a hat rides the
// head bone, sat on the head mesh's crown as measured in the bind pose — a
// firefighter's red helmet, a police officer's peaked cap, a medic's cap.
import * as THREE from 'three';
import { C } from '../../../engine/stage.js';
import type { Rig } from '../../../engine/rig.js';

export type HatKind = 'fire' | 'police' | 'medic' | 'beanie';

const lambert = (color: number): THREE.MeshLambertMaterial => new THREE.MeshLambertMaterial({ color });

function hat(kind: HatKind): THREE.Group {
  const g = new THREE.Group();
  if (kind === 'fire') {
    g.add(new THREE.Mesh(new THREE.SphereGeometry(0.62, 18, 10, 0, Math.PI * 2, 0, Math.PI / 2), lambert(C.red)));
    g.add(new THREE.Mesh(new THREE.CylinderGeometry(0.78, 0.78, 0.06, 20), lambert(0xc24747)));
    const badge = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.2, 0.05), lambert(0xf6c952));
    badge.position.set(0, 0.28, 0.6);
    g.add(badge);
  } else if (kind === 'beanie') {
    // the robber's black woolly hat
    g.add(new THREE.Mesh(new THREE.SphereGeometry(0.6, 16, 8, 0, Math.PI * 2, 0, Math.PI / 2), lambert(0x2b2d33)));
    const band = new THREE.Mesh(new THREE.CylinderGeometry(0.62, 0.62, 0.18, 18), lambert(0x3b3e46));
    band.position.y = 0.05;
    g.add(band);
  } else {
    const col = kind === 'police' ? 0x2f4f8f : 0xfaf7ef;
    const crown = new THREE.Mesh(new THREE.CylinderGeometry(0.6, 0.56, 0.34, 20), lambert(col));
    crown.position.y = 0.17;
    g.add(crown);
    const peak = new THREE.Mesh(new THREE.BoxGeometry(0.8, 0.05, 0.42), lambert(kind === 'police' ? 0x1f2f55 : 0xe25c5c));
    peak.position.set(0, 0.02, 0.6);
    g.add(peak);
    const badge = new THREE.Mesh(new THREE.BoxGeometry(kind === 'police' ? 0.2 : 0.26, kind === 'police' ? 0.16 : 0.08, 0.04), lambert(kind === 'police' ? 0xf6c952 : 0xe25c5c));
    badge.position.set(0, 0.2, 0.6);
    g.add(badge);
    if (kind === 'medic') {
      const bar = badge.clone();
      bar.scale.set(0.3, 3.2, 1);
      g.add(bar);
    }
  }
  return g;
}

/** put a hat on a character once its model has loaded */
export function wearHat(who: Rig, kind: HatKind): Rig {
  who.onLoad(r => {
    const head = r.node('head');
    const mesh = r.node('head-mesh') as THREE.Mesh | null;
    if (!head || !mesh) return;
    mesh.geometry.computeBoundingBox();
    const hb = mesh.geometry.boundingBox!;
    let y = 0;
    for (let o: THREE.Object3D | null = head; o && o !== mesh.parent; o = o.parent) y += o.position.y;
    const across = hb.max.x - hb.min.x;
    const h = hat(kind);
    h.scale.setScalar(across * (kind === 'fire' ? 0.85 : 0.7));
    h.position.set((hb.min.x + hb.max.x) / 2, hb.max.y - y - across * (kind === 'fire' || kind === 'beanie' ? 0.28 : 0.12), (hb.min.z + hb.max.z) / 2);
    head.add(h);
  });
  return who;
}
