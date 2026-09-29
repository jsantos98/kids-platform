// Missions: emergency calls spawning around the player — fires (a house, a
// tree or a car), cats (up a tree or on a ledge), people in a burning
// building, patients — with the nearest-call lookup for the guidance and the
// markers + beacons over each call. Every call shows the real thing (G2):
// the house on the corner burning at its windows and roof under a column of
// smoke you can see over the roofs, a car parked at the kerb on fire, a
// burning tree, the cat up a tree (or on a building's ledge), someone hurt
// sitting on the pavement with a friend waving — and its `look` hands the
// same house, car or tree to the call's scene (activity/), which `variant`
// and `seed` decide the rest of.
import * as THREE from 'three';
import { rng, chunkSeed, type Rng } from '../../engine/rng.js';
import { bakedModel } from '../../engine/assets.js';
import { templateToMesh } from '../../engine/baked.js';
import { person, pet, type Rig } from '../../engine/rig.js';
import { graphFor, type StreetGraph, type SNode } from '../../worlds/streetGraph.js';
import { cityPlanFor, type District } from '../../worlds/cityPlan.js';
import { lotBuilding } from '../../worlds/cityChunk.js';
import { makeBeacon, makeIconSprite } from './guide3d.js';
import { isLandmarkLot } from './landmarks.js';
import { FireSystem, type Fire } from './fx/fire.js';
import { SmokeSystem, type SmokeEmitter } from './fx/smoke.js';
import type { CallLook } from './activity/common.js';
import type { SetDistrict } from './activity/set.js';

const TREES = ['tree-oak', 'tree-default', 'tree-fat', 'tree-detailed'];
const CARS = ['car-sedan', 'car-suv', 'car-taxi', 'car-hatch'];

/** a street set's district for the city's district at a call */
function setDistrict(d: District): SetDistrict {
  return d === 'downtown' ? 'downtown' : d === 'urban' || d === 'industrial' ? 'urban' : d === 'residential' ? 'residential' : 'park';
}

/** a kit template as a mesh (null when not baked) */
function kitMesh(name: string, s: number): THREE.Mesh | null {
  const tpl = bakedModel(name);
  if (!tpl) return null;
  const m = templateToMesh(tpl);
  m.scale.setScalar(s);
  m.castShadow = true;
  return m;
}

export type ObjectiveType = 'fire' | 'cat' | 'patient' | 'rescue';

/** the icon the HUD badge shows for a call kind — each call floats the same
 * one over itself, so calls standing close together can be told apart */
export function callIcon(type: ObjectiveType): string {
  return type === 'fire' || type === 'rescue' ? '🔥' : type === 'patient' ? '🆘' : '🐱';
}

export interface Objective {
  type: ObjectiveType;
  /** which scene: fire 'house' | 'tree' | 'car', cat 'tree' | 'building' */
  variant: string;
  /** seeds the mission scene's layout */
  seed: number;
  group: THREE.Group;
  /** its flames and smoke column (a fire or a burning building) */
  fires: Fire[];
  smoke: SmokeEmitter | null;
  /** the animated cat / people at it */
  rigs: Rig[];
  /** what it showed, for its scene */
  look?: CallLook;
  pos: THREE.Vector3;
  progress: number;
  need: number;
  /** the junction the call stands at (world coordinates) */
  gx: number;
  gz: number;
  marker: THREE.Object3D;
  /** tall light pillar standing on the mission (guide3d.ts) */
  beacon: THREE.Mesh;
  index: number;
  /** distance to the player, refreshed each frame */
  d: number;
}

export interface PlayerXZ {
  x: number;
  z: number;
  heading: number;
}

/** no call closer than this to where the game started, or to the kid when it appears (G2) */
export const MIN_CALL_DIST = 100;

export class Missions {
  objectives: Objective[] = [];
  cooldown = 0;
  index = 0;
  sFires = 0;
  sCats = 0;
  /** world offset of the current city (junctions are picked in city-local
   * coordinates, then shifted back out to the world) */
  private ox = 0;
  private oz = 0;
  // (set by setCity before any call spawns — a default here built island
  // (0,0) at boot for nothing)
  private graph!: StreetGraph;

  /** `calls` is the rotation of emergency kinds this mode answers (the
   * fire truck: fire, fire, cat; the ambulance: patients...) */
  /** the calls' flames and smoke (one system each for the whole city) */
  private fireFx: FireSystem;
  private smokeFx: SmokeSystem;

