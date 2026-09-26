// The Endless City: boot, frame loop and play-mode orchestration (fire truck,
// police car, ambulance, helicopters, plane, boat, train — modes.ts).
import * as THREE from 'three';
import { createStage, makeHUD, type Dressing } from '../../engine/stage.js';
import { bakedNight } from '../../engine/baked.js';
import { dayState, startPhase, DAY_LEN, MOON_PHASES } from '../../engine/daylight.js';
import { prepBakedModels, bakedModel } from '../../engine/assets.js';
import { rng, chunkSeed } from '../../engine/rng.js';
import { GameAudio } from '../../engine/audio.js';
import { initInput, isDown, readDriveInput, pointerX } from '../../engine/input.js';
import { setupDevCapture } from '../../engine/capture.js';
import { createPlayer, physicsStep, startCrash, HELI_ALT, PLANE_ALT } from './player.js';
import { modeFromURL } from './modes.js';
import { Course } from './course.js';
import { Searchlight, Winch } from './heliFx.js';
import { Breadcrumbs } from './breadcrumb.js';
import { NightLights } from './nightLights.js';
import { GuideArrow, setGuideNight, pulseBeacon, makeIconSprite, GOAL_ICON } from './guide3d.js';
import { ChunkManager } from './chunks.js';
import { createSea, boatLoop, waveAt } from './sea.js';
import { CityScenery } from './scenery.js';
import { PatrolHeli } from './patrol.js';
import { IslandManager } from './island/manager.js';
import type { BakedTemplate } from '../../engine/assets.js';
import { graphFor } from '../../worlds/streetGraph.js';
import { WORLD_CHUNKS, chunkGroundColor, inBox } from '../../worlds/cityChunk.js';
import { CENTER, ISLAND } from '../../worlds/world.js';
import { coastFor } from '../../worlds/coast.js';
import { setCityBase, citySeed, cityAt, cityBase, CITY_PITCH, type CityRef } from '../../worlds/cityGrid.js';
import { raceTrackFor } from '../../worlds/raceIsland.js';
import { Race, LAPS } from './race.js';
import { Boarding } from './boarding.js';
import { IslandPrefetch } from './prefetch.js';
import { exportBakedTemplates } from '../../engine/assets.js';
import { buildIslandData, islandReady, installIslandData, type IslandData } from '../../worlds/islandData.js';
import { Robber, CATCH_R, CATCH_T, ROBBERS } from './robber.js';
import { CaughtActivity } from './activity/caught.js';
import { railNetFor } from '../../worlds/railRoute.js';
import { deckAt } from '../../worlds/causeway.js';
import { Railway, lineDir, setIslandGate } from './railway.js';
import { Missions, callIcon } from './missions.js';
import { makeSirenBar } from '../../kit/props.js';
import { Director } from './activity/director.js';
import type { Activity } from './activity/common.js';
import { HoseActivity, type FireVariant } from './activity/hose.js';
import { CatLadderActivity, type CatVariant } from './activity/catLadder.js';
import { RescueLadderActivity } from './activity/rescueLadder.js';
import { StretcherActivity } from './activity/stretcher.js';
import { WinchActivity } from './activity/winch.js';
import type { Objective } from './missions.js';
import { Particles } from './particles.js';
import { Transit } from './transit.js';
import { riverFor } from '../../worlds/riverRoute.js';
import { Minimap } from './minimap.js';
import { loadTotals, saveTotals } from './state.js';
import { LoadingScreen, nextFrame } from './loading.js';
import { raceCar } from '../raceCars.js';
import { t as tr, applyI18n, ordinal, numberLocale, type Key } from '../../i18n/index.js';

applyI18n('city.pageTitle');

// ---- params ----
const q = new URLSearchParams(location.search);
// every new game generates a fresh island; the rolled seed is written back
// into the URL so a refresh (or a share) replays the exact same world
const seedParam = q.get('seed');
const P = {
  seed: seedParam !== null && Number.isFinite(Number(seedParam)) && seedParam !== ''
    ? Number(seedParam)
    : 1 + ((Math.random() * 999999999) | 0),
};
const MODE = modeFromURL(q);
if (seedParam === null) {
  const u = new URL(location.href);
  u.searchParams.set('seed', String(P.seed));
  history.replaceState(null, '', u.toString());
}
setCityBase(P.seed);
// the time of day (G10): every game starts in the morning (?time= jumps);
// the moon's phase on the first night is the world's own
const START_PHASE = startPhase(q.get('time'));
const MOON_BASE = ((P.seed % MOON_PHASES) + MOON_PHASES) % MOON_PHASES;
/** (a debug shift of the day clock: __dbg.setPhase) */
let dayShift = 0;

/** a starting lane spot that suits THIS city: on a street near the centre,
 * clear of the river, the railway, level crossings and roundabouts
 * (city-local coords). Streets are tried nearest-the-centre first. */
function pickSpawn(bx: number, by: number): { x: number; z: number; heading: number } {
  const seed = citySeed(bx, by);
  const sr = rng(chunkSeed(seed, 0x5b0, 3));
  const g = graphFor(bx, by);
  const river = riverFor(bx, by);
  const rail = railNetFor(bx, by);
  const spots: Array<{ x: number; z: number; heading: number }> = [];
  const byCentre = g.edges
    .filter(e => !g.nodes[e.a].mouth && !g.nodes[e.b].mouth && !g.nodes[e.a].plaza && !g.nodes[e.b].plaza)
    .map(e => ({ e, d: Math.hypot(g.sample(e, e.len / 2).x - CENTER, g.sample(e, e.len / 2).z - CENTER) }))
    .sort((p, q) => p.d - q.d || p.e.id - q.e.id);
  for (const { e } of byCentre) {
    if (spots.length >= 6) break;
    // the right-hand lane driving a -> b, mid-block
    const s = 18 + sr() * (e.len - 36);
    const p = g.sample(e, s, 3.5);
    if (river.inWater(p.x, p.z) || rail.distTo(p.x, p.z) < 7) continue;
    if (e.crossings.some(c => Math.abs(c.s - s) < 17)) continue;
    spots.push({ x: p.x, z: p.z, heading: e.heading });
  }
  return spots.length ? spots[(sr() * spots.length) | 0] : { x: CENTER, z: CENTER, heading: 0 };
}

/** the boat starts on the offshore sailing lane off the pier (south-east
 * shore), pointing along the lane */
function seaSpawn(bx: number, by: number): { x: number; z: number; heading: number } {
  const loop = boatLoop(bx, by);
  const pier = coastFor(bx, by).shoreToward(CENTER + 1, CENTER + 1, 26);
  let k0 = 0, best = Infinity;
  loop.forEach((p, k) => {
    const d = (p.x - pier.x) ** 2 + (p.z - pier.z) ** 2;
    if (d < best) { best = d; k0 = k; }
  });
  const a = loop[k0], b = loop[(k0 + 1) % loop.length];
  return { x: a.x, z: a.z, heading: Math.atan2(b.x - a.x, b.z - a.z) };
}

/** the kid's train starts on the island's north-south line, 150 m in from
 * the portal it runs away from (the line's travel direction is seeded) */
function trainStart(bx: number, by: number): { arc: number; x: number; z: number; h: number } {
  const L = railNetFor(bx, by).lines[0];
  const fwd = lineDir({ kind: 'ns', idx: bx }) > 0;
  const arc = fwd ? 150 : L.rimOut - 150;
  const p = L.sample(arc);
  return { arc, x: p.x, z: p.z, h: fwd ? p.h : p.h + Math.PI };
}

/** where a mode starts in city (bx, by) — city-local */
function modeSpawn(bx: number, by: number): { x: number; z: number; heading: number } {
  if (MODE.spawn === 'sea') return seaSpawn(bx, by);
  if (MODE.spawn === 'race') {
    const T = raceTrackFor(bx, by);
    if (T) return { x: T.grid[1].x, z: T.grid[1].z, heading: T.grid[1].h };
  }
  if (MODE.spawn === 'rail') {
    const r = trainStart(bx, by);
    return { x: r.x, z: r.z, heading: r.h };
  }
  return pickSpawn(bx, by);
}

// ---- stage & world dressing ----
const stage = createStage({
  sunPos: [-40, 90, -55], shadowSpan: 95, fogNear: 70, fogFar: 260,
  ground: false, groundColor: 0xa9c88b, clouds: true,
});
const { scene, camera, renderer } = stage;

