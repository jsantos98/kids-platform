// The spoken lines: recorded ahead of time (Portuguese: ElevenLabs' Benedita,
// the best of several takes picked by ear; English: Piper's cori —
// tools/make-voice.py) into
// public/audio/voice/<lang>/<id>.mp3, so every computer hears the same
// voice whatever voices it has installed. A line without its clip (or a
// browser that won't play it) falls back to the system's speech voice.
// The texts come from the dictionaries: change one and re-run the script
// (tools/check-i18n.ts fails on a clip recorded from an older text).
import { t, getLang, speechVoice, type Key } from './index.js';
import { volume, onVolume } from '../engine/settings.js';
import { EN } from './en.js';
import { RACE_CARS } from '../games/raceCars.js';

/** the garage's play modes (registry.ts), whose names it says */
export const SPOKEN_MODES = ['truck', 'police', 'ambulance', 'tow', 'heliMedical', 'heliPolice', 'plane', 'boat', 'pirate', 'train', 'race'] as const;

/** every spoken line: clip id → its text in the current language */
export function voiceLines(): Record<string, string> {
  const out: Record<string, string> = {};
  for (const m of SPOKEN_MODES) {
    const title = t(`mode.${m}.title` as Key);
    out[`mode-${m}`] = title;
    out[`go-${m}`] = t('garage.letsGo', { title });
  }
  // the race cars' carousel: its call, each car, off we go, and back
  out['pick-car'] = t('cars.blurb');
  out['back'] = t('cars.back');
  for (const c of RACE_CARS) {
    const title = t(`car.${c.id}` as Key);
    out[`car-${c.id}`] = title;
    out[`gocar-${c.id}`] = t('garage.letsGo', { title });
  }
  // the narrator's lines in the game (say.start.truck -> say-start-truck)
  for (const k of Object.keys(EN) as Key[]) {
    if (k.startsWith('say.')) out[k.replace(/\./g, '-')] = t(k);
  }
  return out;
}

/** how a line is said (make-voice.py tunes the voice's pace, pitch and
 * volume to it): a win or a finished mission `excited`, a gate `cheer`, a
 * bump `warm` and gentle, everything else `lively` */
export type Mood = 'excited' | 'cheer' | 'lively' | 'warm';
const EXCITED = /^say-(praise|caught|course-done|race-place[1-3]|station|spotted|closing|race-up|chaseRun|sunk|surrender|treasure-|treasureMap|delivered)/;
export function voiceMood(id: string): Mood {
  if (EXCITED.test(id)) return 'excited';
  if (/^say-(gate|race-count|race-place4|race-lastLap|race-lead|almost|flame|catMoved|hearts|hold|shipHit|shipSpotted|battle|bin|towCentre)/.test(id)) return 'cheer';
  if (/^say-(oops|race-down|missed)/.test(id)) return 'warm';
  return 'lively';
}

/** the game's sound is off: say nothing (G11) */
let muted = false;
export function setVoiceMuted(m: boolean): void {
  muted = m;
  if (m) { try { playing?.stop(); } catch { /* over */ } try { window.speechSynthesis?.cancel(); } catch { /* none */ } }
}

/** can a line be heard yet? (a page may only start sound after a click or
 * a key — until then the voice waits) */
export function voiceReady(): boolean { return context()?.state === 'running'; }
/** try to wake the voice now (allowed when the page came from a click) */
export function wakeVoice(): void { void context()?.resume().catch(() => {}); }

/** is a line being said right now? (the game ducks its sounds under it) */
export function speaking(): boolean { return !!playing; }

// (played through Web Audio: every clip is fetched and decoded ahead, so a
// line starts the moment it's asked for — an <audio> element loads lazily,
// and not at all while its tab is in the background)
let ctx: AudioContext | null = null;
/** the voice's volume (the grown-ups' setting: settings.ts) */
let out: GainNode | null = null;
let playing: AudioBufferSourceNode | null = null;
/** how many lines have been asked for (the last one is the one wanted) */
let said = 0;
const buffers = new Map<string, Promise<AudioBuffer | null>>();

function context(): AudioContext | null {
  try {
    if (!ctx) {
      ctx = new AudioContext();
      out = ctx.createGain();
      out.gain.value = volume('voice');
      out.connect(ctx.destination);
      onVolume((k, v) => { if (k === 'voice' && out && ctx) out.gain.setTargetAtTime(v, ctx.currentTime, 0.05); });
      // (a page may only start sound after a click or a key: wake it then)
      const wake = (): void => { void ctx?.resume().catch(() => {}); };
      addEventListener('pointerdown', wake);
      addEventListener('keydown', wake);
    }
    return ctx;
  } catch { return null; }
}

/** the clip's decoded sound (fetched once; null: no such clip);
 * `root` is the path from the page to the site root */
function clip(id: string, root: string): Promise<AudioBuffer | null> {
  const src = `${root}audio/voice/${getLang()}/${id}.mp3`;
  let b = buffers.get(src);
  if (!b) {
    const c = context();
    b = !c ? Promise.resolve(null) : fetch(src)
      .then(r => (r.ok ? r.arrayBuffer() : Promise.reject(new Error(String(r.status)))))
      .then(data => c.decodeAudioData(data))
      .catch(() => null);
    buffers.set(src, b);
  }
  return b;
}

/** load the current language's clips ahead, so the first one plays at once */
export function preloadVoice(root = '', prefix = ''): void {
  for (const id of Object.keys(voiceLines())) if (id.startsWith(prefix)) void clip(id, root);
}

/** say a line: its recorded clip, else the system voice; settles when it
 * has been said (or couldn't be) */
export function speak(id: string, root = ''): Promise<void> {
  const text = voiceLines()[id] ?? id;
  const turn = ++said;
  if (muted) return Promise.resolve();
  return new Promise<void>(done => {
    const fallback = (): void => {
      if (turn !== said) { done(); return; }
      try {
        const synth = window.speechSynthesis;
        if (!synth) { done(); return; }
        synth.cancel();
        const u = new SpeechSynthesisUtterance(text);
        const { lang, voice } = speechVoice();
        u.lang = lang;
        if (voice) u.voice = voice;
        u.rate = 0.95; u.pitch = 1.15; u.volume = volume('voice');
        u.onend = () => done();
        u.onerror = () => done();
        synth.speak(u);
      } catch { done(); }
    };
    try { window.speechSynthesis?.cancel(); } catch { /* none */ }
    try { playing?.stop(); } catch { /* already over */ }
    playing = null;
    void clip(id, root).then(buf => {
      // (another line was asked for meanwhile: that one speaks)
      if (turn !== said) { done(); return; }
      const c = ctx;
      if (!buf || !c) { fallback(); return; }
      void c.resume().catch(() => {});
      const node = c.createBufferSource();
      node.buffer = buf;
      node.connect(out ?? c.destination);
      node.onended = () => { if (playing === node) playing = null; done(); };
      node.start();
      playing = node;
    });
  });
}
