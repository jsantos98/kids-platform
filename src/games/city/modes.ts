// Play modes: which vehicle the kid drives and what it does in the city.
// `?mode=<id>` picks one; the old `?vehicle=` links still work as aliases.
import { VEHICLES, type VehicleConfig } from './player.js';

export type ModeId = 'truck' | 'police' | 'ambulance' | 'tow' | 'garbage' | 'heliPolice' | 'heliMedical' | 'plane' | 'boat' | 'pirate' | 'train' | 'race';

/** emergency calls a mode answers (missions.ts) */
export type CallKind = 'fire' | 'cat' | 'patient' | 'rescue' | 'breakdown' | 'trash';

/** a checkpoint course: gates across streets, rings in the sky, buoys at sea */
export type CourseKind = 'gates' | 'rings' | 'buoys';

export interface ModeDef {
  id: ModeId;
  icon: string;
  vehicle: VehicleConfig;
  /** emergency calls answered (in rotation) */
  calls: CallKind[];
  /** checkpoint course style, or null */
  course: CourseKind | null;
  /** the train: stop at each station in turn */
  stations: boolean;
  /** flashing red/blue lightbar + siren */
  lightbar: boolean;
  /** police helicopter: a searchlight cone to the ground */
  searchlight: boolean;
  /** medical helicopter: a winch line lowers while rescuing */
  winch: boolean;
  /** robber chases: a getaway car to catch (police car, police helicopter) */
  chase: boolean;
  /** the pirates (G15): ships to catch and treasure to dig up */
  pirate: boolean;
  /** where the vehicle starts (race: on a race island's starting grid) */
  spawn: 'street' | 'sea' | 'rail' | 'race';
}

const base = { calls: [] as CallKind[], course: null, stations: false, lightbar: false, searchlight: false, winch: false, chase: false, pirate: false, spawn: 'street' as const };

export const MODES: Record<ModeId, ModeDef> = {
  truck: { ...base, id: 'truck', icon: '🚒', vehicle: VEHICLES.truck, calls: ['fire', 'cat', 'fire', 'rescue'], lightbar: true },
  police: { ...base, id: 'police', icon: '🚓', vehicle: VEHICLES.police, chase: true, lightbar: true },
  ambulance: { ...base, id: 'ambulance', icon: '🚑', vehicle: VEHICLES.ambulance, calls: ['patient'], lightbar: true },
  // the work trucks (G17): no siren — an amber beacon of their own
  tow: { ...base, id: 'tow', icon: '🛻', vehicle: VEHICLES.tow, calls: ['breakdown'] },
  garbage: { ...base, id: 'garbage', icon: '🚛', vehicle: VEHICLES.garbage, calls: ['trash'] },
  heliMedical: { ...base, id: 'heliMedical', icon: '🚁', vehicle: VEHICLES.heliMedical, calls: ['patient'], lightbar: true, winch: true },
  heliPolice: { ...base, id: 'heliPolice', icon: '🚁', vehicle: VEHICLES.heliPolice, chase: true, lightbar: true, searchlight: true },
  plane: { ...base, id: 'plane', icon: '✈️', vehicle: VEHICLES.plane, course: 'rings' },
  boat: { ...base, id: 'boat', icon: '🚤', vehicle: VEHICLES.boat, course: 'buoys', spawn: 'sea' },
  pirate: { ...base, id: 'pirate', icon: '🏴‍☠️', vehicle: VEHICLES.pirate, pirate: true, spawn: 'sea' },
  train: { ...base, id: 'train', icon: '🚆', vehicle: VEHICLES.train, stations: true, spawn: 'rail' },
  race: { ...base, id: 'race', icon: '🏎️', vehicle: VEHICLES.kart, spawn: 'race' },
};

/** old ?vehicle= values */
const ALIASES: Record<string, ModeId> = { truck: 'truck', heli: 'heliMedical', car: 'police', kart: 'race' };

/** the mode the URL asks for (the medical helicopter by default — R20) */
export function modeFromURL(q: URLSearchParams): ModeDef {
  const m = q.get('mode');
  if (m && m in MODES) return MODES[m as ModeId];
  const v = q.get('vehicle');
  if (v && v in ALIASES) return MODES[ALIASES[v]];
  if (v && v in MODES) return MODES[v as ModeId];
  return MODES.heliMedical;
}
