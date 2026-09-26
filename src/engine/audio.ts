// The game's sound (G11). A small mixer (master → mute, sfx and ambience
// buses, ducked while a voice line plays); one engine voice for the kid's
// vehicle (road engine, helicopter rotor, plane propeller, boat motor, train
// on its rails); the siren (a European two-tone, each vehicle its own); the
// pump; one-shots (jingles, chimes, dings, beeps, a boing, horns, bells,
// splashes); and a soft ambience (birds by day, crickets at night, waves by
// the sea). Each plays its recording (sfxList.ts, recorded by
// tools/make-sfx.py into public/audio/sfx/) — the loops at a speed that
// follows the vehicle's — and, until a recording has loaded or where there
// is none, a sound synthesized here in code. And the music (G12: musicList.ts,
// recorded by tools/make-music.py into public/audio/music/), on a bus of its
// own under everything, crossfading from track to track as the moment
// changes. Everything is built lazily on the first user gesture (autoplay rules).

import { SFX, type SfxId } from './sfxList.js';
import { MUSIC, trackFile, type MusicId } from './musicList.js';

export type EngineKind = 'car' | 'truck' | 'kart' | 'heli' | 'plane' | 'boat' | 'train';
export type SirenStyle = 'fire' | 'ambulance' | 'police' | 'heli';

const MUTE_KEY = 'game.mute', MUSIC_KEY = 'game.music';
/** the music's level — under the effects, far under the voice — and how far
 * a voice line ducks it */
const MUSIC_LEVEL = 0.3, MUSIC_DUCK = 0.45;
/** a change of track crossfades over about this long (s) */
const MUSIC_FADE = 2.4;
/** each track of a moment plays at least this long (s, in whole passes of
 * its loop) before the moment moves on to its next */
const MUSIC_TURN = 100;
/** moments that start a track afresh every time — a mission's scene, each
 * scene the next track — rather than carrying on where they left off */
const FRESH: ReadonlySet<MusicId> = new Set<MusicId>(['scene']);

