// Procedural Web Audio (G11): every sound is made here in code — no audio
// files. A small mixer (master → mute, sfx and ambience buses, ducked while
// a voice line plays), one engine voice for the kid's vehicle (road engine,
// helicopter rotor, plane propeller, boat motor, train hum and clickety-
// clack), the siren (a European two-tone, each vehicle its own), the pump,
// one-shots (jingles, chimes, dings, beeps, a boing, horns, bells, splashes)
// and a soft ambience (birds by day, crickets at night, waves by the sea).
// Everything is built lazily on the first user gesture (autoplay rules).

export type EngineKind = 'car' | 'truck' | 'kart' | 'heli' | 'plane' | 'boat' | 'train';
export type SirenStyle = 'fire' | 'ambulance' | 'police' | 'heli';

const MUTE_KEY = 'game.mute';
/** the effects' and the ambience's levels — well under the narrator's voice
 * (which plays on its own at full level) — and how far a voice line ducks them */
const SFX_LEVEL = 0.5, AMB_LEVEL = 0.45, DUCK = 0.45;
/** the siren's two tones (Hz) and how long each lasts (s) */
const SIREN: Record<SirenStyle, { lo: number; hi: number; tone: number; gain: number }> = {
  fire: { lo: 660, hi: 880, tone: 0.55, gain: 0.05 },
  ambulance: { lo: 740, hi: 990, tone: 0.45, gain: 0.05 },
  police: { lo: 800, hi: 1060, tone: 0.33, gain: 0.05 },
  heli: { lo: 700, hi: 930, tone: 0.45, gain: 0.03 },
};

interface EngineVoice { out: GainNode; set(speed: number, gas: number, t: number): void }

export class GameAudio {
  private ac: AudioContext | null = null;
  private master: GainNode | null = null;
  private sfx: GainNode | null = null;
  private amb: GainNode | null = null;
  private sirenOsc: OscillatorNode | null = null;
  private sirenLfo: OscillatorNode | null = null;
  private sirenLfoGain: GainNode | null = null;
  private sirenGain: GainNode | null = null;
  private sirenStyle: SirenStyle | null = null;
  private pumpGain: GainNode | null = null;
  private noise: AudioBuffer | null = null;
  private engines = new Map<EngineKind, EngineVoice>();
  private engineKind: EngineKind | null = null;
  private crossing: { gain: GainNode; pan: StereoPannerNode; next: number } | null = null;
  private ambience: { waves: GainNode; birdsAt: number; cricketsAt: number } | null = null;
  private muted = false;

  constructor() {
    try { this.muted = localStorage.getItem(MUTE_KEY) === '1'; } catch { /* no storage */ }
  }

  /** Idempotent: the first call builds the mixer, later calls do nothing. */
  unlock(): void {
    if (this.ac) { void this.ac.resume().catch(() => {}); return; }
    try {
      const ac = new (window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext)();
      this.ac = ac;
      this.master = ac.createGain();
      this.master.gain.value = this.muted ? 0 : 1;
      this.master.connect(ac.destination);
      this.sfx = ac.createGain();
      this.sfx.gain.value = SFX_LEVEL;
      this.sfx.connect(this.master);
      this.amb = ac.createGain();
      this.amb.gain.value = AMB_LEVEL;
      this.amb.connect(this.master);
      // white noise, shared by every noisy sound
      const buf = ac.createBuffer(1, ac.sampleRate * 2, ac.sampleRate);
      const d = buf.getChannelData(0);
      for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
      this.noise = buf;
      // the siren: a triangle whose pitch a square LFO flips between two tones
      const osc = ac.createOscillator();
      osc.type = 'triangle';
      const lfo = ac.createOscillator();
      lfo.type = 'square';
      const lfoGain = ac.createGain();
      lfo.connect(lfoGain);
      lfoGain.connect(osc.frequency);
      this.sirenGain = ac.createGain();
      this.sirenGain.gain.value = 0;
      osc.connect(this.sirenGain);
      this.sirenGain.connect(this.sfx);
      osc.start();
      lfo.start();
      this.sirenOsc = osc; this.sirenLfo = lfo; this.sirenLfoGain = lfoGain;
      // the fire hose's pump: band-passed noise
      const src = this.noiseSource();
      const bp = ac.createBiquadFilter();
      bp.type = 'bandpass'; bp.frequency.value = 1700; bp.Q.value = 0.7;
      this.pumpGain = ac.createGain();
      this.pumpGain.gain.value = 0;
      src.connect(bp); bp.connect(this.pumpGain); this.pumpGain.connect(this.sfx);
      src.start();
    } catch {
      this.ac = null;
    }
  }

