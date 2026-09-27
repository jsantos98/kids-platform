// Passengers at the platforms: every station on the island the kid is on has
// a little queue of people (and the odd pet on a lead) waiting on its
// platform. When a passenger train stands at the platform — a timetable
// train in its dwell, or the kid's own train stopped at the stop board —
// its doors open: riders step off and stroll away down the platform, and
// the queue walks to the nearest door and climbs aboard. After the train
// leaves, new passengers wander in from the platform's ends to wait for the
// next one. Freight trains open no doors.
//
// Riders are not the island's walkers (G5): they come and go with the
// trains, so they appear at a door or a platform end and leave the same way.
import * as THREE from 'three';
import { rng, chunkSeed, type Rng } from '../../engine/rng.js';
import { templateToMesh } from '../../engine/baked.js';
import type { BakedTemplate } from '../../engine/assets.js';
import { cityPlanFor, platformPoint, type Station } from '../../worlds/cityPlan.js';
import { citySeed } from '../../worlds/cityGrid.js';
import type { Railway, Dwelling } from './railway.js';

const PED_SCALE = 2.2;   // kit characters are ~0.7 units tall
const WALK = 1.4;        // m/s
const QUEUE = 5;         // people waiting for each train, at most
const PLATFORM_Y = 0.46;

interface Rider {
  mesh: THREE.Mesh;
  x: number;
  z: number;
  /** where it's heading, and what happens there */
  tx: number;
  tz: number;
  goal: 'wait' | 'board' | 'leave';
  pet: boolean;
  phase: number;
}

interface Platform {
  st: Station;
  riders: Rider[];
  /** seconds until the next newcomer strolls in */
  nextIn: number;
  /** the train whose doors are open here, and whether its riders got off */
  serving: string | null;
  r: Rng;
  /** heading from the platform toward the track */
  face: number;
  /** seconds left of being cross: the kid's train rolled past (G6) */
  angry: number;
}

export class Boarding {
  private platforms: Platform[] = [];
  private key = '';
  private ox = 0;
  private oz = 0;
  private people: THREE.Mesh[];
  private pets: THREE.Mesh[];
  /** riders who boarded the kid's train this stop (for the HUD) */
  boardedKid = 0;

  constructor(private scene: THREE.Scene, peopleTpls: BakedTemplate[], petTpls: BakedTemplate[]) {
    this.people = peopleTpls.map(t => { const m = templateToMesh(t); m.geometry.scale(PED_SCALE, PED_SCALE, PED_SCALE); return m; });
    this.pets = petTpls.map(t => templateToMesh(t));
  }

  /** the island the kid is on: its stations get their queues */
  setCity(bx: number, by: number, ox: number, oz: number): void {
    const key = `${bx},${by}`;
    if (key === this.key) return;
    for (const p of this.platforms) for (const rd of p.riders) this.scene.remove(rd.mesh);
    this.platforms = [];
    this.key = key; this.ox = ox; this.oz = oz;
    if (!this.people.length) return;
    const plan = cityPlanFor(bx, by);
    plan.stations.forEach((st, i) => {
      const r = rng(chunkSeed(citySeed(bx, by), 0xb0a4, i));
      const a = platformPoint(st, 0, 3.5), b = platformPoint(st, 0, 0);
      const p: Platform = { st, riders: [], nextIn: 0, serving: null, r, face: Math.atan2(b.x - a.x, b.z - a.z), angry: 0 };
      const n = 2 + ((r() * (QUEUE - 1)) | 0);
      for (let k = 0; k < n; k++) this.addRider(p, true);
      this.platforms.push(p);
    });
  }

  /** a waiting spot on the platform (world): spread along it, a little in
   * from the track edge */
  private waitSpot(p: Platform): { x: number; z: number } {
    const q = platformPoint(p.st, (p.r() - 0.5) * 12, 3.0 + p.r() * 1.0);
    return { x: q.x + this.ox, z: q.z + this.oz };
  }

  /** a platform end (world), where newcomers arrive and leavers go */
  private endSpot(p: Platform): { x: number; z: number } {
    const q = platformPoint(p.st, (p.r() < 0.5 ? -1 : 1) * 7.2, 3.5 + (p.r() - 0.5) * 1.6);
    return { x: q.x + this.ox, z: q.z + this.oz };
  }

  private addRider(p: Platform, already: boolean, at?: { x: number; z: number }, goal: Rider['goal'] = 'wait'): void {
    const pet = this.pets.length > 0 && p.r() < 0.18;
    const src = pet ? this.pets[(p.r() * this.pets.length) | 0] : this.people[(p.r() * this.people.length) | 0];
    const mesh = new THREE.Mesh(src.geometry, src.material);
    if (pet) mesh.scale.setScalar(0.9);
    mesh.castShadow = true;
    this.scene.add(mesh);
    const spot = this.waitSpot(p);
    const from = at ?? (already ? spot : this.endSpot(p));
    const to = goal === 'leave' ? this.endSpot(p) : spot;
    p.riders.push({ mesh, x: from.x, z: from.z, tx: to.x, tz: to.z, goal, pet, phase: p.r() * 10 });
  }

