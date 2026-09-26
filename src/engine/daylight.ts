// Day and night (G10): the time of day as a pure function of the game
// clock. One day lasts DAY_LEN seconds: dawn 30 s, day 7 min, dusk 30 s,
// night 2 min — short nights, and darker rather than dark (the fill light
// keeps ~45 % of the day's and the moon lights the streets: the darkest
// moment keeps ≥15 % of noon's light, still easy to read). Every game
// starts in the morning; `?time=day|dusk|night|dawn` (or a fraction of the
// day, 0 = dawn) jumps there. Everything that lights up at night reads
// `night` (0 by day … 1 at night, eased through dusk and dawn).

/** one whole day (s) */
export const DAY_LEN = 600;
/** the parts of the day, as fractions of it: dawn, day, dusk, night */
export const DAWN = 30 / DAY_LEN, DAYTIME = 420 / DAY_LEN, DUSK = 30 / DAY_LEN;
/** when the sun sets (the end of dusk) — night fills the rest */
export const SUNSET = DAWN + DAYTIME + DUSK;
/** the sun clears the horizon mid-dawn and meets it again mid-dusk */
export const SUN_RISE = DAWN * 0.5, SUN_SET = DAWN + DAYTIME + DUSK * 0.5;
/** the shadow light never lies lower than this (rad), however low the sun */
export const LIGHT_MIN_ELEV = (42 * Math.PI) / 180;
/** the moon's phases: new, crescent, quarter, gibbous, full, and back */
export const MOON_PHASES = 8;

export interface DayState {
  /** time of day, 0 = the start of dawn … 1 */
  phase: number;
  /** days since the game began (the moon's phase steps on each night) */
  day: number;
  /** 0 by day … 1 at night */
  night: number;
  /** unit directions to the sun and the moon (y up) */
  sunDir: [number, number, number];
  moonDir: [number, number, number];
  /** the shadow-casting light: the sun by day, the moon by night */
  lightDir: [number, number, number];
  lightColor: number;
  lightI: number;
  /** the sky fill */
  hemiSky: number;
  hemiGround: number;
  hemiI: number;
  /** sky gradient (zenith, horizon) and the fog (= the horizon) */
  skyTop: number;
  skyBottom: number;
  /** the sun's own colour and glow strength in the sky */
  sunColor: number;
  sunGlow: number;
  /** how visible the stars are (0 … 1) */
  stars: number;
  /** the renderer's exposure */
  exposure: number;
  /** the moon's phase, 0 … MOON_PHASES−1 (0 new, 4 full) */
  moonPhase: number;
}

interface Palette {
  skyTop: number; skyBottom: number; hemiSky: number; hemiGround: number; hemiI: number;
  lightColor: number; lightI: number; sunColor: number; sunGlow: number; exposure: number; night: number; stars: number;
}
/** the day's look (the stage's original pastel colours — the sky dome is
 * now tone-mapped and colour-managed like the fog, so its zenith is given as
 * the colour the old unmanaged dome showed), twilight, night */
const DAY: Palette = {
  skyTop: 0x4898ce, skyBottom: 0xfdf4e3, hemiSky: 0xeef7fb, hemiGround: 0xd9d0bd, hemiI: 1.9,
  lightColor: 0xfff1d8, lightI: 2.9, sunColor: 0xfff4d6, sunGlow: 0.35, exposure: 1.06, night: 0, stars: 0,
};
const TWILIGHT: Palette = {
  skyTop: 0x5d6fae, skyBottom: 0xf4a56e, hemiSky: 0xf0c3a4, hemiGround: 0x8d8084, hemiI: 1.25,
  lightColor: 0xffae6b, lightI: 1.4, sunColor: 0xffa05a, sunGlow: 0.9, exposure: 1.0, night: 0.5, stars: 0.25,
};
const NIGHT: Palette = {
  skyTop: 0x0c1633, skyBottom: 0x2e3a63, hemiSky: 0x909cc6, hemiGround: 0x45495c, hemiI: 0.85,
  lightColor: 0xc4cfff, lightI: 0.65, sunColor: 0xffa05a, sunGlow: 0, exposure: 0.95, night: 1, stars: 1,
};
/** the day's key moments: from the end of night through dawn, the day,
 * dusk and night again (each eased into the next) */
const KEYS: Array<[number, Palette]> = [
  [0, NIGHT],
  [DAWN * 0.5, TWILIGHT],
  [DAWN + 0.012, DAY],
  [DAWN + DAYTIME - 0.012, DAY],
  [DAWN + DAYTIME + DUSK * 0.5, TWILIGHT],
  [SUNSET + 0.012, NIGHT],
  [1, NIGHT],
];

/** the part of the day a new game starts at: a little after sunrise */
export const MORNING = DAWN + 0.03;
/** the middle of the day */
export const NOON = DAWN + DAYTIME / 2;
const NAMED: Record<string, number> = { dawn: DAWN * 0.4, morning: MORNING, day: 0.4, noon: NOON, dusk: DAWN + DAYTIME + DUSK * 0.5, night: SUNSET + 0.09, midnight: SUNSET + (1 - SUNSET) / 2 };

