# Artillery Duel — PLAN v4

> Current as-built reference. v3 captured the post-AI-iteration state (survival
> mode, single shared field, direct shell damage). Since then the world grew, the
> map split into team pens, damage became a strategic layer, and the game became
> configurable. This plan supersedes v3 as the source of truth; v1–v3 are kept
> for lineage.

## What changed from v3

1. **Bigger world, smaller tanks, rebalanced arcs.** Arena half 32 → 64; tank
   model scaled to 0.85; muzzle 36 → 48 so arcs still cover the larger field.
2. **Teams + pens.** The map splits into `TEAMS.count` Z-stripes separated by a
   no-man's-land. Each tank is clamped to its team's pen, so opposing tanks can
   never close to point-blank (kills the "too close to aim → tie" failure). AI
   targeting generalized to "nearest enemy on another team" (FFA-ready).
3. **Ground damage endgame.** `terrain.js` keeps a damage grid; shell impacts
   crater the ground (visible via a canvas texture) and cratered ground **slows**
   tanks. Cumulative damage pins everyone down — the stalemate-breaker.
4. **Explosion-first damage.** Shells no longer damage tanks directly. A shell
   impact spawns an `Explosion` that expands over a short TTL; a tank is damaged
   the first frame the blast reaches it. Shell `blastScale` is frozen at fire
   time from the owner's blast-radius buff, so radius buffs apply cleanly.
5. **Powerups.** Per-team-pen pickups spawn every 10s (capped), granting
   temporary **speed** or **blast-radius** buffs. Tank-local timed buffs live in
   `tank.js`; HUD shows timers.
6. **Mouse aim (on by default) + left-click fire.** Cursor sets a desired ground
   point; the turret **slews** at turn rate (never snaps); out-of-range cursor
   clamps to the farthest reachable shot. `M` toggles, left-click fires.
7. **Configurable game.** A pre-game menu (persisted) sets **enemy respawn
   ON/OFF** and **AI behavior random/strategic**. Elimination mode (respawn OFF)
   disables the ramp and **wins on clearing all enemies**.
