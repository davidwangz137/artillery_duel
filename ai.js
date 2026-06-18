// AiController: observes GameState, returns an Action. This is the drop-in
// replacement for NullController/HumanController — same Action shape, so adding
// AI opponents changes nothing else in the engine.
//
// Behavior:
//   - Picks the player as its target.
//   - Solves a gravity firing solution, leads the target, adds scatter.
//   - Tracks turret toward the solution at turret speed; fires when on target.
//   - Wanders to maintain a preferred range and keep moving (a live target).
//   - Dodges incoming shells by strafing perpendicular (imperfect, on purpose,
//     so the player can still land kills).

import { Controller } from './controller.js';
import {
  TANK,
  GAME,
  MUZZLE_SPEED,
  GRAVITY,
  clamp,
} from './constants.js';
import { angleDiff, solveAt } from './ballistics.js';

const G_MAG = -GRAVITY; // gravity magnitude (positive)


// Solve while leading the target by its velocity. Two passes.
function leadAndSolve(tank, target, V, g) {
  const pivot = { x: tank.position.x, y: tank.position.y + TANK.muzzleHeight, z: tank.position.z };
  const sol = solveAt(tank, target.position, V, g);
  if (!sol) return null;
  // Estimate flight time with the low arc, then predict where the target goes.
  const D = Math.hypot(target.position.x - pivot.x, target.position.z - pivot.z);
  const tFlight = D / Math.max(V * Math.cos(sol.pitch), 1);
  const pred = {
    x: target.position.x + target.velocity.x * tFlight,
    y: target.position.y + target.velocity.y * tFlight,
    z: target.position.z + target.velocity.z * tFlight,
  };
  return solveAt(tank, pred, V, g);
}

export class AiController extends Controller {
  constructor(behavior = 'random') {
    super();
    this.behavior = behavior; // 'random' (wander/dodge) | 'strategic' (also flees cratered ground)
    // Scatter (re-rolled periodically so the AI commits to an aim, not jitter).
    this._scYaw = 0;
    this._scPitch = 0;
    this._scTimer = 0;
    // Dodge state.
    this._dodgeTimer = 0;
    this._dodgeDir = 1;
    // Wander weaving.
    this._weave = 0;
    this._weaveTimer = 0;
  }

  getAction(state, tank) {
    const dt = state.lastDt || 1 / 60;
    const action = { bodyTurn: 0, drive: 0, turretYaw: 0, turretPitch: 0, fire: false };
    if (!tank.alive) return action;

    const target = state.nearestEnemy(tank); // any tank on a different team

    // --- Movement: dodge an incoming shell, else hold range + weave. ---
    const dodge = this._dodge(state, tank, dt);
    if (dodge) {
      action.bodyTurn = dodge.bodyTurn;
      action.drive = dodge.drive;
      const move = this._pursue(state, tank, target, dt);
      action.bodyTurn = move.bodyTurn;
      action.drive = move.drive;
    }

    // --- Aim + fire at the player. ---
    if (target && target.alive) {
      this._rollScatter(dt);
      const sol = leadAndSolve(tank, target, MUZZLE_SPEED, G_MAG);
      if (sol) {
        const desYaw = sol.yaw + this._scYaw;
        const desPitch = clamp(sol.pitch + this._scPitch, TANK.pitchMin, TANK.pitchMax);
        const yawErr = angleDiff(desYaw, tank.aimYaw);
        const pitchErr = desPitch - tank.pitch;
        // Proportional, clamped to [-1,1] -> turns at full turret speed until close.
        action.turretYaw = clamp(yawErr / 0.03, -1, 1);
        action.turretPitch = clamp(pitchErr / 0.03, -1, 1);
        if (Math.abs(yawErr) < GAME.aiFireTol && Math.abs(pitchErr) < GAME.aiFireTol && tank.cooldown <= 0) {
          action.fire = true;
        }
      }
    }
    return action;
  }

