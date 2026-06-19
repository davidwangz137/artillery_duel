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
  floor are bedrock — cratering no-ops there (indestructible).
- **Material is a function of depth** (`h`), which gives us the slowness model
  for free and lets the ground *color* show how slow a region is. v1 has two
  materials: **soil** (`h > BEDROCK_Y`, full speed) and **bedrock** (`h == BEDROCK_Y`,
  slow). `terrain.materialAt(x,z)` → `{ slowFactor, color, bedrock }`. Future
  iterations split the soil range into layers (dirt/clay/rock) by depth, each
  with its own `slowFactor` + color — just more thresholds, no new architecture.
- Initial state: flat (`h = 0`), or a tiny low-amplitude noise for visual life.

### Mesh

- One indexed `BufferGeometry` with `(RES+1)²` vertices, positions displaced by
  `h`; `computeVertexNormals()` for lighting. `MeshStandardMaterial` with
  **vertex colors** from each vertex's material layer (i.e. its depth →
  `slowFactor`/color), so the ground color directly shows how slow a region is.
  Re-paint vertex colors locally on cratering.
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
in `Tank.applyAction` (or a new physics step the sim calls). No physics engine,
and **no gravity slide** — tank treads hold the tank on a slope (a real tank
applies holding force, it doesn't roll away).

Per frame, per tank:

1. **Material speed** — `mat = terrain.materialAt(pos)`; the speed multiplier
   starts from `mat.slowFactor` (soil = 1.0, bedrock = slow). This is the only
   "terrain slow" — the old accumulated-damage slow is gone. The reduction is
   gradual in feel because (a) slope physics below ramps continuously and (b)
   only the deepest crater floors expose bedrock; future depth layers smooth it
   further. No instant drop to slowest.
2. **Slope speed (gravity)** — sample the surface normal; **grade** along travel
   (rise/run, + = uphill). `slopeMul = clamp(1 - grade * UPHILL_COST, MIN, MAX)`.
   Uphill slows, downhill speeds (capped). "Going up a ramp is slower than flat."
3. **Intended move** — `Δ = forward * drive * baseSpeed * mat.slowFactor *
   slopeMul * dt`. (Buffs like `speed` still multiply in.)
4. **Climb limit (forbid impossible)** — `moveGrade = (h(new) - h(cur)) / |Δ|`.
   If `moveGrade > MAX_CLIMB` (tread limit, e.g. `tan(35°) ≈ 0.70`), **block the
   uphill move** (tank stalls at the base). Cannot climb walls or near-vertical
   crater rims. The "treads tolerance" *is* `MAX_CLIMB`. No slide — it just stops.
5. **Ground follow + body pitch** — `tank.y = h(pos) + clearance`, **lerped** per
   frame (fake suspension) for a smooth ride; the tank settles into craters. The
   **body pitches/rolls to the surface normal** (visual realism — the tank tilts
   with the ground), with the turret staying world-up so aiming is unaffected.

Result: tanks ride and tilt with the terrain, slow on climbs, can't scale
impossible slopes, slow on exposed bedrock, and naturally bog down in cratered
fields (endgame pressure — now physical, not a magic debuff).

## 4. Integration with existing systems

- **`terrain.js`** — rewritten as the heightfield: owns `h` grid, mesh, bedrock,
  the depth→material layer table, and the queries `heightAt / normalAt /
  materialAt`, plus `crater(x,z,Cr,Cd)` and local mesh/color updates, `reset()`.
  Keeps the `Terrain` name/API the rest of the code already uses.
- **`renderer.js`** — `_buildGround` builds the heightfield mesh (replaces the
  flat `PlaneGeometry`); ground damage is now the geometry + vertex colors (drop
  the canvas texture).
- **`gamestate.js`** — explosions call `terrain.crater(...)` instead of
  `applyImpact`; explosion origin `y = heightAt(x,z)`. Shell "ground impact"
  test becomes `shell.y <= heightAt(x,z) + shellRadius` (shells now hit real
  crater rims/depths). Tank-tank, pen clamps, powerup pickup: unchanged.
- **`tank.js`** — driving queries `terrain.heightAt/normalAt/materialAt`
  (ground follow + body pitch + slope/climb + material slow). The inline damage
  term (the `terrainDmg`/`slowFactor` at the current drive site) is removed.
  Buffs (`speed`) still apply.
- **`main.js`** — spawns/powerups place at `heightAt(x,z)`; otherwise unchanged.
- **No-man's-land divider** — **kept flat and not cratered** (decision). It's an
  XZ uncrossable strip; explosions overlapping it simply don't dent it (the
  crater routine skips cells inside the divider band).

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
   `heightAt/normalAt/materialAt`, flat initial state. Verify: scene shows the field.
