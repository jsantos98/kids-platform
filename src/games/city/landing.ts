// The plane's landings (R41): free play, flown by the kid. Pointed roughly
// down a runway (one of the airports, airport.ts: up to 700 m short of
// either end or anywhere over the runway itself with room to land, in a
// funnel widening from the runway's width, heading within 50° along it), the
// plane starts to come down: it sinks along a glide toward a touchdown point
// (a gentle one from far out, a steeper one when it is already over the
// runway) and eases back to its approach speed — but the kid flies it the
// whole way, steering as always. Steering it out of the funnel or pressing
// the gas calls it off, and it climbs back to its cruise. Over the runway
// close to the ground it eases round onto the runway's heading (unless the
// kid is steering hard), so a kid a little off the line still lands;
// reaching the runway lined up it touches down; anywhere else it holds a few
// metres up and, past the runway with no touchdown, climbs away. On the ground it is
// the game's again: it rolls out — braking itself to a stop with auto speed
// on (G18), else rolling to a gentle stop, the brake pedal stopping it sooner
// (and never past the runway's end) — turns round on the spot, races back
// down the runway, lifts off and climbs back to its cruise, where the kid has
// it again. The map's mark leads the kid in (`mark`).
import type { PhysicsInput, PlayerState } from './player.js';
import { RUNWAY_Y, RUNWAY_HW } from './airport.js';

/** a runway in world coordinates: its middle, heading and half length */
export interface Runway { key: string; cx: number; cz: number; yaw: number; hl: number }

export type LandPhase = 'fly' | 'descend' | 'roll' | 'turn' | 'takeoff';
export type LandEvent = 'land' | 'cancel' | 'landed' | 'takeoff' | 'airborne';

/** where a descent may begin: up to this far short of the threshold (m), or
 * anywhere over the runway */
const FROM = 700;
/** how far off its heading (rad), and off the centre line: a funnel, W0 m
 * either side at the threshold (and over the runway) and widening by SPLAY
 * a metre out */
const ALIGN = 50 * Math.PI / 180, W0 = 12, SPLAY = 0.4;
/** the steepest glide it will ask for (m a metre): from over the runway
 * it comes down at ~4 m/s at the approach speed */
const MAX_SLOPE = 0.35;
/** the map's mark: the gate this far out on the centre line, where the
 * approach is flown from */
const GATE = 350;
/** the glide: down to the runway at the touchdown point, this far past the
 * threshold (m), on this slope (m a metre) — and the approach speed (m/s) */
const TOUCH = 30, SLOPE = 0.07, V_APP = 12;
/** a touchdown: over the runway within this of its centre line (m), within
 * this of its heading (rad), with this much runway left at least (m) */
const TD_OFF = RUNWAY_HW - 2.5, TD_ALIGN = 25 * Math.PI / 180, TD_ROOM = 40;
/** not lined up for a touchdown: it holds this high (m) */
const HOLD = 4;
/** near the ground over the runway it eases onto its heading (rad/s), when
 * the kid steers less than this (of full); below this height (m) */
const FLARE = 0.6, FLARE_STEER = 0.4, FLARE_ALT = 8;
/** the roll: gentle rolling, auto speed's braking, the brake pedal's and
 * the most (m/s²) */
const ROLL = 1.5, AUTO_BRAKE = 2.5, BRAKE = 7, MAX_BRAKE = 9;
/** the turn round on the spot (s), the take-off speed and climb */
const TURN_T = 3.5, V_LIFT = 11, V_CLIMB = 14, CLIMB = 4;
/** after taking off, or calling a descent off: the way off that runway end's
 * funnel before it starts another descent (no tug back into it) */
const REARM_T = 3;

const wrap = (a: number): number => Math.atan2(Math.sin(a), Math.cos(a));

export class Landing {
  phase: LandPhase = 'fly';
  /** the nose's pitch for the model (rad, nose up +) and the bank's steer,
   * on the ground (the physics has them in the air) */
  pitch = 0;
  steer = 0;
  /** descending: the altitude the glide asks for now, and where it began
   * (a descent never climbs) */
  target = 0;
  private top = 0;
  /** the glide's touchdown point (m along the runway from its middle) and slope */
  private tp = 0;
  private slope = SLOPE;
  /** the runway being used, in the direction it's being landed along */
  private rw: Runway | null = null;
  private turnT = 0;
  private turnFrom = 0;
  /** the runway end just left (a descent called off, a take-off): not again
   * until the plane has been out of its funnel REARM_T seconds */
  private spent: { key: string; yaw: number; t: number } | null = null;

  /** back to flying (R puts the plane back at its start, in the air) */
  reset(): void {
    this.phase = 'fly';
    this.rw = null;
    this.pitch = 0;
    this.steer = 0;
  }

