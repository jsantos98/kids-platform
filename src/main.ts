// The garage — the launcher. One vehicle for each play mode of the island
// world (registry.ts), chosen with the wheel: turn it to glide the cards
// along, press the pedal (or any button) to drive off. The chosen vehicle
// stands on a stage of its own on a little island — a street for the road
// vehicles, rails for the train, a canal for the boat, a helipad, a runway,
// a race track — framed whole whatever its size, turning slowly on the
// spot; its name is shown big (and spoken, for kids who don't read yet).
// Choosing another sends the one there off the way the cards move and
// brings the new one in from the other side, with its own sound. Keys and
// the mouse work too. Choosing the race opens a second row of cards, the
// same way: the race car (raceCars.ts), with a "back" card first.
import * as THREE from 'three';
import { createStage, mat } from './engine/stage.js';
import { spawnVehicle, loadGLB, wheelNodes } from './engine/assets.js';
import { makeHelicopter, makePlane, makeTree, makeConifer, makeCloud } from './kit/index.js';
import { rng } from './engine/rng.js';
import { GAMES, type GameEntry } from './games/registry.js';
import { RACE_CARS, DEFAULT_CAR, engineOf, type RaceCar } from './games/raceCars.js';
import { keysHtml } from './games/keys.js';
import { loadTotals } from './games/city/state.js';
import { t as tr, applyI18n, getLang, setLang, LANGS, type Key } from './i18n/index.js';
import { speak, preloadVoice, speaking } from './i18n/voice.js';
import { GameAudio } from './engine/audio.js';
import { readWheel, wheelHeld, watchWheelActions } from './engine/wheel.js';
import type { SfxId } from './engine/sfxList.js';
import { volume, setVolume, qualityPref, setQualityPref, autoSpeed, setAutoSpeed, type VolumeKey, type QualityPref } from './engine/settings.js';

applyI18n('garage.pageTitle');
preloadVoice();

const PICK_KEY = 'garage.pick';
const CAR_KEY = 'garage.car';
const store = {
  get: (k: string): string => { try { return localStorage.getItem(k) ?? ''; } catch { return ''; } },
  set: (k: string, v: string): void => { try { localStorage.setItem(k, v); } catch { /* private mode */ } },
};

// ---- what the cards show: the play modes, or the race cars ----
type StageKind = 'road' | 'track' | 'rail' | 'canal' | 'helipad' | 'runway';
interface Item {
  /** the list's own id ('back' for the way back) */
  id: string;
  readonly title: string;
  readonly blurb: string;
  color: string;
  /** a card's emoji until its picture is ready (the way back keeps it) */
  icon: string;
  /** the model on the stage (none for the way back) */
  model: GameEntry['model'] | null;
  /** its spoken name, and the line when it's picked (voice.ts clip ids) */
  sayId: string;
  goId: string;
  /** what it stands on, and the sound it makes as it arrives */
  stage: StageKind;
  sound: { id: SfxId; secs: number; gain: number; bus: 'engine' | 'sfx' } | null;
}
const STAGE: Record<string, StageKind> = {
  truck: 'road', police: 'road', ambulance: 'road', tow: 'road', garbage: 'road', heliMedical: 'helipad', heliPolice: 'helipad',
  plane: 'runway', boat: 'canal', policeBoat: 'canal', pirate: 'canal', train: 'rail', race: 'track',
};
const SOUND: Record<string, Item['sound']> = {
  truck: { id: 'siren-fire', secs: 1.1, gain: 0.35, bus: 'sfx' },
  police: { id: 'siren-police', secs: 1.1, gain: 0.35, bus: 'sfx' },
  ambulance: { id: 'siren-ambulance', secs: 1.1, gain: 0.35, bus: 'sfx' },
  tow: { id: 'engine-truck', secs: 1.4, gain: 0.8, bus: 'engine' },
  garbage: { id: 'engine-truck', secs: 1.4, gain: 0.8, bus: 'engine' },
  heliMedical: { id: 'engine-heli', secs: 1.4, gain: 0.8, bus: 'engine' },
  heliPolice: { id: 'engine-heli', secs: 1.4, gain: 0.8, bus: 'engine' },
  plane: { id: 'engine-plane', secs: 1.4, gain: 0.8, bus: 'engine' },
  boat: { id: 'engine-boat', secs: 1.4, gain: 0.8, bus: 'engine' },
  policeBoat: { id: 'siren-police', secs: 1.1, gain: 0.35, bus: 'sfx' },
  pirate: { id: 'ship-creak', secs: 1.8, gain: 0.9, bus: 'engine' },
  train: { id: 'train-horn', secs: 1.4, gain: 0.45, bus: 'sfx' },
  race: { id: 'race-f1', secs: 1.2, gain: 0.7, bus: 'engine' },
};
const RACE = GAMES.find(g => g.id === 'race')!;
const modeItems: Item[] = GAMES.map(g => ({
  id: g.id, get title() { return g.title; }, get blurb() { return g.blurb; }, color: g.color, icon: g.icon,
  model: g.model, sayId: `mode-${g.id}`, goId: `go-${g.id}`, stage: STAGE[g.id] ?? 'road', sound: SOUND[g.id] ?? null,
}));
const carItems: Item[] = [
  { id: 'back', get title() { return tr('cars.back'); }, get blurb() { return tr('cars.backBlurb'); }, color: '#8a93a0',
    icon: '↩', model: null, sayId: 'back', goId: 'back', stage: 'track', sound: null },
  ...RACE_CARS.map((c: RaceCar): Item => ({
    id: c.id, get title() { return tr(`car.${c.id}` as Key); }, get blurb() { return tr('cars.blurb'); }, color: c.color,
    icon: '🏎️', model: { glb: c.glb, len: c.len, yaw: c.yaw }, sayId: `car-${c.id}`, goId: `gocar-${c.id}`,
    stage: 'track', sound: { id: engineOf(c), secs: 1.2, gain: 0.7, bus: 'engine' },
  })),
];