interface Playlist { order: number[]; pos: number; offset: number }
/** 0 … n−1 in a random order (the music's order: no part of the world) */
function shuffled(n: number): number[] {
  const a = Array.from({ length: n }, (_, i) => i);
  for (let i = n - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
  return a;
}
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

/** a recorded engine loop's playback speed at rest and how much faster it
 * runs flat out, and its level at rest and flat out */
const ENGINE_REC: Record<EngineKind, { rate: number; up: number; g0: number; g1: number }> = {
  car: { rate: 0.85, up: 0.4, g0: 0.35, g1: 0.7 },
  truck: { rate: 0.85, up: 0.5, g0: 0.4, g1: 0.8 },
  kart: { rate: 0.85, up: 0.9, g0: 0.3, g1: 0.75 },
  heli: { rate: 0.95, up: 0.2, g0: 0.55, g1: 0.7 },
  plane: { rate: 0.9, up: 0.35, g0: 0.5, g1: 0.75 },
  boat: { rate: 0.85, up: 0.6, g0: 0.3, g1: 0.75 },
  train: { rate: 0.7, up: 0.55, g0: 0.0, g1: 0.8 },
};
/** how often a level crossing's bell strikes (s) */
const CROSSING_PACE = 0.55;
/** which recording each siren style plays, and how loud */
const SIREN_REC: Record<SirenStyle, { id: SfxId; gain: number }> = {
  fire: { id: 'siren-fire', gain: 0.55 },
  ambulance: { id: 'siren-ambulance', gain: 0.55 },
  police: { id: 'siren-police', gain: 0.55 },
  heli: { id: 'siren-ambulance', gain: 0.35 },
};

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
  private engineRec: SfxId | null = null;
  /** the race rivals' engines: a voice of its own each (panned where it is) */
  private rivalVoices: Array<{ id: SfxId; src: AudioBufferSourceNode; gain: GainNode; pan: StereoPannerNode } | null> = [];
  private crossing: { gain: GainNode; pan: StereoPannerNode; next: number } | null = null;
  private ambience: { waves: GainNode; birdsAt: number; cricketsAt: number } | null = null;
  private muted = false;
  /** the recordings, as they load */
  private samples = new Map<SfxId, AudioBuffer>();
  /** the recorded loops playing (each silent until asked for) */
  private loops = new Map<SfxId, { src: AudioBufferSourceNode; gain: GainNode }>();
  // ---- the music ----
  private musicBus: GainNode | null = null;
  private musicOn = true;
  private ducked = false;
  /** the tracks, by file, as they load */
  private tracks = new Map<string, AudioBuffer>();
  private loading = new Set<string>();
  /** tracks that couldn't be had (never asked for again) */
  private missing = new Set<string>();
  private wantMoment: MusicId | null = null;
  private track: { moment: MusicId; file: string; src: AudioBufferSourceNode; gain: GainNode; startedAt: number; offset: number; until: number } | null = null;
  /** each moment's playlist: its tracks shuffled, the one it is on, and where
   * that one was when it last faded out (coming back carries on) */
  private playlists = new Map<MusicId, Playlist>();

  /** @param root the path from the page to the site root (the recordings)
   * @param sfx load the sound effects (the garage plays only music) */
  constructor(private root = '', private sfxOn = true) {
    try {
      this.muted = localStorage.getItem(MUTE_KEY) === '1';
      this.musicOn = localStorage.getItem(MUSIC_KEY) !== '0';
    } catch { /* no storage */ }
  }

  /** fetch and decode every recording (a missing one keeps its synth sound) */
  private loadSamples(): void {
    const ac = this.ac!;
    for (const id of Object.keys(SFX) as SfxId[]) {
      void fetch(`${this.root}audio/sfx/${id}.ogg`)
        .then(r => (r.ok ? r.arrayBuffer() : Promise.reject(new Error(String(r.status)))))
        .then(b => ac.decodeAudioData(b))
        .then(buf => { this.samples.set(id, buf); })
        .catch(() => { /* synthesized instead */ });
    }
  }

  /** a recorded loop, started silent once (null: not loaded) */
  private loopOf(id: SfxId, dest?: AudioNode): { src: AudioBufferSourceNode; gain: GainNode } | null {
    let l = this.loops.get(id);
    if (l) return l;
    const buf = this.samples.get(id);
    if (!buf || !this.ac) return null;
    const src = this.ac.createBufferSource();
    src.buffer = buf;
    src.loop = true;
    const gain = this.ac.createGain();
    gain.gain.value = 0;
    src.connect(gain); gain.connect(dest ?? this.sfx!);
    src.start();
    l = { src, gain };
    this.loops.set(id, l);
    return l;
  }

  /** a recorded one-shot at an exact time on the audio clock */
  private shotAt(id: SfxId, when: number, gain: number, dest: AudioNode): void {
    const buf = this.samples.get(id);
    if (!buf || !this.ac) return;
    const src = this.ac.createBufferSource();
    src.buffer = buf;
    const g = this.ac.createGain();
    g.gain.value = gain;
    src.connect(g); g.connect(dest);
    src.start(when);
  }

  /** play a recorded one-shot (false: not loaded — the caller synthesizes) */
  private shot(id: SfxId, gain = 1, dest?: AudioNode): boolean {
    const buf = this.samples.get(id);
    if (!buf || !this.ac) return false;
    const src = this.ac.createBufferSource();
    src.buffer = buf;
    const g = this.ac.createGain();
    g.gain.value = gain;
    src.connect(g); g.connect(dest ?? this.sfx!);
    src.start();
    return true;
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
      this.musicBus = ac.createGain();
      this.musicBus.gain.value = this.musicOn ? MUSIC_LEVEL * (this.ducked ? MUSIC_DUCK : 1) : 0;
      this.musicBus.connect(this.master);
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
      if (this.sfxOn) this.loadSamples();
      if (this.wantMoment) this.setMusic(this.wantMoment);
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

  /** duck the sound effects, ambience and music under a voice line */
  duck(on: boolean): void {
    // (called every frame is fine: only a change ramps)
    if (on === this.ducked && this.ac) return;
    this.ducked = on;
    if (!this.ac || !this.sfx || !this.amb) return;
    const t = this.ac.currentTime;
    this.sfx.gain.setTargetAtTime(SFX_LEVEL * (on ? DUCK : 1), t, 0.12);
    this.amb.gain.setTargetAtTime(AMB_LEVEL * (on ? DUCK : 1), t, 0.12);
    this.musicLevel(0.15);
  }

  // ---- the music ----

  /** is the music on? (its own switch, remembered for every visit) */
  get isMusicOn(): boolean { return this.musicOn; }
  setMusicOn(on: boolean): void {
    this.musicOn = on;
    try { localStorage.setItem(MUSIC_KEY, on ? '1' : '0'); } catch { /* no storage */ }
    this.musicLevel(0.3);
  }

  private musicLevel(k: number): void {
    if (!this.ac || !this.musicBus) return;
    this.musicBus.gain.setTargetAtTime(this.musicOn ? MUSIC_LEVEL * (this.ducked ? MUSIC_DUCK : 1) : 0, this.ac.currentTime, k);
  }

  private playlist(id: MusicId): Playlist {
    let p = this.playlists.get(id);
    if (!p) { p = { order: shuffled(MUSIC[id].length), pos: 0, offset: 0 }; this.playlists.set(id, p); }
    return p;
  }

  /** a moment on to its next track: after the last, a new shuffle that
   * doesn't start with the one just played */
  private nextTrack(p: Playlist): void {
    p.offset = 0;
    if (++p.pos < p.order.length) return;
    const last = p.order[p.order.length - 1];
    p.order = shuffled(p.order.length);
    if (p.order.length > 1 && p.order[0] === last) p.order.push(p.order.shift()!);
    p.pos = 0;
  }

  /** the music for the moment now (null: none). Each moment plays its tracks
   * in turn, a couple of minutes each, crossfading from one to the next and
   * from moment to moment; coming back to a moment carries on where it left
   * off (a scene: the next track, from its start). Call it every frame. */
  setMusic(id: MusicId | null): void {
    this.wantMoment = id;
    const ac = this.ac;
    if (!ac || !this.musicBus) return;
    const t = ac.currentTime, cur = this.track;
    if (cur) {
      if (cur.moment === id && t < cur.until) {
        // (the moment's next track, fetched while this one plays)
        const p = this.playlist(id);
        if (p.pos + 1 < p.order.length) this.fetchTrack(trackFile(id, p.order[p.pos + 1]));
        return;
      }
      const p = this.playlist(cur.moment);
      if (cur.moment === id || FRESH.has(cur.moment)) this.nextTrack(p);
      else p.offset = (cur.offset + (t - cur.startedAt)) % cur.src.buffer!.duration;
      cur.gain.gain.setTargetAtTime(0, t, MUSIC_FADE / 4);
      cur.src.stop(t + MUSIC_FADE * 1.5);
      this.track = null;
    }
    if (!id) return;
    const p = this.playlist(id);
    // (a track that couldn't be had: the next one)
    for (let i = 0; i < p.order.length && this.missing.has(trackFile(id, p.order[p.pos])); i++) this.nextTrack(p);
    const file = trackFile(id, p.order[p.pos]), buf = this.tracks.get(file);
    // (not loaded yet: it starts once it has)
    if (!buf) { this.fetchTrack(file); return; }
    const src = ac.createBufferSource(), gain = ac.createGain(), at = t + 0.05;
    src.buffer = buf;
    src.loop = true;
    gain.gain.value = 0;
    gain.gain.setTargetAtTime(1, at, MUSIC_FADE / 4);
    src.connect(gain); gain.connect(this.musicBus);
    const dur = buf.duration, fresh = FRESH.has(id), offset = fresh ? 0 : p.offset % dur;
    src.start(at, offset);
    // (its turn: whole passes of its loop, so it hands over where the loop ends)
    const turn = fresh ? Infinity : Math.ceil(MUSIC_TURN / dur) * dur - offset;
    this.track = { moment: id, file, src, gain, startedAt: at, offset, until: at + turn };
  }

  /** fetch the track a moment would play now, so a change to it starts at once */
  preloadMusic(id: MusicId): void {
    const p = this.playlist(id);
    this.fetchTrack(trackFile(id, p.order[p.pos]));
  }

  private fetchTrack(file: string): void {
    const ac = this.ac;
    if (!ac || this.tracks.has(file) || this.loading.has(file) || this.missing.has(file)) return;
    this.loading.add(file);
    void fetch(`${this.root}audio/music/${file}.ogg`)
      .then(r => (r.ok ? r.arrayBuffer() : Promise.reject(new Error(String(r.status)))))
      .then(b => ac.decodeAudioData(b))
      .then(b => { this.tracks.set(file, b); })
      .catch(() => { this.missing.add(file); })
      .finally(() => {
        this.loading.delete(file);
        // (the music waiting for it: on now)
        if (!this.track && this.wantMoment) this.setMusic(this.wantMoment);
      });
  }

  /** the siren on / off in the vehicle's own two tones */
  setSiren(active: boolean, style: SirenStyle = 'fire'): void {
    const ac = this.ac;
    if (!ac || !this.sirenGain || !this.sirenOsc || !this.sirenLfo || !this.sirenLfoGain) return;
    // (the recording, where there is one: the synth stays silent)
    const rec = SIREN_REC[style], lv = this.loopOf(rec.id);
    if (lv) {
      this.sirenGain.gain.setTargetAtTime(0, ac.currentTime, 0.05);
      for (const r of Object.values(SIREN_REC)) if (r.id !== rec.id) this.loops.get(r.id)?.gain.gain.setTargetAtTime(0, ac.currentTime, 0.08);
      lv.gain.gain.setTargetAtTime(active ? rec.gain : 0, ac.currentTime, 0.08);
      return;
    }
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
    if (!this.pumpGain || !this.ac) return;
    const lv = this.loopOf('pump');
    if (lv) {
      this.pumpGain.gain.setTargetAtTime(0, this.ac.currentTime, 0.05);
      lv.gain.gain.setTargetAtTime(active ? 0.5 : 0, this.ac.currentTime, 0.05);
      return;
    }
    this.pumpGain.gain.setTargetAtTime(active ? 0.12 : 0, this.ac.currentTime, 0.05);
  }

  // ---- the kid's vehicle ----

  /** the engine of the kid's vehicle: `speed` 0 … 1 of its top speed, `gas`
   * 0 … 1; null silences it (a mission scene) */
  setEngine(kind: EngineKind | null, speed = 0, gas = 0, rec?: SfxId): void {
    const ac = this.ac;
    if (!ac) return;
    if (kind !== this.engineKind) {
      if (this.engineKind) {
        this.engines.get(this.engineKind)?.out.gain.setTargetAtTime(0, ac.currentTime, 0.2);
        this.loops.get(`engine-${this.engineKind}` as SfxId)?.gain.gain.setTargetAtTime(0, ac.currentTime, 0.2);
        if (this.engineRec) this.loops.get(this.engineRec)?.gain.gain.setTargetAtTime(0, ac.currentTime, 0.2);
      }
      this.engineKind = kind;
    }
    this.engineRec = kind ? rec ?? null : null;
    if (!kind) return;
    // the recorded loop, sped up with the vehicle (the synth voice falls
    // quiet); a race car plays its own (`rec`)
    const lv = this.loopOf(rec && this.samples.has(rec) ? rec : `engine-${kind}` as SfxId);
    if (lv) {
      const sp = Math.max(0, Math.min(1, speed)), g = Math.max(0, Math.min(1, gas)), e = ENGINE_REC[kind];
      this.engines.get(kind)?.out.gain.setTargetAtTime(0, ac.currentTime, 0.2);
      lv.src.playbackRate.setTargetAtTime(e.rate + e.up * sp + 0.04 * g, ac.currentTime, 0.12);
      lv.gain.gain.setTargetAtTime(e.g0 + (e.g1 - e.g0) * sp, ac.currentTime, 0.15);
      return;
    }
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

  /** the race rivals' engines this frame: each its car's recording, at its
   * speed (0 … 1), panned (−1 … 1) and faded with its distance (m); an empty
   * list silences them */
  setRivalEngines(list: Array<{ id: SfxId; speed: number; pan: number; dist: number }>): void {
    const ac = this.ac;
    if (!ac) return;
    const t = ac.currentTime;
    list.forEach((r, i) => {
      let v = this.rivalVoices[i];
      if (v && v.id !== r.id) { v.src.stop(); v.gain.disconnect(); v = null; }
      if (!v) {
        const buf = this.samples.get(r.id);
        if (!buf) return;
        const src = ac.createBufferSource(), gain = ac.createGain(), pan = ac.createStereoPanner();
        src.buffer = buf; src.loop = true;
        // (a random start, so two rivals with the same car don't sound as one)
        src.start(0, Math.random() * buf.duration);
        gain.gain.value = 0;
        src.connect(gain); gain.connect(pan); pan.connect(this.sfx!);
        v = { id: r.id, src, gain, pan };
        this.rivalVoices[i] = v;
      }
      const e = ENGINE_REC.kart;
      v.src.playbackRate.setTargetAtTime(e.rate + e.up * Math.max(0, Math.min(1, r.speed)), t, 0.12);
      v.gain.gain.setTargetAtTime(0.55 / (1 + r.dist / 14), t, 0.1);
      v.pan.pan.setTargetAtTime(Math.max(-1, Math.min(1, r.pan)), t, 0.1);
    });
    for (let i = list.length; i < this.rivalVoices.length; i++) this.rivalVoices[i]?.gain.gain.setTargetAtTime(0, t, 0.2);
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
    if (!this.ac || this.shot('thud', 0.8)) return;
    this.hiss(this.ac.currentTime, 0.18, 0.5, 'lowpass', 220);
  }

  /** a cartoon "boing" (a bump, a crash) */
  boing(): void {
    if (!this.ac) return;
    if (this.shot('boing')) { this.shot('thud', 0.6); return; }
    const t = this.ac.currentTime;
    this.note(330, t, 0.35, 0.12, 'sine', undefined, 120);
    this.thud();
  }

  /** the mission-complete jingle: a bright arpeggio up */
  jingle(): void {
    if (!this.ac || this.shot('win-jingle')) return;
    const t = this.ac.currentTime;
    [523, 659, 784, 1047].forEach((f, i) => this.note(f, t + i * 0.11, 0.3, 0.12));
    this.note(1568, t + 0.44, 0.6, 0.06, 'sine');
  }

  /** a star earned: a twinkling chime */
  star(): void {
    if (!this.ac || this.shot('star', 0.8)) return;
    const t = this.ac.currentTime;
    [1319, 1760, 2093, 2637].forEach((f, i) => this.note(f, t + i * 0.07, 0.5, 0.06, 'sine'));
  }

  /** a gate, ring or buoy passed: a bell ding */
  ding(): void {
    if (!this.ac || this.shot('ding')) return;
    const t = this.ac.currentTime;
    this.note(1320, t, 0.7, 0.1, 'sine');
    this.note(2640, t, 0.4, 0.03, 'sine');
  }

  /** the race countdown: a beep, higher on GO */
  beep(go = false): void {
    if (!this.ac || this.shot(go ? 'beep-go' : 'beep')) return;
    this.note(go ? 988 : 659, this.ac.currentTime, go ? 0.5 : 0.22, 0.09, 'square');
  }

  /** a lap done: two notes up */
  lap(): void {
    if (!this.ac || this.shot('lap')) return;
    const t = this.ac.currentTime;
    this.note(784, t, 0.18, 0.09); this.note(1175, t + 0.14, 0.3, 0.09);
  }

  /** the station's bell (three dings) */
  stationBell(): void {
    if (!this.ac || this.shot('station-bell')) return;
    const t = this.ac.currentTime;
    for (let i = 0; i < 3; i++) { this.note(1047, t + i * 0.28, 0.5, 0.08, 'sine'); this.note(2094, t + i * 0.28, 0.25, 0.02, 'sine'); }
  }

  /** the train doors' chime: two notes down */
  doorChime(): void {
    if (!this.ac || this.shot('door-chime')) return;
    const t = this.ac.currentTime;
    this.note(880, t, 0.35, 0.08, 'sine'); this.note(659, t + 0.3, 0.5, 0.08, 'sine');
  }

  /** the train's horn */
  trainHorn(): void {
    if (!this.ac || this.shot('train-horn')) return;
    const t = this.ac.currentTime;
    for (const f of [311, 370]) this.note(f, t, 0.9, 0.05, 'sawtooth');
  }

  /** a car's horn somewhere (pan −1 left … 1 right, dist m): a short double beep */
  honk(pan = 0, dist = 10): void {
    if (!this.ac) return;
    const t = this.ac.currentTime, dest = this.placed(pan, dist);
    if (this.shot('car-horn', 1, dest)) return;
    for (const at of [0, 0.22]) for (const f of [415, 523]) this.note(f, t + at, 0.16, 0.05, 'sawtooth', dest);
  }

  /** a splash in the river */
  splash(): void {
    if (!this.ac || this.shot('splash', 0.7)) return;
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
    // the recorded strike, rung at a steady pace on the audio clock (each
    // queued a little ahead at its exact time, so frames can't jitter it)
    if (this.samples.has('crossing-ding')) {
      if (!on) return;
      if (c.next < t) c.next = t + 0.02;
      while (c.next < t + 0.12) {
        this.shotAt('crossing-ding', c.next, 0.8, c.pan);
        c.next += CROSSING_PACE;
      }
      return;
    }
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
    const birds = this.loopOf('amb-birds', this.amb!), crickets = this.loopOf('amb-crickets', this.amb!), waves = this.loopOf('amb-waves', this.amb!);
    if (birds && crickets && waves) {
      a.waves.gain.setTargetAtTime(0, t, 0.5);
      birds.gain.gain.setTargetAtTime(0.35 * (1 - night), t, 0.8);
      crickets.gain.gain.setTargetAtTime(0.35 * night, t, 0.8);
      waves.gain.gain.setTargetAtTime(0.6 * sea, t, 0.8);
      return;
    }
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
