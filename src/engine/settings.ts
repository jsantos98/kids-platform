// The grown-ups' sound settings (G11, G12, G9): four volumes, each 0 … 1,
// remembered for every page (localStorage) — the narrator's voice, the
// music, the background sounds (ambience, bells, horns, jingles and every
// other effect) and the vehicles' engines. Set in the garage's ⚙️ panel;
// the mixer (audio.ts) and the voice (i18n/voice.ts) read them when they
// start and follow every change.

export type VolumeKey = 'voice' | 'music' | 'bg' | 'engine';
export const VOLUME_KEYS: readonly VolumeKey[] = ['voice', 'music', 'bg', 'engine'];

const storeKey = (k: VolumeKey): string => `game.vol.${k}`;
const listeners = new Set<(k: VolumeKey, v: number) => void>();

/** a volume, 0 … 1 (1 when never set) */
export function volume(k: VolumeKey): number {
  try {
    const v = Number(localStorage.getItem(storeKey(k)));
    return localStorage.getItem(storeKey(k)) === null || !Number.isFinite(v) ? 1 : Math.max(0, Math.min(1, v));
  } catch { return 1; }
}

export function setVolume(k: VolumeKey, v: number): void {
  const c = Math.max(0, Math.min(1, v));
  try { localStorage.setItem(storeKey(k), String(c)); } catch { /* no storage */ }
  for (const f of listeners) f(k, c);
}

/** call `f` on every change (returns the unsubscribe) */
export function onVolume(f: (k: VolumeKey, v: number) => void): () => void {
  listeners.add(f);
  return () => listeners.delete(f);
}
