// Minimap: a small north-up map in the corner showing the road grid, fires,
// cats, traffic-light state and the player's heading. Drawn on a 2D canvas.
import { lightState } from './lights.js';
import { RoadGrid } from '../../worlds/roadGrid.js';
import { biomeAt, biomeMapColor, BIOME_CELL } from '../../worlds/biomes.js';
import { racePath } from '../../worlds/racetrack.js';
import type { Missions, Objective } from './missions.js';

const SIZE = 256;         // canvas backing-store pixels
const RANGE = 180;        // world metres shown across (radius*2 window)

export class Minimap {
  private ctx: CanvasRenderingContext2D;

  constructor(canvas: HTMLCanvasElement, private missions: Missions, private grid: RoadGrid,
              private CH = 64, private seed = 0) {
    canvas.width = SIZE;
    canvas.height = SIZE;
    this.ctx = canvas.getContext('2d')!;
  }

  update(px: number, pz: number, heading: number, elapsed: number): void {
    const ctx = this.ctx;
    const s = SIZE;
    const scale = s / (RANGE * 2);
    const tx = (x: number) => s / 2 + (x - px) * scale;
    const ty = (z: number) => s / 2 + (pz - z) * scale; // world +Z points up

    // ground tinted by biome (forest green, desert sand, city cream)
    const cellW = BIOME_CELL * this.CH;
    const c0 = Math.floor((px - RANGE) / cellW);
    const c1 = Math.ceil((px + RANGE) / cellW);
    const d0 = Math.floor((pz - RANGE) / cellW);
    const d1 = Math.ceil((pz + RANGE) / cellW);
    for (let a = c0; a <= c1; a++) {
      for (let b = d0; b <= d1; b++) {
        ctx.fillStyle = biomeMapColor(biomeAt(a * BIOME_CELL, b * BIOME_CELL, this.seed));
        const x0 = Math.max(0, tx(a * cellW));
        const y0 = Math.max(0, ty((b + 1) * cellW));
        const x1 = Math.min(s, tx((a + 1) * cellW));
        const y1 = Math.min(s, ty(b * cellW));
        ctx.fillRect(x0, y0, x1 - x0, y1 - y0);
      }
    }

    // roads: the surviving grid lines (rails drawn tan, missing lines skipped)
    const k0 = Math.floor((px - RANGE) / this.CH);
    const k1 = Math.ceil((px + RANGE) / this.CH);
    const j0 = Math.floor((pz - RANGE) / this.CH);
    const j1 = Math.ceil((pz + RANGE) / this.CH);
    ctx.lineWidth = 10 * scale;
    ctx.beginPath();
    ctx.strokeStyle = '#8f97a3';
    for (let k = k0; k <= k1; k++) {
      if (!this.grid.hasX(k)) continue;
      const x = tx(k * this.CH);
      ctx.moveTo(x, 0); ctx.lineTo(x, s);
    }
    for (let j = j0; j <= j1; j++) {
      if (!this.grid.hasZ(j)) continue;
      const y = ty(j * this.CH);
      ctx.moveTo(0, y); ctx.lineTo(s, y);
    }
    ctx.stroke();
    ctx.strokeStyle = '#cbb894';
    ctx.beginPath();
    for (let k = k0; k <= k1; k++) {
      if (!RoadGrid.isRail(k)) continue;
      const x = tx(k * this.CH);
      ctx.moveTo(x, 0); ctx.lineTo(x, s);
    }
    for (let j = j0; j <= j1; j++) {
      if (!RoadGrid.isRail(j)) continue;
      const y = ty(j * this.CH);
      ctx.moveTo(0, y); ctx.lineTo(s, y);
    }
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

    // traffic lights: one dot per real intersection in view
    for (let k = k0; k <= k1; k++) {
      for (let j2 = j0; j2 <= j1; j2++) {
        if (!this.grid.cross(k, j2)) continue;
        const st = lightState(k, j2, elapsed);
        ctx.fillStyle = st === 'ew' ? '#2ecc40' : st === 'ewY' || st === 'nsY' ? '#ffcc00' : '#ff3b30';
        ctx.beginPath();
        ctx.arc(tx(k * this.CH), ty(j2 * this.CH), 3, 0, Math.PI * 2);
        ctx.fill();
      }
    }

    // objectives: fires orange, cats pink, patients blue — clamped to the edge
    for (const o of this.missions.objectives) {
      let x = tx(o.pos.x), y = ty(o.pos.z);
      const m = 10;
      const cx = Math.max(m, Math.min(s - m, x));
      const cy = Math.max(m, Math.min(s - m, y));
      ctx.fillStyle = o.type === 'fire' ? '#f4661f' : o.type === 'patient' ? '#4a90d9' : '#f06292';
      ctx.strokeStyle = '#fffdf8';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.arc(cx, cy, 5.5, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
    }

    // player: white ring + heading arrow at the centre
    ctx.save();
    ctx.translate(s / 2, s / 2);
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
