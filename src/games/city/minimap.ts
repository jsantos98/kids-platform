// Minimap: the whole island at a glance — chunk biomes, roads, river, railway,
// traffic-light state, missions and the player arrow. Drawn on a 2D
// canvas, fixed on the island centre so north stays up.
import { lightState } from './lights.js';
import { chunkGroundColor, slabColor } from '../../worlds/cityChunk.js';
import { railNetFor } from '../../worlds/railRoute.js';
import { riverFor } from '../../worlds/riverRoute.js';
import { cityPlanFor } from '../../worlds/cityPlan.js';
import { raceTrackFor } from '../../worlds/raceIsland.js';
import { graphFor } from '../../worlds/streetGraph.js';
import { WORLD_CHUNKS, ISLAND, CENTER } from '../../worlds/world.js';
import { CITY_PITCH } from '../../worlds/cityGrid.js';
import { bridgeLayout } from './bridge.js';
import { coastFor, causewaySpan } from '../../worlds/coast.js';
import type { Missions } from './missions.js';

const hex = (n: number) => '#' + n.toString(16).padStart(6, '0');

const CH = 64;           // chunk size (world metres)
const SIZE = 256;        // canvas backing-store pixels
const VIEW = ISLAND + 170; // world metres across (island + sea + bridge island)

export class Minimap {
  private ctx: CanvasRenderingContext2D;

  private bx = 0;
  private by = 0;
  private ox = 0;
  private oz = 0;

  /** point the map at another island of the archipelago */
  setCity(bx: number, by: number, ox: number, oz: number): void {
    this.bx = bx; this.by = by; this.ox = ox; this.oz = oz;
  }

  constructor(canvas: HTMLCanvasElement, private missions: Missions,
              private seaBoats: () => Array<{ x: number; z: number }> = () => [],
              /** other live targets (getaway cars, course gates), world */
              private goals: () => Array<{ x: number; z: number; color: string }> = () => []) {
    canvas.width = SIZE;
    canvas.height = SIZE;
    this.ctx = canvas.getContext('2d')!;
  }