  /** along / across the runway in its landing direction (along from its middle) */
  private frame(rw: Runway, x: number, z: number): { a: number; l: number } {
    const fx = Math.sin(rw.yaw), fz = Math.cos(rw.yaw), dx = x - rw.cx, dz = z - rw.cz;
    return { a: dx * fx + dz * fz, l: dx * fz - dz * fx };
  }

  /** is (x, z) in the funnel in front of this runway's end — or over the
   * runway itself — landing along `yaw`? */
  private inFunnel(rw: Runway, x: number, z: number): boolean {
    const { a, l } = this.frame(rw, x, z);
    const short = -rw.hl - a;
    return a <= rw.hl && short <= FROM && Math.abs(l) <= W0 + SPLAY * Math.max(0, short);
  }

  /** the touchdown point of a glide begun here (m along the runway), or null
   * when there's no room to land (or it is not in the funnel, or lined up) */
  private glideFrom(rw: Runway, st: PlayerState): number | null {
    if (!this.inFunnel(rw, st.x, st.z) || Math.abs(wrap(st.heading - rw.yaw)) > ALIGN) return null;
    const { a } = this.frame(rw, st.x, st.z);
    const tp = Math.max(-rw.hl + TOUCH, a + (Math.max(st.alt, RUNWAY_Y + 1) - RUNWAY_Y) / MAX_SLOPE + 15);
    return tp > rw.hl - TD_ROOM ? null : tp;
  }

  /** a point on the centre line ahead of the plane (world): fly at it and
   * the plane comes onto the line before the touchdown, then on down it */
  private carrot(rw: Runway, st: PlayerState): { x: number; z: number } {
    const { a } = this.frame(rw, st.x, st.z);
    const toTouch = (this.phase === 'descend' ? this.tp : -rw.hl + TOUCH) - a;
    const am = Math.min(rw.hl, a + (toTouch > 0 ? Math.max(80, 0.45 * toTouch + 60) : 80));
    return { x: rw.cx + Math.sin(rw.yaw) * am, z: rw.cz + Math.cos(rw.yaw) * am };
  }

  /** where the map marks the way in (world): coming down, or in the funnel
   * in front of one of the nearest runway's ends, a point on its centre line
   * ahead — fly at it and the plane lines up and lands; else the nearer of
   * its two gates, out on its centre line */
  mark(st: PlayerState, runways: Runway[]): { x: number; z: number } | null {
    let r: Runway | null = null, bd = Infinity;
    for (const q of runways) {
      const d = Math.hypot(q.cx - st.x, q.cz - st.z);
      if (d < bd) { bd = d; r = q; }
    }
    if (!r) return null;
    if (this.rw && this.rw.key === r.key && this.phase === 'descend') return this.carrot(this.rw, st);
    let gate: { x: number; z: number } | null = null, gd = Infinity;
    for (const yaw of [r.yaw, r.yaw + Math.PI]) {
      const fx = Math.sin(yaw), fz = Math.cos(yaw);
      if (this.inFunnel({ ...r, yaw }, st.x, st.z)) return this.carrot({ ...r, yaw }, st);
      const g = { x: r.cx - fx * (r.hl + GATE), z: r.cz - fz * (r.hl + GATE) };
      const d = Math.hypot(g.x - st.x, g.z - st.z);
      if (d < gd) { gd = d; gate = g; }
    }
    return gate;
  }

