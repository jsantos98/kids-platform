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
| R1 | **No road ends in open space, and the web is ONE piece.** Every street tip ends at a cross street (the four causeway mouths are the only sanctioned loose ends), and every street node connects to the same component — the segment vetoes can strand little "private" roads, so prune again after them; the audit counts components. | `cityPlan.ts` trim + stage 4c prune, `audit-world.ts` |
| R2 | **Streets are Kenney kit tiles.** The straight piece IS the carriageway (full-width asphalt slab, markings baked in): `ROAD_TILE = 14`, length axis local X, three pieces per open 64 m edge (offsets 10.67/32/53.33). Nodes overlay `road-crossroad` (4 arms), the `road-intersection` T-piece (3 arms, closed edge facing the missing arm — arms must be read unfiltered from segH/segV), the `road-curve` 2×2 piece (23.5 m unit, arms on the quarter lines → offset half a unit toward the bend) and `road-end` at causeway mouths. The procedural slab path remains only as the fallback when the kit fails to load. | `cityChunk.ts` road stage, `kitdefs.ts` |
| R3 | **Junctions are kit intersection/curve tiles**, never a wider procedural pad. | `cityChunk.ts` node overlay |
| R3b | **No hard 90° asphalt corners.** The tile path covers bends with the kit's curve piece; the legacy slab path rounds inner corners with fillet discs (r5) and L elbows with r7 discs. | `cityChunk.ts` |
| R4 | **Markings come from the kit tiles** (centre line, lane lines, crosswalks on junction pieces); the tiles carry no pavement skirts — the district slab is the surroundings. In the legacy path, kerbs + dashes break only at open junctions (plus/T/L, plaza). | `cityChunk.ts` |
| R5 | Carriageway is 14 m (`ROAD_HALF = 7`; the kit tile is full-width road at `ROAD_TILE = 14`). Lane logic (traffic ±3.5 m, kerbs ±6.9, lamps ±7.8, lots ≥8.1) depends on it. | `cityChunk.ts`, `traffic.ts`, `cityPlan.ts` |
| R6 | **Traffic lights only where roads cross AND buildings surround them** — a signalized node is ≥3 street arms whose four neighbouring chunks are all urban/downtown/industrial, so no pole ever stands alone in the grass. Lights are SYNCHRONIZED into a green wave (`lights.ts`: phase shifts 8 s per 64 m of x+z); poles stand at ±12.5 m off the node, cars stop at `STOP_LINE` 18.5 m. | `cityPlan.ts signalized`, `lampProps.ts`, `lights.ts` |

## Railway

