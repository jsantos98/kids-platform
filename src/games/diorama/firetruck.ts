// Fire Truck — City Rescue diorama: the whole street is generated from the seed.
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { createStage, makeHUD } from '../../engine/stage.js';
import { paramsFromURL } from '../../engine/params.js';
import { setupDevCapture } from '../../engine/capture.js';
import { generateCity } from '../../worlds/cityStreet.js';
import { t as tr, applyI18n, numberLocale } from '../../i18n/index.js';

export function run(): void {
  const camMode = new URLSearchParams(location.search).get('cam') ?? 'chase';
  const P = paramsFromURL({ seed: 7, size: 1, density: 1 });

  const stage = createStage({ sunPos: [-45, 75, 35], shadowSpan: 70, fogNear: 70, fogFar: 230 });
  const { scene, camera, renderer } = stage;

  const world = generateCity(P);
  scene.add(world.group);
  const { truck, flames, smoke, poi } = world;
  const { firePos, truckPos } = poi;

  // cameras derived from generated POIs
  const controls = new OrbitControls(camera, renderer.domElement);
  let camTarget: THREE.Vector3;
  if (camMode === 'cab') {
    const fwd = new THREE.Vector3(Math.sin(truck.rotation.y), 0, Math.cos(truck.rotation.y));
    camera.position.copy(truckPos).addScaledVector(fwd, 1.6).add(new THREE.Vector3(0, 2.35, 0));
    camTarget = firePos.clone().setY(1.2);
  } else {
    const v = firePos.clone().sub(truckPos); v.y = 0;
    const off = new THREE.Vector3(v.x * 0.72, 0, -v.z * 0.73);
    if (off.length() < 11) off.setLength(11);
    camera.position.set(truckPos.x + off.x, 3.3, truckPos.z + off.z);
    camTarget = truckPos.clone().addScaledVector(v, 0.5).setY(1.5);
  }
  camera.lookAt(camTarget);
  controls.target.copy(camTarget);
  controls.update();

  applyI18n('diorama.firetruck');
  const hud = makeHUD();
  const clock = new THREE.Clock();
  let statTime = 0;
  renderer.setAnimationLoop(() => {
    const t = clock.getElapsedTime();
    flames.forEach((f, i) => { f.scale.y = 1 + 0.18 * Math.sin(t * 11 + i * 2.1); });
    smoke.forEach((s, i) => {
      const ph = (t * 0.45 + i * 0.75) % 2.3;
      s.position.y = 1.2 + ph * 1.1;
      (s.material as THREE.MeshLambertMaterial).opacity = 0.35 * (1 - ph / 2.3);
    });
    const beacons = (truck.userData.beacons ?? []) as THREE.Mesh[];
    beacons.forEach((b, i) => {
      (b.material as THREE.MeshLambertMaterial).emissiveIntensity = Math.sin(t * 12 + i * Math.PI / 2) > 0 ? 1.8 : 0.15;
    });
    controls.update();
    renderer.render(scene, camera);
    if (t - statTime > 0.5) {
      statTime = t;
      const i = renderer.info.render;
      hud.set(tr('diorama.hud', { name: tr('diorama.name.firetruck'), seed: P.seed, cam: camMode, calls: i.calls, tris: i.triangles.toLocaleString(numberLocale()) }));
      document.title = 'STATS ' + i.calls + ' calls, ' + i.triangles + ' tris';
      (window as unknown as { __stats: unknown }).__stats = { calls: i.calls, triangles: i.triangles };
    }
  });
  setupDevCapture(renderer, scene, camera);
}

run();
