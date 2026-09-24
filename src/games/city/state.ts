// Persistent save-data: lifetime rescues, kept in localStorage.
export interface Totals {
  fires: number;
  cats: number;
  /** everything else: patients, courses finished, station stops */
  stars: number;
}

const KEY = 'kidsgames-totals';

export function loadTotals(): Totals {
  const t: Totals = { fires: 0, cats: 0, stars: 0 };
  try {
    Object.assign(t, JSON.parse(localStorage.getItem(KEY) ?? '{}'));
  } catch {
    /* first run or blocked storage */
  }
  return t;
}

export function saveTotals(t: Totals): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(t));
  } catch {
    /* storage blocked — score just won't persist */
  }
}
