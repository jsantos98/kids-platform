// The plane's landings (R41): free play — whenever the kid lines the plane
// up with a runway (one of the airports, airport.ts: 120–450 m short of
// either end, within 40 m of its centre line, heading within 30° along it),
// it lands by itself: it steers onto the centre line, glides down to touch
// down just past the threshold, and rolls out — braking itself to a stop
// with auto speed on (G18), else rolling to a gentle stop, the brake pedal
// stopping it sooner (and never past the runway's end). Standing,
// it turns round on the spot, races back down the runway, lifts off and
// climbs back to its cruise, where the kid has it again. It won't land on the
// same runway again until it has flown 500 m away from it.
import type { PhysicsInput, PlayerState } from './player.js';
import { RUNWAY_Y } from './airport.js';

/** a runway in world coordinates: its middle, heading and half length */
export interface Runway { key: string; cx: number; cz: number; yaw: number; hl: number }

export type LandPhase = 'fly' | 'approach' | 'roll' | 'turn' | 'takeoff';
export type LandEvent = 'land' | 'landed' | 'takeoff' | 'airborne';

/** where an approach may begin: this far short of the threshold (m) */
const FROM = 450, TO = 120;
/** how far off the centre line, and how far off its heading (rad) */
const OFF = 40, ALIGN = 30 * Math.PI / 180;
/** touchdown, this far past the threshold (m); the approach speed (m/s) */
const TOUCH = 30, V_APP = 12;
/** the roll: gentle rolling, auto speed's braking, the brake pedal's and
 * the most (m/s²) */
const ROLL = 1.5, AUTO_BRAKE = 2.5, BRAKE = 7, MAX_BRAKE = 9;
/** the turn round on the spot (s), the take-off speed and climb */
const TURN_T = 3.5, V_LIFT = 11, V_CLIMB = 14, CLIMB = 4;
/** the way off a runway before it can be landed on again (m) */
const REARM = 500;

const wrap = (a: number): number => Math.atan2(Math.sin(a), Math.cos(a));

export class Landing {
  phase: LandPhase = 'fly';
  /** the nose's pitch for the model (rad, nose up +) and the bank's steer */
  pitch = 0;
  steer = 0;
  /** the runway being used, in the direction it's being landed along */
  private rw: Runway | null = null;
  private turnT = 0;
  private turnFrom = 0;
  private startAlt = 0;
  private startA = 0;
  /** the runway just taken off from (no landing on it again yet) */
  private spent: Runway | null = null;

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

  /** is the plane lined up with this runway, landing along `yaw`? */
  lined(rw: Runway, st: PlayerState): boolean {
    const { a, l } = this.frame(rw, st.x, st.z);
    const short = -rw.hl - a;
    return short >= TO && short <= FROM && Math.abs(l) <= OFF && Math.abs(wrap(st.heading - rw.yaw)) <= ALIGN;
  }

  /** the plane's frame: it flies (false: the physics has it) or the landing
   * has it (true: its pose is set here). `auto`: auto speed is on. */
  update(dt: number, input: PhysicsInput, st: PlayerState, runways: Runway[], auto: boolean, on: (e: LandEvent) => void): boolean {
    if (this.phase === 'fly') {
      if (this.spent && Math.hypot(st.x - this.spent.cx, st.z - this.spent.cz) > REARM) this.spent = null;
      for (const r of runways) {
        if (this.spent?.key === r.key) continue;
        for (const yaw of [r.yaw, r.yaw + Math.PI]) {
          const rw = { ...r, yaw: wrap(yaw) };
          if (!this.lined(rw, st)) continue;
          this.rw = rw;
          this.phase = 'approach';
          this.startAlt = Math.max(st.alt, RUNWAY_Y + 1);
          this.startA = this.frame(rw, st.x, st.z).a;
          on('land');
          break;
        }
        if (this.rw) break;
      }
      if (!this.rw) { this.pitch = 0; return false; }
    }
    const rw = this.rw!;
    const { a, l } = this.frame(rw, st.x, st.z);
    const touch = -rw.hl + TOUCH;
    // (the heading that brings it onto the centre line, eased toward)
    const steerTo = (want: number, rate: number): void => {
      const d = wrap(want - st.heading);
      const turn = Math.max(-rate * dt, Math.min(rate * dt, d));
      st.heading = wrap(st.heading + turn);
      this.steer += (Math.max(-1, Math.min(1, d * 3)) - this.steer) * Math.min(1, dt * 3);
    };
    const move = (): void => {
      st.x += Math.sin(st.heading) * st.v * dt;
      st.z += Math.cos(st.heading) * st.v * dt;
    };
    if (this.phase === 'approach') {
      steerTo(rw.yaw + Math.atan2(-l, Math.max(30, touch - a)), 0.6);
      st.v += Math.max(-3 * dt, Math.min(3 * dt, V_APP - st.v));
      // a straight glide from where it began to the touchdown point
      const f = Math.max(0, Math.min(1, (touch - a) / Math.max(1, touch - this.startA)));
      const want = RUNWAY_Y + (this.startAlt - RUNWAY_Y) * f;
      const prev = st.alt;
      st.alt += Math.max(-6 * dt, Math.min(2 * dt, want - st.alt));
      this.pitch = Math.max(-0.2, Math.min(0.15, ((st.alt - prev) / Math.max(dt, 1e-3)) / Math.max(4, st.v)));
      move();
      if (a >= touch || st.alt <= RUNWAY_Y + 0.05) {
        st.alt = RUNWAY_Y;
        this.phase = 'roll';
      }
      return true;
    }
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
      this.phase = 'fly';
      this.spent = rw;
      this.rw = null;
      this.pitch = 0;
      on('airborne');
      return false;
    }
    return true;
  }
}