// ground follower — deep backdrop below the sea, hides the world's edge
const groundFollower = new THREE.Mesh(
  new THREE.PlaneGeometry(1600, 1600),
  new THREE.MeshLambertMaterial({ color: 0x6fb7d9 }),
);
groundFollower.rotation.x = -Math.PI / 2;
groundFollower.receiveShadow = true;
scene.add(groundFollower);

/** the kid's plane, helicopter or boat at night (G10): like the real
 * thing, a red light on the left, green on the right, a blinking red
 * beacon and double white strobes; the police helicopter flashes red and
 * blue under its belly, the medical one lights the ground beneath it; a boat
 * shows a white masthead light and its red / green sides */
const _lamp = new THREE.Vector3();
function flyingLamps(): void {
  const at = (x: number, y: number, z: number): THREE.Vector3 => player.car.localToWorld(_lamp.set(x, y, z));
  const lamp = (p: THREE.Vector3, color: number, size: number, strength = 1): void =>
    nightLights.flash({ x: p.x, y: p.y, z: p.z, color, size, pool: 0, strength });
  const t = elapsed;
  // (facing +z, the left side is local +x)
  if (V.kind === 'plane') {
    lamp(at(3.8, 1.0, 0.7), 0xff2a22, 1.9);
    lamp(at(-3.8, 1.0, 0.7), 0x33ff66, 1.9);
    const strobe = (t % 1.2 < 0.06) || (t % 1.2 > 0.18 && t % 1.2 < 0.24);
    if (strobe) { lamp(at(3.8, 1.05, 0.5), 0xffffff, 2.4); lamp(at(-3.8, 1.05, 0.5), 0xffffff, 2.4); }
    lamp(at(0, 2.7, -3.2), 0xff2a22, 1.6, 0.4 + 0.6 * Math.max(0, Math.sin(t * 5)));
  } else if (V.kind === 'heli') {
    lamp(at(0.8, 1.3, 1.0), 0xff2a22, 1.3);
    lamp(at(-0.8, 1.3, 1.0), 0x33ff66, 1.3);
    if (t % 1.1 < 0.12) lamp(at(0, 3.1, -4.05), 0xff2a22, 1.4);
    if (MODE.searchlight) {
      // police: red and blue strobes, turn about
      const blue = Math.floor(t * 6) % 2 === 0;
      lamp(at(blue ? 0.5 : -0.5, 0.95, 0.4), blue ? 0x3a7bff : 0xff2a22, 1.6);
    } else {
      // medical: a soft landing light on the ground below
      const g = at(0, 0, 0.8);
      nightLights.beam(g.x, 0.3, g.z, player.state.heading, 9, 11, 0xfff4dc, 0.8);
      lamp(at(0, 0.95, 1.2), 0xfff4dc, 1.2);
    }
  } else {
    lamp(at(0, 2.6, -0.4), 0xfff4dc, 1.0);
    lamp(at(0.9, 0.9, 0.8), 0xff2a22, 0.8);
    lamp(at(-0.9, 0.9, 0.8), 0x33ff66, 0.8);
  }
}

// ---- player vehicle ----
// (the race: the car picked in the garage — ?car=, the F1 by default — on the
// kart's physics; every car races the same, only the model differs)
const RACE_CAR = raceCar(q.get('car'));
const V = MODE.spawn === 'race'
  ? { ...MODE.vehicle, glb: `/${RACE_CAR.glb}`, glbLen: RACE_CAR.len, glbYaw: RACE_CAR.yaw }
  : MODE.vehicle;
const airborne = V.kind === 'heli' || V.kind === 'plane';
// the race starts on race island (0,0); every other mode on island (1,0)
const START = MODE.spawn === 'race' ? { bx: 0, by: 0 } : { bx: 1, by: 0 };
const START_OX = START.bx * CITY_PITCH, START_OZ = START.by * CITY_PITCH;
// boot: the start island (seconds of generation) is built in a world worker
// while the Kenney kits load and bake here; both are awaited before the
// first thing that needs either (?noprefetch=1: built here, as before)
// (all under the loading card: the kits ~15% of the wait, the island ~55%,
// the streets in view the rest)
const loading = new LoadingScreen(MODE.icon);
let kitF = 0, islandF = q.get('noprefetch') === '1' ? 1 : 0;
const bootProgress = (): void => {
  loading.set(0.15 * kitF + 0.55 * islandF,
    tr(islandF < 1 ? 'load.island' : kitF < 1 ? 'load.kits' : 'load.streets'));
};
bootProgress();
const kitsReady = import('./kitdefs.js')
  .then(m => prepBakedModels(m.KITDEFS, (d, t) => { kitF = d / t; bootProgress(); }))
  .catch(() => {});
const startIsland = new Promise<void>(done => {
  if (q.get('noprefetch') === '1') { done(); return; }
  try {
    const w = new Worker(new URL('../../worlds/worldWorker.ts', import.meta.url), { type: 'module' });
    const finish = (): void => { w.terminate(); done(); };
    w.onmessage = (e: MessageEvent<{ ok?: boolean; data?: IslandData; progress?: boolean; f?: number }>) => {
      if (e.data.progress) { islandF = e.data.f ?? islandF; bootProgress(); return; }
      if (e.data.ok && e.data.data) installIslandData(e.data.data);
      islandF = 1; bootProgress();
      finish();
    };
    w.onerror = finish;
    w.postMessage({ base: cityBase(), bx: START.bx, by: START.by });
  } catch { done(); }
});
await Promise.all([kitsReady, startIsland]);
let spawn = (() => {
  const s = modeSpawn(START.bx, START.by);
  return { x: s.x + START_OX, z: s.z + START_OZ, heading: s.heading };
})()
const player = createPlayer(V, spawn.x, spawn.z, spawn.heading);
scene.add(player.car);
// known-good road spots for crash / stuck resumes, and the floating guide arrow
const crumbs = new Breadcrumbs(V.radius);
const guideArrow3d = new GuideArrow();
const _topBox = new THREE.Box3();
/** how far the player's vehicle reaches above its origin (m) */
function vehicleTop(): number {
  _topBox.setFromObject(player.car);
  return _topBox.isEmpty() ? 2 : Math.max(1, _topBox.max.y - player.car.position.y);
}
const camDir = new THREE.Vector3();
const stuck = { t: 0, x: spawn.x, z: spawn.z, gas: true };
camera.position.set(spawn.x, V.camUp, spawn.z + V.camBack);
camera.lookAt(spawn.x, 1.4, spawn.z);

const audio = new GameAudio();
/** back to the garage (the launcher) */
function goHome(): void { location.href = new URL('../index.html', location.href).href; }
document.getElementById('homeBtn')!.addEventListener('click', goHome);
initInput(code => {
  if (code === 'Escape') { goHome(); return; }
  audio.unlock();
  if (code === 'KeyC') cycleCamera();
  if (code === 'KeyE') setSiren(!sirenOn);
  if (code === 'KeyR' && V.kind !== 'rail') {
    Object.assign(player.state, { x: spawn.x, z: spawn.z, heading: spawn.heading, v: V.kind === 'plane' ? 11 : 0 });
    crumbs.clear();
  }
});
addEventListener('pointerdown', () => audio.unlock());

// ---- siren: a manual toggle (screen button or the E key). While it's on the
// truck rocks a flashing red/blue lightbar and the siren howls. ----
const sirenBtn = document.getElementById('sirenBtn') as HTMLButtonElement;
let sirenOn = false;
const sirenBar = makeSirenBar();
sirenBar.group.position.set(0, V.fly ? 3.1 : 2.5, V.fly ? 1.5 : 0.8);
sirenBar.group.visible = false;
sirenBar.group.userData.extra = true;
player.car.add(sirenBar.group);
// modes without a lightbar (plane, boat, train) have no siren button
if (!MODE.lightbar) { sirenBtn.style.display = 'none'; document.body.classList.add('no-siren'); }
// police helicopter searchlight / medical helicopter winch
const searchlight = MODE.searchlight ? new Searchlight(scene) : null;
const winch = MODE.winch ? new Winch(player.car, V.scale ?? 1) : null;
function setSiren(on: boolean): void {
  if (!MODE.lightbar) return;
  sirenOn = on;
  sirenBtn.classList.toggle('on', on);
  sirenBar.group.visible = on;
  if (on) audio.unlock();
}
sirenBtn.addEventListener('click', () => setSiren(!sirenOn));