  /** In the air (before the physics): starts and flies a descent — returns
   * the altitude to hold (the glide's), or null for the cruise (`cruise`
   * high). `kidGas`: the kid's own gas pedal (not auto speed's), which calls
   * a descent off. */
  fly(dt: number, st: PlayerState, runways: Runway[], kidGas: boolean, cruise: number, steerIn: number, on: (e: LandEvent) => void): number | null {
    if (this.phase === 'fly') {
      if (this.spent) {
        const s = this.spent, r = runways.find(q => q.key === s.key);
        s.t = r && this.inFunnel({ ...r, yaw: s.yaw }, st.x, st.z) ? 0 : s.t + dt;
        if (s.t > REARM_T) this.spent = null;
      }
      if (kidGas) return null;
      for (const r of runways) for (const yaw of [r.yaw, r.yaw + Math.PI]) {
        const rw = { ...r, yaw: wrap(yaw) };
        if (this.spent && this.spent.key === r.key && Math.abs(wrap(this.spent.yaw - rw.yaw)) < 0.1) continue;
        const tp = this.glideFrom(rw, st);
        if (tp === null) continue;
        this.rw = rw;
        this.phase = 'descend';
        this.top = st.alt;
        this.tp = tp;
        this.slope = Math.max(SLOPE, (Math.max(st.alt, RUNWAY_Y + 1) - RUNWAY_Y) / Math.max(1, tp - this.frame(rw, st.x, st.z).a));
        on('land');
        break;
      }
      if (this.phase !== 'descend') return null;
    }
    if (this.phase !== 'descend') return null;
    const rw = this.rw!;
    const { a, l } = this.frame(rw, st.x, st.z);
    const off = Math.abs(wrap(st.heading - rw.yaw));
    const short = -rw.hl - a;
    // called off: the kid's gas, steered out of the funnel (or round), or
    // past the runway with no touchdown
    const out = short > FROM + 50 || Math.abs(l) > W0 + SPLAY * Math.max(0, short) + 20;
    if (kidGas || out || off > ALIGN + 0.35 || a > rw.hl - TD_ROOM) {
      this.spent = { key: rw.key, yaw: rw.yaw, t: 0 };
      this.reset();
      on('cancel');
      return null;
    }
    // the glide, and the approach speed
    st.v += Math.max(-3 * dt, Math.min(3 * dt, V_APP - st.v));
    const over = a >= -rw.hl && Math.abs(l) <= TD_OFF && off <= TD_ALIGN;
    // (close to the ground over the runway: it eases round onto the runway's
    // heading and toward its centre line, unless the kid is steering hard)
    if (st.alt < FLARE_ALT && a >= -rw.hl - 30 && Math.abs(l) <= RUNWAY_HW + 8 && Math.abs(steerIn) < FLARE_STEER) {
      const want = rw.yaw + Math.max(-0.3, Math.min(0.3, Math.atan2(-l, 40)));
      st.heading = wrap(st.heading + Math.max(-FLARE * dt, Math.min(FLARE * dt, wrap(want - st.heading))));
    }
    // (down the glide toward the touchdown point, never above the cruise;
    // not lined up for a touchdown, no lower than HOLD)
    const glide = RUNWAY_Y + Math.max(0, this.tp - a) * this.slope;
    this.target = Math.max(over ? RUNWAY_Y : HOLD, Math.min(cruise, this.top, glide));
    if (over && st.alt <= RUNWAY_Y + 0.8) {
      // touchdown
      st.alt = RUNWAY_Y;
      this.phase = 'roll';
      this.steer = 0;
      return null;
    }
    return this.target;
  }

  /** On the ground (the roll, the turn, the take-off): the landing has the
   * plane — its pose is set here (true); false while it flies. `auto`: auto
   * speed is on. */
  ground(dt: number, input: PhysicsInput, st: PlayerState, auto: boolean, on: (e: LandEvent) => void): boolean {
    if (this.phase === 'fly' || this.phase === 'descend') return false;
    const rw = this.rw!;
    const { a, l } = this.frame(rw, st.x, st.z);
    const steerTo = (want: number, rate: number): void => {
      const d = wrap(want - st.heading);
      st.heading = wrap(st.heading + Math.max(-rate * dt, Math.min(rate * dt, d)));
      this.steer += (Math.max(-1, Math.min(1, d * 3)) - this.steer) * Math.min(1, dt * 3);
    };
    const move = (): void => {
      st.x += Math.sin(st.heading) * st.v * dt;
      st.z += Math.cos(st.heading) * st.v * dt;
    };
    if (this.phase === 'roll') {
      st.alt = RUNWAY_Y;
      this.pitch *= 1 - Math.min(1, dt * 4);
      steerTo(rw.yaw + Math.atan2(-l, 25), 0.4);
      // auto speed brakes it to a stop, the kid's brake stops it sooner,
      // else it rolls gently — and it never rolls past the runway's end
      const room = Math.max(0.5, rw.hl - 2 - a);
      const need = (st.v * st.v) / (2 * room);
      const decel = Math.min(MAX_BRAKE, Math.max(input.brake > 0.05 ? BRAKE : auto ? AUTO_BRAKE : ROLL, need));
      st.v = Math.max(0, st.v - decel * dt);
      move();
      if (st.v <= 0.05) {
        st.v = 0;
        this.phase = 'turn';
        this.turnT = 0;
        this.turnFrom = st.heading;
        on('landed');
      }
      return true;
    }
    if (this.phase === 'turn') {
      // round on the spot, back the way it came
      this.turnT += dt;
      const f = Math.min(1, this.turnT / TURN_T);
      const s = f * f * (3 - 2 * f);
      st.heading = wrap(this.turnFrom + Math.PI * s);
      this.steer = Math.sin(f * Math.PI) * 0.6;
      if (f >= 1) {
        this.rw = { ...rw, yaw: wrap(rw.yaw + Math.PI) };
        this.phase = 'takeoff';
        on('takeoff');
      }
      return true;
    }
    // take-off: down the runway, lift at V_LIFT, climb out to the cruise
    steerTo(rw.yaw + Math.atan2(-l, 25), 0.4);
    this.steer *= 1 - Math.min(1, dt * 3);
    st.v = Math.min(V_CLIMB, st.v + 6 * dt);
    if (st.v >= V_LIFT) {
      st.alt += CLIMB * dt;
      this.pitch += (0.15 - this.pitch) * Math.min(1, dt * 3);
    }
    move();
    if (st.alt >= 12) {
      this.spent = { key: rw.key, yaw: rw.yaw, t: 0 };
      this.reset();
      on('airborne');
      return false;
    }
    return true;
  }
}