  /** is the game silent? (remembered for every visit) */
  get isMuted(): boolean { return this.muted; }
  setMuted(m: boolean): void {
    this.muted = m;
    try { localStorage.setItem(MUTE_KEY, m ? '1' : '0'); } catch { /* no storage */ }
    if (this.master && this.ac) this.master.gain.setTargetAtTime(m ? 0 : 1, this.ac.currentTime, 0.05);
  }

  /** duck the sound effects and ambience under a voice line */
  duck(on: boolean): void {
    if (!this.ac || !this.sfx || !this.amb) return;
    const t = this.ac.currentTime;
    this.sfx.gain.setTargetAtTime(SFX_LEVEL * (on ? DUCK : 1), t, 0.12);
    this.amb.gain.setTargetAtTime(AMB_LEVEL * (on ? DUCK : 1), t, 0.12);
  }

  /** the siren on / off in the vehicle's own two tones */
  setSiren(active: boolean, style: SirenStyle = 'fire'): void {
    const ac = this.ac;
    if (!ac || !this.sirenGain || !this.sirenOsc || !this.sirenLfo || !this.sirenLfoGain) return;
    const s = SIREN[style];
    if (style !== this.sirenStyle) {
      this.sirenStyle = style;
      this.sirenOsc.frequency.value = (s.lo + s.hi) / 2;
      this.sirenLfoGain.gain.value = (s.hi - s.lo) / 2;
      this.sirenLfo.frequency.value = 1 / (2 * s.tone);
    }
    this.sirenGain.gain.setTargetAtTime(active ? s.gain : 0, ac.currentTime, 0.08);
  }

  setPump(active: boolean): void {
    if (this.pumpGain && this.ac) this.pumpGain.gain.setTargetAtTime(active ? 0.12 : 0, this.ac.currentTime, 0.05);
  }

  // ---- the kid's vehicle ----

  /** the engine of the kid's vehicle: `speed` 0 … 1 of its top speed, `gas`
   * 0 … 1; null silences it (a mission scene) */
  setEngine(kind: EngineKind | null, speed = 0, gas = 0): void {
    const ac = this.ac;
    if (!ac) return;
    if (kind !== this.engineKind) {
      if (this.engineKind) this.engines.get(this.engineKind)?.out.gain.setTargetAtTime(0, ac.currentTime, 0.2);
      this.engineKind = kind;
    }
    if (!kind) return;
    let v = this.engines.get(kind);
    if (!v) { v = this.makeEngine(kind); this.engines.set(kind, v); }
    v.set(Math.max(0, Math.min(1, speed)), Math.max(0, Math.min(1, gas)), ac.currentTime);
  }

