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
| R2 | **Streets are the complete Kenney City Kit Roads** (`public/assets/kenney/city-roads/`), every piece laid at ONE uniform unit, `ROAD_TILE = 14` — the kit straight's full cross-section (kerb strip, gutter, asphalt, centre line) IS the R5 carriageway. `roadLayout.ts` decides every piece: each street node owns one pad — `road-crossroad` (4 arms), `road-intersection` T (3 arms; native closed side −z), `road-bend` (2 arms at a right angle; native joins west+south), `road-straight` (2 arms in line) or the 3×3 `road-roundabout` at plazas; the four causeway mouths own no pad. Straights fill ONLY the span between two pads (`n = round(span/14)`, straight length axis = local X). Arms are read unfiltered from segH/segV. The procedural slab path remains only as the fallback when the kit fails to load. | `roadLayout.ts`, `cityChunk.ts` road stage, `kitdefs.ts` |
| R3 | **Junctions are kit pads**, never a wider procedural pad. Signalized pads use the `-path` variants (crosswalks). | `roadLayout.ts nodePiece` |
| R3b | **No hard 90° asphalt corners.** Bends take the kit's `road-bend` (rounded outer kerb); the legacy slab path rounds inner corners with fillet discs (r5) and L elbows with r7 discs. Never scale the 2×2 `road-curve` to stand in for a bend — at 47 m it missed the straights and overlapped them by 35 m. | `roadLayout.ts`, `cityChunk.ts` |
| R4 | **Markings come from the kit tiles** (centre line, lane lines, crosswalks on junction pads). Built districts add a sidewalk band from the tile edge to the lot line (7 → 8.1 m) in the kit's pavement colour, along the span between pads, around junction corners, past a T's closed side, up to a roundabout's kerb flare, and broken at river bridges. In the legacy path, kerbs + dashes break only at open junctions (plus/T/L, plaza). | `cityChunk.ts` |
| R35 | **Road pieces never overlap, and they cover every street end to end.** No piece is laid on another (overlapping kerb bands cut across junctions and z-fight); pad reach + straights = 64 m on every open segment. Plazas are roundabouts (4-arm nodes only, ≥33 m from the rail, ≥37 m from the river); lots and the occupancy grid's PLAZA disc keep 21 m clear; traffic circles the ring counter-clockwise at 9 m (right-hand traffic) and pedestrians turn back before it. | `roadLayout.ts`, `cityPlan.ts` plazas + `addLot`, `traffic.ts roundPath`, `audit-world.ts` |
| R5 | Carriageway is 14 m (`ROAD_HALF = 7`; the kit tile is full-width road at `ROAD_TILE = 14`). Lane logic (traffic ±3.5 m, kerbs ±6.9, lamps ±7.8, lots ≥8.1) depends on it. | `cityChunk.ts`, `traffic.ts`, `cityPlan.ts` |
| R6 | **Traffic lights only where roads cross AND buildings surround them** — a signalized node is ≥3 street arms whose four neighbouring chunks are all urban/downtown/industrial, so no pole ever stands alone in the grass. Lights are SYNCHRONIZED into a green wave (`lights.ts`: phase shifts 8 s per 64 m of x+z). They are the kit `traffic-light` with dynamic red/yellow/green lamps: one pole per approach arm, on the approaching driver's near-side right corner at ±8.6 m, lamp face turned toward that approach (`TRAFFIC_POLES`); cars stop at `STOP_LINE` 18.5 m. | `cityPlan.ts signalized`, `roadLayout.ts TRAFFIC_POLES`, `lampProps.ts`, `lights.ts` |

## Railway