// ---- CC0 Kenney city kit preload ----
const KITDEFS = await import('./kitdefs.js').then(m => m.KITDEFS);
await kitsReady;
// dev probe: ?debugbake=1 exposes which templates registered
if (q.get('debugbake') === '1') {
  (window as unknown as { __bake: Record<string, boolean> }).__bake =
    Object.fromEntries(Object.keys(KITDEFS).map(k => [k, !!bakedModel(k)]));
}

// ---- chunk streaming ----
// the archipelago is far too big to build at once: chunks spring up around
// the truck as it drives (fog hides the seams), and the ?buildall=1 dev flag
// still lays down the whole starting city for aerial screenshots
const chunks = new ChunkManager(scene, 64, 4);
// the city's lights at night: lamp glows, pools, lit signals (G10)
const nightLights = new NightLights(scene, camera.position);
chunks.night = nightLights;
let river = riverFor(START.bx, START.by);
// the streets in view, a few a frame so the loading bar keeps moving
{
  const boot = chunks.wanted(spawn.x, spawn.z);
  let t = performance.now();
  for (let i = 0; i < boot.length; i++) {
    chunks.addChunk(...boot[i]);
    if (performance.now() - t > 40) {
      loading.set(0.7 + (0.28 * (i + 1)) / boot.length, tr('load.streets'));
      await nextFrame();
      t = performance.now();
    }
  }
  chunks.ensure(999, spawn.x, spawn.z);
}
// from here on chunks bake in the chunk worker (the boot ring above baked
// here, synchronously): it gets the baked kit templates once, then every
// island the game has built, so it never rebuilds a plan
const chunkWorker = (() => {
  if (q.get('noworker') === '1') return null;
  try {
    const w = new Worker(new URL('../../worlds/chunkWorker.ts', import.meta.url), { type: 'module' });
    w.postMessage({ type: 'templates', pack: exportBakedTemplates() });
    chunks.attachWorker(w, cityBase);
    return w;
  } catch { return null; }
})();
const islandsSent = new Set<string>();
/** give the chunk worker island (bx, by) if the game has it built */
function shareIsland(d: IslandData): void {
  const k = `${d.bx},${d.by}`;
  if (!chunkWorker || islandsSent.has(k)) return;
  islandsSent.add(k);
  chunkWorker.postMessage({ type: 'island', data: d });
}
if (q.get('buildall') === '1') {
  for (let cx = 0; cx < WORLD_CHUNKS; cx++) {
    for (let cz = 0; cz < WORLD_CHUNKS; cz++) chunks.addChunk(0, 0, cx, cz);
  }
}

// ---- the sea: waving water + the watercraft fleet (shore dressing is
// per-city scenery: foam ring, pier, dinghies, buoys, the picnic causeway) ----
const sea = await createSea(scene);
const scenery = new CityScenery(scene);
scenery.night = nightLights;

// ---- mission scenes: arriving at a call fades into its own little scene ----
const director = new Director(document.getElementById('fade')!);

// ---- missions ----
const missions = new Missions(scene, MODE.calls);
{
  const c0 = cityAt(spawn.x, spawn.z);
  missions.setCity(c0.bx, c0.by, c0.ox, c0.oz);
}
const MAX_ACTIVE = MODE.calls.length ? 3 : 0;
for (let i = 0; i < MAX_ACTIVE; i++) missions.spawn(player.state, (x, z) => chunks.forceChunkAt(x, z));
// checkpoint course (police car gates, sky rings, sea buoys)
const course = MODE.course ? new Course(scene, MODE.course, V.kind === 'plane') : null;
let courseWait = 0;

// ?spraytest=1: teleport next to the first fire -> spray scene
if (q.get('spraytest') === '1') {
  const fp = missions.objectives.find(o => o.type === 'fire');
  if (fp) { player.state.x = fp.pos.x + 6; player.state.z = fp.pos.z + 4; }
}

// ---- the islands' own life: every island keeps a fixed, seeded population
// — its trains, cars, pedestrians, pets and boats — that lives there for
// good. The island the kid is on is awake, and so is the neighbour whose
// shore they're approaching (island/manager.ts). ----
const PET_NAMES = ['pet-dog', 'pet-cat', 'pet-bunny', 'pet-chick', 'pet-pig', 'pet-fox', 'pet-panda', 'pet-penguin'];
const PED_NAMES = [...'abcdef'].flatMap(s => [`ped-m${s}`, `ped-f${s}`]);
const pickTpl = (n: string) => {
  const t = bakedModel(n);
  if (!t) console.warn('missing baked template:', n);
  return t;
};
// the world's trains: endless through lines on a timetable (railway.ts)
const railway = new Railway(scene);
const islands = new IslandManager(scene, {
  railway,
  // unless the kid drives it, one of the AI vehicles is the fire truck
  extraCars: MODE.id !== 'truck' ? ['/assets/kenney/firetruck.glb'] : [],
  pets: PET_NAMES.map(pickTpl).filter((t): t is BakedTemplate => !!t),
  people: PED_NAMES.map(pickTpl).filter((t): t is BakedTemplate => !!t),
});
// passengers queueing, boarding and leaving at the platforms
const boarding = new Boarding(scene,
  PED_NAMES.map(n => bakedModel(n)).filter((t): t is BakedTemplate => !!t),
  PET_NAMES.map(n => bakedModel(n)).filter((t): t is BakedTemplate => !!t));
// the kid's own train runs on the start island's north-south line
if (V.kind === 'rail') railway.addPlayer(START.bx, START.by, trainStart(START.bx, START.by).arc);
/** the platform the kid's train last stopped at (the goal moves on) */
let stationDone: { x: number; z: number } | null = null;
const stationIcon = V.kind === 'rail' ? makeIconSprite(GOAL_ICON.station, 3.4) : null;
if (stationIcon) { stationIcon.visible = false; scene.add(stationIcon); }
const transit = new Transit(scene);
transit.night = nightLights;

// dev probe: ?debugsea=1 exposes scene handles for verification
if (q.get('debugsea') === '1') {
  const v = new THREE.Vector3();
  (window as unknown as { __dbg: unknown }).__dbg = {
    /** the time of day now (G10) */
    day: () => day,
    stage,
    /** jump the day clock to a time of day (0 = dawn … 1) */
    setPhase: (p: number) => {
      const cur = dayState(elapsed + dayShift, START_PHASE, MOON_BASE);
      dayShift += ((((p - cur.phase) % 1) + 1) % 1) * DAY_LEN;
    },
    sea,
    scene,
    camera,
    renderer,
    railway,
    trains: () => railway.list(curCity.bx, curCity.by),
    islands,
    /** the current island's car fleet */
    get traffic() { return islands.sim(curCity.bx, curCity.by).cars; },
    chunks,
    player,
    course: () => course,
    transit: () => transit.list(),
    river: () => river,
    route: () => railNetFor(curCity.bx, curCity.by),
    /** chunk bakes waiting at the chunk worker */
    chunkBaking: () => chunks.baking,
    /** islands the world worker has built so far */
    prefetched: () => prefetch.done,
    /** police modes: the getaway car */
    robbers: () => robbers,
    /** the platforms' passengers */
    boarding: () => boarding.list(),
    /** race mode: the race on this island */
    race: () => race,
    /** where the guide arrow aims for a goal at world (tx, tz) */
    waypoint: (tx: number, tz: number) => guideWaypoint(tx, tz, Math.hypot(tx - player.state.x, tz - player.state.z)),
    probe: (x: number, y: number, z: number) => {
      const out = v.set(x, y, z).project(camera);
      return [+out.x.toFixed(2), +out.y.toFixed(2), +out.z.toFixed(2)];
    },
  };
}
const patrol = airborne ? null : new PatrolHeli(scene);
// dev probe: current pedestrian spots (via console/window)
(window as unknown as { __peds: () => unknown }).__peds = () => islands.sim(curCity.bx, curCity.by).walkers.list();

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
// (the minimap shows the goals, each as its badge's icon: the calls, the
// getaway cars, the course gates still to pass, the train's next station)
const minimap = new Minimap(document.getElementById('minimap') as HTMLCanvasElement, missions,
  () => {
    const st = V.kind === 'rail' ? nextStation() : null;
    return [
      ...robbers.filter(r => r.active).map(r => ({ x: r.x, z: r.z, icon: GOAL_ICON.robber })),
      ...(course?.gates ?? []).filter(g => !g.passed).map(g => ({ x: g.x, z: g.z, icon: GOAL_ICON[course!.kind] })),
      ...(st ? [{ x: st.x, z: st.z, icon: GOAL_ICON.station }] : []),
    ];
  });

