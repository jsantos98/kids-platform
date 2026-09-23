// The Endless City fire-truck game: boot, frame loop and mode orchestration.
import * as THREE from 'three';
import { createStage, makeHUD } from '../../engine/stage.js';
import { prepBakedModels, bakedModel } from '../../engine/assets.js';
import { rng, chunkSeed } from '../../engine/rng.js';
import { GameAudio } from '../../engine/audio.js';
import { initInput, isDown, readDriveInput, pointerX } from '../../engine/input.js';
import { setupDevCapture } from '../../engine/capture.js';
import { VEHICLES, createPlayer, physicsStep } from './player.js';
import { ChunkManager } from './chunks.js';
import { Traffic } from './traffic.js';
import { Trains } from './train.js';
import { createSea } from './sea.js';
import { CityScenery } from './scenery.js';
import { PatrolHeli } from './patrol.js';
import { Pedestrians } from './pedestrians.js';
import type { BakedTemplate } from '../../engine/assets.js';
import { RoadGrid } from '../../worlds/roadGrid.js';
import { cityPlanFor } from '../../worlds/cityPlan.js';
import { WORLD_CHUNKS, chunkGroundColor } from '../../worlds/cityChunk.js';
import { CENTER } from '../../worlds/world.js';
import { setCityBase, citySeed, cityAt, type CityRef } from '../../worlds/cityGrid.js';
import { railRouteFor } from '../../worlds/railRoute.js';
import { Missions } from './missions.js';
import { makeSirenBar } from '../../kit/props.js';
import * as sprayMod from './spray.js';
import * as ladderMod from './ladder.js';
import { Particles } from './particles.js';
import { Transit } from './transit.js';
import { riverFor } from '../../worlds/riverRoute.js';
import { Minimap } from './minimap.js';
import { loadTotals, saveTotals } from './state.js';

// ---- params ----
const q = new URLSearchParams(location.search);
// every new game generates a fresh island; the rolled seed is written back
// into the URL so a refresh (or a share) replays the exact same world
const seedParam = q.get('seed');
const P = {
  seed: seedParam !== null && Number.isFinite(Number(seedParam)) && seedParam !== ''
    ? Number(seedParam)
    : 1 + ((Math.random() * 999999999) | 0),
  vehicle: q.get('vehicle') ?? 'heli',
};
if (seedParam === null) {
  const u = new URL(location.href);
  u.searchParams.set('seed', String(P.seed));
  history.replaceState(null, '', u.toString());
}
setCityBase(P.seed);

/** a starting lane spot that suits THIS city: on a street near the centre,
 * clear of the river, the railway, and level crossings (city-local coords) */
function pickSpawn(bx: number, by: number): { x: number; z: number; heading: number } {
  const seed = citySeed(bx, by);
  const sr = rng(chunkSeed(seed, 0x5b0, 3));
  const plan = cityPlanFor(bx, by);
  const river = riverFor(seed);
  const rail = railRouteFor(bx, by);
  const spots: Array<{ x: number; z: number; heading: number }> = [];
  const collect = (lines: number[]): void => {
    for (const j of lines) {
      for (let i = 1; i < WORLD_CHUNKS - 1; i++) {
        if (!plan.segH(j, i)) continue;
        const x = i * 64 + 18 + sr() * 28, z = j * 64 + 3.5;
        if (river.inWater(x, z) || rail.distTo(x, z) < 7) continue;
        if (plan.crossings.some(c => Math.abs(c.x - x) < 17 && Math.abs(c.z - z) < 12)) continue;
        spots.push({ x, z, heading: Math.PI / 2 });
      }
    }
    for (const i of lines) {
      for (let j = 1; j < WORLD_CHUNKS - 1; j++) {
        if (!plan.segV(i, j)) continue;
        const x = i * 64 - 3.5, z = j * 64 + 18 + sr() * 28;
        if (river.inWater(x, z) || rail.distTo(x, z) < 7) continue;
        if (plan.crossings.some(c => Math.abs(c.x - x) < 12 && Math.abs(c.z - z) < 17)) continue;
        spots.push({ x, z, heading: 0 });
      }
    }
  };
  const c = WORLD_CHUNKS >> 1;
  collect([c, c + 1]);                 // prefer the central boulevards
  if (spots.length < 4) collect([c - 1, c + 2]);
  if (!spots.length) collect([1, WORLD_CHUNKS - 2]);
  return spots.length ? spots[(sr() * spots.length) | 0] : { x: CENTER, z: CENTER, heading: 0 };
}

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
const V = VEHICLES[P.vehicle] ?? VEHICLES.truck;
let spawn = pickSpawn(0, 0); // city (0,0) is the origin, so local == world at boot
const player = createPlayer(V, spawn.x, spawn.z, spawn.heading);
scene.add(player.car);
camera.position.set(spawn.x, V.camUp, spawn.z + V.camBack);
camera.lookAt(spawn.x, 1.4, spawn.z);

