// Minimap: the whole island at a glance — chunk biomes, roads, the race
// circuit, traffic-light state, missions and the player arrow. Drawn on a 2D
// canvas, fixed on the island centre so north stays up.
import { lightState } from './lights.js';
import { RoadGrid } from '../../worlds/roadGrid.js';
import { chunkGroundColor } from '../../worlds/cityChunk.js';
import { racePath } from '../../worlds/racetrack.js';
import { railRouteFor } from '../../worlds/railRoute.js';
import type { Missions } from './missions.js';

const SIZE = 256;        // canvas backing-store pixels
const VIEW = 440;        // world metres across (whole island + sea margin)
const CENTER = 192;      // island centre (6×6 chunks of 64 m)

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

    // the sea, then the island on top of it
    ctx.fillStyle = '#72c3de';
    ctx.fillRect(0, 0, s, s);
    for (let cx = 0; cx < 6; cx++) {
      for (let cz = 0; cz < 6; cz++) {
        ctx.fillStyle = chunkGroundColorHex(cx, cz, this.seed);
        ctx.fillRect(tx(cx * this.CH), ty(cz * this.CH), this.CH * scale, this.CH * scale);
      }
    }

    // roads: the interior grid lines
    ctx.strokeStyle = '#8f97a3';
    ctx.lineWidth = 10 * scale;
    ctx.beginPath();
    for (let i = 1; i <= 5; i++) {
      const c = i * this.CH;
      const m = tx(c);
      ctx.moveTo(m, ty(0)); ctx.lineTo(m, ty(384));
      ctx.moveTo(tx(0), ty(c)); ctx.lineTo(tx(384), ty(c));
    }
    ctx.stroke();

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

    // traffic lights: one dot per real intersection
    for (let i = 1; i <= 5; i++) {
      for (let j = 1; j <= 5; j++) {
        if (!this.grid.cross(i, j)) continue;
        const st = lightState(i, j, elapsed);
        ctx.fillStyle = st === 'ew' ? '#2ecc40' : st === 'ewY' || st === 'nsY' ? '#ffcc00' : '#ff3b30';
        ctx.beginPath();
        ctx.arc(tx(i * this.CH), ty(j * this.CH), 3, 0, Math.PI * 2);
        ctx.fill();
      }
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

function chunkGroundColorHex(cx: number, cz: number, seed: number): string {
  void seed;
  if (cx >= 4 && cz >= 4) return '#c9ccd6';   // race zone (2×2 apron)
  if (cx <= 1 && cz <= 1) return '#8fba74';   // forest pocket
  if (cx >= 4 && cz <= 1) return '#b5d194';   // meadow pocket
  if (cx <= 1 && cz >= 4) return '#eedaa4';   // desert pocket
  return '#e9e1cf';                           // city
}
