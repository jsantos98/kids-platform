// CC0 Kenney city kit bake definitions, shared by the game boot and the
// dev/roads.ts debug page. Models are baked per-face into chunk vertex-color
// meshes; any failed bake leaves its name unset and the world falls back to
// the procedural pastel generator.
import { type BakeDef } from '../../engine/assets.js';

export const KIT = '/assets/kenney/city';
export const TRAINKIT = '/assets/kenney/train';
/** the complete City Kit Roads (2.1) — roads, lights, traffic lights */
export const ROADKIT = '/assets/kenney/city-roads';

const road = (name: string): BakeDef => [`${ROADKIT}/${name}.glb`, `${ROADKIT}/Textures/colormap.png`];

export const KITDEFS: Record<string, BakeDef> = {};
for (const b of 'abcdefghijklmn') KITDEFS['bldg-' + b] = [`${KIT}/building-${b}.glb`, `${KIT}/cmap-commercial.png`];
for (const n of ['road-straight', 'road-crossroad', 'road-intersection', 'road-bend', 'road-end', 'road-roundabout', 'light-curved', 'traffic-light']) {
  KITDEFS[n] = road(n);
}
Object.assign(KITDEFS, {
  'tree-default': [`${KIT}/nature/tree_default.glb`, null],
  'tree-oak': [`${KIT}/nature/tree_oak.glb`, null],
  'tree-detailed': [`${KIT}/nature/tree_detailed.glb`, null],
  'tree-fat': [`${KIT}/nature/tree_fat.glb`, null],
  'tree-thin': [`${KIT}/nature/tree_thin.glb`, null],
  'tree-small': [`${KIT}/nature/tree_small.glb`, null],
  'pine-a': [`${KIT}/nature/tree_pineRoundA.glb`, null],
  'pine-b': [`${KIT}/nature/tree_pineRoundB.glb`, null],
  'pine-c': [`${KIT}/nature/tree_pineRoundC.glb`, null],
  'cactus-short': [`${KIT}/nature/cactus_short.glb`, null],
  'cactus-tall': [`${KIT}/nature/cactus_tall.glb`, null],
  'rock-a': [`${KIT}/nature/stone_largeA.glb`, null],
  'rock-b': [`${KIT}/nature/stone_largeB.glb`, null],
  'car-sedan': [`${KIT}/car-sedan.glb`, `${KIT}/cmap-cars.png`],
  'car-suv': [`${KIT}/car-suv.glb`, `${KIT}/cmap-cars.png`],
  'car-taxi': [`${KIT}/car-taxi.glb`, `${KIT}/cmap-cars.png`],
  'car-hatch': [`${KIT}/car-hatchback-sports.glb`, `${KIT}/cmap-cars.png`],
  'rail-straight': [`${TRAINKIT}/railroad-straight.glb`, `${TRAINKIT}/Textures/colormap.png`],
});

// cube pets + mini-character pedestrians
const PETKIT = '/assets/kenney/pets';
const PEDKIT = '/assets/kenney/mini-chars';
for (const [n, f] of [
  ['pet-dog', 'animal-dog'], ['pet-cat', 'animal-cat'], ['pet-bunny', 'animal-bunny'],
  ['pet-chick', 'animal-chick'], ['pet-pig', 'animal-pig'], ['pet-fox', 'animal-fox'],
  ['pet-panda', 'animal-panda'], ['pet-penguin', 'animal-penguin'],
] as const) KITDEFS[n] = [`${PETKIT}/${f}.glb`, `${PETKIT}/Textures/colormap.png`];
for (const s of 'abcdef') {
  KITDEFS[`ped-m${s}`] = [`${PEDKIT}/character-male-${s}.glb`, `${PEDKIT}/Textures/colormap.png`];
  KITDEFS[`ped-f${s}`] = [`${PEDKIT}/character-female-${s}.glb`, `${PEDKIT}/Textures/colormap.png`];
}

// City Kit Industrial: works buildings + yard dressing
const INDUSKIT = '/assets/kenney/industrial';
const ind = (f: string): BakeDef => [`${INDUSKIT}/${f}.glb`, `${INDUSKIT}/Textures/colormap.png`];
for (const b of 'abcdefghijklmnopqrst') KITDEFS[`ind-${b}`] = ind(`building-${b}`);
Object.assign(KITDEFS, {
  'ind-chimney': ind('chimney-basic'),
  'ind-chimney-m': ind('chimney-medium'),
  'ind-chimney-l': ind('chimney-large'),
  'ind-tank': ind('detail-tank'),
  'ind-tank-l': ind('detail-tank-large'),
  'ind-box-a': ind('shipping-container-a'),
  'ind-box-b': ind('shipping-container-b'),
  'ind-box-c': ind('shipping-container-c'),
  'ind-tower': ind('water-tower'),
  'ind-mill': ind('windmill'),
});

// City Kit Suburban (houses + garden dressing), Mini Forest and Survival Kit
// (garden, courtyard and works-yard props) — the block filler's lots (R33)
const SUBKIT = '/assets/kenney/suburban';
const FORKIT = '/assets/kenney/forest';
const SURVKIT = '/assets/kenney/survival';
const sub = (f: string): BakeDef => [`${SUBKIT}/${f}.glb`, `${SUBKIT}/Textures/colormap.png`];
const forest = (f: string): BakeDef => [`${FORKIT}/${f}.glb`, `${FORKIT}/Textures/colormap.png`];
const surv = (f: string): BakeDef => [`${SURVKIT}/${f}.glb`, `${SURVKIT}/Textures/colormap.png`];
for (const b of 'abcdefghijklmnopqrstu') KITDEFS[`house-${b}`] = sub(`building-type-${b}`);
for (const f of ['tree-large', 'tree-small', 'planter', 'fence-1x3', 'fence-1x4', 'fence', 'driveway-short', 'path-long']) KITDEFS[`sub-${f}`] = sub(f);
for (const f of ['tree', 'tree-high', 'rocks-low', 'stones', 'tent', 'plant', 'fence', 'flag']) KITDEFS[`for-${f}`] = forest(f);
for (const f of ['barrel', 'barrel-open', 'box', 'box-large', 'box-large-open', 'chest', 'workbench', 'workbench-anvil',
  'resource-planks', 'resource-wood', 'resource-stone-large', 'bucket', 'signpost', 'tree-autumn', 'tree-tall',
  'tree-log', 'rock-a', 'tent-canvas', 'campfire-pit']) KITDEFS[`sv-${f}`] = surv(f);

// race islands (R32): the Racing Kit's track tiles (the Starter-Kit-Racing
// set) and its forest / tent tiles in the infield, Toy Car Kit trees on the
// apron (the karts are Toy Car Kit racers, spawned as vehicles)
const TOYKIT = '/assets/kenney/toycar';
const RACEKIT = '/assets/kenney/racing';
const toy = (f: string): BakeDef => [`${TOYKIT}/${f}.glb`, `${TOYKIT}/Textures/colormap.png`];
const rk = (f: string): BakeDef => [`${RACEKIT}/${f}.glb`, `${RACEKIT}/Textures/colormap.png`];
Object.assign(KITDEFS, {
  'rk-straight': rk('track-straight'),
  'rk-corner': rk('track-corner'),
  'rk-finish': rk('track-finish'),
  'rk-tents': rk('decoration-tents'),
  'rk-forest': rk('decoration-forest'),
  'tc-tree': toy('tree'),
  'tc-pine': toy('tree-pine'),
});
