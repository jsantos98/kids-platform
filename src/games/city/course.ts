// Checkpoint courses: 6 seeded gates, all live at once and passed in any
// order — arches over the streets, rings in the sky over the island for the
// plane, buoy pairs along the sailing lane for the boat. Every gate still to
// pass glows (the arches and buoys carry a beacon each); the guide arrows
// point at the nearest one — for the plane the nearest AHEAD, held until it
// is passed or another is much nearer, so its auto-climb doesn't flip-flop
// between rings. Pass them all and a new course is laid (G3).
import * as THREE from 'three';
import { rng, chunkSeed, type Rng } from '../../engine/rng.js';
import { citySeed, type CityRef } from '../../worlds/cityGrid.js';
import { graphFor, leaving, type SEdge } from '../../worlds/streetGraph.js';
import { ISLAND } from '../../worlds/world.js';
import { coastFor } from '../../worlds/coast.js';
import { boatLoop, hullObject } from './sea.js';
import { makeBeacon, pulseBeacon, makeIconSprite, GOAL_ICON } from './guide3d.js';
import { HELI_ALT } from './player.js';
import type { CourseKind } from './modes.js';

const GATES = 6;
const LIT = 0xffd35c;
const DIM = 0xfff1c9;

export interface Gate {
  /** world position of the gate centre (y = height of its middle) */
  x: number;
  z: number;
  y: number;
  /** heading of travel through the gate */
  yaw: number;
  group: THREE.Group;
  paint: THREE.Mesh[];
  beacon: THREE.Mesh | null;
  passed: boolean;
}

const litMat = new THREE.MeshLambertMaterial({ color: LIT, emissive: 0x6b4a00 });
const dimMat = new THREE.MeshLambertMaterial({ color: DIM, transparent: true, opacity: 0.55 });
const postMat = new THREE.MeshLambertMaterial({ color: 0xfaf7ef });
const ringGeo = new THREE.TorusGeometry(5, 0.5, 10, 32);
const postGeo = new THREE.CylinderGeometry(0.22, 0.26, 6, 10);
const bannerGeo = new THREE.BoxGeometry(16.2, 1.1, 0.35);

export class Course {
  gates: Gate[] = [];
  private chain = 0;
  /** the gate the guide (and the plane's auto-climb) aims at */
  private aimed: Gate | null = null;

  constructor(private scene: THREE.Scene, readonly kind: CourseKind, private plane = false) {}

  /** gates passed so far */
  get passedCount(): number { return this.gates.reduce((n, g) => n + (g.passed ? 1 : 0), 0); }

  /** every gate passed (or no course laid) */
  get done(): boolean { return this.gates.every(g => g.passed); }

  /** the gate to aim for from (x, z) heading `heading` (world): the nearest
   * unpassed one, weighted toward the ones ahead, and kept until it's
   * passed or another scores a third better */
  aim(x: number, z: number, heading: number): Gate | null {
    const score = (g: Gate): number => {
      const d = Math.hypot(g.x - x, g.z - z);
      const c = d > 1 ? (Math.sin(heading) * (g.x - x) + Math.cos(heading) * (g.z - z)) / d : 1;
      return d * (1.6 - 0.6 * c);
    };
    let best: Gate | null = null, bs = Infinity;
    for (const g of this.gates) {
      if (g.passed) continue;
      const sc = score(g);
      if (sc < bs) { bs = sc; best = g; }
    }
    if (!this.aimed || this.aimed.passed || (best && bs < 0.67 * score(this.aimed))) this.aimed = best;
    return this.aimed;
  }

  /** the gate aimed at last (see aim) */
  get target(): Gate | null { return this.aimed && !this.aimed.passed ? this.aimed : null; }

  /** lay a fresh course in the player's city, around them */
  start(city: CityRef, x: number, z: number, heading: number): void {
    this.clear();
    const r = rng(chunkSeed(citySeed(city.bx, city.by), 0xc0c5e, this.chain++));
    const spots = this.kind === 'gates' ? this.streetSpots(r, city, x, z, heading)
      : this.kind === 'rings' ? this.skySpots(r, city, x, z)
        : this.seaSpots(city, x, z, heading);
    for (const s of spots) this.gates.push(this.makeGate(s.x, s.z, s.y, s.yaw));
    this.paint();
  }

