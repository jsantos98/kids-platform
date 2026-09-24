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
    title: 'Endless City — Fire Missions',
    icon: '🚒',
    blurb: 'Drive anywhere, the city generates around you. Put out fires, rescue cats!',
    url: 'play/city.html?vehicle=truck',
  },
  {
    id: 'heli-city',
    title: 'Endless City — Helicopter',
    icon: '🚁',
    blurb: 'Fly the same city! Hover over people to winch them up.',
    url: 'play/city.html?vehicle=heli',
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
