// The garage — the launcher. One vehicle for each play mode of the island
// world (registry.ts), chosen with the wheel: turn it to spin the carousel,
// press the pedal (or any button) to drive off. The chosen vehicle sits on
// a turntable on a little island; its name is shown big (and spoken, for
// kids who don't read yet). Keys and the mouse work too.
import * as THREE from 'three';
import { createStage, mat } from './engine/stage.js';
import { spawnVehicle } from './engine/assets.js';
import { makeHelicopter, makePlane, makeTree, makeConifer, makeCloud } from './kit/index.js';
import { rng } from './engine/rng.js';
import { GAMES, type GameEntry } from './games/registry.js';
import { loadTotals } from './games/city/state.js';
import { t as tr, applyI18n, getLang, setLang, speechVoice, LANGS } from './i18n/index.js';

applyI18n('garage.pageTitle');

const PICK_KEY = 'garage.pick';
let sel = Math.max(0, GAMES.findIndex(g => g.id === (localStorage.getItem(PICK_KEY) ?? '')));

// ---- the scene: a little island with a turntable, the sea round it ----
const stage = createStage({ ground: false, fogNear: 60, fogFar: 260, sunPos: [30, 60, 40], shadowSpan: 26 });
const { scene, camera, renderer } = stage;
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
const models: Array<THREE.Group | null> = GAMES.map(() => null);
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
function makeModel(e: GameEntry): Promise<THREE.Group> {
  const m = e.model;
  if (m.glb) return spawnVehicle(m.glb, { len: m.len, yaw: m.yaw ?? 0 });
  const g = m.make === 'plane' ? makePlane()
    : makeHelicopter(m.make === 'heliPolice' ? { body: 0x5a7fb5, band: 0xfaf7ef } : { body: 0xfaf7ef, band: 0xe25c5c });
  return Promise.resolve(fit(g, m.len));
}
GAMES.forEach((e, i) => {
  makeModel(e).then(g => {
    g.traverse(o => { if ((o as THREE.Mesh).isMesh) { o.castShadow = true; o.receiveShadow = true; } });
    g.visible = false;
    g.scale.setScalar(0.001);
    table.add(g);
    models[i] = g;
  }).catch(() => {});
});
/** each model's pop-in: 0 (gone) .. 1 (shown), and where it's heading */
const pop = GAMES.map(() => 0);
const flies = (i: number): boolean => GAMES[i].model.make !== undefined;

// ---- the carousel ----
const carousel = document.getElementById('carousel')!;
const tiles = GAMES.map((e, i) => {
  const t = document.createElement('div');
  t.className = 'tile';
  t.textContent = e.icon;
  t.style.setProperty('--c', e.color);
  t.addEventListener('click', () => { if (i === sel) go(); else choose(i); });
  carousel.append(t);
  return t;
});
const lastOff = GAMES.map(() => 0);
const nameT = document.querySelector('#name .t') as HTMLElement;
const nameB = document.querySelector('#name .b') as HTMLElement;
function layout(): void {
  const n = GAMES.length, half = Math.floor(n / 2);
  const gap = Math.min(innerWidth / (n + 0.5), innerHeight * 0.21);
  tiles.forEach((t, i) => {
    const off = ((i - sel + n + half) % n) - half;
    const a = Math.abs(off);
    // a tile wrapping round from one end to the other jumps, it doesn't fly across
    t.classList.toggle('jump', Math.abs(off - lastOff[i]) > half);
    lastOff[i] = off;
    const s = a === 0 ? 1.35 : a === 1 ? 0.95 : Math.max(0.55, 0.95 - (a - 1) * 0.13);
    t.style.transform = `translateX(${off * gap}px) translateY(${a === 0 ? -6 : a * 4}px) scale(${s})`;
    t.style.opacity = String(a === 0 ? 1 : Math.max(0.35, 1 - a * 0.16));
    t.style.zIndex = String(10 - a);
    t.classList.toggle('sel', a === 0);
  });
  requestAnimationFrame(() => tiles.forEach(t => t.classList.remove('jump')));
}
function showName(): void {
  const e = GAMES[sel];
  nameT.textContent = `${e.icon} ${e.title}`;
  nameB.textContent = e.blurb;
  // (restart the pop)
  nameT.style.animation = 'none';
  void nameT.offsetWidth;
  nameT.style.animation = '';
  document.documentElement.style.setProperty('--sel', e.color);
  ringMat.color.set(e.color);
}
function say(text: string): void {
  try {
    const synth = window.speechSynthesis;
    if (!synth) return;
    synth.cancel();
    const u = new SpeechSynthesisUtterance(text);
    // (in the chosen language: Portugal's voice when the system has one)
    const { lang, voice } = speechVoice();
    u.lang = lang;
    if (voice) u.voice = voice;
    u.rate = 0.95; u.pitch = 1.15;
    synth.speak(u);
  } catch { /* no voice: fine */ }
}
function choose(i: number): void {
  const n = GAMES.length;
  sel = ((i % n) + n) % n;
  try { localStorage.setItem(PICK_KEY, GAMES[sel].id); } catch { /* private mode */ }
  layout();
  showName();
  say(GAMES[sel].title);
}
addEventListener('resize', layout);
layout();
showName();

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
  drawLang();
  showName();
  say(GAMES[sel].title);
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
  going = true;
  say(tr('garage.letsGo', { title: GAMES[sel].title }));
  const wipe = document.getElementById('wipe')!;
  wipe.textContent = GAMES[sel].icon;
  wipe.classList.add('on');
  setTimeout(() => { location.href = GAMES[sel].url; }, 650);
}
document.getElementById('go')!.addEventListener('click', go);
renderer.domElement.addEventListener('click', go);

