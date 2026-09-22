// Rescue Helicopter diorama: hovering heli, winch + stretcher, waiting patient.
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { C, createStage, makeHUD } from '../../engine/stage.js';
import { paramsFromURL } from '../../engine/params.js';
import { setupDevCapture } from '../../engine/capture.js';
import { generateValley } from '../../worlds/valley.js';
import { makeHelicopter, makePerson } from '../../kit/index.js';

export function run(): void {
  const camMode = new URLSearchParams(location.search).get('cam') ?? 'air';
  const P = paramsFromURL({ seed: 21, houses: 8, lake: true, animals: true });

  const stage = createStage({ sunPos: [55, 70, 25], shadowSpan: 65, fogNear: 80, fogFar: 260, groundR: 160 });
  const { scene, camera, renderer } = stage;

  const world = generateValley(P);
  scene.add(world.group);
  const { poi, balloon } = world;
  const { heliStart, patientPos } = poi;

  // hero: rescue helicopter + winch
  const heli = makeHelicopter();
  heli.position.copy(heliStart);
  heli.rotation.set(0.1, Math.PI / 2 - 0.25, -0.06);
  scene.add(heli);

  const winch = new THREE.Group();
  {
    const cable = new THREE.Mesh(
      new THREE.CylinderGeometry(0.03, 0.03, 8.6, 6),
      new THREE.MeshLambertMaterial({ color: 0x555f6e }));
    cable.position.y = -4.3; winch.add(cable);
    const stretcher = new THREE.Group();
    const bed = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.12, 1.5), new THREE.MeshLambertMaterial({ color: C.cream }));
    bed.castShadow = true; stretcher.add(bed);
    for (const sx of [-0.26, 0.26]) for (const sz of [-0.6, 0.6]) {
      const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.3, 6), new THREE.MeshLambertMaterial({ color: C.silver }));
      leg.position.set(sx, -0.2, sz); stretcher.add(leg);
    }
    const patient = makePerson({ shirt: C.teal, pants: C.dark });
    patient.rotation.x = -Math.PI / 2;
    patient.position.set(0, 0.1, 0);
    patient.scale.setScalar(0.85);
    stretcher.add(patient);
    stretcher.position.y = -8.6;
    winch.add(stretcher);
    winch.userData.stretcher = stretcher;
  }
  winch.position.copy(heliStart).add(new THREE.Vector3(0, 0.7, 0));
  scene.add(winch);

  // person waiting at the generated patient spot + bouncing marker
  const pWait = makePerson({ shirt: C.orange, pants: C.dark, cap: C.white });
  pWait.position.copy(patientPos).add(new THREE.Vector3(0.8, 0, 0.6));
  pWait.rotation.y = -2.4;
  scene.add(pWait);
  const marker = new THREE.Mesh(
    new THREE.ConeGeometry(0.55, 1, 4),
    new THREE.MeshLambertMaterial({ color: C.yellow, emissive: 0xffcc00, emissiveIntensity: 0.9 }));
  marker.rotation.x = Math.PI;
  marker.position.copy(patientPos).setY(2.6);
  scene.add(marker);

  // cameras derived from generated POIs
  const controls = new OrbitControls(camera, renderer.domElement);
  let camTarget: THREE.Vector3;
  if (camMode === 'pad') {
    camera.position.set(poi.hospPos.x + 3, 10.5, poi.hospPos.z + 10);
    camTarget = heliStart.clone();
  } else {
    camera.position.set(-28, 12, 20);
    camTarget = new THREE.Vector3(2, 7, -2);
  }
  camera.lookAt(camTarget);
  controls.target.copy(camTarget);
  controls.update();

  const hud = makeHUD();
  const clock = new THREE.Clock();
  let statTime = 0;
  renderer.setAnimationLoop(() => {
    const t = clock.getElapsedTime();
    (heli.userData.mainRotor as THREE.Object3D).rotation.y = t * 22;
    (heli.userData.tailRotor as THREE.Object3D).rotation.x = t * 30;
    heli.position.y = heliStart.y + Math.sin(t * 1.3) * 0.25;
    heli.rotation.z = -0.06 + Math.sin(t * 0.9) * 0.02;
    winch.position.y = heli.position.y + 0.7;
    (winch.userData.stretcher as THREE.Object3D).rotation.z = Math.sin(t * 1.1) * 0.06;
    marker.position.y = 2.6 + Math.sin(t * 3.2) * 0.25;
    marker.rotation.y = t * 1.5;
    if (balloon) {
      balloon.position.y = 7 + Math.sin(t * 0.7) * 0.8;
      balloon.rotation.y = balloon.rotation.y + 0.0015;
    }
    controls.update();
    renderer.render(scene, camera);
    if (t - statTime > 0.5) {
      statTime = t;
      const i = renderer.info.render;
      hud.set(`rescue helicopter · seed ${P.seed} · ${camMode}  ·  draw calls ${i.calls}  ·  triangles ${i.triangles.toLocaleString('en-US')}`);
      document.title = 'STATS ' + i.calls + ' calls, ' + i.triangles + ' tris';
      (window as unknown as { __stats: unknown }).__stats = { calls: i.calls, triangles: i.triangles };
    }
  });
  setupDevCapture(renderer, scene, camera);
}

run();
