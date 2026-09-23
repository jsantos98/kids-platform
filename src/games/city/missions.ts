// Missions: fire & cat-rescue objectives spawning around the player, nearest
// selection for the guidance arrow, and the hovering markers above each call.
import * as THREE from 'three';
import { C } from '../../engine/palette.js';
import { makeCatTree, makeFire, makeMarker, makePerson } from '../../kit/index.js';
import { rng, chunkSeed, type Rng } from '../../engine/rng.js';
import { RoadGrid } from '../../worlds/roadGrid.js';

export type ObjectiveType = 'fire' | 'cat' | 'patient';

export interface Objective {
  type: ObjectiveType;
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

  constructor(private scene: THREE.Scene, private seed: number, private CH: number,
              private grid: RoadGrid, private heliMode = false) {}

  spawn(player: PlayerXZ, forceChunkAt: (x: number, z: number) => void, forcedType?: ObjectiveType | null): void {
    const r: Rng = rng(chunkSeed(this.seed, 5000 + this.index, 91));
    const qType = new URLSearchParams(location.search).get('type');
    let type: ObjectiveType;
    if (forcedType) type = forcedType;
    else if (qType === 'fire' || qType === 'cat') type = qType;
    else if (this.heliMode) type = this.index % 3 === 2 ? 'cat' : 'patient';
    else type = this.index % 3 === 2 ? 'cat' : 'fire';
    const diff = Math.min(this.sFires + this.sCats, 10);
    const dist = this.index === 0 ? 26 + r() * 10 : Math.min(90 + diff * 10, 240) + r() * 60;
    const a = this.index === 0 ? player.heading + 0.5 : r() * Math.PI * 2;
    // pick the corner of a REAL intersection (golden-angle resampling)
    let gx = 0, gz = 0;
    for (let attempt = 0; attempt < 24; attempt++) {
      const aa = a + attempt * 2.39996;
      const px = player.x + Math.sin(aa) * dist, pz = player.z + Math.cos(aa) * dist;
      gx = Math.round(px / this.CH) * this.CH;
      gz = Math.round(pz / this.CH) * this.CH;
      if (this.grid.cross(Math.round(gx / this.CH), Math.round(gz / this.CH))) break;
    }
    const corner = (r() * 2) | 0; // corners without traffic lights
    const ox = corner ? -8.9 : 8.9, oz = corner ? 8.9 : -8.9;
    const pos = new THREE.Vector3(gx + ox, 0.15, gz + oz);
    forceChunkAt(pos.x, pos.z);
    const need = type === 'patient' ? Math.min(2.5 + diff * 0.15, 4)
      : type === 'fire' ? Math.min(5.5 + diff * 0.3, 9)
      : Math.min(3 + diff * 0.2, 5);
    let group: THREE.Group;
    let flames: THREE.Mesh[] | undefined;
    let smoke: THREE.Mesh[] | undefined;
    if (type === 'fire') {
      const f = makeFire();
      group = f.group;
      flames = f.flames;
      smoke = f.smoke;
    } else if (type === 'patient') {
      // a person waving for help on the ground (winched up by the helicopter)
      group = makePerson({ shirt: C.orange, pants: C.dark, cap: C.white });
      group.position.set(0, 0.15, 0);
      group.rotation.y = r() * Math.PI * 2;
    } else {
      group = makeCatTree(r);
    }
    group.position.copy(pos);
    group.position.y = pos.y;
    this.scene.add(group);
    const markerColor = type === 'fire' ? 0xffc93c : type === 'patient' ? 0x7fb2d9 : 0xff8ad1;
    const marker = makeMarker(markerColor);
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
