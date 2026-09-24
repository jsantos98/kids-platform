// The Endless City: boot, frame loop and play-mode orchestration (fire truck,
// police car, ambulance, helicopters, plane, boat, train — modes.ts).
import * as THREE from 'three';
import { createStage, makeHUD } from '../../engine/stage.js';
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
import { GuideArrow, pulseBeacon } from './guide3d.js';
import { ChunkManager } from './chunks.js';
import { Traffic } from './traffic.js';
import { Trains } from './train.js';
import { createSea, boatLoop, waveAt } from './sea.js';
import { CityScenery } from './scenery.js';
import { PatrolHeli } from './patrol.js';
import { Pedestrians } from './pedestrians.js';
import type { BakedTemplate } from '../../engine/assets.js';
import { graphFor } from '../../worlds/streetGraph.js';
import { WORLD_CHUNKS, chunkGroundColor } from '../../worlds/cityChunk.js';
import { CENTER, ISLAND } from '../../worlds/world.js';
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
};
const MODE = modeFromURL(q);
if (seedParam === null) {
  const u = new URL(location.href);
  u.searchParams.set('seed', String(P.seed));
  history.replaceState(null, '', u.toString());
}
setCityBase(P.seed);

/** a starting lane spot that suits THIS city: on a street near the centre,
 * clear of the river, the railway, level crossings and roundabouts
 * (city-local coords). Streets are tried nearest-the-centre first. */
