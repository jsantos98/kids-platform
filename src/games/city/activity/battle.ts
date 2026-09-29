// The sea battle (G15, G4): the pirate ship has caught up with a rival
// pirate or a merchant ship, and the two lie broadside on the open sea. The
// kid's cannon stands on the rail; the wheel swings it left and right, a
// dotted arc showing where its ball will land, and it fires by itself every
// FIRE s — so the only thing to do is keep it on the other ship as it sails
// to and fro. A rival pirate ship takes four hits, then goes down in a
// cartoon sinking — it tips, bubbles, and its crew paddles off in rowboats,
// cheering — and a treasure map floats up; a merchant ship takes three shots
// across the bow, raises its white flag and swings a chest of gold over on
// a rope. The other ship's shots only ever splash short, and progress never
// drains; not done in ESCAPE_T s it sails off (`lost`) and the chase goes on
// in the world.
import * as THREE from 'three';
import { rng, type Rng } from '../../../engine/rng.js';
import { t as tr } from '../../../i18n/index.js';
import { person } from '../../../engine/rig.js';
import { PRIMS as P, mat } from '../../../engine/stage.js';
import { SeaSet, pkModel } from './seaset.js';
import { Baked } from '../../../engine/baked.js';
import { wearHat } from './hats.js';
import { marker } from './set.js';
import type { Activity, ActivityInput, ActivityState, SceneCue, SceneLoop } from './common.js';

export type BattleKind = 'pirate' | 'merchant';

/** seconds to win before the other ship sails off */
export const BATTLE_T = 40;
const AWAY_RUN = 1.8;
/** the cannon fires every FIRE s; its ball flies FLY s */
const FIRE = 1.4, FLY = 0.9;
/** where the two ships lie: the kid's across the front, the other out at sea */
const KID_Z = 8, ENEMY_Z = -32;
/** the cannon's muzzle, on the kid's rail */
const GUN = new THREE.Vector3(0, 3.4, KID_Z - 4);
/** how far to either side the other ship sails, and the wheel's reach */
const SWING = 16, REACH = 21;
/** a ball within this of the aim point on the ship hits it */
const HIT_W = 5.5;
const SHIP_S = 1.2;

export class BattleActivity implements Activity {
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  cues: SceneCue[] = [];
  loops = new Set<SceneLoop>(['waves']);
  private set: SeaSet;
  private r: Rng;
  private enemy = new THREE.Group();
  private enemyShip: THREE.Object3D;
  private gun = new THREE.Group();
  private dots: THREE.Mesh[] = [];
  private balls: Array<{ m: THREE.Object3D; from: THREE.Vector3; to: THREE.Vector3; t: number; mine: boolean }> = [];
  private flag: THREE.Object3D | null = null;
  private chest: THREE.Object3D | null = null;
  private mapScroll: THREE.Object3D | null = null;
  private rowboats: THREE.Group[] = [];
  private icon: THREE.Object3D;
  private t = 0;
  private fireT = 1.2;
  private backT = 2.2;
  private hits = 0;
  private need: number;
  private phase: number;
  private won = false;
  private endT = -1;
  private gone = -1;
  private aimX = 0;
  private shake = 0;

