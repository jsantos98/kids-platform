// The platform's game registry — the garage (the launcher) shows this list,
// one vehicle each, chosen with the wheel. Only the play modes of the
// island world are here (modes.ts); the concept dioramas stay as pages of
// their own, off the menu. Adding a mode = one entry here (and its ModeDef).
export interface GameEntry {
  /** the play mode (`?mode=`) */
  id: string;
  title: string;
  icon: string;
  blurb: string;
  url: string;
  /** the garage's turntable model: a kit GLB (its length in metres and the
   * turn it needs to face +z), or a procedural stand-in by name */
  model: { glb?: string; len: number; yaw?: number; make?: 'heliMedical' | 'heliPolice' | 'plane' };
  /** its garage colour (the ring and the glow round its button) */
  color: string;
}

const mode = (id: string): string => `play/city.html?mode=${id}`;

export const GAMES: GameEntry[] = [
  {
    id: 'truck', title: 'Fire Truck', icon: '🚒', color: '#e25c5c',
    blurb: 'Put out fires and rescue cats!',
    url: mode('truck'), model: { glb: 'assets/kenney/firetruck.glb', len: 6.6 },
  },
  {
    id: 'police', title: 'Police Car', icon: '🚓', color: '#4f7fd1',
    blurb: 'Chase the getaway cars!',
    url: mode('police'), model: { glb: 'assets/kenney/police.glb', len: 4.6 },
  },
  {
    id: 'ambulance', title: 'Ambulance', icon: '🚑', color: '#f2a93b',
    blurb: 'Help the people who need you!',
    url: mode('ambulance'), model: { glb: 'assets/kenney/ambulance.glb', len: 5.4 },
  },
  {
    id: 'heliMedical', title: 'Rescue Helicopter', icon: '🚁', color: '#63b0a8',
    blurb: 'Fly and winch people to safety!',
    url: mode('heliMedical'), model: { make: 'heliMedical', len: 7.8 },
  },
  {
    id: 'heliPolice', title: 'Police Helicopter', icon: '🔦', color: '#6a79d6',
    blurb: 'Keep the robbers in your light!',
    url: mode('heliPolice'), model: { make: 'heliPolice', len: 7.8 },
  },
  {
    id: 'plane', title: 'Plane', icon: '✈️', color: '#f6c952',
    blurb: 'Swoop through the sky rings!',
    url: mode('plane'), model: { make: 'plane', len: 8 },
  },
  {
    id: 'boat', title: 'Boat', icon: '🚤', color: '#3fa3d6',
    blurb: 'Sail through the buoy gates!',
    url: mode('boat'), model: { glb: 'assets/kenney/watercraft/boat-speed-a.glb', len: 6.5 },
  },
  {
    id: 'train', title: 'Train', icon: '🚆', color: '#8b6fd6',
    blurb: 'Drive the train to every station!',
    url: mode('train'), model: { glb: 'assets/kenney/train/train-electric-city-a.glb', len: 9 },
  },
  {
    id: 'race', title: 'Kart Race', icon: '🏎️', color: '#e8743b',
    blurb: 'Three laps — race to the flag!',
    url: mode('race'), model: { glb: 'assets/kenney/toycar/vehicle-racer.glb', len: 4, yaw: Math.PI },
  },
];