/** where in the day a game starts: the morning, or `?time=` */
export function startPhase(query: string | null): number {
  if (!query) return MORNING;
  if (query in NAMED) return NAMED[query];
  const f = Number(query);
  return Number.isFinite(f) ? ((f % 1) + 1) % 1 : MORNING;
}

const smooth = (x: number): number => x * x * (3 - 2 * x);
function lerpColor(a: number, b: number, f: number): number {
  const ch = (s: number): number => Math.round((((a >> s) & 255) * (1 - f)) + (((b >> s) & 255) * f));
  return (ch(16) << 16) | (ch(8) << 8) | ch(0);
}
function palette(p: number): Palette {
  let k = 0;
  while (k < KEYS.length - 2 && KEYS[k + 1][0] <= p) k++;
  const [p0, a] = KEYS[k], [p1, b] = KEYS[k + 1];
  const f = smooth(Math.min(1, Math.max(0, (p - p0) / ((p1 - p0) || 1))));
  const n = (x: number, y: number): number => x + (y - x) * f;
  return {
    skyTop: lerpColor(a.skyTop, b.skyTop, f), skyBottom: lerpColor(a.skyBottom, b.skyBottom, f),
    hemiSky: lerpColor(a.hemiSky, b.hemiSky, f), hemiGround: lerpColor(a.hemiGround, b.hemiGround, f), hemiI: n(a.hemiI, b.hemiI),
    lightColor: lerpColor(a.lightColor, b.lightColor, f), lightI: n(a.lightI, b.lightI),
    sunColor: lerpColor(a.sunColor, b.sunColor, f), sunGlow: n(a.sunGlow, b.sunGlow),
    exposure: n(a.exposure, b.exposure), night: n(a.night, b.night), stars: n(a.stars, b.stars),
  };
}

/** a direction on an arc from the east horizon (a = 0) over the sky to the
 * west (a = π), leaning toward `lean` on z */
function arc(a: number, lean: number): [number, number, number] {
  const x = Math.cos(a), y = Math.sin(a), z = lean;
  const l = Math.hypot(x, y, z);
  return [x / l, y / l, z / l];
}

/**
 * The time of day at game time t (s). `start` is where in the day the game
 * began (startPhase), `moonBase` the moon's phase on the first night (a
 * world's own).
 */
export function dayState(t: number, start = MORNING, moonBase = 0): DayState {
  const whole = start + t / DAY_LEN;
  const phase = ((whole % 1) + 1) % 1;
  const day = Math.floor(whole);
  const pal = palette(phase);
  // the sun rises mid-dawn and sets mid-dusk (where the palette is half
  // night), then goes round below the horizon; the moon crosses the sky
  // from mid-dusk to mid-dawn
  const upSpan = SUN_SET - SUN_RISE;
  const sunA = phase >= SUN_RISE && phase < SUN_SET
    ? Math.PI * ((phase - SUN_RISE) / upSpan)
    : Math.PI + Math.PI * ((((phase - SUN_SET) % 1) + 1) % 1) / (1 - upSpan);
  const sunDir = arc(sunA, -0.55);
  const moonA = sunA >= Math.PI ? sunA - Math.PI : sunA + Math.PI;
  const moonDir = arc(moonA, 0.45);
  // the shadow-casting light: whichever of the two is up; it fades to
  // nothing as either meets the horizon (so the handover can't be seen),
  // and never lies lower than LIGHT_MIN_ELEV (at 14° the shadow map
  // stretched 4× along the light and drew long straight bands over the
  // ground, glaring from the air)
  const up = sunDir[1] >= moonDir[1] ? sunDir : moonDir;
  const fade = Math.min(1, Math.max(0, up[1] * 5));
  const minY = Math.sin(LIGHT_MIN_ELEV);
  let lightDir = up;
  if (up[1] < minY) {
    const h = Math.hypot(up[0], up[2]) || 1, k = Math.sqrt(1 - minY * minY);
    lightDir = [(up[0] / h) * k, minY, (up[2] / h) * k];
  }
  // (each night the moon's phase steps on: the first night the world's own)
  const nightNo = phase >= SUN_SET ? day : day - 1;
  const moonPhase = (((moonBase + nightNo) % MOON_PHASES) + MOON_PHASES) % MOON_PHASES;
  return {
    phase, day, night: pal.night, sunDir, moonDir, lightDir,
    lightColor: pal.lightColor, lightI: pal.lightI * fade,
    hemiSky: pal.hemiSky, hemiGround: pal.hemiGround, hemiI: pal.hemiI,
    skyTop: pal.skyTop, skyBottom: pal.skyBottom, sunColor: pal.sunColor, sunGlow: pal.sunGlow,
    stars: pal.stars, exposure: pal.exposure, moonPhase,
  };
}
