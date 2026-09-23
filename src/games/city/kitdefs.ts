// CC0 Kenney city kit bake definitions, shared by the game boot and the
// dev/roads.ts debug page. Models are baked per-face into chunk vertex-color
// meshes; any failed bake leaves its name unset and the world falls back to
// the procedural pastel generator.
import { type BakeDef } from '../../engine/assets.js';

export const KIT = '/assets/kenney/city';
export const TRAINKIT = '/assets/kenney/train';

export const KITDEFS: Record<string, BakeDef> = {};
for (const b of 'abcdefghijklmn') KITDEFS['bldg-' + b] = [`${KIT}/building-${b}.glb`, `${KIT}/cmap-commercial.png`];
Object.assign(KITDEFS, {
  'road-straight': [`${KIT}/road-straight.glb`, `${KIT}/cmap-roads.png`],
  'road-crossroad': [`${KIT}/road-crossroad.glb`, `${KIT}/cmap-roads.png`],
  'road-crossing': [`${KIT}/road-crossing.glb`, `${KIT}/cmap-roads.png`],
  'road-intersection': [`${KIT}/road-intersection.glb`, `${KIT}/cmap-roads.png`],
  'road-curve': [`${KIT}/road-curve.glb`, `${KIT}/cmap-roads.png`],
  'road-end': [`${KIT}/road-end.glb`, `${KIT}/cmap-roads.png`],
  'road-side-entry': [`${KIT}/road-side-entry.glb`, `${KIT}/cmap-roads.png`],
  'road-side-exit': [`${KIT}/road-side-exit.glb`, `${KIT}/cmap-roads.png`],
  'light-curved': [`${KIT}/light-curved.glb`, `${KIT}/cmap-roads.png`],
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
