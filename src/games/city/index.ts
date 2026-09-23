// The Endless City fire-truck game: boot, frame loop and mode orchestration.
import * as THREE from 'three';
import { createStage, makeHUD } from '../../engine/stage.js';
import { prepBakedModels, bakedModel, spawnVehicle } from '../../engine/assets.js';
import { GameAudio } from '../../engine/audio.js';
import { initInput, isDown, readDriveInput, pointerX } from '../../engine/input.js';
import { setupDevCapture } from '../../engine/capture.js';
import { VEHICLES, createPlayer, physicsStep } from './player.js';
import { ChunkManager } from './chunks.js';
import { Traffic } from './traffic.js';
import { Trains } from './train.js';
import { createSea } from './sea.js';
import { PatrolHeli } from './patrol.js';
import { Pedestrians } from './pedestrians.js';
import type { BakedTemplate } from '../../engine/assets.js';
import { RoadGrid } from '../../worlds/roadGrid.js';
import { WORLD_CHUNKS, chunkGroundColor } from '../../worlds/cityChunk.js';
import { RACE_START, raceGates, racePath, racePathPts } from '../../worlds/racetrack.js';
import { Missions } from './missions.js';
import * as sprayMod from './spray.js';
import * as ladderMod from './ladder.js';
import { Particles } from './particles.js';
import { Minimap } from './minimap.js';
import { loadTotals, saveTotals } from './state.js';

// ---- params ----
const q = new URLSearchParams(location.search);
const raceMode = q.get('race') === '1';
const P = {
  seed: Number(q.get('seed') ?? 11),
  vehicle: raceMode ? 'kart' : (q.get('vehicle') ?? 'truck'),
};

// ---- stage & world dressing ----
const stage = createStage({
  sunPos: [-40, 90, -55], shadowSpan: 95, fogNear: 70, fogFar: 260,
  ground: false, groundColor: 0xa9c88b,
});
const { scene, camera, renderer, sun, followSky } = stage;

// ground follower — deep backdrop below the sea, hides the world's edge
const groundFollower = new THREE.Mesh(
  new THREE.PlaneGeometry(1600, 1600),
  new THREE.MeshLambertMaterial({ color: 0x6fb7d9 }),
);
groundFollower.rotation.x = -Math.PI / 2;
groundFollower.receiveShadow = true;
scene.add(groundFollower);

// ---- player vehicle ----
const V = raceMode ? VEHICLES.kart : (VEHICLES[P.vehicle] ?? VEHICLES.truck);
const spawn = raceMode
  ? { x: RACE_START.x, z: RACE_START.z, heading: RACE_START.heading }
  : { x: 130, z: 130, heading: Number(q.get('heading') ?? 0) * Math.PI / 180 };
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
const RACEKIT = '/assets/kenney/racing';
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
  'pine-a': [`${KIT}/nature/tree_pineRoundA.glb`, null],
  'pine-b': [`${KIT}/nature/tree_pineRoundB.glb`, null],
  'pine-c': [`${KIT}/nature/tree_pineRoundC.glb`, null],
  'cactus-short': [`${KIT}/nature/cactus_short.glb`, null],
  'cactus-tall': [`${KIT}/nature/cactus_tall.glb`, null],
  'rock-a': [`${KIT}/nature/stone_largeA.glb`, null],
  'rock-b': [`${KIT}/nature/stone_largeB.glb`, null],
  'car-sedan': [`${KIT}/car-sedan.glb`, `${KIT}/cmap-cars.png`],
  'car-suv': [`${KIT}/car-suv.glb`, `${KIT}/cmap-cars.png`],
  'car-taxi': [`${KIT}/car-taxi.glb`, `${KIT}/cmap-cars.png`],
  'car-hatch': [`${KIT}/car-hatchback-sports.glb`, `${KIT}/cmap-cars.png`],
  'race-straight': [`${RACEKIT}/track-straight.glb`, `${RACEKIT}/Textures/colormap.png`],
  'race-corner': [`${RACEKIT}/track-corner.glb`, `${RACEKIT}/Textures/colormap.png`],
  'race-finish': [`${RACEKIT}/track-finish.glb`, `${RACEKIT}/Textures/colormap.png`],
  'race-bump': [`${RACEKIT}/track-bump.glb`, `${RACEKIT}/Textures/colormap.png`],
});
await prepBakedModels(KITDEFS).catch(() => {});
// dev probe: ?debugbake=1 exposes which templates registered
if (q.get('debugbake') === '1') {
  (window as unknown as { __bake: Record<string, boolean> }).__bake =
    Object.fromEntries(Object.keys(KITDEFS).map(k => [k, !!bakedModel(k)]));
}

