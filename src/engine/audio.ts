// Procedural WebAudio: siren wail, water-pump noise, bump thud — no audio files.
// Everything is created lazily on the first user gesture (browser autoplay rules).
export class GameAudio {
  private ac: AudioContext | null = null;
  private sirenGain: GainNode | null = null;
  private pumpGain: GainNode | null = null;

  /** Idempotent: the first call builds the graph, later calls do nothing. */
  unlock(): void {
    if (this.ac) return;
    try {
      const ac = new (window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext)();
      const osc = ac.createOscillator();
      osc.type = 'sine';
      osc.frequency.value = 725;
      const lfo = ac.createOscillator();
      lfo.type = 'square';
      lfo.frequency.value = 1.1;
      const lfoGain = ac.createGain();
      lfoGain.gain.value = 145;
      lfo.connect(lfoGain);
      lfoGain.connect(osc.frequency);
      this.sirenGain = ac.createGain();
      this.sirenGain.gain.value = 0;
      osc.connect(this.sirenGain);
      this.sirenGain.connect(ac.destination);
      osc.start();
      lfo.start();

      const buf = ac.createBuffer(1, ac.sampleRate, ac.sampleRate);
      const d = buf.getChannelData(0);
      for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
      const noise = ac.createBufferSource();
      noise.buffer = buf;
      noise.loop = true;
      const bp = ac.createBiquadFilter();
      bp.type = 'bandpass';
      bp.frequency.value = 1700;
      bp.Q.value = 0.7;
      this.pumpGain = ac.createGain();
      this.pumpGain.gain.value = 0;
      noise.connect(bp);
      bp.connect(this.pumpGain);
      this.pumpGain.connect(ac.destination);
      noise.start();

      this.ac = ac;
    } catch {
      this.ac = null;
    }
  }

  setSiren(active: boolean): void {
    if (this.sirenGain && this.ac) this.sirenGain.gain.setTargetAtTime(active ? 0.04 : 0, this.ac.currentTime, 0.3);
  }

  setPump(active: boolean): void {
    if (this.pumpGain && this.ac) this.pumpGain.gain.setTargetAtTime(active ? 0.12 : 0, this.ac.currentTime, 0.05);
  }

  thud(): void {
    if (!this.ac) return;
    const ac = this.ac;
    const len = Math.floor(ac.sampleRate * 0.18);
    const buf = ac.createBuffer(1, len, ac.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / len);
    const s = ac.createBufferSource();
    s.buffer = buf;
    const f = ac.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.value = 220;
    const g = ac.createGain();
    g.gain.value = 0.5;
    s.connect(f);
    f.connect(g);
    g.connect(ac.destination);
    s.start();
  }
}
