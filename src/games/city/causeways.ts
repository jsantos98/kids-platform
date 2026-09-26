// The causeway decks between the islands, streamed on their own (R29, R21):
// every deck of the islands round the kid is built whole once any of it
// comes within BUILD_R of the kid and dropped past DROP_R — at most one bake
// a frame. Baked into the chunk holding its shore point, a deck only existed
// while that one chunk was in view, so from the far shore it popped in at
// the last moment. Physics never needed the mesh: everything rides deckAt().
import * as THREE from 'three';
import { Baked } from '../../engine/baked.js';
import { spansOf, type Span } from '../../worlds/causeway.js';
import { bakeCausewayDeck } from '../../worlds/causewayDeck.js';
import { cityAt, CITY_PITCH } from '../../worlds/cityGrid.js';

const BUILD_R = 450, DROP_R = 650;

interface Deck { mesh: THREE.Mesh }

/** distance from (x, z) to a span's centreline (world; the span city-local
 * to an island at ox, oz) */
function spanDist(s: Span, ox: number, oz: number, x: number, z: number): number {
  const along = s.side === 's' ? z - oz : x - ox, across = s.side === 's' ? x - ox : z - oz;
  const t = Math.max(s.from, Math.min(s.to, along));
  return Math.hypot(along - t, across - s.at);
}

export class Causeways {
  private decks = new Map<string, Deck>();

  constructor(private scene: THREE.Scene) {}

  /** keep the decks near (px, pz) built, drop the far ones */
  update(px: number, pz: number): void {
    const here = cityAt(px, pz);
    let built = false;
    const seen = new Set<string>();
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        const bx = here.bx + dx, by = here.by + dy, ox = bx * CITY_PITCH, oz = by * CITY_PITCH;
        for (const s of spansOf(bx, by)) {
          const key = `${bx},${by},${s.side},${s.kind}`;
          const d = spanDist(s, ox, oz, px, pz);
          if (d < DROP_R) seen.add(key);
          if (d < BUILD_R && !this.decks.has(key) && !built) {
            const B = new Baked();
            bakeCausewayDeck(B, s);
            const mesh = B.build();
            mesh.position.set(ox, 0, oz);
            this.scene.add(mesh);
            this.decks.set(key, { mesh });
            built = true;
          }
        }
      }
    }
    for (const [key, deck] of this.decks) {
      if (seen.has(key)) continue;
      this.scene.remove(deck.mesh);
      deck.mesh.geometry.dispose();
      this.decks.delete(key);
    }
  }

  /** debug: how many decks are built */
  get count(): number { return this.decks.size; }
}
