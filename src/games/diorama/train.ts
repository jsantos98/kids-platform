// Little Train Line diorama: the train crawls around the generated loop.
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { C, createStage, makeHUD } from '../../engine/stage.js';
import { paramsFromURL } from '../../engine/params.js';
import { setupDevCapture } from '../../engine/capture.js';
import { generateRailroad } from '../../worlds/railroad.js';

export function run(): void {
  const camMode = new URLSearchParams(location.search).get('cam') ?? 'beauty';
  const P = paramsFromURL({ seed: 42, wobble: 1, stations: 2, animals: true, move: false });

  const stage = createStage({ sunPos: [-50, 70, 45], shadowSpan: 75, fogNear: 85, fogFar: 260, groundR: 150 });
  const { scene, camera, renderer } = stage;

  const world = generateRailroad(P);
  scene.add(world.group);
  const { curve, railTop, headT, railcarGap, loco, car1, car2, placeOnTrack, poi } = world;
  const { bridgeCenter } = poi;

  // steam puffs from the chimney (hidden in cab view where they photobomb)
  const steam: THREE.Mesh[] = [];
  for (let i = 0; i < 4; i++) {
    const s = new THREE.Mesh(
      new THREE.SphereGeometry(0.24, 10, 8),
      new THREE.MeshLambertMaterial({ color: C.white, transparent: true, opacity: 0.8, flatShading: true }));
    s.castShadow = false;
    scene.add(s);
    steam.push(s);
  }

  // cameras derived from generated POIs
  const controls = new OrbitControls(camera, renderer.domElement);
  let camTarget: THREE.Vector3;
  if (camMode === 'cab') {
    const p = curve.getPointAt(headT);
    const tan = curve.getTangentAt(headT);
    camera.position.copy(p).addScaledVector(tan, -0.4).setY(railTop + 3.4);
    camTarget = curve.getPointAt(headT + 0.09).setY(railTop + 0.4);
    steam.forEach(s => { s.visible = false; });
  } else {
    camera.position.set(bridgeCenter.x + 9, 6.5, bridgeCenter.z + 13);
    camTarget = new THREE.Vector3(bridgeCenter.x - 11, 1.8, bridgeCenter.z - 6);
  }
  camera.lookAt(camTarget);
  controls.target.copy(camTarget);
  controls.update();

  const hud = makeHUD();
  const clock = new THREE.Clock();
  let statTime = 0;
  let trainT = headT;
  let elapsed = 0;
  renderer.setAnimationLoop(() => {
    const dt = clock.getDelta();
    elapsed += dt;
    const t = elapsed;
    if (P.move) {
      trainT += dt * 0.022; // gentle crawl around the loop
      placeOnTrack(loco, trainT);
      placeOnTrack(car1, trainT - railcarGap);
      placeOnTrack(car2, trainT - railcarGap * 2);
    }
    loco.updateMatrixWorld();
    steam.forEach((s, i) => {
      const ph = (t * 0.5 + i * 0.25) % 1;
      const base = loco.localToWorld(new THREE.Vector3(0, 2.85, 1.35));
      s.position.copy(base).add(new THREE.Vector3(Math.sin(ph * 9 + i) * 0.12, ph * 3.4, 0));
      s.scale.setScalar(0.4 + ph * 0.9);
      (s.material as THREE.MeshLambertMaterial).opacity = 0.6 * (1 - ph);
    });
    controls.update();
    renderer.render(scene, camera);
    if (t - statTime > 0.5) {
      statTime = t;
      const i = renderer.info.render;
      hud.set(`little train line · seed ${P.seed} · ${camMode}  ·  draw calls ${i.calls}  ·  triangles ${i.triangles.toLocaleString('en-US')}`);
      document.title = 'STATS ' + i.calls + ' calls, ' + i.triangles + ' tris';
      (window as unknown as { __stats: unknown }).__stats = { calls: i.calls, triangles: i.triangles };
    }
  });
  setupDevCapture(renderer, scene, camera);
}

run();
