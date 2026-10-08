// Street assist (G19): a road vehicle whose steering is let go of, close to
// the line of a street it is nearly pointing along, eases round onto that
// line — so a turn only has to be roughly finished (the wheel centred half
// way round a corner, the vehicle swings the last 30° onto the new street),
// and a skewed vehicle drifting across a street straightens up instead of
// running into the shop fronts. Only the heading is touched, gently
// (1 rad/s at the most, less the further off it is), only on a street's
// carriageway, only with the wheel (nearly) centred, and any steering from
// the kid takes it straight back: it never takes the vehicle over.
import { graphFor } from '../../worlds/streetGraph.js';
import { cityAt } from '../../worlds/cityGrid.js';
import type { PlayerState } from './player.js';

/** how far off a street's line (rad) it still pulls toward it */
export const ASSIST_REACH = 30 * Math.PI / 180;
/** the fastest it turns the vehicle (rad/s), the slowest speed it works at
 * (m/s), the steering below which the wheel counts as centred, and how far
 * from a street's centre line it is on that street (m) */
const RATE = 1, MIN_V = 2, CENTRED = 0.12, ON_STREET = 6;

const wrap = (a: number): number => Math.atan2(Math.sin(a), Math.cos(a));

export class StreetAssist {
  /** the headings (both ways) of the streets the vehicle is on, refreshed ~7×/s */
  private axes: number[] = [];
  private t = 0;

  /** forget the streets (a teleport, a new island) */
  reset(): void { this.axes.length = 0; this.t = 0; }

  /** the headings of every street within ON_STREET m of (x, z), both ways */
  private find(x: number, z: number): number[] {
    const c = cityAt(x, z), g = graphFor(c.bx, c.by), lx = x - c.ox, lz = z - c.oz;
    const out: number[] = [];
    for (const e of g.edges) {
      const a = g.nodes[e.a];
      const s = Math.max(0, Math.min(e.len, (lx - a.x) * e.ux + (lz - a.z) * e.uz));
      if (Math.hypot(lx - (a.x + e.ux * s), lz - (a.z + e.uz * s)) > ON_STREET) continue;
      out.push(e.heading, wrap(e.heading + Math.PI));
    }
    return out;
  }

  /** ease the heading of a road vehicle toward the street it is nearly along
   * (call every frame it drives; `steer` is the kid's own steering) */
  update(dt: number, st: PlayerState, steer: number): void {
    this.t -= dt;
    if (this.t <= 0) { this.t = 0.15; this.axes = this.find(st.x, st.z); }
    if (Math.abs(steer) > CENTRED || Math.abs(st.v) < MIN_V || !this.axes.length) return;
    // (the way it's going: backing up, the other end of the vehicle leads)
    const h = st.v >= 0 ? st.heading : st.heading + Math.PI;
    let best = Infinity;
    for (const a of this.axes) { const d = wrap(a - h); if (Math.abs(d) < Math.abs(best)) best = d; }
    if (Math.abs(best) > ASSIST_REACH) return;
    // (gentler the further off it is, and not at all once it is straight)
    const w = 1 - 0.6 * Math.abs(best) / ASSIST_REACH;
    const step = Math.max(-RATE * w * dt, Math.min(RATE * w * dt, best));
    st.heading = wrap(st.heading + step);
  }
}