const audio = new GameAudio();
initInput(code => {
  audio.unlock();
  if (code === 'KeyC') cycleCamera();
  if (code === 'KeyE') setSiren(!sirenOn);
  if (code === 'KeyR') Object.assign(player.state, { x: spawn.x, z: spawn.z, heading: spawn.heading, v: 0 });
});
addEventListener('pointerdown', () => audio.unlock());

// ---- siren: a manual toggle (screen button or the E key). While it's on the
// truck rocks a flashing red/blue lightbar and the siren howls. ----
const sirenBtn = document.getElementById('sirenBtn') as HTMLButtonElement;
let sirenOn = false;
const sirenBar = makeSirenBar();
sirenBar.group.position.set(0, V.fly ? 3.1 : (P.vehicle === 'kart' ? 1.25 : 2.5), V.fly ? 1.5 : 0.8);
sirenBar.group.visible = false;
player.car.add(sirenBar.group);
function setSiren(on: boolean): void {
  sirenOn = on;
  sirenBtn.classList.toggle('on', on);
  sirenBar.group.visible = on;
  if (on) audio.unlock();
}
sirenBtn.addEventListener('click', () => setSiren(!sirenOn));

// ---- CC0 Kenney city kit preload ----
// Models are baked per-face into the chunk vertex-color meshes (buildings, trees,
// road tiles, lamps, parked cars). Any failure leaves the registry empty and the
// world falls back to the procedural pastel generator.
const KIT = '/assets/kenney/city';
const TRAINKIT = '/assets/kenney/train';
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
  'rail-straight': [`${TRAINKIT}/railroad-straight.glb`, `${TRAINKIT}/Textures/colormap.png`],
});
const PETKIT = '/assets/kenney/pets';
const PEDKIT = '/assets/kenney/mini-chars';
for (const [n, f] of [
  ['pet-dog', 'animal-dog'], ['pet-cat', 'animal-cat'], ['pet-bunny', 'animal-bunny'],
  ['pet-chick', 'animal-chick'], ['pet-pig', 'animal-pig'], ['pet-fox', 'animal-fox'],
  ['pet-panda', 'animal-panda'], ['pet-penguin', 'animal-penguin'],
] as const) KITDEFS[n] = [`${PETKIT}/${f}.glb`, `${PETKIT}/Textures/colormap.png`];
for (const s of 'abcdef') {
  KITDEFS[`ped-m${s}`] = [`${PEDKIT}/character-male-${s}.glb`, `${PEDKIT}/Textures/colormap.png`];
  KITDEFS[`ped-f${s}`] = [`${PEDKIT}/character-female-${s}.glb`, `${PEDKIT}/Textures/colormap.png`];
}
const INDUSKIT = '/assets/kenney/industrial';
for (const b of 'abcdefghijklmnopqrst') KITDEFS[`ind-${b}`] = [`${INDUSKIT}/building-${b}.glb`, `${INDUSKIT}/Textures/colormap.png`];
Object.assign(KITDEFS, {
  'ind-chimney': [`${INDUSKIT}/chimney-basic.glb`, `${INDUSKIT}/Textures/colormap.png`],
  'ind-chimney-m': [`${INDUSKIT}/chimney-medium.glb`, `${INDUSKIT}/Textures/colormap.png`],
  'ind-chimney-l': [`${INDUSKIT}/chimney-large.glb`, `${INDUSKIT}/Textures/colormap.png`],
  'ind-tank': [`${INDUSKIT}/detail-tank.glb`, `${INDUSKIT}/Textures/colormap.png`],
  'ind-tank-l': [`${INDUSKIT}/detail-tank-large.glb`, `${INDUSKIT}/Textures/colormap.png`],
  'ind-box-a': [`${INDUSKIT}/shipping-container-a.glb`, `${INDUSKIT}/Textures/colormap.png`],
  'ind-box-b': [`${INDUSKIT}/shipping-container-b.glb`, `${INDUSKIT}/Textures/colormap.png`],
  'ind-box-c': [`${INDUSKIT}/shipping-container-c.glb`, `${INDUSKIT}/Textures/colormap.png`],
  'ind-tower': [`${INDUSKIT}/water-tower.glb`, `${INDUSKIT}/Textures/colormap.png`],
  'ind-mill': [`${INDUSKIT}/windmill.glb`, `${INDUSKIT}/Textures/colormap.png`],
});
await prepBakedModels(KITDEFS).catch(() => {});
// dev probe: ?debugbake=1 exposes which templates registered
if (q.get('debugbake') === '1') {
  (window as unknown as { __bake: Record<string, boolean> }).__bake =
    Object.fromEntries(Object.keys(KITDEFS).map(k => [k, !!bakedModel(k)]));
}