// ---- keys ----
addEventListener('keydown', e => {
  if (e.code === 'KeyL') pickLang(getLang() === 'pt' ? 'en' : 'pt');
  else if (e.code === 'ArrowLeft' || e.code === 'KeyA') choose(sel - 1);
  else if (e.code === 'ArrowRight' || e.code === 'KeyD') choose(sel + 1);
  else if (['Enter', 'Space', 'ArrowUp', 'KeyW', 'NumpadEnter'].includes(e.code)) { e.preventDefault(); go(); }
});

// ---- the wheel: turn to step (hold turned to keep stepping), the pedal or
// any button to go. Nothing counts until the wheel has been seen at rest,
// so a pedal already held down when the page opens doesn't start a game ----
const wheelIcon = document.getElementById('wheel') as unknown as SVGElement;
let armed = false, stepT = 0, ready = false, lastSteer = 0;
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
  lastSteer = steer;
}
void lastSteer;

// ---- the frame loop ----
const clock = new THREE.Clock();
let t = 0;
renderer.setAnimationLoop(() => {
  const dt = Math.min(clock.getDelta(), 0.05);
  t += dt;
  pollWheel(dt);
  table.rotation.y += dt * 0.45;
  // frame the chosen vehicle by its size (a kart close, the train further back)
  {
    const len = GAMES[sel].model.len, up = flies(sel) ? 1.6 : 0;
    const d = 5.5 + len * 0.95, h = 2.6 + len * 0.3 + up;
    camera.position.x += (0 - camera.position.x) * Math.min(1, dt * 3);
    camera.position.y += (h - camera.position.y) * Math.min(1, dt * 3);
    camera.position.z += (d - camera.position.z) * Math.min(1, dt * 3);
    camera.lookAt(0, -0.2 + up * 0.8, 0);
  }
  models.forEach((m, i) => {
    if (!m) return;
    const want = i === sel ? 1 : 0;
    pop[i] += (want - pop[i]) * Math.min(1, dt * (want ? 7 : 12));
    m.visible = pop[i] > 0.01;
    // a little overshoot as it pops in
    const e = pop[i], s = want ? e + Math.sin(e * Math.PI) * 0.12 : e;
    m.scale.setScalar(Math.max(0.001, s));
    m.position.y = 0.5 + (flies(i) ? 2 + Math.sin(t * 1.6) * 0.35 : 0) + (1 - e) * 1.5;
    if (going && i === sel) m.position.z += dt * 30;
  });
  // the helicopters' rotors turn, the plane's propeller spins
  const m = models[sel];
  if (m) {
    m.traverse(o => {
      if (o.userData.mainRotor) (o.userData.mainRotor as THREE.Object3D).rotation.y = t * 22;
      if (o.userData.tailRotor) (o.userData.tailRotor as THREE.Object3D).rotation.x = t * 30;
      if (o.userData.prop) (o.userData.prop as THREE.Object3D).rotation.z = t * 40;
    });
  }
  renderer.render(scene, camera);
});
