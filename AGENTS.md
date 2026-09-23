# AGENTS.md — World Rules (read before touching world code)

The city generator is a stack of hard invariants. **Every rule below was broken
at least once and had to be repaired.** If your change regresses one, it is a
bug — no matter how good the change looks otherwise. When you add a new rule,
add it here AND add an enforcement point (code guard or audit check).

## Definition of done — for ANY change to world generation or level crossings

1. `npx tsc --noEmit` and `npx vite build` pass.
2. `npx tsx tools/audit-world.ts` reports all-PASS (run it with 2–3 different
   seed args: `npx tsx tools/audit-world.ts 4242`).
3. Visual check in the browser for anything geometric (see *Verification*
   workflow below).
4. Scratch scripts in `.tmp/` are deleted; the fix is committed with a message
   that names the rule it preserves.

## Road network

| # | Rule | Enforced in |
|---|------|-------------|
| R1 | **No road ends in open space.** Every street tip ends at a cross street. The only sanctioned loose ends are the four causeway mouths on the shore. | `cityPlan.ts` — dead-end trim stage (5) |
| R2 | **Streets tile gaplessly.** Each 64 m edge is six cells of 64/6 m; corner cells always bake (no pads, no skips). | `cityChunk.ts` street stage |
| R3 | **Junctions are the union of their road cells** — a plus, T or L exactly as wide as the roads. Never add a wider pad: its corners jut past the kerb lines as orphan asphalt. | `cityChunk.ts` (no pad exists — keep it that way) |
| R3b | **No hard 90° asphalt corners.** Every junction corner where two arms meet gets a fillet disc (r5), and an L-bend's outer elbow gets a bigger disc (r7) curving the outer edge. | `cityChunk.ts` corner-fillet stage |
| R4 | **Kerbs + centre dashes break only at open junctions** (plus/T/L, roundabout, plaza). A road running straight through a node keeps its markings unbroken — no "- - -      - - - -" gaps. | `cityChunk.ts` `openJunction()` gate on markings |
| R5 | Carriageway is 14 m (`ROAD_HALF = 7`). Lane logic (traffic ±3.5 m, kerbs ±6.9, lamps ±7.8, lots ≥8.1) depends on it. | `cityChunk.ts`, `traffic.ts`, `cityPlan.ts` |
| R6 | Traffic lights stand at ±12.5 m off signalized nodes (outside the junction opening); cars stop at `STOP_LINE` 18.5 m. | `lampProps.ts`, `cityChunk.ts`, `lights.ts` |

## Railway

