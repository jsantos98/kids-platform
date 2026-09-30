// Traffic flow check — the executable half of G5's busy streets: an island's
// whole fleet and crowd (island/cars.ts + island/walkers.ts, at full density)
// run for 180 s of game time at 20 fps with each seeing the other, as the
// island sim steps them, and the check fails if any car or walker stands
// still for 60 s (a gridlock: two cars on one curve, a car waiting on a
// walker waiting on it, a walker frozen at a kerb) or two cars sit inside
// each other. With --robbers three getaway cars drive among them (G7) —
// fleeing from a police car that keeps after them half the time, dashing off
// now and then — and it fails if a getaway car ever drives through a car
// (one inside the other, deeper than a graze, for over half a second).
// The timetable trains run too (--no-rail leaves them out), so the cars and
// walkers meet the level crossings' warnings as they do in the game — run
// without them, the check never saw a crossing gridlock the streets round
// it; --island=bx,by picks the island(s) (default 1,0 and 2,2; repeat the
// flag for more). With --kid the kid's train drives the island's north-south
// line among them (full gas, stopping at each station with its doors open
// 10 s) and it fails if anybody is on a level crossing as the train's nose
// reaches it (R13).
// Run: npx tsx tools/check-traffic.ts [baseSeed] [--robbers] [--kid] [--no-rail] [--island=bx,by]
import * as THREE from 'three';
import { setCityBase, CITY_PITCH } from '../src/worlds/cityGrid.js';
import { IslandCars } from '../src/games/city/island/cars.js';
import { IslandWalkers } from '../src/games/city/island/walkers.js';
import { Robber } from '../src/games/city/robber.js';
import { overlapDepth } from '../src/games/city/island/obb.js';
import { Railway } from '../src/games/city/railway.js';
import { cityPlanFor } from '../src/worlds/cityPlan.js';

const base = Number(process.argv.slice(2).find(a => !a.startsWith('--')) ?? 7) | 0;
const withRobbers = process.argv.includes('--robbers');
const withKid = process.argv.includes('--kid');
const railway = process.argv.includes('--no-rail') ? null : new Railway(new THREE.Scene());
const picked = process.argv.filter(a => a.startsWith('--island=')).map(a => a.slice(9).split(',').map(Number) as [number, number]);
const ISLANDS: Array<readonly [number, number]> = picked.length ? picked : [[1, 0], [2, 2]];
setCityBase(base);
const DT = 0.05, STEPS = 3600, STILL = 60;
/** a getaway car's body touching a car's (m), and for how long one may stay
 * inside the other (s) — longer is driving through it (G7); a turning car's
 * corner grazing a waiting getaway car for a frame is contact, not that */
const GRAZE = 0.6, THROUGH = 0.5;
let fails = 0;

