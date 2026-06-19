import {
  GRAVITY,
  COMBAT,
  SHELL,
  COLORS,
  TANK,
  TERRAIN,
  EXPLOSION,
  POWERUPS,
} from './constants.js';
import { Shell } from './shell.js';
import { Effect } from './effect.js';
import { Terrain } from './terrain.js';
import { Explosion } from './explosion.js';
import { Powerup } from './powerup.js';

// GameState is the single source of truth for the world. It owns all tanks,
// shells, explosions, powerups, effects, and terrain, and advances everything
// via step(dt).
//
// QUERYING (for future AI/controllers):
//   state.tanks       -> live tank objects
//   state.shells      -> live shell objects
//   state.explosions  -> expanding AoE hit windows / visuals
//   state.powerups    -> pickups in team pens
//   state.terrain     -> deformable heightfield: heightAt/normalAt/materialAt/crater
//   state.events      -> per-tick { fire | impact | hit | respawn | pickup }
//   state.time        -> seconds elapsed in the current run
//
// This object does NOT render anything and does not read raw input — it is
// pure simulation. The Renderer draws it; Controllers feed it Actions.

export class GameState {
  constructor(arena) {
    this.arena = arena; // { half }
    this.tanks = [];
    this.shells = [];
    this.explosions = [];
    this.powerups = [];
    this.effects = [];
    this.controllers = {}; // tank.tankId -> Controller
    this.events = []; // reset each tick; consumed by HUD / audio observers
    this.terrain = new Terrain(arena);
    this.nextPowerupAt = new Map(); // team id -> next spawn time
    this.time = 0;
  }

  addTank(tank, controller) {
    this.tanks.push(tank);
    this.controllers[tank.tankId] = controller;
  }

  spawnShell(pos, vel, ownerId, blastScale = 1) {
    const s = new Shell(pos, vel, ownerId, blastScale);
    this.shells.push(s);
    this.events.push({ type: 'fire', by: ownerId });
    return s;
  }

  spawnExplosion(pos, ownerId, blastScale = 1) {
    const ex = new Explosion(pos, ownerId, EXPLOSION.radius * blastScale, EXPLOSION.ttl);
    this.explosions.push(ex);
    // Carve a smoothed crater; radius scales with the blast, depth stays shallow.
    this.terrain.crater(pos.x, pos.z, TERRAIN.craterRadius * blastScale, TERRAIN.craterDepth);
    this.events.push({ type: 'impact', x: pos.x, y: pos.y, z: pos.z, radius: ex.maxRadius });
    return ex;
  }

  spawnMuzzleFlash(pos, color = COLORS.muzzle) {
    this.effects.push(new Effect({ pos: pos.clone(), color, ttl: 0.12, kind: 'muzzle', scale: 0.9 }));
  }

  spawnPowerup(kind, team, pen) {
    const x = pen.xMin + Math.random() * (pen.xMax - pen.xMin);
    const z = pen.zMin + Math.random() * (pen.zMax - pen.zMin);
    const p = new Powerup(kind, team, { x, y: this.terrain.heightAt(x, z), z });
    this.powerups.push(p);
    return p;
  }

  _powerupCountForTeam(team) {
    let n = 0;
    for (const p of this.powerups) if (p.alive && p.team === team) n += 1;
    return n;
  }

  _teamPens() {
    const pens = new Map();
    for (const t of this.tanks) if (t.pen && !pens.has(t.team)) pens.set(t.team, t.pen);
    return pens;
  }

  _maybeSpawnPowerups() {
    const pens = this._teamPens();
    for (const [team, pen] of pens) {
      if (!this.nextPowerupAt.has(team)) this.nextPowerupAt.set(team, this.time + POWERUPS.spawnInterval);
      let next = this.nextPowerupAt.get(team);
      if (this.time < next) continue;
      this.nextPowerupAt.set(team, next + POWERUPS.spawnInterval);
      if (this._powerupCountForTeam(team) >= POWERUPS.maxPerTeam) continue;
      const kind = Math.random() < 0.5 ? 'speed' : 'blastRadius';
      this.spawnPowerup(kind, team, pen);
    }
  }

