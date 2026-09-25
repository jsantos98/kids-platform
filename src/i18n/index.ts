// Every visible text goes through t(): the garage, the game page, the
// loading card, the mission scenes, the spoken names. Two languages —
// Portuguese (Portugal), the default, and English — chosen in the garage and
// remembered in localStorage for every page; `?lang=pt|en` overrides it.
import { EN, type Key } from './en.js';
import { PT } from './pt.js';

export type { Key };
export type Lang = 'pt' | 'en';

export const LANGS: ReadonlyArray<{ id: Lang; label: string; short: string }> = [
  { id: 'pt', label: 'Português', short: 'PT' },
  { id: 'en', label: 'English', short: 'EN' },
];

const STORE = 'garage.lang';
const DICTS: Record<Lang, Record<Key, string>> = { pt: PT, en: EN };

const isLang = (v: unknown): v is Lang => v === 'pt' || v === 'en';

let current: Lang = ((): Lang => {
  try {
    const q = new URLSearchParams(location.search).get('lang');
    if (isLang(q)) return q;
    const s = localStorage.getItem(STORE);
    if (isLang(s)) return s;
  } catch { /* no storage (a worker, private mode): the default */ }
  return 'pt';
})();

export function getLang(): Lang { return current; }

export function setLang(l: Lang): void {
  current = l;
  try { localStorage.setItem(STORE, l); } catch { /* private mode */ }
  if (typeof document !== 'undefined') document.documentElement.lang = htmlLang();
}

/** the text for `key` in the current language, `{name}`s filled from vars */
export function t(key: Key, vars?: Record<string, string | number>): string {
  const s = DICTS[current][key] ?? EN[key] ?? key;
  return vars ? s.replace(/\{(\w+)\}/g, (m, k: string) => (k in vars ? String(vars[k]) : m)) : s;
}

/** 1st / 2nd / 3rd … or 1.º / 2.º / 3.º … */
export function ordinal(n: number): string {
  if (current === 'pt') return `${n}.º`;
  const r = n % 100;
  const suf = r >= 11 && r <= 13 ? 'th' : n % 10 === 1 ? 'st' : n % 10 === 2 ? 'nd' : n % 10 === 3 ? 'rd' : 'th';
  return `${n}${suf}`;
}

/** the page's <html lang> */
export function htmlLang(): string { return current === 'pt' ? 'pt-PT' : 'en'; }

/** the locale for numbers */
export function numberLocale(): string { return current === 'pt' ? 'pt-PT' : 'en-GB'; }

/** the speech voice for the current language: Portugal's if the system has
 * one, else any Portuguese one (or any English one) */
export function speechVoice(): { lang: string; voice: SpeechSynthesisVoice | null } {
  const lang = current === 'pt' ? 'pt-PT' : 'en-GB';
  let voice: SpeechSynthesisVoice | null = null;
  try {
    const voices = window.speechSynthesis?.getVoices() ?? [];
    const norm = (v: SpeechSynthesisVoice): string => v.lang.replace('_', '-').toLowerCase();
    voice = voices.find(v => norm(v) === lang.toLowerCase())
      ?? voices.find(v => norm(v).startsWith(current)) ?? null;
  } catch { /* no speech */ }
  return { lang, voice };
}

/**
 * Fill a page's static texts: `data-i18n="key"` sets the text,
 * `data-i18n-html="key"` the markup (for texts with <b> keys), and
 * `data-i18n-title="key"` the tooltip; `titleKey` names the document title.
 */
export function applyI18n(titleKey?: Key, root: ParentNode = document): void {
  document.documentElement.lang = htmlLang();
  if (titleKey) document.title = t(titleKey);
  root.querySelectorAll<HTMLElement>('[data-i18n]').forEach(el => { el.textContent = t(el.dataset.i18n as Key); });
  root.querySelectorAll<HTMLElement>('[data-i18n-html]').forEach(el => { el.innerHTML = t(el.dataset.i18nHtml as Key); });
  root.querySelectorAll<HTMLElement>('[data-i18n-title]').forEach(el => { el.title = t(el.dataset.i18nTitle as Key); });
}
