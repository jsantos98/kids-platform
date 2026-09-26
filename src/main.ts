// The garage — the launcher. One vehicle for each play mode of the island
// world (registry.ts), chosen with the wheel: turn it to spin the carousel,
// press the pedal (or any button) to drive off. The chosen vehicle sits on
// a turntable on a little island; its name is shown big (and spoken, for
// kids who don't read yet). Keys and the mouse work too.
// Choosing the race opens a second carousel, the same way: the race car
// (raceCars.ts), with a "back" tile first — the wheel's way back.
import * as THREE from 'three';
import { createStage, mat } from './engine/stage.js';
import { spawnVehicle } from './engine/assets.js';
import { makeHelicopter, makePlane, makeTree, makeConifer, makeCloud } from './kit/index.js';
import { rng } from './engine/rng.js';
import { GAMES, type GameEntry } from './games/registry.js';
import { RACE_CARS, DEFAULT_CAR, type RaceCar } from './games/raceCars.js';
import { keysHtml } from './games/keys.js';
import { loadTotals } from './games/city/state.js';
import { t as tr, applyI18n, getLang, setLang, LANGS, type Key } from './i18n/index.js';
import { speak, preloadVoice } from './i18n/voice.js';

applyI18n('garage.pageTitle');
preloadVoice();

const PICK_KEY = 'garage.pick';
const CAR_KEY = 'garage.car';
const store = {
  get: (k: string): string => { try { return localStorage.getItem(k) ?? ''; } catch { return ''; } },
  set: (k: string, v: string): void => { try { localStorage.setItem(k, v); } catch { /* private mode */ } },
};

// ---- what the carousel shows: the play modes, or the race cars ----
interface Item {
  /** the list's own id ('back' for the way back) */
  id: string;
  readonly title: string;
  readonly blurb: string;
  color: string;
  /** a tile's emoji (the modes; the cars show a picture of themselves) */
  icon: string;
  /** the turntable model (none for the way back) */
  model: GameEntry['model'] | null;
  /** its spoken name, and the line when it's picked (voice.ts clip ids) */
  sayId: string;
  goId: string;
}
const RACE = GAMES.find(g => g.id === 'race')!;
const modeItems: Item[] = GAMES.map(g => ({
  id: g.id, get title() { return g.title; }, get blurb() { return g.blurb; }, color: g.color, icon: g.icon,
  model: g.model, sayId: `mode-${g.id}`, goId: `go-${g.id}`,
}));
const carItems: Item[] = [
  { id: 'back', get title() { return tr('cars.back'); }, get blurb() { return tr('cars.backBlurb'); }, color: '#8a93a0',
    icon: '↩', model: null, sayId: 'back', goId: 'back' },
  ...RACE_CARS.map((c: RaceCar): Item => ({
    id: c.id, get title() { return tr(`car.${c.id}` as Key); }, get blurb() { return tr('cars.blurb'); }, color: c.color,
    icon: '🏎️', model: { glb: c.glb, len: c.len, yaw: c.yaw }, sayId: `car-${c.id}`, goId: `gocar-${c.id}`,
  })),
];

let stage: 'modes' | 'cars' = 'modes';
let list = modeItems;
let sel = Math.max(0, modeItems.findIndex(g => g.id === store.get(PICK_KEY)));

