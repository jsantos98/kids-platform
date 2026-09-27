// Animated characters (G4): the Kenney mini-characters and cube pets carry
// their own animation clips (idle, walk, sprint, jump, emote-yes, sit…; the
// cat idle, walk, run, dance, gesture-positive…). They are rigid node
// hierarchies — legs, arms, torso and head as separate nodes, no skin — so
// a clone of the glTF scene plus an AnimationMixer bound by node name plays
// them (they are skinned to those nodes, so a clone must rebind its
// skeleton: SkeletonUtils). A Rig is usable at once: its root is an empty group the model joins
// when it has loaded (a baked still stands in until then), and whatever it
// was asked to play starts then.
import * as THREE from 'three';
import { clone as cloneSkinned } from 'three/addons/utils/SkeletonUtils.js';
import { loadGLTF, bakedModel } from './assets.js';
import { templateToMesh } from './baked.js';

const PEOPLE = '/assets/kenney/mini-chars';
const PETS = '/assets/kenney/pets';

/** the characters by the names the city's templates use */
export const CHARACTERS = ['ma', 'fa', 'mb', 'fb', 'mc', 'fc', 'md', 'fd', 'me', 'fe', 'mf', 'ff'] as const;
export type CharacterId = typeof CHARACTERS[number];
export type PetId = 'cat' | 'dog' | 'bunny' | 'chick' | 'pig' | 'fox' | 'panda' | 'penguin';

export interface PlayOptions {
  loop?: boolean;
  /** crossfade from the clip before (s) */
  fade?: number;
  /** playback speed */
  speed?: number;
}

export class Rig {
  /** place, turn and scale this */
  readonly root = new THREE.Group();
  private model: THREE.Object3D | null = null;
  private still: THREE.Object3D | null = null;
  private mixer: THREE.AnimationMixer | null = null;
  private clips = new Map<string, THREE.AnimationClip>();
  private action: THREE.AnimationAction | null = null;
  private want: { name: string; o: PlayOptions } | null = null;
  /** the clip playing now (or asked for, before the model has loaded) */
  clip = '';
  private loadCbs: Array<(r: Rig) => void> = [];

  constructor(url: string, height: number, stillName?: string) {
    const tpl = stillName ? bakedModel(stillName) : null;
    if (tpl) {
      const m = templateToMesh(tpl);
      m.scale.setScalar(height / tpl.size.y);
      m.castShadow = true;
      this.still = m;
      this.root.add(m);
    }
    loadGLTF(url).then(({ scene, animations }) => {
      const m = cloneSkinned(scene);
      // (the height from the meshes' bind pose: a skinned mesh's world box
      // needs a posed skeleton)
      const box = new THREE.Box3();
      m.traverse(o => {
        const g = (o as THREE.Mesh).geometry;
        if (!g) return;
        g.computeBoundingBox();
        box.union(g.boundingBox!);
      });
      const h = box.max.y - box.min.y || 1;
      m.scale.setScalar(height / h);
      m.position.y = -box.min.y * (height / h);
      m.traverse(o => {
        const mesh = o as THREE.Mesh;
        if (!mesh.isMesh) return;
        mesh.castShadow = true;
        mesh.frustumCulled = false;
        // the city's look: matte, no metal sheen
        const mat = mesh.material as THREE.MeshStandardMaterial;
        if (mat.isMeshStandardMaterial) { mat.metalness = 0; mat.roughness = 1; }
      });
      if (this.still) { this.root.remove(this.still); this.still = null; }
      this.model = m;
      this.root.add(m);
      this.mixer = new THREE.AnimationMixer(m);
      for (const c of animations) this.clips.set(c.name, c);
      if (this.want) this.play(this.want.name, this.want.o);
      for (const f of this.loadCbs) f(this);
      this.loadCbs.length = 0;
    }).catch(() => { /* no model (node tools, a missing file): the still stays */ });
  }

  get loaded(): boolean { return !!this.model; }

  /** run `f` once the model has loaded (at once if it has) */
  onLoad(f: (r: Rig) => void): void {
    if (this.model) f(this);
    else this.loadCbs.push(f);
  }

  has(name: string): boolean { return this.clips.has(name); }

  /** a named node of the model (an arm, the head) once it has loaded */
  node(name: string): THREE.Object3D | null {
    return this.model?.getObjectByName(name) ?? null;
  }

  /** play a clip (looping by default), crossfading from the last */
  play(name: string, o: PlayOptions = {}): void {
    this.clip = name;
    this.want = { name, o };
    if (!this.mixer) return;
    const c = this.clips.get(name);
    if (!c) return;
    const next = this.mixer.clipAction(c);
    next.setLoop(o.loop === false ? THREE.LoopOnce : THREE.LoopRepeat, Infinity);
    next.clampWhenFinished = o.loop === false;
    next.timeScale = o.speed ?? 1;
    if (next === this.action) return;
    next.reset().play();
    if (this.action) next.crossFadeFrom(this.action, o.fade ?? 0.25, false);
    this.action = next;
  }

  /** a one-shot clip that finished (a jump, a cheer) */
  get done(): boolean {
    return !!this.action && this.action.loop === THREE.LoopOnce && !this.action.isRunning();
  }

  update(dt: number): void { this.mixer?.update(dt); }
}

/** a person (~1.6 m; a child ~1.1 m) */
export function person(id: CharacterId | number, height = 1.75): Rig {
  const c = typeof id === 'number' ? CHARACTERS[((Math.floor(id) % CHARACTERS.length) + CHARACTERS.length) % CHARACTERS.length] : id;
  const file = `character-${c[0] === 'm' ? 'male' : 'female'}-${c[1]}`;
  return new Rig(`${PEOPLE}/${file}.glb`, height, `ped-${c}`);
}

/** a cube pet (its height in metres) */
export function pet(id: PetId, height = 0.55): Rig {
  return new Rig(`${PETS}/animal-${id}.glb`, height, `pet-${id}`);
}

/** step every rig of a scene */
export function updateRigs(rigs: Iterable<Rig>, dt: number): void {
  for (const r of rigs) r.update(dt);
}
