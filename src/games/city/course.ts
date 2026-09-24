// Checkpoint courses: a seeded chain of 6 gates to pass in order — arches over
// the streets for the police car, rings in the sky for the police helicopter
// and the plane, buoy pairs off the shore for the boat. The next gate glows
// and carries a beacon; the guide arrows point at it. Pass them all and a new
// course is laid.
import * as THREE from 'three';
import { rng, chunkSeed, type Rng } from '../../engine/rng.js';
import { citySeed, type CityRef } from '../../worlds/cityGrid.js';
import { graphFor, leaving, type SEdge } from '../../worlds/streetGraph.js';
import { ISLAND } from '../../worlds/world.js';
import { boatLoop, hullObject } from './sea.js';
import { makeBeacon, pulseBeacon } from './guide3d.js';
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
}

const litMat = new THREE.MeshLambertMaterial({ color: LIT, emissive: 0x6b4a00 });
const dimMat = new THREE.MeshLambertMaterial({ color: DIM, transparent: true, opacity: 0.55 });
const postMat = new THREE.MeshLambertMaterial({ color: 0xfaf7ef });
const ringGeo = new THREE.TorusGeometry(5, 0.5, 10, 32);
const postGeo = new THREE.CylinderGeometry(0.22, 0.26, 6, 10);
const bannerGeo = new THREE.BoxGeometry(16.2, 1.1, 0.35);

export class Course {
  gates: Gate[] = [];
  next = 0;
  private beacon: THREE.Mesh;
  private chain = 0;

  constructor(private scene: THREE.Scene, readonly kind: CourseKind, private plane = false) {
    this.beacon = makeBeacon(LIT);
    this.beacon.visible = false;
    scene.add(this.beacon);
  }

  /** gates still to pass */
  get remaining(): number { return this.gates.length - this.next; }

  /** the gate to fly/drive/sail through next */
  target(): Gate | null { return this.gates[this.next] ?? null; }

  /** lay a fresh course in the player's city, starting ahead of them */
  start(city: CityRef, x: number, z: number, heading: number): void {
    this.clear();
    const r = rng(chunkSeed(citySeed(city.bx, city.by), 0xc0c5e, this.chain++));
    const spots = this.kind === 'gates' ? this.streetSpots(r, city, x, z, heading)
      : this.kind === 'rings' ? this.skySpots(r, city, x, z, heading)
        : this.seaSpots(city, x, z, heading);
    for (const s of spots) this.gates.push(this.makeGate(s.x, s.z, s.y, s.yaw));
    this.next = 0;
    this.paint();
  }

  clear(): void {
    for (const g of this.gates) this.scene.remove(g.group);
    this.gates = [];
    this.next = 0;
    this.beacon.visible = false;
  }

  /** advance when the vehicle (centre at x, y, z) passes the next gate;
   * returns 'passed' / 'finished' on those frames */
  update(elapsed: number, x: number, y: number, z: number): 'passed' | 'finished' | null {
    const g = this.target();
    if (!g) return null;
    for (const [k, gate] of this.gates.entries()) {
      if (this.kind === 'rings') gate.group.rotation.z = Math.sin(elapsed * 1.5 + k) * 0.05;
      else gate.group.position.y = this.kind === 'buoys' ? Math.sin(elapsed * 1.3 + k) * 0.15 : 0;
    }
    const d = this.kind === 'rings'
      ? Math.hypot(x - g.x, (y - g.y) * 0.8, z - g.z)
      : Math.hypot(x - g.x, z - g.z);
    pulseBeacon(this.beacon, elapsed, 0, Math.hypot(x - g.x, z - g.z) + 20);
    if (d > (this.kind === 'rings' ? 6 : 8.5)) return null;
    this.scene.remove(g.group);
    this.next++;
    this.paint();
    return this.next >= this.gates.length ? 'finished' : 'passed';
  }

  /** the next gate glows and wears the beacon; the rest wait, pale */
  private paint(): void {
    this.gates.forEach((g, k) => {
      for (const m of g.paint) m.material = k === this.next ? litMat : dimMat;
    });
    const t = this.target();
    this.beacon.visible = !!t && this.kind !== 'rings';
    if (t) this.beacon.position.set(t.x, 0, t.z);
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
    this.scene.add(group);
    return { x, z, y, yaw, group, paint };
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

  /** rings on a meandering flight over the island, 110-170 m apart */
  private skySpots(r: Rng, city: CityRef, x: number, z: number, heading: number): Array<{ x: number; z: number; y: number; yaw: number }> {
    const out: Array<{ x: number; z: number; y: number; yaw: number }> = [];
    let px = x - city.ox, pz = z - city.oz, h = heading;
    for (let k = 0; k < GATES; k++) {
      h += (r() - 0.5) * 2 * (0.35 + 0.8 * r());
      const step = 110 + r() * 60;
      let nx = px + Math.sin(h) * step, nz = pz + Math.cos(h) * step;
      // bounce off the island's edge so the course stays over the city
      if (nx < 70 || nx > ISLAND - 70) { h = -h; nx = Math.max(70, Math.min(ISLAND - 70, nx)); }
      if (nz < 70 || nz > ISLAND - 70) { h = Math.PI - h; nz = Math.max(70, Math.min(ISLAND - 70, nz)); }
      const yaw = Math.atan2(nx - px, nz - pz);
      const y = this.plane ? 24 + r() * 22 : HELI_ALT + 2;
      out.push({ x: nx + city.ox, z: nz + city.oz, y, yaw });
      px = nx; pz = nz; h = yaw;
    }
    return out;
  }

  /** buoy gates along the offshore sailing lane, ~110 m apart, heading the
   * way the boat is pointing */
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
      const i = (((k0 + dir * k * 36) % n) + n) % n;
      const p = loop[i], q = loop[(i + dir + n) % n];
      out.push({ x: p.x + city.ox, z: p.z + city.oz, y: 0, yaw: Math.atan2(q.x - p.x, q.z - p.z) });
    }
    return out;
  }
}
