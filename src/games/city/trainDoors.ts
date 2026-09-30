// The kid's train at a station (G6): the doors game, played in the world
// with the wheel alone (the train doesn't steer, so the wheel is free).
// Stopped at a platform, holding the wheel right fills the gauge and the
// doors slide open; the people get off and on (boarding.ts); when everyone
// is aboard a bell rings, and holding the wheel left closes them — then the
// train may go. It can't get a child stuck (G3): the gauge never drains, a
// child swinging the wheel both ways gets there, and if nobody turns it the
// narrator asks again after NUDGE_T and the doors move by themselves after
// AUTO_T. Pure: the game drives it every frame and plays its events;
// tools/check-trains.ts plays it headless.

export type DoorPhase = 'shut' | 'opening' | 'open' | 'aboard' | 'closing' | 'closed';
export type DoorEvent = 'askOpen' | 'opened' | 'allAboard' | 'askClose' | 'closed';

/** seconds of the wheel held over to open or close, and the slide */
export const DOOR_HOLD = 0.8, DOOR_SLIDE = 0.7;
/** the narrator asks again after this; after AUTO_T the doors move by themselves */
export const NUDGE_T = 8, AUTO_T = 20;
/** how far the wheel counts as turned */
const TURNED = 0.35;

export class TrainDoors {
  phase: DoorPhase = 'shut';
  /** the wheel gauge 0 … 1 (the prompt's bar) */
  gauge = 0;
  /** how far open the doors are, 0 … 1 */
  open = 0;
  private t = 0;
  private nudged = false;

  /** stopped at a platform: the doors game begins */
  constructor() { this.phase = 'shut'; }

  /** is the train held by its doors (open, or not yet shut again) */
  get holding(): boolean { return this.phase !== 'closed'; }

  /** the wheel a perfect player would use now */
  aim(): number { return this.phase === 'shut' ? 1 : this.phase === 'aboard' ? -1 : 0; }

  /** step it: `steer` +1 right … −1 left; `busy` people still getting off
   * or on; `gas` the pedal (held once everyone is aboard, it closes the
   * doors too); the moments the game gives a sound or a word */
  update(dt: number, steer: number, busy: boolean, gas = 0): DoorEvent[] {
    const ev: DoorEvent[] = [];
    this.t += dt;
    const nudge = (e: DoorEvent): void => {
      if (!this.nudged && this.t >= NUDGE_T) { this.nudged = true; ev.push(e); }
    };
    switch (this.phase) {
      case 'shut':
        if (this.t < dt * 1.5) ev.push('askOpen');
        if (steer > TURNED) this.gauge = Math.min(1, this.gauge + dt / DOOR_HOLD);
        nudge('askOpen');
        if (this.gauge >= 1 || this.t >= AUTO_T) this.go('opening');
        break;
      case 'opening':
        this.open = Math.min(1, this.open + dt / DOOR_SLIDE);
        if (this.open >= 1) { this.go('open'); ev.push('opened'); }
        break;
      case 'open':
        // (at least a moment open, then until everyone is off and on)
        if (this.t > 1 && !busy) { this.go('aboard'); ev.push('allAboard'); }
        break;
      case 'aboard':
        // (the wheel left — or the gas held, a child who just wants to go)
        if (steer < -TURNED || gas > 0.3) this.gauge = Math.min(1, this.gauge + dt / (steer < -TURNED ? DOOR_HOLD : DOOR_HOLD * 2));
        nudge('askClose');
        if (this.gauge >= 1 || this.t >= AUTO_T) this.go('closing');
        break;
      case 'closing':
        this.open = Math.max(0, this.open - dt / DOOR_SLIDE);
        if (this.open <= 0) { this.go('closed'); ev.push('closed'); }
        break;
      case 'closed':
        break;
    }
    return ev;
  }

  private go(p: DoorPhase): void {
    this.phase = p;
    this.t = 0;
    this.gauge = 0;
    this.nudged = false;
  }
}
