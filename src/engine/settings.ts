// The grown-ups' settings (G11, G12, G9, G13): four volumes, each 0 … 1,
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

// ---- the graphics quality (G13): the game must run on an old PC without a
// graphics card, so it has three levels — each a render resolution, edge
// smoothing, a shadow map and how far the city is drawn — and "auto", which
// starts at medium, steps down while the frames are slow and remembers where
// it settled for the next game. Set in the garage's ⚙️ panel (localStorage
// `game.quality`); `?quality=auto|low|medium|high` overrides it for one visit.

export type Quality = 'low' | 'medium' | 'high';
export type QualityPref = 'auto' | Quality;
export const QUALITY_PREFS: readonly QualityPref[] = ['auto', 'low', 'medium', 'high'];
const QUALITIES: readonly Quality[] = ['low', 'medium', 'high'];

export interface QualityTier {
  /** the render resolution: at most this many pixels per screen pixel */
  pixelRatio: number;
  /** edge smoothing (MSAA) — fixed when the page starts */
  antialias: boolean;
  /** the sun's shadow map (texels a side) and its blur; the ground it covers
   * (× the city's ±95 m, ±150 m flying) and how often it is drawn again (every
   * n-th frame) — the shadow pass drew 60 % of a frame's triangles */
  shadowMap: number;
  shadowBlur: number;
  shadowSpan: number;
  shadowEvery: number;
  /** how many 64 m chunks round the kid are drawn, and the fog that hides
   * where they end */
  viewR: number;
  fogNear: number;
  fogFar: number;
  /** how far away the traffic and the people are drawn (× the full distance) */
  drawScale: number;
}

export const TIERS: Record<Quality, QualityTier> = {
  high: { pixelRatio: 1.5, antialias: true, shadowMap: 2048, shadowBlur: 8, shadowSpan: 1, shadowEvery: 1, viewR: 4, fogNear: 70, fogFar: 260, drawScale: 1 },
  medium: { pixelRatio: 1, antialias: true, shadowMap: 1536, shadowBlur: 4, shadowSpan: 0.85, shadowEvery: 1, viewR: 4, fogNear: 70, fogFar: 260, drawScale: 0.85 },
  low: { pixelRatio: 0.8, antialias: false, shadowMap: 1024, shadowBlur: 4, shadowSpan: 0.7, shadowEvery: 2, viewR: 3, fogNear: 50, fogFar: 195, drawScale: 0.7 },
};

const urlPref = (): QualityPref | null => {
  try {
    const q = new URLSearchParams(location.search).get('quality');
    return q && (QUALITY_PREFS as readonly string[]).includes(q) ? q as QualityPref : null;
  } catch { return null; }
};

/** what the grown-ups chose (auto when never set) */
export function qualityPref(): QualityPref {
  const u = urlPref();
  if (u) return u;
  try {
    const v = localStorage.getItem('game.quality');
    return v && (QUALITY_PREFS as readonly string[]).includes(v) ? v as QualityPref : 'auto';
  } catch { return 'auto'; }
}

export function setQualityPref(p: QualityPref): void {
  try { localStorage.setItem('game.quality', p); } catch { /* no storage */ }
}

/** where "auto" settled last time (medium the first time) */
export function autoQuality(): Quality {
  try {
    const v = localStorage.getItem('game.quality.auto');
    return v && (QUALITIES as readonly string[]).includes(v) ? v as Quality : 'medium';
  } catch { return 'medium'; }
}

export function setAutoQuality(q: Quality): void {
  try { localStorage.setItem('game.quality.auto', q); } catch { /* no storage */ }
}

/** the level a page starts at */
export function startQuality(): Quality {
  const p = qualityPref();
  return p === 'auto' ? autoQuality() : p;
}

/** one level down / up (null: none) */
export function lowerQuality(q: Quality): Quality | null { return q === 'high' ? 'medium' : q === 'medium' ? 'low' : null; }
export function higherQuality(q: Quality): Quality | null { return q === 'low' ? 'medium' : q === 'medium' ? 'high' : null; }
