// G1 check: every street collision is a bump — the flash, and back on a
// clear lane, standing, ready to go. With the real physics (player.ts):
//  · a car creeping (1 m/s) into a wall crashes — a slow touch only scraped
//    before, and a car could wedge itself where no gas got it out;
//  · a car driven at the waterline crashes on the land side, never in the sea;
//  · a car driven into one of the island's cars (island/cars.ts) is a bump
//    (touchIsBump), and the resume (breadcrumb.ts) lands clear of every car;
//  · in the grace after a resume a touch only slides: no crash loop.
//   npx tsx tools/check-crash.ts [baseSeed]
import './headless-dom.js';
import * as THREE from 'three';
import { setCityBase, CITY_PITCH } from '../src/worlds/cityGrid.js';
import { coastFor } from '../src/worlds/coast.js';
import { CENTER } from '../src/worlds/world.js';
import { createPlayer, physicsStep, touchIsBump, onGround, VEHICLES, type Player } from '../src/games/city/player.js';
import { IslandCars } from '../src/games/city/island/cars.js';
import { Breadcrumbs } from '../src/games/city/breadcrumb.js';
import type { CollisionBox } from '../src/worlds/cityChunk.js';

const base = Number(process.argv.slice(2).find(a => !a.startsWith('--')) ?? 7) | 0;
setCityBase(base);
let fails = 0;
const fail = (m: string): void => { fails++; console.log('  FAIL ' + m); };
const DT = 1 / 60;
const V = VEHICLES.car;
const bx = 1, by = 0, ox = bx * CITY_PITCH, oz = by * CITY_PITCH;

/** a car standing at world (x, z), past its grace */
const car = (x: number, z: number, h: number): Player => {
  const p = createPlayer(V, x, z, h);
  p.graceT = 0;
  return p;
};
/** step it, holding about `v` m/s; true once it crashed */
const drive = (p: Player, v: number, boxes: CollisionBox[], secs: number, each?: () => boolean): boolean => {
  for (let k = 0; k < secs / DT; k++) {
    const s = physicsStep(p, { gas: p.state.v < v ? 1 : 0, brake: 0, steer: 0 }, DT, boxes);
    if (s.crashed || each?.()) return true;
  }
  return false;
};

// 1. creeping into a wall
{
  const x = ox + CENTER, z = oz + CENTER;
  const wall: CollisionBox = { x1: x - 10, x2: x + 10, z1: z + 6, z2: z + 8 };
  const p = car(x, z, 0);
  if (!drive(p, 1, [wall], 20)) fail('a car creeping at 1 m/s into a wall never crashed (it only scraped)');
  // the same in the grace after a resume: a slide, never a crash
  const q = car(x, z, 0);
  q.graceT = 60;
  if (drive(q, 1, [wall], 20)) fail('a touch in the grace after a resume crashed again');
  if (q.state.z + V.radius > wall.z1 + 0.5) fail('in the grace the car went into the wall');
  console.log('wall: creeping in is a bump; in the grace a scrape');
}

// 2. the waterline: west from the middle, along a row clear of the causeways
{
  const coast = coastFor(bx, by);
  let ok = 0;
  for (const lz of [CENTER - 300, CENTER + 300]) {
    const p = car(ox + CENTER, oz + lz, -Math.PI / 2);
    let wet = false;
    const crashed = drive(p, 8, [], 120, () => {
      if (!onGround(p.state.x, p.state.z)) wet = true;
      return false;
    });
    if (!crashed) fail(`row z=${lz}: driving at the sea never crashed`);
    else if (wet || !coast.inLand(p.state.x - ox, p.state.z - oz, -1)) fail(`row z=${lz}: the crash was in the sea`);
    else ok++;
  }
  console.log(`waterline: ${ok}/2 drives into the sea crashed on the beach`);
}

// 3. into one of the island's cars, and the resume clear of them all
{
  const cars = new IslandCars(new THREE.Scene(), bx, by, ox, oz);
  const crumbs = new Breadcrumbs(V.radius);
  const free = (x: number, z: number): boolean => !cars.bump(x, z, V.radius + 2);
  let tried = 0, bumped = 0, clear = 0;
  for (const c of cars.cars.filter((_, i) => i % 7 === 0).slice(0, 12)) {
    tried++;
    // 12 m behind it, aimed at it, with the car standing still
    const h = c.h, x = c.x - Math.sin(h) * 12, z = c.z - Math.cos(h) * 12;
    const p = car(x, z, h);
    const hit = drive(p, 4, [], 10, () => !!cars.bump(p.state.x, p.state.z, V.radius + 0.3) && touchIsBump(p));
    if (!hit) { fail(`car ${c.x.toFixed(0)},${c.z.toFixed(0)}: driving into it was no bump`); continue; }
    bumped++;
    const r = crumbs.pickResume(p.state.x, p.state.z, p.state.heading, [], { x, z, heading: h }, free);
    if (cars.bump(r.x, r.z, V.radius + 0.3)) fail(`car ${c.x.toFixed(0)},${c.z.toFixed(0)}: the resume landed inside a car`);
    else clear++;
  }
  console.log(`traffic: ${bumped}/${tried} drives into a car were bumps, ${clear} resumed clear of every car`);
}

console.log(fails ? `FAIL — ${fails} problem(s) with the bumps (G1)` : 'PASS — every street collision is a bump, resumed clear (G1)');
process.exit(fails ? 1 : 0);
