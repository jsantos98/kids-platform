// Missions: fire & cat-rescue objectives spawning around the player, nearest
// selection for the guidance arrow, and the hovering markers above each call.
import * as THREE from 'three';
import { makeCatTree, makeFire, makeMarker } from '../../kit/index.js';
import { rng, chunkSeed, type Rng } from '../../engine/rng.js';

export interface Objective {
  type: 'fire' | 'cat';
  group: THREE.Group;
  flames?: THREE.Mesh[];
  smoke?: THREE.Mesh[];
  pos: THREE.Vector3;
  progress: number;
  need: number;
  gx: number;
  gz: number;
  marker: THREE.Group;
  index: number;
  /** distance to the player, refreshed each frame */
  d: number;
}

export interface PlayerXZ {
  x: number;
  z: number;
  heading: number;
}

export class Missions {
  objectives: Objective[] = [];
  cooldown = 0;
  index = 0;
  sFires = 0;
  sCats = 0;

  constructor(private scene: THREE.Scene, private seed: number, private CH: number) {}

  spawn(player: PlayerXZ, forceChunkAt: (x: number, z: number) => void, forcedType?: 'fire' | 'cat' | null): void {
    const r: Rng = rng(chunkSeed(this.seed, 5000 + this.index, 91));
    const qType = new URLSearchParams(location.search).get('type');
    const type = (forcedType ?? (qType as 'fire' | 'cat' | null)) ?? (this.index % 3 === 2 ? 'cat' : 'fire');
    const diff = Math.min(this.sFires + this.sCats, 10);
    const dist = this.index === 0 ? 26 + r() * 10 : Math.min(90 + diff * 10, 240) + r() * 60;
    const a = this.index === 0 ? player.heading + 0.5 : r() * Math.PI * 2;
    const px = player.x + Math.sin(a) * dist, pz = player.z + Math.cos(a) * dist;
    const gx = Math.round(px / this.CH) * this.CH, gz = Math.round(pz / this.CH) * this.CH;
    const corner = (r() * 2) | 0; // corners without traffic lights
    const ox = corner ? -5.9 : 5.9, oz = corner ? 5.9 : -5.9;
    const pos = new THREE.Vector3(gx + ox, 0.15, gz + oz);
    forceChunkAt(pos.x, pos.z);
    const need = type === 'fire' ? Math.min(5.5 + diff * 0.3, 9) : Math.min(3 + diff * 0.2, 5);
    let group: THREE.Group;
    let flames: THREE.Mesh[] | undefined;
    let smoke: THREE.Mesh[] | undefined;
    if (type === 'fire') {
      const f = makeFire();
      group = f.group;
      flames = f.flames;
      smoke = f.smoke;
    } else {
      group = makeCatTree(r);
    }
    group.position.copy(pos);
    this.scene.add(group);
    const marker = makeMarker(type === 'fire' ? 0xffc93c : 0xff8ad1);
    marker.position.set(pos.x, 6.4, pos.z);
    this.scene.add(marker);
    this.objectives.push({ type, group, flames, smoke, pos, progress: 0, need, gx, gz, marker, index: this.index, d: 1e9 });
    this.index++;
  }

  remove(o: Objective): void {
    const i = this.objectives.indexOf(o);
    if (i >= 0) this.objectives.splice(i, 1);
    this.scene.remove(o.group);
    if (o.marker) this.scene.remove(o.marker);
  }

  nearest(x: number, z: number): { o: Objective | null; d: number } {
    let o: Objective | null = null, d = 1e9;
    for (const obj of this.objectives) {
      obj.d = Math.hypot(obj.pos.x - x, obj.pos.z - z);
      if (obj.d < d) { d = obj.d; o = obj; }
    }
    return { o, d };
  }
}
