// The pirate mode's quarry (G15): on the kid's island a rival pirate ship
// (black sails) and two merchant ships (white sails, a white flag at the
// masthead) sail the open water — at least 150 m off every shore, so clear
// of the island's boat lanes and big ships (G14), out of the causeways'
// corridors, round the treasure islets and each other — from waypoint to
// waypoint. When the pirate ship comes within FLEE_R they run for it (the
// merchant at 6 m/s, the rival at 7: the pirate ship makes 11), steering
// round whatever is in their way. Staying within CATCH_R of one for CATCH_T
// seconds in all (it never drains) catches it: its battle opens (index.ts,
// activity/battle.ts). A beaten ship is gone for a while; one that got
// away runs flat out for a few seconds.
// The police boat (G15) chases the same way: two speedboats racing where
// they shouldn't — weaving at speed, running at 10 m/s from the police —
// and the rival pirate ship; caught, each opens the pull-over scene.
import * as THREE from 'three';
import { makeIconSprite, GOAL_ICON } from './guide3d.js';
import { nightLights } from './nightLights.js';
import { waveAt, hullObject } from './sea.js';
import { pkModel } from './activity/seaset.js';
import { onIslet } from './islets.js';
import { onLand } from './player.js';
import { rng, type Rng } from '../../engine/rng.js';
import { cityAt, CITY_PITCH, southExit, eastExit } from '../../worlds/cityGrid.js';
import { coastFor } from '../../worlds/coast.js';
import { CENTER } from '../../worlds/world.js';
import { RAIL_OFFSET } from '../../worlds/railRoute.js';

export type ShipKind = 'rival' | 'merchant' | 'speeder';

/** within this of a ship, for this long in all, and it's caught */
export const CATCH_R = 32, CATCH_T = 2;
const FLEE_R = 110;
const CRUISE = 3.5;
/** a speedboat races about at this, and runs from the police at SPEEDER_FLEE */
const SPEEDER_CRUISE = 7, SPEEDER_FLEE = 10;

export interface Ship {
  kind: ShipKind;
  x: number;
  z: number;
  h: number;
  v: number;
  len: number;
  /** catching progress (s) */
  caught: number;
  active: boolean;
  /** running flat out after getting away (s) */
  bolt: number;
  /** waiting to sail again after being beaten (s) */
  wait: number;
  group: THREE.Group;
  icon: THREE.Sprite;
  way: { x: number; z: number } | null;
  /** the kid has come within sight of it since it put out */
  seen?: boolean;
}

/** open water a ship may sail at world (x, z) with `r` to spare: no land
 * within 150 m (any island), no islet or causeway corridor near */
function openWater(x: number, z: number, r: number): boolean {
  const c = cityAt(x, z);
  for (let dx = -1; dx <= 1; dx++) for (let dz = -1; dz <= 1; dz++) {
    const bx = c.bx + dx, by = c.by + dz;
    if (coastFor(bx, by).inLand(x - bx * CITY_PITCH, z - by * CITY_PITCH, -150)) return false;
  }
  const lx = x - c.ox, lz = z - c.oz;
  if (onIslet(c.bx, c.by, lx, lz, r + 16)) return false;
  // the causeway corridors (the avenue and the railway deck beside it)
  const inV = (at: number): boolean => lx > at - 50 - r && lx < at + RAIL_OFFSET + 50 + r;
  const inH = (at: number): boolean => lz > at - 50 - r && lz < at + RAIL_OFFSET + 50 + r;
  if (lz < CENTER && inV(southExit(c.bx, c.by - 1) * 64)) return false;
  if (lz > CENTER && inV(southExit(c.bx, c.by) * 64)) return false;
  if (lx < CENTER && inH(eastExit(c.bx - 1, c.by) * 64)) return false;
  if (lx > CENTER && inH(eastExit(c.bx, c.by) * 64)) return false;
  return !onLand(x, z, r);
}

export class Pirates {
  readonly ships: Ship[] = [];
  private r: Rng = rng(1);
  private bx = 0;
  private by = 0;

