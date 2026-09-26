// The spoken lines: recorded ahead of time with Piper voices (a Portugal
// Portuguese one and a British English one — tools/make-voice.py) into
// public/audio/voice/<lang>/<id>.mp3, so every computer hears the same
// voice whatever voices it has installed. A line without its clip (or a
// browser that won't play it) falls back to the system's speech voice.
// The texts come from the dictionaries: change one and re-run the script
// (tools/check-i18n.ts fails on a clip recorded from an older text).
import { t, getLang, speechVoice, type Key } from './index.js';

/** the garage's play modes (registry.ts), whose names it says */
export const SPOKEN_MODES = ['truck', 'police', 'ambulance', 'heliMedical', 'heliPolice', 'plane', 'boat', 'train', 'race'] as const;

/** every spoken line: clip id → its text in the current language */
export function voiceLines(): Record<string, string> {
  const out: Record<string, string> = {};
  for (const m of SPOKEN_MODES) {
    const title = t(`mode.${m}.title` as Key);
    out[`mode-${m}`] = title;
    out[`go-${m}`] = t('garage.letsGo', { title });
  }
  return out;
}

// (played through Web Audio: every clip is fetched and decoded ahead, so a
// line starts the moment it's asked for — an <audio> element loads lazily,
// and not at all while its tab is in the background)
let ctx: AudioContext | null = null;
let playing: AudioBufferSourceNode | null = null;
/** how many lines have been asked for (the last one is the one wanted) */
let said = 0;
const buffers = new Map<string, Promise<AudioBuffer | null>>();

function context(): AudioContext | null {
  try {
    if (!ctx) {
      ctx = new AudioContext();
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
export function preloadVoice(root = ''): void {
  for (const id of Object.keys(voiceLines())) void clip(id, root);
}

/** say a line: its recorded clip, else the system voice; settles when it
 * has been said (or couldn't be) */
export function speak(id: string, root = ''): Promise<void> {
  const text = voiceLines()[id] ?? id;
  const turn = ++said;
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
        u.rate = 0.95; u.pitch = 1.15;
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
      node.connect(c.destination);
      node.onended = () => done();
      node.start();
      playing = node;
    });
  });
}
