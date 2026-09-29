// The Endless City: boot, frame loop and play-mode orchestration (fire truck,
// police car, ambulance, helicopters, plane, boat, train — modes.ts).
import * as THREE from 'three';
import { createStage, makeHUD, applyQuality, type Dressing } from '../../engine/stage.js';
import { TIERS, startQuality, qualityPref, setAutoQuality, lowerQuality, higherQuality, type Quality } from '../../engine/settings.js';
import { bakedNight, templateToMesh } from '../../engine/baked.js';
import { dayState, startPhase, hourOf, DAY_LEN, MOON_PHASES } from '../../engine/daylight.js';
import { prepBakedModels, bakedModel } from '../../engine/assets.js';
import { rng, chunkSeed } from '../../engine/rng.js';
import { GameAudio, type EngineKind, type SirenStyle } from '../../engine/audio.js';
import type { MusicId } from '../../engine/musicList.js';
import { Soundscape } from './soundscape.js';
import { Narrator } from './narrator.js';
import { preloadVoice, setVoiceMuted, wakeVoice, voiceReady } from '../../i18n/voice.js';
import { initInput, isDown, readDriveInput, pointerX } from '../../engine/input.js';
import { setupDevCapture } from '../../engine/capture.js';
import { createPlayer, physicsStep, startCrash, heliSirenLamps, onLand, HELI_ALT, PLANE_ALT, type SirenLamps } from './player.js';
import { overlapDepth } from './island/obb.js';
import { modeFromURL } from './modes.js';
import { Course } from './course.js';
import { Searchlight, Winch, SPOT_AHEAD, SPOT_R, SPOT_GRACE } from './heliFx.js';
import { Breadcrumbs, SeaCrumbs, type Spot } from './breadcrumb.js';
import { NightLights } from './nightLights.js';
import { Causeways } from './causeways.js';
import { GuideArrow, setGuideNight, pulseBeacon, makeIconSprite, makeBeacon, GOAL_ICON } from './guide3d.js';
import { ChunkManager } from './chunks.js';
import { createSea, boatLoop, waveAt, setFleetThreat, setFleetViewer } from './sea.js';
import { CityScenery } from './scenery.js';
import { LandmarkLayer } from './landmarkLayer.js';
import { landmarksFor, nearestLandmark, LANDMARK_ICON, type LandmarkKind } from './landmarks.js';
import { Handover } from './handover.js';
import { PatrolHeli } from './patrol.js';
import { IslandManager } from './island/manager.js';
import { setCarDrawScale } from './island/cars.js';
import { setWalkerDrawScale } from './island/walkers.js';
import type { BakedTemplate } from '../../engine/assets.js';
import { graphFor } from '../../worlds/streetGraph.js';
import { WORLD_CHUNKS, chunkGroundColor, inBox, type CollisionBox } from '../../worlds/cityChunk.js';
import { CENTER, ISLAND } from '../../worlds/world.js';
import { coastFor } from '../../worlds/coast.js';
import { setCityBase, citySeed, cityAt, cityBase, CITY_PITCH, type CityRef } from '../../worlds/cityGrid.js';
import { raceTrackFor } from '../../worlds/raceIsland.js';
import { Race, LAPS, AI_TOP } from './race.js';
import { Boarding } from './boarding.js';
import { IslandPrefetch } from './prefetch.js';
import { exportBakedTemplates } from '../../engine/assets.js';
import { buildIslandData, islandReady, installIslandData, type IslandData } from '../../worlds/islandData.js';
import { Robber, CATCH_R, CATCH_T, ROBBERS } from './robber.js';
import { ChaseActivity } from './activity/chase.js';
import { BattleActivity } from './activity/battle.js';
import { DigActivity } from './activity/dig.js';
import { Pirates, CATCH_R as SHIP_CATCH_R, CATCH_T as SHIP_CATCH_T, type Ship } from './pirates.js';
import { isletsFor, type Islet } from './islets.js';
import { railNetFor } from '../../worlds/railRoute.js';
import { cityPlanFor } from '../../worlds/cityPlan.js';
import { deckAt } from '../../worlds/causeway.js';
import { Railway, lineDir, setIslandGate } from './railway.js';
import { Missions, callIcon } from './missions.js';
import { makeSirenBar } from '../../kit/props.js';
import { Director } from './activity/director.js';
import type { Activity, CallLook, SceneCue } from './activity/common.js';
import { HoseActivity, type FireVariant } from './activity/hose.js';
import { CatLadderActivity, type CatVariant } from './activity/catLadder.js';
import { RescueLadderActivity } from './activity/rescueLadder.js';
import { RunActivity } from './activity/run.js';
import { WinchActivity, type WinchVariant } from './activity/winch.js';
import { TowActivity } from './activity/tow.js';
import { BinsActivity } from './activity/bins.js';
import type { Objective } from './missions.js';
import { Particles } from './particles.js';
import { Transit } from './transit.js';
import { riverFor } from '../../worlds/riverRoute.js';
import { Minimap } from './minimap.js';
import { loadTotals, saveTotals } from './state.js';
import { LoadingScreen, nextFrame } from './loading.js';
import { raceCar, engineOf } from '../raceCars.js';
import { lineOfSight } from './sight.js';
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
  // (a long ship — the pirate's — starts some 50 m on along the lane, clear
  // of the pier it started right beside)
  if ((MODE.vehicle.glbLen ?? 0) >= 10) k0 = (k0 + 17) % loop.length;
  const a = loop[k0], b = loop[(k0 + 1) % loop.length];
  return { x: a.x, z: a.z, heading: Math.atan2(b.x - a.x, b.z - a.z) };
}

/** the kid's train starts on the island's north-south line, 150 m in from
 * the portal it runs away from (the line's travel direction is seeded) */