  _rollScatter(dt) {
    this._scTimer -= dt;
    if (this._scTimer <= 0) {
      this._scTimer = 0.35 + Math.random() * 0.25;
      // Gaussian-ish (sum of uniforms) scaled by the configured scatter.
      const s = GAME.aiScatter;
      this._scYaw = ((Math.random() + Math.random() + Math.random()) / 3 - 0.5) * 2 * s;
      this._scPitch = ((Math.random() + Math.random()) / 2 - 0.5) * 2 * s;
    }
  }

  // Returns a move action that strafes perpendicular to the most threatening
  // incoming shell, or null if none is dangerous right now.
  _dodge(state, tank, dt) {
    let threat = null;
    let bestT = Infinity;
    for (const s of state.shells) {
      if (s.ownerId === tank.tankId) continue;
      const vx = s.velocity.x;
      const vz = s.velocity.z;
      const sv = vx * vx + vz * vz;
      if (sv < 1e-4) continue;
      const tClose = ((tank.position.x - s.position.x) * vx + (tank.position.z - s.position.z) * vz) / sv;
      if (tClose <= 0 || tClose > 1.6) continue;
      const cx = s.position.x + vx * tClose;
      const cz = s.position.z + vz * tClose;
      const dist = Math.hypot(cx - tank.position.x, cz - tank.position.z);
      if (dist < 3.8 && tClose < bestT) {
        bestT = tClose;
        threat = s;
      }
    }
    if (!threat) {
      this._dodgeTimer = 0;
      return null;
    }
    if (this._dodgeTimer <= 0) {
      // Imperfect reaction: sometimes the AI hesitates and eats the shot,
      // which keeps it hittable by the player.
      if (Math.random() < 0.65) {
        this._dodgeTimer = 0.45;
        this._dodgeDir = Math.random() < 0.5 ? 1 : -1;
      } else {
        this._dodgeTimer = 0.15;
        return null;
      }
    }
    this._dodgeTimer -= dt;
    const shellHeading = Math.atan2(threat.velocity.x, threat.velocity.z);
    const perp = shellHeading + (Math.PI / 2) * this._dodgeDir;
    const bodyErr = angleDiff(perp, tank.bodyYaw);
    return { bodyTurn: clamp(bodyErr / 0.12, -1, 1), drive: 1 };
  }

  // Hold a preferred range from the target, face it, and weave laterally. In
  // 'strategic' mode, when standing on cratered ground, steer toward the
  // lowest-damage nearby heading (escape the slow-down) instead.
  _pursue(state, tank, target, dt) {
    if (!target) return { bodyTurn: 0, drive: 0 };
    this._weaveTimer -= dt;
    if (this._weaveTimer <= 0) {
      this._weaveTimer = 0.8 + Math.random() * 0.8;
      this._weave = (Math.random() - 0.5) * 0.5; // +-0.25 rad bias
    }
    let toYaw = Math.atan2(target.position.x - tank.position.x, target.position.z - tank.position.z) + this._weave;
    const dist = Math.hypot(target.position.x - tank.position.x, target.position.z - tank.position.z);
    let drive = 0;
    if (dist > GAME.preferredRange + 4) drive = 1;
    else if (dist < GAME.preferredRange - 4) drive = -1;

    if (this.behavior === 'strategic' && state.terrain) {
      const avoid = this._terrainAvoidYaw(state, tank);
      if (avoid !== null) {
        toYaw = avoid; // prioritize reaching clean ground
        drive = 1;
      }
    }

    const bodyErr = angleDiff(toYaw, tank.bodyYaw);
    return { bodyTurn: clamp(bodyErr / 0.25, -1, 1), drive };
  }

  // If the tank is on damaged ground, return the yaw toward the least-damaged
  // nearby heading (8 samples); otherwise null.
  _terrainAvoidYaw(state, tank) {
    const R = 9;
    const here = state.terrain.damageAt(tank.position.x, tank.position.z);
    if (here < 0.15) return null;
    let best = null;
    let bestD = here;
    for (let i = 0; i < 8; i++) {
      const yaw = (i / 8) * Math.PI * 2;
      const d = state.terrain.damageAt(tank.position.x + Math.sin(yaw) * R, tank.position.z + Math.cos(yaw) * R);
      if (d < bestD) {
        bestD = d;
        best = yaw;
      }
    }
    return best;
  }
}
