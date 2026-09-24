// Traffic-light props: the Kenney City Kit Roads traffic light, one pole per
// approach (roadLayout TRAFFIC_POLES), with dynamic red / yellow / green
// lamps laid over the kit's baked lamp faces so they can switch each frame.
// A procedural pole stands in if the kit template failed to load.
import * as THREE from 'three';
import { bakedModel } from '../../engine/assets.js';
import { templateToMesh } from '../../engine/baked.js';
import { TRAFFIC_POLES } from '../../worlds/roadLayout.js';

export const LAMP_MATS = {
  red: new THREE.MeshBasicMaterial({ color: 0xff3b30 }),
  yellow: new THREE.MeshBasicMaterial({ color: 0xffcc00 }),
  green: new THREE.MeshBasicMaterial({ color: 0x2ecc40 }),
  off: new THREE.MeshBasicMaterial({ color: 0x2b2f38 }),
};

/** kit pole scale: native 0.515 tall -> ~4.2 m */
const POLE_S = 8.2;
/** lamp heights on the native model (red top, green bottom) */
const LAMP_Y = { red: 0.478, yellow: 0.437, green: 0.395 };

const lampGeo = new THREE.SphereGeometry(0.14, 12, 10);
const fbPoleGeo = new THREE.CylinderGeometry(0.09, 0.11, 4.2, 8);
const fbHeadGeo = new THREE.BoxGeometry(0.42, 1.2, 0.5);
const fbMat = new THREE.MeshLambertMaterial({ color: 0x5f6774 });

/** the three lamps of one head */
export interface LampHead { red: THREE.Mesh; yellow: THREE.Mesh; green: THREE.Mesh }

export interface TrafficLightProps {
  group: THREE.Group;
  /** heads showing the E-W phase */
  ew: LampHead[];
  /** heads showing the N-S phase */
  ns: LampHead[];
}

let poleMesh: THREE.Mesh | null | undefined;
function kitPole(): THREE.Mesh | null {
  if (poleMesh === undefined) {
    const tpl = bakedModel('traffic-light');
    poleMesh = tpl ? templateToMesh(tpl) : null;
    if (poleMesh) {
      poleMesh.geometry.scale(POLE_S, POLE_S, POLE_S);
      poleMesh.castShadow = true;
    }
  }
  return poleMesh;
}

/**
 * Poles around the signalized node at world (x0, z0). `arms` is the node's
 * unfiltered [w, e, n, s] arm set: only approaches that exist get a pole.
 */
export function makeTrafficLights(x0: number, z0: number, arms: boolean[]): TrafficLightProps {
  const group = new THREE.Group();
  const out: TrafficLightProps = { group, ew: [], ns: [] };
  const kit = kitPole();
  for (const [dx, dz, ry, arm, axis] of TRAFFIC_POLES) {
    if (!arms[arm]) continue;
    const g = new THREE.Group();
    g.position.set(x0 + dx, 0.1, z0 + dz);
    g.rotation.y = ry;
    let head: LampHead;
    if (kit) {
      const pole = new THREE.Mesh(kit.geometry, kit.material);
      pole.castShadow = true;
      g.add(pole);
      // lamps just proud of the kit's lamp face (native -x)
      const lamp = (y: number): THREE.Mesh => {
        const m = new THREE.Mesh(lampGeo, LAMP_MATS.off);
        m.position.set(-0.05 * POLE_S - 0.03, y * POLE_S, 0);
        m.scale.set(0.5, 1, 1);
        g.add(m);
        return m;
      };
      head = { red: lamp(LAMP_Y.red), yellow: lamp(LAMP_Y.yellow), green: lamp(LAMP_Y.green) };
    } else {
      const pole = new THREE.Mesh(fbPoleGeo, fbMat);
      pole.position.y = 2.1;
      pole.castShadow = true;
      g.add(pole);
      const box = new THREE.Mesh(fbHeadGeo, fbMat);
      box.position.set(0, 4.3, 0);
      g.add(box);
      const lamp = (y: number): THREE.Mesh => {
        const m = new THREE.Mesh(lampGeo, LAMP_MATS.off);
        m.position.set(-0.24, y, 0);
        g.add(m);
        return m;
      };
      head = { red: lamp(4.7), yellow: lamp(4.3), green: lamp(3.9) };
    }
    group.add(g);
    out[axis].push(head);
  }
  return out;
}

/** light one head for its phase: 'go' green, 'slow' yellow, 'stop' red */
export function setHead(h: LampHead, phase: 'go' | 'slow' | 'stop'): void {
  h.red.material = phase === 'stop' ? LAMP_MATS.red : LAMP_MATS.off;
  h.yellow.material = phase === 'slow' ? LAMP_MATS.yellow : LAMP_MATS.off;
  h.green.material = phase === 'go' ? LAMP_MATS.green : LAMP_MATS.off;
}