// ---- chunk streaming ----
const roadGrid = new RoadGrid();
const chunks = new ChunkManager(scene, P.seed, roadGrid);
// the island is small: build every chunk once at boot
for (let cx = 0; cx < WORLD_CHUNKS; cx++) {
  for (let cz = 0; cz < WORLD_CHUNKS; cz++) chunks.addChunk(cx, cz);
}

// ---- the sea: waving water, surf, pier and Kenney watercraft sailing around ----
const sea = await createSea(scene);
if (q.get('debugsea') === '1') {
  const v = new THREE.Vector3();
  (window as unknown as { __dbg: unknown }).__dbg = {
    sea,
    scene,
    camera,
    renderer,
    probe: (x: number, y: number, z: number) => {
      const out = v.set(x, y, z).project(camera);
      return [+out.x.toFixed(2), +out.y.toFixed(2), +out.z.toFixed(2)];
    },
  };
}

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
const heliMode = P.vehicle === 'heli';
const missions = new Missions(scene, P.seed, 64, roadGrid, heliMode);
const MAX_ACTIVE = 3;
for (let i = 0; i < 3; i++) missions.spawn(player.state, (x, z) => chunks.forceChunkAt(x, z));

// ?spraytest=1: teleport next to the first fire -> spray scene
if (q.get('spraytest') === '1') {
  const fp = missions.objectives.find(o => o.type === 'fire');
  if (fp) { player.state.x = fp.pos.x + 6; player.state.z = fp.pos.z + 4; }
}

// ---- traffic ----
// in heli mode one of the AI vehicles is the fire truck, driving itself
const traffic = new Traffic(scene, roadGrid, 64, 8, V.fly ? ['/assets/kenney/firetruck.glb'] : []);

// ---- ambient life: several trains on the rail corridors; a patrol heli
// circles the neighbourhood while the kid plays the fire truck ----
const trains = new Trains(scene, 64);
const patrol = V.fly ? null : new PatrolHeli(scene);
// ---- pets: cube pets from the Kenney kit wander the sidewalks too ----
const PET_NAMES = ['pet-dog', 'pet-cat', 'pet-bunny', 'pet-chick', 'pet-pig', 'pet-fox', 'pet-panda', 'pet-penguin'];
const pedestrians = new Pedestrians(scene, roadGrid, 64, 14,
  PET_NAMES.map(n => bakedModel(n)).filter((t): t is BakedTemplate => !!t));
// dev probe: current pedestrian spots (via console/window)
(window as unknown as { __peds: () => unknown }).__peds = () => pedestrians.list();

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
const minimap = new Minimap(document.getElementById('minimap') as HTMLCanvasElement, missions, roadGrid, 64, P.seed, () => sea.boatDots());
const hud = makeHUD();
function updateMissionPanel(): void {
  missionEl.innerHTML = `<span style="color:#e25c5c;font-weight:800">this run: ${missions.sFires} fires · ${missions.sCats} rescues</span><br>all time: ${totals.fires} 🔥 · ${totals.cats} 🐱 saved`;
}

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
updateMissionPanel();
const clock = new THREE.Clock();
let statTime = 0, elapsed = 0;

// ---- race mode state ----
const raceGatePts = raceGates();
let gateIdx = 0, lap = 1, lapStart = 0;
let bestLap = Infinity;
try {
  const saved = Number(localStorage.getItem('kidsgames-race-best'));
  if (saved > 0) bestLap = saved;
} catch { /* ignore */ }
function fmtTime(t: number): string {
  const m = Math.floor(t / 60);
  const s = t - m * 60;
  return `${m}:${s.toFixed(1).padStart(4, '0')}`;
}