  update(playerX: number, playerZ: number, heading: number, elapsed: number): void {
    const plan = cityPlanFor(this.bx, this.by);
    const px = playerX - this.ox, pz = playerZ - this.oz; // city-local
    const ctx = this.ctx;
    const s = SIZE;
    const scale = s / VIEW;
    const tx = (x: number) => (x - (CENTER - VIEW / 2)) * scale;
    const ty = (z: number) => (z - (CENTER - VIEW / 2)) * scale;

    // the island — its real shore, a sand rim, district tints clipped to it —
    // on the sea
    ctx.fillStyle = '#72c3de';
    ctx.fillRect(0, 0, s, s);
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
        ctx.fillRect(tx(cx * CH) + 1.5, ty(cz * CH) + 1.5, CH * scale, CH * scale);
      }
    }
    // ... and every block in its district's colour
    for (const bl of plan.blocks) {
      ctx.beginPath();
      bl.poly.forEach((p, k) => (k ? ctx.lineTo(tx(p.x), ty(p.z)) : ctx.moveTo(tx(p.x), ty(p.z))));
      ctx.closePath();
      ctx.fillStyle = hex(slabColor(bl.district));
      ctx.fill();
    }
    ctx.restore();

    // streets: every edge of the street graph
    const graph = graphFor(this.bx, this.by);
    ctx.strokeStyle = '#8f97a3';
    ctx.lineWidth = 12 * scale;
    ctx.beginPath();
    for (const e of graph.edges) {
      const a = graph.nodes[e.a], b = graph.nodes[e.b];
      ctx.moveTo(tx(a.x), ty(a.z));
      ctx.lineTo(tx(b.x), ty(b.z));
    }
    ctx.stroke();

    // a race island's circuit: the loop in white on its apron
    const race = raceTrackFor(this.bx, this.by);
    if (race) {
      ctx.strokeStyle = '#f4f1ea';
      ctx.lineWidth = 12 * scale;
      ctx.beginPath();
      race.path.forEach((p, k) => (k ? ctx.lineTo(tx(p.x), ty(p.z)) : ctx.moveTo(tx(p.x), ty(p.z))));
      ctx.closePath();
      ctx.stroke();
    }

    // the river, ribbon-width
    const river = riverFor(this.bx, this.by);
    ctx.strokeStyle = '#5fadc9';
    ctx.lineWidth = 11 * scale;
    ctx.lineCap = 'round';
    ctx.beginPath();
    river.pts.forEach((p, k) => {
      const x = tx(p.x), y = ty(p.z);
      if (k === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    });
    ctx.stroke();
    ctx.lineCap = 'butt';

    // the railway: this island's two through lines, plus the neighbours'
    // lines arriving over our north and west straits
    ctx.strokeStyle = '#7a6248';
    ctx.lineWidth = 3.4 * scale;
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

    // train stations: blue platforms
    ctx.fillStyle = '#4a90d9';
    for (const st of plan.stations) {
      ctx.fillRect(tx(st.x) - 3, ty(st.z) - 3, 6, 6);
    }

    // the bridge + picnic island off the south shore
    ctx.fillStyle = '#c8b98e';
    const BRIDGE = bridgeLayout(this.bx, this.by);
    ctx.fillRect(tx(BRIDGE.ISLE.x1), ty(BRIDGE.ISLE.z1), 40 * scale, 40 * scale);
    ctx.fillStyle = '#a9c88b';
    ctx.fillRect(tx(BRIDGE.ISLE.x1 + 2), ty(BRIDGE.ISLE.z1 + 2), 36 * scale, 36 * scale);
    ctx.fillStyle = '#8f97a3';
    ctx.fillRect(tx(BRIDGE.X - 5.5), ty(BRIDGE.Z0), 11 * scale, 42 * scale);

    // causeways heading out to the four neighbouring cities
    // (each deck runs from our last dry land out over the strait)
    ctx.fillStyle = '#a9b0ba';
    const S = causewaySpan(this.bx, this.by, 's'), E = causewaySpan(this.bx, this.by, 'e');
    const N = causewaySpan(this.bx, this.by - 1, 's'), W = causewaySpan(this.bx - 1, this.by, 'e');
    const far = VIEW; // off the map is fine — the canvas clips it
    ctx.fillRect(tx(S.at - 5.5), ty(S.from), 11 * scale, far * scale);
    ctx.fillRect(tx(E.from), ty(E.at - 5.5), far * scale, 11 * scale);
    ctx.fillRect(tx(N.at - 5.5), ty(N.to - CITY_PITCH - far), 11 * scale, far * scale);
    ctx.fillRect(tx(W.to - CITY_PITCH - far), ty(W.at - 5.5), far * scale, 11 * scale);

    // traffic lights: one dot per real intersection (plazas get an amber
    // one); level crossings get a white ×
    for (const n of graph.nodes) {
      if (n.plaza) {
        ctx.fillStyle = '#f6c952';
        ctx.beginPath();
        ctx.arc(tx(n.x), ty(n.z), 4.5, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = '#fffdf8';
        ctx.lineWidth = 1.5;
        ctx.stroke();
        continue;
      }
      if (!n.signalized) continue;
      const st = lightState(n.x, n.z, elapsed);
      ctx.fillStyle = st === 'ew' ? '#2ecc40' : st === 'ewY' || st === 'nsY' ? '#ffcc00' : '#ff3b30';
      ctx.beginPath();
      ctx.arc(tx(n.x), ty(n.z), 3, 0, Math.PI * 2);
      ctx.fill();
    }

    // level crossings: a small white × on the street
    ctx.strokeStyle = '#fffdf8';
    ctx.lineWidth = 2;
    for (const c of plan.crossings) {
      const x = tx(c.x), y = ty(c.z);
      ctx.beginPath();
      ctx.moveTo(x - 4, y - 4); ctx.lineTo(x + 4, y + 4);
      ctx.moveTo(x - 4, y + 4); ctx.lineTo(x + 4, y - 4);
      ctx.stroke();
    }

    // objectives: fires orange, cats pink, patients blue
    for (const o of this.missions.objectives) {
      ctx.fillStyle = o.type === 'fire' ? '#f4661f' : o.type === 'patient' ? '#4a90d9' : '#f06292';
      ctx.strokeStyle = '#fffdf8';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.arc(tx(o.pos.x), ty(o.pos.z), 5, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
    }

    // getaway cars, course gates
    // (bigger than the light dots, ringed dark and white so they stand out)
    for (const gl of this.goals()) {
      ctx.beginPath();
      ctx.arc(tx(gl.x), ty(gl.z), 7, 0, Math.PI * 2);
      ctx.fillStyle = '#2d3142';
      ctx.fill();
      ctx.beginPath();
      ctx.arc(tx(gl.x), ty(gl.z), 5.2, 0, Math.PI * 2);
      ctx.fillStyle = gl.color;
      ctx.strokeStyle = '#fffdf8';
      ctx.lineWidth = 1.5;
      ctx.fill();
      ctx.stroke();
    }

    // boats: white dots out on the water
    for (const b of this.seaBoats()) {
      ctx.fillStyle = '#fffdf8';
      ctx.strokeStyle = '#4a7d94';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.arc(tx(b.x), ty(b.z), 3.2, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
    }

    // player arrow
    ctx.save();
    ctx.translate(tx(px), ty(pz));
    ctx.rotate(heading);
    ctx.fillStyle = '#e25c5c';
    ctx.strokeStyle = '#fffdf8';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(0, -9);
    ctx.lineTo(6.5, 7);
    ctx.lineTo(0, 3.5);
    ctx.lineTo(-6.5, 7);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    ctx.restore();
  }
}