let stage: 'modes' | 'cars' = 'modes';
let list = modeItems;
let sel = Math.max(0, modeItems.findIndex(g => g.id === store.get(PICK_KEY)));

// ---- the scene: a little island, the sea round it; each vehicle's stage on it ----
const scn = createStage({ ground: false, fogNear: 60, fogFar: 260, sunPos: [30, 60, 40], shadowSpan: 30 });
const { scene, camera, renderer } = scn;
const sea = new THREE.Mesh(new THREE.CircleGeometry(400, 64), mat(0x7cc6e0));
sea.rotation.x = -Math.PI / 2;
sea.position.y = -0.6;
scene.add(sea);
const beach = new THREE.Mesh(new THREE.CylinderGeometry(24, 25.5, 0.9, 56), mat(0xf0e2c0));
beach.position.y = -0.4;
beach.receiveShadow = true;
scene.add(beach);
const grass = new THREE.Mesh(new THREE.CylinderGeometry(21.5, 22.5, 0.6, 56), mat(0xa9d48b));
grass.position.y = -0.05;
grass.receiveShadow = true;
scene.add(grass);
const GROUND = 0.26;
// trees along the island's back edge, clear of the stages' corridor; clouds overhead
{
  const r = rng(7);
  for (let k = 0; k < 22; k++) {
    const a = (k / 22) * Math.PI * 2 + r() * 0.2, d = 14 + r() * 5;
    const x = Math.sin(a) * d, z = -Math.cos(a) * d;
    if (z > -10.5) continue;
    const t = r() < 0.5 ? makeTree(r, 1 + r() * 0.5) : makeConifer(r, 1 + r() * 0.4);
    t.position.set(x, 0.2, z);
    scene.add(t);
  }
  for (let k = 0; k < 7; k++) {
    const c = makeCloud(r, 2 + r() * 2);
    c.position.set((r() - 0.5) * 140, 26 + r() * 16, -40 - r() * 60);
    scene.add(c);
  }
}

/** a kit tile, measured and scaled so its width across (x) is `w` m */
async function tile(url: string, w: number, flat = 1): Promise<{ g: THREE.Group; len: number }> {
  const src = (await loadGLB(url)).clone(true);
  src.traverse(o => { if ((o as THREE.Mesh).isMesh) o.receiveShadow = true; });
  const box = new THREE.Box3().setFromObject(src);
  const size = box.getSize(new THREE.Vector3());
  const s = w / size.x;
  src.scale.set(s, s * flat, s);
  src.position.y = -box.min.y * s * flat;
  const g = new THREE.Group();
  g.add(src);
  return { g, len: size.z * s };
}