  constructor(seed: number, readonly kind: BattleKind) {
    this.r = rng(seed * 131 + 7);
    this.need = kind === 'pirate' ? 4 : 3;
    this.phase = this.r() * Math.PI * 2;
    const set = this.set = new SeaSet(seed);
    this.scene = set.scene;
    this.camera = set.camera;

    // the kid's deck along the bottom of the picture: planks, the rail, the
    // captain by the cannon (the whole ship's sails filled the view)
    const B = new Baked();
    B.box(22, 0.5, 7, 0xa0703f, 0, 1.95, KID_Z - 0.5);
    for (let k = -5; k <= 5; k++) B.box(0.08, 0.02, 7, 0x6e4a28, k * 2, 2.21, KID_Z - 0.5);
    B.box(22, 0.35, 0.35, 0x7a5230, 0, 3.05, KID_Z - 4);
    for (let k = -5; k <= 5; k++) B.box(0.25, 0.9, 0.25, 0x7a5230, k * 2, 2.6, KID_Z - 4);
    B.box(22, 1.4, 0.4, 0x8a5a2c, 0, 1.2, KID_Z - 4.1);
    this.scene.add(B.build());
    const captain = wearHat(person((seed + 2) % 12, 1.7), 'pirate');
    set.addRig(captain, -3.6, 2.2, KID_Z - 2.2, Math.PI, this.scene);
    captain.play('idle');
    // the cannon on the rail (the Pirate Kit's, its muzzle out to sea)
    const cannon = pkModel('cannon', 1.6, Math.PI);
    this.gun.add(cannon);
    this.gun.position.set(GUN.x, GUN.y - 1.2, GUN.z + 1.2);
    this.scene.add(this.gun);
    // the aim: a dotted arc to where the ball will land
    for (let k = 0; k < 14; k++) {
      const d = new THREE.Mesh(new THREE.SphereGeometry(0.16, 8, 6), mat(0xfff6d0, { transparent: true, opacity: 0.8, depthWrite: false }));
      this.scene.add(d);
      this.dots.push(d);
    }

    // the other ship: a rival pirate (black sails) or a merchant (white)
    this.enemyShip = pkModel(kind === 'pirate' ? 'ship-pirate-large' : 'ship-medium', SHIP_S, -Math.PI / 2);
    this.enemy.add(this.enemyShip);
    for (let k = 0; k < 2; k++) {
      const crew = person((seed + 5 + k * 3) % 12, 1.6);
      if (kind === 'pirate') wearHat(crew, 'pirate');
      set.addRig(crew, -2 + k * 4, 2.6, 0.6, 0, this.enemy);
      crew.play('idle');
    }
    if (kind === 'merchant') {
      // the white flag, furled below the rail until they give in
      this.flag = pkModel('flag', 2.2, 0);
      this.flag.position.set(0, -3, 0);
      this.enemy.add(this.flag);
    }
    this.enemy.position.set(0, 0, ENEMY_Z);
    this.scene.add(this.enemy);
    this.icon = marker(kind === 'pirate' ? '🏴' : '🏳️', 2.2);
    this.scene.add(this.icon);

    // (on the deck, in front of the masts, the cannon in the foreground)
    set.shot({ x: 0, y: 6.4, z: KID_Z + 4 }, { x: 0, y: 2.6, z: ENEMY_Z });
  }

  /** the other ship's x at time t (sailing to and fro) */
  private enemyX(t: number): number { return Math.sin(t * 0.33 + this.phase) * SWING; }

  /** where a ball must land to count: on the other ship (a merchant's
   * splash only frightens it — a shot across its bow) */
  private targetX(t: number): number { return this.enemyX(t); }

  aim(): number {
    // (where the target will be when the next ball lands)
    return Math.max(-1, Math.min(1, this.targetX(this.t + this.fireT + FLY) / REACH));
  }

  private arcPoint(from: THREE.Vector3, to: THREE.Vector3, f: number, out: THREE.Vector3): THREE.Vector3 {
    out.lerpVectors(from, to, f);
    out.y += Math.sin(f * Math.PI) * 9;
    return out;
  }