  constructor(private scene: THREE.Scene, readonly calls: ObjectiveType[] = ['fire', 'fire', 'cat']) {
    this.fireFx = new FireSystem(scene, 200, 60);
    this.smokeFx = new SmokeSystem(scene, 220);
  }

  /** step the calls' fire, smoke and animated characters */
  update(dt: number, camera: THREE.Camera, night: number): void {
    this.fireFx.night = night;
    this.smokeFx.light = 1 - night * 0.55;
    this.fireFx.update(dt, camera);
    this.smokeFx.update(dt, camera);
    for (const o of this.objectives) for (const r of o.rigs) r.update(dt);
  }

  /** how loud a burning call crackles for the kid at (x, z): 0 … 1 */
  fireNear(x: number, z: number): number {
    let best = 0;
    for (const o of this.objectives) {
      if (!o.fires.length) continue;
      best = Math.max(best, 1 - Math.hypot(o.pos.x - x, o.pos.z - z) / 60);
    }
    return best;
  }

  private bx = 0;
  private by = 0;
  /** where the game started: no call ever stands within MIN_CALL_DIST of
   * it (a call at the drop point opened its scene before the kid had moved) */
  private home: { x: number; z: number } | null = null;

  setCity(bx: number, by: number, ox: number, oz: number): void {
    this.bx = bx;
    this.by = by;
    this.graph = graphFor(bx, by);
    this.ox = ox;
    this.oz = oz;
  }