// ---- chunk streaming ----
// the archipelago is far too big to build at once: chunks spring up around
// the truck as it drives (fog hides the seams), and the ?buildall=1 dev flag
// still lays down the whole starting city for aerial screenshots
const roadGrid = new RoadGrid(0, 0);
const chunks = new ChunkManager(scene, 64, 4);
let river = riverFor(citySeed(0, 0));
chunks.ensure(999, spawn.x, spawn.z);
if (q.get('buildall') === '1') {
  for (let cx = 0; cx < WORLD_CHUNKS; cx++) {
    for (let cz = 0; cz < WORLD_CHUNKS; cz++) chunks.addChunk(0, 0, cx, cz);
  }
}

// ---- the sea: waving water + the watercraft fleet (shore dressing is
// per-city scenery: foam ring, pier, dinghies, buoys, the picnic causeway) ----
const sea = await createSea(scene);
const scenery = new CityScenery(scene);

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
const missions = new Missions(scene, 64, roadGrid, heliMode);
const MAX_ACTIVE = 3;
for (let i = 0; i < 3; i++) missions.spawn(player.state, (x, z) => chunks.forceChunkAt(x, z));

// ?spraytest=1: teleport next to the first fire -> spray scene
if (q.get('spraytest') === '1') {
  const fp = missions.objectives.find(o => o.type === 'fire');
  if (fp) { player.state.x = fp.pos.x + 6; player.state.z = fp.pos.z + 4; }
}

// ---- ambient life: trains on the smooth main line (with station stops),
// the level crossings that hold the cars, a patrol
// heli circling the neighbourhood while the kid plays the fire truck ----
const trains = new Trains(scene, 0, 0);
const transit = new Transit(scene);
// in heli mode one of the AI vehicles is the fire truck, driving itself
const traffic = new Traffic(scene, roadGrid, 64, 12, V.fly ? ['/assets/kenney/firetruck.glb'] : [], trains);

// dev probe: ?debugsea=1 exposes scene handles for verification
if (q.get('debugsea') === '1') {
  const v = new THREE.Vector3();
  (window as unknown as { __dbg: unknown }).__dbg = {
    sea,
    scene,
    camera,
    renderer,
    trains,
    traffic,
    chunks,
    player,
    transit: () => transit.list(),
    river: () => river,
    route: () => railRouteFor(curCity.bx, curCity.by),
    probe: (x: number, y: number, z: number) => {
      const out = v.set(x, y, z).project(camera);
      return [+out.x.toFixed(2), +out.y.toFixed(2), +out.z.toFixed(2)];
    },
  };
}
const patrol = V.fly ? null : new PatrolHeli(scene);
// ---- pets + pedestrians: cube pets and Kenney mini-characters share the
// sidewalks; everyone strolls until the fire truck scares them ----
const PET_NAMES = ['pet-dog', 'pet-cat', 'pet-bunny', 'pet-chick', 'pet-pig', 'pet-fox', 'pet-panda', 'pet-penguin'];
const PED_NAMES = [...'abcdef'].flatMap(s => [`ped-m${s}`, `ped-f${s}`]);
const pickTpl = (n: string) => {
  const t = bakedModel(n);
  if (!t) console.warn('missing baked template:', n);
  return t;
};
const pedestrians = new Pedestrians(scene, roadGrid, 64, 14,
  PET_NAMES.map(pickTpl).filter((t): t is BakedTemplate => !!t),
  PED_NAMES.map(pickTpl).filter((t): t is BakedTemplate => !!t));
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
const minimap = new Minimap(document.getElementById('minimap') as HTMLCanvasElement, missions, () => sea.boatDots());

