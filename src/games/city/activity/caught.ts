// Caught! — the short scene after a robber chase: the getaway car has pulled
// over, the police car (or the helicopter, hovering) stands behind it with
// its lights flashing, and the robber climbs out with hands up. Nothing to
// steer: it plays for a moment, then the director celebrates and fades
// back to the world.
import * as THREE from 'three';
import { spawnVehicle } from '../../../engine/assets.js';
import { PRIMS as P } from '../../../engine/stage.js';
import { makeHelicopter } from '../../../kit/index.js';
import { makeSet, makeHuman, ease, disposeScene, type Activity, type ActivityInput, type ActivityState } from './common.js';

const PLAY = 2.6; // seconds

export class CaughtActivity implements Activity {
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  private t = 0;
  private robber: THREE.Object3D;
  private red: THREE.Mesh;
  private blue: THREE.Mesh;
  private heli: THREE.Group | null = null;
  private particles;

  constructor(seed: number, fromHeli: boolean) {
    const set = makeSet(0);
    this.scene = set.scene;
    this.camera = set.camera;
    this.particles = set.particles;
    // the getaway car, pulled over, and the police behind it
    const car = new THREE.Group();
    car.position.set(1.5, 0, 0.2);
    car.rotation.y = -Math.PI / 2;
    this.scene.add(car);
    spawnVehicle('/assets/kenney/sedan.glb', { len: 4.4 }).then(g => { g.userData.shared = true; car.add(g); }).catch(() => {});
    const police = new THREE.Group();
    const lights = new THREE.Group();
    if (fromHeli) {
      this.heli = makeHelicopter({ body: 0x5a7fb5, band: 0xfaf7ef });
      this.heli.position.set(-3.6, 3.6, -1.5);
      this.heli.rotation.y = -Math.PI / 2 + 0.5;
      this.scene.add(this.heli);
      lights.position.set(0, -0.2, 0);
      this.heli.add(lights);
    } else {
      police.position.set(-4.6, 0, 0.2);
      police.rotation.y = -Math.PI / 2;
      this.scene.add(police);
      spawnVehicle('/assets/kenney/police.glb', { len: 4.6 }).then(g => { g.userData.shared = true; police.add(g); }).catch(() => {});
      lights.position.set(-4.6, 1.9, 0.2);
      this.scene.add(lights);
    }
    this.red = P.sphere(0.22, 0xff3b30, 0, 0, -0.35) as THREE.Mesh;
    this.blue = P.sphere(0.22, 0x3f7bff, 0, 0, 0.35) as THREE.Mesh;
    for (const m of [this.red, this.blue]) {
      m.material = new THREE.MeshBasicMaterial({ color: (m.material as THREE.MeshLambertMaterial).color });
      lights.add(m);
    }
    // the robber, out of the car, hands up
    // (in a metre-scale group: the kit character itself is scaled)
    this.robber = new THREE.Group();
    this.robber.add(makeHuman(seed % 6));
    this.robber.position.set(1.4, 0, 1.9);
    this.scene.add(this.robber);
    for (const sd of [-1, 1]) this.robber.add(P.box(0.13, 0.5, 0.13, 0xf2c3a0, sd * 0.44, 1.9, 0.1));
    // the swag
    this.scene.add(P.sphere(0.35, 0x9ad06b, 2.3, 0.35, 2.3));
    this.camera.position.set(0, 4.6, 11.5);
    this.camera.lookAt(-0.8, fromHeli ? 1.8 : 1, 0.5);
  }

  update(dt: number, elapsed: number, _inp: ActivityInput): ActivityState {
    this.t += dt;
    const on = Math.floor(elapsed * 6) % 2 === 0;
    (this.red.material as THREE.MeshBasicMaterial).color.setHex(on ? 0xff3b30 : 0x3a1010);
    (this.blue.material as THREE.MeshBasicMaterial).color.setHex(on ? 0x10183a : 0x3f7bff);
    // the robber steps out toward the camera and waits, hands up
    this.robber.position.z = ease(this.robber.position.z, 3.2, 2, dt);
    this.robber.rotation.y = 0;
    if (this.heli) {
      this.heli.position.y = 3.6 + Math.sin(elapsed * 1.4) * 0.25;
      const rotor = this.heli.userData.mainRotor as THREE.Object3D | undefined;
      if (rotor) rotor.rotation.y = elapsed * 22;
    }
    this.particles.update(dt);
    return { progress: Math.min(1, this.t / PLAY), prompt: '🚓 CAUGHT!', done: this.t >= PLAY };
  }

  celebrate(): void {
    this.particles.burstConfetti(new THREE.Vector3(0, 2, 2));
  }

  dispose(): void {
    disposeScene(this.scene);
  }
}