// ---- the city grid: drive across a strait and the next city wakes up.
// The per-city systems (plan, shore scenery, transit furniture, minimap,
// missions) repoint themselves at the new island — its population was
// already awake as we approached (islands); the seed is derived from the
// city's coordinates, so city (3, -2) is always the same city. ----
let curCity: CityRef = cityAt(spawn.x, spawn.z);
/** police modes: the getaway cars on this island (several on the run at
 * once; the guide points at the nearest) */
const robbers: Robber[] = MODE.chase ? Array.from({ length: ROBBERS }, () => new Robber(scene)) : [];
const robberWait = robbers.map(() => 0);
let robberCount = 0;
/** put getaway car k on the run on island c, away from the others */
const newRobber = (k: number, c: CityRef): void => {
  const others = robbers.filter((o, j) => j !== k && o.active).map(o => ({ x: o.x, z: o.z }));
  robbers[k].spawn(c.bx, c.by, c.ox, c.oz, player.state.x, player.state.z, citySeed(c.bx, c.by) + 7919 * ++robberCount, others);
};
/** the nearest getaway car on the run, or null */
const nearestRobber = (x: number, z: number): Robber | null => {
  let best: Robber | null = null, bd = Infinity;
  for (const r of robbers) {
    if (!r.active) continue;
    const d = Math.hypot(r.x - x, r.z - z);
    if (d < bd) { bd = d; best = r; }
  }
  return best;
};
/** race mode: the race on this island's circuit (none elsewhere) */
let race: Race | null = null;
let raceCheer = 0, raceMsg = '', raceMsgT = 0;
/** the world worker builds the neighbouring islands ahead of the kid */
const prefetch = new IslandPrefetch();
// the trains never build an island mid-frame: they wait for the worker's
// (the island the kid is on is always built)
if (q.get('noprefetch') !== '1') setIslandGate((bx, by) => (bx === curCity.bx && by === curCity.by) || islandReady(bx, by));
prefetch.onIsland = shareIsland;
function applyCity(c: CityRef): void {
  curCity = c;
  shareIsland(buildIslandData(c.bx, c.by));
  // (?noprefetch=1: build on demand, as before — to measure the difference)
  if (q.get('noprefetch') !== '1') {
    prefetch.want(IslandPrefetch.around(c.bx, c.by));
    prefetch.rank(player.state.x, player.state.z);
  }
  river = riverFor(c.bx, c.by);
  transit.setCity(c.bx, c.by, c.ox, c.oz);
  sea.setCity(c.ox, c.oz);
  scenery.ensure(c.bx, c.by, c.ox, c.oz);
  minimap.setCity(c.bx, c.by, c.ox, c.oz);
  missions.setCity(c.bx, c.by, c.ox, c.oz);
  boarding.setCity(c.bx, c.by, c.ox, c.oz);
  for (const r of robbers) r.hide();
  robbers.forEach((_, k) => newRobber(k, c));
  const s = modeSpawn(c.bx, c.by);
  spawn = { x: s.x + c.ox, z: s.z + c.oz, heading: s.heading };
  course?.start(c, player.state.x, player.state.z, player.state.heading);
  stationDone = null;
  if (MODE.spawn === 'race') {
    race?.dispose();
    const T = raceTrackFor(c.bx, c.by);
    race = T ? new Race(scene, T, c.ox, c.oz, RACE_CAR) : null;
    if (race && raceTrackFor(c.bx, c.by) && T && T.inZone(player.state.x - c.ox, player.state.z - c.oz, 40)) {
      Object.assign(player.state, race.reset(), { v: 0 });
    } else race?.reset();
  }
}
applyCity(curCity);
loading.done();
const hud = makeHUD();
let runStars = 0;
function updateMissionPanel(): void {
  missionEl.innerHTML = MODE.id === 'truck'
    ? `<span style="color:#e25c5c;font-weight:800">${tr('score.runTruck', { fires: missions.sFires, cats: missions.sCats })}</span><br>${tr('score.totalTruck', { fires: totals.fires, cats: totals.cats })}`
    : `<span style="color:#e25c5c;font-weight:800">${MODE.icon} ${tr('score.run', { n: runStars })}</span><br>${tr('score.total', { n: totals.stars })}`;
}
/** a finished task outside the fire truck's fires/cats */
function earnStar(msg: string, at: THREE.Vector3): void {
  particles.burstConfetti(at);
  runStars++;
  totals.stars++;
  saveTotals(totals);
  toast = msg;
  updateMissionPanel();
}

// ---- camera modes ----
const CAM_MODES = ['chase', 'high', 'cab'];
const camParam = q.get('cam');
let camMode = CAM_MODES.includes(camParam ?? '') ? camParam! : 'chase';
let camLabelTimer = 0;
function cycleCamera(): void {
  camMode = CAM_MODES[(CAM_MODES.indexOf(camMode) + 1) % CAM_MODES.length];
  camLabel.textContent = tr('cam.label', { mode: tr(`cam.${camMode}` as Key) });
  camLabel.style.opacity = '1';
  clearTimeout(camLabelTimer);
  camLabelTimer = window.setTimeout(() => { camLabel.style.opacity = '0'; }, 1200);
}

// ---- back to the garage, and the next-island pill ----
const homeBtn = document.getElementById('homeBtn') as HTMLButtonElement;
const HOME_HOLD = 1.1;
let homeHold = 0;
const islandPill = document.getElementById('islandPill')!;
const islandPillText = islandPill.querySelector('.t') as HTMLElement;
const islandPillFill = islandPill.querySelector('.mini > div') as HTMLElement;

// ---- game state ----
let mode: 'drive' | 'activity' = 'drive';
/** the call whose scene is playing */
let activeCall: Objective | null = null;
let toast = '';
let splashTimer = 0;
const totals = loadTotals();
updateMissionPanel();
const clock = new THREE.Clock();
let statTime = 0, elapsed = 0;
let day = dayState(0, START_PHASE, MOON_BASE);

/** the scene for a call: hose (fires), ladders (cats, burning buildings),
 * stretcher (ambulance) or winch (medical helicopter) */
function sceneFor(o: Objective): Activity {
  if (o.type === 'fire') return new HoseActivity(o.seed, o.variant as FireVariant);
  if (o.type === 'cat') return new CatLadderActivity(o.seed, o.variant as CatVariant);
  if (o.type === 'rescue') return new RescueLadderActivity(o.seed);
  return V.kind === 'heli' ? new WinchActivity(o.seed) : new StretcherActivity(o.seed);
}

/** fade into a call's scene; when it's done the call is answered */
function openCall(o: Objective): void {
  activeCall = o;
  mode = 'activity';
  director.start(() => sceneFor(o), () => {
    missions.remove(o);
    if (o.type === 'fire') {
      missions.sFires++; totals.fires++;
      toast = tr('call.fireOut');
    } else if (o.type === 'cat' || o.type === 'rescue') {
      missions.sCats++; totals.cats++;
      toast = tr(o.type === 'cat' ? 'call.catSaved' : 'call.allSafe');
    } else {
      runStars++; totals.stars++;
      toast = tr('call.personSaved');
    }
    saveTotals(totals);
    updateMissionPanel();
    particles.burstConfetti(player.car.position);
    missions.cooldown = 3;
    activeCall = null;
    mode = 'drive';
  });
}

// ?scene=fire|cat|rescue|patient[&variant=..]: open that mission scene at once
// (dev/verification — every scene can be looked at without driving there)
{
  const sq = q.get('scene');
  if (sq === 'caught') {
    mode = 'activity';
    director.start(() => new CaughtActivity(Number(q.get('sceneSeed') ?? 1), V.kind === 'heli'), () => { mode = 'drive'; });
  }
  if (sq === 'fire' || sq === 'cat' || sq === 'rescue' || sq === 'patient') {
    const o = missions.objectives[0] ?? null;
    const fake = {
      ...(o ?? {}), type: sq, variant: q.get('variant') ?? (sq === 'fire' ? 'house' : 'tree'),
      seed: Number(q.get('sceneSeed') ?? 7),
    } as Objective;
    if (o) missions.objectives.splice(0, 1, fake);
    openCall(fake);
  }
}