  constructor(private scene: THREE.Scene, kinds: ShipKind[] = ['rival', 'merchant', 'merchant']) {
    kinds.forEach((kind, k) => {
      const group = new THREE.Group();
      if (kind === 'speeder') {
        // a speedboat (red or yellow), racing
        group.add(hullObject(k % 2 ? 'boat-speed-b' : 'boat-speed-h', 6.5, () => new THREE.Mesh(new THREE.BoxGeometry(2.2, 1.1, 6.5), new THREE.MeshLambertMaterial({ color: 0xd8503a }))));
        group.rotation.order = 'YXZ';
        group.visible = false;
        scene.add(group);
        const icon = makeIconSprite(GOAL_ICON.speeder, 3.2);
        icon.visible = false;
        scene.add(icon);
        this.ships.push({ kind, x: 0, z: 0, h: 0, v: 0, len: 6.5, caught: 0, active: false, bolt: 0, wait: 0, group, icon, way: null });
        return;
      }
      const len = kind === 'rival' ? 19 : 16;
      const s = len / 10.6;
      group.add(pkModel(kind === 'rival' ? 'ship-pirate-large' : 'ship-medium', s));
      // the masthead flag: black for the rival, white for a merchant
      const flag = pkModel(kind === 'rival' ? 'flag-pirate' : 'flag', 1.4);
      flag.position.set(0, 9.9 * s, 0);
      group.add(flag);
      group.rotation.order = 'YXZ';
      group.visible = false;
      scene.add(group);
      const icon = makeIconSprite(kind === 'rival' ? GOAL_ICON.rival : GOAL_ICON.merchant, 3.2);
      icon.visible = false;
      scene.add(icon);
      this.ships.push({ kind, x: 0, z: 0, h: 0, v: 0, len, caught: 0, active: false, bolt: 0, wait: 0, group, icon, way: null });
    });
  }

  /** a free spot in the island's open water, `away`–`far` m from (x, z)
   * (and, for a waypoint, within `reach` of the kid at (kx, kz)) */
  private spot(x: number, z: number, away: number, far = Infinity, kx = x, kz = z, reach = Infinity): { x: number; z: number } | null {
    const coast = coastFor(this.bx, this.by), ox = this.bx * CITY_PITCH, oz = this.by * CITY_PITCH;
    for (let k = 0; k < 400; k++) {
      const th = this.r() * Math.PI * 2;
      const s = coast.shoreToward(CENTER + Math.cos(th) * 100, CENTER + Math.sin(th) * 100, 170 + this.r() * 140);
      const px = ox + s.x, pz = oz + s.z;
      const d = Math.hypot(px - x, pz - z);
      if (d < away || d > far || Math.hypot(px - kx, pz - kz) > reach) continue;
      if (openWater(px, pz, 12)) return { x: px, z: pz };
    }
    return null;
  }

  /** the kid is on island (bx, by): its ships put out to sea, 180–450 m
   * from the kid — never so far that the next one is a long sail away (a
   * kilometre off, it was) */
  start(bx: number, by: number, kidX: number, kidZ: number, seed: number): void {
    this.bx = bx; this.by = by;
    this.r = rng(seed * 31 + bx * 7 + by * 13);
    for (const s of this.ships) this.launch(s, kidX, kidZ, 180, 450);
  }

  private launch(s: Ship, kidX: number, kidZ: number, away: number, far: number): void {
    const p = this.spot(kidX, kidZ, away, far) ?? this.spot(kidX, kidZ, away, far * 1.8) ?? this.spot(kidX, kidZ, 0);
    s.active = !!p;
    s.group.visible = s.icon.visible = !!p;
    if (!p) return;
    s.x = p.x; s.z = p.z; s.h = this.r() * Math.PI * 2; s.v = s.kind === 'speeder' ? SPEEDER_CRUISE : CRUISE;
    s.caught = 0; s.bolt = 0; s.wait = 0; s.way = null; s.seen = false;
  }

  /** beaten: gone for a moment, then another puts out 200–380 m from the kid */
  beaten(s: Ship): void {
    s.active = false;
    s.group.visible = s.icon.visible = false;
    s.wait = 5;
  }

  /** it got away in its battle: it runs flat out for a few seconds */
  escaped(s: Ship): void {
    s.caught = 0;
    s.bolt = 6;
    s.active = true;
    s.group.visible = s.icon.visible = true;
  }

  /** the nearest ship still sailing (world) */
  nearest(x: number, z: number): Ship | null {
    let best: Ship | null = null, bd = Infinity;
    for (const s of this.ships) {
      if (!s.active) continue;
      const d = Math.hypot(s.x - x, s.z - z);
      if (d < bd) { bd = d; best = s; }
    }
    return best;
  }

  /** the ships' turned footprints (world): the kid's ship bumps into them */
  footprints(): Array<{ x: number; z: number; h: number; hl: number; hw: number }> {
    return this.ships.filter(s => s.active).map(s => ({ x: s.x, z: s.z, h: s.h, hl: s.len / 2, hw: s.len * 0.23 }));
  }

  private recall = 0;

  private clock = 0;