/** the stages, built once each, and each one's show (0 away … 1 there) */
const stages = new Map<StageKind, THREE.Group>();
const stageShow = new Map<StageKind, number>();
const blinkers: THREE.Mesh[] = [];
let water: THREE.Mesh | null = null;
function buildStage(kind: StageKind): THREE.Group {
  let g = stages.get(kind);
  if (g) return g;
  g = new THREE.Group();
  stages.set(kind, g);
  stageShow.set(kind, 0);
  scene.add(g);
  const into = g;
  const box = (w: number, h: number, d: number, c: number, x: number, y: number, z: number): THREE.Mesh => {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat(c));
    m.position.set(x, y, z);
    m.receiveShadow = true;
    into.add(m);
    return m;
  };
  const light = (x: number, z: number, c: number): void => {
    const m = new THREE.Mesh(new THREE.SphereGeometry(0.16, 10, 8), new THREE.MeshBasicMaterial({ color: c }));
    m.position.set(x, 0.18, z);
    m.userData.phase = blinkers.length * 0.7;
    m.userData.base = new THREE.Color(c);
    into.add(m);
    blinkers.push(m);
  };
  if (kind === 'road') {
    // a street across the island: the Road Kit's straights, pavements, a lamp
    for (const x of [-42, -28, -14, 0, 14, 28, 42]) void tile('assets/kenney/city-roads/road-straight.glb', 14, 0.3).then(({ g: t }) => { t.position.x = x; into.add(t); });
    for (const sd of [-1, 1]) box(98, 0.12, 3, 0xa1a9c9, 0, 0.06, sd * 8.5);
    void loadGLB('assets/kenney/city-roads/light-curved.glb').then(l => {
      for (const x of [-11, 11]) {
        const lamp = l.clone(true);
        lamp.scale.setScalar(5.5);
        lamp.position.set(x, 0.1, -8.4);
        lamp.rotation.y = Math.PI;
        lamp.traverse(o => { if ((o as THREE.Mesh).isMesh) o.castShadow = true; });
        into.add(lamp);
      }
    }).catch(() => {});
  } else if (kind === 'track') {
    // a stretch of race track right across the island and out past both
    // shores (the finish tile's arch stood a pillar in front of the camera)
    void tile('assets/kenney/racing/track-straight.glb', 10).then(({ g: t0, len }) => {
      for (let x = -3 * len; x <= 3 * len + 0.01; x += len) {
        const t = t0.clone(true);
        t.rotation.y = Math.PI / 2;
        t.position.x = x;
        into.add(t);
      }
    }).catch(() => {});
  } else if (kind === 'rail') {
    // rails right across the island on a gravel bed
    box(98, 0.2, 5, 0xb9b1a4, 0, 0.05, 0);
    void tile('assets/kenney/train/railroad-straight.glb', 3.4).then(({ g: t0, len }) => {
      for (let x = -48; x <= 48; x += len) {
        const t = t0.clone(true);
        t.rotation.y = Math.PI / 2;
        t.position.set(x, 0.15, 0);
        into.add(t);
      }
    }).catch(() => {});
  } else if (kind === 'canal') {
    // a canal across the island to the sea, stone edged, a little jetty
    const geo = new THREE.PlaneGeometry(52, 8, 52, 8);
    geo.rotateX(-Math.PI / 2);
    water = new THREE.Mesh(geo, new THREE.MeshLambertMaterial({ color: 0x5aa9d6, flatShading: true }));
    water.position.y = 0.2;
    water.receiveShadow = true;
    into.add(water);
    for (const sd of [-1, 1]) box(52, 0.5, 0.8, 0xc9c2b2, 0, 0.18, sd * 4.4);
    for (let k = 0; k < 6; k++) box(1.2, 0.12, 0.5, 0xa9805a, 6 + k * 0.55, 0.32, 3.2);
    for (const x of [6.1, 8.9]) box(0.2, 1, 0.2, 0x83624a, x, 0, 3.3);
  } else if (kind === 'helipad') {
    const pad = new THREE.Mesh(new THREE.CylinderGeometry(6, 6.2, 0.18, 48), mat(0x4a5058));
    pad.position.y = 0.09;
    pad.receiveShadow = true;
    g.add(pad);
    const ring = new THREE.Mesh(new THREE.TorusGeometry(5.3, 0.14, 8, 48), mat(0xf6c952));
    ring.rotation.x = Math.PI / 2;
    ring.position.y = 0.19;
    g.add(ring);
    box(0.8, 0.04, 4.2, 0xfaf7ef, -1.3, 0.19, 0);
    box(0.8, 0.04, 4.2, 0xfaf7ef, 1.3, 0.19, 0);
    box(2, 0.04, 0.7, 0xfaf7ef, 0, 0.19, 0);
    for (let k = 0; k < 12; k++) light(Math.cos(k / 12 * Math.PI * 2) * 5.8, Math.sin(k / 12 * Math.PI * 2) * 5.8, 0x8fd0ff);
  } else {
    // a runway: asphalt, centre dashes, lights along both edges
    box(48, 0.12, 8, 0x5f6470, 0, 0.06, 0);
    for (let x = -22; x <= 22; x += 4) box(2.2, 0.03, 0.35, 0xfaf7ef, x, 0.13, 0);
    for (let x = -22; x <= 22; x += 4) for (const sd of [-1, 1]) light(x, sd * 3.8, 0xfff2b0);
  }
  g.visible = false;
  return g;
}

// ---- the vehicles: loaded once, shown one at a time ----
/** scale a model to `len` m long, standing on y = 0 */
function fit(g: THREE.Object3D, len: number): THREE.Group {
  const box = new THREE.Box3().setFromObject(g);
  const size = box.getSize(new THREE.Vector3());
  const s = len / Math.max(size.x, size.z, 1e-3);
  g.scale.multiplyScalar(s);
  g.position.y = -box.min.y * s;
  const w = new THREE.Group();
  w.add(g);
  return w;
}
function makeModel(m: NonNullable<Item['model']>): Promise<THREE.Group> {
  if (m.glb) return spawnVehicle(m.glb, { len: m.len, yaw: m.yaw ?? 0 });
  const g = m.make === 'plane' ? makePlane()
    : makeHelicopter(m.make === 'heliPolice' ? { body: 0x5a7fb5, band: 0xfaf7ef } : { body: 0xfaf7ef, band: 0xe25c5c });
  return Promise.resolve(fit(g, m.len));
}
const flies = (it: Item): boolean => it.model?.make !== undefined && it.model.make !== 'plane';
/** how high it stands over the island: its stage's surface, a helicopter's hover */
const BASE: Record<StageKind, number> = { road: 0.12, track: 0.1, rail: 0.32, canal: 0.18, helipad: 0.2, runway: 0.12 };
const hoverOf = (it: Item): number => BASE[it.stage] + (flies(it) ? 2.2 : 0);