| # | Rule | Enforced in |
|---|------|-------------|
| R7 | **The rail crosses streets only perpendicular.** Route scoring rejects any candidate with a crossing gentler than ~59° (`sin < 0.85`); `perpendicularCrossings()` then pins the crossing square (hard inside the ±7 m corridor, cos-blend out to `CROSS_ZONE` 24 m). | `railRoute.ts` |
| R8 | **The rail never lies on a road.** Parallel is fine (with clearance), crossing square is fine, overlap is not. `clearancePush()` pushes any near-parallel stretch within 10 m of a street line out to 11.5 m clearance. Known residual: a couple of ≤12 m marginal brushes per some seeds (seam between two crossings' pin zones) — do not let this grow. | `railRoute.ts` `clearancePush` |
| R9 | **Nothing built touches the track:** lots ≥16 m, street lamps ≥9 m from the rail centreline. | `cityPlan.ts addLot`, `cityChunk.ts` lamp guard |
| R10 | **Crossings are recorded only for true crossings** of a street line (including samples exactly ON the line, but a tangent touch is not a crossing), kept ≥6 m from a junction node — the deformer slides node-adjacent hits out to mid-block first. | `cityPlan.ts collectCrossings`, `railRoute.ts` |
| R11 | **Crossing arc distance `d` must come from cumulative arc length.** The deformed rail is NOT evenly spaced (crossing pins cram samples to ~0.2 m); a linear index→arc map misplaces `d` and mistimes every barrier. | `cityPlan.ts` `railCum` |
| R12 | **Every crossing has four posts** (two per road approach, one on each shoulder), each with a crossbuck, flashing lamp pair and a boom. **Each boom yaws across the carriageway** — on V streets the east/west shoulder yaws are opposites (`±π/2`); a boom pointing along the road blocks nothing. Arms grow along local +z; `pivot.rotation.x = -BOOM_UP` raises. | `transit.ts makeCrossing` |
| R13 | **Booms + lamps warn at `CROSSING_WARN_DIST` (60 m)** and the car AI holds at the same distance — keep the two in sync via the shared constant. | `transit.ts`, `traffic.ts` |
| R14 | **The rail is a deformed polyline (`polyPath`), not a spline.** Never rebuild it through `makePath`/a smoother — re-smoothing undoes the perpendicular crossings. After the tram rectangle is reserved, the plan calls `resquareRail()` with the COMPLETE street set (lattice + corridors + tram sides) — the deformer must know every street. | `railRoute.ts finalize/resquareRail`, `cityPlan.ts` |
| R15 | **Kenney templates have non-native origins/sizes.** The railroad tile sits ~1 m below its own origin (measure minY and lift — `bakeRails`); road kit tiles are 1 m native. `bakeModel`'s `s3` is a raw scale vector applied *before* rotation. Always probe native bounds before placing a template. | `railRoute.ts`, `assets.ts` |
| R16 | Trains stop at plan stations; `Trains.distTo` answers crossing queries with arc distances. | `train.ts` |

## World structure

| # | Rule | Enforced in |
|---|------|-------------|
| R17 | **The plan is the single source of truth.** `cityPlanFor(bx, by)` decides streets, junctions, crossings, bridges, lots, districts; chunks/transit/traffic/minimap/trains only replay it. Never bake geometry that disagrees with the plan. | `cityPlan.ts` |
| R18 | **Determinism: same seed ⇒ same city.** All generation flows from seeded rng streams (`rng`/`chunkSeed`); no `Math.random()` in world generation. Street lines + causeway avenues come from the shared `streetLinesFor(bx, by)` so the rail and the plan can never disagree about where streets are. | `cityGrid.ts` |
| R19 | **The archipelago contract:** each (bx, by) cell is one island city; the four causeway corridors are pinned full-length, their rim tips exempt from trimming, and each corridor must meet the street web inland. Edge exits derive from the *owning* cell so neighbours always agree. | `cityPlan.ts` stage 3b, `cityGrid.ts` |
| R20 | New games roll a fresh seed and write it into the URL; `?seed` replays a world exactly. Default player vehicle is the helicopter (`?vehicle=` switches; race mode uses the kart). | `index.ts` |
| R21 | Per-city systems stream and LRU (transit keep-4, scenery keep-3, chunks by view radius). Everything must survive crossing a strait and coming back. | `chunks.ts`, `transit.ts`, `scenery.ts` |

## Verification workflow

- **Audit (numbers beat vibes):** `npx tsx tools/audit-world.ts <seed>` checks
  R1, R7 (≤8° deviation), R8 (no near-parallel rail run <7 m from a road
  centreline for ≥12 m), R9, R10 indirectly (crossing count > 0), R19.
  Extend this tool whenever you add a rule — one rule, one check. Known
  acceptable residual: up to ~2 marginal ≤12 m rail brushes per seed between
  two crossings' pin zones; anything longer or more frequent is a regression.
- **Gates:** `npx tsc --noEmit && npx vite build`.
- **Visual:** dev server runs on port 8321 (reuse the running one). Load
  `play/city.html?seed=N&debugsea=1` — `window.__dbg` exposes
  scene/camera/renderer/player/trains/traffic/transit/chunks/route(). Take
  screenshots via canvas readback
  (`renderer.render(...); renderer.domElement.toDataURL('image/png')`) — the
  IAB `tab.screenshot()` works only once per tab. Teleport by assigning
  `__dbg.player.state.x/z`, then wait ~2 s for chunk streaming. The live loop
  owns the camera in chase modes; pose it inside the same `evaluate` that
  renders.
- **Find things fast:** signalized junctions = `__dbg.chunks.chunks` entries
  with `.lights` (post world positions are the *children*'s positions, not the
  group's); crossings = `__dbg.transit.list()`; rail geometry =
  `__dbg.route().pts`.