  clear(): void {
    for (const g of this.gates) {
      this.scene.remove(g.group);
      if (g.beacon) this.scene.remove(g.beacon);
    }
    this.gates = [];
    this.aimed = null;
  }

  /** pass any gate the vehicle (centre at x, y, z) is in; returns 'passed' /
   * 'finished' on those frames */
  update(elapsed: number, x: number, y: number, z: number): 'passed' | 'finished' | null {
    let out: 'passed' | 'finished' | null = null;
    for (const [k, gate] of this.gates.entries()) {
      if (gate.passed) continue;
      if (this.kind === 'rings') gate.group.rotation.z = Math.sin(elapsed * 1.5 + k) * 0.05;
      else gate.group.position.y = this.kind === 'buoys' ? Math.sin(elapsed * 1.3 + k) * 0.15 : 0;
      const flat = Math.hypot(x - gate.x, z - gate.z);
      if (gate.beacon) pulseBeacon(gate.beacon, elapsed, k, flat + 20);
      const d = this.kind === 'rings' ? Math.hypot(x - gate.x, (y - gate.y) * 0.8, z - gate.z) : flat;
      if (d > (this.kind === 'rings' ? 6 : 8.5)) continue;
      gate.passed = true;
      this.scene.remove(gate.group);
      if (gate.beacon) this.scene.remove(gate.beacon);
      out = 'passed';
    }
    if (out && this.done) out = 'finished';
    return out;
  }

  /** every gate still to pass glows */
  private paint(): void {
    for (const g of this.gates) for (const m of g.paint) m.material = g.passed ? dimMat : litMat;
  }

  private makeGate(x: number, z: number, y: number, yaw: number): Gate {
    const group = new THREE.Group();
    const paint: THREE.Mesh[] = [];
    if (this.kind === 'rings') {
      const ring = new THREE.Mesh(ringGeo, dimMat);
      group.add(ring);
      paint.push(ring);
      group.position.set(x, y, z);
    } else if (this.kind === 'gates') {
      // an arch over the whole street: posts on the sidewalks, banner up top
      for (const s of [-8, 8]) {
        const post = new THREE.Mesh(postGeo, postMat);
        post.position.set(s, 3, 0);
        post.castShadow = true;
        group.add(post);
      }
      const banner = new THREE.Mesh(bannerGeo, dimMat);
      banner.position.y = 6;
      group.add(banner);
      paint.push(banner);
      group.position.set(x, 0, z);
    } else {
      // a pair of flag buoys either side of the sailing line
      for (const s of [-6.5, 6.5]) {
        const b = hullObject('buoy-flag', 2.6, () => {
          const m = new THREE.Mesh(new THREE.CylinderGeometry(0.6, 0.8, 1.4, 10), postMat);
          m.position.y = 0.5;
          return m;
        });
        b.position.set(s, 0, 0);
        group.add(b);
      }
      // a glowing float line between them marks the gap
      const line = new THREE.Mesh(new THREE.BoxGeometry(11, 0.25, 0.25), dimMat);
      line.position.y = 0.3;
      group.add(line);
      paint.push(line);
      group.position.set(x, 0, z);
    }
    group.rotation.y = yaw;
    // its icon floats over it — the flag over an arch, a ring over a ring, a
    // flag over the buoys' gap — as the HUD badge shows it
    const icon = makeIconSprite(GOAL_ICON[this.kind], this.kind === 'rings' ? 3.4 : 3);
    icon.position.y = this.kind === 'rings' ? 7.5 : this.kind === 'gates' ? 9.5 : 4.2;
    group.add(icon);
    this.scene.add(group);
    // the arches and buoys carry a tall beacon each (rings hang in the sky)
    let beacon: THREE.Mesh | null = null;
    if (this.kind !== 'rings') {
      beacon = makeBeacon(LIT);
      beacon.position.set(x, 0, z);
      this.scene.add(beacon);
    }
    return { x, z, y, yaw, group, paint, beacon, passed: false };
  }