// AI race trucks cruising the circuit
const raceAI: Array<{ mesh: THREE.Object3D; t: number; speed: number }> = [];
let raceAILen = 0;
if (raceMode) {
  for (let i = 0; i < racePathPts.length; i++) {
    const a = racePathPts[i], b = racePathPts[(i + 1) % racePathPts.length];
    raceAILen += Math.hypot(b.x - a.x, b.z - a.z);
  }
  const models = ['/assets/kenney/racing/vehicle-truck-yellow.glb', '/assets/kenney/racing/vehicle-truck-purple.glb'];
  const speeds = [9.5, 8.5];
  models.forEach((m, i) => {
    spawnVehicle(m, { len: 3.2 }).then(g => {
      g.traverse(o => { if ((o as THREE.Mesh).isMesh) o.castShadow = true; });
      scene.add(g);
      raceAI.push({ mesh: g, t: (i + 1) / 3, speed: speeds[i] });
    }).catch(() => {});
  });
}

function updateRaceAI(dt: number): void {
  for (const r of raceAI) {
    r.t = (r.t + (r.speed * dt) / raceAILen) % 1;
    const f = r.t * racePathPts.length;
    const i0 = Math.floor(f) % racePathPts.length;
    const a = racePathPts[i0], b = racePathPts[(i0 + 1) % racePathPts.length];
    const fr = f - i0;
    r.mesh.position.set(a.x + (b.x - a.x) * fr, 0.15, a.z + (b.z - a.z) * fr);
    r.mesh.rotation.y = Math.atan2(b.x - a.x, b.z - a.z);
  }
}

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

