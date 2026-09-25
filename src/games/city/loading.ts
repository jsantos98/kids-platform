// The loading screen: while the kit models bake, the start island grows in
// the world worker and the streets in view are laid, a full-screen card
// shows what is happening, a bar with the mode's vehicle driving along it,
// and about how long is left (from the pace so far). Also the small pill
// that says the next island is on its way (index.ts).
import { t as tr } from '../../i18n/index.js';
export class LoadingScreen {
  private el: HTMLElement;
  private fill: HTMLElement;
  private car: HTMLElement;
  private label: HTMLElement;
  private eta: HTMLElement;
  private t0 = performance.now();
  private shown = 0;
  private left = -1;

  constructor(icon: string) {
    this.el = document.getElementById('loading')!;
    this.fill = this.el.querySelector('.fill') as HTMLElement;
    this.car = this.el.querySelector('.car') as HTMLElement;
    this.label = this.el.querySelector('.label') as HTMLElement;
    this.eta = this.el.querySelector('.eta') as HTMLElement;
    this.car.textContent = icon;
    this.el.style.display = 'flex';
  }

  /** overall progress f (0..1) and what is happening now */
  set(f: number, label: string): void {
    // never backwards, however the stages report
    this.shown = Math.max(this.shown, Math.min(1, f));
    const pct = (this.shown * 100).toFixed(1);
    this.fill.style.width = `${pct}%`;
    this.car.style.left = `${pct}%`;
    this.label.textContent = label;
    const el = (performance.now() - this.t0) / 1000;
    if (this.shown > 0.06) {
      const est = (el * (1 - this.shown)) / this.shown;
      // (eased, so the number doesn't jump about)
      this.left = this.left < 0 ? est : this.left + (est - this.left) * 0.15;
      this.eta.textContent = this.left < 1.5 ? tr('load.almost') : tr('load.about', { s: Math.ceil(this.left) });
    }
  }

  /** fade away (the game is ready) */
  done(): void {
    this.set(1, tr('load.done'));
    this.el.classList.add('gone');
    setTimeout(() => { this.el.style.display = 'none'; }, 650);
  }
}

/** yield to the browser so the bar can paint: a frame when the page is
 * visible, else a bare task (a hidden page gets no frames) */
export function nextFrame(): Promise<void> {
  if (document.hidden) {
    return new Promise(r => { const c = new MessageChannel(); c.port1.onmessage = () => r(); c.port2.postMessage(0); });
  }
  return new Promise(r => requestAnimationFrame(() => r()));
}