  update(dt: number, elapsed: number, inp: ActivityInput): ActivityState {
    this.set.night = inp.night ?? 0;
    this.t += dt;
    const set = this.set;
    // the other ship: to and fro, riding the swell (or sailing off / going down)
    let ex = this.enemyX(this.t);
    if (this.gone >= 0) { this.gone += dt; ex = this.enemy.position.x + dt * (8 + this.gone * 6); }
    if (this.endT >= 0) ex = this.enemy.position.x;
    this.enemy.position.x = ex;
    const vx = Math.cos(this.t * 0.33 + this.phase);
    if (this.endT < 0 || this.kind === 'merchant') {
      this.enemy.position.y = set.sea(ex, ENEMY_Z) * 0.8 + Math.sin(this.t * 13) * this.shake * 0.25;
      this.enemy.rotation.set(Math.sin(this.t * 0.9) * 0.04 + this.shake * 0.06, this.gone >= 0 ? -0.35 : vx < 0 ? Math.PI : 0, Math.sin(this.t * 0.7 + 1) * 0.05);
    }
    this.shake = Math.max(0, this.shake - dt * 2);
    this.icon.visible = this.endT < 0 && this.gone < 0;
    this.icon.position.set(ex, 16 + Math.sin(elapsed * 3) * 0.3, ENEMY_Z);

    // the cannon: the wheel swings it; the arc shows where the ball will land
    const steer = Math.max(-1, Math.min(1, inp.steer));
    if (!this.won && this.gone < 0) this.aimX += (steer * REACH - this.aimX) * Math.min(1, dt * 5);
    const to = new THREE.Vector3(this.aimX, 0.3, ENEMY_Z + 1.5);
    this.gun.rotation.y = -Math.atan2(to.x - GUN.x, GUN.z - to.z);
    const p = new THREE.Vector3();
    this.dots.forEach((d, k) => {
      this.arcPoint(GUN, to, 0.12 + (0.88 * (k + 1)) / (this.dots.length + 1), p);
      d.position.copy(p);
      d.visible = !this.won && this.gone < 0;
    });

    // fire by itself, every FIRE s
    if (!this.won && this.gone < 0 && this.t > 0.6) {
      this.fireT -= dt;
      if (this.fireT <= 0) {
        this.fireT += FIRE;
        const ball = P.sphere(0.34, 0x2b2d33, 0, 0, 0);
        this.scene.add(ball);
        this.balls.push({ m: ball, from: GUN.clone(), to: to.clone(), t: 0, mine: true });
        set.smoke.puff(GUN.x, GUN.y + 0.4, GUN.z - 1, 1.3, 0.1, 0.9);
        this.cues.push('cannon');
      }
      // the other side fires back — well short, into the sea between them
      if (this.kind === 'pirate') {
        this.backT -= dt;
        if (this.backT <= 0) {
          this.backT = 2.8 + this.r() * 1.4;
          const from = new THREE.Vector3(ex, 3.2, ENEMY_Z + 3);
          const ball = P.sphere(0.34, 0x2b2d33, 0, 0, 0);
          this.scene.add(ball);
          this.balls.push({ m: ball, from, to: new THREE.Vector3(ex + (this.r() - 0.5) * 10, 0.3, -12), t: 0, mine: false });
          set.smoke.puff(from.x, from.y, from.z, 1.2, 0.1, 0.9);
          this.cues.push('cannon');
        }
      }
    }
    // the balls in flight
    for (let i = this.balls.length - 1; i >= 0; i--) {
      const b = this.balls[i];
      b.t += dt / FLY;
      this.arcPoint(b.from, b.to, Math.min(1, b.t), b.m.position);
      if (b.t < 1) continue;
      this.scene.remove(b.m);
      this.balls.splice(i, 1);
      const land = b.to;
      if (b.mine && !this.won && this.gone < 0 && Math.abs(land.x - this.targetX(this.t)) < HIT_W) {
        this.hits++;
        this.shake = 1;
        if (this.kind === 'pirate') {
          set.smoke.puff(land.x, 3, ENEMY_Z, 1.6, 0.5, 1.4);
          set.sparkles.burst(new THREE.Vector3(land.x, 4, ENEMY_Z + 1), 'twinkle', 10, 0.6, 5);
          this.cues.push('woodHit');
        } else {
          // (across the bow: a big splash just in front of it)
          const ahead = Math.sign(Math.cos(this.t * 0.33 + this.phase) || 1) * 8;
          set.splash(this.targetX(this.t) + ahead, ENEMY_Z + 3, 1.8);
          this.cues.push('splash');
        }
        if (this.hits >= this.need) this.won = true;
      } else {
        set.splash(land.x, land.z, 1);
        this.cues.push('splash');
      }
    }

    // not done in BATTLE_T s: they sail off
    if (!this.won && this.gone < 0 && this.t >= BATTLE_T) this.gone = 0;

    // the end: the rival goes down, the merchant gives in
    if (this.endT >= 0) {
      this.endT += dt;
      const e = this.endT;
      if (this.kind === 'pirate') {
        // tipping over and sinking, bubbles coming up
        this.enemy.rotation.z = Math.min(0.55, e * 0.35);
        this.enemy.position.y = -Math.max(0, e - 0.6) * 3.2;
        if (Math.floor(e * 8) !== Math.floor((e - dt) * 8)) set.smoke.puff(ex + (this.r() - 0.5) * 8, 0.4, ENEMY_Z + (this.r() - 0.5) * 4, 0.8, 0, 1);
        this.rowboats.forEach((b, k) => {
          b.position.x = ex + (k ? 1 : -1) * (6 + e * 2.4);
          b.position.y = set.sea(b.position.x, b.position.z) * 0.6;
        });
      } else if (this.flag && this.chest) {
        this.flag.position.y = Math.min(9, -3 + e * 9);
        const f = Math.min(1, e / 1.6);
        this.chest.position.set(ex + (0 - ex) * f, 3 + Math.sin(f * Math.PI) * 6, ENEMY_Z + (KID_Z - 2 - ENEMY_Z) * f);
      }
      if (this.mapScroll) {
        const f = Math.min(1, e / 1.4);
        this.mapScroll.position.set(ex * (1 - f), 1 + f * 5 + Math.sin(e * 3) * 0.3, ENEMY_Z * (1 - f * 0.55));
        this.mapScroll.rotation.y = e * 2;
      }
    }

    set.update(dt);
    const away = this.gone >= 0;
    const left = Math.ceil(BATTLE_T - this.t);
    const ask = tr(this.kind === 'pirate' ? 'scene.battle.pirate' : 'scene.battle.merchant');
    return {
      progress: this.won ? 1 : this.hits / this.need,
      prompt: this.won ? tr(this.kind === 'pirate' ? 'scene.battle.sunk' : 'scene.battle.surrender')
        : away ? tr('scene.battle.escaped') : left <= 10 ? `${ask} ${tr('scene.timeLeft', { n: left })}` : ask,
      done: this.won,
      lost: this.gone >= AWAY_RUN,
    };
  }

