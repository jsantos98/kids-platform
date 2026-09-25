// The platform's game registry — the garage (the launcher) shows this list,
// one vehicle each, chosen with the wheel. Only the play modes of the
// island world are here (modes.ts); the concept dioramas stay as pages of
// their own, off the menu. Adding a mode = one entry here (and its ModeDef),
// and its title + blurb in src/i18n (mode.<id>.title / .blurb).
import { t, type Key } from '../i18n/index.js';
export interface GameEntry {
  /** the play mode (`?mode=`) */
  id: string;
  /** its name and one-line pitch, in the current language (i18n) */
  readonly title: string;
  icon: string;
  readonly blurb: string;
  url: string;
  /** the garage's turntable model: a kit GLB (its length in metres and the
   * turn it needs to face +z), or a procedural stand-in by name */
  model: { glb?: string; len: number; yaw?: number; make?: 'heliMedical' | 'heliPolice' | 'plane' };
  /** its garage colour (the ring and the glow round its button) */
  color: string;
}

const mode = (id: string): string => `play/city.html?mode=${id}`;

/** an entry whose title and blurb are read in the current language */
function entry(e: Omit<GameEntry, 'title' | 'blurb'>): GameEntry {
  return {
    ...e,
    get title() { return t(`mode.${e.id}.title` as Key); },
    get blurb() { return t(`mode.${e.id}.blurb` as Key); },
  };
}

export const GAMES: GameEntry[] = [
  entry({
    id: 'truck', icon: '🚒', color: '#e25c5c',
    url: mode('truck'), model: { glb: 'assets/kenney/firetruck.glb', len: 6.6 },
  }),
  entry({
    id: 'police', icon: '🚓', color: '#4f7fd1',
    url: mode('police'), model: { glb: 'assets/kenney/police.glb', len: 4.6 },
  }),
  entry({
    id: 'ambulance', icon: '🚑', color: '#f2a93b',
    url: mode('ambulance'), model: { glb: 'assets/kenney/ambulance.glb', len: 5.4 },
  }),
  entry({
    id: 'heliMedical', icon: '🚁', color: '#63b0a8',
    url: mode('heliMedical'), model: { make: 'heliMedical', len: 7.8 },
  }),
  entry({
    id: 'heliPolice', icon: '🔦', color: '#6a79d6',
    url: mode('heliPolice'), model: { make: 'heliPolice', len: 7.8 },
  }),
  entry({
    id: 'plane', icon: '✈️', color: '#f6c952',
    url: mode('plane'), model: { make: 'plane', len: 8 },
  }),
  entry({
    id: 'boat', icon: '🚤', color: '#3fa3d6',
    url: mode('boat'), model: { glb: 'assets/kenney/watercraft/boat-speed-a.glb', len: 6.5 },
  }),
  entry({
    id: 'train', icon: '🚆', color: '#8b6fd6',
    url: mode('train'), model: { glb: 'assets/kenney/train/train-electric-city-a.glb', len: 9 },
  }),
  entry({
    id: 'race', icon: '🏎️', color: '#e8743b',
    url: mode('race'), model: { glb: 'assets/kenney/toycar/vehicle-racer.glb', len: 4, yaw: Math.PI },
  }),
];