function trainStart(bx: number, by: number): { arc: number; x: number; z: number; h: number } {
  const L = railNetFor(bx, by).lines[0];
  const fwd = lineDir({ kind: 'ns', idx: bx }) > 0;
  // about 220 m short of the first station ahead, so the first stop comes
  // soon (150 m in from the rim it could start past the island's stations,
  // the next one 1.5 km on) — clear of level crossings and the diamond
  const plan = cityPlanFor(bx, by), net = railNetFor(bx, by);
  const rim = fwd ? 150 : L.rimOut - 150;
  const ahead = plan.stations.filter(s => s.line === 0 && (fwd ? s.d > rim + 120 : s.d < rim - 120))
    .sort((p, q) => (fwd ? p.d - q.d : q.d - p.d))[0];
  const clear = (a: number): boolean => plan.crossings.every(c => c.line !== 0 || Math.abs(c.d - a) > 30)
    && Math.abs(net.diamond.d[0] - a) > 40;
  let arc = rim;
  if (ahead) {
    for (let a = fwd ? Math.max(rim, ahead.d - 220) : Math.min(rim, ahead.d + 220); fwd ? a >= rim : a <= rim; a += fwd ? -10 : 10) {
      if (clear(a)) { arc = a; break; }
    }
  }
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
// (the graphics quality, G13: a level to start at, and in "auto" the frames
// timed so it steps down while they are slow)
let quality: Quality = startQuality();
const qualityAuto = qualityPref() === 'auto';
const stage = createStage({
  sunPos: [-40, 90, -55], shadowSpan: 95, fogNear: TIERS[quality].fogNear, fogFar: TIERS[quality].fogFar,
  ground: false, groundColor: 0xa9c88b, clouds: true,
});
const { scene, camera, renderer } = stage;
setCarDrawScale(TIERS[quality].drawScale);
setWalkerDrawScale(TIERS[quality].drawScale);
applyQuality(renderer, stage.sun, TIERS[quality]);
let shadowFrame = 0;

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
 * beacon and double white strobes; a helicopter's siren lamps glow on
 * their beat, the medical one lights the ground beneath it; a boat
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
    // its siren lamps glow with the siren (the same beat they flash on)
    if (sirenOn) {
      const beat = Math.floor(t * 5) % 2;
      lamp(at(beat === 0 ? 0.8 : -0.8, 1.08, 1.25), beat === 0 && MODE.searchlight ? 0xff2a22 : 0x3a7bff, 1.6);
    }
    if (!MODE.searchlight) {
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
// a helicopter's siren lamps are part of it: small domes on its belly band (G3)
if (V.kind === 'heli' && MODE.lightbar) player.car.userData.siren = heliSirenLamps(player.car, !!MODE.searchlight);
// known-good road spots for crash / stuck resumes, and the floating guide arrow
const crumbs = new Breadcrumbs(V.radius);
// the boat's own crumbs, on clear water (G14)
const seaCrumbs = new SeaCrumbs();
const BOAT_HL = (V.glbLen ?? 6.5) / 2;
/** clear water for the kid's boat at world (x, z): no land, harbour or
 * anything standing in it, and no fleet boat there now or over the next
 * 2 s (G14) */
function seaClear(x: number, z: number, boxes: CollisionBox[]): boolean {
  if (onLand(x, z, V.radius + 3)) return false;
  if (boxes.some(b => !b.small && inBox(b, x, z, V.radius + 3))) return false;
  for (const ahead of [0, 1, 2]) {
    for (const b of islands.boatsNear(x, z, 40, ahead)) if (Math.hypot(b.x - x, b.z - z) < b.hl + BOAT_HL + 6) return false;
  }
  return true;
}
/** where the kid's boat resumes after a crash: a sea crumb well behind,
 * else the nearest point of the sailing lane, heading along it */
function boatResume(boxes: CollisionBox[]): Spot {
  const st = player.state, c = cityAt(st.x, st.z), loop = boatLoop(c.bx, c.by);
  let bi = 0, bd = Infinity;
  loop.forEach((p, i) => { const d = Math.hypot(p.x + c.ox - st.x, p.z + c.oz - st.z); if (d < bd && seaClear(p.x + c.ox, p.z + c.oz, boxes)) { bd = d; bi = i; } });
  const a = loop[bi], b = loop[(bi + 3) % loop.length];
  const fallback = { x: a.x + c.ox, z: a.z + c.oz, heading: Math.atan2(b.x - a.x, b.z - a.z) };
  return seaCrumbs.pickResume(st.x, st.z, (x, z) => seaClear(x, z, boxes), fallback);
}
const guideArrow3d = new GuideArrow();
const _topBox = new THREE.Box3();
/** how far the player's vehicle reaches above its origin (m) */
function vehicleTop(): number {
  _topBox.setFromObject(player.car);
  return _topBox.isEmpty() ? 2 : Math.max(1, _topBox.max.y - player.car.position.y);
}
/** the cab camera: just past the vehicle's nose, about three quarters of
 * its height up, looking ahead — measured from the model itself (fixed
 * numbers sat the eye inside some kit models); the train's nose from its
 * first unit. Measured again whenever the model changes (it streams in). */
const _cabBox = new THREE.Box3();
const _ahead = new THREE.Vector3();
let cabCache: { key: string; f: number; y: number } | null = null;
function cabEye(): { f: number; y: number } {
  if (V.kind === 'rail') return { f: railway.kidNose() + 0.4, y: 3.0 };
  const key = `${player.car.children.length}:${player.car.userData.top ?? 0}`;
  if (cabCache?.key === key) return cabCache;
  const c = player.car, pos = c.position.clone(), rot = c.rotation.clone();
  c.position.set(0, 0, 0);
  c.rotation.set(0, 0, 0);
  c.updateMatrixWorld(true);
  _cabBox.setFromObject(c);
  c.position.copy(pos);
  c.rotation.copy(rot);
  c.updateMatrixWorld(true);
  if (_cabBox.isEmpty()) return { f: V.cabF, y: V.cabY };
  cabCache = { key, f: _cabBox.max.z + 0.3, y: _cabBox.min.y + (_cabBox.max.y - _cabBox.min.y) * 0.85 };
  return cabCache;
}
const camDir = new THREE.Vector3();
const stuck = { t: 0, x: spawn.x, z: spawn.z, gas: true };
camera.position.set(spawn.x, V.camUp, spawn.z + V.camBack);
camera.lookAt(spawn.x, 1.4, spawn.z);

const audio = new GameAudio('../');
const sound = new Soundscape(audio);
// the narrator's voice (its clips are loaded ahead; muted with the sound)
const narrator = new Narrator('../');
preloadVoice('../', 'say-');
setVoiceMuted(audio.isMuted);
wakeVoice();
let saidStart = false, wasNight = false, wasTalking = false;
/** the race's places as the narrator last knew them */
let raceT = 0, racePlace = 0, leadT = 0;
/** "almost there!" said in this mission's scene */
let saidAlmost = false;
// sound on / off (remembered), beside the home button (G11)
const muteBtn = document.getElementById('muteBtn')!;
const showMute = (): void => { muteBtn.textContent = audio.isMuted ? '🔇' : '🔊'; };
showMute();
muteBtn.addEventListener('click', e => { e.stopPropagation(); audio.unlock(); audio.setMuted(!audio.isMuted); setVoiceMuted(audio.isMuted); showMute(); });
// the music on / off (its own switch, remembered — G12)
const musicBtn = document.getElementById('musicBtn')!;
const showMusic = (): void => { musicBtn.classList.toggle('off', !audio.isMusicOn); };
showMusic();
musicBtn.addEventListener('click', e => { e.stopPropagation(); audio.unlock(); audio.setMusicOn(!audio.isMusicOn); showMusic(); });
/** the music for the moment (G12): the mission's scene, the race, the chase
 * once a getaway car is in sight, or the island by day / by night (switched
 * with a margin, so dusk doesn't flip it back and forth) */
let musicNight = false;
/** how far a getaway car can be seen (m): from the street, from the air */
const SIGHT_GROUND = 130, SIGHT_AIR = 190;
/** the chase tune carries on this long (s) after the last getaway car went
 * out of sight — round a corner and back isn't a change of music */
const CHASE_HOLD = 10;
let chaseHold = 0, sightCheck = 0;
/** the nearest getaway car in sight: near enough, and no building standing
 * between the kid's eye and it (from the helicopter, over the low roofs) */
function robberInSight(): Robber | null {
  const st = player.state, eye = (V.fly ? st.alt : 0) + 1.8, range = V.fly ? SIGHT_AIR : SIGHT_GROUND;
  const near = robbers.filter(r => r.active && Math.hypot(r.x - st.x, r.z - st.z) <= range)
    .sort((a, b) => Math.hypot(a.x - st.x, a.z - st.z) - Math.hypot(b.x - st.x, b.z - st.z));
  for (const r of near) {
    const boxes = new Set([...chunks.boxesNear(st.x, st.z), ...chunks.boxesNear((st.x + r.x) / 2, (st.z + r.z) / 2), ...chunks.boxesNear(r.x, r.z)]);
    if (lineOfSight(st.x, st.z, eye, r.x, r.z, 1.2, [...boxes])) return r;
  }
  return null;
}
/** where a point is from the kid: ahead, behind, on the left or the right
 * (A / left gives +steer and grows the heading — facing +z the kid's left is
 * +x — so a positive bearing is on the LEFT) */
function sideOf(x: number, z: number): 'ahead' | 'behind' | 'left' | 'right' {
  const st = player.state;
  let d = Math.atan2(x - st.x, z - st.z) - st.heading;
  d = Math.atan2(Math.sin(d), Math.cos(d));
  return Math.abs(d) < 0.6 ? 'ahead' : Math.abs(d) > 2.5 ? 'behind' : d > 0 ? 'left' : 'right';
}
/** the chase: a getaway car coming into sight starts the chase tune and the
 * narrator says where it is ("it's over there on the left!") */
function watchRobbers(dt: number): void {
  chaseHold = Math.max(0, chaseHold - dt);
  sightCheck -= dt;
  if (sightCheck > 0) return;
  sightCheck = 0.25;
  const seen = robberInSight();
  if (!seen) return;
  if (chaseHold <= 0 && mode === 'drive') narrator.say('spotted', sideOf(seen.x, seen.z));
  chaseHold = CHASE_HOLD;
}
function musicNow(night: number, inScene: boolean, dt: number): MusicId {
  if (inScene) return 'scene';
  if (MODE.id === 'race') return 'race';
  if (MODE.pirate) return 'pirate';
  if (MODE.chase) {
    watchRobbers(dt);
    if (chaseHold > 0) return 'chase';
  }
  if (night > 0.6) musicNight = true;
  else if (night < 0.4) musicNight = false;
  return musicNight ? 'night' : 'day';
}
/** the kid's engine sound, by vehicle */
const ENGINE: EngineKind = V.kind === 'heli' ? 'heli' : V.kind === 'plane' ? 'plane' : V.kind === 'boat' ? 'boat'
  : V.kind === 'rail' ? 'train' : MODE.id === 'truck' || MODE.id === 'tow' || MODE.id === 'garbage' ? 'truck' : MODE.id === 'race' ? 'kart' : 'car';
/** its siren's two tones */
const SIREN_STYLE: SirenStyle = V.kind === 'heli' ? 'heli' : MODE.id === 'truck' ? 'fire' : MODE.id === 'police' ? 'police' : 'ambulance';
let seaNear = 0, seaCheck = 0, lastCount = -1;
/** back to the garage (the launcher) */
function goHome(): void { location.href = new URL('../index.html', location.href).href; }
document.getElementById('homeBtn')!.addEventListener('click', goHome);
initInput(code => {
  if (code === 'Escape') { goHome(); return; }
  audio.unlock();
  if (code === 'KeyC') cycleCamera();
  if (code === 'KeyE') { if (V.kind === 'rail') sound.event('horn'); else setSiren(!sirenOn); }
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
const chunks = new ChunkManager(scene, 64, TIERS[quality].viewR);

/** switch to another graphics quality while playing (G13) */
function setQuality(q: Quality): void {
  quality = q;
  const tier = TIERS[q];
  applyQuality(renderer, stage.sun, tier);
  chunks.setViewRadius(tier.viewR);
  const fog = scene.fog as THREE.Fog;
  fog.near = tier.fogNear;
  fog.far = tier.fogFar;
  setCarDrawScale(tier.drawScale);
  setWalkerDrawScale(tier.drawScale);
  if (qualityAuto) setAutoQuality(q);
}
/** the frames' real time, in 3 s windows: the frame rate the HUD shows, and
 * what "auto" steps on — down after two slow windows (under ~36 fps), up
 * only after eight steady ones at the screen's 60 fps and never again once
 * it has stepped down (it would go up and down) */
const perf = { last: performance.now(), t0: performance.now(), sum: 0, n: 0, fps: 0, slow: 0, fast: 0, downed: false };
function timeFrame(): void {
  const now = performance.now(), ms = now - perf.last;
  perf.last = now;
  // (a hitch — a tab switch, a boot bake — isn't the frame rate)
  if (ms < 250) { perf.sum += ms; perf.n++; }
  if (now - perf.t0 < 3000) return;
  const avg = perf.n ? perf.sum / perf.n : 16;
  perf.fps = Math.round(1000 / avg);
  perf.t0 = now; perf.sum = 0; perf.n = 0;
  // (a mission scene is a small stage; the first seconds are still loading)
  if (!qualityAuto || director.busy || elapsed < 8) return;
  perf.slow = avg > 28 ? perf.slow + 1 : 0;
  perf.fast = avg < 18 ? perf.fast + 1 : 0;
  if (perf.slow >= 2) {
    const lo = lowerQuality(quality);
    if (lo) { setQuality(lo); perf.downed = true; }
    perf.slow = 0;
  } else if (perf.fast >= 8 && !perf.downed) {
    const hi = higherQuality(quality);
    if (hi) setQuality(hi);
    perf.fast = 0;
  }
}
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
// the causeway decks between the islands, streamed on their own (R29)
const causeways = new Causeways(scene);
scenery.night = nightLights;
// the island's hospitals, prison, repair shops, depot and police pier,
// signed on the buildings the city bakes (G16)
const landmarkLayer = new LandmarkLayer(scene);
landmarkLayer.night = nightLights;

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
/** the station the train was heading for last frame: when that changes
 * without a stop, the train rolled past it (G6) */
let stationAim: { x: number; z: number } | null = null;
const stationIcon = V.kind === 'rail' ? makeIconSprite(GOAL_ICON.station, 3.4) : null;
// (the pirate mode: the treasure's icon floats high over its islet, G15)
const treasureIcon = MODE.pirate ? makeIconSprite(GOAL_ICON.treasure, 4.2) : null;
if (treasureIcon) { treasureIcon.visible = false; scene.add(treasureIcon); }
if (stationIcon) { stationIcon.visible = false; scene.add(stationIcon); }
const transit = new Transit(scene);
transit.night = nightLights;

// dev probe: ?debugsea=1 exposes scene handles for verification
if (q.get('debugsea') === '1') {
  const v = new THREE.Vector3();
  (window as unknown as { __dbg: unknown }).__dbg = {
    /** the time of day now (G10) */
    day: () => day,
    causeways,
    get audio() { return audio; },
    get sound() { return sound; },
    get narrator() { return narrator; },
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
    /** the pirate mode: its ships, and the treasure a map has marked */
    pirates: () => pirates,
    treasure: () => treasure,
    robberInSight,
    /** the island's landmarks (G16), city-local */
    landmarks: () => landmarksFor(curCity.bx, curCity.by),
    curCity: () => curCity,
    /** the platforms' passengers */
    boarding: () => boarding.list(),
    stationState: () => ({ done: stationDone, aim: stationAim, next: V.kind === 'rail' ? nextStation() : null }),
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
// the game clock (G10): an hour hand going round a 12-hour face, a sun on
// the face by day and the moon (in tonight's phase) by night; the face
// darkens with the sky
const clockEls = {
  hand: document.getElementById('clockHand')!, face: document.getElementById('clockFace')!,
  ticks: document.getElementById('clockTicks')!, sun: document.getElementById('clockSun')!,
  moon: document.getElementById('clockMoon')!, shade: document.getElementById('clockMoonShade')!,
};
let clockShown = '';
const mixHex = (a: number, b: number, f: number): string => '#' + new THREE.Color(a).lerp(new THREE.Color(b), f).getHexString();
function updateClock(): void {
  const hour = hourOf(day.phase);
  const deg = ((hour % 12) / 12) * 360;
  const isNight = day.night > 0.5;
  // (only when something shows a change: 0.5 deg of the hand, the sky's shade)
  const key = `${deg.toFixed(1)}|${isNight}|${day.moonPhase}|${Math.round(day.night * 20)}`;
  if (key === clockShown) return;
  clockShown = key;
  clockEls.hand.setAttribute('transform', `rotate(${deg.toFixed(1)} 50 50)`);
  const face = mixHex(0xdff1fb, 0x2a3a66, day.night);
  clockEls.face.setAttribute('fill', face);
  clockEls.ticks.setAttribute('stroke', mixHex(0x4a5058, 0xcfd8f0, day.night));
  clockEls.shade.setAttribute('fill', face);
  clockEls.sun.style.display = isNight ? 'none' : '';
  clockEls.moon.style.display = isNight ? '' : 'none';
  // the moon's lit part: waxing lights the right (the shade slides left), waning the left
  const p = day.moonPhase, lit = (1 - Math.cos((2 * Math.PI * p) / MOON_PHASES)) / 2;
  clockEls.shade.setAttribute('cx', ((p <= MOON_PHASES / 2 ? -1 : 1) * 19 * lit).toFixed(1));
}
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
      ...(pirates?.ships ?? []).filter(s => s.active).map(s => ({ x: s.x, z: s.z, icon: GOAL_ICON[s.kind] })),
      ...(treasure ? [{ x: curCity.ox + treasure.islet.x, z: curCity.oz + treasure.islet.z, icon: GOAL_ICON.treasure }] : []),
      ...(cargo && dest ? [{ x: dest.door.x + dest.ox, z: dest.door.z + dest.oz, icon: LANDMARK_ICON[dest.kind] }] : []),
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
/** the pirate mode (G15): the ships to catch on this island, the treasure
 * maps won and the islet whose treasure the next one marks */
const pirates = MODE.pirate ? new Pirates(scene) : null;
let maps = 0;
let treasure: { bx: number; by: number; k: number; islet: Islet } | null = null;
/** islets already dug, per island ("bx,by,k") */
const dug = new Set<string>();
let pirateCount = 0;
/** the islet the next map marks: the nearest one of this island not dug yet */
function markTreasure(c: CityRef): void {
  if (!pirates || treasure || maps <= 0) return;
  const list = isletsFor(c.bx, c.by);
  let best = -1, bd = Infinity;
  list.forEach((I, k) => {
    if (dug.has(`${c.bx},${c.by},${k}`)) return;
    const d = Math.hypot(c.ox + I.x - player.state.x, c.oz + I.z - player.state.z);
    if (d < bd) { bd = d; best = k; }
  });
  // (every islet here dug: they're all full again)
  if (best < 0 && list.length) { for (let k = 0; k < list.length; k++) dug.delete(`${c.bx},${c.by},${k}`); best = 0; }
  if (best < 0) return;
  treasure = { bx: c.bx, by: c.by, k: best, islet: list[best] };
  scenery.showTreasure(c.bx, c.by, best, true);
}
/** put getaway car k on the run on island c, away from the others */
const newRobber = (k: number, c: CityRef): void => {
  const others = robbers.filter((o, j) => j !== k && o.active).map(o => ({ x: o.x, z: o.z }));
  robbers[k].spawn(c.bx, c.by, c.ox, c.oz, player.state.x, player.state.z, citySeed(c.bx, c.by) + 7919 * ++robberCount, others, islands.carsNear(c.ox + ISLAND / 2, c.oz + ISLAND / 2, ISLAND));
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
  landmarkLayer.ensure(c.bx, c.by, c.ox, c.oz);
  minimap.setCity(c.bx, c.by, c.ox, c.oz);
  missions.setCity(c.bx, c.by, c.ox, c.oz);
  boarding.setCity(c.bx, c.by, c.ox, c.oz);
  for (const r of robbers) r.hide();
  robbers.forEach((_, k) => newRobber(k, c));
  // (the pirate mode: this island's ships put out; a treasure marked on the
  // island left behind moves to one here)
  if (pirates) {
    pirates.start(c.bx, c.by, player.state.x, player.state.z, citySeed(c.bx, c.by) + ++pirateCount);
    if (treasure && (treasure.bx !== c.bx || treasure.by !== c.by)) { scenery.showTreasure(treasure.bx, treasure.by, treasure.k, false); treasure = null; }
    markTreasure(c);
  }
  const s = modeSpawn(c.bx, c.by);
  spawn = { x: s.x + c.ox, z: s.z + c.oz, heading: s.heading };
  course?.start(c, player.state.x, player.state.z, player.state.heading);
  stationDone = null;
  stationAim = null;
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
  sound.event('star');
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

// ---- deliveries (G16): a pickup rides in the vehicle to its place — the
// patient to a hospital, the thief to the prison, the broken-down car to a
// repair shop, a full load of trash to the depot, the pirates to the police
// pier. While there's cargo the other calls wait. ----
type CargoKind = 'patient' | 'thief' | 'car' | 'crew' | 'trash';
const CARGO_TO: Record<CargoKind, LandmarkKind> = { patient: 'hospital', thief: 'prison', car: 'repair', crew: 'pier', trash: 'depot' };
const CARGO_ICON: Record<CargoKind, string> = { patient: '🤕', thief: '🦹', car: '🚗', crew: '🏴‍☠️', trash: '🗑️' };
let cargo: { kind: CargoKind; model?: string } | null = null;
/** the garbage truck's load: full after TRASH_FULL stops */
const TRASH_FULL = 3;
let trashLoad = 0;
/** where the cargo goes: the nearest place of its kind (checked every second) */
let dest: ReturnType<typeof nearestLandmark> = null;
let destCheck = 0;
const handover = new Handover(scene);
/** the place's icon floating over it, and its light pillar */
const destIcons = new Map<LandmarkKind, THREE.Sprite>();
const destBeacon = makeBeacon(0x6fe08a);
destBeacon.visible = false;
scene.add(destBeacon);
const cargoEl = document.getElementById('cargo')!;
const cargoIconEl = document.getElementById('cargoIcon')!;
const cargoFillEl = document.getElementById('cargoFill')!;
/** the HUD chip beside the badge: what's on board (and how full) */
function showCargo(icon: string | null, fill = 1): void {
  cargoEl.classList.toggle('on', !!icon);
  cargoIconEl.textContent = icon ?? '';
  cargoFillEl.style.width = `${Math.round(Math.min(1, fill) * 100)}%`;
}
/** take a pickup on board: the guide now points at its place */
function load(kind: CargoKind, model?: string): void {
  cargo = { kind, model };
  dest = null;
  destCheck = 0;
  showCargo(CARGO_ICON[kind]);
  toast = '';
  if (kind === 'car' && MODE.id === 'tow') carryCar(model);
  narrator.say('toDest', CARGO_TO[kind]);
}
/** the world point where the kid hands the cargo over (and, for the
 * helicopter, the deck height) */
function destPoint(): { x: number; z: number; y: number; pad: boolean } | null {
  if (!dest) return null;
  const pad = V.kind === 'heli' && dest.kind === 'hospital' ? landmarkLayer.padOf(dest.bx, dest.by, dest) : null;
  if (pad) return { x: pad.x, z: pad.z, y: pad.y, pad: true };
  return { x: dest.door.x + dest.ox, z: dest.door.z + dest.oz, y: 0, pad: false };
}
// the work trucks' amber beacon on the cab roof, flashing while there's a
// load on board (G17: a work truck's own, not an emergency light bar)
const workBeacon = MODE.id === 'tow' || MODE.calls.includes('trash') ? new THREE.Mesh(
  new THREE.BoxGeometry(0.8, 0.2, 0.3), new THREE.MeshBasicMaterial({ color: 0x6b4410 })) : null;
if (workBeacon) {
  workBeacon.userData.extra = true;
  workBeacon.position.set(0, 2.9, MODE.id === 'tow' ? 2.2 : 2.4);
  player.car.add(workBeacon);
}
/** the broken-down car riding on the tow truck's bed (G17) */
let carried: THREE.Object3D | null = null;
let carriedFrom: THREE.Vector3 | null = null;
function carryCar(model: string | undefined): void {
  const tpl = model ? bakedModel(model) : null;
  const g = new THREE.Group();
  if (tpl) {
    const m = templateToMesh(tpl);
    m.scale.setScalar(3.7 / Math.max(tpl.size.x, tpl.size.z));
    m.castShadow = true;
    g.add(m);
  } else g.add(new THREE.Mesh(new THREE.BoxGeometry(1.7, 1.2, 3.6), new THREE.MeshLambertMaterial({ color: 0x7fb2d9 })));
  g.position.set(0, 1.05, -1.55);
  g.userData.extra = true;
  player.car.add(g);
  carried = g;
}
/** handing over: the kid stopped at the place */
let handing: { kind: LandmarkKind; y: number; pad: boolean } | null = null;
let handDoor: { x: number; z: number } | null = null;
let handT = 0;
function startHandover(): void {
  if (!cargo || !dest) return;
  const p = destPoint()!, st = player.state, kind = dest.kind;
  mode = 'activity';
  st.v = 0;
  handT = 0;
  // from the vehicle's kerb side (or the helipad) to the building's door
  const lot = dest.lot;
  const nx = lot ? Math.sin(lot.ry) : 0, nz = lot ? Math.cos(lot.ry) : 0;
  const door = lot
    ? { x: dest.ox + lot.x + nx * (lot.d / 2 - 1.2), z: dest.oz + lot.z + nz * (lot.d / 2 - 1.2) }
    : { x: dest.ox + dest.x - Math.sin(dest.door.heading) * 12, z: dest.oz + dest.z - Math.cos(dest.door.heading) * 12 };
  const side = { x: st.x - Math.cos(st.heading) * (V.halfW + 0.9), z: st.z + Math.sin(st.heading) * (V.halfW + 0.9) };
  const seed = citySeed(dest.bx, dest.by) + runStars;
  if (p.pad) handover.start(kind, { x: p.x, z: p.z }, { x: p.x - nx * 4, z: p.z - nz * 4 }, p.y, seed);
  else if (V.kind === 'boat') handover.start(kind, { x: dest.ox + dest.x, z: dest.oz + dest.z }, door, 0.55, seed);
  else handover.start(kind, side, door, 0, seed);
  handing = { kind, y: p.y, pad: p.pad };
  // (the depot: the whole load tumbles out behind the truck)
  if (kind === 'depot') {
    audio.sceneShot('truck-dump');
    const back = new THREE.Vector3(st.x - Math.sin(st.heading) * 4, 1.2, st.z - Math.cos(st.heading) * 4);
    for (let k = 0; k < 3; k++) particles.burstConfetti(back);
  }
  if (kind === 'prison') audio.sceneShot('jail-door', 0.8);
  // (the repair shop: the car rolls off the bed and in through its door)
  if (carried) { scene.attach(carried); carriedFrom = carried.position.clone(); handDoor = door; }
  narrator.say('arrive');
}
function finishHandover(): void {
  if (!handing) return;
  const kind = handing.kind;
  handing = null;
  if (kind === 'depot') trashLoad = 0;
  if (carried) { carried.removeFromParent(); carried = null; carriedFrom = null; }
  cargo = null;
  dest = null;
  showCargo(null);
  mode = 'drive';
  sound.event('missionDone');
  narrator.say('delivered', kind);
  earnStar(tr(`deliver.done.${kind}` as Key), player.car.position.clone());
}
const clock = new THREE.Clock();
let statTime = 0, elapsed = 0;
let day = dayState(0, START_PHASE, MOON_BASE);

/** the scene for a call: hose (fires), ladders (cats, burning buildings),
 * the stretcher run (ambulance) or the winch (medical helicopter) — each
 * showing the very thing the call showed in the city (its `look`) */
function sceneFor(o: Objective): Activity {
  const look = o.look;
  if (o.type === 'fire') return new HoseActivity(o.seed, o.variant as FireVariant, look);
  if (o.type === 'cat') return new CatLadderActivity(o.seed, o.variant as CatVariant, look);
  if (o.type === 'rescue') return new RescueLadderActivity(o.seed, look);
  if (o.type === 'breakdown') return new TowActivity(o.seed, look);
  if (o.type === 'trash') return new BinsActivity(o.seed, look);
  return V.kind === 'heli' ? new WinchActivity(o.seed, look, (q.get('variant') as WinchVariant | null) ?? undefined) : new RunActivity(o.seed, look);
}

/** a `look` from a kit template's name (the ?scene= dev path) */
function lookFromName(name: string | null): CallLook | undefined {
  if (!name) return undefined;
  const kind = name.startsWith('car-') ? 'car' : name.startsWith('tree-') ? 'tree' : 'building';
  return { kind, model: name };
}

/** a scene's moment: its sound, and now and then a word from the narrator */
let heartsSaid = false;
function sceneCue(c: SceneCue): void {
  switch (c) {
    case 'hit': audio.sceneShot('sizzle', 0.8); break;
    case 'out': audio.sceneShot('sizzle'); audio.ding(); narrator.say('gate'); break;
    case 'pop': narrator.say('flame'); break;
    case 'last': narrator.say('gateLast'); break;
    case 'meow': audio.sceneShot('meow'); break;
    case 'catMoved': audio.sceneShot('meow'); narrator.say('catMoved'); break;
    case 'aboard': audio.star(); narrator.say('hold'); break;
    case 'safe': audio.star(); break;
    case 'cheer': audio.sceneShot('crowd-cheer', 0.8); break;
    case 'heart':
      audio.sceneShot('heart');
      if (!heartsSaid) { heartsSaid = true; narrator.say('hearts'); }
      break;
    case 'bump': audio.thud(); break;
    case 'bark': audio.sceneShot('dog-bark'); audio.thud(); break;
    case 'doors': audio.doorChime(); break;
    case 'caught': break; // (the win's cheer says it)
    case 'cuffs': audio.sceneShot('cuffs'); break;
    case 'flutter': audio.sceneShot('pigeons', 0.7); break;
    case 'escaped': audio.boing(); narrator.say('dashed'); break;
    case 'cannon': audio.sceneShot('cannon'); break;
    case 'splash': sound.event('splash'); break;
    case 'woodHit': audio.sceneShot('wood-hit'); narrator.say('shipHit'); break;
    case 'sink': sound.event('splash'); break;
    case 'surrender': audio.star(); break;
    case 'map': audio.star(); audio.sceneShot('parrot', 0.8); break;
    case 'beep': audio.sceneShot('beep'); break;
    case 'dig': audio.sceneShot('dig'); break;
    case 'coins': audio.sceneShot('coins'); break;
    case 'clank': audio.sceneShot('ramp-clank'); break;
    case 'strap': audio.sceneShot('strap-click'); audio.star(); break;
    case 'drift': narrator.say('towCentre'); break;
    case 'tip': audio.sceneShot('bin-tip'); narrator.say('bin'); break;
    case 'binSet': audio.sceneShot('bin-set', 0.7); break;
  }
}

/** fade into a call's scene; when it's done the call is answered */
function openCall(o: Objective): void {
  narrator.say('arrive');
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
    } else if (o.type === 'trash') {
      // (the truck fills up a third at every stop; full, it goes to the
      // recycling depot — G16, G17)
      trashLoad++;
      earnStar(tr('call.binsEmptied'), player.car.position.clone());
      if (trashLoad >= TRASH_FULL) load('trash');
      else showCargo(CARGO_ICON.trash, trashLoad / TRASH_FULL);
    } else if (o.type === 'breakdown') {
      // (the car rides on the flatbed to a repair shop, G16)
      load('car', o.look?.model);
    } else {
      // (the patient rides to a hospital: the star comes with the handover, G16)
      load('patient');
    }
    saveTotals(totals);
    updateMissionPanel();
    particles.burstConfetti(player.car.position);
    missions.cooldown = 3;
    activeCall = null;
    mode = 'drive';
  }, () => {
    // (won: the jingle and the cheering now, over the scene's celebration)
    sound.event('missionDone');
    narrator.say('praise');
  });
}

// ?scene=fire|cat|rescue|patient[&variant=..]: open that mission scene at once
// (dev/verification — every scene can be looked at without driving there)
{
  const sq = q.get('scene');
  if (sq === 'battle' || sq === 'merchant' || sq === 'dig') {
    mode = 'activity';
    const ss = Number(q.get('sceneSeed') ?? 1);
    director.start(() => (sq === 'dig' ? new DigActivity(ss) : new BattleActivity(ss, sq === 'battle' ? 'pirate' : 'merchant')), () => { mode = 'drive'; });
  }
  if (sq === 'caught') {
    mode = 'activity';
    director.start(() => new ChaseActivity(Number(q.get('sceneSeed') ?? 1), V.kind === 'heli'), () => { mode = 'drive'; });
  }
  if (sq === 'fire' || sq === 'cat' || sq === 'rescue' || sq === 'patient' || sq === 'tow' || sq === 'bins') {
    const o = missions.objectives[0] ?? null;
    const fake = {
      ...(o ?? {}), type: sq === 'tow' ? 'breakdown' : sq === 'bins' ? 'trash' : sq, variant: q.get('variant') ?? (sq === 'fire' ? 'house' : 'tree'),
      // (&look=house-c | bldg-f | car-taxi | tree-oak: the thing the call showed)
      look: lookFromName(q.get('look')),
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
  timeFrame();
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
      sound.event('crash'); narrator.say('oops');
      Object.assign(player.crash, crumbs.pickResume(st.x, st.z, st.heading, boxes, spawn));
    }
    const ring = course?.aim(st.x, st.z, st.heading);
    const step = physicsStep(player, input, dt, boxes, ring ? ring.y - 2 : PLANE_ALT);
    if (step.crashed) {
      sound.event('crash'); narrator.say('oops');
      toast = '';
      // (road vehicles resume on a breadcrumb; the helicopter picked its
      // spot itself, just back along its path)
      if (V.kind === 'ground') Object.assign(player.crash, race && race.offTrack(st.x, st.z) < 40 ? race.resumeSpot() : crumbs.pickResume(st.x, st.z, st.heading, boxes, spawn));
      // (the boat: on clear water behind it — G14)
      else if (V.kind === 'boat') Object.assign(player.crash, boatResume(boxes));
    } else if (!wasCrashing && V.kind === 'boat' && mode === 'drive') {
      seaCrumbs.record(dt, st.x, st.z, st.heading, st.v, (x, z) => seaClear(x, z, boxes));
      // stuck (gas held 3 s and it went nowhere — wedged against a pier or a
      // shore): the same flash and resume on clear water as a crash (G1)
      stuck.t += dt;
      stuck.gas &&= input.gas > 0.1;
      if (stuck.t >= 3) {
        if (stuck.gas && Math.hypot(st.x - stuck.x, st.z - stuck.z) < 1) {
          startCrash(player);
          sound.event('crash'); narrator.say('oops');
          Object.assign(player.crash, boatResume(boxes));
        }
        Object.assign(stuck, { t: 0, x: st.x, z: st.z, gas: true });
      }
      // the island's boats are solid (G14): running into one above 1.4 m/s
      // is a crash — a flash, and the boat resumes on clear water behind;
      // a nudge only pushes the two apart
      const me = { x: st.x, z: st.z, h: st.heading, hl: BOAT_HL, hw: V.halfW };
      for (const b of islands.boatsNear(st.x, st.z, 30)) {
        const d = overlapDepth(me, { x: b.x, z: b.z, h: b.h, hl: b.hl, hw: b.hw });
        if (d <= 0) continue;
        if (Math.abs(st.v) > 1.4) {
          startCrash(player);
          sound.event('crash'); sound.event('bumpCar'); narrator.say('oops');
          toast = '';
          Object.assign(player.crash, boatResume(boxes));
        } else {
          const dx = st.x - b.x, dz = st.z - b.z, l = Math.hypot(dx, dz) || 1;
          st.x += (dx / l) * Math.min(d, 0.5); st.z += (dz / l) * Math.min(d, 0.5);
          st.v *= 0.5;
        }
        break;
      }
      // (the ships the pirate chases: pushed apart, never sailed through)
      for (const b of pirates?.footprints() ?? []) {
        const d = overlapDepth(me, b);
        if (d <= 0) continue;
        const dx = st.x - b.x, dz = st.z - b.z, l = Math.hypot(dx, dz) || 1;
        st.x += (dx / l) * Math.min(d, 0.6); st.z += (dz / l) * Math.min(d, 0.6);
        st.v *= 0.6;
      }
    } else if (!wasCrashing && V.kind === 'ground' && mode === 'drive') {
      crumbs.record(dt, st.x, st.z, st.heading, st.v, boxes);
      // stuck detector: gas held the whole window yet the truck went nowhere
      // (wedged against something the crash test forgives) -> same resume
      stuck.t += dt;
      stuck.gas &&= input.gas > 0.1;
      if (stuck.t >= 3) {
        if (stuck.gas && Math.hypot(st.x - stuck.x, st.z - stuck.z) < 1) {
          startCrash(player);
          sound.event('crash'); narrator.say('oops');
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
    if (ev.go) { raceMsg = tr('race.go'); raceMsgT = 1.5; particles.burstConfetti(at); sound.event('go'); }
    if (ev.lap) { raceMsg = ev.lap === LAPS ? tr('race.lastLap') : tr('race.lapN', { n: ev.lap }); raceMsgT = 2; sound.event('lap'); if (ev.lap === LAPS) narrator.say('lastLap'); }
    raceMsgT -= dt;
    if (ev.finished) {
      const place = ev.finished;
      sound.event('finish');
      narrator.say('place', place);
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

  // the pirates (G15): the ships sail and run; staying close to one catches
  // it and its battle opens; a map marks a treasure islet, and stopping
  // beside it opens the dig
  if (pirates) {
    pirates.update(dt, elapsed, st.x, st.z, director.busy);
    setFleetThreat(mode === 'drive' ? { x: st.x, z: st.z } : null);
    for (const s of pirates.ships) {
      if (!s.active || mode !== 'drive' || player.crashT > 0) continue;
      const d = Math.hypot(s.x - st.x, s.z - st.z);
      // (a ship in sight: the narrator calls it, and the parrot squawks)
      if (d < 150 && s.caught === 0 && !s.seen) { s.seen = true; narrator.say('shipSpotted'); audio.sceneShot('parrot', 0.6); }
      if (d < SHIP_CATCH_R && s.bolt <= 0) s.caught += dt;
      if (s.caught >= SHIP_CATCH_T) {
        const ship: Ship = s;
        mode = 'activity';
        ship.group.visible = ship.icon.visible = false;
        narrator.say('battle');
        director.start(() => new BattleActivity(citySeed(curCity.bx, curCity.by) + ++pirateCount, ship.kind === 'rival' ? 'pirate' : 'merchant'), won => {
          mode = 'drive';
          if (!won) { pirates.escaped(ship); return; }
          pirates.beaten(ship);
          maps++;
          earnStar(tr('pirate.map'), player.car.position.clone());
          narrator.say('treasureMap');
          markTreasure(curCity);
        }, () => narrator.say(ship.kind === 'rival' ? 'sunk' : 'surrender'));
        break;
      }
    }
    // the treasure: stop beside its islet and the dig opens
    if (treasure && mode === 'drive' && player.crashT <= 0) {
      const I = treasure.islet, T = treasure;
      const d = Math.hypot(curCity.ox + I.x - st.x, curCity.oz + I.z - st.z);
      if (d < I.r + 26 && Math.abs(st.v) < 3) {
        mode = 'activity';
        narrator.say('dig');
        director.start(() => new DigActivity(citySeed(T.bx, T.by) + T.k * 101 + ++pirateCount), won => {
          mode = 'drive';
          if (!won) return;
          dug.add(`${T.bx},${T.by},${T.k}`);
          scenery.showTreasure(T.bx, T.by, T.k, false);
          treasure = null;
          maps = Math.max(0, maps - 1);
          earnStar(tr('pirate.treasure'), player.car.position.clone());
          markTreasure(curCity);
        }, () => narrator.say('treasure'));
      }
    }
  }

  // the robber chase: the police car stays close, the helicopter keeps the
  // getaway car in its searchlight — CATCH_T seconds in all and it's caught
  // (each keeps its own progress; a caught one is replaced 3 s after its scene)
  robbers.forEach((rb, k) => {
    if (rb.active) {
      rb.update(dt, elapsed, st.x, st.z, director.busy, islands.carsNear(rb.x, rb.z, 40), islands.walkersNear(rb.x, rb.z, 20), railway);
      const lit = V.kind === 'heli'
        ? Math.hypot(rb.x - (st.x + Math.sin(st.heading) * SPOT_AHEAD), rb.z - (st.z + Math.cos(st.heading) * SPOT_AHEAD)) < SPOT_R + SPOT_GRACE
        : Math.hypot(rb.x - st.x, rb.z - st.z) < CATCH_R;
      // (no catching while it dashes: that's it shaking the police off)
      if (lit && mode === 'drive' && player.crashT <= 0 && rb.dashT <= 0 && !cargo) {
        // (halfway to caught: "almost! don't let him get away!")
        if (rb.caught < CATCH_T / 2 && rb.caught + dt >= CATCH_T / 2) narrator.say('closing');
        rb.caught += dt;
      }
      // (caught in the searchlight, the getaway car bolts — as a bump by the
      // police car sets it off, G7)
      if (V.kind === 'heli' && rb.spotted(lit && mode === 'drive', dt)) narrator.say('dashed');
      if (rb.caught >= CATCH_T && mode === 'drive' && !cargo) {
        rb.hide();
        mode = 'activity';
        const seed = robberCount + k;
        narrator.say('chaseRun');
        director.start(() => new ChaseActivity(seed, V.kind === 'heli'), won => {
          mode = 'drive';
          // (got away in the scene: the chase goes on, it dashing off)
          if (!won) { rb.escape(); return; }
          earnStar(tr('chase.caught'), player.car.position.clone());
          robberWait[k] = 3;
          // (the police car takes the thief to the prison, G16)
          if (V.kind === 'ground') load('thief');
        }, () => narrator.say('caught'));
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
    const eye = cabEye();
    camera.position.set(st.x + fwd.x * eye.f, flyY + eye.y, st.z + fwd.z * eye.f);
    camera.lookAt(st.x + fwd.x * 25, flyY + 1.4, st.z + fwd.z * 25);
  } else if (camMode === 'high') {
    // higher chase angle: the whole truck plus more of the street around it
    const desired = new THREE.Vector3(st.x - fwd.x * V.highBack, flyY + V.highUp, st.z - fwd.z * V.highBack);
    camera.position.lerp(desired, Math.min(1, dt * 4));
    camera.lookAt(st.x + fwd.x * V.highAhead, flyY + 0.9, st.z + fwd.z * V.highAhead);
  } else {
    const desired = new THREE.Vector3(st.x - fwd.x * V.camBack, flyY + V.camUp, st.z - fwd.z * V.camBack);
    camera.position.lerp(desired, Math.min(1, dt * 4));
    camera.lookAt(st.x + fwd.x * V.camAhead, flyY + 1.3, st.z + fwd.z * V.camAhead);
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
  causeways.update(st.x, st.z);

  // ambient life: the trains, the sea with its boats and the patrol
  // helicopter; the river is a shallow ford — splash through it slowly
  // every awake island: trains, cars, people, boats (people only scatter
  // from vehicles on the ground)
  // (the sea's boats are drawn only near the player, G14)
  setFleetViewer({ x: st.x, z: st.z });
  islands.update(dt, elapsed, player.car.position, V.kind === 'ground'
    ? { x: st.x, z: st.z, heading: st.heading, v: st.v, halfL: V.glbLen / 2, halfW: V.halfW }
    : null, robbers.map(r => r.chaser()).filter((c): c is NonNullable<typeof c> => !!c));
  // nobody drives through anybody: the island's cars push a road vehicle
  // out of their footprint (G8)
  if (V.kind === 'ground') {
    const push = islands.bump(st.x, st.z, V.radius + 0.3);
    if (push) {
      st.x += push.dx; st.z += push.dz;
      if (Math.abs(st.v) > 2) sound.event('bumpCar');
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
      if (hit.dashed) { st.v *= 0.5; audio.thud(); sound.event('bumpCar'); narrator.say('dashed'); }
      else st.v *= 1 - Math.min(0.5, dt * 3);
    }
  }
  railway.update(dt, elapsed, st.x, st.z);
  boarding.update(dt, elapsed, railway, curCity.bx, curCity.by);
  transit.update(dt, elapsed, railway);
  sea.update(elapsed);
  scenery.update(elapsed, day.night);
  landmarkLayer.update(day.night, st.x, st.z);
  patrol?.update(dt, elapsed, st.x, st.z);
  if (V.kind === 'ground' && st.alt < 0.3 && river.inWater(st.x - curCity.ox, st.z - curCity.oz)) {
    st.v *= 1 - Math.min(0.5, dt * 1.6);
    splashTimer -= dt;
    if (Math.abs(st.v) > 1.5 && splashTimer <= 0) {
      splashTimer = 0.1;
      particles.splash(new THREE.Vector3(st.x, 0.25, st.z));
      if (Math.random() < 0.08) sound.event('splash');
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
  const view = director.update(dt, elapsed, { steer: Math.max(-1, Math.min(1, aimIn)), night: day.night });
  // (the scene's moments: their sounds and words)
  const act = director.activity;
  if (act) { for (const c of act.cues) sceneCue(c); act.cues.length = 0; }
  // (halfway through a mission's scene: "almost there!")
  if (!view.scene) saidAlmost = false;
  else if (activeCall && director.playing && !saidAlmost && view.progress >= 0.55 && view.progress < 0.95) { saidAlmost = true; narrator.say('almost'); }
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
    const fresh = missions.objectives[missions.objectives.length - 1];
    if (fresh) narrator.say('call', fresh.type);
  }
  const { o: near, d: nd } = missions.nearest(st.x, st.z);
  // the medical helicopter's winch reels in unless it's lifting someone
  if (winch && !(near && near.type === 'patient' && nd < 9)) winch.update(dt, 1.2, V.scale ?? 1);
  // (the calls' flames, smoke and people)
  missions.update(dt, camera, day.night);
  for (const o of missions.objectives) {
    if (!o.marker) continue;
    // hover the call's icon over it; the tall beacon pillar does the
    // long-range finding (it shows over the rooftops, fog or not)
    const busy = activeCall === o;
    o.marker.visible = !busy;
    // (waiting while a pickup is on board: dimmed, G16)
    (o.marker as THREE.Sprite).material.opacity = cargo ? 0.45 : 1;
    o.marker.position.y = 5.4 + Math.sin(elapsed * 2 + o.index) * 0.5;
    pulseBeacon(o.beacon, elapsed, o.index, busy ? 0 : o.d);
    if (cargo) (o.beacon.material as THREE.MeshBasicMaterial).opacity *= 0.35;
  }
  // the course gate / station the mode is heading for (when it has one)
  const gate = course?.target ?? null;
  const station = V.kind === 'rail' ? nextStation() : null;
  // (the next station floats its icon over the stop point)
  if (stationIcon) {
    stationIcon.visible = !!station && mode === 'drive';
    if (station) stationIcon.position.set(station.x, 7 + Math.sin(elapsed * 2) * 0.4, station.z);
  }
  // (a pickup on board: its place, the nearest of its kind, is the goal)
  if (cargo && !handing) {
    destCheck -= dt;
    if (destCheck <= 0 || !dest) { destCheck = 1; dest = nearestLandmark(CARGO_TO[cargo.kind], st.x, st.z, curCity.bx, curCity.by); }
  }
  const dp = cargo ? destPoint() : null;
  for (const [k, spr] of destIcons) spr.visible = !!dp && dest?.kind === k && !handing && mode === 'drive';
  if (dp && dest) {
    let spr = destIcons.get(dest.kind);
    if (!spr) { spr = makeIconSprite(LANDMARK_ICON[dest.kind], 4.2); scene.add(spr); destIcons.set(dest.kind, spr); }
    spr.visible = !handing && mode === 'drive';
    spr.position.set(dp.x, (dp.pad ? dp.y + 7 : 13) + Math.sin(elapsed * 2) * 0.5, dp.z);
    destBeacon.position.set(dp.x, dp.pad ? dp.y : 0, dp.z);
    pulseBeacon(destBeacon, elapsed, 7, handing ? 0 : Math.hypot(dp.x - st.x, dp.z - st.z));
  } else destBeacon.visible = false;
  const robber = cargo ? null : nearestRobber(st.x, st.z);
  // (the pirate mode: the marked treasure islet, else the nearest ship)
  const ship = pirates && !treasure ? pirates.nearest(st.x, st.z) : null;
  const trove = treasure ? { x: curCity.ox + treasure.islet.x, z: curCity.oz + treasure.islet.z } : null;
  if (treasureIcon) {
    treasureIcon.visible = !!trove && mode === 'drive';
    if (trove) treasureIcon.position.set(trove.x, 14 + Math.sin(elapsed * 2) * 0.5, trove.z);
  }
  const goal = dp ? { x: dp.x, z: dp.z } : robber ? { x: robber.x, z: robber.z } : trove ?? (ship ? { x: ship.x, z: ship.z } : null) ?? (gate ? { x: gate.x, z: gate.z } : station ? { x: station.x, z: station.z }
    : near ? { x: near.pos.x, z: near.pos.z } : null);
  // (the train's goal is along its track: the metres the badge shows, and
  // where the arrow points — at the track ahead)
  const onRails = !dp && !robber && !gate && !!station;
  const goalD = onRails ? station!.gap : goal ? Math.hypot(goal.x - st.x, goal.z - st.z) : 0;
  // where the guidance points: straight at the goal when flying or close,
  // otherwise at the next junction of the shortest street route
  const way = !goal || mode !== 'drive' ? null
    : onRails ? (railway.kidAhead(Math.min(Math.max(goalD, 8), 40)) ?? guideWaypoint(goal.x, goal.z, goalD))
    : guideWaypoint(goal.x, goal.z, goalD);
  const bearing = way ? Math.atan2(way.x - st.x, way.z - st.z) : null;
  // the arrow: the same size on screen and the same gap over the vehicle's
  // real top (its model, rotor and roof lamps measured — a fixed lift sat
  // it inside the helicopter's rotor), whatever the camera's distance (each
  // vehicle's camera sits at its own: fixed in the world, the arrow was big
  // over one vehicle and small over another)
  {
    if (camMode === 'cab') {
      // (from the cab the vehicle's roof is behind the eye: the arrow floats
      // a few metres ahead of the windscreen instead)
      const eye = cabEye(), f = eye.f + 7;
      _ahead.set(st.x + Math.sin(st.heading) * f, player.car.position.y, st.z + Math.cos(st.heading) * f);
      guideArrow3d.update(dt, elapsed, _ahead, eye.y + 1.1, bearing, 0.55, camera.position);
    } else {
      const top = V.kind === 'rail' ? 4.6 : vehicleTop();
      const size = Math.max(0.7, Math.min(3.2, camera.position.distanceTo(player.car.position) / 14));
      guideArrow3d.update(dt, elapsed, player.car.position, top + 1.6 * size, bearing, size, camera.position);
    }
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
  } else if (handing) {
    // ---- handing the cargo over (the helicopter settles onto the pad) ----
    guideEl.style.opacity = '0';
    promptEl.style.display = 'block';
    promptText.textContent = tr('deliver.handing');
    promptFill.style.width = '100%';
    if (handing.pad) st.alt += (handing.y + 1.7 - st.alt) * Math.min(1, dt * 2.5);
    if (carried && carriedFrom && handDoor) {
      handT += dt;
      const f = Math.min(1, handT / 2.4);
      carried.position.set(carriedFrom.x + (handDoor.x - carriedFrom.x) * f, carriedFrom.y * (1 - Math.min(1, f * 3)), carriedFrom.z + (handDoor.z - carriedFrom.z) * f);
      carried.visible = f < 0.97;
    }
    if (handover.update(dt)) finishHandover();
  } else if (cargo && dp && dest) {
    // ---- a pickup on board: to its place, and stop there ----
    const dd = Math.hypot(dp.x - st.x, dp.z - st.z);
    showGuide(LANDMARK_ICON[dest.kind], dd, Math.max(0, Math.min(5, Math.round(5 * (1 - dd / 400)))));
    promptFill.style.width = '0%';
    const heliMode = V.kind === 'heli', boat = V.kind === 'boat';
    const reach = heliMode ? (dp.pad ? 7 : 9) : boat ? 25 : 12;
    const stopped = heliMode ? Math.abs(st.v) < 4 : boat ? Math.abs(st.v) < 2 : Math.abs(st.v) < 1 && player.crashT <= 0;
    // (stopping by a call that waits: the cargo comes first)
    if (near && nd < (heliMode ? 9 : 15) && stopped && dd > reach) {
      promptText.textContent = tr(`deliver.first.${dest.kind}` as Key);
      narrator.say('first', dest.kind);
    } else {
      promptText.textContent = dd < reach ? tr(heliMode ? (dp.pad ? 'deliver.land' : 'call.hover') : 'call.stop') : tr(`deliver.to.${dest.kind}` as Key);
    }
    if (dd < reach && stopped && mode === 'drive') startHandover();
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
  } else if (trove) {
    // ---- the pirates: sail to the treasure islet and stop beside it ----
    const td = Math.hypot(trove.x - st.x, trove.z - st.z) - (treasure?.islet.r ?? 0);
    showGuide(GOAL_ICON.treasure, Math.max(0, td), Math.max(0, Math.min(5, Math.round(5 * (1 - td / 400)))));
    promptFill.style.width = '0%';
    promptText.textContent = tr(td < 40 ? 'pirate.stopHere' : 'pirate.toTreasure');
  } else if (ship) {
    // ---- the pirates: catch the nearest ship ----
    const sd = Math.hypot(ship.x - st.x, ship.z - st.z);
    showGuide(GOAL_ICON[ship.kind], sd, Math.round((5 * ship.caught) / SHIP_CATCH_T));
    promptFill.style.width = `${Math.min(100, (100 * ship.caught) / SHIP_CATCH_T)}%`;
    promptText.textContent = tr(sd < SHIP_CATCH_R * 1.6 ? 'pirate.close' : 'pirate.hunt');
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
    // (a beep for each number of the countdown; GO beeps higher, on ev.go)
    if (rv.phase === 'countdown' && rv.count > 0 && rv.count !== lastCount) {
      sound.event('countdown');
      if (lastCount < 0) narrator.say('raceCount');
    }
    lastCount = rv.phase === 'countdown' ? rv.count : -1;
    // (the narrator on the places — not in the scramble just after GO)
    if (rv.phase === 'racing') {
      raceT += dt;
      if (raceT > 5 && racePlace > 0 && rv.place !== racePlace) narrator.say(rv.place < racePlace ? 'raceUp' : 'raceDown', rv.place);
      leadT = rv.place === 1 ? leadT + dt : 0;
      if (leadT > 30) { narrator.say('raceLead'); leadT = 0; }
      racePlace = rv.place;
    } else { raceT = 0; racePlace = 0; leadT = 0; }
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
    if (res === 'passed') {
      particles.burstConfetti(new THREE.Vector3(st.x, st.alt + 2, st.z));
      sound.event('gate');
      const left = course.gates.length - course.passedCount;
      narrator.say(left === 1 ? 'gateLast' : left === 2 ? 'gateTwo' : 'gate');
    }
    if (res === 'finished') {
      narrator.say('courseDone');
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
      sound.event('station');
      narrator.say('station');
      earnStar(tr('train.stop'), new THREE.Vector3(st.x, 3, st.z));
      stationDone = { x: station.x, z: station.z };
    }
    // stopping is the kid's job (G6): coming in too fast to stop gently at
    // the board, the narrator says brake; roll past it and the people
    // waiting are cross, no star, and the next station is the goal
    if (gap > 12 && gap < 70 && pose.v * pose.v > 2 * 2 * (gap - 6)) narrator.say('brake');
    if (stationAim && Math.hypot(station.x - stationAim.x, station.z - stationAim.z) > 1
        && !(stationDone && Math.hypot(stationDone.x - stationAim.x, stationDone.z - stationAim.z) < 1)) {
      boarding.grumble(stationAim.x, stationAim.z);
      narrator.say('missed');
      sound.event('missed');
    }
    stationAim = { x: station.x, z: station.z };
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

  // the narrator: the mode's briefing once the voice can be heard (not in
  // the race: its countdown speaks), night falling and the morning, and
  // the sound ducks under whatever it says (G9, G11)
  narrator.tick(dt);
  if (!saidStart && elapsed > 1 && voiceReady()) {
    saidStart = true;
    if (MODE.id !== 'race') narrator.say('start', MODE.id);
    wasNight = day.night > 0.5;
  }
  if (saidStart && (day.night > 0.5) !== wasNight) {
    wasNight = day.night > 0.5;
    narrator.say(wasNight ? 'night' : 'morning');
  }
  if (narrator.talking !== wasTalking) { wasTalking = narrator.talking; audio.duck(wasTalking); }
  // the frame's sound (G11): engine, siren, pump, crossing bells, horns, ambience
  seaCheck -= dt;
  if (seaCheck <= 0) {
    seaCheck = 0.5;
    const cst = coastFor(curCity.bx, curCity.by), lx = st.x - curCity.ox, lz = st.z - curCity.oz;
    seaNear = !cst.inLand(lx, lz, 15) ? 1 : !cst.inLand(lx, lz, 45) ? 0.6 : !cst.inLand(lx, lz, 90) ? 0.25 : 0;
  }
  const trainV = V.kind === 'rail' ? Math.abs(railway.playerPose()?.v ?? 0) : Math.abs(st.v);
  sound.frame(dt, {
    engine: view.scene ? null : ENGINE, speed: trainV / V.maxF, gas: input.gas,
    siren: sirenOn, sirenStyle: SIREN_STYLE, pump: director.pumping,
    x: st.x, z: st.z, heading: st.heading, night: day.night, sea: seaNear,
    crossing: view.scene ? null : transit.nearestWarning(st.x, st.z, railway),
    // (the race: the kid's car sounds like itself, and so does each rival)
    // (the pirate ship creaks: timber, ropes and the waves on its hull, G15)
    engineRec: MODE.id === 'race' ? engineOf(RACE_CAR) : MODE.pirate ? 'ship-creak' : undefined,
    rivals: race ? race.ai.map(k => ({ x: k.group.position.x, z: k.group.position.z, id: engineOf(k.car), speed: k.v / AI_TOP })) : undefined,
  });
  // (a scene's own loops — the ladder's whir, the winch, running feet — and
  // in the city a burning call crackling as the kid comes near it)
  audio.setSceneLoops(view.scene && act ? act.loops : null);
  if (!view.scene) audio.fireNear(missions.fireNear(st.x, st.z));
  audio.setMusic(musicNow(day.night, !!view.scene, dt));
  // (the tracks likely next, fetched ahead: a mission's scene, the chase, the night)
  if (elapsed > 4) {
    if (MODE.calls.length || MODE.pirate) audio.preloadMusic('scene');
    if (MODE.chase) audio.preloadMusic('chase');
    if (MODE.id !== 'race' && !MODE.pirate) audio.preloadMusic(musicNight ? 'day' : 'night');
  }
  {
    // the vehicle's own roof lamps flash when its model has them (the police
    // car, the ambulance, the fire truck); otherwise the game's light bar
    const own = player.car.userData.siren as SirenLamps | null | undefined;
    const phase = Math.floor(elapsed * 5) % 2;
    if (own) {
      // (on: the two beats alternate glowing / dark; off: the model's own
      // paint, or a built-on lamp shows dim)
      sirenBar.group.visible = false;
      for (const [lamps, beat] of [[own.red, 0], [own.blue, 1]] as Array<[THREE.Mesh[], number]>) {
        for (const l of lamps) {
          l.visible = sirenOn || !!l.userData.always;
          (l.material as THREE.MeshBasicMaterial).color.setHex(sirenOn && phase === beat ? l.userData.lit : l.userData.dim);
        }
      }
    } else if (sirenOn) {
      // alternate the light bar: red flash / blue flash
      (sirenBar.red.material as THREE.MeshBasicMaterial).color.setHex(phase === 0 ? 0xff3b30 : 0x4a1616);
      (sirenBar.blue.material as THREE.MeshBasicMaterial).color.setHex(phase === 1 ? 0x3f7bff : 0x161d4a);
    }
  }

  if (workBeacon) {
    const lit = !!cargo && Math.floor(elapsed * 3) % 2 === 0;
    (workBeacon.material as THREE.MeshBasicMaterial).color.setHex(lit ? 0xffb030 : 0x6b4410);
    if (player.car.userData.top && !workBeacon.userData.placed) { workBeacon.position.y = (player.car.userData.top as number) + 0.1; workBeacon.userData.placed = true; }
    if (lit && nightLights.dark) { const p = workBeacon.getWorldPosition(new THREE.Vector3()); nightLights.flash({ x: p.x, y: p.y, z: p.z, color: 0xffb030, size: 2, pool: 0 }); }
  }
  if (player.crashT > 0) {
    promptEl.style.display = 'block';
    promptText.textContent = tr('call.oops');
    promptFill.style.width = '0%';
  }

  updateClock();
  nightLights.fireflies(curCity, st.x, st.z, elapsed);
  nightLights.update(day.night);
  bakedNight.value = day.night;
  setGuideNight(day.night);
  renderer.toneMappingExposure = day.exposure;
  // (at a low graphics quality the city's shadows are drawn every n-th
  // frame — a mission scene's, a small stage, every frame: G13)
  if (!renderer.shadowMap.autoUpdate) renderer.shadowMap.needsUpdate = !!view.scene || ++shadowFrame % TIERS[quality].shadowEvery === 0;
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
    hud.set(tr('city.hud', { bx: curCity.bx, by: curCity.by, mode: tr(`mode.${MODE.id}.title` as Key), kmh, calls: i.calls, tris: i.triangles.toLocaleString(numberLocale()), fps: perf.fps, quality: tr(`settings.quality.${quality}` as Key) }));
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
  // (the deliveries, G16: put a pickup on board / see where it goes)
  (window as unknown as { __dbg: Record<string, unknown> }).__dbg.load = load;
  (window as unknown as { __dbg: Record<string, unknown> }).__dbg.cargo = () => ({ cargo, dest, handing, point: destPoint() });
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
