# Engine Notes — Kids' Game Platform (exploration stage)

Date: 2026-09-22 · Status: direction chosen after concept renders (see `../concept-art/`)

## Decision: Three.js in the browser

| Criterion | Three.js (chosen) | Godot 4 | Unity |
|---|---|---|---|
| Runtime for the kid | A browser page — one desktop shortcut, fullscreen, zero installs | Windows .exe (~50–100 MB) | Windows .exe (100+ MB) |
| License / cost | MIT, free | MIT, free | Free tier w/ licensing terms |
| Dev workflow here | I (the AI) can build, render, screenshot and verify scenes end-to-end in this workspace | I generate GDScript/scenes but can't visually verify as fast | Same, heavier |
| Low-poly suitability | Ideal — flat-shaded Lambert materials, gradient-sky trick, one shadow-casting light. All standard | Ideal too | Ideal too |
| USB wheel | Gamepad API (see below) | Built-in input remapping UI | Built-in |
| Editor for hand-tweaks | None (code only — fine for AI-driven dev, you're a web dev) | Excellent | Excellent |
| Risk | We build small things ourselves (UI, scene switching, physics glue) | Slight vendor lock of workflow, slower iteration here | Overkill; heavier installs/builds |

Godot 4 remains the fallback if we later want an offline .exe or you want to hand-edit
scenes in a visual editor — the art style and models transfer (export GLTF).

## Proof of feasibility — measured numbers (Three.js r186, 1920×1080, one dir-light + hemisphere, PCF soft shadows)

After the richness pass and the move to parametric generation (market stalls, café sets,
animals, balloons, fences, hedges, flower patches, bunting, water tower — hundreds of
generated props; exact numbers vary a little per seed):

| Scene | Draw calls | Triangles |
|---|---|---|
| Fire truck street (chase cam) | 958 | 237,902 |
| Fire truck street (cab cam) | 834 | 218,270 |
| Rescue helicopter valley | 917 | 267,416 |
| Train loop (beauty) | 1,205 | 356,600 |
| Train loop (cab) | 842 | 275,262 |
| Garage menu | 403 | 62,748 |

Even the heaviest scene is a small fraction of what integrated graphics render at 60 fps
(several million triangles/frame). Dense repeated props (flowers, hedges, fences, trackside
posts, the horizon tree ring) already use a `Baked` helper that merges them into a single
vertex-colored mesh, so the next optimization step is simply merging more of the same —
mechanical, not a redesign.

## USB wheel plan (next stage)

Most USB wheels enumerate as a generic DirectInput joystick on Windows. In the browser they
show up through the **Gamepad API** (`navigator.getGamepads()`):

- Steering → `gamepad.axes[0]` (range −1..1)
- Pedals / paddles / gear lever → `gamepad.buttons[]` / further axes
- Some wheels need their Windows driver installed once so the axes appear; then no extra work.

Pattern we'll use in the playable slice:

```js
function pollWheel() {
  const gp = navigator.getGamepads()[0];
  if (!gp) return { steer: 0, gas: 0, brake: 0 };
  return {
    steer: gp.axes[0] ?? 0,
    gas:   gp.buttons[7]?.value ?? 0,  // right trigger/pedal
    brake: gp.buttons[6]?.value ?? 0,  // left trigger/pedal
  };
}
```

We'll build a `wheel-test.html` calibration page first (shows axes/buttons live) so we can
see exactly how his wheel maps before wiring gameplay. Keyboard (arrows/WASD) stays as
fallback so games are testable without the wheel.

## Parametric scenario generation

Worlds are generated, not hand-placed ([concepts/shared/generate.js](../concepts/shared/generate.js)):

- `generateCity({seed, size, density})` — lays out lots along a main street + seeded cross
  roads, picks lot types (house / shop / park / stall / café / fence / empty), then *chooses
  which shop catches fire*, where the truck parks, and where the cat tree stands. Those
  become POIs: `firePos`, `truckPos`, `catTreePos`.
- `generateValley({seed, houses, lake, animals})` — hospital + town + lake + paddock with
  rejection-sampled placement; picks the **patient house** → `patientPos`, `heliPad`, `heliStart`.
- `generateRailroad({seed, wobble, stations, animals})` — seeded track wobble, river position,
  bridge computed wherever the track crosses the river, tunnel hill, parametric station
  positions, siding, paddock → `headT`, `stationTs`, `bridgeCenter`, and the track curve itself
  (which the train drives on via `placeOnTrack`).

Deterministic: `seed` drives a mulberry32 PRNG, so seed 7 today is seed 7 forever — the kid
can revisit "their" city, and seeds can be shared as links. Gameplay next stage reads only
the returned POIs, so game logic never depends on hand-placed coordinates.

## Art direction — "Make Way" pastel, built from CC0 Kenney kits

After a realism pass we pivoted to the clean arcade look of games like *Make Way* /
*Beach Buggy Racing* (user choice, 2026-09-22): soft pastel palette, `NeutralToneMapping`,
strong hemisphere fill + one warm shadow-casting sun, no post-processing.

Vehicles **and the whole city** now come from CC0 Kenney kits (`concepts/assets/kenney/`,
license files included): Car Kit (fire truck + traffic + parked cars), City Kit Commercial
(14 building models), City Kit Roads (road tiles, crosswalks, traffic lights, street
lamps) and Nature Kit (trees/bushes). The key trick that keeps the streamed city at one
draw call per chunk: a baker (`shared/assets.js`) loads each GLB once, samples its palette
texture per-face (glTF UVs are top-left origin) or reads plain material colors, and
converts every model into a vertex-colored geometry that merges into the chunk's existing
`Baked` mesh. Road tiles sit at tile-local y=0 with raised curb strips — they are placed
with the surface just above the slab so the curbs stand proud.

## Endless city (explore prototype)

`concepts/city.html` streams an infinite city: the world is cut into 64 m chunks, each one
generated on demand by `generateCityChunk(seed, cx, cz)` and merged into a **single
vertex-colored mesh** (one draw call per chunk). Chunks within a 3-chunk radius of the car
are alive; farther ones are disposed. Because chunk content is hashed from
(seed, cx, cz), driving away and coming back rebuilds the identical block.

Arcade car physics (bicycle-steering model), axis-separated AABB collision against the
generated buildings, ambient pedestrians on the sidewalks and AI cars on the road grid
that **obey working traffic lights** — each intersection runs a deterministic phase
(pure function of time, hashed per intersection) shared by the dynamic lamp props and
the car AI, which brakes to the stop line on red/yellow and commits if already too
close. The sun + shadow camera follow the car so shadows stay crisp anywhere.

Measured cost of the streamed view with the full Kenney kit city (buildings, road tiles,
trees, lamps, parked cars baked into chunk meshes): **~350 draw calls, ~1.35M triangles**,
60 fps on integrated graphics — draw calls unchanged versus the procedural world because
everything merges per chunk; triangles rose ~3× and still have headroom (the kit also
ships low-detail building variants if a weaker device ever needs them). The wheel plugs
straight in via the Gamepad API (steering axis + triggers, A = spray).

**Mission loop is live**: fires and cat rescues spawn at generated intersections
(deterministic per seed), a big HUD arrow + wordless dot-meter guide the child to the
nearest one. Stopping next to a fire enters a hose mini-scene: the fire's flames are
spread sideways, and the child sweeps the water jet left/right (wheel axis, A/D, arrows
or the mouse) until every flame is out — confetti celebrates, the next call comes in.
Cats use the same stop-and-switch flow with a ladder slide. Every third call is a cat;
difficulty scales with progress; totals persist in localStorage. Collisions for young
kids are forgiving: a real bump flashes the truck (OOPS!), plays a thud, and auto-resets
it onto the nearest road lane, aligned with the road, a few meters back — it can never
end up stuck inside geometry. Sound is procedural WebAudio (siren wail, water-pump
noise) — no audio assets needed.

## Project layout

```
kids-platform/
  vite.config.ts          dev server (port 8321), MPA entries, capture middleware
  index.html              the launcher ("My Little Garage")
  play/city.html          the playable city game
  diorama/                firetruck / helicopter / train dioramas
  src/engine/             stage, palette, Baked batching, asset baker, audio, input
  src/kit/                procedural model kit (pastel, Kenney-styled)
  src/worlds/             parametric generators incl. the endless-city chunks
  src/games/city/         the game logic, split by concern (TS modules)
  public/assets/kenney/   CC0 Kenney models + colormaps + licenses
  concept-art/            rendered 1920×1080 shots (also shown in each page's HUD chip)
```

## How to run

```
cd O:\Daniel\kids-platform
npm install
npm run dev               # → http://localhost:8321
```

Each diorama is a live diorama (drag to orbit; `?cam=cab` for the cab views, `?move=1` on the
train makes it drive). The little chip bottom-left shows real draw calls / triangles.
Captures for docs: load any page with `?still=1&capture=name.png`.

## Roadmap after concept approval

1. **Playable fire-truck slice** — drive the existing street with the wheel (gas/steer),
   reach the fire, hose mini-game (hold button to spray, flames shrink), cat rescue.
2. Platform shell — the garage menu becomes the real launcher (big buttons, no text reading
   required), scene switching, autosave last game.
3. Train game on the existing loop — stations, stop accuracy, lane switch, angry/happy
   passengers.
4. Helicopter game — fly to marker, winch pickup, land on the hospital helipad.
5. Later: merge static geometry (perf headroom), sounds, more city blocks.
