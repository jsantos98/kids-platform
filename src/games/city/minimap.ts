// Minimap: a small north-up map in the corner showing the road grid, fires,
// cats, traffic-light state and the player's heading. Drawn on a 2D canvas.
import { lightState } from './lights.js';
import type { Missions, Objective } from './missions.js';

const SIZE = 256;         // canvas backing-store pixels
const RANGE = 180;        // world metres shown across (radius*2 window)

export class Minimap {
  private ctx: CanvasRenderingContext2D;

  constructor(canvas: HTMLCanvasElement, private missions: Missions, private CH = 64) {
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

    // ground
    ctx.fillStyle = '#e9e1cf';
    ctx.fillRect(0, 0, s, s);

    // roads: the chunk grid lines, one 10 m road per line
    const k0 = Math.floor((px - RANGE) / this.CH);
    const k1 = Math.ceil((px + RANGE) / this.CH);
    const j0 = Math.floor((pz - RANGE) / this.CH);
    const j1 = Math.ceil((pz + RANGE) / this.CH);
    ctx.strokeStyle = '#8f97a3';
    ctx.lineWidth = 10 * scale;
    ctx.beginPath();
    for (let k = k0; k <= k1; k++) {
      const x = tx(k * this.CH);
      ctx.moveTo(x, 0); ctx.lineTo(x, s);
    }
    for (let j = j0; j <= j1; j++) {
      const y = ty(j * this.CH);
      ctx.moveTo(0, y); ctx.lineTo(s, y);
    }
    ctx.stroke();

    // traffic lights: one dot per intersection in view
    for (let k = k0; k <= k1; k++) {
      for (let j2 = j0; j2 <= j1; j2++) {
        const st = lightState(k, j2, elapsed);
        ctx.fillStyle = st === 'ew' ? '#2ecc40' : st === 'ewY' || st === 'nsY' ? '#ffcc00' : '#ff3b30';
        ctx.beginPath();
        ctx.arc(tx(k * this.CH), ty(j2 * this.CH), 3, 0, Math.PI * 2);
        ctx.fill();
      }
    }

    // objectives: fires orange, cats pink — clamped to the map edge if far away
    for (const o of this.missions.objectives) {
      let x = tx(o.pos.x), y = ty(o.pos.z);
      const m = 10;
      const cx = Math.max(m, Math.min(s - m, x));
      const cy = Math.max(m, Math.min(s - m, y));
      ctx.fillStyle = o.type === 'fire' ? '#f4661f' : '#f06292';
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
