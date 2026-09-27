// The narrator (G9, G11): a friendly voice in the game — a briefing for the
// mode when the game starts, the kind of each new call, arriving, praise
// when something is done, encouragement after a bump, the race's countdown,
// last lap and finish, the station, night falling and the morning; in the
// chase where a getaway car was spotted (left, right, ahead, behind), nearly
// catching it and it dashing off; on a course praise at every gate and the
// last two counted down; in the race every overtake, being overtaken and
// holding the lead; halfway through a mission's scene; in the scenes a new
// flame flaring up, the cat moving, the hearts to pick up, the foot chase
// and "hold on tight" as someone is lifted. Every
// line is a recorded clip (make-voice.py, say.* keys); most moments have a
// few variants, never the same one twice in a row, so it doesn't repeat
// itself. It is never chatty: a small line waits its turn or is dropped
// while another is being said, and each kind of moment has a cooldown.
import { speak, speaking } from '../../i18n/voice.js';

type Moment = 'start' | 'call' | 'arrive' | 'praise' | 'gate' | 'gateTwo' | 'gateLast' | 'courseDone'
  | 'caught' | 'spotted' | 'closing' | 'dashed' | 'oops'
  | 'raceCount' | 'lastLap' | 'place' | 'raceUp' | 'raceDown' | 'raceLead' | 'almost' | 'station' | 'brake' | 'missed' | 'night' | 'morning'
  | 'flame' | 'catMoved' | 'hearts' | 'chaseRun' | 'hold';

/** how many variants each moment has (say.<moment>.<n>) */
const VARIANTS: Partial<Record<Moment, number>> = {
  arrive: 3, praise: 5, gate: 5, caught: 2, closing: 2, dashed: 2, oops: 3, station: 2, raceDown: 2, raceLead: 2, almost: 2, missed: 2, flame: 2,
};
/** the fewest seconds between two lines of the same kind of moment */
const COOLDOWN: Partial<Record<Moment, number>> = {
  arrive: 8, gate: 6, oops: 10, call: 6, praise: 3, spotted: 15, closing: 8, dashed: 6, raceUp: 3, raceDown: 12, raceLead: 25, brake: 20, flame: 7, catMoved: 8, hold: 6,
};
/** moments that cut in over whatever is being said */
const URGENT = new Set<Moment>(['start', 'raceCount', 'place', 'lastLap', 'brake', 'missed']);

export class Narrator {
  private last = new Map<string, number>();
  private lastSaid = new Map<Moment, number>();
  private t = 0;

  /** @param root the path from the page to the site root (the clips) */
  constructor(private root: string) {}

  tick(dt: number): void { this.t += dt; }

  /** is it talking? (the game ducks its sound under it) */
  get talking(): boolean { return speaking(); }

  /** say something for a moment; `detail` picks the line (the mode, the
   * call's kind, the race place) */
  say(m: Moment, detail?: string | number): void {
    if (this.t - (this.lastSaid.get(m) ?? -99) < (COOLDOWN[m] ?? 0)) return;
    if (!URGENT.has(m) && speaking()) return;
    const id = this.pick(m, detail);
    if (!id) return;
    this.lastSaid.set(m, this.t);
    void speak(id, this.root);
  }

  private pick(m: Moment, detail?: string | number): string | null {
    switch (m) {
      case 'start': return `say-start-${detail}`;
      case 'call': return this.variant(`say-call-${detail}`, 2);
      case 'courseDone': return 'say-course-done';
      case 'raceCount': return 'say-race-count';
      case 'lastLap': return 'say-race-lastLap';
      case 'place': return `say-race-place${Math.min(4, Math.max(1, Number(detail) || 4))}`;
      case 'spotted': return this.variant(`say-spotted-${detail}`, 2);
      case 'gateTwo': return 'say-gate-two';
      case 'brake': return 'say-brake';
      case 'gateLast': return 'say-gate-last';
      case 'raceUp': return detail === 1 ? this.variant('say-race-up1', 2) : detail === 2 || detail === 3 ? `say-race-up${detail}` : null;
      case 'raceDown': return this.variant('say-race-down', 2);
      case 'raceLead': return this.variant('say-race-lead', 2);
      case 'night': return 'say-night';
      case 'morning': return 'say-morning';
      default: return this.variant(`say-${m}`, VARIANTS[m] ?? 1);
    }
  }

  /** one of `n` variants (base-1 … base-n), never the last one again */
  private variant(base: string, n: number): string {
    const prev = this.last.get(base) ?? 0;
    let k = 1 + Math.floor(Math.random() * n);
    if (n > 1 && k === prev) k = (k % n) + 1;
    this.last.set(base, k);
    return `${base}-${k}`;
  }
}
