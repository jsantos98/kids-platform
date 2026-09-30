// G6 check: the trains and their stations.
//   · every platform part a train passes (its deck, canopy, posts, STOP
//     board — platform.ts) stays clear of the widest train the railway runs,
//     each model measured from its GLB (node transforms and accessor bounds,
//     scaled to its length as spawnVehicle scales it) — the canopy used to
//     reach 1.3 m out and every train drove through it;
//   · the doors game (trainDoors.ts) can't get a child stuck: a perfect
//     player, a child swinging the wheel and nobody at the wheel all get the
//     doors open and shut again, and the train never moves while they're open.
//   npx tsx tools/check-trains.ts
import './headless-dom.js';
import { readFileSync } from 'node:fs';
import * as THREE from 'three';
import { TRAIN_MODELS } from '../src/games/city/railway.js';
import { PLATFORM_PARTS } from '../src/games/city/platform.js';
import { TrainDoors, AUTO_T } from '../src/games/city/trainDoors.js';
import { Railway } from '../src/games/city/railway.js';
import { setCityBase } from '../src/worlds/cityGrid.js';

let fails = 0;
const fail = (m: string): void => { fails++; console.log('  FAIL ' + m); };

/** a GLB's bounding box in its own frame, every mesh node transformed */
function glbBounds(file: string): THREE.Box3 {
  const b = readFileSync(file);
  const n = b.readUInt32LE(12);
  const j = JSON.parse(b.subarray(20, 20 + n).toString('utf8'));
  const box = new THREE.Box3();
  const walk = (idx: number, parent: THREE.Matrix4): void => {
    const node = j.nodes[idx];
    const m = new THREE.Matrix4();
    if (node.matrix) m.fromArray(node.matrix);
    else m.compose(new THREE.Vector3(...(node.translation ?? [0, 0, 0])), new THREE.Quaternion(...(node.rotation ?? [0, 0, 0, 1])), new THREE.Vector3(...(node.scale ?? [1, 1, 1])));
    const w = parent.clone().multiply(m);
    if (node.mesh !== undefined) {
      for (const p of j.meshes[node.mesh].primitives) {
        const a = j.accessors[p.attributes.POSITION];
        const lo = new THREE.Vector3(...a.min), hi = new THREE.Vector3(...a.max);
        box.union(new THREE.Box3(lo, hi).applyMatrix4(w));
      }
    }
    for (const c of node.children ?? []) walk(c, w);
  };
  for (const r of j.scenes[j.scene ?? 0].nodes) walk(r, new THREE.Matrix4());
  return box;
}

// ---- the platforms clear the trains ----
let widest = 0, which = '';
for (const m of TRAIN_MODELS) {
  const bb = glbBounds('public' + m.url);
  const size = bb.getSize(new THREE.Vector3());
  const s = m.len / Math.max(size.x, size.z);
  // (the models face +z: their width is x; off-centre models count their far side)
  const half = Math.max(Math.abs(bb.min.x), Math.abs(bb.max.x)) * s;
  if (half > widest) { widest = half; which = m.url.split('/').pop()!; }
}
const RAIL_TOP = 0.21;
for (const p of PLATFORM_PARTS) {
  if (p.y1 <= RAIL_TOP) continue;
  if (p.inner < widest + 0.1) fail(`the platform's ${p.name} reaches ${p.inner.toFixed(2)} m from the track — the widest train (${which}) is ${widest.toFixed(2)} m wide each side`);
}
console.log(`platforms: the widest train (${which}) ${widest.toFixed(2)} m each side; the nearest platform part ${Math.min(...PLATFORM_PARTS.map(p => p.inner)).toFixed(2)} m`);

// ---- the doors game can't get a child stuck ----
{
  const DT = 1 / 60;
  const play = (steer: (d: TrainDoors, t: number) => number, label: string): number => {
    const d = new TrainDoors();
    let opened = -1;
    for (let t = 0; t < 90; t += DT) {
      // (people get off and on for 3 s once the doors are open)
      const busy = opened >= 0 && t - opened < 3;
      const ev = d.update(DT, steer(d, t), busy);
      if (ev.includes('opened')) opened = t;
      if (ev.includes('closed')) return t;
    }
    fail(`the doors game with ${label} never ended`);
    return Infinity;
  };
  const perfect = play(d => d.aim(), 'a perfect player');
  const child = play((_d, t) => (Math.sin(t * 0.37) > 0.6 ? 0 : Math.sin(t * 1.1) * 0.95), 'a child swinging the wheel');
  const nobody = play(() => 0, 'nobody at the wheel');
  if (nobody > 2 * AUTO_T + 6) fail(`nobody at the wheel took ${nobody.toFixed(1)} s`);
  if (child > 45) fail(`a child took ${child.toFixed(1)} s`);
  console.log(`doors: perfect ${perfect.toFixed(1)} s · child ${child.toFixed(1)} s · nobody ${nobody.toFixed(1)} s`);
}

// ---- the train can't move with its doors open ----
{
  setCityBase(7);
  const rail = new Railway(new THREE.Scene());
  rail.addPlayer(1, 0, 300);
  rail.setKidDoors(true);
  rail.setControls(1, 0);
  for (let k = 0; k < 300; k++) rail.update(1 / 60, k / 60, 0, 0);
  const v = rail.playerPose()?.v ?? 0;
  if (v > 0.01) fail(`the train moved (${v.toFixed(2)} m/s) with its doors open`);
  rail.setKidDoors(false);
  for (let k = 0; k < 300; k++) rail.update(1 / 60, 5 + k / 60, 0, 0);
  if ((rail.playerPose()?.v ?? 0) < 0.5) fail("the train didn't go once its doors were shut");
}

if (fails) { console.log(`trains: FAIL — ${fails} problem(s) (G6)`); process.exit(1); }
console.log('trains: PASS — the platforms clear every train, the doors game always ends, and the train waits for its doors (G6)');