8. **Shared ballistics** extracted to `ballistics.js`; on-screen error overlay so
   runtime throws are visible (the server can't see browser-side freezes).

## Architecture (same three layers, more entity kinds)

- **Controllers** (`controller.js`, `ai.js`) → normalized `Action`
  `{ bodyTurn, drive, turretYaw, turretPitch, fire }`.
  - `HumanController` (keyboard + mouse aim + left-click), `NullController`,
    `AiController(behavior)`.
- **GameState** (`gamestate.js`) → single queryable source of truth. Owns
  `tanks`, `shells`, `explosions`, `powerups`, `effects`, `terrain`. `step(dt)`
  advances: expire buffs → spawn team powerups → controllers act → respawns →
  powerup pickups → shells integrate → shell impacts/contact spawn explosions →
  explosions expand + apply damage → reap. Emits per-tick `events`
  (`fire`, `impact`, `hit`, `respawn`, `pickup`) consumed by HUD + audio.
- **Renderer** (`renderer.js`) → reads state and draws; never mutates it. Syncs
  tanks/shells/explosions/powerups/effects into the scene and drops dead ones.

`main.js` is the composition root: game state machine, config + persistence,
scoring, difficulty ramp, best score, win/lose detection, audio glue.

## As-built file layout

```
index.html       canvas + HUD + import map (bare 'three' -> CDN) + error overlay
main.js          composition root: state machine, config, win/lose, ramp, audio
constants.js     ALL tunables (incl. TEAMS, TERRAIN, EXPLOSION, POWERUPS, GAME)
input.js         KeyboardInput: Set of held key codes
controller.js    Action + HumanController (mouse aim + left-click) + NullController
ai.js            AiController(behavior): lead+scatter+dodge+pursue + terrain flee
ballistics.js    shared projectile math (firingSolution, solveAt, ...Clamped)  [new]
tank.js          Tank: pose/aim/fire/HP/respawn, team+pen, buffs, terrain slow
shell.js         Shell: gravity integration, lifetime, frozen blastScale
explosion.js     Explosion: expanding AoE — owns hit timing + visual       [new]
effect.js        short-lived impact/muzzle visuals
powerup.js       floating pickup (speed / blastRadius)                     [new]
terrain.js       damage grid + canvas texture + damageAt/applyImpact       [new]
gamestate.js     GameState: entities + step(dt) + events + query helpers
renderer.js      scene/camera/ground/grid/no-man's-land/trajectory/trails
hud.js           HP, score, enemies, buffs, toasts, title-menu/pause/victory
audio.js         procedural WebAudio SFX (no assets)
```

No build step. three.js via import map → `unpkg.com/three@0.160.0`.

## Teams & pens

`makeTeamPens(half, buffer, count)` splits the arena into Z-stripes with a
`2*buffer` no-man's-land between adjacent pens. Each tank carries `team` +
`pen {xMin,xMax,zMin,zMax}`; movement clamps to the pen. Default: 2 teams
(player = team 0, AIs = team 1), buffer 10 → min separation ~23 units. A
contrasting strip marks the no-man's-land.

## Combat model (explosion-first)

1. Tank fires → `Shell` spawned with `blastScale = owner.explosionRadiusMultiplier()`.
2. Shell hits ground or contacts a tank → `spawnExplosion(pos, owner, blastScale)`.
   No direct damage; the shell is spent.
3. Each frame, `Explosion` expands (`radius = maxRadius * age/ttl`); any tank
   (not the owner, not already hit) within `radius + tankRadius` takes
   `EXPLOSION.damage` once (`hitIds` dedups).
4. Explosions also crater the terrain (radius scales with `blastScale`).

This makes **blast-radius** a first-class, visible stat and gives a brief,
readable blast window.

## Ground damage (`terrain.js`)

- 128×128 damage grid over the arena, painted to a `CanvasTexture` used as the
  ground's albedo (undamaged green → cratered dark).
- `applyImpact(x,z,radius,amount)` adds a gaussian crater; `damageAt(x,z)`
  samples it.
- Tank drive speed is multiplied by `1 - TERRAIN.slowFactor * damage` (~4× slower
  at full damage). `terrain.reset()` on restart for a fresh field.

## Powerups & buffs

- Every `POWERUPS.spawnInterval` (10s) per team, if under `maxPerTeam` (2), a
  random `speed`/`blastRadius` pickup spawns inside that team's pen.
- Pickup (tank within `pickupRadius` of its own team's pickup) →
  `tank.applyBuff(type, value, duration, now)`. Duration 12s; refreshing a buff
  resets its timer.
- Buff getters: `moveSpeedMultiplier()`, `explosionRadiusMultiplier()`. Movement
  and shell-fire read these; respawn clears buffs.

## AI (`AiController`)

Per frame: target = `state.nearestEnemy(tank)`; firing solution (lead + scatter);
slew turret; fire when on-target and off cooldown. Movement: **dodge** incoming
shells (imperfect), else **pursue** (hold preferred range + weave). In
`behavior === 'strategic'`, when on damaged ground it steers toward the
least-damaged nearby heading (8 samples) to escape the slow-down.

## Game configuration & state machine

Persisted config (`localStorage 'artillery_config'`):
`{ enemyRespawn: bool, aiBehavior: 'random'|'strategic' }`. Set on the title
screen (`1` toggles respawn, `2` toggles AI behavior), applied via `applyConfig()`
on start/restart (sets each enemy's `autoRespawn` and (re)creates its
`AiController`).

```
TITLE --(1/2 configure; Enter/Space starts)--> PLAYING
PLAYING --(P/Esc)-----------------------------> PAUSED  <-> PLAYING
PLAYING --(player dies)-----------------------> GAME_OVER (loss)
PLAYING --(respawn OFF & all enemies dead)----> GAME_OVER (win -> VICTORY!)
GAME_OVER --(Enter)---------------------------> PLAYING (reset)
```

- Respawn ON (survival): enemies auto-respawn; difficulty ramp adds enemies every
  `rampKills` up to `maxOpponents`; score = kills; player death = loss.
- Respawn OFF (elimination): no enemy respawn, no ramp; clear all enemies = win.

## Controls

Mouse aim is **on by default**. WASD drive/turn · Q/E turret yaw · R/F elevation
· SPACE **or left-click** fire · `M` toggle mouse aim · `P`/`Esc` pause ·
`1`/`2` configure (title) · Enter start/restart.

## Tuning (all in `constants.js`)

`ARENA`(half 64) · `PHYSICS`(gravity −20, muzzle 48) · `SHELL` · `COMBAT`
(hitDamage 25, tankRadius ~1.7) · `TANK`(scale 0.85, driveSpeed 18, turn/pitch
rates, muzzle offsets) · `TEAMS`(buffer 10, count 2) · `TERRAIN`(res 128,
blastRadius 5.5, slowFactor 0.75) · `EXPLOSION`(radius 3.2, ttl 0.22) ·
`POWERUPS`(spawnInterval 10, maxPerTeam 2, duration 12, speed×1.45, blast×1.55)
· `GAME`(numOpponents 2, maxOpponents 6, rampKills 3, aiCooldown 2.2, aiScatter
0.10) · `COLORS`.

## Dev affordances

- `/#debug` exposes `window.__game = { state, player, enemies, renderer, input,
  mode, score }` for browser-driven testing. Zero impact in normal play.
- On-screen error overlay (`index.html`): any runtime throw shows as a red box
  instead of a silent freeze.

## Verified (real browser)

AI fires/kills player → game over; restart resets; player kills enemies → score;
ramp spawns (survival); best persists; title freezes sim; **elimination →
VICTORY on clear**; config toggles persist; mouse aim slews + clamps + toggles;
left-click fires; ground damage slows ~4×; powerups spawn per team + grant buffs;
explosion (not shell contact) applies damage. No JS errors.

(Couldn't confirm *audible* audio or *visual* aesthetics in headless — need a
human.)

## Still deferred (future plans)

- **Balance pass** — the `GAME`/`POWERUPS`/`EXPLOSION` knobs are the main fun
  levers; tune after playtesting.
- True destructible terrain (hills you can blow holes in; limited claimable types)
  instead of flat damaged ground.
- Camera that gently follows the player; screen shake; richer explosions.
- More AI behaviors; FFA/teams > 2; wind; weapon variety; networking; mobile;
  power-tuning; a start-screen click UI to match the key menu.
