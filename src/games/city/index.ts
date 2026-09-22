// The Endless City fire-truck game: boot, frame loop and mode orchestration.
import * as THREE from 'three';
import { createStage, makeHUD } from '../../engine/stage.js';
import { prepBakedModels } from '../../engine/assets.js';
import { GameAudio } from '../../engine/audio.js';
import { initInput, isDown, readDriveInput, pointerX } from '../../engine/input.js';
import { setupDevCapture } from '../../engine/capture.js';
import { VEHICLES, createPlayer, physicsStep } from './player.js';
import { ChunkManager } from './chunks.js';
import { Traffic } from './traffic.js';
import { Missions } from './missions.js';
import * as sprayMod from './spray.js';
import * as ladderMod from './ladder.js';
import { Particles } from './particles.js';
import { loadTotals, saveTotals } from './state.js';

// ---- params ----
const q = new URLSearchParams(location.search);
const P = {
  seed: Number(q.get('seed') ?? 11),
  vehicle: q.get('vehicle') ?? 'truck',
};

// ---- stage & world dressing ----
const stage = createStage({
  sunPos: [-40, 90, -55], shadowSpan: 95, fogNear: 70, fogFar: 260,
  ground: false, groundColor: 0xa9c88b,
});
const { scene, camera, renderer, sun } = stage;

// ground follower (hides the edge of the generated area)
const groundFollower = new THREE.Mesh(
  new THREE.PlaneGeometry(700, 700),
  new THREE.MeshLambertMaterial({ color: 0xa9c88b }),
);
groundFollower.rotation.x = -Math.PI / 2;
groundFollower.receiveShadow = true;
scene.add(groundFollower);

// ---- player vehicle ----
const V = VEHICLES[P.vehicle] ?? VEHICLES.truck;
const spawn = { x: 2.3, z: 34, heading: 0 };
const player = createPlayer(V, spawn.x, spawn.z, spawn.heading);
scene.add(player.car);
camera.position.set(spawn.x, V.camUp, spawn.z + V.camBack);
camera.lookAt(spawn.x, 1.4, spawn.z);

const audio = new GameAudio();
initInput(code => {
  audio.unlock();
  if (code === 'KeyC') cycleCamera();
  if (code === 'KeyR') Object.assign(player.state, { x: spawn.x, z: spawn.z, heading: spawn.heading, v: 0 });
});
addEventListener('pointerdown', () => audio.unlock());

// ---- CC0 Kenney city kit preload ----
// Models are baked per-face into the chunk vertex-color meshes (buildings, trees,
// road tiles, lamps, parked cars). Any failure leaves the registry empty and the
// world falls back to the procedural pastel generator.
const KIT = '/assets/kenney/city';
const ROADTINT = { tint: [0.55, 0.57, 0.63] as [number, number, number] };
const KITDEFS: Record<string, Parameters<typeof prepBakedModels>[0][string]> = {};
for (const b of 'abcdefghijklmn') KITDEFS['bldg-' + b] = [`${KIT}/building-${b}.glb`, `${KIT}/cmap-commercial.png`];
Object.assign(KITDEFS, {
  'road-straight': [`${KIT}/road-straight.glb`, `${KIT}/cmap-roads.png`, ROADTINT],
  'road-crossroad': [`${KIT}/road-crossroad.glb`, `${KIT}/cmap-roads.png`, ROADTINT],
  'road-crossing': [`${KIT}/road-crossing.glb`, `${KIT}/cmap-roads.png`, ROADTINT],
  'light-curved': [`${KIT}/light-curved.glb`, `${KIT}/cmap-roads.png`],
  'tree-default': [`${KIT}/nature/tree_default.glb`, null],
  'tree-oak': [`${KIT}/nature/tree_oak.glb`, null],
  'tree-detailed': [`${KIT}/nature/tree_detailed.glb`, null],
  'tree-fat': [`${KIT}/nature/tree_fat.glb`, null],
  'tree-thin': [`${KIT}/nature/tree_thin.glb`, null],
  'tree-small': [`${KIT}/nature/tree_small.glb`, null],
  'car-sedan': [`${KIT}/car-sedan.glb`, `${KIT}/cmap-cars.png`],
  'car-suv': [`${KIT}/car-suv.glb`, `${KIT}/cmap-cars.png`],
  'car-taxi': [`${KIT}/car-taxi.glb`, `${KIT}/cmap-cars.png`],
  'car-hatch': [`${KIT}/car-hatchback-sports.glb`, `${KIT}/cmap-cars.png`],
});
await prepBakedModels(KITDEFS).catch(() => {});

// ---- chunk streaming ----
const chunks = new ChunkManager(scene, P.seed);
chunks.ensure(9, spawn.x, spawn.z); // small starting ring synchronously