  _resolvePowerupPickups() {
    for (const p of this.powerups) {
      if (!p.alive) continue;
      for (const t of this.tanks) {
        if (!t.alive || t.team !== p.team) continue;
        const dx = t.position.x - p.position.x;
        const dz = t.position.z - p.position.z;
        const d = Math.hypot(dx, dz);
        if (d <= POWERUPS.pickupRadius + COMBAT.tankRadius * 0.4) {
          const value = p.kind === 'speed' ? POWERUPS.speedMultiplier : POWERUPS.blastRadiusMultiplier;
          t.applyBuff(p.kind, value, POWERUPS.duration, this.time);
          p.alive = false;
          this.events.push({ type: 'pickup', tank: t.tankId, kind: p.kind });
          break;
        }
      }
    }
  }

  step(dt) {
    this.lastDt = dt;
    this.time += dt;
    this.events.length = 0;

    // 0. Expire buffs and spawn new team-local pickups.
    for (const t of this.tanks) t.updateBuffs(this.time);
    this._maybeSpawnPowerups();

    // 1. Controllers decide intent; tanks act (may spawn shells).
    for (const t of this.tanks) {
      const c = this.controllers[t.tankId];
      const action = c ? c.getAction(this, t) : null;
      if (action) t.applyAction(action, dt, this);
    }

    // 2. Respawn destroyed tanks that opt into auto-respawn.
    for (const t of this.tanks) {
      if (!t.alive && t.autoRespawn) {
        t.respawnTimer -= dt;
        if (t.respawnTimer <= 0) {
          t.respawn();
          this.events.push({ type: 'respawn', target: t.tankId });
        }
      }
    }

    // 3. Tanks can pick up powerups after moving this frame.
    this._resolvePowerupPickups();

    // 4. Shells move under gravity.
    for (const s of this.shells) s.integrate(dt, GRAVITY);

    // 5. Ground impacts (terrain-aware) -> explosion. The shell is killed here,
    //    not in integrate(), so craters lower the impact point correctly.
    for (const s of this.shells) {
      if (s._impacted) continue;
      const sx = s.position.x;
      const sz = s.position.z;
      if (s.position.y <= this.terrain.heightAt(sx, sz) + SHELL.radius) {
        s._impacted = true;
        s.alive = false;
        // Detonate at the surface point (not the overshooting shell y).
        this.spawnExplosion({ x: sx, y: this.terrain.heightAt(sx, sz), z: sz }, s.ownerId, s.blastScale);
      }
    }

    // 6. Shell-vs-tank contact -> explosion (no direct damage here).
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
          s.alive = false;
          s._impacted = true;
          this.spawnExplosion(s.position, s.ownerId, s.blastScale);
          break;
        }
      }
    }

    // 7. Reap dead shells.
    this.shells = this.shells.filter((s) => s.alive);

    // 8. Explosions expand; tanks take damage when the wave reaches them.
    for (const ex of this.explosions) {
      ex.update(dt);
      if (!ex.alive) continue;
      for (const t of this.tanks) {
        if (!t.alive || t.tankId === ex.ownerId || ex.hitIds.has(t.tankId)) continue;
        const cy = t.position.y + TANK.bodyCenterY;
        const dx = ex.position.x - t.position.x;
        const dy = ex.position.y - cy;
        const dz = ex.position.z - t.position.z;
        const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);
        if (dist <= ex.radius + COMBAT.tankRadius) {
          t.takeDamage(EXPLOSION.damage);
          ex.hitIds.add(t.tankId);
          this.events.push({
            type: 'hit',
            target: t.tankId,
            by: ex.ownerId,
            damage: EXPLOSION.damage,
            fatal: !t.alive,
          });
        }
      }
    }
    this.explosions = this.explosions.filter((e) => e.alive);

    // 9. Advance powerup idle animation / despawn.
    for (const p of this.powerups) p.update(dt);
    this.powerups = this.powerups.filter((p) => p.alive);

    // 10. Advance cosmetic effects.
    for (const e of this.effects) e.update(dt);
    this.effects = this.effects.filter((e) => e.alive);
  }

  // --- Query helpers (mainly for future AI/controllers) ---
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
      if (d < bd) {
        bd = d;
        best = t;
      }
    }
    return best;
  }

  incomingShells(id) {
    return this.shells.filter((s) => s.ownerId !== id);
  }
}
