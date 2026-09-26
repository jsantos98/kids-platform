// CC0 glTF asset pipeline (Kenney kits).
// - loadGLB/spawnVehicle: textured models cloned per instance (vehicles)
// - prepBakedModels/bakedModel: convert kit models into vertex-colored
//   geometries that merge into chunk meshes (one draw call per chunk).
// Textured kits are sampled per-face from their palette texture (glTF UVs are
// TOP-LEFT origin); untextured kits (Nature) use their material color directly.
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

const gltfCache = new Map<string, Promise<THREE.Group>>();

export function loadGLB(url: string): Promise<THREE.Group> {
  if (!gltfCache.has(url)) {
    gltfCache.set(url, new Promise((resolve, reject) => {
      new GLTFLoader().load(url, gltf => resolve(gltf.scene), undefined, reject);
    }));
  }
  return gltfCache.get(url)!;
}

export interface SpawnOptions {
  /** longest horizontal side of the final model, in metres */
  len?: number;
  /** extra yaw applied to the model inside the wrapper group */
  yaw?: number;
}

/** Fresh clone normalized for the scene: scaled to `len`, lowest point at y=0. */
export async function spawnVehicle(url: string, { len = 4.4, yaw = 0 }: SpawnOptions = {}): Promise<THREE.Group> {
  const src = await loadGLB(url);
  const obj = src.clone(true);
  obj.traverse(o => {
    if ((o as THREE.Mesh).isMesh) { o.castShadow = true; o.receiveShadow = true; }
  });
  const box = new THREE.Box3().setFromObject(obj);
  const size = box.getSize(new THREE.Vector3());
  const s = len / Math.max(size.x, size.z);
  obj.scale.setScalar(s);
  obj.rotation.y = yaw;
  obj.position.y = -box.min.y * s;
  const g = new THREE.Group();
  g.add(obj);
  return g;
}

/** Kenney vehicles name their wheels "wheel-front-right" etc. */
export function wheelNodes(root: THREE.Object3D): THREE.Object3D[] {
  const out: THREE.Object3D[] = [];
  root.traverse(o => { if (/wheel/i.test(o.name)) out.push(o); });
  return out;
}

// ---- palette-texture baking ----
const imgCache = new Map<string, Promise<HTMLImageElement>>();
function loadPalette(url: string): Promise<HTMLImageElement> {
  if (!imgCache.has(url)) {
    imgCache.set(url, new Promise((resolve, reject) => {
      new THREE.ImageLoader().load(url, resolve, undefined, reject);
    }));
  }
  return imgCache.get(url)!;
}
const sceneCache = new Map<string, Promise<THREE.Group>>();
// The baker only reads geometry + UVs and samples the palette itself, so the
// GLBs' own texture references are never needed. Some kits live in folders
// without the Textures/colormap.png their GLBs point at (they share a renamed
// cmap-*.png); hand the loader a 1x1 stand-in instead of a 404 + warning.
const BLANK_PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=';
const bakeManager = new THREE.LoadingManager();
bakeManager.setURLModifier(u => (/\.(png|jpe?g)$/i.test(u) ? BLANK_PNG : u));
function loadModelScene(url: string): Promise<THREE.Group> {
  if (!sceneCache.has(url)) {
    sceneCache.set(url, new Promise((resolve, reject) => {
      new GLTFLoader(bakeManager).load(url, gltf => resolve(gltf.scene), undefined, reject);
    }));
  }
  return sceneCache.get(url)!;
}

function srgbToLinear(c: number): number {
  return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}

export interface BakedTemplate {
  /** non-indexed, vertex-colored geometries in model space */
  geos: THREE.BufferGeometry[];
  /** bounding size at scale 1 */
  size: { x: number; y: number; z: number };
  /** bounding centre x/z at scale 1 */
  center: { x: number; z: number };
}