// ?tp=x,z: teleport (debug/verification)
const tp = q.get('tp');
if (tp) {
  const [txs, tzs] = tp.split(',').map(Number);
  if (Number.isFinite(txs) && Number.isFinite(tzs)) { player.state.x = txs; player.state.z = tzs; }
}

/** the point the guide arrows aim at for the call at world (tx, tz): the
 * call itself when flying or within 45 m, else the next junction on the
 * shortest open-street route from whichever end of the player's street
 * gets there first */
function guideWaypoint(tx: number, tz: number, dist: number): { x: number; z: number } {
  if (V.kind !== 'ground' || dist < 45) return { x: tx, z: tz };
  const ox = curCity.ox, oz = curCity.oz;
  const g = graphFor(curCity.bx, curCity.by);
  const lx = player.state.x - ox, lz = player.state.z - oz;
  const here = g.nearest(lx, lz);
  const goal = g.nearestNode(tx - ox, tz - oz);
  if (!here || here.dist > 9 || !goal) return { x: tx, z: tz };
  // route from whichever end of the player's street gets there first
  let best: number[] | null = null, bestCost = Infinity;
  for (const end of [here.edge.a, here.edge.b]) {
    const path = g.route(end, goal.id);
    if (!path) continue;
    const n0 = g.nodes[end];
    let cost = Math.hypot(n0.x - lx, n0.z - lz);
    for (let k = 1; k < path.length; k++) {
      const a = g.nodes[path[k - 1]], b = g.nodes[path[k]];
      cost += Math.hypot(b.x - a.x, b.z - a.z);
    }
    if (cost < bestCost) { bestCost = cost; best = path; }
  }
  if (!best) return { x: tx, z: tz };
  // the first junction, or the next one once the player is on top of it
  const near = (id: number): boolean => Math.hypot(g.nodes[id].x - lx, g.nodes[id].z - lz) < 14;
  let k = 0;
  while (k < best.length - 1 && near(best[k])) k++;
  if (k === best.length - 1 && near(best[k])) return { x: tx, z: tz };
  // a turn coming up: well before the junction (about 4 s of driving, never
  // under 60 m, eased in over the 25 m before that) the arrow swings from
  // the junction to three quarters of the way onto the street to take — a
  // right turn reads as a clear right (~70° for a square one) while there's
  // still time to slow down. (Aimed at the junction itself it only showed
  // the turn once the vehicle was inside it.)
  const J = g.nodes[best[k]];
  const nxt = k + 1 < best.length ? g.nodes[best[k + 1]] : { x: tx - ox, z: tz - oz };
  const D = Math.hypot(J.x - lx, J.z - lz) || 1;
  const look = Math.max(60, Math.abs(player.state.v) * 4);
  const w = 0.75 * Math.max(0, Math.min(1, (look + 25 - D) / 25));
  const ul = Math.hypot(nxt.x - J.x, nxt.z - J.z) || 1;
  const ax = (J.x - lx) / D * (1 - w) + (nxt.x - J.x) / ul * w;
  const az = (J.z - lz) / D * (1 - w) + (nxt.z - J.z) / ul * w;
  const al = Math.hypot(ax, az) || 1;
  return { x: lx + (ax / al) * Math.max(D, 20) + ox, z: lz + (az / al) * Math.max(D, 20) + oz };
}

/** the train's next station: world position + track gap ahead of the train
 * (the platform just stopped at no longer counts) */