| # | Rule | Enforced in |
|---|------|-------------|
| R7 | **The rail crosses streets only perpendicular.** Route scoring heavily penalizes shallow crossings (<59°, +20 each) and junction-corner cuts (street hits <30 m of arc apart, +50, and threading within 14 m of a node). `perpendicularCrossings()` then pins every hit square: absolute across the asphalt (perpendicular distance < 7 m) within a ±30 m street window, plus a cos-blend by arc whose core and zone shrink where hits crowd. Points claimed by two crossings' walls (shared asphalt) are pinned by neither — a later wall would crush an earlier wall's spread. Same-line hits <26 m of arc apart fold into one crossing, and the plan clusters recorded crossings at ≤30 m — an unmerged close pair would leave an on-asphalt jog between two walls (the "W" ride). The wall's edge ramps 7→12 m off the line, so the kerb-edge transition may lean while the travelled asphalt stays square; the bar is 25° worst in-corridor skew (measured at |d| < 6.5 m within ±24 m of the crossing, sampled every 2 m along chords). | `railRoute.ts`, `cityPlan.ts` |
| R8 | **The rail never lies on a road.** Parallel-with-clearance is fine, a square crossing is fine, overlap is not. `clearancePush()` runs BEFORE the pins (a graze pinned in place stays a 30 m skim along the asphalt) and iterates until clean: any point headed within 55° of a street's direction inside 10 m of it is displaced sideways to 11.5 m. The spread to neighbours is max-magnitude with decay, NEVER a mean — averaging dilutes a lone violation back onto the asphalt. Within ±12 m of a recorded crossing the pin owns the geometry (no push); a crossing too close to a node to record (<12 m) is swung whole to its majority side so it re-forms mid-block — pushing both its sides apart only tears the path into a hairpin. | `railRoute.ts` |
| R8b | **A route ships only if its deformation provably worked.** `shapeQuality()` re-checks the finished path against the same numbers the audit uses (on-road rides, path folds, crossing skew) and `buildRoute()` deforms the top-scoring candidates in order, shipping the first clean one. The deform has rare bad modes on adversarial splines; a dirty result must cost a re-roll, never a shipped city. | `railRoute.ts buildRoute` |
| R9 | **Nothing built touches the track:** lots ≥16 m, street lamps ≥9 m from the rail centreline. | `cityPlan.ts addLot`, `cityChunk.ts` lamp guard |
| R10 | **A crossing never shares a square with a junction, and no crossing goes barrierless.** True street-line crossings only (a tangent touch is not a crossing), recorded ≥18 m from a junction node — barrier posts reach 9.4 m up the road, so anything closer would put a crossbar inside the junction. Any non-exit segment the rail crosses within 18 m of a node is DROPPED (the dead-end trim repairs the web); EXIT corridors can never be dropped, so a node-adjacent crossing on one of them is recorded anyway — barriers beat a bare crossing. The audit fails any rail × open-street crossing without a recorded crossing. | `cityPlan.ts collectCrossings` + stage 4c, `audit-world.ts` |
| R11 | **Crossing arc distance `d` must come from cumulative arc length.** The deformed rail is NOT evenly spaced (crossing pins cram samples to ~0.2 m); a linear index→arc map misplaces `d` and mistimes every barrier. | `cityPlan.ts` `railCum` |
| R12 | **Every crossing has four posts** (two per road approach, one on each shoulder), each with a crossbuck, flashing lamp pair and a boom. **Each boom yaws across the carriageway** — on V streets the east/west shoulder yaws are opposites (`±π/2`); a boom pointing along the road blocks nothing. Arms grow along local +z; `pivot.rotation.x = -BOOM_UP` raises. | `transit.ts makeCrossing` |
| R13 | **Booms + lamps warn at `CROSSING_WARN_DIST` (60 m)** and the car AI holds at the same distance — keep the two in sync via the shared constant. | `transit.ts`, `traffic.ts` |
| R14 | **The rail is a deformed polyline (`polyPath`), not a spline.** Never rebuild it through `makePath`/a smoother — re-smoothing undoes the perpendicular crossings. Sharp corners get normalized by `roundCorners()` (apex replaced by two points ~32% down each leg, then a clearance push so a cut can't skim asphalt); `deSpikes()` repairs reversals and spliced U-turns on a re-densified copy. | `railRoute.ts finalize/deform` |
| R15 | **Kenney templates have non-native origins/sizes.** The railroad tile sits ~1 m below its own origin (measure minY and lift — `bakeRails`); road kit tiles are 1 m native. `bakeModel`'s `s3` is a raw scale vector applied *before* rotation. Always probe native bounds before placing a template. | `railRoute.ts`, `assets.ts` |
| R16 | Trains stop at plan stations; `Trains.distTo` answers crossing queries with arc distances. | `train.ts` |

## The occupancy grid

| # | Rule | Enforced in |
|---|------|-------------|
| R22 | **Never rail over river over road.** Where the rail sits in the water, no road bridge may sit within 24 m — a trestle sharing the water with a bridge is the one rail/river/road pileup the world forbids. Enforced three ways: the route scorer makes bridge-zone river crossings decisively expensive (+120/run), `shapeQuality` counts trestle-near-bridge runs and the quality gate re-rolls tainted candidates, and `cityPlan` drops (or refuses to pin) any street segment whose bridge would clash with a trestle span — the dead-end trim repairs the web. | `railRoute.ts`, `cityPlan.ts bridgeClash` |
| R23 | **The occupancy grid is the shared authority on what occupies where.** `occupancyFor(bx,by)` paints river, streets, plazas, rail and lots into one 1 m bitmask per city (ROAD=1, RAIL=2, RIVER=4, LOT=8, PLAZA=16; overlaps OR together — ROAD\|RAIL is a crossing, ROAD\|RIVER a bridge, RAIL\|RIVER a trestle). EVERY prop/lamp/traffic-light/pedestrian placement asks the grid (`claims`) instead of hand-rolling distance checks against individual generators — `nearStreet` is gone. Forbidden combinations (LOT over street/track/water/plaza, and R22's triple) must count zero; `tools/audit-world.ts` scans the grid every run. Lot footprints (not just centres) must clear the river, and no two lots may overlap — `addLot` checks corners and rect-overlap with a 2.5 m margin. Tree rows check LOT with an own-lot exemption so a wandering tree never lands in a neighbouring building. | `grid.ts`, `cityChunk.ts`, `lampProps.ts`, `pedestrians.ts`, `cityPlan.ts addLot`, `audit-world.ts` |
| R24 | **The railway is one continuous welded loop — track tiles must connect.** `bakeRails` emits each piece as the exact chord between shared end vertices (mitred corner-to-corner, never oriented by a stale run heading), subdividing the deformed polyline's long segments first and capping how far a piece bows off the path. `deform` repairs hairpins (`deSpikes`): exact reversals lose their apex; a >120° U-turn smeared over three short segments has its two middle vertices spliced out, and whenever anything was spliced the crossing tail re-runs on a re-densified (≤2 m) copy — pins cannot grip a 30 m chord straddling a street. No fallback may ship a folded route; the audit fails reversals and windowed hairpins alike. | `railRoute.ts bakeRails/deSpikes/deform`, `audit-world.ts` |
| R26 | **The river obeys the same geometry laws as the streets.** It lives inside ONE north-south corridor between two lattice lanes (never crossing or riding beneath a N-S street — no river-under-road), reaches the ocean on both ends (shore to shore, no stopping mid-island), and is straightened to flow due south across every E-W street line (`straightenAtStreets`, two passes) so bridges meet it at a right angle — never 45°. Wobble budget ±18 m keeps water + banks ~13 m clear of the bounding lanes. | `riverRoute.ts`, `audit-world.ts` (R26) |
| R27 | **Trestles meet the water at a right angle too.** `riverPerp()` pins every in-water stretch onto the river's normal through the stretch midpoint (weight 1 in the water, cosine fade outside) and runs with the LAST word in `deform` — street swings upstream may not leave a skewed trestle. The scorer penalizes skewed water crossings, `shapeQuality` counts worst in-water skew (accept <30°), and the audit fails shipped routes over 30°. | `railRoute.ts riverPerp/shapeQuality/tryRoute`, `audit-world.ts` |
| R25 | **Neighbouring seeds grow visibly different cities.** `chunkSeed` finishes with a full murmur3 avalanche — multiplication alone keeps low bits linear in the seed, so seeds 7 and 8 ran partially-correlated streams. The macro layout is seeded too, not fixed: per-city street-line density (keep 0.38–0.72), per-corner nature biomes (occasionally city), and an oval-vs-round rail ring of varying radius. The audit compares seeds S/S+1 and S+1/S+2 on street lines, segments, district map and rail shape (R25 thresholds) and fails a pair that reads alike. | `engine/rng.ts`, `cityGrid.ts`, `cityPlan.ts`, `railRoute.ts`, `audit-world.ts` |

## World structure

| # | Rule | Enforced in |
|---|------|-------------|
| R17 | **The plan is the single source of truth.** `cityPlanFor(bx, by)` decides streets, junctions, crossings, bridges, lots, districts; chunks/transit/traffic/minimap/trains only replay it. Never bake geometry that disagrees with the plan. | `cityPlan.ts` |
| R18 | **Determinism: same seed ⇒ same city.** All generation flows from seeded rng streams (`rng`/`chunkSeed`); no `Math.random()` in world generation. `chunkSeed` folds each coordinate through its own imul avalanche — an XOR-only mix silently mapped opposite corners onto each other (city (−1,−1) was a clone of (1,1)). Street lines + causeway avenues come from the shared `streetLinesFor(bx, by)` so the rail and the plan can never disagree about where streets are. | `cityGrid.ts`, `engine/rng.ts` |
| R19 | **The archipelago contract:** each (bx, by) cell is one island city; the four causeway corridors are pinned full-length, their rim tips exempt from trimming, and each corridor must meet the street web inland. Edge exits derive from the *owning* cell so neighbours always agree. | `cityPlan.ts` stage 3b, `cityGrid.ts` |
| R20 | New games roll a fresh seed and write it into the URL; `?seed` replays a world exactly. Default player vehicle is the helicopter (`?vehicle=` switches). The old `?race=1` circuit mode is REMOVED together with the map's race track — racing will be rebuilt differently later; don't resurrect `racetrack.ts`. | `index.ts` |
| R21 | Per-city systems stream and LRU (transit keep-4, scenery keep-3, chunks by view radius). Everything must survive crossing a strait and coming back. | `chunks.ts`, `transit.ts`, `scenery.ts` |

## Verification workflow

- **Audit (numbers beat vibes):** `npx tsx tools/audit-world.ts <seed>` checks
  R1, R7 (worst in-corridor skew ≤25°: the rail's worst angle to the street
  while on its asphalt, |d| < 6.5 m, ±24 m along), R8 (no near-parallel rail
  run <7 m from a road centreline for ≥8 m), R9, R10 indirectly (crossing
  count > 0), R19, R24 (zero hairpin folds on any shipped route), R25
  (seeds S/S+1/S+2 must grow visibly different cities), R26 (river inside
  its lane, shore to shore, perpendicular street crossings), R27 (zero
  trestle skew), and — via the occupancy grid — R22/R23 (zero forbidden
  combination cells). Extend this tool whenever you add a rule — one rule,
  one check. Zero tolerance: the deform modes are seed-dependent, so sweep
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