  private makeEngine(kind: EngineKind): EngineVoice {
    const ac = this.ac!;
    const out = ac.createGain();
    out.gain.value = 0;
    out.connect(this.sfx!);
    const osc = (type: OscillatorType, f: number): OscillatorNode => { const o = ac.createOscillator(); o.type = type; o.frequency.value = f; o.start(); return o; };
    const filt = (type: BiquadFilterType, f: number, q = 0.7): BiquadFilterNode => { const b = ac.createBiquadFilter(); b.type = type; b.frequency.value = f; b.Q.value = q; return b; };
    const ramp = (p: AudioParam, v: number, t: number, k = 0.08): void => { p.setTargetAtTime(v, t, k); };
    if (kind === 'car' || kind === 'truck' || kind === 'kart') {
      // two detuned saws through a lowpass, pitch and brightness with speed;
      // a slow tremolo gives the idle its rumble
      const [f0, f1] = kind === 'truck' ? [42, 105] : kind === 'kart' ? [95, 280] : [58, 165];
      const a = osc('sawtooth', f0), b = osc('sawtooth', f0 * 1.01);
      const lp = filt('lowpass', 300);
      const trem = ac.createGain();
      const lfo = osc('sine', 9), lfoAmt = ac.createGain();
      lfoAmt.gain.value = 0.25;
      lfo.connect(lfoAmt); lfoAmt.connect(trem.gain);
      a.connect(lp); b.connect(lp); lp.connect(trem); trem.connect(out);
      return {
        out,
        set: (sp, gas, t) => {
          const f = f0 + (f1 - f0) * sp + gas * 8;
          ramp(a.frequency, f, t); ramp(b.frequency, f * 1.012, t);
          ramp(lp.frequency, 260 + sp * 900 + gas * 300, t);
          ramp(lfo.frequency, 7 + sp * 18, t);
          ramp(out.gain, (kind === 'truck' ? 0.05 : 0.04) + sp * 0.03 + gas * 0.015, t, 0.15);
        },
      };
    }
    if (kind === 'heli') {
      // rotor chop: low-passed noise and a low thump, both beating ~11 Hz
      const n = this.noiseSource();
      const lp = filt('lowpass', 700);
      const thump = osc('sine', 52);
      const beat = ac.createGain();
      beat.gain.value = 0.5;
      const lfo = osc('square', 11), lfoAmt = ac.createGain();
      lfoAmt.gain.value = 0.5;
      lfo.connect(lfoAmt); lfoAmt.connect(beat.gain);
      const tg = ac.createGain(); tg.gain.value = 0.6;
      n.connect(lp); lp.connect(beat); thump.connect(tg); tg.connect(beat); beat.connect(out);
      n.start();
      return { out, set: (sp, _g, t) => { ramp(lfo.frequency, 10 + sp * 3, t); ramp(out.gain, 0.07 + sp * 0.02, t, 0.2); } };
    }
    if (kind === 'plane') {
      // a propeller's buzz: a band-passed saw with a fast tremolo
      const a = osc('sawtooth', 110);
      const bp = filt('bandpass', 650, 1.2);
      const trem = ac.createGain();
      const lfo = osc('sine', 24), lfoAmt = ac.createGain();
      lfoAmt.gain.value = 0.35;
      lfo.connect(lfoAmt); lfoAmt.connect(trem.gain);
      a.connect(bp); bp.connect(trem); trem.connect(out);
      return {
        out,
        set: (sp, gas, t) => {
          ramp(a.frequency, 100 + sp * 80 + gas * 10, t);
          ramp(lfo.frequency, 20 + sp * 14, t);
          ramp(out.gain, 0.05 + sp * 0.03, t, 0.2);
        },
      };
    }
    if (kind === 'boat') {
      // a putt-putt motor and the water rushing by
      const a = osc('sawtooth', 70);
      const lp = filt('lowpass', 420);
      const putt = ac.createGain();
      const lfo = osc('square', 7), lfoAmt = ac.createGain();
      lfoAmt.gain.value = 0.45;
      lfo.connect(lfoAmt); lfoAmt.connect(putt.gain);
      a.connect(lp); lp.connect(putt); putt.connect(out);
      const n = this.noiseSource(), hp = filt('highpass', 1400), wg = ac.createGain();
      wg.gain.value = 0;
      n.connect(hp); hp.connect(wg); wg.connect(out);
      n.start();
      return {
        out,
        set: (sp, gas, t) => {
          ramp(a.frequency, 65 + sp * 70, t); ramp(lfo.frequency, 6 + sp * 12 + gas * 2, t);
          ramp(wg.gain, sp * 0.5, t, 0.2); ramp(out.gain, 0.05 + sp * 0.03, t, 0.2);
        },
      };
    }
    // the train: a low electric hum, and the wheels' clickety-clack over
    // the rail joints — two clicks, a pause — faster with speed
    const hum = osc('sawtooth', 48);
    const lp = filt('lowpass', 220);
    hum.connect(lp); lp.connect(out);
    let next = 0, second = false;
    return {
      out,
      set: (sp, _g, t) => {
        ramp(hum.frequency, 44 + sp * 30, t);
        ramp(out.gain, 0.03 + sp * 0.04, t, 0.2);
        if (sp < 0.05) { next = t + 0.3; return; }
        if (t >= next) {
          this.click(0.12 * (0.4 + sp));
          next = t + (second ? 1.6 : 0.22) / (0.4 + sp * 1.6);
          second = !second;
        }
      },
    };
  }

