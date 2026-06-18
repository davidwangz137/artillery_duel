// Central tunables. Keep all gameplay numbers here so balancing is one-file.
// Coordinate system: XZ is the ground plane, +Y is up.

// Global tank model scale (<1 = smaller tanks relative to the world).
const TANK_SCALE = 0.85;

export const ARENA = { half: 64 }; // square arena, edge length = half*2 (128 units)

export const PHYSICS = {
  gravity: -20,      // y-acceleration on shells (units/s^2). Negative = down.
  muzzleSpeed: 48,   // shell launch speed (units/s). max range V^2/g ~= 115 across the bigger field.
};

export const SHELL = {
  radius: 0.6,
  lifetime: 8,       // seconds before auto-despawn
};

export const COMBAT = {
  maxHp: 100,
  hitDamage: 25,     // 4 hits to kill
  fireCooldown: 1.1, // seconds between shots
  tankRadius: 2.0 * TANK_SCALE, // collision sphere radius (scales with tank model)
};

export const TANK = {
  scale: TANK_SCALE,         // applied to the tank model group
  driveSpeed: 18,            // units/s (bumped for the larger arena)
  bodyTurnSpeed: 1.9,        // rad/s
  turretYawSpeed: 1.7,
  turretPitchSpeed: 1.0,
  pitchMin: 0.06,            // rad above horizontal
  pitchMax: Math.PI / 2 - 0.06,
  // Logical offsets used by aim/collision math (pre-scaled to match the model).
  muzzleHeight: 1.55 * TANK_SCALE,
  muzzleForward: 2.4 * TANK_SCALE,
  bodyCenterY: 1.0 * TANK_SCALE,
};

export const TEAMS = {
  buffer: 10, // half-width of the no-man's-land between team pens (guarantees min separation)
  count: 2,   // number of teams (pens split the map along Z)
};

export const RESPAWN = {
  delay: 2.5,        // seconds before a destroyed tank reappears
};

export const COLORS = {
  sky: 0x9fd3ff,
  ground: 0x4a7a44,
  nomansland: 0x7a6a44, // the strip between team pens (uncrossable)
  gridMain: 0x2f4f2c,
  gridSub: 0x5d7d56,
  player: 0x4a90d9,
  target: 0xd94a4a,
  shell: 0xffd24a,
  impact: 0xc8863a,
  muzzle: 0xffe08a,
  enemyPalette: [0xd94a4a, 0xd97ac0, 0xc09b3a, 0x9b5bd9],
};

// Re-exported physics scalars for convenience at call sites.
export const GRAVITY = PHYSICS.gravity;
export const MUZZLE_SPEED = PHYSICS.muzzleSpeed;

export const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);

export const GAME = {
  numOpponents: 2,    // enemies at the start of a run
  maxOpponents: 6,    // difficulty-ramp cap
  rampKills: 3,       // every this many kills, spawn one more enemy
  aiCooldown: 2.2,    // AI fires slower than the player (1.1) — firepower edge to the human
  aiScatter: 0.10,    // baseline aim scatter (rad). Bigger = easier to dodge.
  aiFireTol: 0.035,   // aim tolerance (rad) before the AI pulls the trigger
  preferredRange: 42, // distance the AI tries to keep from its target
};