/** a model on show: where it is in its coming and going */
interface Shown {
  g: THREE.Group;
  item: Item;
  wheels: THREE.Object3D[];
  /** the sphere its turning takes up (its centre above its base, its radius) */
  cy: number; r: number;
  phase: 'hidden' | 'in' | 'show' | 'out';
  t: number;
  /** +1: moving off to the left (the cards moved on), −1: to the right */
  dir: number;
  spin: number;
  x: number; y: number; vx: number;
}
const models = new Map<string, Shown>();
const loading = new Set<string>();
const keyOf = (it: Item, st = stage): string => `${st}:${it.id}`;
function loadModels(items: Item[], stageName: 'modes' | 'cars'): void {
  for (const it of items) {
    const k = keyOf(it, stageName);
    if (!it.model || models.has(k) || loading.has(k)) continue;
    loading.add(k);
    makeModel(it.model).then(g => {
      g.traverse(o => { if ((o as THREE.Mesh).isMesh) { o.castShadow = true; o.receiveShadow = true; } });
      const box = new THREE.Box3().setFromObject(g);
      // (it turns about its own origin: its reach is the farthest corner from the axis)
      const rh = Math.max(...[box.min.x, box.max.x].flatMap(x => [box.min.z, box.max.z].map(z => Math.hypot(x, z))));
      const h = box.max.y - box.min.y;
      const sh: Shown = {
        g, item: it, wheels: wheelNodes(g), cy: box.min.y + h / 2 + hoverOf(it), r: Math.hypot(rh, h / 2 + (flies(it) ? 0.4 : 0)),
        phase: 'hidden', t: 0, dir: 1, spin: 0, x: 0, y: 0, vx: 0,
      };
      g.visible = false;
      scene.add(g);
      models.set(k, sh);
      thumbnail(k, g);
      // (the one chosen when the page opened: already there, no entrance)
      if (k === keyOf(list[sel]) && !current) { current = sh; sh.phase = 'show'; sh.spin = -0.6; g.visible = true; }
    }).catch(() => {});
  }
}
let current: Shown | null = null;
/** the stage showing, and when it changes to the chosen one's (once the one leaving has gone) */
let stageNow: StageKind = modeItems[Math.max(0, sel)].stage;
let stageAt = 0;
loadModels(modeItems, 'modes');

// ---- the cards' pictures: each vehicle drawn from its model ----
const thumbs = new Map<string, string>();
let thumbR: THREE.WebGLRenderer | null = null;
let thumbS: THREE.Scene | null = null;
let thumbC: THREE.PerspectiveCamera | null = null;
function thumbnail(key: string, model: THREE.Group): void {
  try {
    if (!thumbR) {
      thumbR = new THREE.WebGLRenderer({ alpha: true, antialias: true, preserveDrawingBuffer: true });
      thumbR.setSize(256, 256, false);
      thumbR.outputColorSpace = renderer.outputColorSpace;
      thumbS = new THREE.Scene();
      thumbS.add(new THREE.HemisphereLight(0xffffff, 0xb8c4cc, 2.2));
      const sun = new THREE.DirectionalLight(0xffffff, 1.6);
      sun.position.set(4, 8, 6);
      thumbS.add(sun);
      thumbC = new THREE.PerspectiveCamera(30, 1, 0.1, 100);
    }
    const g = model.clone(true);
    g.visible = true;
    g.position.set(0, 0, 0);
    g.rotation.set(0, -0.7, 0);
    thumbS!.add(g);
    // frame it: three-quarters from the front, filling the card
    const box = new THREE.Box3().setFromObject(g);
    const c = box.getCenter(new THREE.Vector3()), r = box.getSize(new THREE.Vector3()).length() / 2;
    const d = r / Math.sin((thumbC!.fov * Math.PI) / 360) * 0.9;
    thumbC!.position.set(c.x + d * 0.25, c.y + d * 0.42, c.z + d * 0.87);
    thumbC!.lookAt(c);
    thumbR!.render(thumbS!, thumbC!);
    thumbs.set(key, thumbR!.domElement.toDataURL('image/png'));
    thumbS!.remove(g);
    const card = cards[list.findIndex(it => keyOf(it) === key)];
    if (card) paintCard(card, list[cards.indexOf(card)]);
  } catch { /* no picture: the card keeps its emoji */ }
}

// ---- the cards: a coverflow along the bottom, the chosen one whole in the middle ----
const carousel = document.getElementById('carousel')!;
let cards: HTMLElement[] = [];
/** where the row is (a card index, unbounded: it glides) and where it's going */
let pos = sel, vel = 0, target = sel;
let lastTick = Math.round(pos);
/** the chosen card's little pop: owed until it reaches the middle, then played from `popAt` */
let popOwed = false, popAt = -9;
function paintCard(card: HTMLElement, it: Item): void {
  const face = card.firstElementChild as HTMLElement;
  const pic = thumbs.get(keyOf(it));
  if (pic && it.id !== 'back') {
    const img = document.createElement('img');
    img.src = pic;
    img.alt = '';
    face.replaceChildren(img);
  } else {
    const span = document.createElement('span');
    span.className = 'emo';
    span.textContent = it.icon;
    face.replaceChildren(span);
  }
}
function buildCards(): void {
  cards = list.map((it, i) => {
    const card = document.createElement('div');
    card.className = 'vcard';
    card.style.setProperty('--c', it.color);
    const face = document.createElement('div');
    face.className = 'face';
    card.append(face);
    paintCard(card, it);
    card.addEventListener('click', () => { if (i === sel) go(); else choose(i); });
    return card;
  });
  carousel.replaceChildren(...cards);
  placeCards(0);
}
const wrap = (v: number, n: number): number => ((((v + n / 2) % n) + n) % n) - n / 2;
const smooth = (k: number): number => k * k * (3 - 2 * k);
/** every card's place, from where the row is now */
function placeCards(time: number): void {
  const n = list.length, unit = carousel.clientHeight * 0.62;
  cards.forEach((card, i) => {
    const o = wrap(i - pos, n), a = Math.abs(o);
    const sgn = Math.sign(o);
    // wide by the middle, tight further out: the side cards overlap, turned away
    const x = sgn * (a <= 1 ? a * unit * 1.02 : unit * 1.02 + (a - 1) * unit * 0.46);
    const rot = -Math.max(-1, Math.min(1, o)) * 58;
    let s = a < 1 ? 1.18 - smooth(a) * 0.52 : 0.66 - Math.min(3, a - 1) * 0.04;
    // the chosen one: a little pop as it arrives in the middle, then breathing
    if (i === sel) {
      if (popOwed && a < 0.3) { popOwed = false; popAt = time; }
      const k = (time - popAt) / 0.45;
      if (k >= 0 && k < 1) s *= 1 + Math.sin(k * Math.PI) * 0.1;
    }
    if (a < 0.04) s *= 1 + 0.035 * Math.sin(time * (Math.PI * 2 / 2.4));
    card.style.transform = `translateX(${x.toFixed(1)}px) translateZ(${(-a * 60).toFixed(1)}px) rotateY(${rot.toFixed(1)}deg) scale(${s.toFixed(3)})`;
    card.style.opacity = String(a > 4.6 ? 0 : a > 3.8 ? (4.6 - a) / 0.8 : 1);
    card.style.zIndex = String(100 - Math.round(a * 10));
    card.style.filter = a < 0.5 ? '' : `brightness(${(1 - Math.min(3, a) * 0.07).toFixed(2)})`;
    card.classList.toggle('sel', a < 0.5);
  });
}

