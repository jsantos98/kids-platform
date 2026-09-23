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
| R7 | **The rail crosses streets only perpendicular.** Route scoring heavily penalizes shallow crossings (<59°, +20 each) and junction-corner cuts (street hits <30 m of arc apart, +50, and threading within 14 m of a node). `perpendicularCrossings()` then pins every hit square: absolute across the asphalt (perpendicular distance < 7 m) within a ±30 m street window, plus a cos-blend by arc whose core and zone shrink where hits crowd. Points claimed by two crossings' walls (shared asphalt) are pinned by neither — a later wall would crush an earlier wall's spread. Same-line hits <26 m of arc apart fold into one crossing, and the plan clusters recorded crossings at ≤30 m — an unmerged close pair would leave an on-asphalt jog between two walls (the "W" ride). The wall's edge ramps 7→9 m off the line, so the kerb-edge vertex may lean up to ~18° while the travelled asphalt stays square; the bar is 20° worst in-corridor skew (measured at |d| < 6.5 m within ±24 m of the crossing). | `railRoute.ts`, `cityPlan.ts` |
| R8 | **The rail never lies on a road.** Parallel-with-clearance is fine, a square crossing is fine, overlap is not. `clearancePush()` runs BEFORE the pins (a graze pinned in place stays a 30 m skim along the asphalt) and iterates until clean: any point headed within 55° of a street's direction inside 10 m of it is displaced sideways to 11.5 m. The spread to neighbours is max-magnitude with decay, NEVER a mean — averaging dilutes a lone violation back onto the asphalt. Within ±12 m of a recorded crossing the pin owns the geometry (no push); a crossing too close to a node to record (<12 m) is swung whole to its majority side so it re-forms mid-block — pushing both its sides apart only tears the path into a hairpin. | `railRoute.ts` |
| R8b | **A route ships only if its deformation provably worked.** `shapeQuality()` re-checks the finished path against the same numbers the audit uses (on-road rides, path folds, crossing skew) and `buildRoute()` deforms the top-scoring candidates in order, shipping the first clean one. The deform has rare bad modes on adversarial splines; a dirty result must cost a re-roll, never a shipped city. | `railRoute.ts buildRoute` |
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
| R18 | **Determinism: same seed ⇒ same city.** All generation flows from seeded rng streams (`rng`/`chunkSeed`); no `Math.random()` in world generation. `chunkSeed` folds each coordinate through its own imul avalanche — an XOR-only mix silently mapped opposite corners onto each other (city (−1,−1) was a clone of (1,1)). Street lines + causeway avenues come from the shared `streetLinesFor(bx, by)` so the rail and the plan can never disagree about where streets are. | `cityGrid.ts`, `engine/rng.ts` |
| R19 | **The archipelago contract:** each (bx, by) cell is one island city; the four causeway corridors are pinned full-length, their rim tips exempt from trimming, and each corridor must meet the street web inland. Edge exits derive from the *owning* cell so neighbours always agree. | `cityPlan.ts` stage 3b, `cityGrid.ts` |
| R20 | New games roll a fresh seed and write it into the URL; `?seed` replays a world exactly. Default player vehicle is the helicopter (`?vehicle=` switches; race mode uses the kart). | `index.ts` |
| R21 | Per-city systems stream and LRU (transit keep-4, scenery keep-3, chunks by view radius). Everything must survive crossing a strait and coming back. | `chunks.ts`, `transit.ts`, `scenery.ts` |

## Verification workflow

- **Audit (numbers beat vibes):** `npx tsx tools/audit-world.ts <seed>` checks
  R1, R7 (worst in-corridor skew ≤20°: the rail's worst angle to the street
  while on its asphalt, |d| < 6.5 m, ±24 m along), R8 (no near-parallel rail
  run <7 m from a road centreline for ≥8 m), R9, R10 indirectly (crossing
  count > 0), R19. Extend this tool whenever you add a rule — one rule, one
  check. Zero tolerance: the deform modes are seed-dependent, so sweep
  several seeds
  (`for s in 7 777 4242 2024 9999 3 21 5; do npx tsx tools/audit-world.ts $s; done`)
  — a clean default seed proves nothing about the seed the player rolls.
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
