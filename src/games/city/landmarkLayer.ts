// The landmarks dressed (G16): each is a building the city already bakes
// (landmarks.ts), and the game hangs its sign on it — a board with the
// place's icon over its door (🏥 🚔 🔧 ♻️), lit at night — and puts a
// helipad on a hospital's roof: a deck on short legs with its ring and H,
// its rim lamps glowing at night, where the medical helicopter hands its
// patient over. The police pier gets its flag. Signs carry icons, never
// words (G9). Built per island the first time the kid is there; the three
// most recent islands stay.
import * as THREE from 'three';
import { Baked } from '../../engine/baked.js';
import { cityPlanFor } from '../../worlds/cityPlan.js';
import { lotBuilding } from '../../worlds/cityChunk.js';
import { harbourFor } from './harbour.js';
import { landmarksFor, LANDMARK_ICON, type Landmark, type LandmarkKind } from './landmarks.js';
import type { NightLights } from './nightLights.js';

/** each place's sign colours: the board, its trim */
const SIGN: Record<LandmarkKind, [string, number]> = {
  hospital: ['#ffffff', 0xd8322a],
  prison: ['#dfe7f5', 0x2c3e66],
  repair: ['#fff1d6', 0xe07b22],
  depot: ['#e4f5e0', 0x3f9a4a],
  pier: ['#dfe7f5', 0x2c3e66],
};

const texCache = new Map<string, THREE.CanvasTexture>();
/** the sign's face: a rounded board in its colour with the icon on it */
function signTexture(kind: LandmarkKind): THREE.CanvasTexture {
  let t = texCache.get(kind);
  if (t) return t;
  const W = 256, H = 128;
  const cv = document.createElement('canvas');
  cv.width = W; cv.height = H;
  const g = cv.getContext('2d')!;
  g.fillStyle = SIGN[kind][0];
  g.beginPath();
  g.roundRect(6, 6, W - 12, H - 12, 18);
  g.fill();
  if (kind === 'hospital') {
    // a hospital's sign is the red cross itself (read from across town, where
    // the emoji's little building wasn't)
    g.fillStyle = '#d8322a';
    g.fillRect(W / 2 - 16, 18, 32, H - 36);
    g.fillRect(W / 2 - 46, H / 2 - 16, 92, 32);
  } else {
    g.font = '104px "Segoe UI Emoji", "Apple Color Emoji", "Noto Color Emoji", sans-serif';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText(LANDMARK_ICON[kind], W / 2, H / 2 + 8);
  }
  t = new THREE.CanvasTexture(cv);
  t.colorSpace = THREE.SRGBColorSpace;
  texCache.set(kind, t);
  return t;
}

let padTex: THREE.CanvasTexture | null = null;
/** a helipad's deck: dark, a white ring and a big H in it, a red cross beside */
function helipadTexture(): THREE.CanvasTexture {
  if (padTex) return padTex;
  const S = 256;
  const cv = document.createElement('canvas');
  cv.width = S; cv.height = S;
  const g = cv.getContext('2d')!;
  g.fillStyle = '#4b505c';
  g.fillRect(0, 0, S, S);
  g.strokeStyle = '#ffffff';
  g.lineWidth = 12;
  g.beginPath();
  g.arc(S / 2, S / 2, S / 2 - 22, 0, Math.PI * 2);
  g.stroke();
  // the H, drawn as bars (a letter needs no translating, but bars need no font)
  g.fillStyle = '#ffffff';
  g.fillRect(S * 0.34, S * 0.3, S * 0.08, S * 0.4);
  g.fillRect(S * 0.58, S * 0.3, S * 0.08, S * 0.4);
  g.fillRect(S * 0.34, S * 0.46, S * 0.32, S * 0.08);
  padTex = new THREE.CanvasTexture(cv);
  padTex.colorSpace = THREE.SRGBColorSpace;
  return padTex;
}

interface Glow { x: number; y: number; z: number; color: number; size: number }
interface Inst { group: THREE.Group; glows: Glow[]; pads: Map<Landmark, { x: number; y: number; z: number }> }

export class LandmarkLayer {
  private cities = new Map<string, Inst>();
  night: NightLights | null = null;

  constructor(private scene: THREE.Scene) {}

