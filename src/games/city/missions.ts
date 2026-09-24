// Missions: emergency calls spawning around the player — fires (a house, a
// tree or a car), cats (up a tree or on a ledge), people in a burning
// building, patients — with the nearest-call lookup for the guidance and the
// markers + beacons over each call. Arriving at a call opens its mission
// scene (activity/); `variant` and `seed` decide what that scene looks like.
import * as THREE from 'three';
import { C } from '../../engine/palette.js';
import { makeCatTree, makeFire, makeMarker, makePerson } from '../../kit/index.js';
import { rng, chunkSeed, type Rng } from '../../engine/rng.js';
import { graphFor, type StreetGraph } from '../../worlds/streetGraph.js';
import { cityPlanFor } from '../../worlds/cityPlan.js';
import { makeBeacon } from './guide3d.js';

export type ObjectiveType = 'fire' | 'cat' | 'patient' | 'rescue';

export interface Objective {
  type: ObjectiveType;
  /** which scene: fire 'house' | 'tree' | 'car', cat 'tree' | 'building' */
  variant: string;
  /** seeds the mission scene's layout */
  seed: number;
  group: THREE.Group;
  flames?: THREE.Mesh[];
  smoke?: THREE.Mesh[];
  pos: THREE.Vector3;
  progress: number;
  need: number;
  /** the junction the call stands at (world coordinates) */
  gx: number;
  gz: number;
  marker: THREE.Group;
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
  private graph: StreetGraph = graphFor(0, 0);

  /** `calls` is the rotation of emergency kinds this mode answers (the
   * fire truck: fire, fire, cat; the ambulance: patients...) */
  constructor(private scene: THREE.Scene, readonly calls: ObjectiveType[] = ['fire', 'fire', 'cat']) {}

  private bx = 0;
  private by = 0;

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
    const dist = this.index === 0 ? 26 + r() * 10 : Math.min(90 + diff * 10, 240) + r() * 60;
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
            if (l.kind !== 'trees') continue;
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
    const taken = (x: number, z: number): boolean =>
      this.objectives.some(o => Math.hypot(o.pos.x - x, o.pos.z - z) < 20);
    let gx = 0, gz = 0, ox2 = 11, oz2 = 11;
    // best corner so far: a clear one ends the search, else the corner with
    // the fewest tree rows around it is kept as the fallback
    let bestTrees = Infinity;
    for (let attempt = 0; attempt < 24 && bestTrees > 0; attempt++) {
      const aa = a + attempt * 2.39996;
      const px = lx + Math.sin(aa) * dist, pz = lz + Math.cos(aa) * dist;
      const n = this.graph.nearestNode(px, pz);
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
    let group: THREE.Group;
    let flames: THREE.Mesh[] | undefined;
    let smoke: THREE.Mesh[] | undefined;
    const variant = type === 'fire' ? (['house', 'tree', 'car'] as const)[(r() * 3) | 0]
      : type === 'cat' ? (r() < 0.5 ? 'tree' : 'building') : '';
    const seed = chunkSeed(this.ox + this.index, this.oz, 0x5ce7e);
    if (type === 'rescue') {
      // smoke and flames with somebody waving for help beside them
      const f = makeFire();
      group = f.group;
      flames = f.flames;
      smoke = f.smoke;
      const who = makePerson({ shirt: C.yellow, pants: C.dark });
      who.position.set(-1.6, 0, 0.6);
      group.add(who);
    } else if (type === 'fire') {
      const f = makeFire();
      group = f.group;
      flames = f.flames;
      smoke = f.smoke;
    } else if (type === 'patient') {
      // a person waving for help on the ground (winched up by the helicopter)
      group = makePerson({ shirt: C.orange, pants: C.dark, cap: C.white });
      group.position.set(0, 0.15, 0);
      group.rotation.y = r() * Math.PI * 2;
    } else {
      group = makeCatTree(r);
    }
    group.position.copy(pos);
    group.position.y = pos.y;
    this.scene.add(group);
    const markerColor = type === 'fire' || type === 'rescue' ? 0xffc93c : type === 'patient' ? 0x7fb2d9 : 0xff8ad1;
    const marker = makeMarker(markerColor);
    marker.position.set(pos.x, 6.4, pos.z);
    this.scene.add(marker);
    const beacon = makeBeacon(type === 'fire' || type === 'rescue' ? 0xff8a3c : type === 'patient' ? 0x7fb2d9 : 0xff8ad1);
    beacon.position.set(pos.x, 0, pos.z);
    this.scene.add(beacon);
    this.objectives.push({ type, variant, seed, group, flames, smoke, pos, progress: 0, need, gx: gx + this.ox, gz: gz + this.oz, marker, beacon, index: this.index, d: 1e9 });
    this.index++;
  }

  remove(o: Objective): void {
    const i = this.objectives.indexOf(o);
    if (i >= 0) this.objectives.splice(i, 1);
    this.scene.remove(o.group);
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