const nameT = document.querySelector('#name .t') as HTMLElement;
const nameB = document.querySelector('#name .b') as HTMLElement;
const keysEl = document.getElementById('keys')!;
/** the keys the chosen vehicle answers to in the game (any race car: the
 * race's), and auto speed's note when it's on */
function showKeys(): void {
  keysEl.innerHTML = keysHtml(stage === 'modes' ? GAMES[sel] : RACE);
}
function showName(): void {
  const e = list[sel];
  nameT.textContent = stage === 'modes' ? `${e.icon} ${e.title}` : e.id === 'back' ? `↩ ${e.title}` : e.title;
  nameB.textContent = e.blurb;
  showKeys();
  // (restart the pop)
  nameT.style.animation = 'none';
  void nameT.offsetWidth;
  nameT.style.animation = '';
  document.documentElement.style.setProperty('--sel', e.color);
}
/** say a line in the chosen language: its recorded clip (src/i18n/voice.ts) */
function say(id: string): Promise<void> { return speak(id); }
/** send the one on the stage off and bring the chosen one in */
function swapTo(it: Item, dir: number): void {
  const next = it.model ? models.get(keyOf(it)) ?? null : null;
  if (current && current !== next) {
    if (current.phase !== 'hidden') { current.phase = 'out'; current.t = 0; current.dir = dir; music.whoosh(); }
  }
  if (next && next !== current) {
    next.phase = 'in';
    next.t = 0;
    next.dir = dir;
    next.g.visible = true;
  }
  // (the way back has no vehicle: the stage stands empty)
  current = next;
  stageAt = clock0 + 0.4;
}
let clock0 = 0;
function choose(i: number): void {
  const n = list.length;
  const to = ((i % n) + n) % n;
  if (to === sel) return;
  // (the shortest way round: the cards glide that way, the vehicles go that way)
  const d = wrap(to - sel, n) || 1;
  target += d;
  sel = to;
  popOwed = true;
  if (stage === 'modes') store.set(PICK_KEY, list[sel].id);
  else if (list[sel].id !== 'back') store.set(CAR_KEY, list[sel].id);
  swapTo(list[sel], Math.sign(d));
  showName();
  say(list[sel].sayId);
}
/** show a row of cards: the modes, or the race cars (the car picked last time first) */
function enter(next: 'modes' | 'cars'): void {
  const leaving = current;
  stage = next;
  list = next === 'modes' ? modeItems : carItems;
  sel = next === 'modes'
    ? Math.max(0, modeItems.findIndex(g => g.id === 'race'))
    : Math.max(1, carItems.findIndex(c => c.id === (store.get(CAR_KEY) || DEFAULT_CAR)));
  pos = target = sel;
  vel = 0;
  lastTick = sel;
  if (next === 'cars') loadModels(carItems, 'cars');
  buildCards();
  showName();
  current = leaving;
  swapTo(list[sel], 1);
  // (the wheel is re-armed: the press that got here doesn't also choose)
  ready = false;
  say(next === 'cars' ? 'pick-car' : list[sel].sayId);
}
addEventListener('resize', () => { placeCards(clock0); placeHelp(); measureBand(); });
/** the wheel hint beside the title where it fits, else below it */
function placeHelp(): void {
  const help = document.getElementById('help'), title = document.getElementById('title');
  if (!help || !title) return;
  help.classList.remove('below');
  const h = help.getBoundingClientRect(), t = title.getBoundingClientRect();
  help.classList.toggle('below', h.right > t.left - 12);
}
placeHelp();
void document.fonts?.ready.then(() => { placeHelp(); measureBand(); });

