# Artillery Duel — PLAN v2

> As-built plan for the v1 implementation. Diffs against `PLANv1.md` to show what
> changed during the build. `PLANv1.md` is left untouched as the original intent.

## What changed from v1

1. **AI deferred.** v1 ships single-player only. Instead of writing an AI, the
   architecture was built so an AI is a drop-in later (see below).
2. **Practice target instead of an opponent.** A second tank with a
   `NullController` (does nothing) sits at the far end so the full fire→arc→hit→
   damage→respawn pipeline is exercised today. This tank is the literal slot an
   `AiController` will occupy.
3. **File layout diverged** to separate intent (controllers) from simulation
   (state) from view (renderer). See below.

## Architecture (the load-bearing decision)

Three layers, strictly separated:

- **Controllers** (`controller.js`) decide *intent*. Each returns a normalized
  `Action` `{ bodyTurn, drive, turretYaw, turretPitch, fire }`. `HumanController`
  reads the keyboard; `NullController` is a no-op (target); an `AiController`
  will read game state and return an `Action`. **Swapping a dummy for an AI is
  one line at construction** — nothing in `Tank`/`GameState`/`Renderer` knows who
  steers a tank.
- **GameState** (`gamestate.js`) is the single, queryable source of truth: all
  tanks, shells, effects, arena, time, and a per-tick `events` log. `step(dt)`
  advances the whole world. It is pure simulation — no input, no rendering. This
  is exactly what a future AI observes.
- **Renderer** (`renderer.js`) only reads state and draws (scene, angled camera,
  lights, ground, grid, dashed aim-trajectory preview).

## As-built file layout

```
index.html       # canvas + HUD overlay + three.js import map (bare 'three' -> CDN)
main.js          # entry: wires Renderer <-> GameState <-> Controllers; rAF loop
constants.js     # all tunables (gravity, muzzle speed, cooldowns, sizes, colors)
input.js         # KeyboardInput: Set of held key codes
controller.js    # Action contract + HumanController + NullController (+ future Ai)
tank.js          # Tank (THREE.Group): pose, aim, fire, HP, respawn
shell.js         # Shell (THREE.Mesh): gravity integration, lifetime
effect.js        # Effect: short-lived impact/muzzle visuals
gamestate.js     # GameState: entities + step(dt) + query helpers
renderer.js      # scene/camera/lights/ground/trajectory; render(state)
hud.js           # DOM overlay: HP bars, reload status, controls help
```

No build step. three.js via import map → `unpkg.com/three@0.160.0`.

## Verified (browser-driven, real input path)

- Scene renders full-window; HUD present; no JS errors.
- WASD drive/turn, Q/E turret yaw, R/F pitch — each moves only its state var.
- Space → shell spawns (owner = player), cooldown engages.
- Gravity-arced shells; solver found a pitch hitting within 0.07 units of target.
- Shell-vs-tank collision → exactly 25 damage; HP reflected in state + HUD.

## Controls (unchanged from v1)

WASD drive/turn · Q/E turret · R/F aim · SPACE fire.

## Still deferred (future plans)

- **AI opponents** — the obvious next plan: implement `AiController` (lead the
  target + scatter + light dodge), spawn N tanks each with one. The state is
  already queryable for this.
- Powerups, terrain/obstacles, wind, weapon variety, networking, mobile,
- power-tuning, sound, shadows.