| # | Rule | Enforced in |
|---|------|-------------|
| R7 | **The rail crosses streets only perpendicular.** Route scoring heavily penalizes shallow crossings (<59°, +20 each) and junction-corner cuts (street hits <30 m of arc apart, +50, and threading within 14 m of a node). `perpendicularCrossings()` then pins every hit square: absolute across the asphalt (perpendicular distance < 7 m) within a ±30 m street window, plus a cos-blend by arc whose core and zone shrink where hits crowd. Points claimed by two crossings' walls (shared asphalt) are pinned by neither — a later wall would crush an earlier wall's spread. Same-line hits <26 m of arc apart fold into one crossing, and the plan clusters recorded crossings at ≤30 m — an unmerged close pair would leave an on-asphalt jog between two walls (the "W" ride). The wall's edge ramps 7→12 m off the line, so the kerb-edge transition may lean while the travelled asphalt stays square; the bar is 25° worst in-corridor skew (measured at |d| < 6.5 m within ±24 m of the crossing, sampled every 2 m along chords). | `railRoute.ts`, `cityPlan.ts` |
| R8 | **The rail never lies on a road.** Parallel-with-clearance is fine, a square crossing is fine, overlap is not. `clearancePush()` runs BEFORE the pins (a graze pinned in place stays a 30 m skim along the asphalt) and iterates until clean: any point headed within 55° of a street's direction inside 10 m of it is displaced sideways to 11.5 m. The spread to neighbours is max-magnitude with decay, NEVER a mean — averaging dilutes a lone violation back onto the asphalt. Within ±12 m of a recorded crossing the pin owns the geometry (no push); a crossing too close to a node to record (<12 m) is swung whole to its majority side so it re-forms mid-block — pushing both its sides apart only tears the path into a hairpin. | `railRoute.ts` |
| R8b | **A route ships only if its deformation provably worked.** `shapeQuality()` re-checks the finished path against the same numbers the audit uses (on-road rides, path folds, crossing skew) and `buildRoute()` deforms the top-scoring candidates in order, shipping the first clean one. The deform has rare bad modes on adversarial splines; a dirty result must cost a re-roll, never a shipped city. | `railRoute.ts buildRoute` |
| R9 | **Nothing built touches the track:** lots ≥16 m, street lamps ≥9 m from the rail centreline. | `cityPlan.ts addLot`, `cityChunk.ts` lamp guard |
| R10 | **A crossing never shares a square with a junction, and no crossing goes barrierless.** True street-line crossings only (a tangent touch is not a crossing), recorded ≥18 m from a junction node — barrier posts reach 9.4 m up the road, so anything closer would put a crossbar inside the junction. Any non-exit segment the rail crosses within 18 m of a node is DROPPED (the dead-end trim repairs the web); EXIT corridors can never be dropped, so a node-adjacent crossing on one of them is recorded anyway — barriers beat a bare crossing. The audit fails any rail × open-street crossing without a recorded crossing. | `cityPlan.ts collectCrossings` + stage 4c, `audit-world.ts` |
| R11 | **Crossing arc distance `d` must come from cumulative arc length.** The deformed rail is NOT evenly spaced (crossing pins cram samples to ~0.2 m); a linear index→arc map misplaces `d` and mistimes every barrier. | `cityPlan.ts` `railCum` |
| R12 | **Every crossing has four posts** (two per road approach, 9.4 m up/down the street, one on each shoulder 7.6 m out), each with a crossbuck, flashing lamp pair and a boom. **Each boom yaws across the carriageway**: everything derives from the crossing's street `heading` (u = street direction, n = its normal); a post's local +z points back toward the centre line, so opposite shoulders always get opposite yaws — a boom pointing along the road blocks nothing. Arms grow along local +z; `pivot.rotation.x = -BOOM_UP` raises. | `transit.ts makeCrossing` |
| R13 | **Booms + lamps warn at `CROSSING_WARN_DIST` (60 m)** and the car AI holds at the same distance — keep the two in sync via the shared constant. | `transit.ts`, `traffic.ts` |
| R14 | **The rail is a deformed polyline (`polyPath`), not a spline.** Never rebuild it through `makePath`/a smoother — re-smoothing undoes the perpendicular crossings. Sharp corners get normalized by `roundCorners()` (apex replaced by two points ~32% down each leg, then a clearance push so a cut can't skim asphalt); `deSpikes()` repairs reversals and spliced U-turns on a re-densified copy. | `railRoute.ts finalize/deform` |
| R15 | **Kenney templates have non-native origins/sizes.** The railroad tile sits ~1 m below its own origin (measure minY and lift — `bakeRails`); road kit tiles are 1 m native. `bakeModel`'s `s3` is a raw scale vector applied *before* rotation. Always probe native bounds before placing a template. | `railRoute.ts`, `assets.ts` |
| R16 | Trains stop at plan stations; `Trains.distTo` answers crossing queries with arc distances. | `train.ts` |

## The occupancy grid

| # | Rule | Enforced in |
|---|------|-------------|
| R22 | **Never rail over river over road.** Where the rail sits in the water, no road bridge may sit within 24 m — a trestle sharing the water with a bridge is the one rail/river/road pileup the world forbids. Enforced three ways: the route scorer makes bridge-zone river crossings decisively expensive (+120/run), `shapeQuality` counts trestle-near-bridge runs and the quality gate re-rolls tainted candidates, and `cityPlan` drops (or refuses to pin) any street segment whose bridge would clash with a trestle span — the dead-end trim repairs the web. | `railRoute.ts`, `cityPlan.ts bridgeClash` |
| R23 | **The occupancy grid is the shared authority on what occupies where.** `occupancyFor(bx,by)` paints river, streets, plazas, rail and lots into one 1 m bitmask per city (ROAD=1, RAIL=2, RIVER=4, LOT=8, PLAZA=16, SEA=32, DECK=128; overlaps OR together — ROAD\|RAIL is a crossing, ROAD\|RIVER a bridge, RAIL\|RIVER a trestle). EVERY prop/lamp/traffic-light/pedestrian placement asks the grid (`claims`) instead of hand-rolling distance checks against individual generators — `nearStreet` is gone. Forbidden combinations (LOT over street/track/water/plaza, and R22's triple) must count zero; `tools/audit-world.ts` scans the grid every run. Lot footprints (not just centres) must clear the river, and no two lots may overlap — `addLot` checks corners and rect-overlap with a 2.5 m margin. Tree rows check LOT with an own-lot exemption so a wandering tree never lands in a neighbouring building. | `grid.ts`, `cityChunk.ts`, `lampProps.ts`, `pedestrians.ts`, `cityPlan.ts addLot`, `audit-world.ts` |
| R24 | **The railway is one continuous welded loop — track tiles must connect.** `bakeRails` emits each piece as the exact chord between shared end vertices (mitred corner-to-corner, never oriented by a stale run heading), subdividing the deformed polyline's long segments first and capping how far a piece bows off the path. `deform` repairs hairpins (`deSpikes`): exact reversals lose their apex; a >120° U-turn smeared over three short segments has its two middle vertices spliced out, and whenever anything was spliced the crossing tail re-runs on a re-densified (≤2 m) copy — pins cannot grip a 30 m chord straddling a street. No fallback may ship a folded route; the audit fails reversals and windowed hairpins alike. | `railRoute.ts bakeRails/deSpikes/deform`, `audit-world.ts` |
| R26 | **The river obeys the same geometry laws as the streets.** It lives inside ONE north-south corridor between two lattice lanes (never crossing or riding beneath a N-S street — no river-under-road), reaches the ocean on both ends (shore to shore, no stopping mid-island), and is straightened to flow due south across every E-W street line (`straightenAtStreets`, two passes) so bridges meet it at a right angle — never 45°. Wobble budget ±18 m keeps water + banks ~13 m clear of the bounding lanes. | `riverRoute.ts`, `audit-world.ts` (R26) |
| R27 | **Trestles meet the water at a right angle too.** `riverPerp()` pins every in-water stretch onto the river's normal through the stretch midpoint (weight 1 in the water, cosine fade outside) and runs with the LAST word in `deform` — street swings upstream may not leave a skewed trestle. The scorer penalizes skewed water crossings, `shapeQuality` counts worst in-water skew (accept <30°), and the audit fails shipped routes over 30°. | `railRoute.ts riverPerp/shapeQuality/tryRoute`, `audit-world.ts` |
| R28 | **Railway never overlaps itself.** No two non-adjacent stretches of the loop come within 3.6 m (the 3.4 m bed width) — needle folds are spliced out by the de-overlapper in the deform pipeline, and trains brake for the consist ahead so consists never stack. | `railRoute.ts` deOverlap, `train.ts` update, audit R28 |
| R25 | **Neighbouring seeds grow visibly different cities.** `chunkSeed` finishes with a full murmur3 avalanche — multiplication alone keeps low bits linear in the seed, so seeds 7 and 8 ran partially-correlated streams. The macro layout is seeded too, not fixed: per-city street-line density (keep 0.38–0.72), per-corner nature biomes (occasionally city), and an oval-vs-round rail ring of varying radius. The audit compares seeds S/S+1 and S+1/S+2 on street lines, segments, district map and rail shape (R25 thresholds) and fails a pair that reads alike. | `engine/rng.ts`, `cityGrid.ts`, `cityPlan.ts`, `railRoute.ts`, `audit-world.ts` |

## World structure

| # | Rule | Enforced in |
|---|------|-------------|
| R36 | **Everything that moves on or navigates the roads asks the street graph** (`streetGraph.ts`: nodes, straight edges, crossings seated on edges, `nearest`/`sample`/`route`/`phaseOf`) — traffic, pedestrians, mission sites, crash resumes, the guide route, the spawn, the minimap. Only the lattice generator (`cityPlan.ts`), its renderer (`roadLayout.ts`, `cityChunk.ts`), the occupancy painter and the audit read `segH/segV`. The rail deforms against `StreetLine`s (`streetLines.ts`: origin, direction, normal, family, `nodeGap`), never raw H/V line numbers. The audit checks the graph mirrors the plan (one edge per segment, every crossing seated, one component, dead ends only at mouths). | `streetGraph.ts`, `streetLines.ts`, `audit-world.ts` |
| R17 | **The plan is the single source of truth.** `cityPlanFor(bx, by)` decides streets, junctions, crossings, bridges, lots, districts; chunks/transit/traffic/minimap/trains only replay it. Never bake geometry that disagrees with the plan. | `cityPlan.ts` |
| R18 | **Determinism: same seed ⇒ same city.** All generation flows from seeded rng streams (`rng`/`chunkSeed`); no `Math.random()` in world generation. `chunkSeed` folds each coordinate through its own imul avalanche — an XOR-only mix silently mapped opposite corners onto each other (city (−1,−1) was a clone of (1,1)). Street lines + causeway avenues come from the shared `streetLinesFor(bx, by)` so the rail and the plan can never disagree about where streets are. | `cityGrid.ts`, `engine/rng.ts` |
| R19 | **The archipelago contract:** each (bx, by) cell is one island city; the four causeway corridors are pinned full-length, their rim tips exempt from trimming, and each corridor must meet the street web inland. Edge exits derive from the *owning* cell so neighbours always agree, and are drawn only from the central lines (4…10) so every corridor lands on a headland. | `cityPlan.ts` stage 3b, `cityGrid.ts` |
| R29 | **The island has a real shore, and the sea carries nothing built but causeway decks.** `coastFor(bx,by)` is the one authority on land vs sea: a seeded star polygon (harmonic bays, never past the rim − 14 m) with headlands swelling toward the four causeway portals. Streets keep their whole carriageway ≥11 m inland (pad corners reach 9.9 m), lots keep centre ≥4 m and corners ≥2 m inland, stations 25 m, and a rail route with any sample <12 m from the sea never ships (`shapeQuality.offLand` gates it; the scorer pulls control points inland). Causeway decks span exactly from our last dry land on the corridor to the neighbour's first (`causewaySpan`), baked by the chunk holding our shore point. Chunks wholly off the shore are never built; the boat lane, buoys, foam ring, pier, sea spawn, walkers and both shore walls derive from the same polygon — boats slide along the beach (`onLand`), road vehicles along the waterline (`onGround`: land, causeway decks, the picnic bridge + isle), a scrape never a crash. The grid paints SEA off the shore and DECK over the exit corridors; the audit fails any SEA cell carrying LOT/RAIL/PLAZA, or ROAD without DECK. | `coast.ts`, `cityPlan.ts offLand/addLot`, `railRoute.ts`, `cityChunk.ts`, `grid.ts`, `sea.ts`, `player.ts onLand/onGround`, `audit-world.ts` (R29) |
| R20 | New games roll a fresh seed and write it into the URL; `?seed` replays a world exactly. `?mode=` picks the play mode (`modes.ts`: truck, police, ambulance, heliMedical, heliPolice, plane, boat, train); the default is the medical helicopter, and old `?vehicle=` links alias onto modes. The old `?race=1` circuit mode is REMOVED together with the map's race track — racing will be rebuilt differently later; don't resurrect `racetrack.ts`. | `index.ts` |
| R21 | Per-city systems stream and LRU (transit keep-4, scenery keep-3, island simulations keep-4, chunks by view radius). Everything must survive crossing a strait and coming back. | `chunks.ts`, `transit.ts`, `scenery.ts`, `island/manager.ts` |

## Gameplay feel

| # | Rule | Enforced in |
|---|------|-------------|
| G1 | **A bump or a stuck truck never strands the kid.** A crash flashes the vehicle and resumes it at a breadcrumb: a spot recorded while driving (every 0.4 s) on street asphalt, snapped to the right-hand lane and the street's direction, mid-block, clear of track/water/roundabouts and solid boxes, ≥6 m behind the crash. With no crumb, the nearest open lane; never "round to the lattice line" (that landed on dropped streets, rivers and lots). Gas held 3 s with <1 m of progress triggers the same resume. | `breadcrumb.ts`, `player.ts startCrash`, `index.ts` |
| G2 | **Guidance points where the kid should steer, relative to the screen.** The HUD badge arrow rotates by `cameraYaw − bearing`; road vehicles aim at the next junction of the shortest street-graph route (`StreetGraph.route`), straight at the call within 45 m or when flying. A floating 3D arrow over the vehicle points the same way, and every call has a tall fog-free beacon pillar. Calls stand 11 m out on a junction diagonal (past the 8.6 m signal poles, short of the 12 m corner lots), never two on one corner. | `index.ts guideWaypoint`, `guide3d.ts`, `missions.ts` |

| G3 | **Every mode is simple and can't fail hard.** Each `ModeDef` names its vehicle, its calls (fire/cat/patient rotation) and/or a checkpoint course (6 seeded gates: street arches, sky rings, sea buoys — `course.ts`) or station stops. The plane never drops below its minimum speed and climbs/dives to the next ring by itself; the helicopter holds 16 m; the boat's shore is a soft wall; the kid's train is capped behind the train ahead and eases to a crawl on the station approach (stop within 12 m of the platform). Only road vehicles use crumbs/stuck resumes and street routing. | `modes.ts`, `player.ts`, `course.ts`, `train.ts`, `index.ts` |

| G4 | **Missions play in their own scene, with the wheel only.** Arriving at a call (stopped beside it; the helicopter hovering over it) fades the world out and the call's scene in (`activity/director.ts`); the world keeps simulating, only the player is frozen, and the scene's input is one steer axis (+1 = right on screen: wheel, A/D, or the mouse's x). Hose: the wheel swings it, up/down bounces by itself, the stream douses the one flame it's nearest (holding still can never finish a fire). Cat ladder: under the cat the ladder locks; moving it >0.6 m while the cat climbs makes the cat jump to another spot and progress restarts. Burning building: parked under a window column the ladder extends to that floor by itself; leaving mid-climb sends the person back up. Stretcher: it rolls by itself, steer it between the doors or it bumps back. Winch: steer against the breeze to keep the hook over the person. During the celebration the input is frozen so nothing slides away. `?scene=fire|cat|rescue|patient[&variant=][&sceneSeed=]` opens a scene directly. | `activity/*.ts`, `index.ts openCall`, `missions.ts` (variant + seed) |

| G5 | **Every island has its own fixed population, and it never teleports.** An `IslandSim` owns the island's trains, a seeded car fleet (`round(streets/160)`, 8–24), a seeded crowd of pedestrians + pets and a boat fleet; all start at seeded spots and move continuously on the street graph — cars take every node on a curve (junction Bezier through the pad, roundabout ring), U-turn at causeway mouths, queue behind the car ahead, obey lights/crossings on the GAME clock (the same one the lamps show). Nothing respawns: things far from the player are just not drawn. Cars brake for the player in the lane ahead and ease aside when close; walkers scurry away from ground vehicles and drift back to their sidewalk. The island the player is on is awake, plus the neighbour within 200 m of its shore; a dormant island catches up (≤90 s, 0.25 s steps) when it wakes. | `island/*.ts`, `sea.ts Fleet`, `transit.ts` (per-island trains) |

## Verification workflow

- **Audit (numbers beat vibes):** `npx tsx tools/audit-world.ts <seed>` checks
  R1, R7 (worst in-corridor skew ≤25°: the rail's worst angle to the street
  while on its asphalt, |d| < 6.5 m, ±24 m along), R8 (no near-parallel rail
  run <7 m from a road centreline for ≥8 m), R9, R10 indirectly (crossing
  count > 0), R19, R24 (zero hairpin folds on any shipped route), R25
  (seeds S/S+1/S+2 must grow visibly different cities), R26 (river inside
  its lane, shore to shore, perpendicular street crossings), R27 (zero
  trestle skew), R28 (the loop never overlaps itself, checked across a
  9×9-city ring), R35 (road pieces never overlap and cover every street),
  and — via the occupancy grid — R22/R23/R29 (zero forbidden combination
  cells, nothing built in the sea but causeway decks).
  Road looks: `dev-roads.html?seed=N` bakes real chunks and lists one node
  of every junction type (cross, cross-lights, T-miss-*, bend-*, pass-*,
  roundabout, end) — frame one with `&x=..&z=..&h=45&tilt=35`. Extend this tool whenever you add a rule — one rule,
  one check. Zero tolerance: the deform modes are seed-dependent, so sweep
  several seeds
  (`for s in 7 777 4242 2024 9999 3 21 5; do npx tsx tools/audit-world.ts $s; done`)
  — a clean default seed proves nothing about the seed the player rolls.
- **Gates:** `npm run typecheck` (src + tools) `&& npx vite build`.
- **Refactors that must not change the world:** `npx tsx tools/plan-hash.ts`
  before and after (13 cities × 8 seeds; `--dump dir` writes the canonical
  text for diffing). Different hashes = the refactor changed a city.
- **Visual:** dev server runs on port 8321 (reuse the running one). Load
  `play/city.html?seed=N&debugsea=1` — `window.__dbg` exposes
  scene/camera/renderer/player/trains/traffic/transit/chunks/missions/route().
  Automation tabs are usually hidden, which pauses requestAnimationFrame and
  throttles timers to 1 s: step the game with `__dbg.tick()` in a loop that
  busy-waits ~16 ms per frame (so `dt` is real), and drive input with
  `dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyW' }))`. Take
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
