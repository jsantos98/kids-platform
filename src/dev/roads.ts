// Static road-tile inspection rig: bakes real chunks of a real city with the
// same pipeline the game uses, then renders them from fixed cameras. No game
// loop, no streaming — what you see is stable while tuning tile placement.
//   /dev-roads.html?seed=3            -> auto-framed junction examples
//   ?x=320&z=512&h=140&tilt=90        -> manual camera (world x/z, height, tilt°)
import * as THREE from 'three';
import { prepBakedModels } from '../engine/assets.js';
import { generateCityChunk } from '../worlds/cityChunk.js';
import { graphFor, leaving } from '../worlds/streetGraph.js';
import { setCityBase, citySeed } from '../worlds/cityGrid.js';
import { ISLAND, WORLD_CHUNKS } from '../worlds/world.js';
import { KITDEFS } from '../games/city/kitdefs.js';

const q = new URLSearchParams(location.search);
setCityBase(q.get('seed') !== null ? Number(q.get('seed')) || 3 : 3);

// surface bake failures that the game normally logs to console only
const logLines: string[] = [];
const origWarn = console.warn.bind(console);
console.warn = (...a: unknown[]) => { logLines.push(a.map(String).join(' ')); origWarn(...a); };
const origErr = console.error.bind(console);
console.error = (...a: unknown[]) => { logLines.push(a.map(String).join(' ')); origErr(...a); };

await prepBakedModels(KITDEFS);

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(innerWidth, innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.setClearColor(0x9ec7dd);
document.body.appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.fog = new THREE.Fog(0x9ec7dd, 400, 900);
const sun = new THREE.DirectionalLight(0xfff6e8, 2.2);
sun.position.set(120, 260, 80);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
sun.shadow.camera.left = -260; sun.shadow.camera.right = 260;
sun.shadow.camera.top = 260; sun.shadow.camera.bottom = -260;
sun.shadow.camera.far = 800;
scene.add(sun);
scene.add(new THREE.HemisphereLight(0xdfeaff, 0xc9bda0, 0.9));

// bake a 4x4-chunk window of city (0,0) centred on the requested target
const wxq = Number(q.get('x')), wzq = Number(q.get('z'));
const cx0 = Math.max(0, Math.min(WORLD_CHUNKS - 4, ((Number.isFinite(wxq) ? wxq : (Number(q.get('cx')) || 5)) / 64 - 2) | 0));
const cz0 = Math.max(0, Math.min(WORLD_CHUNKS - 4, ((Number.isFinite(wzq) ? wzq : (Number(q.get('cz')) || 5)) / 64 - 2) | 0));
for (let cx = cx0; cx < cx0 + 4; cx++) {
  for (let cz = cz0; cz < cz0 + 4; cz++) {
    const { mesh } = generateCityChunk(0, 0, cx, cz);
    scene.add(mesh);
  }
}

// ground far-plane so the horizon reads
const ground = new THREE.Mesh(
  new THREE.PlaneGeometry(4000, 4000),
  new THREE.MeshLambertMaterial({ color: 0xa9c88b }),
);
ground.rotation.x = -Math.PI / 2;
ground.position.y = -0.05;
scene.add(ground);

const wx = Number(q.get('x')) || (cx0 + 2) * 64;
const wz = Number(q.get('z')) || (cz0 + 2) * 64;
const h = Number(q.get('h')) || 150;
const tilt = (Number(q.get('tilt')) ?? 90) * Math.PI / 180;
const yaw = (Number(q.get('yaw')) ?? 0) * Math.PI / 180;

const camera = new THREE.PerspectiveCamera(55, innerWidth / innerHeight, 0.5, 3000);
const dist = h / Math.max(0.15, Math.cos(tilt));
camera.position.set(wx + Math.sin(yaw) * dist * Math.sin(tilt), h, wz + Math.cos(yaw) * dist * Math.sin(tilt));
camera.lookAt(wx, 0, wz);
renderer.render(scene, camera);

// archetype finder: first node of each road-junction kind, for quick framing
// (arms read from the street graph: which compass directions leave the node)
const graph = graphFor(0, 0);
const kinds: Record<string, string> = {};
for (const n of graph.nodes) {
  const a = [false, false, false, false]; // w e n s
  for (const eid of n.edges) {
    const d = leaving(graph, graph.edges[eid], n.id);
    if (Math.abs(d.x) > Math.abs(d.z)) a[d.x < 0 ? 0 : 1] = true;
    else a[d.z < 0 ? 2 : 3] = true;
  }
  const cnt = a.filter(Boolean).length;
  let k: string | null = null;
  if (n.plaza) k = 'roundabout';
  else if (cnt === 4) k = n.signalized ? 'cross-lights' : 'cross';
  else if (cnt === 2 && ((a[0] && a[1]) || (a[2] && a[3]))) k = 'pass-' + (a[0] ? 'ew' : 'ns');
  else if (cnt === 3) k = 'T-miss-' + 'wens'[a.findIndex(v => !v)];
  else if (cnt === 2) k = 'bend-' + (a[0] && a[3] ? 'ws' : a[1] && a[3] ? 'se' : a[1] && a[2] ? 'en' : 'wn');
  else if (cnt === 1) k = (n.mouth ? 'mouth-' : 'end-') + 'wens'[a.findIndex(v => v)];
  if (k && !kinds[k]) kinds[k] = `${n.x},${n.z}`;
}

const info = document.createElement('pre');
info.style.cssText = 'position:fixed;top:8px;left:8px;margin:0;padding:6px 10px;background:#fff9;font:11px monospace;border-radius:6px;max-height:70vh;overflow:auto';
info.textContent = `city(0,0) seed=${q.get('seed') ?? 3} chunks ${cx0}..${cx0 + 3}\ncam x=${wx.toFixed(0)} z=${wz.toFixed(0)} h=${h} tilt=${(tilt * 180 / Math.PI).toFixed(0)}\n` +
  Object.entries(kinds).map(([k, v]) => k + ' -> ' + v).join('\n') +
  (logLines.length ? '\nWARNINGS:\n' + logLines.slice(0, 12).join('\n') : '');
document.body.appendChild(info);

// probe handle for in-page inspection of the real rendered scene
(window as unknown as { __rig: unknown }).__rig = { scene, camera, renderer, THREE };

// standalone template previews: each baked road piece at game scale in a
// row north of the chunk window — pale here means the BAKE is broken
import { bakedModel } from '../engine/assets.js';
{
  const names = ['road-straight', 'road-crossroad', 'road-crossroad-path', 'road-intersection',
    'road-intersection-path', 'road-bend', 'road-end', 'road-roundabout'];
  const slate = new THREE.MeshLambertMaterial({ vertexColors: true });
  let k = 0;
  for (const n of names) {
    const t = bakedModel(n);
    if (!t) continue;
    const group = new THREE.Group();
    for (const g of t.geos) group.add(new THREE.Mesh(g, slate));
    group.position.set(wx - 60 + k * 30, 1, wz + 45);
    group.scale.setScalar(4);
    scene.add(group);
    k++;
  }
}
