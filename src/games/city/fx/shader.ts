// Bits the effect shaders share: fog (the scene's linear fog, so a flame
// far down the street fades like the buildings round it), a cheap value
// noise, and the material setup for camera-facing instanced quads.
import * as THREE from 'three';

export const NOISE = /* glsl */`
float hash21(vec2 p) { p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
float vnoise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash21(i), hash21(i + vec2(1.0, 0.0)), u.x), mix(hash21(i + vec2(0.0, 1.0)), hash21(i + vec2(1.0, 1.0)), u.x), u.y);
}`;

/** vertex side: pass the eye depth */
export const FOG_VS = /* glsl */`varying float vFogDepth;`;
/** fragment side: fade `col` into the fog colour */
export const FOG_FS = /* glsl */`
uniform vec3 fogColor;
uniform float fogNear;
uniform float fogFar;
varying float vFogDepth;
vec3 fogged(vec3 col) { return mix(col, fogColor, smoothstep(fogNear, fogFar, vFogDepth)); }
float fogAmount() { return smoothstep(fogNear, fogFar, vFogDepth); }`;

/** a ShaderMaterial with the scene's fog uniforms filled by three */
export function fxMaterial(vs: string, fs: string, uniforms: Record<string, THREE.IUniform>, opts: Partial<THREE.ShaderMaterialParameters> = {}): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    vertexShader: vs, fragmentShader: fs,
    uniforms: THREE.UniformsUtils.merge([THREE.UniformsLib.fog, uniforms]),
    fog: true, transparent: true, depthWrite: false,
    ...opts,
  });
}

/** a unit quad standing on its bottom edge (x −0.5…0.5, y 0…1) */
export function standingQuad(): THREE.PlaneGeometry {
  const g = new THREE.PlaneGeometry(1, 1);
  g.translate(0, 0.5, 0);
  return g;
}