// ---- framing: the vehicle always whole, between the title and its name ----
/** the free band of the screen (px): under the title, over the name, clear of GO */
const band = { top: 0, bottom: 0, half: 0 };
function measureBand(): void {
  const top = Math.max(document.getElementById('title')!.getBoundingClientRect().bottom, document.getElementById('stars')!.getBoundingClientRect().bottom);
  const bottom = (document.querySelector('#name .t') as HTMLElement).getBoundingClientRect().top;
  const goL = document.getElementById('go')!.getBoundingClientRect().left;
  band.top = top + 10;
  band.bottom = Math.max(band.top + 80, bottom - 10);
  band.half = Math.max(80, Math.min(innerWidth / 2 - innerWidth * 0.05, goL - 16 - innerWidth / 2));
}
measureBand();
/** the framing now (eased toward the chosen vehicle's): distance, centre height, sphere radius */
const cam = { d: 18, cy: 1.5, r0: 4, c0: 2 };
/** where the camera stands to frame a sphere of radius r whose centre is cy up */
function framing(r: number, cy: number): void {
  const H = innerHeight, tanF = Math.tan((camera.fov * Math.PI) / 360);
  const yT = 1 - (2 * band.top) / H, yB = 1 - (2 * band.bottom) / H;
  const aT = Math.atan(yT * tanF), aB = Math.atan(yB * tanF), aC = (aT + aB) / 2;
  const half = Math.min((aT - aB) / 2, Math.atan(((band.half * 2) / innerWidth) * tanF * camera.aspect));
  const d = (r / Math.sin(Math.max(0.05, half))) * 1.08;
  cam.d = d;
  cam.cy = cy;
  // looking down at the vehicle 20°; the view aims lower so it sits in the band's middle
  const pc = -0.35, look = pc - aC;
  camera.position.set(0, cy - Math.sin(pc) * d, Math.cos(pc) * d);
  camera.lookAt(0, camera.position.y + Math.sin(look) * 10, camera.position.z - Math.cos(look) * 10);
}

// ---- the garage's music (G12) and its choosing sounds: started by the
// first click or key (a page may only start sound then), ducked under the
// spoken names; the music's on / off switch sits with the language's, and is
// the game's own too ----
const garageSounds = [...new Set([...modeItems, ...carItems].map(it => it.sound?.id).filter((x): x is SfxId => !!x))];
const music = new GameAudio('', garageSounds);
music.setMusic('garage');
for (const ev of ['pointerdown', 'keydown'] as const) addEventListener(ev, () => music.unlock());

// ---- the language: Português (the default) or English, for every page ----
const langBox = document.getElementById('lang')!;
function drawLang(): void {
  const note = document.createElement('button');
  note.type = 'button';
  note.textContent = '🎵';
  note.className = 'music';
  note.title = tr('city.music');
  note.classList.toggle('off', !music.isMusicOn);
  note.addEventListener('click', e => { e.stopPropagation(); music.unlock(); music.setMusicOn(!music.isMusicOn); drawLang(); });
  // the grown-ups' sound settings
  const gear = document.createElement('button');
  gear.type = 'button';
  gear.textContent = '⚙️';
  gear.className = 'gear';
  gear.title = tr('settings.title');
  gear.addEventListener('click', e => { e.stopPropagation(); openSettings(!settingsOpen); });
  langBox.replaceChildren(...LANGS.map(l => {
    const b = document.createElement('button');
    b.type = 'button';
    b.textContent = l.label;
    b.lang = l.id === 'pt' ? 'pt-PT' : 'en';
    b.classList.toggle('on', l.id === getLang());
    b.addEventListener('click', e => { e.stopPropagation(); pickLang(l.id); });
    return b;
  }), note, gear);
}

// ---- the grown-ups' sound settings (G11): voice, music, background sounds
// and engines, each 0 … 100 %, remembered for every page; a sample plays when
// a slider is let go. While the panel is open the wheel, the keys and the
// clicks don't reach the carousel ----
const settingsEl = document.getElementById('settings')!;
let settingsOpen = false;
function openSettings(on: boolean): void {
  settingsOpen = on;
  settingsEl.classList.toggle('on', on);
  if (on) music.unlock();
}
for (const inp of settingsEl.querySelectorAll<HTMLInputElement>('input[data-vol]')) {
  const k = inp.dataset.vol as VolumeKey;
  const out = inp.nextElementSibling as HTMLOutputElement;
  const show = (): void => { out.textContent = `${inp.value}%`; };
  inp.value = String(Math.round(volume(k) * 100));
  show();
  inp.addEventListener('input', () => { setVolume(k, Number(inp.value) / 100); show(); });
  inp.addEventListener('change', () => sample(k));
}
// the graphics quality (G13): auto / low / medium / high, for the next game
const qualityBtns = [...settingsEl.querySelectorAll<HTMLButtonElement>('button[data-quality]')];
const showQuality = (): void => {
  const p = qualityPref();
  for (const b of qualityBtns) {
    b.classList.toggle('on', b.dataset.quality === p);
    b.setAttribute('aria-checked', String(b.dataset.quality === p));
  }
};
for (const b of qualityBtns) b.addEventListener('click', () => { setQualityPref(b.dataset.quality as QualityPref); showQuality(); });
showQuality();
// auto speed (G18): the game works the gas, the kid only steers
const autoBtns = [...settingsEl.querySelectorAll<HTMLButtonElement>('button[data-auto]')];
const showAuto = (): void => {
  const on = autoSpeed() ? '1' : '0';
  for (const b of autoBtns) {
    b.classList.toggle('on', b.dataset.auto === on);
    b.setAttribute('aria-checked', String(b.dataset.auto === on));
  }
  showKeys();
};
for (const b of autoBtns) b.addEventListener('click', () => { setAutoSpeed(b.dataset.auto === '1'); showAuto(); });
showAuto();
settingsEl.addEventListener('click', e => { if (e.target === settingsEl) openSettings(false); });
document.getElementById('settingsClose')!.addEventListener('click', () => openSettings(false));
// the wheel's test and calibration page
document.getElementById('wheelBtn')!.addEventListener('click', () => { location.href = 'wheel.html'; });
/** what a slider sounds like: a spoken name, the music (it plays on), a
 * ding, a moment of engine */