// ?tp=x,z: teleport (debug/verification)
const tp = q.get('tp');
if (tp) {
  const [txs, tzs] = tp.split(',').map(Number);
  if (Number.isFinite(txs) && Number.isFinite(tzs)) { player.state.x = txs; player.state.z = tzs; }
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

  player.car.position.set(st.x, V.fly ? 16 + Math.sin(elapsed * 1.3) * 0.7 : 0, st.z);
  player.car.rotation.y = st.heading;
  if (V.fly) {
    // hover-flight life: nose dips with speed, banks into turns, rotors spin
    player.car.rotation.x = -(st.v / V.maxF) * 0.16;
    player.car.rotation.z = input.steer * 0.12 * Math.min(1, Math.abs(st.v) / V.maxF);
    (player.car.userData.mainRotor as THREE.Object3D | undefined)!.rotation.y = elapsed * 22;
    (player.car.userData.tailRotor as THREE.Object3D | undefined)!.rotation.x = elapsed * 30;
  } else {
    player.car.rotation.z = -input.steer * Math.min(Math.abs(st.v) / 16, 1) * 0.04;
    for (const w of player.wheels) (w as THREE.Object3D).rotation.x += (st.v * dt) / 0.42;
  }

  // camera (flying vehicles keep the camera near their altitude)
  const flyY = V.fly ? 16 : 0;
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
    camera.position.set(st.x + fwd.x * V.cabF, flyY + V.cabY, st.z + fwd.z * V.cabF);
    camera.lookAt(st.x + fwd.x * 25, flyY + 1.4, st.z + fwd.z * 25);
  } else if (camMode === 'high') {
    // higher chase angle: the whole truck plus more of the street around it
    const desired = new THREE.Vector3(st.x - fwd.x * V.highBack, flyY + V.highUp, st.z - fwd.z * V.highBack);
    camera.position.lerp(desired, Math.min(1, dt * 4));
    camera.lookAt(st.x + fwd.x * V.highAhead, flyY + 0.9, st.z + fwd.z * V.highAhead);
  } else {
    const desired = new THREE.Vector3(st.x - fwd.x * V.camBack, flyY + V.camUp, st.z - fwd.z * V.camBack);
    camera.position.lerp(desired, Math.min(1, dt * 4));
    camera.lookAt(st.x + fwd.x * 6, flyY + 1.3, st.z + fwd.z * 6);
  }
  camera.position.y = Math.max(camera.position.y, 1.2);

  // sun + shadow camera follow the car, and the sky dome travels with it
  sun.position.set(st.x - 40, 90, st.z - 55);
  sun.target.position.set(st.x, 0, st.z);
  sun.target.updateMatrixWorld();
  groundFollower.position.set(st.x, -0.85, st.z);
  followSky(st.x, st.z);

  // keep the truck on the island (the ocean is not drivable)
  st.x = Math.min(381, Math.max(3, st.x));
  st.z = Math.min(381, Math.max(3, st.z));

  // ambient life: the trains, the sea with its boats and the patrol helicopter
  trains.update(elapsed);
  sea.update(elapsed);
  patrol?.update(dt, elapsed, st.x, st.z);
  pedestrians.update(dt, st.x, st.z, st.x, st.z);

  // ambient life
  traffic.update(dt, elapsed, player.car.position);
  particles.updateDrift(dt, mode === 'drive', st.v, input.steer, player.car);
  particles.update(dt);
  chunks.updateLights(elapsed);
  minimap.update(st.x, st.z, st.heading, elapsed);
  // hose / ladder aiming: wheel axis, A/D / arrows, or mouse cursor position
  let aimIn = 0;
  if (isDown('KeyA') || isDown('ArrowLeft')) aimIn -= 1;
  if (isDown('KeyD') || isDown('ArrowRight')) aimIn += 1;
  const gp = navigator.getGamepads?.()[0];
  if (gp && Math.abs(gp.axes[0]) > 0.08) aimIn = -gp.axes[0];
  if (aimIn === 0 && Math.abs(pointerX()) > 0.05) aimIn = pointerX();
  if (mode === 'spray') hoseAim += (Math.max(-1, Math.min(1, aimIn)) - hoseAim) * Math.min(1, dt * 4);
  if (mode === 'ladder') ladderAim += (Math.max(-1, Math.min(1, aimIn)) - ladderAim) * Math.min(1, dt * 5);

  // missions: keep several calls alive (suppressed in race mode)
  missions.cooldown -= dt;
  while (!raceMode && missions.objectives.length < MAX_ACTIVE && missions.cooldown <= 0) {
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

  if (raceMode) {
    // ---- race mode: lap timing HUD ----
    updateRaceAI(dt);
    const g = raceGatePts[gateIdx];
    if (Math.hypot(st.x - g.x, st.z - g.z) < 10) {
      gateIdx++;
      if (gateIdx >= raceGatePts.length) {
        gateIdx = 0;
        const lapTime = elapsed - lapStart;
        lapStart = elapsed;
        lap++;
        toast = `LAP ${fmtTime(lapTime)}!`;
        if (lapTime < bestLap) {
          bestLap = lapTime;
          try { localStorage.setItem('kidsgames-race-best', String(lapTime)); } catch { /* ignore */ }
        }
      }
    }
    promptEl.style.display = 'block';
    promptText.textContent = `LAP ${lap} — ${fmtTime(elapsed - lapStart)}`;
    promptFill.style.width = '0%';
    missionEl.innerHTML = `best lap: ${bestLap === Infinity ? '—' : fmtTime(bestLap)}`;
    guideEl.style.opacity = '1';
    guideIcon.textContent = '🏁';
    guideArrow.style.transform = '';
    guideDist.textContent = '';
    guideWait.textContent = '';
  } else if (mode === 'spray' && spraySession) {
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
    // ---- driving/flying guidance to the nearest call ----
    guideEl.style.opacity = '1';
    guideIcon.textContent = near.type === 'fire' ? '🔥' : near.type === 'patient' ? '🆘' : '🐱';
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
    } else if (near.type === 'patient') {
      // helicopter: hover over the person to winch them up
      const hovering = nd < 9 && Math.abs(st.v) < 4;
      if (hovering) near.progress += dt / near.need;
      promptFill.style.width = `${Math.min(100, near.progress / near.need * 100)}%`;
      promptText.textContent = hovering ? 'WINCHING…'
        : (nd < 9 ? 'HOVER HERE!' : 'FLY TO THE PERSON');
      if (near.progress >= near.need) {
        particles.burstConfetti(near.pos);
        missions.remove(near);
        missions.sCats++;
        totals.cats++;
        saveTotals(totals);
        toast = '🆘 PERSON RESCUED!';
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
    updateMissionPanel();
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