function pickSpawn(bx: number, by: number): { x: number; z: number; heading: number } {
  const seed = citySeed(bx, by);
  const sr = rng(chunkSeed(seed, 0x5b0, 3));
  const g = graphFor(bx, by);
  const river = riverFor(seed);
  const rail = railRouteFor(bx, by);
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

/** the boat starts on the offshore sailing lane off the pier (south-east),
 * pointing along the lane */
function seaSpawn(): { x: number; z: number; heading: number } {
  const loop = boatLoop();
  let k0 = 0, best = Infinity;
  loop.forEach((p, k) => {
    const d = (p.x - (ISLAND - 50)) ** 2 + (p.z - (ISLAND + 26)) ** 2;
    if (d < best) { best = d; k0 = k; }
  });
  const a = loop[k0], b = loop[(k0 + 1) % loop.length];
  return { x: a.x, z: a.z, heading: Math.atan2(b.x - a.x, b.z - a.z) };
}

/** where a mode starts in city (bx, by) — city-local */
function modeSpawn(bx: number, by: number): { x: number; z: number; heading: number } {
  if (MODE.spawn === 'sea') return seaSpawn();
  if (MODE.spawn === 'rail') {
    const r = railRouteFor(bx, by);
    const p = r.sample(r.total / 6); // where Trains.addPlayer puts the kid's train
    return { x: p.x, z: p.z, heading: p.h };
  }
  return pickSpawn(bx, by);
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
const V = MODE.vehicle;
const airborne = V.kind === 'heli' || V.kind === 'plane';
let spawn = modeSpawn(0, 0); // city (0,0) is the origin, so local == world at boot
const player = createPlayer(V, spawn.x, spawn.z, spawn.heading);
scene.add(player.car);
// known-good road spots for crash / stuck resumes, and the floating guide arrow
const crumbs = new Breadcrumbs(V.radius);
const guideArrow3d = new GuideArrow(scene);
const camDir = new THREE.Vector3();
const stuck = { t: 0, x: spawn.x, z: spawn.z, gas: true };
camera.position.set(spawn.x, V.camUp, spawn.z + V.camBack);
camera.lookAt(spawn.x, 1.4, spawn.z);

const audio = new GameAudio();
initInput(code => {
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
if (!MODE.lightbar) sirenBtn.style.display = 'none';
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
const missions = new Missions(scene, MODE.calls);
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

// ---- ambient life: trains on the smooth main line (with station stops),
// the level crossings that hold the cars, a patrol
// heli circling the neighbourhood while the kid plays the fire truck ----
const trains = new Trains(scene, 0, 0);
if (V.kind === 'rail') trains.addPlayer();
/** the train: index of the station to stop at next (into trains.stationArcs) */
let stationNext = -1;
const transit = new Transit(scene);
// unless the kid drives it, one of the AI vehicles is the fire truck
const traffic = new Traffic(scene, 12, MODE.id !== 'truck' ? ['/assets/kenney/firetruck.glb'] : [], trains, camera);

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
    course: () => course,
    transit: () => transit.list(),
    river: () => river,
    route: () => railRouteFor(curCity.bx, curCity.by),
    probe: (x: number, y: number, z: number) => {
      const out = v.set(x, y, z).project(camera);
      return [+out.x.toFixed(2), +out.y.toFixed(2), +out.z.toFixed(2)];
    },
  };
}
const patrol = airborne ? null : new PatrolHeli(scene);
// ---- pets + pedestrians: cube pets and Kenney mini-characters share the
// sidewalks; everyone strolls until the fire truck scares them ----
const PET_NAMES = ['pet-dog', 'pet-cat', 'pet-bunny', 'pet-chick', 'pet-pig', 'pet-fox', 'pet-panda', 'pet-penguin'];
const PED_NAMES = [...'abcdef'].flatMap(s => [`ped-m${s}`, `ped-f${s}`]);
const pickTpl = (n: string) => {
  const t = bakedModel(n);
  if (!t) console.warn('missing baked template:', n);
  return t;
};
const pedestrians = new Pedestrians(scene, 14,
  PET_NAMES.map(pickTpl).filter((t): t is BakedTemplate => !!t),
  PED_NAMES.map(pickTpl).filter((t): t is BakedTemplate => !!t),
  camera);
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
  river = riverFor(citySeed(c.bx, c.by));
  traffic.setCity(c.bx, c.by, c.ox, c.oz, player.car.position);
  pedestrians.setCity(c.bx, c.by, c.ox, c.oz, player.state.x, player.state.z);
  trains.setCity(scene, c.bx, c.by);
  transit.setCity(c.bx, c.by, c.ox, c.oz);
  sea.setCity(c.ox, c.oz);
  scenery.ensure(c.bx, c.by, c.ox, c.oz);
  minimap.setCity(c.bx, c.by, c.ox, c.oz);
  missions.setCity(c.bx, c.by, c.ox, c.oz);
  const s = modeSpawn(c.bx, c.by);
  spawn = { x: s.x + c.ox, z: s.z + c.oz, heading: s.heading };
  course?.start(c, player.state.x, player.state.z, player.state.heading);
  stationNext = -1;
}
applyCity(curCity);
const hud = makeHUD();
let runStars = 0;
function updateMissionPanel(): void {
  missionEl.innerHTML = MODE.id === 'truck'
    ? `<span style="color:#e25c5c;font-weight:800">this run: ${missions.sFires} fires · ${missions.sCats} rescues</span><br>all time: ${totals.fires} 🔥 · ${totals.cats} 🐱 saved`
    : `<span style="color:#e25c5c;font-weight:800">${MODE.icon} this run: ${runStars} ⭐</span><br>all time: ${totals.stars} ⭐`;
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
  return { x: g.nodes[best[k]].x + ox, z: g.nodes[best[k]].z + oz };
}

/** the train's next station: world position + arc gap ahead of the train */
function nextStation(): { x: number; z: number; gap: number } | null {
  const arcs = trains.stationArcs;
  const pose = trains.playerPose();
  if (!arcs.length || !pose) return null;
  const total = trains.loopLength;
  const ahead = (d: number): number => ((d - pose.s) % total + total) % total;
  if (stationNext < 0 || stationNext >= arcs.length) {
    // the first station ahead of the train
    let best = 0;
    arcs.forEach((d, k) => { if (ahead(d) < ahead(arcs[best])) best = k; });
    stationNext = best;
  }
  let gap = ahead(arcs[stationNext]);
  // overshot the platform: the next station becomes the goal
  if (gap > total - 12) {
    stationNext = (stationNext + 1) % arcs.length;
    gap = ahead(arcs[stationNext]);
  }
  const p = trains.at(arcs[stationNext]);
  return { x: p.x + curCity.ox, z: p.z + curCity.oz, gap: gap > total - 12 ? 0 : gap };
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
  if (V.kind === 'rail') {
    // the kid's train: wheel pedals drive it, the pose comes from the rails
    trains.setControls(mode === 'drive' ? input.gas : 0, mode === 'drive' ? input.brake : 1, nextStation()?.gap ?? Infinity);
    const pose = trains.playerPose();
    if (pose) {
      st.x = pose.x + curCity.ox; st.z = pose.z + curCity.oz;
      st.heading = pose.h; st.v = pose.v;
    }
  } else if (mode === 'drive' || player.crashT > 0) {
    const boxes = chunks.boxesNear(st.x, st.z).concat(scenery.boxesNear(), transit.boxesNear());
    const wasCrashing = player.crashT > 0;
    const ring = course?.target();
    const step = physicsStep(player, input, dt, boxes, ring ? ring.y - 2 : PLANE_ALT);
    if (step.crashed) {
      audio.thud();
      toast = '';
      Object.assign(player.crash, crumbs.pickResume(st.x, st.z, st.heading, boxes, spawn));
    } else if (!wasCrashing && V.kind === 'ground' && mode === 'drive') {
      crumbs.record(dt, st.x, st.z, st.heading, st.v, boxes);
      // stuck detector: gas held the whole window yet the truck went nowhere
      // (wedged against something the crash test forgives) -> same resume
      stuck.t += dt;
      stuck.gas &&= input.gas > 0.1;
      if (stuck.t >= 3) {
        if (stuck.gas && Math.hypot(st.x - stuck.x, st.z - stuck.z) < 1) {
          startCrash(player);
          Object.assign(player.crash, crumbs.pickResume(st.x, st.z, st.heading, boxes, spawn));
        }
        Object.assign(stuck, { t: 0, x: st.x, z: st.z, gas: true });
      }
    }
  } else {
    st.v = 0;
    Object.assign(stuck, { t: 0, x: st.x, z: st.z, gas: true });
  }

  const bob = V.kind === 'heli' ? Math.sin(elapsed * 1.3) * 0.7 : V.kind === 'boat' ? waveAt(st.x, st.z, elapsed) * 1.6 : 0;
  player.car.position.set(st.x, st.alt + bob, st.z);
  player.car.rotation.y = st.heading;
  if (V.kind === 'heli') {
    // hover-flight life: nose dips with speed, banks into turns, rotors spin
    player.car.rotation.x = -(st.v / V.maxF) * 0.16;
    player.car.rotation.z = input.steer * 0.12 * Math.min(1, Math.abs(st.v) / V.maxF);
    (player.car.userData.mainRotor as THREE.Object3D | undefined)!.rotation.y = elapsed * 22;
    (player.car.userData.tailRotor as THREE.Object3D | undefined)!.rotation.x = elapsed * 30;
  } else if (V.kind === 'plane') {
    // bank into the turn, nose follows the climb, propeller spins
    player.car.rotation.z = input.steer * 0.45;
    const ring = course?.target();
    player.car.rotation.x = -Math.max(-0.25, Math.min(0.25, ((ring ? ring.y - 2 : PLANE_ALT) - st.alt) * 0.05));
    (player.car.userData.prop as THREE.Object3D | undefined)!.rotation.z = elapsed * 40;
  } else if (V.kind === 'boat') {
    // pitch up on the plane at speed, rock with the swell
    player.car.rotation.x = -Math.min(0.12, Math.abs(st.v) * 0.008) + Math.sin(elapsed * 1.7) * 0.03;
    player.car.rotation.z = -input.steer * 0.08 * Math.min(1, Math.abs(st.v) / 8) + Math.sin(elapsed * 1.3) * 0.03;
  } else {
    player.car.rotation.z = -input.steer * Math.min(Math.abs(st.v) / 16, 1) * 0.04;
    for (const w of player.wheels) (w as THREE.Object3D).rotation.x += (st.v * dt) / 0.42;
  }

  // the lightbar sits on the kit model's roof once it has loaded
  if (!airborne && player.car.userData.top && !sirenBar.group.userData.placed) {
    sirenBar.group.position.y = player.car.userData.top as number;
    sirenBar.group.userData.placed = true;
  }
  searchlight?.update(st.x, st.alt + bob, st.z, st.heading);

  // camera (flying vehicles keep the camera near their altitude)
  const flyY = V.kind === 'plane' ? st.alt : V.kind === 'heli' ? HELI_ALT : 0;
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
  scenery.update(elapsed);
  patrol?.update(dt, elapsed, st.x, st.z);
  // people only scatter from vehicles on the ground
  if (airborne || V.kind === 'boat') pedestrians.update(dt, 1e9, 1e9, st.x, st.z);
  else pedestrians.update(dt, st.x, st.z, st.x, st.z);
  if (V.kind === 'ground' && river.inWater(st.x - curCity.ox, st.z - curCity.oz)) {
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

  // a finished course is followed by a fresh one after a short cheer
  if (course && !course.target()) {
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
    // hover marker over the call; the tall beacon pillar does the
    // long-range finding (it shows over the rooftops, fog or not)
    const busy = mode !== 'drive' && (spraySession?.obj === o || ladderSession?.obj === o);
    o.marker.visible = !busy;
    o.marker.scale.setScalar(1.6);
    o.marker.position.y = 5.4 + Math.sin(elapsed * 2 + o.index) * 0.5;
    o.marker.rotation.y += dt * 1.2;
    pulseBeacon(o.beacon, elapsed, o.index, busy ? 0 : o.d);
  }
  // the course gate / station the mode is heading for (when it has one)
  const gate = course?.target() ?? null;
  const station = V.kind === 'rail' ? nextStation() : null;
  const goal = gate ? { x: gate.x, z: gate.z } : station ? { x: station.x, z: station.z }
    : near ? { x: near.pos.x, z: near.pos.z } : null;
  const goalD = goal ? Math.hypot(goal.x - st.x, goal.z - st.z) : 0;
  // where the guidance points: straight at the goal when flying or close,
  // otherwise at the next junction of the shortest street route
  const way = goal && mode === 'drive' ? guideWaypoint(goal.x, goal.z, goalD) : null;
  const bearing = way ? Math.atan2(way.x - st.x, way.z - st.z) : null;
  guideArrow3d.update(dt, elapsed, player.car.position, airborne ? 5.2 : V.kind === 'rail' ? 7 : 4.6, bearing);
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
  } else if (course && gate) {
    // ---- checkpoint course: through the glowing gate, then the next ----
    showGuide(course.kind === 'gates' ? '🏁' : course.kind === 'rings' ? '⭕' : '🚩', goalD,
      Math.round((5 * course.next) / course.gates.length));
    promptText.textContent = course.kind === 'gates' ? 'DRIVE THROUGH THE GATES!'
      : course.kind === 'rings' ? 'FLY THROUGH THE RINGS!' : 'SAIL THROUGH THE BUOYS!';
    promptFill.style.width = `${(100 * course.next) / course.gates.length}%`;
    const res = course.update(elapsed, st.x, st.alt + 2, st.z);
    if (res === 'passed') particles.burstConfetti(new THREE.Vector3(st.x, st.alt + 2, st.z));
    if (res === 'finished') {
      earnStar(course.kind === 'gates' ? '🏁 PATROL DONE!' : course.kind === 'rings' ? '⭕ ALL RINGS!' : '🚩 COURSE SAILED!',
        new THREE.Vector3(st.x, st.alt + 2, st.z));
      courseWait = 2.5;
    }
  } else if (station) {
    // ---- the train: stop at the platform ----
    const pose = trains.playerPose()!;
    const gap = station.gap;
    showGuide('🚉', goalD, Math.max(0, Math.min(5, Math.round(5 * (1 - gap / 300)))));
    promptFill.style.width = '0%';
    promptText.textContent = gap < 12 ? (pose.v < 0.5 ? 'ALL ABOARD!' : 'STOP HERE!')
      : gap < 70 ? 'SLOW DOWN…' : 'DRIVE TO THE STATION';
    if (gap < 12 && pose.v < 0.5) {
      earnStar('🚉 STATION STOP!', new THREE.Vector3(st.x, 3, st.z));
      stationNext = (stationNext + 1) % trains.stationArcs.length;
    }
  } else if (near) {
    // ---- driving/flying guidance to the nearest call ----
    showGuide(near.type === 'fire' ? '🔥' : near.type === 'patient' ? '🆘' : '🐱', nd,
      Math.max(0, Math.min(5, Math.round(5 * (1 - nd / 240)))));
    if (near.type === 'fire') {
      promptText.textContent = nd < 15 ? 'STOP HERE!' : 'DRIVE TO THE FIRE';
      promptFill.style.width = '0%';
      if (nd < 15 && Math.abs(st.v) < 1.0 && player.crashT <= 0) {
        spraySession = sprayMod.beginSpray(near, player.car);
        mode = 'spray';
        promptText.textContent = 'SPRAY LEFT / RIGHT!';
      }
    } else if (near.type === 'patient') {
      // helicopter: hover over the person and the winch lifts them;
      // ambulance: pull up beside them and they climb in
      const heliMode = V.kind === 'heli';
      const close = heliMode ? nd < 9 && Math.abs(st.v) < 4 : nd < 12 && Math.abs(st.v) < 1 && player.crashT <= 0;
      if (close) near.progress += dt; // seconds held; done at `need`
      promptFill.style.width = `${Math.min(100, near.progress / near.need * 100)}%`;
      promptText.textContent = close ? (heliMode ? 'WINCHING…' : 'HELPING THEM IN…')
        : heliMode ? (nd < 9 ? 'HOVER HERE!' : 'FLY TO THE PERSON')
          : (nd < 12 ? 'STOP HERE!' : 'DRIVE TO THE PERSON');
      winch?.update(dt, close ? HELI_ALT - 1 : 1.2, V.scale ?? 1);
      if (near.progress >= near.need) {
        missions.remove(near);
        earnStar('🆘 PERSON RESCUED!', near.pos);
      }
    } else {
      promptText.textContent = nd < 12 ? 'STOP HERE!' : 'DRIVE TO THE CAT';
      promptFill.style.width = '0%';
      if (nd < 12 && Math.abs(st.v) < 1.0 && player.crashT <= 0) {
        ladderSession = ladderMod.beginLadder(scene, near, player.car);
        mode = 'ladder';
        promptText.textContent = 'MOVE THE LADDER TO THE CAT!';
      }
    }
  } else {
    guideEl.style.opacity = '1';
    promptEl.style.display = 'none';
    guideWait.textContent = toast || (course ? 'new course coming…' : 'waiting for a call…');
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
    hud.set(`city ${curCity.bx},${curCity.by} · ${MODE.id} · ${kmh} km/h · draw calls ${i.calls} · triangles ${i.triangles.toLocaleString('en-US')}`);
    document.title = 'STATS ' + i.calls + ' calls, ' + i.triangles + ' tris';
    (window as unknown as { __stats: unknown }).__stats = { calls: i.calls, triangles: i.triangles };
  }
};
renderer.setAnimationLoop(tick);
// dev probe: step frames by hand (background tabs pause requestAnimationFrame)
if (q.get('debugsea') === '1') {
  (window as unknown as { __dbg: Record<string, unknown> }).__dbg.tick = tick;
  (window as unknown as { __dbg: Record<string, unknown> }).__dbg.missions = missions;
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