function sample(k: VolumeKey): void {
  if (k === 'voice') void say(list[sel].sayId);
  else if (k === 'bg') music.ding();
  else if (k === 'engine') {
    music.setEngine('car', 0.7, 1);
    setTimeout(() => music.setEngine(null), 1200);
  }
}

function pickLang(l: 'pt' | 'en'): void {
  if (l === getLang()) return;
  setLang(l);
  applyI18n('garage.pageTitle');
  placeHelp();
  preloadVoice();
  drawLang();
  showName();
  measureBand();
  say(list[sel].sayId);
}
drawLang();

// the all-time scores, from the game's saved totals
{
  const t = loadTotals();
  document.getElementById('stars')!.textContent = `⭐ ${t.stars}   🔥 ${t.fires}   🐱 ${t.cats}`;
}

// ---- go! ----
let going = false;
function go(): void {
  if (going || settingsOpen) return;
  const e = list[sel];
  // the race: first its car; the way back from the cars: the modes again
  if (stage === 'modes' && e.id === 'race') { enter('cars'); return; }
  if (stage === 'cars' && e.id === 'back') { enter('modes'); return; }
  going = true;
  const said = say(e.goId);
  if (e.sound) music.blip(e.sound.id, 1.6, e.sound.gain, e.sound.bus);
  const wipe = document.getElementById('wipe')!;
  wipe.textContent = stage === 'cars' ? '🏁' : e.icon;
  wipe.classList.add('on');
  const url = stage === 'cars' ? `${RACE.url}&car=${e.id}` : GAMES[sel].url;
  // (off to the game once the wipe is in and the line has been said — 5 s at most;
  // the longest line, Cori's English one; Benedita's are ≤2.2 s)
  const wiped = new Promise(r => setTimeout(r, 650));
  const most = new Promise(r => setTimeout(r, 5000));
  void Promise.race([Promise.all([wiped, said]), most]).then(() => { location.href = url; });
}
document.getElementById('go')!.addEventListener('click', go);
renderer.domElement.addEventListener('click', go);

// ---- keys ----
addEventListener('keydown', e => {
  // (the settings panel: O opens and closes it, Esc closes it, and while
  // it's open no key moves the carousel)
  if (e.code === 'KeyO') { openSettings(!settingsOpen); return; }
  if (settingsOpen) { if (e.code === 'Escape') openSettings(false); return; }
  if (e.code === 'KeyL') pickLang(getLang() === 'pt' ? 'en' : 'pt');
  else if ((e.code === 'Escape' || e.code === 'Backspace') && stage === 'cars') enter('modes');
  else if (e.code === 'ArrowLeft' || e.code === 'KeyA') choose(sel - 1);
  else if (e.code === 'ArrowRight' || e.code === 'KeyD') choose(sel + 1);
  else if (['Enter', 'Space', 'ArrowUp', 'KeyW', 'NumpadEnter'].includes(e.code)) { e.preventDefault(); go(); }
});

// ---- the wheel: turn to step (hold turned to keep stepping), the pedal or
// any button to go. Nothing counts until the wheel has been seen at rest,
// so a pedal already held down when the page opens doesn't start a game ----
const wheelIcon = document.getElementById('wheel') as unknown as SVGElement;
let armed = false, stepT = 0, ready = false;
function pollWheel(dt: number): void {
  if (settingsOpen) return;
  const w = readWheel();
  if (!w) { wheelIcon.style.transform = ''; return; }
  const steer = w.steer;
  wheelIcon.style.transform = `rotate(${(steer * 120).toFixed(1)}deg)`;
  // (the gas pedal or a button — one given another job on wheel.html excepted — goes)
  const pressed = w.gas > 0.5 || wheelHeld('go', [0, 1, 2, 3, 9]);
  if (!ready) { if (!pressed && Math.abs(steer) < 0.2) ready = true; return; }
  if (pressed) { go(); return; }
  const a = Math.abs(steer);
  if (a < 0.22) { armed = true; stepT = 0; }
  else if (a > 0.45 && armed) { choose(sel + Math.sign(steer)); armed = false; stepT = 0.55; }
  else if (a > 0.7 && !armed) {
    // held well round: keep stepping
    stepT -= dt;
    if (stepT <= 0) { choose(sel + Math.sign(steer)); stepT = 0.42; }
  }
}

buildCards();
showName();
// the wheel's buttons with a job (wheel.html): back, and the music; going is
// pollWheel's (it also waits until the wheel has been seen at rest)
watchWheelActions(a => {
  if (a === 'back') { if (settingsOpen) openSettings(false); else if (stage === 'cars') enter('modes'); }
  else if (a === 'muteMusic') langBox.querySelector<HTMLButtonElement>('button.music')?.click();
});