  update(dt: number, elapsed: number, railway: Railway, bx: number, by: number): void {
    if (`${bx},${by}` !== this.key) return;
    const standing = railway.dwelling(bx, by);
    for (const p of this.platforms) {
      p.angry = Math.max(0, p.angry - dt);
      const sx = p.st.x + this.ox, sz = p.st.z + this.oz;
      const train: Dwelling | undefined = standing.find(d => d.passenger && d.doors.length && Math.hypot(d.x - sx, d.z - sz) < 3);
      if (train && p.serving !== train.id) {
        // the doors open: a few riders step off, the queue heads for the doors
        p.serving = train.id;
        if (train.id === 'kid') this.boardedKid = 0;
        const off = 1 + ((p.r() * 3) | 0);
        for (let k = 0; k < off; k++) {
          const d = train.doors[k % train.doors.length];
          this.addRider(p, false, d, 'leave');
        }
        for (const rd of p.riders) {
          if (rd.goal !== 'wait') continue;
          let best = train.doors[0], bd = Infinity;
          for (const d of train.doors) {
            const dd = Math.hypot(d.x - rd.x, d.z - rd.z);
            if (dd < bd) { bd = dd; best = d; }
          }
          rd.goal = 'board';
          rd.tx = best.x; rd.tz = best.z;
        }
      }
      if (!train && p.serving) {
        // gone: anyone still on the way to a door waits for the next one
        p.serving = null;
        for (const rd of p.riders) if (rd.goal === 'board') { const w = this.waitSpot(p); rd.goal = 'wait'; rd.tx = w.x; rd.tz = w.z; }
        p.nextIn = 3 + p.r() * 4;
      }
      // newcomers between trains
      if (!p.serving && p.riders.filter(rd => rd.goal === 'wait').length < QUEUE) {
        p.nextIn -= dt;
        if (p.nextIn <= 0) { this.addRider(p, false); p.nextIn = 5 + p.r() * 8; }
      }
      // walk
      for (let k = p.riders.length - 1; k >= 0; k--) {
        const rd = p.riders[k];
        const dx = rd.tx - rd.x, dz = rd.tz - rd.z;
        const d = Math.hypot(dx, dz);
        const step = WALK * (rd.pet ? 1.2 : 1) * dt;
        if (d > 0.05) {
          const f = Math.min(1, step / d);
          rd.x += dx * f; rd.z += dz * f;
          rd.mesh.rotation.y = Math.atan2(dx, dz);
        } else if (rd.goal === 'board' || rd.goal === 'leave') {
          // aboard, or off down the platform's end: gone
          if (rd.goal === 'board' && p.serving === 'kid') this.boardedKid++;
          this.scene.remove(rd.mesh);
          p.riders.splice(k, 1);
          continue;
        }
        const moving = d > 0.05;
        // (cross, the train having rolled past: hopping up and down and
        // shaking, facing the track)
        const cross = p.angry > 0 && !moving && rd.goal === 'wait';
        const hop = cross ? Math.abs(Math.sin((elapsed + rd.phase) * 8)) * 0.35 : moving ? Math.abs(Math.sin((elapsed + rd.phase) * 9)) * 0.07 : 0;
        rd.mesh.position.set(rd.x, PLATFORM_Y + hop, rd.z);
        rd.mesh.rotation.z = cross ? Math.sin((elapsed + rd.phase) * 14) * 0.22 : 0;
        if (!moving) rd.mesh.rotation.y = p.face; // waiting: face the track
      }
    }
  }

  /** the kid's train rolled past the station at world (x, z) without
   * stopping: its people are cross for a few seconds (G6) */
  grumble(x: number, z: number): void {
    let best: Platform | null = null, bd = 40;
    for (const p of this.platforms) {
      const q = platformPoint(p.st, 0, 0), d = Math.hypot(q.x + this.ox - x, q.z + this.oz - z);
      if (d < bd) { bd = d; best = p; }
    }
    if (best) best.angry = 4;
  }

  /** the platforms' riders right now (debug) */
  list(): Array<{ station: number; waiting: number; boarding: number; leaving: number; serving: string | null; angry: number }> {
    return this.platforms.map((p, i) => ({
      station: i,
      waiting: p.riders.filter(r => r.goal === 'wait').length,
      boarding: p.riders.filter(r => r.goal === 'board').length,
      leaving: p.riders.filter(r => r.goal === 'leave').length,
      serving: p.serving,
      angry: p.angry,
    }));
  }
}
