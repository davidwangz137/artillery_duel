# Artillery Duel — PLAN v1

> Baseline plan. Future plans (`PLANv2.md`, …) diff against this to show lineage.

## Concept

Real-time (not turn-based — dodging requires it) projectile duel. Two tanks on a
flat arena fire **slow, gravity-arced shells** at each other. The slow + visible
arc is what makes aiming and dodging a skill rather than twitch reflex.

## Locked design decisions (v1)

| Decision | Choice | Rationale |
|---|---|---|
| Opponent | **Single player vs simple AI** | Easiest to test/play solo; AI = lead target + scatter + light dodge |
| Camera | **Shared angled/overhead** | Shows both tanks + incoming shells so dodging is possible |
| Projectiles | **Gravity arc** | Classic artillery feel; arcs are readable and dodgeable |
| Aiming | **Full keyboard (rotate turret)** | Classic tank feel; yaw + elevation, fixed muzzle velocity |

## Controls

| Key | Action |
|---|---|
| `W` / `S` | drive forward / back |
| `A` / `D` | rotate tank body |
| `Q` / `E` | rotate turret yaw |
| `R` / `F` | turret elevation up / down |
| `Space` | fire (cooldown-gated) |
| `P` | pause |
| `Enter` | restart on game-over |

Fixed muzzle velocity for v1 — elevation + yaw fully determine the arc, keeping
aiming learnable. Power-tuning (`Z`/`X`) is an easy Phase-5 add if arcs feel too
constrained.

## File layout

```
index.html          # canvas + UI overlay (HUD, game-over modal)
main.js             # entry: scene/camera/renderer loop, game state machine
player.js           # Tank class: body+turret mesh, movement, aim, fire
projectile.js       # Shell class: gravity integration, lifetime, AABB
ai.js               # Opponent controller: fire solution + scatter + dodge
input.js            # keyboard state map
hud.js              # HP bars, cooldown indicator, win/lose screen
constants.js        # tunables (gravity, muzzle V, cooldowns, sizes)
```

Plain ES modules, **no build step** — three.js via CDN import in `index.html`.
Swap to Vite later if needed.

## Physics & combat

- Shells integrate `v += g·dt; pos += v·dt`; gravity points down (−Y).
  Elevation sets initial vertical/horizontal split at fixed speed.
- Collision: sphere-vs-AABB each frame against both tanks. Shells also expire on
  ground impact (`y ≤ 0`) → small impact sprite.
- HP: 100 each, hit = 25 damage (4 hits to kill). Tunable in `constants.js`.

## Simple AI (v1)

1. Every fire-cooldown, solve aim toward player's current pos with ±scatter
   (noise scales difficulty).
2. Strafe perpendicular occasionally so it's not a static turret.
3. Light dodge: if a shell is within radius and approaching, nudge away.
4. No pathfinding, no terrain (flat arena).

## Game state machine

```
PLAYING → (HP ≤ 0) → GAME_OVER → (Enter) → PLAYING
```

## Build order

1. **Scaffold** — `index.html` + three.js scene, angled camera, lit ground,
   resize, render loop. *Verify: scene renders, arena visible.*
2. **Player tank** — body + turret meshes, WASD/Q/E/R/F controls, arena clamp.
   *Verify: drives and aims.*
3. **Firing + shells** — gravity-arced projectiles from turret muzzle, cooldown,
   lifetime cleanup. *Verify: arcs fly and land.*
4. **Collision + HP + game-over** — shell hits reduce HP, modal on 0, restart.
   *Verify: kills register.*
5. **AI opponent** — fire solution + scatter + light dodge. *Verify: AI fights
   back and can be killed.*
6. **Polish** — muzzle flash, impact burst, HUD styling, sounds (optional),
   pause. *Verify: full loop feels like a game.*

## Out of scope for v1 (deferred)

Powerups, terrain/obstacles, wind, weapon variety, networking, mobile controls,
power-tuning.
