// Launcher bootstrap: render the game registry as big garage buttons.
import { GAMES } from './games/registry.js';

const container = document.getElementById('games')!;
for (const g of GAMES) {
  const a = document.createElement('a');
  a.className = 'game';
  a.href = g.url;
  const icon = document.createElement('div');
  icon.className = 'icon';
  icon.textContent = g.icon;
  const t = document.createElement('div');
  t.className = 't';
  t.textContent = g.title;
  const b = document.createElement('div');
  b.className = 'b';
  b.textContent = g.blurb;
  a.append(icon, t, b);
  container.append(a);
}
