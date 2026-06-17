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

const G_MAG = -GRAVITY; // gravity magnitude (positive)

// Normalize an angle difference to [-PI, PI].
function angleDiff(a, b) {
  let d = a - b;
  while (d > Math.PI) d -= 2 * Math.PI;
  while (d < -Math.PI) d += 2 * Math.PI;
  return d;
}

// Projectile launch angle to hit `target` from `muzzle` at speed V under
// gravity g (magnitude). Returns { yaw, pitch } (low arc) or null if the
// target is out of range.
function firingSolution(muzzle, target, V, g) {
  const dx = target.x - muzzle.x;
  const dz = target.z - muzzle.z;
  const D = Math.hypot(dx, dz);
  if (D < 1e-3) {
    return { yaw: 0, pitch: TANK.pitchMax };
  }
  const yaw = Math.atan2(dx, dz); // forward = (sin yaw, cos yaw)
  const dh = target.y - muzzle.y;
  const disc = V * V * V * V - g * (g * D * D + 2 * dh * V * V);
  if (disc < 0) return null; // unreachable
  const sq = Math.sqrt(disc);
  const pitch = Math.atan((V * V - sq) / (g * D)); // low arc
  return { yaw, pitch };
}

// Solve with a refined muzzle position (accounts for barrel raise/forward).
function solveAt(tank, aim, V, g) {
  const pivot = { x: tank.position.x, y: tank.position.y + 1.55, z: tank.position.z };
  const s1 = firingSolution(pivot, aim, V, g);
  if (!s1) return null;
  const dir = {
    x: Math.cos(s1.pitch) * Math.sin(s1.yaw),
    y: Math.sin(s1.pitch),
    z: Math.cos(s1.pitch) * Math.cos(s1.yaw),
  };
  const muzzle = { x: pivot.x + dir.x * 2.4, y: pivot.y + dir.y * 2.4, z: pivot.z + dir.z * 2.4 };
  return firingSolution(muzzle, aim, V, g) || s1;
}

// Solve while leading the target by its velocity. Two passes.
function leadAndSolve(tank, target, V, g) {
  const pivot = { x: tank.position.x, y: tank.position.y + 1.55, z: tank.position.z };
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
  constructor() {
    super();
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

    const target = state.tankById('player');

    // --- Movement: dodge an incoming shell, else hold range + weave. ---
    const dodge = this._dodge(state, tank, dt);
    if (dodge) {
      action.bodyTurn = dodge.bodyTurn;
      action.drive = dodge.drive;
    } else {
      const move = this._pursue(tank, target, dt);
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

  // Hold a preferred range from the target, face it, and weave laterally.
  _pursue(tank, target, dt) {
    if (!target) return { bodyTurn: 0, drive: 0 };
    this._weaveTimer -= dt;
    if (this._weaveTimer <= 0) {
      this._weaveTimer = 0.8 + Math.random() * 0.8;
      this._weave = (Math.random() - 0.5) * 0.5; // +-0.25 rad bias
    }
    const toYaw = Math.atan2(target.position.x - tank.position.x, target.position.z - tank.position.z) + this._weave;
    const dist = Math.hypot(target.position.x - tank.position.x, target.position.z - tank.position.z);
    let drive = 0;
    if (dist > GAME.preferredRange + 4) drive = 1;
    else if (dist < GAME.preferredRange - 4) drive = -1;
    const bodyErr = angleDiff(toYaw, tank.bodyYaw);
    return { bodyTurn: clamp(bodyErr / 0.25, -1, 1), drive };
  }
}