2. **Cratering** — `crater(x,z,Cr,Cd)` with non-linear profile, smoothing,
   bedrock; vertex colors from material layer + exposed bedrock; **divider band
   skipped**. Verify: explosions leave smoothed dents of the right depth/radius,
   cumulative to bedrock; divider stays flat.
3. **Driving** — ground follow (y-lerp) + **body pitch to normal**, slope-speed,
   `MAX_CLIMB` block (no slide), **material slow** (`materialAt`). Remove the old
   damage-slow. Verify: uphill slower + body tilts, steep walls unclimbable,
   bedrock slows, craters bog tanks.
4. **Collisions** — shell-ground test on the heightfield; explosion origin at
   surface; spawns sit on the surface. Verify: shells impact real terrain.
5. **Tuning pass** — `craterDepth/Radius` vs `blastRadius`, smoothing strength,
   `MAX_CLIMB`, `UPHILL_COST`, bedrock slow + depth, grid resolution. Verify feel
   + endgame pressure + perf.

## 8. Tunables to add (in `constants.js`)

```
TERRAIN = { resolution: 128, bedrockY: -8,
            craterRadius: 5.0, craterDepth: 2.0,   // dent (<< blastRadius)
            smoothingPasses: 2, maxSlope: 0.9,     // concavity limit
            // depth -> material layer table (slowFactor + color). v1: soil + bedrock.
            layers: [ { above: -1,   slow: 1.0,  color: 0x4a7a44 }, // topsoil/grass
                       { above: -8,   slow: 1.0,  color: 0x6b5232 }, // soil (v1: no slow)
                       { bedrock: true, slow: 0.4, color: 0x55503f } ] }
DRIVING  = { maxClimb: 0.70,        // tan(35°) tread limit; no slide
             uphillCost: 1.2,       // slope-speed penalty (gradual)
             groundClearance: 0.15, yLerp: 0.3,   // suspension smoothing
             bodyPitch: true, pitchLerp: 0.2 }    // tilt to surface normal
```
`EXPLOSION.radius` (combat AoE) stays separate from `TERRAIN.crater*` (the dent).
Adding intermediate slow layers later is just inserting entries into `layers`
(e.g. clay slow 0.75, rock slow 0.55) — the depth→material lookup + vertex
colors pick them up automatically.

## 9. Decisions (resolved)

- **No-man's-land divider** — kept **flat and not cratered** (explosions skip the
  divider band).
- **Gravity slide** — **none**. Tank treads apply holding force; a tank doesn't
  roll downhill when idling. Slope physics still slow uphill climbs.
- **Body pitch to the surface normal** — **yes**. Tank tilts with the ground
  (lerped); the turret stays world-up so aim is unaffected.
- **Slowness model** — **remove the accumulated-damage slow entirely**. The only
  terrain slow is **material-based**: soil = full speed, **bedrock = slow**, with
  the ground *color* showing the material. Depth→material is a lookup table, so
  intermediate layers (dirt/clay/rock, progressively slower) are a future config
  add — no architecture change. The reduction feels gradual because slope physics
  ramps continuously and only deep crater floors expose slow material.

## 10. Code structure (OO intent — no refactor now)

Side note from the brief: physics today is applied somewhat inline (e.g. the old
`terrainDmg`/`slowFactor` term lives inside `Tank.applyAction`). We agree on the
principle — **objects own their physical properties, and physics *resolves* by
querying properties from objects and applying the update** — but we are **not**
doing a separate refactor pass. Instead, the destructible-terrain work follows
this shape as it's built:

- **`Terrain` owns all field-derived physical state** — the heightfield, bedrock,
  material layers — and exposes it only through clean queries: `heightAt`,
  `normalAt`, `materialAt`, plus mutators (`crater`, `reset`). Nothing else pokes
  the grid directly.
- **`Tank` owns its motion state** (position, yaw, velocity) and its own physical
  attributes (base speed, buffs, climb limit). Its driving step *queries* the
  terrain (via the methods above) rather than reaching into terrain internals —
  so the inline `terrainDmg` computation moves out of the tank and becomes a
  `terrain.materialAt(...)` query.
- **Resolution** stays a per-frame step (in `GameState.step` / `Tank`'s update):
  gather the relevant object properties, integrate, write back to the object.

Net: the new code is cleanly separated (Terrain = field queries; Tank = motion;
step = resolution), which is what makes adding future systems (more layers, a
real physics engine, weather) cheap. No churn to unrelated existing systems.
