// Play modes: which vehicle the kid drives and what it does in the city.
// `?mode=<id>` picks one; the old `?vehicle=` links still work as aliases.
import { VEHICLES, type VehicleConfig } from './player.js';

export type ModeId = 'truck' | 'police' | 'ambulance' | 'heliPolice' | 'heliMedical' | 'plane' | 'boat' | 'train' | 'race';

/** emergency calls a mode answers (missions.ts) */
export type CallKind = 'fire' | 'cat' | 'patient' | 'rescue';

/** a checkpoint course: gates across streets, rings in the sky, buoys at sea */
export type CourseKind = 'gates' | 'rings' | 'buoys';

export interface ModeDef {
  id: ModeId;
  title: string;
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
  /** where the vehicle starts (race: on a race island's starting grid) */
  spawn: 'street' | 'sea' | 'rail' | 'race';
}

const base = { calls: [] as CallKind[], course: null, stations: false, lightbar: false, searchlight: false, winch: false, spawn: 'street' as const };

export const MODES: Record<ModeId, ModeDef> = {
  truck: { ...base, id: 'truck', title: 'Fire Truck', icon: '🚒', vehicle: VEHICLES.truck, calls: ['fire', 'cat', 'fire', 'rescue'], lightbar: true },
  police: { ...base, id: 'police', title: 'Police Car', icon: '🚓', vehicle: VEHICLES.police, course: 'gates', lightbar: true },
  ambulance: { ...base, id: 'ambulance', title: 'Ambulance', icon: '🚑', vehicle: VEHICLES.ambulance, calls: ['patient'], lightbar: true },
  heliMedical: { ...base, id: 'heliMedical', title: 'Medical Helicopter', icon: '🚁', vehicle: VEHICLES.heliMedical, calls: ['patient'], lightbar: true, winch: true },
  heliPolice: { ...base, id: 'heliPolice', title: 'Police Helicopter', icon: '🚁', vehicle: VEHICLES.heliPolice, course: 'rings', lightbar: true, searchlight: true },
  plane: { ...base, id: 'plane', title: 'Plane', icon: '✈️', vehicle: VEHICLES.plane, course: 'rings' },
  boat: { ...base, id: 'boat', title: 'Boat', icon: '🚤', vehicle: VEHICLES.boat, course: 'buoys', spawn: 'sea' },
  train: { ...base, id: 'train', title: 'Train', icon: '🚆', vehicle: VEHICLES.train, stations: true, spawn: 'rail' },
  race: { ...base, id: 'race', title: 'Kart Race', icon: '🏎️', vehicle: VEHICLES.kart, spawn: 'race' },
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