// ---- the frame loop ----
const clock = new THREE.Clock();
let t = 0;
const easeOut = (k: number): number => 1 - (1 - k) ** 3;
const easeIn = (k: number): number => k * k * k;
const IN_T = 0.85, OUT_T = 0.7;
/** a model's place and pose for this frame */
function move(m: Shown, dt: number): void {
  const off = cam.d * 0.9 + 14;
  const travel = m.dir > 0 ? -Math.PI / 2 : Math.PI / 2;
  const hover = hoverOf(m.item);
  const bob = flies(m.item) ? Math.sin(t * 1.6) * 0.3 : m.item.stage === 'canal' ? Math.sin(t * 1.8) * 0.06 : 0;
  const fly = flies(m.item) || m.item.model?.make === 'plane';
  let x = m.x, y = hover, yaw = m.spin;
  m.t += dt;
  if (m.phase === 'in') {
    // in from the far side, slowing to a stop in the middle, facing the way it came
    const k = Math.min(1, m.t / IN_T), e = easeOut(k);
    x = m.dir * off * (1 - e);
    y = hover + (fly ? (1 - e) * 7 : 0);
    yaw = travel;
    if (k >= 1) { m.phase = 'show'; m.spin = travel; if (m.item.sound) music.blip(m.item.sound.id, m.item.sound.secs, m.item.sound.gain, m.item.sound.bus); }
  } else if (m.phase === 'show') {
    m.spin += dt * 0.45;
    yaw = m.spin;
    x = 0;
    if (going && m === current) {
      // off it goes, turning to face the camera and driving at it
      let dy = -m.spin;
      dy = Math.atan2(Math.sin(dy), Math.cos(dy));
      m.spin += dy * Math.min(1, dt * 8);
      yaw = m.spin;
      m.vx += dt * 40;
      m.g.position.z += m.vx * dt;
    }
  } else if (m.phase === 'out') {
    // it turns to face the way the cards went and speeds off that way
    const k = Math.min(1, m.t / OUT_T);
    let dy = travel - m.spin;
    dy = Math.atan2(Math.sin(dy), Math.cos(dy));
    yaw = m.spin + dy * Math.min(1, k * 3);
    x = -m.dir * off * easeIn(k);
    y = hover + (fly ? easeIn(k) * 9 : 0);
    if (k >= 1) { m.phase = 'hidden'; m.g.visible = false; }
  }
  const vx = (x - m.x) / Math.max(dt, 1e-4);
  m.x = x;
  m.g.position.set(x, GROUND + y + bob, m.phase === 'show' && going && m === current ? m.g.position.z : 0);
  m.g.rotation.y = yaw;
  // wheels roll with the ground speed (forward along the way it faces)
  const fwd = vx * Math.sin(yaw) + (going && m === current ? m.vx : 0);
  for (const w of m.wheels) w.rotation.x += (fwd * dt) / 0.35;
}

renderer.setAnimationLoop(() => {
  const dt = Math.min(clock.getDelta(), 0.05);
  t += dt;
  clock0 = t;
  pollWheel(dt);
  music.duck(speaking());
  music.setMusic('garage');
  // the row glides after the choice (a critically damped spring), ticking as cards pass
  const w = 11;
  vel += (w * w * (target - pos) - 2 * w * vel) * dt;
  pos += vel * dt;
  if (Math.abs(target - pos) < 1e-3 && Math.abs(vel) < 1e-3) { pos = target; vel = 0; }
  if (Math.round(pos) !== lastTick) { lastTick = Math.round(pos); music.tick(); }
  placeCards(t);
  // the stages: the chosen vehicle's rises in, the others sink away
  if (t >= stageAt) stageNow = list[sel].stage;
  const want = stageNow;
  buildStage(want);
  for (const [kind, g] of stages) {
    const on = kind === want ? 1 : 0;
    const p = (stageShow.get(kind) ?? 0) + (on - (stageShow.get(kind) ?? 0)) * Math.min(1, dt * 6);
    stageShow.set(kind, p);
    g.visible = p > 0.01;
    g.position.y = GROUND - 1.2 * (1 - p);
    g.scale.set(1, Math.max(0.01, p), 1);
  }
  for (const b of blinkers) {
    const on = Math.sin(t * 3 + b.userData.phase) > 0.3;
    (b.material as THREE.MeshBasicMaterial).color.copy(b.userData.base as THREE.Color).multiplyScalar(on ? 1 : 0.35);
  }
  if (water) {
    const p = water.geometry.attributes.position as THREE.BufferAttribute;
    for (let i = 0; i < p.count; i++) p.setY(i, Math.sin(p.getX(i) * 0.6 + t * 1.6) * 0.06 + Math.cos(p.getZ(i) * 0.9 + t * 1.2) * 0.04);
    p.needsUpdate = true;
  }
  // the vehicles come and go; the camera frames the one there
  for (const m of models.values()) if (m.phase !== 'hidden') move(m, dt);
  for (const m of models.values()) {
    m.g.traverse(o => {
      if (o.userData.mainRotor) (o.userData.mainRotor as THREE.Object3D).rotation.y = t * 22;
      if (o.userData.tailRotor) (o.userData.tailRotor as THREE.Object3D).rotation.x = t * 30;
      if (o.userData.prop) (o.userData.prop as THREE.Object3D).rotation.z = t * 40;
    });
  }
  {
    const f = current ?? null;
    const r = f ? f.r : 4, cy = f ? f.cy + GROUND : 2;
    const k = Math.min(1, dt * 3);
    framing(cam.r0 = cam.r0 + (r - cam.r0) * k, cam.c0 = cam.c0 + (cy - cam.c0) * k);
  }
  renderer.render(scene, camera);
});

// (dev: where the chosen model's box lands on the screen, for checking it's whole)
(window as unknown as { __garage: unknown }).__garage = {
  band, camera, get current() { return current; },
  corners(): Array<[number, number]> {
    if (!current) return [];
    const box = new THREE.Box3().setFromObject(current.g);
    const out: Array<[number, number]> = [];
    for (const x of [box.min.x, box.max.x]) for (const y of [box.min.y, box.max.y]) for (const z of [box.min.z, box.max.z]) {
      const v = new THREE.Vector3(x, y, z).project(camera);
      out.push([(v.x + 1) / 2 * innerWidth, (1 - v.y) / 2 * innerHeight]);
    }
    return out;
  },
};