// ---- water jet + steam (spray mini-scene visuals) ----
const jet = new THREE.Mesh(
  new THREE.CylinderGeometry(0.16, 0.3, 1, 8),
  new THREE.MeshLambertMaterial({ color: 0xbfe3ff, transparent: true, opacity: 0.62 }),
);
jet.visible = false;
scene.add(jet);
const steamPuff = new THREE.Mesh(
  new THREE.SphereGeometry(0.5, 10, 8),
  new THREE.MeshLambertMaterial({ color: 0xffffff, transparent: true, opacity: 0.75, flatShading: true }),
);
steamPuff.visible = false;
scene.add(steamPuff);
scene.add(ladderMod.getLadderMesh());

// ---- missions ----
const missions = new Missions(scene, P.seed, 64);
const MAX_ACTIVE = 3;
for (let i = 0; i < 3; i++) missions.spawn(player.state, (x, z) => chunks.forceChunkAt(x, z));

// ?spraytest=1: teleport next to the first fire -> spray scene
if (q.get('spraytest') === '1') {
  const fp = missions.objectives.find(o => o.type === 'fire');
  if (fp) { player.state.x = fp.pos.x + 6; player.state.z = fp.pos.z + 4; }
}

// ---- traffic ----
const traffic = new Traffic(scene, 64);

// ---- particles ----
const particles = new Particles(scene);

// ---- HUD ----
const missionEl = document.getElementById('mission')!;
const guideEl = document.getElementById('guide')!;
const guideIcon = document.getElementById('guideIcon')!;
const guideArrow = document.getElementById('guideArrow')!;
const guideDist = document.getElementById('guideDist')!;
const guideWait = document.getElementById('guideWait')!;
const promptEl = document.getElementById('prompt')!;
const promptText = document.getElementById('promptText')!;
const promptFill = document.getElementById('promptFill')!;
const camLabel = document.getElementById('camLabel')!;
const hud = makeHUD();

// ---- camera modes ----
const CAM_MODES = ['chase', 'high', 'cab'];
const camParam = q.get('cam');
let camMode = CAM_MODES.includes(camParam ?? '') ? camParam! : 'chase';
let camLabelTimer = 0;
function cycleCamera(): void {
  camMode = CAM_MODES[(CAM_MODES.indexOf(camMode) + 1) % CAM_MODES.length];
  camLabel.textContent = 'CAMERA: ' + camMode.toUpperCase();
  camLabel.style.opacity = '1';
  clearTimeout(camLabelTimer);
  camLabelTimer = window.setTimeout(() => { camLabel.style.opacity = '0'; }, 1200);
}

// ---- game state ----
let mode: 'drive' | 'spray' | 'ladder' = 'drive';
let ladderAim = 0;
let hoseAim = 0;
let spraySession: sprayMod.SpraySession | null = null;
let ladderSession: ladderMod.LadderSession | null = null;
let toast = '';
const totals = loadTotals();
const clock = new THREE.Clock();
let statTime = 0, elapsed = 0;

// ?livertest=1: teleport next to the first cat -> ladder scene
if (q.get('livertest') === '1') {
  const cp = missions.objectives.find(o => o.type === 'cat');
  if (cp) {
    player.state.x = cp.pos.x + 6;
    player.state.z = cp.pos.z + 4;
    ladderSession = ladderMod.beginLadder(scene, cp, player.car);
    mode = 'ladder';
  }
}

