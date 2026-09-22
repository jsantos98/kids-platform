// Dev capture helpers: ?still=1 freezes the render loop (deterministic
// screenshots), ?capture=name.png renders one frame and POSTs it to the dev
// server's /save endpoint (Vite middleware). No-ops in production builds.
import type * as THREE from 'three';

export interface CaptureSetup {
  still?: string | null;
  capture?: string | null;
}

export function setupDevCapture(renderer: THREE.WebGLRenderer, scene: THREE.Scene, camera: THREE.Camera): CaptureSetup {
  const q = new URLSearchParams(location.search);
  const setup: CaptureSetup = { still: q.get('still'), capture: q.get('capture') };
  if (import.meta.env.PROD) return setup;

  if (setup.still === '1') {
    setTimeout(() => renderer.setAnimationLoop(null), 3000);
  }
  if (setup.capture) {
    setTimeout(async () => {
      try {
        renderer.render(scene, camera);
        const url = renderer.domElement.toDataURL('image/png');
        await fetch('/save?name=' + encodeURIComponent(setup.capture!), { method: 'POST', body: url });
        document.title = 'SAVED ' + setup.capture;
      } catch (e) {
        document.title = 'CAPFAIL: ' + (e as Error).message;
      }
    }, 3500);
  }
  return setup;
}
