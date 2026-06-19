import * as THREE from 'three';
import {
  ARENA,
  TANK,
  COMBAT,
  DRIVING,
  RESPAWN,
  MUZZLE_SPEED,
  clamp,
} from './constants.js';

// Scratch vectors (avoid per-frame allocations).
const _aim = new THREE.Vector3();
const _muzzle = new THREE.Vector3();
const _oldPos = new THREE.Vector3();
const _nrm = new THREE.Vector3();
const _localN = new THREE.Vector3();
const _up = new THREE.Vector3();
const _q = new THREE.Quaternion();

// A tank. Extends THREE.Group: its world transform IS its position/orientation.
// Has no idea who is steering it — that's a Controller's job (see applyAction).
export class Tank extends THREE.Group {
  constructor({ id, color, name }) {
    super();
    this.isTank = true;
    this.tankId = id;
    this.name = name;
    this.color = color;

    this.maxHp = COMBAT.maxHp;
    this.hp = this.maxHp;

    // Pose state. bodyYaw + turretYawOffset combine into the world aim yaw.
    this.bodyYaw = 0;
    this.turretYawOffset = 0;
    this.pitch = Math.PI / 6; // 30° default elevation
    this.cooldown = 0;        // seconds until next shot allowed
    this.velocity = new THREE.Vector3(); // observed by future AI for target-leading
    this.hitFlash = 0;        // seconds of red emissive flash remaining
    this.alive = true;
    this.respawnTimer = 0;
    this._spawn = new THREE.Vector3(); // set by the spawner; used on respawn
    this.fireCooldown = COMBAT.fireCooldown; // per-tank shot cooldown (AI overrides to shoot slower)
    this.autoRespawn = true;                 // player sets this false (game over on death)
    this.team = 0;                           // team id; enemies are tanks on other teams
    this.pen = null;                         // {xMin,xMax,zMin,zMax} movement bounds (set by spawner)
    this.mouseAim = false;                   // HUD hint (set by HumanController)
    this.buffs = Object.create(null);        // { speed?: {value,expiresAt}, blastRadius?: {...} }

    this._build(color);
    this.scale.setScalar(TANK.scale); // shrink the model relative to the world
  }

  _build(color) {
    const bodyMat = new THREE.MeshStandardMaterial({ color, roughness: 0.6, metalness: 0.15 });

    // Body sits in a pivot that pitches to the surface normal; the turret is a
    // sibling (kept upright) so aiming is unaffected by the body tilt.
    const bodyPivot = new THREE.Group();
    this.add(bodyPivot);
    this.bodyPivot = bodyPivot;
    const body = new THREE.Mesh(new THREE.BoxGeometry(3, 1.2, 4), bodyMat);
    body.position.y = 0.9;
    bodyPivot.add(body);
    this.bodyMesh = body; // flashed red on hit

    // Turret pivots on yaw (relative to body); barrel pitches inside it.
    const turret = new THREE.Group();
    turret.position.y = 1.5;
    this.add(turret);
    this.turret = turret;

    const dome = new THREE.Mesh(new THREE.CylinderGeometry(1.1, 1.3, 0.9, 14), bodyMat);
    turret.add(dome);

    // Cylinder geometry points along +Y; lay it along +Z then elevate via pitch.
    const barrel = new THREE.Mesh(
      new THREE.CylinderGeometry(0.18, 0.18, 2.6, 10),
      new THREE.MeshStandardMaterial({ color: 0x222222, metalness: 0.3, roughness: 0.5 })
    );
    barrel.rotation.x = Math.PI / 2;
    barrel.position.set(0, 0.05, 1.1);
    turret.add(barrel);
    this.barrel = barrel;
    this._muzzleForward = 2.4; // distance from turret pivot to muzzle, along aim dir
  }

  get aimYaw() {
    return this.bodyYaw + this.turretYawOffset;
  }

  // Unit vector the barrel points, in world space.
  aimDirection(out = _aim) {
    const y = this.aimYaw;
    const p = this.pitch;
    return out.set(Math.cos(p) * Math.sin(y), Math.sin(p), Math.cos(p) * Math.cos(y));
  }

  muzzlePosition(out = _muzzle) {
    out.set(this.position.x, this.position.y + TANK.muzzleHeight, this.position.z);
    out.addScaledVector(this.aimDirection(), TANK.muzzleForward);
    return out;
  }

  updateBuffs(now) {
    for (const [k, v] of Object.entries(this.buffs)) {
      if (v.expiresAt <= now) delete this.buffs[k];
    }
  }

  clearBuffs() {
    this.buffs = Object.create(null);
  }

  applyBuff(type, value, duration, now) {
    this.buffs[type] = { value, expiresAt: now + duration };
  }

  getBuffMultiplier(type) {
    return this.buffs[type]?.value ?? 1;
  }

  moveSpeedMultiplier() {
    return this.getBuffMultiplier('speed');
  }

  explosionRadiusMultiplier() {
    return this.getBuffMultiplier('blastRadius');
  }

  activeBuffs(now) {
    return Object.entries(this.buffs).map(([type, v]) => ({
      type,
      value: v.value,
      timeLeft: Math.max(0, v.expiresAt - now),
    }));
  }

