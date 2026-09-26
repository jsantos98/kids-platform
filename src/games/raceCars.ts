// The race cars the kid picks from in the garage (after choosing the race):
// the Car Kit's formula cars and its five astronaut karts, and the Toy Car
// Kit's racers and monster truck. They all race with the same physics (the
// kart VehicleConfig) — only the model changes. The rivals on the grid are
// other cars from this line-up, one from each family.
// Toy Car Kit models face -z (R15): they spawn turned by π.

export type CarFamily = 'formula' | 'kart' | 'toy';

export interface RaceCar {
  /** `?car=` and the i18n key `car.<id>` */
  id: string;
  family: CarFamily;
  /** the model, from the site root (no leading slash) */
  glb: string;
  /** its length in the race (m) and the turn it needs to face +z */
  len: number;
  yaw: number;
  /** its garage colour (the tile's ring and the turntable's) */
  color: string;
}

const CAR = 'assets/kenney/';
const TOY = 'assets/kenney/toycar/';

export const RACE_CARS: RaceCar[] = [
  { id: 'f1', family: 'formula', glb: `${CAR}race.glb`, len: 4.4, yaw: 0, color: '#e25c5c' },
  { id: 'future', family: 'formula', glb: `${CAR}race-future.glb`, len: 4.4, yaw: 0, color: '#4f7fd1' },
  { id: 'kartPurple', family: 'kart', glb: `${CAR}kart-oobi.glb`, len: 3.2, yaw: 0, color: '#9c7ee0' },
  { id: 'kartPink', family: 'kart', glb: `${CAR}kart-oodi.glb`, len: 3.2, yaw: 0, color: '#ec8fb8' },
  { id: 'kartYellow', family: 'kart', glb: `${CAR}kart-ooli.glb`, len: 3.2, yaw: 0, color: '#f2c14e' },
  { id: 'kartGreen', family: 'kart', glb: `${CAR}kart-oopi.glb`, len: 3.2, yaw: 0, color: '#47b8ab' },
  { id: 'kartBrown', family: 'kart', glb: `${CAR}kart-oozi.glb`, len: 3.2, yaw: 0, color: '#d2a57f' },
  { id: 'racer', family: 'toy', glb: `${TOY}vehicle-racer.glb`, len: 4.2, yaw: Math.PI, color: '#5cc27a' },
  { id: 'speedster', family: 'toy', glb: `${TOY}vehicle-speedster.glb`, len: 4.2, yaw: Math.PI, color: '#e8543b' },
  { id: 'racerLow', family: 'toy', glb: `${TOY}vehicle-racer-low.glb`, len: 4.2, yaw: Math.PI, color: '#f07a3a' },
  { id: 'vintage', family: 'toy', glb: `${TOY}vehicle-vintage-racer.glb`, len: 4.2, yaw: Math.PI, color: '#9b7fd6' },
  { id: 'drag', family: 'toy', glb: `${TOY}vehicle-drag-racer.glb`, len: 4.4, yaw: Math.PI, color: '#f59a3b' },
  { id: 'monster', family: 'toy', glb: `${TOY}vehicle-monster-truck.glb`, len: 4.4, yaw: Math.PI, color: '#8a63d2' },
];

export const DEFAULT_CAR = 'f1';

/** the car `?car=` names (the F1 when it names none) */
export function raceCar(id: string | null | undefined): RaceCar {
  return RACE_CARS.find(c => c.id === id) ?? RACE_CARS.find(c => c.id === DEFAULT_CAR)!;
}

/** the three rivals for the kid's car: one from each family, never the kid's
 * own car, varied by `seed` (the race island) */
export function rivalsFor(kid: RaceCar, seed: number): RaceCar[] {
  const out: RaceCar[] = [];
  let h = (seed * 2654435761) >>> 0;
  for (const fam of ['formula', 'kart', 'toy'] as CarFamily[]) {
    const pool = RACE_CARS.filter(c => c.family === fam && c.id !== kid.id);
    h = (Math.imul(h ^ (h >>> 15), 2246822507) + 0x9e3779b9) >>> 0;
    out.push(pool[h % pool.length]);
  }
  return out;
}
