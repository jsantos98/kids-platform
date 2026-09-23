// Traffic-light prop factory (lamps are swapped to phase materials each frame).
import * as THREE from 'three';

export const LAMP_MATS = {
  red: new THREE.MeshBasicMaterial({ color: 0xff3b30 }),
  yellow: new THREE.MeshBasicMaterial({ color: 0xffcc00 }),
  green: new THREE.MeshBasicMaterial({ color: 0x2ecc40 }),
};

const lightPoleGeo = new THREE.CylinderGeometry(0.09, 0.11, 4.2, 8);
const lightHeadGeo = new THREE.BoxGeometry(0.52, 1.25, 0.42);
const lampGeo = new THREE.SphereGeometry(0.3, 12, 10);
const lightPoleMat = new THREE.MeshLambertMaterial({ color: 0x5f6774 });

export interface TrafficLightProps {
  group: THREE.Group;
  /** lamps controlling the E-W road */
  ew: THREE.Mesh[];
  /** lamps controlling the N-S road */
  ns: THREE.Mesh[];
}

export function makeTrafficLights(x0: number, z0: number): TrafficLightProps {
  const group = new THREE.Group();
  const make = (x: number, z: number): THREE.Mesh[] => {
    const g = new THREE.Group();
    const pole = new THREE.Mesh(lightPoleGeo, lightPoleMat);
    pole.position.y = 2.1;
    pole.castShadow = true;
    g.add(pole);
    const head = new THREE.Mesh(lightHeadGeo, lightPoleMat);
    head.position.y = 4.5;
    g.add(head);
    // lamps on both faces so the colour reads from any approach direction
    const lamps: THREE.Mesh[] = [];
    for (const face of [0.3, -0.3]) {
      const lamp = new THREE.Mesh(lampGeo, LAMP_MATS.red);
      lamp.position.set(0, 4.5, face);
      g.add(lamp);
      lamps.push(lamp);
    }
    g.position.set(x, 0, z);
    group.add(g);
    return lamps;
  };
  const ew = make(x0 + 8.4, z0 + 8.4); // NE corner: controls the E-W road
  const ns = make(x0 - 8.4, z0 - 8.4); // SW corner: controls the N-S road
  return { group, ew, ns };
}