  ensure(bx: number, by: number, ox: number, oz: number): void {
    const key = `${bx},${by}`;
    const have = this.cities.get(key);
    if (have) { this.cities.delete(key); this.cities.set(key, have); return; }
    const group = new THREE.Group();
    const glows: Glow[] = [];
    const pads = new Map<Landmark, { x: number; y: number; z: number }>();
    const plan = cityPlanFor(bx, by);
    const B = new Baked();
    const signs: Array<{ kind: LandmarkKind; x: number; y: number; z: number; ry: number }> = [];
    for (const l of landmarksFor(bx, by)) {
      if (!l.lot) {
        // the police pier: a flagpole with a blue flag at its end
        const H = harbourFor(bx, by), p = H.at(3, 17.5);
        B.cyl(0.08, 0.1, 5, 6, 0xdfe7f5, ox + p.x, 2.9, oz + p.z);
        B.box(0.05, 0.9, 1.4, 0x2c5fb8, ox + p.x + H.across.x * 0.72, 4.9, oz + p.z + H.across.z * 0.72, 0, H.yaw, 0);
        signs.push({ kind: 'pier', x: ox + p.x, y: 1.9, z: oz + p.z, ry: H.yaw + Math.PI });
        continue;
      }
      const lot = l.lot;
      const nx = Math.sin(lot.ry), nz = Math.cos(lot.ry), tx = Math.cos(lot.ry), tz = -Math.sin(lot.ry);
      const b = lotBuilding(lot, plan.districtAt(lot.x, lot.z) === 'industrial');
      if (b) {
        // the sign over the door, on the building's street face
        const fx = b.x + nx * (b.hz + 0.25), fz = b.z + nz * (b.hz + 0.25), y = Math.min(b.top * 0.62, 7.5);
        B.box(3.6, 1.9, 0.18, SIGN[l.kind][1], ox + fx - nx * 0.1, y, oz + fz - nz * 0.1, 0, lot.ry, 0);
        signs.push({ kind: l.kind, x: ox + fx, y, z: oz + fz, ry: lot.ry });
        glows.push({ x: ox + fx + nx * 0.4, y, z: oz + fz + nz * 0.4, color: 0xfff4dc, size: 2.2 });
        if (l.kind === 'hospital') {
          // the helipad: a deck on short legs over the roof's middle
          const r = Math.max(3.2, Math.min(b.hx, b.hz, 6) * 0.72), py = b.top + 0.45;
          for (const [a, c] of [[-0.6, -0.6], [0.6, -0.6], [-0.6, 0.6], [0.6, 0.6]]) {
            B.box(0.3, 3, 0.3, 0x7c828c, ox + b.x + (tx * a + nx * c) * r, py - 1.6, oz + b.z + (tz * a + nz * c) * r);
          }
          B.cyl(r + 0.25, r + 0.25, 0.25, 28, 0x7c828c, ox + b.x, py - 0.1, oz + b.z);
          const pad = new THREE.Mesh(new THREE.CircleGeometry(r, 28), new THREE.MeshLambertMaterial({ map: helipadTexture() }));
          pad.rotation.x = -Math.PI / 2;
          pad.rotation.z = lot.ry;
          pad.position.set(ox + b.x, py + 0.04, oz + b.z);
          pad.receiveShadow = true;
          group.add(pad);
          pads.set(l, { x: ox + b.x, y: py, z: oz + b.z });
          for (let k = 0; k < 8; k++) {
            const a = (k / 8) * Math.PI * 2;
            glows.push({ x: ox + b.x + Math.cos(a) * (r + 0.1), y: py + 0.2, z: oz + b.z + Math.sin(a) * (r + 0.1), color: 0x5dff7a, size: 0.8 });
          }
        }
      } else {
        // (no building the game can name — a works lot: the sign on two
        // posts at the lot's front)
        const fx = lot.x + nx * (lot.d / 2 - 0.5), fz = lot.z + nz * (lot.d / 2 - 0.5);
        for (const s of [-1.4, 1.4]) B.box(0.16, 4.2, 0.16, 0x5a5f69, ox + fx + tx * s, 2.1, oz + fz + tz * s);
        B.box(3.6, 1.9, 0.18, SIGN[l.kind][1], ox + fx, 4.6, oz + fz, 0, lot.ry, 0);
        signs.push({ kind: l.kind, x: ox + fx + nx * 0.1, y: 4.6, z: oz + fz + nz * 0.1, ry: lot.ry });
        glows.push({ x: ox + fx + nx * 0.5, y: 4.6, z: oz + fz + nz * 0.5, color: 0xfff4dc, size: 2.2 });
        if (l.kind === 'hospital') pads.set(l, { x: ox + lot.x, y: 0.2, z: oz + lot.z });
      }
    }
    group.add(B.build());
    for (const s of signs) {
      const face = new THREE.Mesh(new THREE.PlaneGeometry(3.3, 1.65), new THREE.MeshBasicMaterial({ map: signTexture(s.kind), toneMapped: false }));
      face.position.set(s.x, s.y, s.z);
      face.rotation.y = s.ry;
      group.add(face);
    }
    this.scene.add(group);
    this.cities.set(key, { group, glows, pads });
    while (this.cities.size > 3) {
      const oldest = this.cities.keys().next().value as string;
      const inst = this.cities.get(oldest)!;
      this.scene.remove(inst.group);
      inst.group.traverse(o => { const m = o as THREE.Mesh; if (m.isMesh) m.geometry.dispose(); });
      this.cities.delete(oldest);
    }
  }

  /** where a hospital's helipad is (world), if its island is dressed */
  padOf(bx: number, by: number, l: Landmark): { x: number; y: number; z: number } | null {
    const inst = this.cities.get(`${bx},${by}`);
    if (!inst) return null;
    for (const [k, p] of inst.pads) if (k.x === l.x && k.z === l.z) return p;
    return null;
  }

  /** at night the signs and the pads' rim lamps glow (G10) */
  update(night: number, x: number, z: number): void {
    if (night < 0.05 || !this.night) return;
    for (const inst of this.cities.values()) {
      for (const g of inst.glows) if (Math.abs(g.x - x) < 450 && Math.abs(g.z - z) < 450) this.night.flash({ x: g.x, y: g.y, z: g.z, color: g.color, size: g.size, pool: 0, strength: night });
    }
  }
}
