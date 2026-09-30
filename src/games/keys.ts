// The game's keys, as the garage shows them under the carousel for the
// vehicle chosen (in the current language). Steering, gas and brake are the
// wheel's job, but the grown-up on a keyboard needs them too; what W / S do
// depends on the vehicle, the train doesn't steer (or reset), and only the
// emergency vehicles have a siren. The mission scenes take the wheel alone
// (G4), so no key is listed for them.
import { t, type Key } from '../i18n/index.js';
import type { Drive, GameEntry } from './registry.js';

const GAS_BRAKE: Record<Drive, [Key, Key]> = {
  road: ['keys.gas', 'keys.brakeReverse'],
  heli: ['keys.forward', 'keys.back'],
  plane: ['keys.faster', 'keys.slower'],
  boat: ['keys.gas', 'keys.brakeReverse'],
  train: ['keys.gas', 'keys.brake'],
  race: ['keys.gas', 'keys.brakeReverse'],
};

/** the key help's markup for a mode */
export function keysHtml(e: GameEntry): string {
  const { drive, siren } = e.controls;
  const k = (keys: string, what: Key): string => `<span class="k"><b>${keys}</b> ${t(what)}</span>`;
  const [gas, brake] = GAS_BRAKE[drive];
  const parts = [
    ...(drive === 'train' ? [k('A D / ← →', 'keys.doors')] : [k('A D / ← →', 'keys.steer')]),
    k('W / ↑', gas),
    k('S / ↓', brake),
    ...(siren ? [k('E', 'keys.siren')] : []),
    k('C', 'keys.camera'),
    ...(drive === 'train' ? [] : [k('R', 'keys.reset')]),
    k('Esc', 'keys.garage'),
  ];
  return `<span class="lead">${t('keys.lead')}</span> ${parts.join(' · ')}`;
}