// ---- the scene: a little island with a turntable, the sea round it ----
const scn = createStage({ ground: false, fogNear: 60, fogFar: 260, sunPos: [30, 60, 40], shadowSpan: 26 });
const { scene, camera, renderer } = scn;
const sea = new THREE.Mesh(new THREE.CircleGeometry(400, 64), mat(0x7cc6e0));
sea.rotation.x = -Math.PI / 2;
sea.position.y = -0.6;
scene.add(sea);
const beach = new THREE.Mesh(new THREE.CylinderGeometry(21, 22.5, 0.9, 48), mat(0xf0e2c0));
beach.position.y = -0.4;
beach.receiveShadow = true;
scene.add(beach);
const grass = new THREE.Mesh(new THREE.CylinderGeometry(18.5, 19.5, 0.6, 48), mat(0xa9d48b));
grass.position.y = -0.05;
grass.receiveShadow = true;
scene.add(grass);
// the turntable: a cream disc with a ring in the chosen vehicle's colour
const table = new THREE.Group();
scene.add(table);
const disc = new THREE.Mesh(new THREE.CylinderGeometry(6.2, 6.6, 0.5, 48), mat(0xfaf5ea));
disc.position.y = 0.25;
disc.receiveShadow = true;
table.add(disc);
const ringMat = new THREE.MeshLambertMaterial({ color: 0xe25c5c });
const ring = new THREE.Mesh(new THREE.TorusGeometry(6.45, 0.22, 10, 64), ringMat);
ring.rotation.x = Math.PI / 2;
ring.position.y = 0.42;
table.add(ring);
// trees round the island's edge, clouds overhead
{
  const r = rng(7);
  for (let k = 0; k < 16; k++) {
    const a = (k / 16) * Math.PI * 2 + r() * 0.2, d = 13 + r() * 4;
    // (the front, toward the camera, stays open)
    if (Math.cos(a) > 0.55) continue;
    const t = r() < 0.5 ? makeTree(r, 1 + r() * 0.5) : makeConifer(r, 1 + r() * 0.4);
    t.position.set(Math.sin(a) * d, 0.2, -Math.cos(a) * d);
    scene.add(t);
  }
  for (let k = 0; k < 7; k++) {
    const c = makeCloud(r, 2 + r() * 2);
    c.position.set((r() - 0.5) * 140, 26 + r() * 16, -40 - r() * 60);
    scene.add(c);
  }
}
// (looking a little low, so the vehicle stands in the upper middle, clear
// of its name and the carousel below)
camera.position.set(0, 6.2, 15.5);
camera.lookAt(0, -0.6, 0);

// ---- the vehicles: loaded once, shown one at a time on the turntable ----
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
/** the turntable models by `<stage>:<id>`, and each one's pop-in (0 gone .. 1 shown) */
const models = new Map<string, THREE.Group>();
const pop = new Map<string, number>();
const keyOf = (it: Item): string => `${list === carItems ? 'cars' : 'modes'}:${it.id}`;
function loadModels(items: Item[], stageName: string): void {
  for (const it of items) {
    const k = `${stageName}:${it.id}`;
    if (!it.model || models.has(k) || pop.has(k)) continue;
    pop.set(k, 0);
    makeModel(it.model).then(g => {
      g.traverse(o => { if ((o as THREE.Mesh).isMesh) { o.castShadow = true; o.receiveShadow = true; } });
      g.visible = false;
      g.scale.setScalar(0.001);
      table.add(g);
      models.set(k, g);
      if (stageName === 'cars') thumbnail(it.id, g);
    }).catch(() => {});
  }
}
loadModels(modeItems, 'modes');
const flies = (it: Item): boolean => it.model?.make !== undefined;

