# Destructible Terrain — Design Plan

> Branch: `destructible-terrain`. Design only (no implementation yet). Replaces
> the current flat ground + damage-grid (`terrain.js`) with a **deformable
> heightfield** plus slope-aware driving.

## Goals & constraints (from the brief)

1. **Bedrock floor** — destruction stops at a minimum depth; below is
   indestructible bedrock (visually distinct).
2. **Realistic driving** — gravity acts (uphill is slower than flat), impossible
   climbs are forbidden (too-steep ramps/walls), tank treads give a tolerance but
   the vehicle is not "superhuman."
3. **Non-linear destruction** — the explosion's *visible* radius (e.g. 5 m) can
   make a much shallower *dent* (e.g. 2 m) because the ground is hard. Smooth the
   result to minimize concavities so terrain collision/driving stays stable.

## Recommended approach: heightfield + kinematic driving

A **heightfield** (`y = h(x,z)` on a regular grid) is the right model here:

- Craters are depressions, never overhangs/caves — a heightfield can't even
  represent overhangs, which is exactly the "limit concavities" property we want.
- Slope/normal come for free (finite differences) → driving physics and
  shell-ground collision are trivial and stable.
- Smoothing is a local blur; bedrock is a min-clamp.
- Light and fast (~16k vertices), fits the arcade tone and the existing
  `step(dt)` architecture.

### Alternatives considered (and rejected)

- **Voxel + marching cubes** — supports true 3D destruction (caves/overhangs),
  but heavy mesh regen and concave geometry fight the "stable driving" goal.
  Overkill.
- **Physics engine (Rapier / cannon-es) + heightfield collider + raycast
  vehicle** — most "realistic," but a heavy dependency, hard to tune for arcade
  feel, and more than we need. Could be a later "sim mode."
- **CSG sphere subtraction** — not real-time viable.

So: **custom heightfield terrain + custom kinematic vehicle model** (no physics
engine). three.js has no built-in vehicle/terrain system, so this is hand-rolled
— deliberately, for control and perf.

## 1. Terrain representation

- A `Float32Array` height grid `(RES+1)²` over the arena, e.g. `RES = 128`
  → 1-unit cells on a 128-unit field (~16k vertices). Cell size `cell = size/RES`.
- `h(x,z)` via **bilinear interpolation** between the four surrounding samples
  (so the surface is smooth, not stair-stepped) — critical for stable driving.
- Surface **normal** via central differences on the grid (or the bilinear patch).
- `BEDROCK_Y` (e.g. −8 units): `h` is clamped to `>= BEDROCK_Y`. Cells at the
  floor are tagged bedrock (distinct color, and cratering no-ops there).
- Initial state: flat (`h = 0`), or a tiny low-amplitude noise for visual life.

### Mesh

- One indexed `BufferGeometry` with `(RES+1)²` vertices, positions displaced by
  `h`; `computeVertexNormals()` for lighting. `MeshStandardMaterial` with
  **vertex colors** by material zone: grass (high), dirt/scorched (crater
  walls), bedrock (floor). Re-paint vertex colors locally on cratering.
- On deformation, update only the affected vertex window + recompute normals in a
  slightly larger window (a crater of radius `r` touches `~(2r/cell)²` cells → a
  few hundred at most). Cheap, even per-explosion.

## 2. Destruction model (non-linear, smoothed, bedrock-clamped)

An explosion carries two independent sizes:

- `blastRadius` (combat) — the AoE that damages tanks (existing `EXPLOSION.radius`).
- `craterRadius` `Cr` + `craterDepth` `Cd` — the actual dent. **`Cd << Cr`**
  (e.g. radius 5 m, depth 2 m) → "ground is hard."

Crater step at impact `(x0, z0)`:

1. For each grid cell within `Cr`: `profile = smoothstep(1 - dist/Cr)` (1 at
   center → 0 at edge). Tentatively `h' = h - Cd * profile`.
2. Clamp `h' = max(h', BEDROCK_Y)` (bedrock). Tag floor cells.
3. **Smoothing pass**: 1–2 iterations of a small Gaussian blur over the crater
   window. Rounds sharp pits into gentle bowls → fewer steep concavities →
   stable driving + natural look.
4. **(Optional) global slope-relax**: clamp max neighbor-to-neighbor slope; pull
   any over-steep cell toward its neighbors' average. Guarantees no cell exceeds
   a driveable grade. This is the explicit "minimize concavities" lever.
5. Write back `h'`, update that mesh window + vertex colors.

Cumulative: repeated hits deepen a crater until it hits bedrock. `blastRadius`
buffs scale `Cr` (wider dent) — visible and physical.

## 3. Driving physics (slope-aware, forbids impossible climbs)

Replace today's flat XZ driving + damage-slow with a kinematic heightfield model
in `Tank.applyAction` (or a new physics step the sim calls). No physics engine.

Per frame, per tank:

1. **Slope speed (gravity)** — sample the surface normal at the current cell;
   compute the **grade** along the travel direction (rise/run, + = uphill).
   `slopeMul = clamp(1 - grade * UPHILL_COST, MIN_MUL, MAX_MUL)`. Uphill slows,
   downhill speeds (capped). This is "going up a ramp is slower than flat."
2. **Intended move** — `Δ = forward * drive * baseSpeed * slopeMul * dt` (same
   `baseSpeed` as today; damage-slow is removed — craters now slow you physically
   via their slopes).
