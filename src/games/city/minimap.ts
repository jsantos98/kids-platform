// Minimap: the streets round the kid at a glance, north up — the island's
// shore and districts, streets, river and railway, the goals (each as the
// icon its HUD badge shows: the calls, the getaway cars, the course gates,
// the next station) and a big arrow for the kid. Zoomed in on the kid (the
// whole island in a 150 px square was unreadable, and a dot at every traffic
// light filled it with red): a goal off the edge sits on the rim, pointing
// the way. The island is drawn once into an offscreen canvas per island and
// each frame copies the window round the kid.
import { chunkGroundColor, slabColor } from '../../worlds/cityChunk.js';
import { railNetFor } from '../../worlds/railRoute.js';
import { riverFor } from '../../worlds/riverRoute.js';
import { cityPlanFor } from '../../worlds/cityPlan.js';
import { raceTrackFor } from '../../worlds/raceIsland.js';
import { graphFor } from '../../worlds/streetGraph.js';
import { WORLD_CHUNKS, ISLAND, CENTER } from '../../worlds/world.js';
import { CITY_PITCH } from '../../worlds/cityGrid.js';
import { bridgeLayout } from './bridge.js';
import { airportFor, boxPoint } from './airport.js';
import { APPROACH_LEN } from './landing.js';
import { coastFor, causewaySpan } from '../../worlds/coast.js';
import { isletsFor } from './islets.js';
import { callIcon, type Missions } from './missions.js';

const hex = (n: number) => '#' + n.toString(16).padStart(6, '0');

const CH = 64;              // chunk size (world metres)
const SIZE = 384;           // canvas backing-store pixels
const VIEW = 520;           // world metres across, round the kid
const SPAN = ISLAND + 420;  // the offscreen island: island + sea + causeways (m)
const PX = 1;               // offscreen pixels per metre

/** a goal on the map (world coordinates) and its icon */
export interface MapGoal { x: number; z: number; icon: string }

export class Minimap {
  private ctx: CanvasRenderingContext2D;
  private bx = 0;
  private by = 0;
  private ox = 0;
  private oz = 0;
  /** the island drawn once (null: to draw for the current island) */
  private base: HTMLCanvasElement | null = null;
  private icons = new Map<string, HTMLCanvasElement>();

  /** point the map at another island of the archipelago */
  setCity(bx: number, by: number, ox: number, oz: number): void {
    if (bx !== this.bx || by !== this.by) this.base = null;
    this.bx = bx; this.by = by; this.ox = ox; this.oz = oz;
  }

  constructor(canvas: HTMLCanvasElement, private missions: Missions,
              /** the other live goals (getaway cars, course gates, the next station), world */
              private goals: () => MapGoal[] = () => []) {
    canvas.width = SIZE;
    canvas.height = SIZE;
    this.ctx = canvas.getContext('2d')!;
  }

  update(playerX: number, playerZ: number, heading: number): void {
    const ctx = this.ctx, s = SIZE, scale = s / VIEW;
    const px = playerX - this.ox, pz = playerZ - this.oz; // city-local
    this.base ??= this.drawIsland();
    // the window round the kid, from the offscreen island
    const o0 = CENTER - SPAN / 2;
    ctx.fillStyle = '#72c3de';
    ctx.fillRect(0, 0, s, s);
    ctx.drawImage(this.base, (px - VIEW / 2 - o0) * PX, (pz - VIEW / 2 - o0) * PX, VIEW * PX, VIEW * PX, 0, 0, s, s);
    const tx = (x: number): number => (x - px) * scale + s / 2;
    const ty = (z: number): number => (z - pz) * scale + s / 2;

    // the goals: each one's icon on a white disc; off the map, on its rim
    // with a little pointer toward it
    const R = 21;
    const all: MapGoal[] = [
      ...this.missions.objectives.map(o => ({ x: o.pos.x, z: o.pos.z, icon: callIcon(o.type) })),
      ...this.goals(),
    ];
    for (const g of all) {
      let x = tx(g.x - this.ox), y = ty(g.z - this.oz);
      const lim = s / 2 - R - 6;
      const dx = x - s / 2, dy = y - s / 2;
      const out = Math.max(Math.abs(dx), Math.abs(dy)) > lim;
      if (out) {
        const k = lim / Math.max(Math.abs(dx), Math.abs(dy));
        x = s / 2 + dx * k; y = s / 2 + dy * k;
        // the pointer: a small triangle on the disc's outer side
        const a = Math.atan2(dy, dx);
        ctx.fillStyle = '#fffdf8';
        ctx.beginPath();
        ctx.moveTo(x + Math.cos(a) * (R + 7), y + Math.sin(a) * (R + 7));
        ctx.lineTo(x + Math.cos(a + 0.5) * (R - 2), y + Math.sin(a + 0.5) * (R - 2));
        ctx.lineTo(x + Math.cos(a - 0.5) * (R - 2), y + Math.sin(a - 0.5) * (R - 2));
        ctx.closePath();
        ctx.fill();
      }
      ctx.drawImage(this.icon(g.icon), x - R, y - R, 2 * R, 2 * R);
    }

    // the kid: a big arrow in the middle, the way it's heading
    ctx.save();
    ctx.translate(s / 2, s / 2);
    // (the arrow is drawn pointing up the map, -z; a heading h faces
    // (sin h, cos h) with +z drawn downwards: rotate by π − h — by h it
    // pointed back the way the kid came)
    ctx.rotate(Math.PI - heading);
    ctx.fillStyle = '#e25c5c';
    ctx.strokeStyle = '#fffdf8';
    ctx.lineWidth = 5;
    ctx.lineJoin = 'round';
    ctx.beginPath();
    ctx.moveTo(0, -32);
    ctx.lineTo(23, 24);
    ctx.lineTo(0, 12);
    ctx.lineTo(-23, 24);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    ctx.restore();
  }

