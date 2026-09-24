// The platform's game registry — the launcher renders this list. Adding a new
// game = one entry here + one rollup input in vite.config.ts.
export interface GameEntry {
  id: string;
  title: string;
  icon: string;
  blurb: string;
  url: string;
}

export const GAMES: GameEntry[] = [
  {
    id: 'city',
    title: 'Fire Truck',
    icon: '🚒',
    blurb: 'Drive anywhere, the city grows around you. Put out fires, rescue cats!',
    url: 'play/city.html?mode=truck',
  },
  {
    id: 'police',
    title: 'Police Car',
    icon: '🚓',
    blurb: 'Siren on! Patrol the streets through the checkpoint gates.',
    url: 'play/city.html?mode=police',
  },
  {
    id: 'ambulance',
    title: 'Ambulance',
    icon: '🚑',
    blurb: 'Drive to the people who need help and take them in.',
    url: 'play/city.html?mode=ambulance',
  },
  {
    id: 'heli-medical',
    title: 'Medical Helicopter',
    icon: '🚁',
    blurb: 'Fly over the city and winch people up to safety.',
    url: 'play/city.html?mode=heliMedical',
  },
  {
    id: 'heli-police',
    title: 'Police Helicopter',
    icon: '🔦',
    blurb: 'Searchlight on! Fly through the rings over the rooftops.',
    url: 'play/city.html?mode=heliPolice',
  },
  {
    id: 'plane',
    title: 'Plane',
    icon: '✈️',
    blurb: 'Swoop through the sky rings — the plane climbs and dives by itself.',
    url: 'play/city.html?mode=plane',
  },
  {
    id: 'boat',
    title: 'Boat',
    icon: '🚤',
    blurb: 'Sail round the island through the buoy gates.',
    url: 'play/city.html?mode=boat',
  },
  {
    id: 'city-train',
    title: 'Train',
    icon: '🚆',
    blurb: 'Drive the train and stop at every station.',
    url: 'play/city.html?mode=train',
  },
  {
    id: 'city-race',
    title: 'Kart Race',
    icon: '🏎️',
    blurb: 'Three laps round the race island — beat the other karts to the flag!',
    url: 'play/city.html?mode=race',
  },
  {
    id: 'firetruck',
    title: 'Fire Truck — City Rescue',
    icon: '🔥',
    blurb: 'The bakery is on fire and a cat is stuck in the tree.',
    url: 'diorama/firetruck.html',
  },
  {
    id: 'helicopter',
    title: 'Rescue Helicopter',
    icon: '🚁',
    blurb: 'Hover over the valley and pick up the patient.',
    url: 'diorama/helicopter.html',
  },
  {
    id: 'train',
    title: 'Little Train Line',
    icon: '🚂',
    blurb: 'A loop with stations, a tunnel and a bridge.',
    url: 'diorama/train.html',
  },
];