export interface BakeOptions {
  /** per-channel multiplier applied to the sampled colors */
  tint?: [number, number, number];
  /** sample the palette with a flipped V — some kit exports store UVs
   * bottom-up against the baker's top-left convention */
  flipUvY?: boolean;
  /** palette cells that are window glass ([u0, u1, v0, v1]): their faces
   * get a `glow` value, one per window (the two triangles of a pane share
   * it), which the chunk material lights at night (G10) */
  windows?: Array<[number, number, number, number]>;
}

async function bakeTemplate(url: string, cmapUrl: string | null, opts: BakeOptions = {}): Promise<BakedTemplate> {
  const scene = await loadModelScene(url);
  let px: ImageData | null = null;
  if (cmapUrl) {
    try {
      const img = await loadPalette(cmapUrl);
      const cv = document.createElement('canvas');
      cv.width = img.width;
      cv.height = img.height;
      const ctx = cv.getContext('2d', { willReadFrequently: true })!;
      ctx.drawImage(img, 0, 0);
      px = ctx.getImageData(0, 0, img.width, img.height);
    } catch {
      px = null;
    }
  }
  scene.updateMatrixWorld(true);
  const geos: THREE.BufferGeometry[] = [];
  const bbox = new THREE.Box3();
  scene.traverse(node => {
    if (!(node instanceof THREE.Mesh) || !node.geometry) return;
    let geo = node.geometry.index ? node.geometry.toNonIndexed() : node.geometry.clone();
    for (const name of Object.keys(geo.attributes)) {
      if (name !== 'position' && name !== 'normal' && name !== 'uv') geo.deleteAttribute(name);
    }
    if (!geo.attributes.normal) geo.computeVertexNormals();
    const pos = geo.attributes.position as THREE.BufferAttribute;
    const uv = geo.attributes.uv as THREE.BufferAttribute | undefined;
    const mesh = node as THREE.Mesh;
    const mat = Array.isArray(mesh.material) ? mesh.material[0] : mesh.material;
    const std = mat as THREE.MeshStandardMaterial;
    const flat = std && std.color ? std.color : null;
    const colors = new Float32Array(pos.count * 3);
    for (let f = 0; f < pos.count; f += 3) {
      let r = 1, g = 0, b = 1;
      if (px && uv) {
        const u = (uv.getX(f) + uv.getX(f + 1) + uv.getX(f + 2)) / 3;
        let v = (uv.getY(f) + uv.getY(f + 1) + uv.getY(f + 2)) / 3;
        if (opts.flipUvY) v = 1 - v;
        // glTF UV origin is the image TOP-LEFT (GLTFLoader keeps flipY=false)
        const xi = Math.min(px.width - 1, Math.max(0, (u * px.width) | 0));
        const yi = Math.min(px.height - 1, Math.max(0, (v * px.height) | 0));
        const i4 = (yi * px.width + xi) * 4;
        r = srgbToLinear(px.data[i4] / 255);
        g = srgbToLinear(px.data[i4 + 1] / 255);
        b = srgbToLinear(px.data[i4 + 2] / 255);
      } else if (flat) {
        r = flat.r; g = flat.g; b = flat.b;
      }
      if (opts.tint) {
        r *= opts.tint[0]; g *= opts.tint[1]; b *= opts.tint[2];
      }
      for (let k = 0; k < 3; k++) {
        colors[(f + k) * 3] = r;
        colors[(f + k) * 3 + 1] = g;
        colors[(f + k) * 3 + 2] = b;
      }
    }
    geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    if (opts.windows && uv) geo.setAttribute('glow', new THREE.BufferAttribute(windowGlow(pos, uv, opts), 1));
    geo.applyMatrix4(node.matrixWorld);
    geos.push(geo);
    bbox.expandByObject(node);
  });
  const size = new THREE.Vector3();
  const center = new THREE.Vector3();
  bbox.getSize(size);
  bbox.getCenter(center);
  return { geos, size: { x: size.x, y: size.y, z: size.z }, center: { x: center.x, z: center.z } };
}