  /** an icon on a white disc, drawn once */
  private icon(icon: string): HTMLCanvasElement {
    let c = this.icons.get(icon);
    if (c) return c;
    c = document.createElement('canvas');
    c.width = c.height = 64;
    const g = c.getContext('2d')!;
    g.beginPath();
    g.arc(32, 32, 30, 0, Math.PI * 2);
    g.fillStyle = '#fffdf8';
    g.fill();
    g.lineWidth = 3;
    g.strokeStyle = 'rgba(45, 49, 66, 0.35)';
    g.stroke();
    g.font = '38px "Segoe UI Emoji", "Apple Color Emoji", "Noto Color Emoji", sans-serif';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText(icon, 32, 35);
    this.icons.set(icon, c);
    return c;
  }

  /** the island, once: shore, districts, streets, river, railway, causeways */
  private drawIsland(): HTMLCanvasElement {
    const cv = document.createElement('canvas');
    cv.width = cv.height = Math.ceil(SPAN * PX);
    const ctx = cv.getContext('2d')!;
    const o0 = CENTER - SPAN / 2;
    const tx = (x: number): number => (x - o0) * PX;
    const ty = (z: number): number => (z - o0) * PX;
    const plan = cityPlanFor(this.bx, this.by);

    // the island — its real shore, a sand rim, district tints clipped to it —
    // on the sea
    ctx.fillStyle = '#72c3de';
    ctx.fillRect(0, 0, cv.width, cv.height);
    // the treasure islets (G15): little sand islands with a palm
    for (const I of isletsFor(this.bx, this.by)) {
      ctx.beginPath();
      ctx.arc(tx(I.x), ty(I.z), Math.max(2.5, I.r * PX), 0, Math.PI * 2);
      ctx.fillStyle = '#f0e2c0';
      ctx.fill();
      ctx.beginPath();
      ctx.arc(tx(I.x), ty(I.z), Math.max(1.2, I.r * PX * 0.4), 0, Math.PI * 2);
      ctx.fillStyle = '#7fb069';
      ctx.fill();
    }
    const coast = coastFor(this.bx, this.by);
    ctx.beginPath();
    coast.pts.forEach((p, k) => (k ? ctx.lineTo(tx(p.x), ty(p.z)) : ctx.moveTo(tx(p.x), ty(p.z))));
    ctx.closePath();
    ctx.fillStyle = '#f0e2c0';
    ctx.fill();
    ctx.save();
    ctx.clip();
    for (let cx = 0; cx < WORLD_CHUNKS; cx++) {
      for (let cz = 0; cz < WORLD_CHUNKS; cz++) {
        ctx.fillStyle = hex(chunkGroundColor(this.bx, this.by, cx, cz));
        ctx.fillRect(tx(cx * CH) + 4, ty(cz * CH) + 4, CH * PX, CH * PX);
      }
    }
    for (const bl of plan.blocks) {
      ctx.beginPath();
      bl.poly.forEach((p, k) => (k ? ctx.lineTo(tx(p.x), ty(p.z)) : ctx.moveTo(tx(p.x), ty(p.z))));
      ctx.closePath();
      ctx.fillStyle = hex(slabColor(bl.district));
      ctx.fill();
    }
    ctx.restore();

    // the causeways out to the four neighbours (off the island's edge is fine)
    ctx.fillStyle = '#8f97a3';
    const S = causewaySpan(this.bx, this.by, 's'), E = causewaySpan(this.bx, this.by, 'e');
    const N = causewaySpan(this.bx, this.by - 1, 's'), W = causewaySpan(this.bx - 1, this.by, 'e');
    const far = SPAN;
    ctx.fillRect(tx(S.at - 7), ty(S.from), 14 * PX, far * PX);
    ctx.fillRect(tx(E.from), ty(E.at - 7), far * PX, 14 * PX);
    ctx.fillRect(tx(N.at - 7), ty(N.to - CITY_PITCH - far), 14 * PX, far * PX);
    ctx.fillRect(tx(W.to - CITY_PITCH - far), ty(W.at - 7), far * PX, 14 * PX);
    // the bridge + picnic island off the south shore
    const BRIDGE = bridgeLayout(this.bx, this.by);
    ctx.fillStyle = '#c8b98e';
    ctx.fillRect(tx(BRIDGE.ISLE.x1), ty(BRIDGE.ISLE.z1), 40 * PX, 40 * PX);
    ctx.fillStyle = '#a9c88b';
    ctx.fillRect(tx(BRIDGE.ISLE.x1 + 2), ty(BRIDGE.ISLE.z1 + 2), 36 * PX, 36 * PX);
    ctx.fillStyle = '#8f97a3';
    ctx.fillRect(tx(BRIDGE.X - 5.5), ty(BRIDGE.Z0), 11 * PX, 42 * PX);

    // the airport's island, its runway and its causeway (R41)
    {
      const A = airportFor(this.bx, this.by);
      const quad = (b: { cx: number; cz: number; yaw: number; hl: number; hw: number }, col: string): void => {
        ctx.fillStyle = col;
        ctx.beginPath();
        ([[-1, -1], [1, -1], [1, 1], [-1, 1]] as const).forEach(([a, l], k) => {
          const p = boxPoint(b, a * b.hl, l * b.hw);
          if (k) ctx.lineTo(tx(p.x), ty(p.z)); else ctx.moveTo(tx(p.x), ty(p.z));
        });
        ctx.closePath();
        ctx.fill();
      };
      quad(A.link, '#8f97a3');
      quad(A.isle, '#c8c2b4');
      quad({ ...A.runway, hl: A.runway.hl + A.pad }, '#5c636d');
      // the runway's centre line, dotted out from both ends: the way in
      ctx.strokeStyle = 'rgba(255,255,255,0.9)';
      ctx.lineWidth = 2.5 * PX;
      ctx.setLineDash([9 * PX, 9 * PX]);
      ctx.beginPath();
      for (const end of [-1, 1]) {
        const a = boxPoint(A.runway, end * (A.runway.hl + A.pad), 0), b = boxPoint(A.runway, end * (A.runway.hl + APPROACH_LEN), 0);
        ctx.moveTo(tx(a.x), ty(a.z));
        ctx.lineTo(tx(b.x), ty(b.z));
      }
      ctx.stroke();
      ctx.setLineDash([]);
    }

    // the river, ribbon-width
    ctx.strokeStyle = '#5fadc9';
    ctx.lineWidth = 14 * PX;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.beginPath();
    riverFor(this.bx, this.by).pts.forEach((p, k) => (k ? ctx.lineTo(tx(p.x), ty(p.z)) : ctx.moveTo(tx(p.x), ty(p.z))));
    ctx.stroke();

    // streets: every edge of the street graph, a little wider than life so
    // they read at a glance — a dark edge, a light road
    const graph = graphFor(this.bx, this.by);
    for (const [w, col] of [[21, '#6d7580'], [16, '#aab1bb']] as Array<[number, string]>) {
      ctx.strokeStyle = col;
      ctx.lineWidth = w * PX;
      ctx.beginPath();
      for (const e of graph.edges) {
        const a = graph.nodes[e.a], b = graph.nodes[e.b];
        ctx.moveTo(tx(a.x), ty(a.z));
        ctx.lineTo(tx(b.x), ty(b.z));
      }
      ctx.stroke();
    }

    // a race island's circuit: the loop in white
    const race = raceTrackFor(this.bx, this.by);
    if (race) {
      ctx.strokeStyle = '#f4f1ea';
      ctx.lineWidth = 14 * PX;
      ctx.beginPath();
      race.path.forEach((p, k) => (k ? ctx.lineTo(tx(p.x), ty(p.z)) : ctx.moveTo(tx(p.x), ty(p.z))));
      ctx.closePath();
      ctx.stroke();
    }

    // the railway: this island's two through lines, plus the neighbours'
    // lines arriving over our north and west straits
    ctx.strokeStyle = '#7a6248';
    ctx.lineWidth = 5 * PX;
    ctx.beginPath();
    for (const [nbx, nby, dx, dz] of [[this.bx, this.by, 0, 0], [this.bx, this.by - 1, 0, -CITY_PITCH], [this.bx - 1, this.by, -CITY_PITCH, 0]]) {
      for (const L of railNetFor(nbx, nby).lines) {
        L.pts.forEach((p, k) => {
          if (k % 3 && k !== L.pts.length - 1) return;
          const x = tx(p.x + dx), y = ty(p.z + dz);
          if (k === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
        });
      }
    }
    ctx.stroke();
    ctx.lineCap = 'butt';
    return cv;
  }
}