  private noiseSource(): AudioBufferSourceNode {
    const s = this.ac!.createBufferSource();
    s.buffer = this.noise;
    s.loop = true;
    return s;
  }

  // ---- one-shots ----

  /** a note: `type` oscillator at f Hz from `at` for `len` s, fading out */
  private note(f: number, at: number, len: number, gain: number, type: OscillatorType = 'triangle', dest?: AudioNode, glideTo?: number): void {
    const ac = this.ac!;
    const o = ac.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(f, at);
    if (glideTo) o.frequency.exponentialRampToValueAtTime(glideTo, at + len);
    const g = ac.createGain();
    g.gain.setValueAtTime(0.0001, at);
    g.gain.exponentialRampToValueAtTime(gain, at + 0.012);
    g.gain.exponentialRampToValueAtTime(0.0001, at + len);
    o.connect(g); g.connect(dest ?? this.sfx!);
    o.start(at); o.stop(at + len + 0.05);
  }

  /** a burst of filtered noise */
  private hiss(at: number, len: number, gain: number, type: BiquadFilterType, f: number, dest?: AudioNode): void {
    const ac = this.ac!;
    const s = ac.createBufferSource();
    s.buffer = this.noise;
    const b = ac.createBiquadFilter();
    b.type = type; b.frequency.value = f;
    const g = ac.createGain();
    g.gain.setValueAtTime(gain, at);
    g.gain.exponentialRampToValueAtTime(0.0001, at + len);
    s.connect(b); b.connect(g); g.connect(dest ?? this.sfx!);
    s.start(at, Math.random()); s.stop(at + len + 0.05);
  }

  private click(gain: number): void {
    if (!this.ac) return;
    this.hiss(this.ac.currentTime, 0.05, gain, 'bandpass', 2400);
  }

  /** a panned, distance-faded destination for a sound somewhere in the world */
  private placed(pan: number, dist: number): AudioNode {
    const ac = this.ac!;
    const p = ac.createStereoPanner();
    p.pan.value = Math.max(-1, Math.min(1, pan));
    const g = ac.createGain();
    g.gain.value = 1 / (1 + dist / 25);
    p.connect(g); g.connect(this.sfx!);
    return p;
  }

  thud(): void {
    if (!this.ac) return;
    this.hiss(this.ac.currentTime, 0.18, 0.5, 'lowpass', 220);
  }

  /** a cartoon "boing" (a bump, a crash) */
  boing(): void {
    if (!this.ac) return;
    const t = this.ac.currentTime;
    this.note(330, t, 0.35, 0.12, 'sine', undefined, 120);
    this.thud();
  }

  /** the mission-complete jingle: a bright arpeggio up */
  jingle(): void {
    if (!this.ac) return;
    const t = this.ac.currentTime;
    [523, 659, 784, 1047].forEach((f, i) => this.note(f, t + i * 0.11, 0.3, 0.12));
    this.note(1568, t + 0.44, 0.6, 0.06, 'sine');
  }

  /** a star earned: a twinkling chime */
  star(): void {
    if (!this.ac) return;
    const t = this.ac.currentTime;
    [1319, 1760, 2093, 2637].forEach((f, i) => this.note(f, t + i * 0.07, 0.5, 0.06, 'sine'));
  }

  /** a gate, ring or buoy passed: a bell ding */
  ding(): void {
    if (!this.ac) return;
    const t = this.ac.currentTime;
    this.note(1320, t, 0.7, 0.1, 'sine');
    this.note(2640, t, 0.4, 0.03, 'sine');
  }

  /** the race countdown: a beep, higher on GO */
  beep(go = false): void {
    if (!this.ac) return;
    this.note(go ? 988 : 659, this.ac.currentTime, go ? 0.5 : 0.22, 0.09, 'square');
  }

  /** a lap done: two notes up */
  lap(): void {
    if (!this.ac) return;
    const t = this.ac.currentTime;
    this.note(784, t, 0.18, 0.09); this.note(1175, t + 0.14, 0.3, 0.09);
  }