  /** gates at street mid-blocks along a random drive (no U-turns, clear of
   * level crossings), starting at the junction ahead of the car */
  private streetSpots(r: Rng, city: CityRef, x: number, z: number, heading: number): Array<{ x: number; z: number; y: number; yaw: number }> {
    const g = graphFor(city.bx, city.by);
    const here = g.nearest(x - city.ox, z - city.oz);
    if (!here) return [];
    let e: SEdge = here.edge;
    const fwd = Math.sin(heading) * e.ux + Math.cos(heading) * e.uz >= 0;
    let node = fwd ? e.b : e.a;
    const out: Array<{ x: number; z: number; y: number; yaw: number }> = [];
    for (let k = 0; k < GATES * 3 && out.length < GATES; k++) {
      const n = g.nodes[node];
      const opts = n.edges.map(id => g.edges[id]).filter(o => o.id !== e.id && !g.other(o, node).mouth);
      if (!opts.length) break;
      const next = opts[(r() * opts.length) | 0];
      const dirOut = leaving(g, next, node);
      e = next;
      node = g.other(next, node).id;
      // mid-block, nudged away from any level crossing on the edge
      let s = e.len / 2;
      for (const c of e.crossings) if (Math.abs(c.s - s) < 16) s = c.s < s ? c.s + 18 : c.s - 18;
      if (s < 10 || s > e.len - 10) continue;
      const p = g.sample(e, s);
      out.push({ x: p.x + city.ox, z: p.z + city.oz, y: 0, yaw: Math.atan2(dirOut.x, dirOut.z) });
    }
    return out;
  }

  /** rings spread over the island around the plane: over land, at least
   * 120 m apart and 90-420 m from it, each facing the plane */
  private skySpots(r: Rng, city: CityRef, x: number, z: number): Array<{ x: number; z: number; y: number; yaw: number }> {
    const coast = coastFor(city.bx, city.by);
    const px = x - city.ox, pz = z - city.oz;
    const out: Array<{ x: number; z: number; y: number; yaw: number }> = [];
    for (let tries = 0; tries < 400 && out.length < GATES; tries++) {
      const a = r() * Math.PI * 2, d = 90 + r() * 330;
      const nx = px + Math.sin(a) * d, nz = pz + Math.cos(a) * d;
      if (nx < 70 || nx > ISLAND - 70 || nz < 70 || nz > ISLAND - 70 || !coast.inLand(nx, nz, 40)) continue;
      if (out.some(o => Math.hypot(o.x - city.ox - nx, o.z - city.oz - nz) < 120)) continue;
      const y = this.plane ? 24 + r() * 22 : HELI_ALT + 2;
      out.push({ x: nx + city.ox, z: nz + city.oz, y, yaw: Math.atan2(nx - px, nz - pz) });
    }
    return out;
  }

  /** buoy gates along the offshore sailing lane, ~110 m apart, both ways
   * from the boat, facing along the lane */
  private seaSpots(city: CityRef, x: number, z: number, heading: number): Array<{ x: number; z: number; y: number; yaw: number }> {
    const loop = boatLoop(city.bx, city.by);
    const n = loop.length;
    const lx = x - city.ox, lz = z - city.oz;
    let k0 = 0, best = Infinity;
    loop.forEach((p, k) => { const d = (p.x - lx) ** 2 + (p.z - lz) ** 2; if (d < best) { best = d; k0 = k; } });
    const a = loop[k0], b = loop[(k0 + 1) % n];
    const dir = Math.sin(heading) * (b.x - a.x) + Math.cos(heading) * (b.z - a.z) >= 0 ? 1 : -1;
    const out: Array<{ x: number; z: number; y: number; yaw: number }> = [];
    for (let k = 1; k <= GATES; k++) {
      // alternating ahead / behind: 1, -1, 2, -2, 3, -3 lane steps
      const step = (k % 2 ? 1 : -1) * Math.ceil(k / 2);
      const i = (((k0 + dir * step * 36) % n) + n) % n;
      const p = loop[i], q = loop[(i + dir + n) % n];
      out.push({ x: p.x + city.ox, z: p.z + city.oz, y: 0, yaw: Math.atan2(q.x - p.x, q.z - p.z) });
    }
    return out;
  }
}
