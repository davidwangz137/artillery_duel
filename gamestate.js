import { GRAVITY, COMBAT, SHELL, COLORS, TANK } from './constants.js';
import { Shell } from './shell.js';
import { Effect } from './effect.js';

// GameState is the single source of truth for the world. It owns all tanks,
// shells, and effects, and advances everything one tick at a time via step(dt).
//
// QUERYING (for future AI): controllers receive `state` and may read whatever
// they need directly. Key fields:
//   state.tanks     -> [{ id, position, velocity, hp, maxHp, bodyYaw, aimYaw,
//                         pitch, cooldown, alive, respawnTimer }]
//   state.shells    -> [{ position, velocity, ownerId, alive }]
//   state.arena     -> { half }
//   state.time      -> seconds elapsed
//   state.events    -> [{type:'hit', target, by, damage, fatal}] from last tick
// Plus the helper methods at the bottom.
//
// This object does NOT render anything and does not read input — it is pure
// simulation. The Renderer draws it; Controllers feed it Actions.

export class GameState {
  constructor(arena) {
    this.arena = arena; // { half }
    this.tanks = [];
    this.shells = [];
    this.effects = [];
    this.controllers = {}; // tank.tankId -> Controller
    this.events = []; // reset each tick; consumed by HUD / AI observers
    this.time = 0;
  }

  addTank(tank, controller) {
    this.tanks.push(tank);
    this.controllers[tank.tankId] = controller;
  }

  spawnShell(pos, vel, ownerId) {
    const s = new Shell(pos, vel, ownerId);
    this.shells.push(s);
    this.events.push({ type: 'fire', by: ownerId });
    return s;
  }

  spawnImpact(pos, color = COLORS.impact) {
    this.effects.push(new Effect({ pos: pos.clone(), color, ttl: 0.45, kind: 'impact' }));
  }

  spawnMuzzleFlash(pos, color = COLORS.muzzle) {
    this.effects.push(new Effect({ pos: pos.clone(), color, ttl: 0.12, kind: 'muzzle', scale: 0.9 }));
  }

  step(dt) {
    this.lastDt = dt; // available to controllers that need timing (e.g. AI)
    this.events.length = 0;

    // 1. Controllers decide intent; tanks act (may spawn shells).
    for (const t of this.tanks) {
      const c = this.controllers[t.tankId];
      const action = c ? c.getAction(this, t) : null;
      if (action) t.applyAction(action, dt, this);
    }

    // 2. Respawn destroyed tanks that opt into auto-respawn (enemies do; the
    //    player does not — player death ends the run).
    for (const t of this.tanks) {
      if (!t.alive && t.autoRespawn) {
        t.respawnTimer -= dt;
        if (t.respawnTimer <= 0) {
          t.respawn();
          this.events.push({ type: 'respawn', target: t.tankId });
        }
      }
    }

    // 3. Shells move under gravity.
    for (const s of this.shells) s.integrate(dt, GRAVITY);

    // 4. Ground impacts -> effect (once per shell).
    for (const s of this.shells) {
      if (!s.alive && !s._impacted && s.position.y <= SHELL.radius + 0.05) {
        s._impacted = true;
        this.spawnImpact(s.position);
        this.events.push({ type: 'impact', x: s.position.x, y: s.position.y, z: s.position.z });
      }
    }

    // 5. Shell-vs-tank collisions (skip owner).
    for (const s of this.shells) {
      if (!s.alive) continue;
      for (const t of this.tanks) {
        if (!t.alive || s.ownerId === t.tankId) continue;
        const cy = t.position.y + TANK.bodyCenterY;
        const dx = s.position.x - t.position.x;
        const dy = s.position.y - cy;
        const dz = s.position.z - t.position.z;
        const r = SHELL.radius + COMBAT.tankRadius;
        if (dx * dx + dy * dy + dz * dz <= r * r) {
          t.takeDamage(COMBAT.hitDamage);
          s.alive = false;
          s._impacted = true;
          this.spawnImpact(s.position);
          this.events.push({
            type: 'hit',
            target: t.tankId,
            by: s.ownerId,
            damage: COMBAT.hitDamage,
            fatal: !t.alive,
          });
          break;
        }
      }
    }

    // 6. Reap dead shells.
    this.shells = this.shells.filter((s) => s.alive);

    // 7. Advance effects.
    for (const e of this.effects) e.update(dt);
    this.effects = this.effects.filter((e) => e.alive);
  }

  // --- Query helpers (mainly for future AI controllers) ---
  tankById(id) {
    return this.tanks.find((t) => t.tankId === id);
  }
  enemiesOf(id) {
    return this.tanks.filter((t) => t.tankId !== id);
  }
  // Nearest alive tank on a different team (for AI targeting / future FFA).
  nearestEnemy(tank) {
    let best = null;
    let bd = Infinity;
    for (const t of this.tanks) {
      if (t === tank || !t.alive || t.team === tank.team) continue;
      const dx = t.position.x - tank.position.x;
      const dz = t.position.z - tank.position.z;
      const d = dx * dx + dz * dz;
      if (d < bd) { bd = d; best = t; }
    }
    return best;
  }
  incomingShells(id) {
    return this.shells.filter((s) => s.ownerId !== id);
  }
}