function nextStation(): { x: number; z: number; gap: number } | null {
  let st = railway.nextStation(0);
  if (st && stationDone && Math.hypot(st.x - stationDone.x, st.z - stationDone.z) < 1) st = railway.nextStation(1);
  return st;
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
  // the world worker builds whichever island is nearest the kid next; the
  // level crossings, platforms and track of a neighbour the kid is within
  // 300 m of are built a few milliseconds a frame before they arrive
  if (Math.floor(elapsed) !== Math.floor(elapsed - dt)) {
    prefetch.rank(st.x, st.z);
    const lx = st.x - here.ox, lz = st.z - here.oz;
    for (const [nbx, nby, gap] of [
      [here.bx + 1, here.by, CITY_PITCH - lx], [here.bx - 1, here.by, lx + (CITY_PITCH - ISLAND)],
      [here.bx, here.by + 1, CITY_PITCH - lz], [here.bx, here.by - 1, lz + (CITY_PITCH - ISLAND)],
    ] as Array<[number, number, number]>) {
      if (gap < 300 && islandReady(nbx, nby)) transit.prepare(nbx, nby, nbx * CITY_PITCH, nby * CITY_PITCH);
    }
  }
  transit.pump(3);

  // the wheel's start / select button held for a second goes back to the
  // garage (the home button's ring fills while it's held)
  {
    const gpd = navigator.getGamepads?.()[0];
    const held = !!gpd && [8, 9, 16].some(b => gpd.buttons[b]?.pressed);
    homeHold = held ? homeHold + dt : 0;
    homeBtn.style.setProperty('--hold', String(Math.min(1, homeHold / HOME_HOLD)));
    if (homeHold >= HOME_HOLD) goHome();
  }
  // a neighbour still being built as the kid drives up to it: a small
  // pill says it's on its way, with about how long it needs
  if (Math.floor(elapsed * 4) !== Math.floor((elapsed - dt) * 4)) {
    const lx = st.x - here.ox, lz = st.z - here.oz;
    let show: { f: number; eta: number } | null = null;
    for (const [nbx, nby, gap] of [
      [here.bx + 1, here.by, CITY_PITCH - lx], [here.bx - 1, here.by, lx + (CITY_PITCH - ISLAND)],
      [here.bx, here.by + 1, CITY_PITCH - lz], [here.bx, here.by - 1, lz + (CITY_PITCH - ISLAND)],
    ] as Array<[number, number, number]>) {
      if (gap > 420 || islandReady(nbx, nby)) continue;
      const stt = prefetch.status(nbx, nby);
      if (stt && (!show || stt.eta < show.eta)) show = stt;
    }
    islandPill.style.display = show ? 'block' : 'none';
    if (show) {
      islandPillText.textContent = tr('load.nextIsland', { eta: show.eta < 1.5 ? tr('load.almost') : tr('load.about', { s: Math.ceil(show.eta) }) });
      islandPillFill.style.width = `${(show.f * 100).toFixed(0)}%`;
    }
  }

  // physics + collision (frozen during the mini-scenes: the truck stays put
  // until the fire is out / the cat is down)
  if (V.kind === 'rail') {
    // the kid's train: wheel pedals drive it, the pose comes from the rails
    railway.setControls(mode === 'drive' ? input.gas : 0, mode === 'drive' ? input.brake : 1, nextStation()?.gap ?? Infinity);
    const pose = railway.playerPose();
    if (pose) {
      st.x = pose.x; st.z = pose.z;
      st.heading = pose.h; st.v = pose.v; st.alt = pose.y;
    }
  } else if (mode === 'drive' || player.crashT > 0) {
    // the race's countdown holds the kart on the grid
    // (no brake: at a standstill the brake pedal is reverse)
    if (race?.frozen) { input.gas = 0; input.brake = 0; input.steer = 0; st.v = 0; }
    const trainBoxes = V.kind === 'ground' ? railway.unitBoxes(st.x, st.z) : [];
    const boxes = chunks.boxesNear(st.x, st.z).concat(scenery.boxesNear(), transit.boxesNear(), trainBoxes);
    const wasCrashing = player.crashT > 0;
    // a train running into the kid's standing vehicle is a bump too: flash,
    // and carry on from a crumb clear of the track (G1)
    if (!wasCrashing && trainBoxes.some(b => inBox(b, st.x, st.z, V.radius))) {
      startCrash(player);
      audio.thud();
      Object.assign(player.crash, crumbs.pickResume(st.x, st.z, st.heading, boxes, spawn));
    }
    const ring = course?.aim(st.x, st.z, st.heading);
    const step = physicsStep(player, input, dt, boxes, ring ? ring.y - 2 : PLANE_ALT);
    if (step.crashed) {
      audio.thud();
      toast = '';
      // (road vehicles resume on a breadcrumb; the helicopter picked its
      // spot itself, just back along its path)
      if (V.kind === 'ground') Object.assign(player.crash, race && race.offTrack(st.x, st.z) < 40 ? race.resumeSpot() : crumbs.pickResume(st.x, st.z, st.heading, boxes, spawn));
    } else if (!wasCrashing && V.kind === 'ground' && mode === 'drive') {
      crumbs.record(dt, st.x, st.z, st.heading, st.v, boxes);
      // stuck detector: gas held the whole window yet the truck went nowhere
      // (wedged against something the crash test forgives) -> same resume
      stuck.t += dt;
      stuck.gas &&= input.gas > 0.1;
      if (stuck.t >= 3) {
        if (stuck.gas && Math.hypot(st.x - stuck.x, st.z - stuck.z) < 1) {
          startCrash(player);
          Object.assign(player.crash, race && race.offTrack(st.x, st.z) < 40 ? race.resumeSpot() : crumbs.pickResume(st.x, st.z, st.heading, boxes, spawn));
        }
        Object.assign(stuck, { t: 0, x: st.x, z: st.z, gas: true });
      }
    }
  } else {
    st.v = 0;
    Object.assign(stuck, { t: 0, x: st.x, z: st.z, gas: true });
  }

  // the race: grass off the track slows the kart, the AI karts bump it
  // softly, and laps / the finish are cheered
  if (race) {
    if (race.offTrack(st.x, st.z) > 1.5 && Math.abs(st.v) > 5) st.v *= 1 - Math.min(0.5, dt * 1.2);
    const push = race.bump(st.x, st.z);
    if (push) { st.x += push.dx; st.z += push.dz; st.v *= 1 - Math.min(0.5, dt * 3); }
    // the kit tiles' walls: slide along them, a little slower
    const wall = race.wall(st.x, st.z, V.halfW);
    if (wall) { st.x += wall.dx; st.z += wall.dz; st.v *= 1 - Math.min(0.5, dt * 2); }
    const ev = race.update(dt, st.x, st.z);
    const at = new THREE.Vector3(st.x, 2, st.z);
    if (ev.go) { raceMsg = tr('race.go'); raceMsgT = 1.5; particles.burstConfetti(at); }
    if (ev.lap) { raceMsg = ev.lap === LAPS ? tr('race.lastLap') : tr('race.lapN', { n: ev.lap }); raceMsgT = 2; }
    raceMsgT -= dt;
    if (ev.finished) {
      const place = ev.finished;
      earnStar(place === 1 ? tr('race.wonRace') : tr('race.placeRace', { place: ordinal(place) }), at);
      raceCheer = 0;
    }
    if (race.phase === 'finished') {
      // the celebration: confetti all round the finish until the next race
      raceCheer -= dt;
      if (raceCheer <= 0) {
        raceCheer = 0.5;
        particles.burstConfetti(new THREE.Vector3(st.x + (Math.random() - 0.5) * 8, 2 + Math.random() * 3, st.z + (Math.random() - 0.5) * 8));
      }
    }
    if (ev.restart) {
      Object.assign(st, race.reset(), { v: 0 });
      crumbs.clear();
    }
  }

  // the robber chase: the police car stays close, the helicopter keeps the
  // getaway car in its searchlight — CATCH_T seconds in all and it's caught
  // (each keeps its own progress; a caught one is replaced 3 s after its scene)
  robbers.forEach((rb, k) => {
    if (rb.active) {
      rb.update(dt, elapsed, st.x, st.z, director.busy);
      const lit = V.kind === 'heli'
        ? Math.hypot(rb.x - (st.x + Math.sin(st.heading) * 7), rb.z - (st.z + Math.cos(st.heading) * 7)) < 8
        : Math.hypot(rb.x - st.x, rb.z - st.z) < CATCH_R;
      // (no catching while it dashes: that's it shaking the police off)
      if (lit && mode === 'drive' && player.crashT <= 0 && rb.dashT <= 0) rb.caught += dt;
      // (caught in the searchlight, the getaway car bolts — as a bump by the
      // police car sets it off, G7)
      if (V.kind === 'heli') rb.spotted(lit && mode === 'drive', dt);
      if (rb.caught >= CATCH_T && mode === 'drive') {
        rb.hide();
        mode = 'activity';
        const seed = robberCount + k;
        director.start(() => new CaughtActivity(seed, V.kind === 'heli'), () => {
          earnStar(tr('chase.caught'), player.car.position.clone());
          mode = 'drive';
          robberWait[k] = 3;
        });
      }
    } else if (!director.busy) {
      robberWait[k] -= dt;
      if (robberWait[k] <= 0) newRobber(k, curCity);
    }
  });

  // road vehicles ride the causeway decks up over the raised span
  let deckPitch = 0;
  if (V.kind === 'ground') {
    const dk = deckAt(st.x, st.z);
    st.alt = dk && dk.kind === 'road' ? dk.y : 0;
    if (dk && dk.kind === 'road') {
      const hx = Math.sin(st.heading) * 1.5, hz = Math.cos(st.heading) * 1.5;
      const yf = deckAt(st.x + hx, st.z + hz)?.y ?? 0, yb = deckAt(st.x - hx, st.z - hz)?.y ?? 0;
      deckPitch = -Math.atan2(yf - yb, 3);
    }
  }
  const bob = V.kind === 'heli' ? Math.sin(elapsed * 1.3) * 0.7 : V.kind === 'boat' ? waveAt(st.x, st.z, elapsed) * 1.6 : 0;
  player.car.position.set(st.x, st.alt + bob, st.z);
  player.car.rotation.y = st.heading;
  if (V.kind === 'heli') {
    // hover-flight life: nose dips with speed, banks into turns, rotors spin
    player.car.rotation.x = -(st.v / V.maxF) * 0.16;
    // (banking INTO the turn: left wheel, left side down)
    player.car.rotation.z = -input.steer * 0.12 * Math.min(1, Math.abs(st.v) / V.maxF);
    (player.car.userData.mainRotor as THREE.Object3D | undefined)!.rotation.y = elapsed * 22;
    (player.car.userData.tailRotor as THREE.Object3D | undefined)!.rotation.x = elapsed * 30;
  } else if (V.kind === 'plane') {
    // bank into the turn, nose follows the climb, propeller spins
    // banks into the turn (left wheel: left wing down), eased with the turn
    player.car.rotation.z = -player.steerS * 0.45;
    const ring = course?.target;
    player.car.rotation.x = -Math.max(-0.25, Math.min(0.25, ((ring ? ring.y - 2 : PLANE_ALT) - st.alt) * 0.05));
    (player.car.userData.prop as THREE.Object3D | undefined)!.rotation.z = elapsed * 40;
  } else if (V.kind === 'boat') {
    // pitch up on the plane at speed, rock with the swell
    player.car.rotation.x = -Math.min(0.12, Math.abs(st.v) * 0.008) + Math.sin(elapsed * 1.7) * 0.03;
    player.car.rotation.z = -input.steer * 0.08 * Math.min(1, Math.abs(st.v) / 8) + Math.sin(elapsed * 1.3) * 0.03;
  } else {
    player.car.rotation.x = deckPitch;
    player.car.rotation.z = -input.steer * Math.min(Math.abs(st.v) / 16, 1) * 0.04;
    for (const w of player.wheels) (w as THREE.Object3D).rotation.x += (st.v * dt) / 0.42;
  }

  // the lightbar sits on the kit model's roof once it has loaded
  if (!airborne && player.car.userData.top && !sirenBar.group.userData.placed) {
    sirenBar.group.position.y = player.car.userData.top as number;
    sirenBar.group.userData.placed = true;
  }
  searchlight?.update(st.x, st.alt + bob, st.z, st.heading);
  searchlight?.setNight(day.night);
  if (nightLights.dark && (V.kind === 'plane' || V.kind === 'heli' || V.kind === 'boat')) flyingLamps();

  // camera (flying vehicles keep the camera near their altitude)
  // (road vehicles and the train ride the causeway decks, so they follow st.alt too)
  const flyY = V.kind === 'boat' ? 0 : st.alt;
  const fwd = new THREE.Vector3(Math.sin(st.heading), 0, Math.cos(st.heading));
  if (camMode === 'cab') {
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

  // the time of day (G10): the sun (or the moon) + shadow camera follow the
  // car, and the sky travels with it
  day = dayState(elapsed + dayShift, START_PHASE, MOON_BASE);
  // (from the air the view reaches far past the kid: the shadow box grows
  // and sits ahead of the vehicle, so its edge isn't a line across the view)
  const flying = V.fly;
  const reach = flying ? 150 : 95;
  stage.applyDay(day, st.x, st.z, elapsed, camera.position,
    { x: st.x + fwd.x * reach * (flying ? 0.5 : 0.25), z: st.z + fwd.z * reach * (flying ? 0.5 : 0.25), span: reach });
  groundFollower.position.set(st.x, -0.85, st.z);
  // the kid's road vehicle lights its lamps and the road ahead at night (G10)
  if (V.kind === 'ground') nightLights.carLamps(st.x, player.car.position.y, st.z, st.heading, V.glbLen / 2, V.halfW + 0.15, 0.85);

  // the archipelago is endless; stray into the sea and R brings you back
  // (one chunk a frame: a bake is 20-35 ms, and a new row of the view only
  // needs a handful every few seconds)
  chunks.ensure(1, st.x, st.z);

  // ambient life: the trains, the sea with its boats and the patrol
  // helicopter; the river is a shallow ford — splash through it slowly
  // every awake island: trains, cars, people, boats (people only scatter
  // from vehicles on the ground)
  islands.update(dt, elapsed, player.car.position, V.kind === 'ground'
    ? { x: st.x, z: st.z, heading: st.heading, v: st.v, halfL: V.glbLen / 2, halfW: V.halfW }
    : null);
  // nobody drives through anybody: the island's cars push a road vehicle
  // out of their footprint (G8)
  if (V.kind === 'ground') {
    const push = islands.bump(st.x, st.z, V.radius + 0.3);
    if (push) {
      st.x += push.dx; st.z += push.dz;
      st.v *= 1 - Math.min(0.5, dt * 3);
      player.car.position.x = st.x; player.car.position.z = st.z;
    }
    // the getaway cars are solid too: a bump knocks the police car back and
    // sends the robber off on a dash (G7)
    for (const rb of robbers) {
      const hit = mode === 'drive' ? rb.bump(st.x, st.z, V.radius + 0.3) : null;
      if (!hit) continue;
      st.x += hit.dx; st.z += hit.dz;
      player.car.position.x = st.x; player.car.position.z = st.z;
      if (hit.dashed) { st.v *= 0.5; audio.thud(); }
      else st.v *= 1 - Math.min(0.5, dt * 3);
    }
  }
  railway.update(dt, elapsed, st.x, st.z);
  boarding.update(dt, elapsed, railway, curCity.bx, curCity.by);
  transit.update(dt, elapsed, railway);
  sea.update(elapsed);
  scenery.update(elapsed, day.night);
  patrol?.update(dt, elapsed, st.x, st.z);
  if (V.kind === 'ground' && st.alt < 0.3 && river.inWater(st.x - curCity.ox, st.z - curCity.oz)) {
    st.v *= 1 - Math.min(0.5, dt * 1.6);
    splashTimer -= dt;
    if (Math.abs(st.v) > 1.5 && splashTimer <= 0) {
      splashTimer = 0.1;
      particles.splash(new THREE.Vector3(st.x, 0.25, st.z));
    }
  }

  // ambient life
  particles.updateDrift(dt, mode === 'drive', st.v, input.steer, player.car);
  particles.update(dt);
  chunks.updateLights(elapsed, st.x, st.z);
  minimap.update(st.x, st.z, st.heading);
  // mission-scene steering: +1 = right on screen — the wheel (turned right),
  // D / right arrow, or the mouse's x when nothing else is pressed
  let aimIn = 0;
  if (isDown('KeyA') || isDown('ArrowLeft')) aimIn -= 1;
  if (isDown('KeyD') || isDown('ArrowRight')) aimIn += 1;
  const gp = navigator.getGamepads?.()[0];
  if (gp && Math.abs(gp.axes[0]) > 0.08) aimIn = gp.axes[0];
  if (aimIn === 0 && Math.abs(pointerX()) > 0.05) aimIn = pointerX();
  const view = director.update(dt, elapsed, { steer: Math.max(-1, Math.min(1, aimIn)) });
  document.body.classList.toggle('in-scene', !!view.scene);

  // a finished course is followed by a fresh one after a short cheer
  if (course && course.done) {
    courseWait -= dt;
    if (courseWait <= 0) course.start(curCity, st.x, st.z, st.heading);
  }

  // missions: keep several rescue calls alive
  missions.cooldown -= dt;
  while (missions.objectives.length < MAX_ACTIVE && missions.cooldown <= 0) {
    missions.spawn(player.state, (x, z) => chunks.forceChunkAt(x, z));
    missions.cooldown = 0.5;
  }
  const { o: near, d: nd } = missions.nearest(st.x, st.z);
  // the medical helicopter's winch reels in unless it's lifting someone
  if (winch && !(near && near.type === 'patient' && nd < 9)) winch.update(dt, 1.2, V.scale ?? 1);
  for (const o of missions.objectives) {
    if (!o.marker) continue;
    // hover the call's icon over it; the tall beacon pillar does the
    // long-range finding (it shows over the rooftops, fog or not)
    const busy = activeCall === o;
    o.marker.visible = !busy;
    o.marker.position.y = 5.4 + Math.sin(elapsed * 2 + o.index) * 0.5;
    pulseBeacon(o.beacon, elapsed, o.index, busy ? 0 : o.d);
  }
  // the course gate / station the mode is heading for (when it has one)
  const gate = course?.target ?? null;
  const station = V.kind === 'rail' ? nextStation() : null;
  // (the next station floats its icon over the stop point)
  if (stationIcon) {
    stationIcon.visible = !!station && mode === 'drive';
    if (station) stationIcon.position.set(station.x, 7 + Math.sin(elapsed * 2) * 0.4, station.z);
  }
  const robber = nearestRobber(st.x, st.z);
  const goal = robber ? { x: robber.x, z: robber.z } : gate ? { x: gate.x, z: gate.z } : station ? { x: station.x, z: station.z }
    : near ? { x: near.pos.x, z: near.pos.z } : null;
  const goalD = goal ? Math.hypot(goal.x - st.x, goal.z - st.z) : 0;
  // where the guidance points: straight at the goal when flying or close,
  // otherwise at the next junction of the shortest street route
  const way = goal && mode === 'drive' ? guideWaypoint(goal.x, goal.z, goalD) : null;
  const bearing = way ? Math.atan2(way.x - st.x, way.z - st.z) : null;
  // the arrow: the same size on screen and the same gap over the vehicle's
  // real top (its model, rotor and roof lamps measured — a fixed lift sat
  // it inside the helicopter's rotor), whatever the camera's distance (each
  // vehicle's camera sits at its own: fixed in the world, the arrow was big
  // over one vehicle and small over another)
  {
    const top = V.kind === 'rail' ? 4.6 : vehicleTop();
    const size = Math.max(0.7, Math.min(3.2, camera.position.distanceTo(player.car.position) / 14));
    guideArrow3d.update(dt, elapsed, player.car.position, top + 1.6 * size, bearing, size, camera.position);
  }
  camera.getWorldDirection(camDir);
  const camYaw = Math.atan2(camDir.x, camDir.z);
  const showGuide = (icon: string, dist: number, dots: number): void => {
    guideEl.style.opacity = '1';
    guideIcon.textContent = icon;
    // the badge arrow turns with the CAMERA: up = straight ahead on screen
    guideArrow.style.transform = `rotate(${(camYaw - (bearing ?? camYaw)).toFixed(3)}rad)`;
    guideArrow.style.display = '';
    guideDist.innerHTML = '\u25CF'.repeat(dots) + '\u25CB'.repeat(5 - dots)
      + `<span class="m">${Math.round(dist)} m</span>`;
    guideWait.textContent = '';
    promptEl.style.display = 'block';
  };

  if (director.busy) {
    // ---- a mission scene is playing (or fading in/out) ----
    guideEl.style.opacity = '0';
    promptEl.style.display = view.scene ? 'block' : 'none';
    promptText.textContent = view.prompt;
    promptFill.style.width = `${Math.min(100, view.progress * 100)}%`;
  } else if (robber) {
    // ---- the chase: the nearest getaway car ----
    const rd = Math.hypot(robber.x - st.x, robber.z - st.z);
    showGuide(GOAL_ICON.robber, rd, Math.round((5 * robber.caught) / CATCH_T));
    promptFill.style.width = `${Math.min(100, (100 * robber.caught) / CATCH_T)}%`;
    const close = V.kind === 'heli' ? rd < 16 : rd < CATCH_R;
    promptText.textContent = tr(robber.dashT > 0 ? 'chase.runs'
      : V.kind === 'heli'
      ? (close ? 'chase.light' : 'chase.flyAfter')
      : (close ? 'chase.behind' : 'chase.catch'));
  } else if (race) {
    // ---- the race: lap, place, countdown ----
    const rv = race.view();
    const ahead = race.aheadPoint();
    const bearingR = Math.atan2(ahead.x - st.x, ahead.z - st.z);
    guideEl.style.opacity = '1';
    guideIcon.textContent = '🏁';
    guideArrow.style.transform = `rotate(${(camYaw - bearingR).toFixed(3)}rad)`;
    guideArrow.style.display = '';
    guideDist.innerHTML = `<span class="m">${tr('race.badge', { lap: rv.lap, laps: LAPS, place: ordinal(rv.place) })}</span>`;
    guideWait.textContent = '';
    // (the lap and place are on the guide badge: the prompt only speaks
    // for the countdown, the cheers and the finish)
    const say = rv.phase === 'countdown' ? (rv.count > 0 ? `${rv.count}…` : tr('race.go'))
      : rv.phase === 'finished' ? (rv.finalPlace === 1 ? tr('race.won') : tr('race.place', { place: ordinal(rv.finalPlace) }))
      : raceMsgT > 0 ? raceMsg : '';
    promptEl.style.display = say ? 'block' : 'none';
    promptFill.style.width = `${(rv.progress * 100).toFixed(1)}%`;
    promptText.textContent = say;
  } else if (course && gate) {
    // ---- checkpoint course: every glowing gate, in any order ----
    showGuide(GOAL_ICON[course.kind], goalD,
      Math.round((5 * course.passedCount) / course.gates.length));
    promptText.textContent = tr(course.kind === 'gates' ? 'course.gates'
      : course.kind === 'rings' ? 'course.rings' : 'course.buoys');
    promptFill.style.width = `${(100 * course.passedCount) / course.gates.length}%`;
    const res = course.update(elapsed, st.x, st.alt + 2, st.z);
    if (res === 'passed') particles.burstConfetti(new THREE.Vector3(st.x, st.alt + 2, st.z));
    if (res === 'finished') {
      earnStar(tr(course.kind === 'gates' ? 'course.gatesDone' : course.kind === 'rings' ? 'course.ringsDone' : 'course.buoysDone'),
        new THREE.Vector3(st.x, st.alt + 2, st.z));
      courseWait = 2.5;
    }
  } else if (station) {
    // ---- the train: stop at the platform ----
    const pose = railway.playerPose()!;
    const gap = station.gap;
    showGuide(GOAL_ICON.station, goalD, Math.max(0, Math.min(5, Math.round(5 * (1 - gap / 300)))));
    promptFill.style.width = '0%';
    promptText.textContent = gap < 12 ? (pose.v < 0.5 ? tr('train.aboard', { people: '🧍'.repeat(Math.min(6, boarding.boardedKid)) }) : tr('train.board'))
      : gap < 70 ? tr('train.slow') : tr('train.station');
    if (gap < 12 && pose.v < 0.5) {
      earnStar(tr('train.stop'), new THREE.Vector3(st.x, 3, st.z));
      stationDone = { x: station.x, z: station.z };
    }
  } else if (near) {
    // ---- driving/flying guidance to the nearest call ----
    showGuide(callIcon(near.type), nd,
      Math.max(0, Math.min(5, Math.round(5 * (1 - nd / 240)))));
    promptFill.style.width = '0%';
    // arriving: stop beside the call (the helicopter hovers over it) and its
    // scene opens
    const heliMode = V.kind === 'heli';
    const reach = heliMode ? 9 : near.type === 'cat' ? 12 : 15;
    const stopped = heliMode ? Math.abs(st.v) < 4 : Math.abs(st.v) < 1 && player.crashT <= 0;
    promptText.textContent = nd < reach ? tr(heliMode ? 'call.hover' : 'call.stop')
      : tr(`call.${heliMode ? 'fly' : 'drive'}.${near.type}` as Key);
    if (nd < reach && stopped) openCall(near);
  } else {
    guideEl.style.opacity = '1';
    promptEl.style.display = 'none';
    guideWait.textContent = toast || tr(course ? 'call.newCourse' : 'call.waiting');
    guideIcon.textContent = '🚨';
    guideArrow.style.transform = '';
    guideArrow.style.display = 'none';
    guideDist.textContent = '';
    updateMissionPanel();
  }

  audio.setSiren(sirenOn);
  audio.setPump(director.pumping);
  {
    // the vehicle's own roof lamps flash when its model has them (the police
    // car, the ambulance, the fire truck); otherwise the game's light bar
    const own = player.car.userData.siren as { red: THREE.Mesh[]; blue: THREE.Mesh[] } | null | undefined;
    const phase = Math.floor(elapsed * 5) % 2;
    if (own) {
      // (on: each lamp alternates glowing / dark; off: the model's own paint)
      sirenBar.group.visible = false;
      for (const l of own.red) { l.visible = sirenOn; (l.material as THREE.MeshBasicMaterial).color.setHex(phase === 0 ? 0xff2a1a : 0x3a1010); }
      for (const l of own.blue) { l.visible = sirenOn; (l.material as THREE.MeshBasicMaterial).color.setHex(phase === 1 ? 0x4a8cff : 0x10183a); }
    } else if (sirenOn) {
      // alternate the light bar: red flash / blue flash
      (sirenBar.red.material as THREE.MeshBasicMaterial).color.setHex(phase === 0 ? 0xff3b30 : 0x4a1616);
      (sirenBar.blue.material as THREE.MeshBasicMaterial).color.setHex(phase === 1 ? 0x3f7bff : 0x161d4a);
    }
  }

  if (player.crashT > 0) {
    promptEl.style.display = 'block';
    promptText.textContent = tr('call.oops');
    promptFill.style.width = '0%';
  }

  nightLights.fireflies(curCity, st.x, st.z, elapsed);
  nightLights.update(day.night);
  bakedNight.value = day.night;
  setGuideNight(day.night);
  renderer.toneMappingExposure = day.exposure;
  if (view.scene && view.camera) {
    // a mission scene plays at the world's time of day
    (view.scene.userData.dressing as Dressing | undefined)?.applyDay(day, 0, 0, elapsed, view.camera.position);
    renderer.render(view.scene, view.camera);
  } else {
    renderer.render(scene, camera);
    guideArrow3d.drawOver(renderer, camera);
  }
  if (elapsed - statTime > 0.4) {
    statTime = elapsed;
    const i = renderer.info.render;
    const kmh = Math.round(Math.abs(st.v) * 3.6);
    hud.set(tr('city.hud', { bx: curCity.bx, by: curCity.by, mode: tr(`mode.${MODE.id}.title` as Key), kmh, calls: i.calls, tris: i.triangles.toLocaleString(numberLocale()) }));
    // (the tab shows the page's name; the dev probe keeps its stats title)
    if (q.get('debugsea') === '1') document.title = 'STATS ' + i.calls + ' calls, ' + i.triangles + ' tris';
    (window as unknown as { __stats: unknown }).__stats = { calls: i.calls, triangles: i.triangles };
  }
};
renderer.setAnimationLoop(tick);
// dev probe: step frames by hand (background tabs pause requestAnimationFrame)
if (q.get('debugsea') === '1') {
  (window as unknown as { __dbg: Record<string, unknown> }).__dbg.tick = tick;
  (window as unknown as { __dbg: Record<string, unknown> }).__dbg.missions = missions;
  (window as unknown as { __dbg: Record<string, unknown> }).__dbg.director = director;
}
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
