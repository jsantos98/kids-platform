// Minimap: the whole island at a glance — chunk biomes, roads, the race
// circuit, traffic-light state, missions and the player arrow. Drawn on a 2D
// canvas, fixed on the island centre so north stays up.
import { lightState } from './lights.js';
import { RoadGrid } from '../../worlds/roadGrid.js';
import { chunkGroundColor } from '../../worlds/cityChunk.js';
import { racePath } from '../../worlds/racetrack.js';
import { railRouteFor } from '../../worlds/railRoute.js';
import { riverFor } from '../../worlds/riverRoute.js';
import { cityPlanFor } from '../../worlds/cityPlan.js';
import { WORLD_CHUNKS, ISLAND, CENTER } from '../../worlds/world.js';
import { BRIDGE } from './bridge.js';
import type { Missions } from './missions.js';

const hex = (n: number) => '#' + n.toString(16).padStart(6, '0');

const SIZE = 256;        // canvas backing-store pixels
const VIEW = ISLAND + 170; // world metres across (island + sea + bridge island)

export class Minimap {
  private ctx: CanvasRenderingContext2D;

  constructor(canvas: HTMLCanvasElement, private missions: Missions, private grid: RoadGrid, private CH: number, private seed: number,
              private seaBoats: () => Array<{ x: number; z: number }> = () => []) {
    canvas.width = SIZE;
    canvas.height = SIZE;
    this.ctx = canvas.getContext('2d')!;
  }

  update(playerX: number, playerZ: number, heading: number, elapsed: number): void {
    const ctx = this.ctx;
    const s = SIZE;
    const scale = s / VIEW;
    const tx = (x: number) => (x - (CENTER - VIEW / 2)) * scale;
    const ty = (z: number) => (z - (CENTER - VIEW / 2)) * scale;

    // the island, district-tinted per chunk, on the sea
    ctx.fillStyle = '#72c3de';
    ctx.fillRect(0, 0, s, s);
    for (let cx = 0; cx < WORLD_CHUNKS; cx++) {
      for (let cz = 0; cz < WORLD_CHUNKS; cz++) {
        ctx.fillStyle = hex(chunkGroundColor(this.seed, cx, cz));
        ctx.fillRect(tx(cx * this.CH), ty(cz * this.CH), this.CH * scale, this.CH * scale);
      }
    }

    // streets: only the segments the plan kept open
    const plan = cityPlanFor(this.seed);
    ctx.strokeStyle = '#8f97a3';
    ctx.lineWidth = 12 * scale;
    ctx.beginPath();
    for (let j = 0; j <= 5; j++) for (let i = 0; i <= 5; i++) {
      if (plan.segH(j, i)) {
        ctx.moveTo(tx(i * this.CH), ty(j * this.CH));
        ctx.lineTo(tx((i + 1) * this.CH), ty(j * this.CH));
      }
      if (plan.segV(i, j)) {
        ctx.moveTo(tx(i * this.CH), ty(j * this.CH));
        ctx.lineTo(tx(i * this.CH), ty((j + 1) * this.CH));
      }
    }
    ctx.stroke();

    // the river, ribbon-width
    const river = riverFor(this.seed);
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

    // the railway: the seeded procedural loop
    ctx.strokeStyle = '#7a6248';
    ctx.lineWidth = 3.4 * scale;
    ctx.beginPath();
    routePts(this.seed).forEach((p, k) => {
      const x = tx(p.x), y = ty(p.z);
      if (k === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    });
    ctx.closePath();
    ctx.stroke();

    // the downtown tram loop + its stops
    if (plan.tram) {
      ctx.strokeStyle = '#e8b23c';
      ctx.lineWidth = 2;
      ctx.setLineDash([5, 3]);
      ctx.beginPath();
      plan.tram.pts.forEach((p, k) => {
        const x = tx(p.x), y = ty(p.z);
        if (k === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
      });
      ctx.closePath();
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle = '#e8b23c';
      for (const st of plan.tram.stops) {
        ctx.fillRect(tx(st.x) - 2.5, ty(st.z) - 2.5, 5, 5);
      }
    }

    // train stations: blue platforms
    ctx.fillStyle = '#4a90d9';
    for (const st of plan.stations) {
      ctx.fillRect(tx(st.x) - 3, ty(st.z) - 3, 6, 6);
    }

    // the bridge + picnic island off the south shore
    ctx.fillStyle = '#c8b98e';
    ctx.fillRect(tx(BRIDGE.ISLE.x1), ty(BRIDGE.ISLE.z1), 40 * scale, 40 * scale);
    ctx.fillStyle = '#a9c88b';
    ctx.fillRect(tx(BRIDGE.ISLE.x1 + 2), ty(BRIDGE.ISLE.z1 + 2), 36 * scale, 36 * scale);
    ctx.fillStyle = '#8f97a3';
    ctx.fillRect(tx(BRIDGE.X - 5.5), ty(BRIDGE.Z0), 11 * scale, 42 * scale);

    // race circuit outline (world-fixed)
    ctx.strokeStyle = '#5a6474';
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    racePath().forEach((p, i) => {
      const x = tx(p.x), y = ty(p.z);
      if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    });
    ctx.closePath();
    ctx.stroke();

    // traffic lights: one dot per real intersection (roundabouts get a ring,
    // plazas an amber one); level crossings get a white ×
    for (let i = 1; i < WORLD_CHUNKS; i++) {
      for (let j = 1; j < WORLD_CHUNKS; j++) {
        if (plan.roundabout(i, j)) {
          ctx.fillStyle = '#a4cf85';
          ctx.beginPath();
          ctx.arc(tx(i * this.CH), ty(j * this.CH), 4, 0, Math.PI * 2);
          ctx.fill();
          ctx.strokeStyle = '#fffdf8';
          ctx.lineWidth = 1.5;
          ctx.stroke();
          continue;
        }
        if (plan.plaza(i, j)) {
          ctx.fillStyle = '#f6c952';
          ctx.beginPath();
          ctx.arc(tx(i * this.CH), ty(j * this.CH), 4.5, 0, Math.PI * 2);
          ctx.fill();
          ctx.strokeStyle = '#fffdf8';
          ctx.lineWidth = 1.5;
          ctx.stroke();
          continue;
        }
        if (!this.grid.cross(i, j)) continue;
        const st = lightState(i, j, elapsed);
        ctx.fillStyle = st === 'ew' ? '#2ecc40' : st === 'ewY' || st === 'nsY' ? '#ffcc00' : '#ff3b30';
        ctx.beginPath();
        ctx.arc(tx(i * this.CH), ty(j * this.CH), 3, 0, Math.PI * 2);
        ctx.fill();
      }
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
    ctx.translate(tx(playerX), ty(playerZ));
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

// per-chunk ground colour for the minimap (slab colour per island biome)
function routePts(seed: number): Array<{ x: number; z: number }> {
  const pts = railRouteFor(seed).pts;
  return pts.filter((_, k) => k % 3 === 0);
}