/** a window pane's glow per vertex: 0 off the glass, else a value in
 * (0, 1] shared by the pane's triangles (a triangle sharing two corners
 * with the one before is the same pane) */
function windowGlow(pos: THREE.BufferAttribute, uv: THREE.BufferAttribute, opts: BakeOptions): Float32Array {
  const out = new Float32Array(pos.count);
  let pane = 0, value = 0, prev = -1;
  const same = (a: number, b: number): boolean =>
    Math.abs(pos.getX(a) - pos.getX(b)) < 1e-5 && Math.abs(pos.getY(a) - pos.getY(b)) < 1e-5 && Math.abs(pos.getZ(a) - pos.getZ(b)) < 1e-5;
  for (let f = 0; f < pos.count; f += 3) {
    let u = (uv.getX(f) + uv.getX(f + 1) + uv.getX(f + 2)) / 3;
    let v = (uv.getY(f) + uv.getY(f + 1) + uv.getY(f + 2)) / 3;
    if (opts.flipUvY) v = 1 - v;
    if (!opts.windows!.some(([u0, u1, v0, v1]) => u >= u0 && u < u1 && v >= v0 && v < v1)) { prev = -1; continue; }
    let shared = 0;
    if (prev >= 0) for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) if (same(f + i, prev + j)) shared++;
    if (shared < 2) { pane++; value = 0.02 + 0.98 * ((pane * 0.6180339887) % 1); }
    out[f] = out[f + 1] = out[f + 2] = value;
    prev = f;
  }
  return out;
}

export type BakeDef = [url: string, cmapUrl: string | null, opts?: BakeOptions];

const baked = new Map<string, BakedTemplate>();

/** Bake every def once; individual failures are logged and leave the name unset. */
/** bake every kit model of `defs` (`onProgress(done, total)` as they land) */
export function prepBakedModels(defs: Record<string, BakeDef>, onProgress?: (done: number, total: number) => void): Promise<unknown> {
  const all = Object.entries(defs);
  let done = 0;
  return Promise.all(all.map(async ([name, def]) => {
    try {
      if (baked.has(name)) return;
      const [url, cmap, opts] = def;
      baked.set(name, await bakeTemplate(url, cmap, opts));
    } catch (e) {
      console.warn('asset bake failed:', name, e);
    } finally {
      onProgress?.(++done, all.length);
    }
  }));
}

export function bakedModel(name: string): BakedTemplate | null {
  return baked.get(name) ?? null;
}

/** the baked templates as plain typed arrays, for a worker that bakes
 * chunks (chunkWorker.ts): name -> geometries' attributes + bounds */
export interface TemplatePack {
  [name: string]: {
    geos: Array<Record<string, { array: Float32Array; itemSize: number }>>;
    size: BakedTemplate['size'];
    center: BakedTemplate['center'];
  };
}

export function exportBakedTemplates(): TemplatePack {
  const out: TemplatePack = {};
  for (const [name, t] of baked) {
    out[name] = {
      geos: t.geos.map(g => {
        const attrs: Record<string, { array: Float32Array; itemSize: number }> = {};
        for (const [k, a] of Object.entries(g.attributes)) {
          const ba = a as THREE.BufferAttribute;
          attrs[k] = { array: ba.array as Float32Array, itemSize: ba.itemSize };
        }
        return attrs;
      }),
      size: t.size,
      center: t.center,
    };
  }
  return out;
}

/** register templates exported by the main thread (in a worker) */
export function importBakedTemplates(pack: TemplatePack): void {
  for (const [name, t] of Object.entries(pack)) {
    const geos = t.geos.map(attrs => {
      const g = new THREE.BufferGeometry();
      for (const [k, a] of Object.entries(attrs)) g.setAttribute(k, new THREE.BufferAttribute(a.array, a.itemSize));
      return g;
    });
    baked.set(name, { geos, size: t.size, center: t.center });
  }
}