  update(dt: number, elapsed: number, kidX: number, kidZ: number, frozen: boolean): void {
    this.clock = elapsed;
    // (the kid sailed off and every ship is far away: the farthest one, out
    // of sight in the fog, puts out again 250–400 m from the kid)
    this.recall -= dt;
    if (!frozen && this.recall <= 0) {
      this.recall = 2;
      const live = this.ships.filter(o => o.active);
      const dist = (o: Ship): number => Math.hypot(o.x - kidX, o.z - kidZ);
      if (live.length && Math.min(...live.map(dist)) > 600) {
        const far = live.reduce((a, b) => (dist(a) > dist(b) ? a : b));
        this.launch(far, kidX, kidZ, 250, 400);
        this.recall = 10;
      }
    }
    for (const s of this.ships) {
      if (!s.active) {
        if (s.wait > 0 && (s.wait -= dt) <= 0) this.launch(s, kidX, kidZ, 200, 380);
        continue;
      }
      if (!frozen) this.steer(s, dt, kidX, kidZ);
      const y = waveAt(s.x, s.z, elapsed) * 1.4;
      s.group.position.set(s.x, y, s.z);
      s.group.rotation.set(Math.sin(elapsed * 0.6 + s.len) * 0.03, s.h, Math.sin(elapsed * 0.8 + s.len) * 0.05);
      s.icon.position.set(s.x, (s.kind === 'speeder' ? 5 : s.len * 1.25) + Math.sin(elapsed * 3) * 0.4, s.z);
      // at night: a lantern at the stern (G10)
      const nl = nightLights();
      if (nl?.dark) nl.flash({ x: s.x - Math.sin(s.h) * s.len * 0.45, y: y + 4, z: s.z - Math.cos(s.h) * s.len * 0.45, color: 0xffc46a, size: 1.6, pool: 0 });
    }
  }

  /** sail on: toward its waypoint, or away from the kid, round what's in the way */
  private steer(s: Ship, dt: number, kidX: number, kidZ: number): void {
    const kd = Math.hypot(kidX - s.x, kidZ - s.z);
    const fleeing = s.bolt > 0 || kd < FLEE_R;
    if (s.bolt > 0) s.bolt -= dt;
    let want: number;
    if (fleeing) want = Math.atan2(s.x - kidX, s.z - kidZ);
    else {
      // (waypoints within 450 m of the kid: wandering the whole island they
      // drifted a kilometre off)
      if (!s.way || Math.hypot(s.way.x - s.x, s.way.z - s.z) < 30) s.way = this.spot(s.x, s.z, 100, 300, kidX, kidZ, 450) ?? this.spot(s.x, s.z, 100);
      want = s.way ? Math.atan2(s.way.x - s.x, s.way.z - s.z) : s.h;
      // (a speedboat weaves as it races: breaking the rules)
      if (s.kind === 'speeder') want += Math.sin(this.clock * 1.3 + s.len) * 0.7;
    }
    // the first heading near the wanted one whose way ahead is clear (open
    // water, no other ship)
    const clear = (h: number): boolean => {
      for (const d of [15, 30, 45]) {
        const x = s.x + Math.sin(h) * d, z = s.z + Math.cos(h) * d;
        if (!openWater(x, z, 8)) return false;
        if (this.ships.some(o => o !== s && o.active && Math.hypot(o.x - x, o.z - z) < 30)) return false;
      }
      return true;
    };
    let go: number | null = null;
    for (const off of [0, 0.35, -0.35, 0.7, -0.7, 1.05, -1.05, 1.4, -1.4, 1.9, -1.9, 2.5, -2.5]) {
      if (clear(want + off)) { go = want + off; break; }
    }
    let target = s.kind === 'speeder' ? (fleeing ? SPEEDER_FLEE : SPEEDER_CRUISE) : fleeing ? (s.kind === 'rival' ? 7 : 6) : CRUISE;
    if (go === null) { go = s.h; target = 0; s.way = null; }
    let dh = go - s.h;
    while (dh > Math.PI) dh -= Math.PI * 2;
    while (dh < -Math.PI) dh += Math.PI * 2;
    const turn = s.kind === 'speeder' ? 1.2 : 0.5;
    s.h += Math.max(-turn * dt, Math.min(turn * dt, dh));
    s.v += Math.max(-2 * dt, Math.min((s.kind === 'speeder' ? 3 : 1.2) * dt, target - s.v));
    const nx = s.x + Math.sin(s.h) * s.v * dt, nz = s.z + Math.cos(s.h) * s.v * dt;
    if (openWater(nx, nz, 4)) { s.x = nx; s.z = nz; } else s.v *= 0.5;
  }
}
