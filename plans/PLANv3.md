# Artillery Duel — PLAN v3

> Current as-built reference. `PLANv2.md` described single-player-only with the AI
> "deferred"; the AI and several systems have since shipped, so v2 is stale.
> This plan supersedes v2 as the source of truth; v1/v2 are kept for lineage.

## What changed from v2

1. **AI opponents shipped** (was "deferred" in v2). `AiController` implements
   the full opponent behavior. The drop-in design from v2 held: adding AI changed
   nothing in `Tank` / `GameState` / `Renderer`.
2. **It's now a real game loop**, not a sandbox: title screen → survival combat →
   game over → restart, with scoring, a difficulty ramp, and a persisted best.
3. **New systems**: procedural audio, shell motion trails, title/game-over
   overlays, localStorage best score, difficulty ramp.
4. **Two new files**: `ai.js`, `audio.js`.

## Architecture (unchanged in shape, now exercised end-to-end)

Three strict layers:

- **Controllers** (`controller.js`, `ai.js`) → produce a normalized `Action`
  `{ bodyTurn, drive, turretYaw, turretPitch, fire }`.
  - `HumanController` (keyboard), `NullController` (no-op), `AiController` (AI).
  - Swapping one controller for another is a one-line change at construction.
- **GameState** (`gamestate.js`) → single queryable source of truth. `step(dt)`
  advances the world: controllers act → respawns → shells integrate → ground
  impacts → shell-vs-tank collisions → effects. Emits per-tick `events`
  (`fire`, `hit`, `impact`, `respawn`) consumed by the HUD and audio. Pure
  simulation — no input, no rendering.
- **Renderer** (`renderer.js`) → reads state and draws: scene, angled camera,
  lit ground + grid, dashed aim-trajectory preview, per-shell motion-streak
  trails. Never mutates state.

`main.js` is the composition root: wires layers, owns the game state machine,
scoring, the difficulty ramp, and the best score.

## As-built file layout

```
index.html       canvas + HUD + import map (bare 'three' -> CDN)
main.js          composition root: game state machine, scoring, ramp, audio glue
constants.js     ALL tunables (physics, combat, tank, game, colors)
input.js         KeyboardInput: Set of held key codes
controller.js    Action contract + HumanController + NullController
ai.js            AiController: firing solution + lead + scatter + dodge + pursue  [new]
tank.js          Tank (THREE.Group): pose, aim, fire, HP, respawn (isTank flag)
shell.js         Shell (THREE.Mesh): gravity integration, lifetime
effect.js        Effect: short-lived impact/muzzle visuals
gamestate.js     GameState: entities + step(dt) + events + query helpers
renderer.js      scene/camera/lights/ground/trajectory + shell trails
hud.js           DOM overlay: HP, score, enemies, title & game-over screens
audio.js         Procedural WebAudio SFX (no assets)                          [new]
```

No build step. three.js via import map → `unpkg.com/three@0.160.0`.

## AI design (`AiController`)

Each frame, per AI tank:

1. **Target**: the player (generalized later as nearest enemy for FFA).
2. **Firing solution**: closed-form low-arc angle to hit the target under gravity,
   with a refined muzzle position. **Target-leading**: estimates flight time and
   re-solves against the target's predicted position.
3. **Scatter**: re-rolled every ~0.4s (Gaussian-ish) added to yaw/pitch — this is
   the main "fairness" knob (bigger = easier to dodge).
4. **Aim & fire**: tracks turret toward the solution at turret speed (same rate as
   a human, so there's an aiming delay); fires only when within `aiFireTol` and
   off cooldown. Per-tank `fireCooldown` (AI slower than the player).
5. **Movement**:
   - **Dodge**: finds the most threatening incoming shell (closest horizontal
     approach within a time window) and strafes perpendicular. Reaction is
     imperfect (sometimes hesitates → takes the hit) so enemies stay hittable.
   - **Pursue**: otherwise faces the target, holds a preferred range, and weaves.

Difficulty emerges from `aiScatter`, `aiCooldown`, opponent count, and the ramp.

## Game state machine

```
TITLE --(any key; unlocks audio)--> PLAYING
PLAYING --(P / Esc)----------------> PAUSED     (sim frozen; overlay shown)
PAUSED  --(P / Esc)----------------> PLAYING
PLAYING --(player HP <= 0)---------> GAME_OVER
GAME_OVER --(Enter)---------------> PLAYING   (resets score, roster, HP, shells)
```

The sim only steps in `PLAYING`. The pause keydown handler ignores `e.repeat`
(autorepeat) so holding P can't flicker. The player never auto-respawns
(`autoRespawn=false`); enemies do, after `RESPAWN.delay`. The player's death is
the only lose condition.

## Scoring & difficulty ramp

- **Score** = player kills (fatal `hit` events with `by === 'player'`).
- **Ramp**: every `GAME.rampKills` (3), `spawnEnemy()` adds one enemy up to
  `GAME.maxOpponents` (6). `spawnEnemy()` is the same function used at init, so
  the roster grows with no new concepts. On restart the roster is trimmed back to
  `GAME.numOpponents`; the renderer drops the removed tanks via the `isTank` flag.
- **Best score**: persisted in `localStorage`; shown on the game-over overlay.

## Audio (`audio.js`)

Procedural WebAudio — no assets. `unlockAudio()` must be called from a user
gesture (the title screen's "any key" does this). Sounds: `fire` (louder for the
player), `impact` (volume attenuates with distance from the player), `hit`
(tank struck), `gameOver`. Driven from `GameState` events in `main.js`.

## Controls

WASD drive/turn · Q/E turret yaw · R/F elevation · SPACE fire · P/Esc pause ·
any key starts · ENTER restarts. Fixed muzzle speed; elevation + yaw fully
determine the arc. Controls are listed on the title, pause, and game-over
overlays.

## Tuning (all in `constants.js`)

`GAME`: `numOpponents` (2), `maxOpponents` (6), `rampKills` (3), `aiCooldown`
(2.2s), `aiScatter` (0.10 rad), `aiFireTol` (0.035 rad), `preferredRange` (24).
Plus `PHYSICS`, `SHELL`, `COMBAT`, `TANK`, `RESPAWN`, `COLORS` (enemy palette).

## Dev affordance

Visit `/#debug` to expose `window.__game = { state, player, enemies, renderer,
input, mode, score }` for browser-driven testing/inspection. Zero impact in
normal play.

## Verified (real browser, real input path)

AI fires/leads/damages/kills player → game over; restart fully resets; player
damages/kills enemies → score → respawn; ramp spawns enemies at score 3 (and
trims back on restart); best score persists; title freezes sim; each control
moves only its state var; trails render per shell; no JS errors.

(Couldn't confirm *audible* audio or *visual* aesthetics in headless — both need
a human at the keyboard.)

## Still deferred (future plans)

- **Balance pass** — play and tune the `GAME.*` knobs (biggest lever on fun).
- Camera that gently follows the player; screen shake; bigger explosions.
- Powerups, terrain/obstacles, wind, weapon variety, networking, mobile,
  power-tuning — the original "maybe later" list.
- Generalize AI targeting (FFA / teams: nearest enemy instead of player-only).
