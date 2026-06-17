// Central tunables. Keep all gameplay numbers here so balancing is one-file.
// Coordinate system: XZ is the ground plane, +Y is up.

export const ARENA = { half: 32 }; // square arena, edge length = half*2 (64 units)

export const PHYSICS = {
  gravity: -20,      // y-acceleration on shells (units/s^2). Negative = down.
  muzzleSpeed: 36,   // shell launch speed (units/s). ~2.5s flight at 45°, slow & dodgeable.
};

export const SHELL = {
  radius: 0.6,
  lifetime: 8,       // seconds before auto-despawn
};

export const COMBAT = {
  maxHp: 100,
  hitDamage: 25,     // 4 hits to kill
  fireCooldown: 1.1, // seconds between shots
  tankRadius: 2.0,   // collision sphere radius (approx for box tank)
};

export const TANK = {
  driveSpeed: 13,    // units/s
  bodyTurnSpeed: 1.9,// rad/s
  turretYawSpeed: 1.7,
  turretPitchSpeed: 1.0,
  pitchMin: 0.06,    // rad above horizontal
  pitchMax: Math.PI / 2 - 0.06,
};

export const RESPAWN = {
  delay: 2.5,        // seconds before a destroyed tank reappears
};

export const COLORS = {
  sky: 0x9fd3ff,
  ground: 0x4a7a44,
  gridMain: 0x2f4f2c,
  gridSub: 0x5d7d56,
  player: 0x4a90d9,
  target: 0xd94a4a,
  shell: 0xffd24a,
  impact: 0xc8863a,
  muzzle: 0xffe08a,
};

// Re-exported physics scalars for convenience at call sites.
export const GRAVITY = PHYSICS.gravity;
export const MUZZLE_SPEED = PHYSICS.muzzleSpeed;

export const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