  // Apply one frame's intent. Movement, aim, and firing all happen here.
  // Spawns a shell into `state` when firing and off cooldown.
  applyAction(a, dt, state) {
    if (!this.alive) return;

    // Body rotation + heightfield-aware drive.
    this.bodyYaw += a.bodyTurn * TANK.bodyTurnSpeed * dt;
    _oldPos.copy(this.position);
    const fwdX = Math.sin(this.bodyYaw);
    const fwdZ = Math.cos(this.bodyYaw);
    const terrain = state.terrain;
    let speedMul = this.moveSpeedMultiplier();
    if (terrain) {
      // Material slow (soil = full, bedrock = slow) + slope slow (uphill grade).
      speedMul *= terrain.materialAt(this.position.x, this.position.z).slow;
      const n = terrain.normalAt(this.position.x, this.position.z, _nrm);
      const grade = -(n.x * fwdX + n.z * fwdZ) / Math.max(n.y, 1e-3); // + = uphill
      speedMul *= clamp(1 - grade * DRIVING.uphillCost, DRIVING.minSlopeMul, DRIVING.maxSlopeMul);
    }
    let mx = fwdX * a.drive * TANK.driveSpeed * speedMul * dt;
    let mz = fwdZ * a.drive * TANK.driveSpeed * speedMul * dt;
    // Climb limit: forbid impossible uphill moves (treads hold — no slide).
    if (terrain) {
      const hCur = terrain.heightAt(this.position.x, this.position.z);
      const hNew = terrain.heightAt(this.position.x + mx, this.position.z + mz);
      const step = Math.hypot(mx, mz);
      if (step > 1e-4 && (hNew - hCur) / step > DRIVING.maxClimb) { mx = 0; mz = 0; }
    }
    this.position.x += mx;
    this.position.z += mz;
    // Clamp to this tank's pen (its team's region) — or the arena if unset.
    const p = this.pen || { xMin: -ARENA.half + 1.5, xMax: ARENA.half - 1.5, zMin: -ARENA.half + 1.5, zMax: ARENA.half - 1.5 };
    this.position.x = clamp(this.position.x, p.xMin, p.xMax);
    this.position.z = clamp(this.position.z, p.zMin, p.zMax);
    // Ground follow (fake suspension) + body pitch to the surface normal.
    if (terrain) {
      const groundY = terrain.heightAt(this.position.x, this.position.z) + DRIVING.groundClearance;
      this.position.y += (groundY - this.position.y) * DRIVING.yLerp;
      this._applyBodyPitch(terrain);
    }
    // Observed velocity (for AI target-leading).
    const inv = 1 / Math.max(dt, 1e-4);
    this.velocity.set((this.position.x - _oldPos.x) * inv, 0, (this.position.z - _oldPos.z) * inv);

    // Turret aim.
    this.turretYawOffset += a.turretYaw * TANK.turretYawSpeed * dt;
    this.pitch = clamp(this.pitch + a.turretPitch * TANK.turretPitchSpeed * dt, TANK.pitchMin, TANK.pitchMax);

    // Cooldown + fire.
    if (this.cooldown > 0) this.cooldown = Math.max(0, this.cooldown - dt);
    if (a.fire && this.cooldown <= 0) {
      this.cooldown = this.fireCooldown;
      this._fire(state);
    }

    // Decay hit flash.
    if (this.hitFlash > 0) this.hitFlash = Math.max(0, this.hitFlash - dt);
    this._syncMesh();
  }

  _fire(state) {
    const dir = this.aimDirection(new THREE.Vector3());
    const muzzle = this.muzzlePosition(new THREE.Vector3());
    state.spawnShell(muzzle, dir.multiplyScalar(MUZZLE_SPEED), this.tankId, this.explosionRadiusMultiplier());
    state.spawnMuzzleFlash(muzzle);
  }

  // Tilt the body to the surface normal (shortest rotation of body-up onto the
  // local normal), smoothed. The turret is a sibling so it stays upright.
  _applyBodyPitch(terrain) {
    if (!DRIVING.bodyPitch) { this.bodyPivot.quaternion.set(0, 0, 0, 1); return; }
    const n = terrain.normalAt(this.position.x, this.position.z, _nrm);
    // Express the world normal in the (yawed) parent's local frame.
    const cy = Math.cos(this.bodyYaw);
    const sy = Math.sin(this.bodyYaw);
    _localN.set(n.x * cy - n.z * sy, n.y, n.x * sy + n.z * cy).normalize();
    _q.setFromUnitVectors(_up.set(0, 1, 0), _localN);
    this.bodyPivot.quaternion.slerp(_q, DRIVING.pitchLerp);
  }

  _syncMesh() {
    this.rotation.y = this.bodyYaw;
    this.turret.rotation.y = this.turretYawOffset;
    this.barrel.rotation.x = Math.PI / 2 - this.pitch; // lay along Z, then elevate up
    const mat = this.bodyMesh.material;
    if (this.hitFlash > 0) {
      mat.emissive.setHex(0xff0000);
      mat.emissiveIntensity = Math.min(1, this.hitFlash * 4);
    } else {
      mat.emissive.setHex(0x000000);
      mat.emissiveIntensity = 0;
    }
  }

  takeDamage(d) {
    if (!this.alive) return;
    this.hp -= d;
    this.hitFlash = 0.25;
    if (this.hp <= 0) {
      this.hp = 0;
      this.alive = false;
      this.respawnTimer = RESPAWN.delay;
      this.visible = false;
    }
  }

  respawn() {
    this.hp = this.maxHp;
    this.alive = true;
    this.visible = true;
    this.position.copy(this._spawn);
    this.bodyYaw = 0;
    this.turretYawOffset = 0;
    this.pitch = Math.PI / 6;
    this.cooldown = 0;
    this.hitFlash = 0;
    this.velocity.set(0, 0, 0);
    if (this.bodyPivot) this.bodyPivot.quaternion.set(0, 0, 0, 1);
    this.mouseAim = false;
    this.clearBuffs();
    this._syncMesh();
  }
}