  /** the station's bell (three dings) */
  stationBell(): void {
    if (!this.ac) return;
    const t = this.ac.currentTime;
    for (let i = 0; i < 3; i++) { this.note(1047, t + i * 0.28, 0.5, 0.08, 'sine'); this.note(2094, t + i * 0.28, 0.25, 0.02, 'sine'); }
  }

  /** the train doors' chime: two notes down */
  doorChime(): void {
    if (!this.ac) return;
    const t = this.ac.currentTime;
    this.note(880, t, 0.35, 0.08, 'sine'); this.note(659, t + 0.3, 0.5, 0.08, 'sine');
  }

  /** the train's horn */
  trainHorn(): void {
    if (!this.ac) return;
    const t = this.ac.currentTime;
    for (const f of [311, 370]) this.note(f, t, 0.9, 0.05, 'sawtooth');
  }

  /** a car's horn somewhere (pan −1 left … 1 right, dist m): a short double beep */
  honk(pan = 0, dist = 10): void {
    if (!this.ac) return;
    const t = this.ac.currentTime, dest = this.placed(pan, dist);
    for (const at of [0, 0.22]) for (const f of [415, 523]) this.note(f, t + at, 0.16, 0.05, 'sawtooth', dest);
  }

  /** a splash in the river */
  splash(): void {
    if (!this.ac) return;
    this.hiss(this.ac.currentTime, 0.45, 0.12, 'bandpass', 900);
  }

  /** a level crossing's bells ringing (while on), panned where it is */
  crossingBell(on: boolean, pan = 0, dist = 30): void {
    const ac = this.ac;
    if (!ac) return;
    if (!this.crossing) {
      const pn = ac.createStereoPanner(), g = ac.createGain();
      g.gain.value = 0;
      pn.connect(g); g.connect(this.sfx!);
      this.crossing = { gain: g, pan: pn, next: 0 };
    }
    const c = this.crossing, t = ac.currentTime;
    c.gain.gain.setTargetAtTime(on ? 1 / (1 + dist / 20) : 0, t, 0.1);
    c.pan.pan.setTargetAtTime(Math.max(-1, Math.min(1, pan)), t, 0.1);
    if (on && t >= c.next) {
      this.note(1480, t, 0.25, 0.06, 'square', c.pan);
      c.next = t + 0.5;
    }
  }

  // ---- ambience ----

  /** the world around: birds by day, crickets at night (0 … 1), waves as the
   * sea comes near (`sea` 0 far … 1 on the beach) */
  setAmbience(night: number, sea: number): void {
    const ac = this.ac;
    if (!ac) return;
    const t = ac.currentTime;
    if (!this.ambience) {
      const n = this.noiseSource(), lp = ac.createBiquadFilter(), waves = ac.createGain();
      lp.type = 'lowpass'; lp.frequency.value = 500;
      const swell = ac.createGain(), lfo = ac.createOscillator(), amt = ac.createGain();
      lfo.frequency.value = 0.12; amt.gain.value = 0.5; swell.gain.value = 0.6;
      lfo.connect(amt); amt.connect(swell.gain);
      n.connect(lp); lp.connect(swell); swell.connect(waves); waves.connect(this.amb!);
      waves.gain.value = 0;
      n.start(); lfo.start();
      this.ambience = { waves, birdsAt: t + 2, cricketsAt: t + 1 };
    }
    const a = this.ambience;
    a.waves.gain.setTargetAtTime(0.08 * sea, t, 0.5);
    // a bird's chirp now and then by day: two or three quick whistles
    if (night < 0.5 && t >= a.birdsAt) {
      const f = 2400 + Math.random() * 1600, n = 2 + ((Math.random() * 2) | 0);
      for (let i = 0; i < n; i++) this.note(f, t + i * 0.12, 0.09, 0.025 * (1 - night * 2), 'sine', this.amb!, f * 1.35);
      a.birdsAt = t + 2 + Math.random() * 5;
    }
    // crickets at night: soft trills
    if (night > 0.5 && t >= a.cricketsAt) {
      for (let i = 0; i < 4; i++) this.note(4400, t + i * 0.05, 0.035, 0.012 * night, 'sine', this.amb!);
      a.cricketsAt = t + 0.6 + Math.random() * 1.2;
    }
  }
}