// ---- main loop ----
const tick = (): void => {
  const dt = Math.min(clock.getDelta(), 0.05);
  elapsed += dt;
  const input = readDriveInput();
  const st = player.state;

  // physics + collision (frozen during the mini-scenes: the truck stays put
  // until the fire is out / the cat is down)
  if (mode === 'drive' || player.crashT > 0) {
    const boxes = chunks.boxesNear(st.x, st.z);
    const step = physicsStep(player, input, dt, boxes);
    if (step.crashed) {
      audio.thud();
      toast = '';
    }
  } else {
    st.v = 0;
  }

  player.car.position.set(st.x, 0, st.z);
  player.car.rotation.y = st.heading;
  player.car.rotation.z = -input.steer * Math.min(Math.abs(st.v) / 16, 1) * 0.04;
  for (const w of player.wheels) (w as THREE.Object3D).rotation.x += (st.v * dt) / 0.42;

  // camera
  const fwd = new THREE.Vector3(Math.sin(st.heading), 0, Math.cos(st.heading));
  if (mode === 'spray' && spraySession) {
    const fp = spraySession.obj.pos;
    // over-the-truck view: 11 m up and 8.5 m back — the line to the fire always
    // clears the cab (≈2.9 m), with the truck in the lower frame and the fire centered
    const camT = player.car.position.clone().addScaledVector(fwd, -8.5).add(new THREE.Vector3(0, 11, 0));
    camera.position.lerp(camT, Math.min(1, dt * 3));
    camera.lookAt(fp.x, 0.8, fp.z);
  } else if (mode === 'ladder' && ladderSession) {
    // dedicated ladder view: broadside from the road side of the cat tree —
    // the cat on its branch, the sliding ladder and the truck all in profile
    const fp = ladderSession.obj.pos;
    const toCross = new THREE.Vector3(ladderSession.obj.gx - fp.x, 0, ladderSession.obj.gz - fp.z).normalize();
    const camT = fp.clone().addScaledVector(toCross, 7).add(new THREE.Vector3(0, 3.4, 0));
    camT.lerp(player.car.position, 0.25);
    camT.y = Math.max(camT.y, 3.2);
    camera.position.lerp(camT, Math.min(1, dt * 3));
    camera.lookAt(fp.x, 2.1, fp.z);
  } else if (camMode === 'cab') {
    camera.position.set(st.x + fwd.x * V.cabF, V.cabY, st.z + fwd.z * V.cabF);
    camera.lookAt(st.x + fwd.x * 25, 1.4, st.z + fwd.z * 25);
  } else if (camMode === 'high') {
    // higher chase angle: the whole truck plus more of the street around it
    const desired = new THREE.Vector3(st.x - fwd.x * V.highBack, V.highUp, st.z - fwd.z * V.highBack);
    camera.position.lerp(desired, Math.min(1, dt * 4));
    camera.lookAt(st.x + fwd.x * V.highAhead, 0.9, st.z + fwd.z * V.highAhead);
  } else {
    const desired = new THREE.Vector3(st.x - fwd.x * V.camBack, V.camUp, st.z - fwd.z * V.camBack);
    camera.position.lerp(desired, Math.min(1, dt * 4));
    camera.lookAt(st.x + fwd.x * 6, 1.3, st.z + fwd.z * 6);
  }
  camera.position.y = Math.max(camera.position.y, 1.2);

  // sun + shadow camera follow the car
  sun.position.set(st.x - 40, 90, st.z - 55);
  sun.target.position.set(st.x, 0, st.z);
  sun.target.updateMatrixWorld();
  groundFollower.position.set(st.x, -0.02, st.z);

  chunks.ensure(2, st.x, st.z);

  // ambient life
  traffic.update(dt, elapsed, player.car.position);
  particles.updateDrift(dt, mode === 'drive', st.v, input.steer, player.car);
  particles.update(dt);
  chunks.updateLights(elapsed);

  // hose / ladder aiming: wheel axis, A/D / arrows, or mouse cursor position
  let aimIn = 0;
  if (isDown('KeyA') || isDown('ArrowLeft')) aimIn -= 1;
  if (isDown('KeyD') || isDown('ArrowRight')) aimIn += 1;
  const gp = navigator.getGamepads?.()[0];
  if (gp && Math.abs(gp.axes[0]) > 0.08) aimIn = -gp.axes[0];
  if (aimIn === 0 && Math.abs(pointerX()) > 0.05) aimIn = pointerX();
  if (mode === 'spray') hoseAim += (Math.max(-1, Math.min(1, aimIn)) - hoseAim) * Math.min(1, dt * 4);
  if (mode === 'ladder') ladderAim += (Math.max(-1, Math.min(1, aimIn)) - ladderAim) * Math.min(1, dt * 5);

  // missions: keep several calls alive; the arrow points at the nearest
  missions.cooldown -= dt;
  while (missions.objectives.length < MAX_ACTIVE && missions.cooldown <= 0) {
    missions.spawn(player.state, (x, z) => chunks.forceChunkAt(x, z));
    missions.cooldown = 0.5;
  }
  const { o: near, d: nd } = missions.nearest(st.x, st.z);
  for (const o of missions.objectives) {
    if (!o.marker) continue;
    // hover marker: grows with distance so fires are findable from anywhere
    o.marker.visible = (mode !== 'spray' || spraySession?.obj !== o);
    o.marker.scale.setScalar(Math.max(1.4, Math.min(5, o.d / 28)));
    o.marker.position.y = 5.4 + Math.sin(elapsed * 2 + o.index) * 0.5;
    o.marker.rotation.y += dt * 1.2;
  }

  if (mode === 'spray' && spraySession) {
    // ---- hose mini-scene on the sprayed fire ----
    guideEl.style.opacity = '0';
    promptEl.style.display = 'block';
    promptText.textContent = 'SPRAY LEFT / RIGHT!';
    const doneFrac = sprayMod.updateSpray(spraySession, dt, elapsed, hoseAim, player.car, { jet, steam: steamPuff });
    promptFill.style.width = `${Math.min(100, doneFrac * 100)}%`;
    if (doneFrac >= 0.999) {
      sprayMod.endSpray({ jet, steam: steamPuff });
      particles.burstConfetti(spraySession.obj.pos);
      missions.remove(spraySession.obj);
      missions.sFires++; totals.fires++;
      saveTotals(totals);
      toast = '🔥 FIRE EXTINGUISHED!';
      missions.cooldown = 3;
      spraySession = null;
      mode = 'drive';
    }
  } else if (mode === 'ladder' && ladderSession) {
    // ---- ladder mini-scene: slide the ladder to the cat ----
    guideEl.style.opacity = '0';
    promptEl.style.display = 'block';
    promptFill.style.width = `${Math.min(100, ladderSession.obj.progress / 1.4 * 100)}%`;
    const done = ladderMod.updateLadder(ladderSession, ladderAim, dt);
    promptText.textContent = done ? 'RESCUING…' : 'MOVE THE LADDER TO THE CAT!';
    if (done) {
      particles.burstConfetti(ladderSession.obj.pos);
      missions.remove(ladderSession.obj);
      missions.sCats++; totals.cats++;
      saveTotals(totals);
      toast = '🐱 CAT RESCUED!';
      ladderMod.endLadder();
      ladderSession = null;
      mode = 'drive';
    }
  } else if (near) {
    // ---- driving guidance to the nearest call ----
    guideEl.style.opacity = '1';
    guideIcon.textContent = near.type === 'fire' ? '🔥' : '🐱';
    const rel = Math.atan2(near.pos.z - st.z, near.pos.x - st.x);
    const deg = (-rel * 180 / Math.PI).toFixed(0);
    guideArrow.style.transform = `rotate(${deg}deg)`;
    const dots = Math.max(0, Math.min(5, Math.round(5 * (1 - nd / 240))));
    guideDist.textContent = '\u25CF'.repeat(dots) + '\u25CB'.repeat(5 - dots);
    guideWait.textContent = '';
    promptEl.style.display = 'block';
    if (near.type === 'fire') {
      promptText.textContent = nd < 15 ? 'STOP HERE!' : 'DRIVE TO THE FIRE';
      promptFill.style.width = '0%';
      if (nd < 15 && Math.abs(st.v) < 1.0 && player.crashT <= 0) {
        spraySession = sprayMod.beginSpray(near, player.car);
        mode = 'spray';
        promptText.textContent = 'SPRAY LEFT / RIGHT!';
      }
    } else {
      promptText.textContent = nd < 11 ? 'STOP HERE!' : 'DRIVE TO THE CAT';
      promptFill.style.width = '0%';
      if (nd < 11 && Math.abs(st.v) < 1.0 && player.crashT <= 0) {
        ladderSession = ladderMod.beginLadder(scene, near, player.car);
        mode = 'ladder';
        promptText.textContent = 'MOVE THE LADDER TO THE CAT!';
      }
    }
  } else {
    guideEl.style.opacity = '1';
    promptEl.style.display = 'none';
    guideWait.textContent = toast || 'waiting for a call…';
    guideIcon.textContent = '🚨';
    guideArrow.style.transform = '';
    guideDist.textContent = '';
    missionEl.innerHTML = `<span style="color:#e25c5c;font-weight:800">this run: ${missions.sFires} fires · ${missions.sCats} cats</span><br>all time: ${totals.fires} 🔥 · ${totals.cats} 🐱 saved`;
  }

  audio.setSiren(missions.objectives.length > 0);
  audio.setPump(jet.visible);

  if (player.crashT > 0) {
    promptEl.style.display = 'block';
    promptText.textContent = 'OOPS! ↺';
    promptFill.style.width = '0%';
  }

  renderer.render(scene, camera);
  if (elapsed - statTime > 0.4) {
    statTime = elapsed;
    const i = renderer.info.render;
    const kmh = Math.round(Math.abs(st.v) * 3.6);
    hud.set(`${P.vehicle} · seed ${P.seed} · ${kmh} km/h · draw calls ${i.calls} · triangles ${i.triangles.toLocaleString('en-US')}`);
    document.title = 'STATS ' + i.calls + ' calls, ' + i.triangles + ' tris';
    (window as unknown as { __stats: unknown }).__stats = { calls: i.calls, triangles: i.triangles };
  }
};
renderer.setAnimationLoop(tick);
if (q.get('still') === '1') {
  // background tabs suspend rAF — drive frames off a timer so ?still captures
  // show the settled state even when the pane isn't visible
  let frames = 0;
  const iv = setInterval(() => {
    tick();
    if (++frames >= 180) {
      renderer.setAnimationLoop(null);
      clearInterval(iv);
    }
  }, 16);
}

// dev capture (?still=1 / ?capture=name.png)
setupDevCapture(renderer, scene, camera);
