// A stand-in `document` for node tools that build scenes: the sky's star and
// meteor textures and the goals' icon sprites draw on a canvas, which node
// hasn't got. Every canvas here takes any drawing call and draws nothing —
// enough for the scenes to be built and played headless. Import it first.
const noop = (): unknown => ctx;
const ctx: unknown = new Proxy({}, {
  get: (_t, k) => (k === 'canvas' ? canvas : k === 'measureText' ? () => ({ width: 10 }) : noop),
  set: () => true,
});
const canvas = { width: 1, height: 1, style: {}, getContext: () => ctx, toDataURL: () => '' };
const g = globalThis as unknown as { document?: unknown };
if (!g.document) {
  g.document = { createElement: () => ({ ...canvas }), createElementNS: () => ({ ...canvas }) };
}
export {};