  celebrate(): void {
    if (this.endT >= 0) return;
    this.endT = 0;
    const set = this.set;
    const ex = this.enemy.position.x;
    if (this.kind === 'pirate') {
      // the crew off in two rowboats, waving; the map floats over
      for (let k = 0; k < 2; k++) {
        const b = new THREE.Group();
        b.add(pkModel('boat-row-small', 1.6, Math.PI / 2));
        const rower = wearHat(person((k * 5 + 1) % 12, 1.3), 'pirate');
        set.addRig(rower, 0, 0.5, 0, Math.PI, b);
        rower.play('emote-yes');
        b.position.set(ex, 0, ENEMY_Z + 5);
        this.scene.add(b);
        this.rowboats.push(b);
      }
      this.cues.push('sink');
    } else {
      this.chest = pkModel('chest', 1.8);
      this.chest.position.set(ex, 3, ENEMY_Z);
      this.scene.add(this.chest);
      set.sparkles.burst(new THREE.Vector3(ex, 8, ENEMY_Z), 'star', 14, 0.7);
      this.cues.push('surrender', 'coins');
    }
    // the treasure map: a rolled parchment with a map icon over it
    const scroll = new THREE.Group();
    const roll = P.cyl(0.18, 0.18, 1.1, 12, 0xe9d6a6, 0, 0, 0);
    roll.rotation.z = Math.PI / 2;
    scroll.add(roll);
    const sign = marker('🗺️', 1.6);
    sign.position.y = 1.4;
    scroll.add(sign);
    scroll.position.set(ex, 1, ENEMY_Z);
    this.scene.add(scroll);
    this.mapScroll = scroll;
    set.pushIn(new THREE.Vector3(0, 7, KID_Z));
    this.cues.push('map');
  }

  dispose(): void { this.set.dispose(); }
}