for (const [bx, by] of ISLANDS) {
  const t0 = performance.now();
  const ox = bx * CITY_PITCH, oz = by * CITY_PITCH;
  const scene = new THREE.Scene();
  const cars = new IslandCars(scene, bx, by, ox, oz);
  const walkers = new IslandWalkers(scene, bx, by, ox, oz, [], []);
  const cPos = cars.cars.map(c => [c.x, c.z]), cMove = cars.cars.map(() => 0);
  const wPos = walkers.walkers.map(w => [w.x, w.z]), wMove = walkers.walkers.map(() => 0);
  let t = 0, stillCar = 0, stillWalker = 0, overlaps = 0, samples = 0;
  // the getaway cars, and where the police are for each (near half the time)
  const robbers = withRobbers ? [0, 1, 2].map(() => new Robber(scene)) : [];
  robbers.forEach((r, i) => r.spawn(bx, by, ox, oz, ox + 700, oz + 700, base * 31 + i * 7, robbers.slice(0, i).map(o => ({ x: o.x, z: o.z })), cars.cars));
  let robberHits = 0, robberFrames = 0, robberDeepest = 0, robberLongest = 0;
  /** frames each getaway car / car pair has been one inside the other */
  const inside = new Map<number, number>();
  const robberMoved = robbers.map(() => 0), robberPos = robbers.map(r => [r.x, r.z]);
  let robberStill = 0;
  // the kid's train (--kid): on the north-south line, 150 m in from the rim
  const rail = railway;
  const kidCross = withKid && rail ? cityPlanFor(bx, by).crossings.filter(c => c.line === 0).map(c => ({ x: c.x + ox, z: c.z + oz, near: false })) : [];
  let kidHits = 0, kidPasses = 0, kidDoorsT = -1, kidDone: { x: number; z: number } | null = null, kidMoved = 0, kidStill = 0;
  if (withKid && rail) {
    rail.addPlayer(bx, by, 150);
    rail.obstacleAt = (x, z, r) => cars.cars.some(c => Math.hypot(c.x - x, c.z - z) < r) || walkers.walkers.some(w => Math.hypot(w.x - x, w.z - z) < r);
  }
  for (let k = 0; k < STEPS; k++) {
    t += DT;
    const chasers = robbers.map(r => r.chaser()!).filter(Boolean);
    cars.update(DT, t, railway, null, false, walkers.walkers, null, chasers);
    robbers.forEach((r, i) => {
      // (the police 30 m behind it in odd 20 s spells — it flees, the traffic
      // makes way — and far off otherwise; a dash every 25 s)
      const chase = Math.floor(t / 20 + i) % 2 === 1, h = r.group.rotation.y;
      const px = chase ? r.x - Math.sin(h) * 30 : ox + 2000, pz = chase ? r.z - Math.cos(h) * 30 : oz + 2000;
      if (Math.floor((t - DT) / 25) !== Math.floor(t / 25)) r.startle();
      const near = cars.cars.filter(c => Math.abs(c.x - r.x) < 40 && Math.abs(c.z - r.z) < 40).map(c => ({ id: c.id, x: c.x, z: c.z, h: c.h, len: c.len, dodge: c.dodge, v: c.v, turning: !!c.round }));
      r.update(DT, t, px, pz, false, near, walkers.walkers.filter(w => Math.abs(w.x - r.x) < 20 && Math.abs(w.z - r.z) < 20), railway);
      // a getaway car inside a car's footprint (turned boxes, 0.2 m grace)
      const fx = Math.sin(h), fz = Math.cos(h);
      robberFrames++;
      for (const c of near) {
        const dx = c.x - r.x, dz = c.z - r.z;
        const a = dx * fx + dz * fz, l = dx * fz - dz * fx;
        // (how deep one is in the other: turned boxes, separating axes)
        const depth = overlapDepth({ x: r.x, z: r.z, h, hl: 2.2, hw: 1.0 }, { x: c.x, z: c.z, h: c.h, hl: c.len / 2, hw: 1.0 });
        if (depth > 0) robberDeepest = Math.max(robberDeepest, depth);
        const pair = i * 100000 + c.id;
        if (depth > GRAZE) {
          robberHits++;
          const n = (inside.get(pair) ?? 0) + 1;
          inside.set(pair, n);
          robberLongest = Math.max(robberLongest, n * DT);
          if (process.env.TRACE && n * DT >= 0.45) console.log(`    TRACE t=${t.toFixed(2)} robber ${i} car ${c.id} depth ${depth.toFixed(2)} a=${a.toFixed(1)} l=${l.toFixed(1)} rv=${(r as unknown as { v: number }).v.toFixed(1)} cv=${cars.cars.find(q => q.id === c.id)!.v.toFixed(1)} turning=${c.turning} dodge=${c.dodge.toFixed(1)} len=${c.len}`);
        } else inside.delete(pair);
      }
      if (Math.hypot(r.x - robberPos[i][0], r.z - robberPos[i][1]) > 0.5) { robberPos[i] = [r.x, r.z]; robberMoved[i] = t; }
      robberStill = Math.max(robberStill, t - robberMoved[i]);
    });
    walkers.update(DT, t, railway, null, null, false, cars.cars);
    if (withKid && rail) {
      // the kid, simply: full gas, brake for the next station, doors 10 s
      const pose = rail.playerPose()!;
      let stn = rail.nextStation(0);
      if (stn && kidDone && Math.hypot(stn.x - kidDone.x, stn.z - kidDone.z) < 1) stn = rail.nextStation(1);
      let gas = 1, brake = 0;
      if (kidDoorsT >= 0) {
        gas = 0; brake = 1;
        if (t - kidDoorsT > 10) { rail.setKidDoors(false); kidDone = stn ? { x: stn.x, z: stn.z } : null; kidDoorsT = -1; }
      } else if (stn && stn.at && pose.v < 0.5) {
        rail.setKidDoors(true); kidDoorsT = t; gas = 0; brake = 1;
      } else if (stn && stn.gap > -5 && pose.v * pose.v / (2 * 5) > stn.gap + 2) { gas = 0; brake = 1; }
      rail.setControls(gas, brake);
      rail.update(DT, t, pose.x, pose.z);
      // the nose reaching a crossing: nobody on it
      const p2 = rail.playerPose()!;
      const nx = p2.x + Math.sin(p2.h) * rail.kidNose(), nz = p2.z + Math.cos(p2.h) * rail.kidNose();
      for (const c of kidCross) {
        const near = Math.hypot(nx - c.x, nz - c.z) < 3;
        if (near && !c.near) {
          kidPasses++;
          const who = cars.cars.filter(o => Math.hypot(o.x - c.x, o.z - c.z) < 5).length + walkers.walkers.filter(w => Math.hypot(w.x - c.x, w.z - c.z) < 5).length;
          if (who) { kidHits++; if (process.env.TRACE) console.log(`    TRACE t=${t.toFixed(1)} ${who} on the crossing at ${c.x.toFixed(0)},${c.z.toFixed(0)} as the train came`); }
        }
        c.near = near;
      }
      if (p2.v > 0.3 || kidDoorsT >= 0) kidMoved = t;
      kidStill = Math.max(kidStill, t - kidMoved);
    }
    cars.cars.forEach((c, i) => {
      if (Math.hypot(c.x - cPos[i][0], c.z - cPos[i][1]) > 0.5) { cPos[i] = [c.x, c.z]; cMove[i] = t; }
      stillCar = Math.max(stillCar, t - cMove[i]);
    });
    walkers.walkers.forEach((w, i) => {
      if (Math.hypot(w.x - wPos[i][0], w.z - wPos[i][1]) > 0.3) { wPos[i] = [w.x, w.z]; wMove[i] = t; }
      stillWalker = Math.max(stillWalker, t - wMove[i]);
    });
    if (k % 20 === 0) {
      samples++;
      const cs = cars.cars;
      for (let i = 0; i < cs.length; i++) for (let j = i + 1; j < cs.length; j++) {
        if ((cs[i].x - cs[j].x) ** 2 + (cs[i].z - cs[j].z) ** 2 < 1.5 * 1.5) overlaps++;
      }
    }
  }
  // (cars meeting on a junction's curves pass close; 1.5 m apart is one car in another)
  const robberBad = withRobbers && (robberLongest > THROUGH || robberStill >= STILL);
  const kidBad = withKid && (kidHits > 0 || kidStill >= STILL);
  const bad = stillCar >= STILL || stillWalker >= STILL || overlaps / samples > 0.5 || robberBad || kidBad;
  if (bad) fails++;
  if (withKid) console.log(`  the kid's train: ${kidPasses} crossings passed, somebody on it ${kidHits} times; longest held ${kidStill.toFixed(0)} s`);
  if (withRobbers) console.log(`  getaway cars: grazing a car (deeper than ${GRAZE} m) in ${robberHits} of ${robberFrames} frames, deepest ${robberDeepest.toFixed(2)} m, longest ${robberLongest.toFixed(2)} s (through a car: over ${THROUGH} s); longest standing still ${robberStill.toFixed(0)} s`);
  console.log(`${bad ? 'FAIL' : 'PASS'} island ${bx},${by}: ${cars.cars.length} cars, ${walkers.walkers.length} walkers; longest standing still: a car ${stillCar.toFixed(0)} s, a walker ${stillWalker.toFixed(0)} s; cars inside each other ${(overlaps / samples).toFixed(2)} per sample (${((performance.now() - t0) / 1000).toFixed(1)} s)`);
}
console.log(fails ? `FAIL — ${fails} island(s) jammed (G5)` : 'PASS — the traffic flows (G5)');
process.exit(fails ? 1 : 0);
