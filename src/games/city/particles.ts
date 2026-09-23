// Pooled particle effects: soft cream drift-dust on hard turns and a pastel
// confetti burst on every rescue. Cheap, allocation-free while playing.
import * as THREE from 'three';

interface Particle {
  m: THREE.Mesh;
  t: number;               // 0..1 lifetime; >=1 means idle
  v?: THREE.Vector3;       // confetti only
}

const CONFETTI_COLORS = [0xe25c5c, 0xf6c952, 0x63b0a8, 0x7fb2d9, 0xa794cc, 0xf0b6c6];

export class Particles {
  private dust: Particle[] = [];
  private confetti: Particle[] = [];
  private splashes: Particle[] = [];
  private dustTimer = 0;

  constructor(scene: THREE.Scene) {
    const dg = new THREE.SphereGeometry(0.22, 8, 6);
    for (let i = 0; i < 12; i++) {
      const m = new THREE.Mesh(dg, new THREE.MeshLambertMaterial({ color: 0xe9e1cf, transparent: true, opacity: 0 }));
      m.visible = false;
      scene.add(m);
      this.dust.push({ m, t: 1 });
    }
    const cg = new THREE.BoxGeometry(0.16, 0.02, 0.24);
    for (let i = 0; i < 26; i++) {
      const m = new THREE.Mesh(cg, new THREE.MeshBasicMaterial({
        color: CONFETTI_COLORS[i % CONFETTI_COLORS.length], transparent: true,
      }));
      m.visible = false;
      scene.add(m);
      this.confetti.push({ m, t: 1, v: new THREE.Vector3() });
    }
    const sg = new THREE.SphereGeometry(0.26, 8, 6);
    for (let i = 0; i < 10; i++) {
      const m = new THREE.Mesh(sg, new THREE.MeshLambertMaterial({ color: 0xbfe3ff, transparent: true, opacity: 0 }));
      m.visible = false;
      scene.add(m);
      this.splashes.push({ m, t: 1, v: new THREE.Vector3() });
    }
  }

  burstConfetti(pos: THREE.Vector3): void {
    for (const c of this.confetti) {
      c.t = 0;
      c.m.visible = true;
      c.m.position.copy(pos).add(new THREE.Vector3((Math.random() - 0.5) * 0.8, 1.2, (Math.random() - 0.5) * 0.8));
      c.v!.set((Math.random() - 0.5) * 5, 3.5 + Math.random() * 3, (Math.random() - 0.5) * 5);
      c.m.rotation.set(Math.random() * Math.PI, Math.random() * Math.PI, 0);
    }
  }

  /** water droplets kicked up fording the river */
  splash(pos: THREE.Vector3): void {
    for (const s of this.splashes) {
      s.t = 0;
      s.m.visible = true;
      s.m.position.copy(pos).add(new THREE.Vector3((Math.random() - 0.5) * 1.6, 0, (Math.random() - 0.5) * 1.6));
      s.m.scale.setScalar(0.6 + Math.random() * 0.5);
      s.v!.set((Math.random() - 0.5) * 4, 2.4 + Math.random() * 2.6, (Math.random() - 0.5) * 4);
    }
  }

  updateDrift(dt: number, driving: boolean, speed: number, steer: number, car: THREE.Object3D): void {
    this.dustTimer -= dt;
    if (driving && Math.abs(speed) > 5.5 && Math.abs(steer) > 0.55 && this.dustTimer <= 0) {
      this.dustTimer = 0.09;
      const back = car.localToWorld(new THREE.Vector3(-Math.sign(steer) * 0.9, 0.25, -1.7));
      const p = this.dust.find(p => p.t >= 1) ?? this.dust[0];
      p.t = 0;
      p.m.visible = true;
      p.m.position.copy(back);
      p.m.position.x += (Math.random() - 0.5) * 0.4;
      p.m.position.z += (Math.random() - 0.5) * 0.4;
    }
  }

  update(dt: number): void {
    for (const p of this.dust) {
      if (p.t >= 1) continue;
      p.t += dt / 0.7;
      p.m.scale.setScalar(0.7 + Math.min(p.t, 1) * 1.6);
      (p.m.material as THREE.MeshLambertMaterial).opacity = 0.5 * (1 - p.t);
      if (p.t >= 1) p.m.visible = false;
    }
    for (const c of this.confetti) {
      if (c.t >= 1) continue;
      c.t += dt / 1.3;
      c.v!.y -= 7 * dt;
      c.m.position.addScaledVector(c.v!, dt);
      c.m.rotation.x += dt * 5;
      c.m.rotation.y += dt * 3;
      (c.m.material as THREE.MeshBasicMaterial).opacity = 1 - c.t;
      if (c.t >= 1) c.m.visible = false;
    }
    for (const s of this.splashes) {
      if (s.t >= 1) continue;
      s.t += dt / 0.6;
      s.v!.y -= 9 * dt;
      s.m.position.addScaledVector(s.v!, dt);
      (s.m.material as THREE.MeshLambertMaterial).opacity = 0.85 * (1 - s.t);
      if (s.t >= 1) s.m.visible = false;
    }
  }
}