// ---- the race cars' tiles: a picture of each car, drawn from its model ----
const thumbs = new Map<string, string>();
let thumbR: THREE.WebGLRenderer | null = null;
let thumbS: THREE.Scene | null = null;
let thumbC: THREE.PerspectiveCamera | null = null;
function thumbnail(id: string, model: THREE.Group): void {
  try {
    if (!thumbR) {
      thumbR = new THREE.WebGLRenderer({ alpha: true, antialias: true, preserveDrawingBuffer: true });
      thumbR.setSize(192, 192, false);
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
    g.scale.setScalar(1);
    g.position.set(0, 0, 0);
    g.rotation.y = -0.7;
    thumbS!.add(g);
    // frame it: three-quarters from the front, filling the tile
    const box = new THREE.Box3().setFromObject(g);
    const c = box.getCenter(new THREE.Vector3()), r = box.getSize(new THREE.Vector3()).length() / 2;
    const d = r / Math.sin((thumbC!.fov * Math.PI) / 360) * 0.92;
    thumbC!.position.set(c.x + d * 0.25, c.y + d * 0.42, c.z + d * 0.87);
    thumbC!.lookAt(c);
    thumbR!.render(thumbS!, thumbC!);
    thumbs.set(id, thumbR!.domElement.toDataURL('image/png'));
    thumbS!.remove(g);
    if (stage === 'cars') buildTiles();
  } catch { /* no picture: the tile keeps its emoji */ }
}

// ---- the carousel ----
const carousel = document.getElementById('carousel')!;
let tiles: HTMLElement[] = [];
let lastOff: number[] = [];
function buildTiles(): void {
  tiles = list.map((e, i) => {
    const t = document.createElement('div');
    t.className = 'tile';
    const pic = stage === 'cars' ? thumbs.get(e.id) : undefined;
    if (pic) {
      const img = document.createElement('img');
      img.src = pic;
      img.alt = '';
      img.className = 'pic';
      t.append(img);
    } else t.textContent = e.icon;
    t.style.setProperty('--c', e.color);
    t.addEventListener('click', () => { if (i === sel) go(); else choose(i); });
    return t;
  });
  carousel.replaceChildren(...tiles);
  lastOff = list.map(() => 0);
  layout(true);
}
const nameT = document.querySelector('#name .t') as HTMLElement;
const nameB = document.querySelector('#name .b') as HTMLElement;
const keysEl = document.getElementById('keys')!;
function layout(jump = false): void {
  const n = list.length, half = Math.floor(n / 2);
  const gap = Math.min(innerWidth / (Math.min(n, 11) + 0.5), innerHeight * 0.21);
  tiles.forEach((t, i) => {
    const off = ((i - sel + n + half) % n) - half;
    const a = Math.abs(off);
    // a tile wrapping round from one end to the other jumps, it doesn't fly across
    t.classList.toggle('jump', jump || Math.abs(off - lastOff[i]) > half);
    lastOff[i] = off;
    const s = a === 0 ? 1.35 : a === 1 ? 0.95 : Math.max(0.55, 0.95 - (a - 1) * 0.13);
    t.style.transform = `translateX(${off * gap}px) translateY(${a === 0 ? -6 : a * 4}px) scale(${s})`;
    t.style.opacity = String(a === 0 ? 1 : a > 5 ? 0 : Math.max(0.35, 1 - a * 0.16));
    t.style.zIndex = String(10 - a);
    t.classList.toggle('sel', a === 0);
  });
  requestAnimationFrame(() => tiles.forEach(t => t.classList.remove('jump')));
}
function showName(): void {
  const e = list[sel];
  nameT.textContent = stage === 'modes' ? `${e.icon} ${e.title}` : e.id === 'back' ? `↩ ${e.title}` : e.title;
  nameB.textContent = e.blurb;
  // (the keys the chosen vehicle answers to in the game; any race car: the race's)
  keysEl.innerHTML = keysHtml(stage === 'modes' ? GAMES[sel] : RACE);
  // (restart the pop)
  nameT.style.animation = 'none';
  void nameT.offsetWidth;
  nameT.style.animation = '';
  document.documentElement.style.setProperty('--sel', e.color);
  ringMat.color.set(e.color);
}
/** say a line in the chosen language: its recorded clip (src/i18n/voice.ts) */
function say(id: string): Promise<void> { return speak(id); }
function choose(i: number): void {
  const n = list.length;
  sel = ((i % n) + n) % n;
  if (stage === 'modes') store.set(PICK_KEY, list[sel].id);
  else if (list[sel].id !== 'back') store.set(CAR_KEY, list[sel].id);
  layout();
  showName();
  say(list[sel].sayId);
}
/** show a carousel: the modes, or the race cars (the car picked last time first) */
function enter(next: 'modes' | 'cars'): void {
  stage = next;
  list = next === 'modes' ? modeItems : carItems;
  sel = next === 'modes'
    ? Math.max(0, modeItems.findIndex(g => g.id === 'race'))
    : Math.max(1, carItems.findIndex(c => c.id === (store.get(CAR_KEY) || DEFAULT_CAR)));
  if (next === 'cars') loadModels(carItems, 'cars');
  buildTiles();
  showName();
  // (the wheel is re-armed: the press that got here doesn't also choose)
  ready = false;
  say(next === 'cars' ? 'pick-car' : list[sel].sayId);
}
addEventListener('resize', () => { layout(true); placeHelp(); });
/** the wheel hint beside the title where it fits, else below it */
function placeHelp(): void {
  const help = document.getElementById('help'), title = document.getElementById('title');
  if (!help || !title) return;
  help.classList.remove('below');
  const h = help.getBoundingClientRect(), t = title.getBoundingClientRect();
  help.classList.toggle('below', h.right > t.left - 12);
}
placeHelp();
void document.fonts?.ready.then(placeHelp);

// ---- the language: Português (the default) or English, for every page ----
const langBox = document.getElementById('lang')!;
function drawLang(): void {
  langBox.replaceChildren(...LANGS.map(l => {
    const b = document.createElement('button');
    b.type = 'button';
    b.textContent = l.label;
    b.lang = l.id === 'pt' ? 'pt-PT' : 'en';
    b.classList.toggle('on', l.id === getLang());
    b.addEventListener('click', e => { e.stopPropagation(); pickLang(l.id); });
    return b;
  }));
}
function pickLang(l: 'pt' | 'en'): void {
  if (l === getLang()) return;
  setLang(l);
  applyI18n('garage.pageTitle');
  placeHelp();
  preloadVoice();
  drawLang();
  showName();
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
  if (going) return;
  const e = list[sel];
  // the race: first its car; the way back from the cars: the modes again
  if (stage === 'modes' && e.id === 'race') { enter('cars'); return; }
  if (stage === 'cars' && e.id === 'back') { enter('modes'); return; }
  going = true;
  const said = say(e.goId);
  const wipe = document.getElementById('wipe')!;
  wipe.textContent = stage === 'cars' ? '🏁' : e.icon;
  wipe.classList.add('on');
  const url = stage === 'cars' ? `${RACE.url}&car=${e.id}` : GAMES[sel].url;
  // (off to the game once the wipe is in and the line has been said — 5 s at most;
  // the longest line, Raquel's "Helicóptero de Salvamento. Vamos lá!", is 4.3 s)
  const wiped = new Promise(r => setTimeout(r, 650));
  const most = new Promise(r => setTimeout(r, 5000));
  void Promise.race([Promise.all([wiped, said]), most]).then(() => { location.href = url; });
}
document.getElementById('go')!.addEventListener('click', go);
renderer.domElement.addEventListener('click', go);

// ---- keys ----
addEventListener('keydown', e => {
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
  const gp = navigator.getGamepads?.()[0];
  if (!gp) { wheelIcon.style.transform = ''; return; }
  const steer = gp.axes[0] ?? 0;
  wheelIcon.style.transform = `rotate(${(steer * 120).toFixed(1)}deg)`;
  const pressed = (gp.buttons[7]?.value ?? 0) > 0.5 || [0, 1, 2, 3, 9].some(b => gp.buttons[b]?.pressed);
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

buildTiles();
showName();

// ---- the frame loop ----
const clock = new THREE.Clock();
let t = 0;
renderer.setAnimationLoop(() => {
  const dt = Math.min(clock.getDelta(), 0.05);
  t += dt;
  pollWheel(dt);
  table.rotation.y += dt * 0.45;
  // frame the chosen vehicle by its size (a kart close, the train further back)
  const cur = list[sel];
  {
    const len = cur.model?.len ?? 4, up = flies(cur) ? 1.6 : 0;
    const d = 5.5 + len * 0.95, h = 2.6 + len * 0.3 + up;
    camera.position.x += (0 - camera.position.x) * Math.min(1, dt * 3);
    camera.position.y += (h - camera.position.y) * Math.min(1, dt * 3);
    camera.position.z += (d - camera.position.z) * Math.min(1, dt * 3);
    camera.lookAt(0, -0.2 + up * 0.8, 0);
  }
  const want = keyOf(cur);
  for (const [k, m] of models) {
    const on = k === want ? 1 : 0;
    const p = (pop.get(k) ?? 0) + (on - (pop.get(k) ?? 0)) * Math.min(1, dt * (on ? 7 : 12));
    pop.set(k, p);
    m.visible = p > 0.01;
    // a little overshoot as it pops in
    const s = on ? p + Math.sin(p * Math.PI) * 0.12 : p;
    m.scale.setScalar(Math.max(0.001, s));
    const it = k.startsWith('modes:') ? modeItems.find(x => `modes:${x.id}` === k) : undefined;
    m.position.y = 0.5 + (it && flies(it) ? 2 + Math.sin(t * 1.6) * 0.35 : 0) + (1 - p) * 1.5;
    if (going && k === want) m.position.z += dt * 30;
  }
  // the helicopters' rotors turn, the plane's propeller spins
  const m = models.get(want);
  if (m) {
    m.traverse(o => {
      if (o.userData.mainRotor) (o.userData.mainRotor as THREE.Object3D).rotation.y = t * 22;
      if (o.userData.tailRotor) (o.userData.tailRotor as THREE.Object3D).rotation.x = t * 30;
      if (o.userData.prop) (o.userData.prop as THREE.Object3D).rotation.z = t * 40;
    });
  }
  renderer.render(scene, camera);
});