  spawn(player: PlayerXZ, forceChunkAt: (x: number, z: number) => void, forcedType?: ObjectiveType | null): void {
    const r: Rng = rng(chunkSeed(this.ox, this.oz, 5000 + this.index));
    const qType = new URLSearchParams(location.search).get('type');
    let type: ObjectiveType;
    if (forcedType) type = forcedType;
    else if ((qType === 'fire' || qType === 'cat' || qType === 'patient' || qType === 'rescue') && this.calls.includes(qType)) type = qType;
    else type = this.calls[this.index % this.calls.length];
    const diff = Math.min(this.sFires + this.sCats, 10);
    this.home ??= { x: player.x, z: player.z };
    const dist = this.index === 0 ? MIN_CALL_DIST + 15 + r() * 20 : Math.min(MIN_CALL_DIST + 10 + diff * 10, 240) + r() * 60;
    const a = this.index === 0 ? player.heading + 0.5 : r() * Math.PI * 2;
    // pick the corner of a REAL intersection (golden-angle resampling),
    // in the current city's local coordinates
    const lx = player.x - this.ox, lz = player.z - this.oz;
    // the call stands on a junction corner, 11 m out on the diagonal: past
    // the traffic-light poles (8.6 m) yet short of every corner lot, whose
    // buildings start 12 m up the street. Of the four corners it prefers
    // one with no tree row within 6 m — a canopy right beside the call hid
    // the fire from the road — and never a corner another call already has.
    const plan = cityPlanFor(this.bx, this.by);
    const treesNear = (x: number, z: number): number => {
      let n = 0;
      for (let cx = Math.floor(x / 64) - 1; cx <= Math.floor(x / 64) + 1; cx++) {
        for (let cz = Math.floor(z / 64) - 1; cz <= Math.floor(z / 64) + 1; cz++) {
          for (const l of plan.lots(cx, cz)) {
            if (l.kind !== 'trees' && l.kind !== 'garden') continue;
            const flip = Math.abs(Math.abs(l.ry) - Math.PI / 2) < 0.01;
            const hx = (flip ? l.d : l.w) / 2 + 3, hz = (flip ? l.w : l.d) / 2 + 3; // + canopy
            const dx = Math.max(0, Math.abs(x - l.x) - hx), dz = Math.max(0, Math.abs(z - l.z) - hz);
            if (Math.hypot(dx, dz) < 6) n++;
          }
        }
      }
      return n;
    };
    /** a junction's corners: along the bisector between neighbouring arms,
     * 7.8 m from both streets' centrelines (11 m out at a square corner) */
    const cornersOf = (n: { id: number; edges: number[] }): Array<[number, number]> => {
      const arms = n.edges.map(id => {
        const e = this.graph.edges[id];
        return e.a === n.id ? { x: e.ux, z: e.uz } : { x: -e.ux, z: -e.uz };
      }).sort((p, q) => Math.atan2(p.x, p.z) - Math.atan2(q.x, q.z));
      const out: Array<[number, number]> = [];
      for (let i = 0; i < arms.length; i++) {
        const u = arms[i], v = arms[(i + 1) % arms.length];
        let th = Math.atan2(v.x, v.z) - Math.atan2(u.x, u.z);
        while (th <= 0) th += Math.PI * 2;
        if (th >= Math.PI - 0.01) continue; // no corner on an open side
        const bx = u.x + v.x, bz = u.z + v.z, bl = Math.hypot(bx, bz) || 1;
        const d = Math.min(16, 7.8 / Math.sin(th / 2));
        out.push([(bx / bl) * d, (bz / bl) * d]);
      }
      for (let k = out.length - 1; k > 0; k--) {
        const m = (r() * (k + 1)) | 0;
        [out[k], out[m]] = [out[m], out[k]];
      }
      return out;
    };
    const home = this.home;
    const taken = (x: number, z: number): boolean =>
      this.objectives.some(o => Math.hypot(o.pos.x - x, o.pos.z - z) < 20)
      // (never at the drop point, nor right where the kid is now)
      || Math.hypot(x - home.x, z - home.z) < MIN_CALL_DIST
      || Math.hypot(x - player.x, z - player.z) < MIN_CALL_DIST;
    let gx = 0, gz = 0, ox2 = 11, oz2 = 11;
    // best corner so far: a clear one ends the search, else the corner with
    // the fewest tree rows around it is kept as the fallback
    let bestTrees = Infinity;
    // (the golden-angle probes first; then, if none found a free corner far
    // enough out, every signalized junction, nearest the wanted distance first)
    const probes: Array<SNode | null> = [];
    for (let attempt = 0; attempt < 24; attempt++) {
      const aa = a + attempt * 2.39996;
      probes.push(this.graph.nearestNode(lx + Math.sin(aa) * dist, lz + Math.cos(aa) * dist));
    }
    const rest = this.graph.nodes.filter(n => n.signalized)
      .sort((p, q) => Math.abs(Math.hypot(p.x - lx, p.z - lz) - dist) - Math.abs(Math.hypot(q.x - lx, q.z - lz) - dist));
    for (let attempt = 0; attempt < probes.length + rest.length && bestTrees > 0; attempt++) {
      if (attempt >= probes.length && bestTrees < Infinity) break;
      const n = attempt < probes.length ? probes[attempt] : rest[attempt - probes.length];
      if (!n || !n.signalized) continue;
      for (const [cx, cz] of cornersOf(n)) {
        if (taken(n.x + cx + this.ox, n.z + cz + this.oz)) continue;
        const t = treesNear(n.x + cx, n.z + cz);
        if (t < bestTrees) {
          bestTrees = t;
          gx = n.x; gz = n.z; ox2 = cx; oz2 = cz;
          if (t === 0) break;
        }
      }
    }
    const pos = new THREE.Vector3(gx + ox2 + this.ox, 0.15, gz + oz2 + this.oz);
    forceChunkAt(pos.x, pos.z);
    const need = type === 'patient' ? Math.min(2.5 + diff * 0.15, 4)
      : type === 'fire' ? Math.min(5.5 + diff * 0.3, 9)
      : Math.min(3 + diff * 0.2, 5);
    const variant = type === 'fire' ? (['house', 'tree', 'car'] as const)[(r() * 3) | 0]
      : type === 'cat' ? (r() < 0.5 ? 'tree' : 'building') : '';
    const seed = chunkSeed(this.ox + this.index, this.oz, 0x5ce7e);
    const group = new THREE.Group();
    group.position.copy(pos);
    this.scene.add(group);
    const fires: Fire[] = [];
    let smoke: SmokeEmitter | null = null;
    const rigs: Rig[] = [];
    const cxl = pos.x - this.ox, czl = pos.z - this.oz;
    const district = setDistrict(plan.districtAt(cxl, czl));
    let look: CallLook = { kind: 'none', district };
    // (the way from the corner back to its junction: what faces the road)
    const toNode = new THREE.Vector3(-ox2, 0, -oz2).normalize();
    type Front = { name: string; x: number; z: number; nx: number; nz: number; tx: number; tz: number; hx: number; top: number };
    // the real building on this corner: the nearest whose front looks this way
    const building = (): Front | null => {
      let best: Front | null = null, bd = 26;
      for (let cx = Math.floor(cxl / 64) - 1; cx <= Math.floor(cxl / 64) + 1; cx++) {
        for (let cz = Math.floor(czl / 64) - 1; cz <= Math.floor(czl / 64) + 1; cz++) {
          for (const lot of plan.lots(cx, cz)) {
            const b = lotBuilding(lot, plan.districtAt(lot.x, lot.z) === 'industrial');
            // (never a hospital or the prison: G16)
            if (!b || b.top < 4 || isLandmarkLot(this.bx, this.by, lot)) continue;
            const nx = Math.sin(b.ry), nz = Math.cos(b.ry);
            const fx = b.x + nx * b.hz, fz = b.z + nz * b.hz;
            const d = Math.hypot(fx - cxl, fz - czl);
            if (d < bd && (cxl - fx) * nx + (czl - fz) * nz > -2) {
              bd = d;
              best = { name: b.name, x: fx + this.ox, z: fz + this.oz, nx, nz, tx: Math.cos(b.ry), tz: -Math.sin(b.ry), hx: b.hx, top: b.top };
            }
          }
        }
      }
      return best;
    };
    const burnCar = (): void => {
      const name = CARS[(r() * CARS.length) | 0];
      const tpl = bakedModel(name);
      const m = kitMesh(name, tpl ? 4.3 / Math.max(tpl.size.x, tpl.size.z) : 1);
      if (m) {
        m.rotation.y = Math.atan2(toNode.x, toNode.z) + Math.PI / 4;
        m.position.y = 0.05;
        group.add(m);
      }
      fires.push(this.fireFx.add({ x: pos.x, y: 0.9, z: pos.z, size: 1.3, spreadX: 0.8, spreadZ: 0.8, tongues: 7, seed: seed % 97 }));
      fires.push(this.fireFx.add({ x: pos.x + 0.9, y: 1.5, z: pos.z - 0.4, size: 0.9, seed: seed % 89 }));
      smoke = this.smokeFx.add({ x: pos.x, y: 2.2, z: pos.z, rate: 2.6, size0: 1.2, size1: 6, rise: 2.4, life: 7, jitter: 0.8, dark: 0.85 });
      look = { kind: 'car', model: name, district };
    };
    const burnBuilding = (b: Front): void => {
      // flames at its windows on the street side, one on the roof, smoke over it
      for (let k = 0; k < 3; k++) {
        const along = (k - 1) * b.hx * 0.55, up = b.top * (0.3 + 0.25 * ((k + (seed & 1)) % 3));
        fires.push(this.fireFx.add({ x: b.x + b.tx * along + b.nx * 0.5, y: up, z: b.z + b.tz * along + b.nz * 0.5, size: 1.3, seed: seed % 71 + k }));
      }
      fires.push(this.fireFx.add({ x: b.x - b.nx * 1.8, y: b.top, z: b.z - b.nz * 1.8, size: 1.8, spreadX: 0.8, tongues: 8, seed: seed % 53 }));
      smoke = this.smokeFx.add({ x: b.x - b.nx * 3, y: b.top + 1, z: b.z - b.nz * 3, rate: 3, size0: 2, size1: 8, rise: 2.8, life: 9, jitter: 2, dark: 0.85 });
      look = { kind: 'building', model: b.name, district };
    };
    let treeR = 2;
    const tree = (burning: boolean): number => {
      const name = TREES[(r() * TREES.length) | 0];
      const s = 6 + r();
      const m = kitMesh(name, s);
      const h = (bakedModel(name)?.size.y ?? 1.2) * s;
      treeR = (bakedModel(name)?.size.x ?? 0.6) * s * 0.45;
      if (m) { m.rotation.y = r() * 6; m.position.y = 0.1; group.add(m); }
      if (burning) {
        // on the canopy's skin, on the side the road sees
        const face = Math.atan2(toNode.z, toNode.x);
        for (let k = 0; k < 3; k++) {
          const a = face + (k - 1) * 0.9;
          fires.push(this.fireFx.add({ x: pos.x + Math.cos(a) * treeR, y: h * (0.5 + 0.12 * ((k + 1) % 3)), z: pos.z + Math.sin(a) * treeR, size: 1.5, seed: seed % 61 + k }));
        }
        smoke = this.smokeFx.add({ x: pos.x, y: h, z: pos.z, rate: 2.6, size0: 1.5, size1: 7, rise: 2.5, life: 8, jitter: 1, dark: 0.8 });
      }
      look = { kind: 'tree', model: name, district };
      return h;
    };
    if (type === 'fire' || type === 'rescue') {
      const b = variant === 'house' || type === 'rescue' ? building() : null;
      if (b) burnBuilding(b);
      else if (variant === 'tree') tree(true);
      else burnCar();
      if (type === 'rescue') {
        // somebody on the pavement waving for help
        const who = person(seed % 12, 1.7);
        who.root.position.set(toNode.x * 1.5, 0, toNode.z * 1.5);
        who.root.rotation.y = Math.atan2(toNode.x, toNode.z);
        who.play('interact-right', { speed: 1.4 });
        group.add(who.root);
        rigs.push(who);
      }
    } else if (type === 'patient') {
      // hurt, sitting on the pavement; a friend waving the ambulance down
      const who = person(seed % 12, 1.65);
      who.root.rotation.y = Math.atan2(toNode.x, toNode.z);
      who.play('sit');
      const friend = person((seed + 5) % 12, 1.7);
      friend.root.position.set(toNode.z * 1.3 + toNode.x * 0.6, 0, -toNode.x * 1.3 + toNode.z * 0.6);
      friend.root.rotation.y = Math.atan2(toNode.x, toNode.z);
      friend.play('interact-right', { speed: 1.4 });
      group.add(who.root, friend.root);
      rigs.push(who, friend);
    } else {
      // the cat: up a tree on the corner, or on the ledge of the building there
      const cat = pet('cat', 0.8);
      cat.play('idle');
      const b = variant === 'building' ? building() : null;
      if (b) {
        const y = Math.min(b.top * 0.5, 6.5);
        const ledge = new THREE.Mesh(new THREE.BoxGeometry(2, 0.2, 0.9), new THREE.MeshLambertMaterial({ color: 0xeceae4 }));
        ledge.position.set(b.x + b.nx * 0.4 - pos.x, y - 0.1, b.z + b.nz * 0.4 - pos.z);
        ledge.rotation.y = Math.atan2(b.nx, b.nz);
        group.add(ledge);
        cat.root.position.set(b.x + b.nx * 0.45 - pos.x, y, b.z + b.nz * 0.45 - pos.z);
        cat.root.rotation.y = Math.atan2(b.nx, b.nz);
        look = { kind: 'building', model: b.name, district };
      } else {
        const h = tree(false);
        // (on the canopy's underside, on the road's side, in plain sight)
        cat.root.position.set(toNode.x * treeR * 1.05, h * 0.42, toNode.z * treeR * 1.05);
        cat.root.rotation.y = Math.atan2(toNode.x, toNode.z);
      }
      group.add(cat.root);
      rigs.push(cat);
    }
    const marker = makeIconSprite(callIcon(type));
    marker.position.set(pos.x, 5.4, pos.z);
    this.scene.add(marker);
    const beacon = makeBeacon(type === 'fire' || type === 'rescue' ? 0xff8a3c : type === 'patient' ? 0x7fb2d9 : 0xff8ad1);
    beacon.position.set(pos.x, 0, pos.z);
    this.scene.add(beacon);
    this.objectives.push({ type, variant, seed, group, fires, smoke, rigs, look, pos, progress: 0, need, gx: gx + this.ox, gz: gz + this.oz, marker, beacon, index: this.index, d: 1e9 });
    this.index++;
  }

  remove(o: Objective): void {
    const i = this.objectives.indexOf(o);
    if (i >= 0) this.objectives.splice(i, 1);
    this.scene.remove(o.group);
    for (const f of o.fires) this.fireFx.remove(f);
    // (its smoke stops; the puffs already up drift off and fade)
    if (o.smoke) this.smokeFx.remove(o.smoke);
    if (o.marker) this.scene.remove(o.marker);
    this.scene.remove(o.beacon);
  }

  nearest(x: number, z: number): { o: Objective | null; d: number } {
    let o: Objective | null = null, d = 1e9;
    for (const obj of this.objectives) {
      obj.d = Math.hypot(obj.pos.x - x, obj.pos.z - z);
      if (obj.d < d) { d = obj.d; o = obj; }
    }
    return { o, d };
  }
}