// ---- the city grid: drive across a strait and the next city wakes up.
// Every system (plan, trains, traffic, pedestrians, shore scenery,
// minimap) repoints itself at the new island; the seed is derived from the
// city's coordinates, so city (3, -2) is always the same city. ----
let curCity: CityRef = { bx: 0, by: 0, ox: 0, oz: 0, key: '0,0' };
function applyCity(c: CityRef): void {
  curCity = c;
  roadGrid.setCity(c.bx, c.by);
  river = riverFor(citySeed(c.bx, c.by));
  traffic.setCity(c.bx, c.by, c.ox, c.oz, player.car.position);
  pedestrians.setCity(c.ox, c.oz, player.state.x, player.state.z);
  trains.setCity(scene, c.bx, c.by);
  transit.setCity(c.bx, c.by, c.ox, c.oz);
  sea.setCity(c.ox, c.oz);
  scenery.ensure(c.bx, c.by, c.ox, c.oz);
  minimap.setCity(c.bx, c.by, c.ox, c.oz);
  missions.setCity(c.ox, c.oz);
  const s = pickSpawn(c.bx, c.by);
  spawn = { x: s.x + c.ox, z: s.z + c.oz, heading: s.heading };
}
applyCity(curCity);
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
let splashTimer = 0;
const totals = loadTotals();
updateMissionPanel();
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
  // crossed into a neighbouring city?
  const here = cityAt(st.x, st.z);
  if (here.key !== curCity.key) applyCity(here);

  // physics + collision (frozen during the mini-scenes: the truck stays put
  // until the fire is out / the cat is down)
  if (mode === 'drive' || player.crashT > 0) {
    const boxes = chunks.boxesNear(st.x, st.z).concat(scenery.boxesNear(), transit.boxesNear());
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

  // the archipelago is endless; stray into the sea and R brings you back
  chunks.ensure(2, st.x, st.z);

  // ambient life: the trains, the sea with its boats and the patrol
  // helicopter; the river is a shallow ford — splash through it slowly
  trains.update(dt);
  trains.setOrigin(curCity.ox, curCity.oz);
  transit.update(dt, elapsed, trains);
  sea.update(elapsed);
  patrol?.update(dt, elapsed, st.x, st.z);
  pedestrians.update(dt, st.x, st.z, st.x, st.z);
  if (!V.fly && river.inWater(st.x - curCity.ox, st.z - curCity.oz)) {
    st.v *= 1 - Math.min(0.5, dt * 1.6);
    splashTimer -= dt;
    if (Math.abs(st.v) > 1.5 && splashTimer <= 0) {
      splashTimer = 0.1;
      particles.splash(new THREE.Vector3(st.x, 0.25, st.z));
    }
  }

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

  // missions: keep several rescue calls alive
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
    guideArrow.style.display = '';
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
    guideArrow.style.display = 'none';
    guideDist.textContent = '';
    updateMissionPanel();
  }

  audio.setSiren(sirenOn);
  audio.setPump(jet.visible);
  if (sirenOn) {
    // alternate the lightbar: red flash / blue flash
    const phase = Math.floor(elapsed * 5) % 2;
    (sirenBar.red.material as THREE.MeshBasicMaterial).color.setHex(phase === 0 ? 0xff3b30 : 0x4a1616);
    (sirenBar.blue.material as THREE.MeshBasicMaterial).color.setHex(phase === 1 ? 0x3f7bff : 0x161d4a);
  }

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
    hud.set(`city ${curCity.bx},${curCity.by} · ${P.vehicle} · ${kmh} km/h · draw calls ${i.calls} · triangles ${i.triangles.toLocaleString('en-US')}`);
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
