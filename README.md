# Kids' Game Platform

A browser game platform for a 4–5 year old, driven by a USB steering wheel.
**Stack:** TypeScript · three.js · Vite. Art: CC0 Kenney kits + a procedural pastel model kit.

![Fire truck](concept-art/ts-city.png)

## Run it

```
npm install
npm run dev          # → http://localhost:8321
```

The garage at the root is the launcher: one vehicle per play mode on a turntable, chosen with the wheel (turn it to spin the carousel, press the pedal or any button to go; arrow keys + Enter and the mouse work too) — no reading required, the name is spoken. In the game, the 🏠 button, Esc, or holding the wheel's start / select button for a second goes back to the garage. While an island loads, a progress card shows what is happening and about how long is left.
`npm run build` produces a minified `dist/`; `npm run preview` serves it.

**Endless City** is an endless archipelago of seeded island cities joined by
causeways. Each island grows its own seeded shoreline — bays, beaches and
headlands reaching out to the four causeways — ringed by open sea, and its own
street plan: a coastal ring road, riverside embankments, and districts whose
streets run at their own angles, meeting at every kind of junction. Every
block belongs to a district — downtown business at the centre, a mixed ring,
suburban houses with fenced gardens toward the shore, works yards and a rail
yard along the railway, a park beside downtown — and is built over inside,
not just along its streets. Every new game rolls a fresh seed and writes it into the URL, and
`?seed=N` replays that world exactly. Pick a mode from the garage (or
`?mode=`): fire truck (fires + cats), police car and police helicopter
(chase the getaway car — stay close, or keep it in the searchlight),
ambulance and medical helicopter (people to rescue), plane (sky rings), boat
(buoy course), train (stop at the yellow board and passengers get on and
off) and kart race (three laps
against three AI karts on the race islands — every island at x, y multiples
of 10 is a small island that is one Racing Kit circuit, each its own shape,
starting from island (0,0); the other modes start on island (1,0)). The world keeps running while you play: two railway lines cross
every island (north-south and west-east, meeting at a diamond) and carry on
over the causeways to the neighbours, with stations, gated level crossings
and trains on a timetable that never stops; boats pass under the causeways'
raised spans, traffic obeys
the lights, an EMS helicopter patrols the sky, and whenever the kid isn't
driving it the fire truck drives itself.

## Controls (Endless City)

WASD / arrow keys or the USB wheel (steering axis + triggers).
`E` toggles the siren, `C` cycles chase / high / cab cameras (or `?cam=high`),
`R` resets. Drive to a call's beacon and stop (hover, in the helicopter) and
its mission scene opens: sweep the hose over a burning house, tree or car,
slide the ladder to a cat or to people at the windows of a burning building,
steer the stretcher into the ambulance, or hold the helicopter's winch over the
person — the wheel only (A/D or the mouse work too).

## Project layout

| Path | What |
|---|---|
| `src/engine/` | shared engine: pastel palette, stage factory, vertex-color batching (`Baked`), CC0 glTF loader + palette-baker, procedural audio (siren/pump/thud), keyboard + wheel input, dev capture |
| `src/kit/` | procedural model kit by family (nature, people, buildings, vehicles, animals, props) |
| `src/worlds/` | parametric generators: city street, valley, railroad, and the endless-city **chunk generator** |
| `src/games/city/` | the playable game, one module per concern: player physics, chunk streaming, traffic + working traffic lights, missions, spray + ladder mini-scenes, particles, save state |
| `src/games/city/train.ts`, `patrol.ts` | ambient life: the train shuttles the rail corridor; a helicopter circles the neighbourhood |
| `src/games/registry.ts` | the list of games the launcher renders |
| `src/games/diorama/` | the three concept dioramas, now proper modules |
| `public/assets/kenney/` | CC0 Kenney models (Car Kit, City Kit, Nature Kit) + licenses |
| `docs/engine-notes.md` | engine decision record, measured perf, wheel plan |
| `AGENTS.md` | the world-generation rules (R1–R28); read before touching world code |
| `tools/audit-world.ts` | checks the world rules: `npm run audit:world -- <seed>` |

## Conventions

- **Deterministic worlds**: every generator is a pure function of a seed — seed 7 is seed 7 forever, so the kid can revisit "their" city and seeds can be shared as links.
- **One draw call per city chunk**: Kenney models are baked per-face into vertex-colored merged geometry by `src/engine/assets.ts` (see `bakeTemplate`). If an asset fails to load, the procedural fallback kicks in — the game never breaks.
- **Adding a game**: one entry in `src/games/registry.ts` + one rollup input in `vite.config.ts`.
- **Captures** (docs/screenshots): load any page with `?still=1&capture=name.png` — the frame lands in `concept-art/` via the dev-server middleware.

See [docs/engine-notes.md](docs/engine-notes.md) for the engine decision record and measured performance.