3. **Climb limit (forbid impossible)** — sample the height at the prospective
   new cell; `moveGrade = (h(new) - h(cur)) / |Δ|`. If `moveGrade > MAX_CLIMB`
   (tread limit, e.g. `tan(35°) ≈ 0.70`), **block the uphill move** (tank stalls
   at the base / slides back). Cannot climb walls or near-vertical crater rims.
   The "treads tolerance" *is* `MAX_CLIMB`.
4. **Ground follow** — set `tank.y = h(pos) + clearance`, **lerped** per frame
   (fake suspension) so the ride is smooth over rough ground and the tank
   settles into craters. The body can pitch to the surface normal for extra
   realism (optional).
5. **(Optional, later) gravity slide** — on a slope steeper than a friction
   angle while idling, drift downhill. Defer for v1; the climb-limit + slope-speed
   already give the core feel.

Result: tanks ride the terrain, slow on climbs, can't scale impossible slopes,
and naturally bog down in cratered fields (the endgame pressure — now physical,
not a magic slow debuff). The damage-grid `slowFactor` is removed.

## 4. Integration with existing systems

- **`terrain.js`** — rewritten as the heightfield: owns `h` grid, mesh, bedrock,
  `heightAt/normalAt`, `crater(x,z,Cr,Cd)`, local mesh/color updates, `reset()`.
  Keeps the `Terrain` name/API the rest of the code already uses.
- **`renderer.js`** — `_buildGround` builds the heightfield mesh (replaces the
  flat `PlaneGeometry`); ground damage is now the geometry itself (drop the
  canvas texture). No-man's-land strip stays (it's XZ; can be flat or deformed).
- **`gamestate.js`** — explosions call `terrain.crater(...)` instead of
  `applyImpact`; explosion origin `y = heightAt(x,z)`. Shell "ground impact"
  test becomes `shell.y <= heightAt(x,z) + shellRadius` (shells now hit real
  crater rims/depths). Tank-tank, pen clamps, powerup pickup: unchanged.
- **`tank.js`** — driving uses the heightfield (ground follow + slope/climb);
  remove the `TERRAIN.slowFactor` term. Buffs (`speed`) still apply.
- **`main.js`** — spawns/powerups place at `heightAt(x,z)`; otherwise unchanged.
- **Pens / no-man's-land** — XZ bounds unchanged; the divider can be kept flat or
  allowed to crater (design choice).

## 5. Performance

- Grid 129² ≈ 16k verts, ~67 KB. One mesh, updated locally on cratering
  (hundreds of verts per blast). `heightAt/normalAt` are O(1). Tank physics is a
  handful of samples/frame. All trivial vs. the render budget.

## 6. Risks & edge cases

- **Pit-trapping**: a deep, smooth crater is intentionally hard to leave (desired
  endgame). Mitigate over-tuning: bedrock caps depth; smoothing + slope-relax
  keep rims climbable within `MAX_CLIMB`; `Cd/Cr` ratio controls how punishing.
- **Jitter on rough ground** — bilinear `heightAt` + per-frame y-lerp + local
  smoothing keep it calm.
- **Shell landing in a crater vs on a rim** — handled naturally by the
  heightfield impact test.
- **Normals at high res** — central differences on a smoothed field are stable.

## 7. Phased implementation (when we build it)

1. **Heightfield core** — grid + mesh (replace flat ground), bedrock clamp,
   `heightAt/normalAt`, flat initial state. Verify: scene shows the field.
2. **Cratering** — `crater(x,z,Cr,Cd)` with non-linear profile, smoothing,
   bedrock; vertex-color zones + exposed bedrock. Verify: explosions leave
   smoothed dents of the right depth/radius, cumulative to bedrock.
3. **Driving** — ground follow (y-lerp), slope-speed, `MAX_CLIMB` block, remove
   damage-slow. Verify: uphill slower, steep walls unclimbable, craters bog tanks.
4. **Collisions** — shell-ground test on the heightfield; explosion origin at
   surface; spawns sit on the surface. Verify: shells impact real terrain.
5. **Tuning pass** — `craterDepth/Radius` vs `blastRadius`, smoothing strength,
   `MAX_CLIMB`, `UPHILL_COST`, bedrock depth, grid resolution. Verify feel +
   endgame pressure + perf.

## 8. Tunables to add (in `constants.js`)

```
TERRAIN = { resolution: 128, bedrockY: -8,
            craterRadius: 5.0, craterDepth: 2.0,   // dent (<< blastRadius)
            smoothingPasses: 2, maxSlope: 0.9 }    // concavity limit
DRIVING  = { maxClimb: 0.70,      // tan(35°) tread limit
             uphillCost: 1.2,     // slope-speed penalty
             groundClearance: 0.15, yLerp: 0.3 }   // suspension smoothing
```
`EXPLOSION.radius` (combat AoE) stays separate from `TERRAIN.crater*` (the dent).

## 9. Open questions for you

- **Crater the no-man's-land / divider**, or keep it a flat uncrossable strip?
- **Gravity slide when idling on a steep slope** — v1 or later?
- **Body pitch to the surface normal** (visual realism) — worth the extra math?
- Keep a **damage-based slow on top** of slope physics, or let slope physics
  fully carry the endgame pressure (recommended)?
