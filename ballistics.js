import { TANK } from './constants.js';

// Shared projectile math for the AI and the mouse-aim controller.
// Coordinate convention: forward = (sin yaw, cos yaw) on the XZ plane; pitch is
// elevation above horizontal. `g` is the gravity magnitude (positive).

// Normalize an angle difference to [-PI, PI].
export function angleDiff(a, b) {
  let d = a - b;
  while (d > Math.PI) d -= 2 * Math.PI;
  while (d < -Math.PI) d += 2 * Math.PI;
  return d;
}

// Low-arc launch angle to hit `target` from `muzzle` at speed V under gravity g.
// Returns { yaw, pitch } or null if the target is out of range.
export function firingSolution(muzzle, target, V, g) {
  const dx = target.x - muzzle.x;
  const dz = target.z - muzzle.z;
  const D = Math.hypot(dx, dz);
  if (D < 1e-3) return { yaw: 0, pitch: TANK.pitchMax };
  const yaw = Math.atan2(dx, dz);
  const dh = target.y - muzzle.y;
  const disc = V * V * V * V - g * (g * D * D + 2 * dh * V * V);
  if (disc < 0) return null; // unreachable
  const sq = Math.sqrt(disc);
  const pitch = Math.atan((V * V - sq) / (g * D)); // low arc
  return { yaw, pitch };
}

// Solve with a refined muzzle position (accounts for barrel raise/forward).
export function solveAt(tank, aim, V, g) {
  const pivot = { x: tank.position.x, y: tank.position.y + TANK.muzzleHeight, z: tank.position.z };
  const s1 = firingSolution(pivot, aim, V, g);
  if (!s1) return null;
  const dir = {
    x: Math.cos(s1.pitch) * Math.sin(s1.yaw),
    y: Math.sin(s1.pitch),
    z: Math.cos(s1.pitch) * Math.cos(s1.yaw),
  };
  const muzzle = {
    x: pivot.x + dir.x * TANK.muzzleForward,
    y: pivot.y + dir.y * TANK.muzzleForward,
    z: pivot.z + dir.z * TANK.muzzleForward,
  };
  return firingSolution(muzzle, aim, V, g) || s1;
}

// Always returns { yaw, pitch }: the real solution if `target` is in range,
// otherwise clamped to the farthest reachable point in the target's direction
// ("lock to what is possible"). Used by mouse aim so the cursor going past max
// range still steers toward the best achievable shot.
export function firingSolutionClamped(tank, target, V, g) {
  const sol = solveAt(tank, target, V, g);
  if (sol) return sol;
  const pivot = { x: tank.position.x, y: tank.position.y + TANK.muzzleHeight, z: tank.position.z };
  const yaw = Math.atan2(target.x - pivot.x, target.z - pivot.z);
  const dh = target.y - pivot.y;
  const under = V * V * V * V - 2 * g * dh * V * V;
  const Dmax = under > 0 ? Math.sqrt(under) / g : (V * V) / g; // max horizontal range
  const pitch = Math.atan((V * V) / (g * Math.max(Dmax, 1e-3))); // boundary (disc = 0) angle
  return { yaw, pitch };
}
