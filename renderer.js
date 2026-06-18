import * as THREE from 'three';
import { ARENA, COLORS, GRAVITY, MUZZLE_SPEED, TEAMS } from './constants.js';

// Owns everything visual: the THREE scene, camera, lights, ground, and the
// aim-trajectory preview. It reads from GameState each frame (sync) and draws.
// It never mutates game state.

const MAX_TRAJ_POINTS = 220;
const SHELL_TRAIL_POINTS = 12;
const SHELL_TRAIL_STEP = 0.5;

export class Renderer {
  constructor(canvas) {
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(COLORS.sky);
    this.scene.fog = new THREE.Fog(COLORS.sky, ARENA.half * 3.5, ARENA.half * 7);

    this.camera = new THREE.PerspectiveCamera(50, 1, 0.1, 1000);
    // Shared angled/overhead view of the whole arena.
    this.camera.position.set(0, ARENA.half * 1.9, ARENA.half * 2.05);
    this.camera.lookAt(0, 0, 0);

    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
    this.renderer.setPixelRatio(Math.min(devicePixelRatio || 1, 2));

    this.scene.add(new THREE.HemisphereLight(0xffffff, 0x4a3f2a, 0.95));
    const dir = new THREE.DirectionalLight(0xffffff, 1.05);
    dir.position.set(ARENA.half * 1.3, ARENA.half * 2.6, ARENA.half * 0.9);
    this.scene.add(dir);

    this._buildGround();
    this._buildTrajectory();
    this._trails = new Map(); // shell -> motion-streak Line
  }

  _buildGround() {
    const size = ARENA.half * 2;
    const ground = new THREE.Mesh(
      new THREE.PlaneGeometry(size, size),
      new THREE.MeshStandardMaterial({ color: COLORS.ground, roughness: 1 })
    );
    ground.rotation.x = -Math.PI / 2;
    this.ground = ground;
    this.scene.add(ground);

    const grid = new THREE.GridHelper(size, size / 4, COLORS.gridMain, COLORS.gridSub);
    grid.position.y = 0.02;
    this.scene.add(grid);
    // No-man's-land strip between the two team pens (visual boundary).
    const nml = new THREE.Mesh(
      new THREE.PlaneGeometry(size, TEAMS.buffer * 2),
      new THREE.MeshStandardMaterial({ color: COLORS.nomansland, roughness: 1 })
    );
    nml.rotation.x = -Math.PI / 2;
    nml.position.set(0, 0.03, 0);
    this.scene.add(nml);
  }

  // Dashed predicted-arc line for the player's current aim.
  _buildTrajectory() {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(MAX_TRAJ_POINTS * 3), 3));
    geo.setDrawRange(0, 0);
    const mat = new THREE.LineDashedMaterial({
      color: 0xffffff,
      dashSize: 1,
      gapSize: 0.7,
      transparent: true,
      opacity: 0.55,
    });
    this.trajectory = new THREE.Line(geo, mat);
    this.trajectory.computeLineDistances();
    this.scene.add(this.trajectory);
  }

  init(state) {
    for (const t of state.tanks) this.scene.add(t);
    // Paint ground damage via the terrain's canvas texture.
    if (state.terrain) {
      this.ground.material.map = state.terrain.texture;
      this.ground.material.color.setHex(0xffffff);
      this.ground.material.needsUpdate = true;
    }
  }

  sync(state, aimTank) {
    if (state.terrain) state.terrain.update();
    // Add any new tanks/shells/explosions/powerups/effects that aren't in the
    // scene yet.
    for (const t of state.tanks) if (!t.parent) this.scene.add(t);
    for (const s of state.shells) if (!s.parent) this.scene.add(s);
    for (const ex of state.explosions) if (!ex.parent) this.scene.add(ex);
    for (const p of state.powerups) if (!p.parent) this.scene.add(p);
    for (const e of state.effects) if (!e.parent) this.scene.add(e);
    // Drop scene objects whose backing entity is gone.
    for (let i = this.scene.children.length - 1; i >= 0; i--) {
      const ch = this.scene.children[i];
      if (
        (ch.isShell && !state.shells.includes(ch)) ||
        (ch.isExplosion && !state.explosions.includes(ch)) ||
        (ch.isPowerup && !state.powerups.includes(ch)) ||
        (ch.isEffect && !state.effects.includes(ch)) ||
        (ch.isTank && !state.tanks.includes(ch))
      ) {
        this.scene.remove(ch);
      }
    }

    this._syncTrails(state);
    this._updateTrajectory(aimTank);
  }

  // Per-shell motion streak: a short line extruded backward along each shell's
  // velocity, so arcing shots are easy to track and dodge.
  _syncTrails(state) {
    for (const s of state.shells) {
      if (this._trails.has(s)) continue;
      const N = SHELL_TRAIL_POINTS;
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(N * 3), 3));
      const col = new Float32Array(N * 3);
      for (let i = 0; i < N; i++) {
        const a = 1 - i / (N - 1); // head bright -> tail dark
        col[i * 3] = 1.0 * a;
        col[i * 3 + 1] = 0.82 * a;
        col[i * 3 + 2] = 0.29 * a;
      }
      geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
      const line = new THREE.Line(
        geo,
        new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.85 })
      );
      line.frustumCulled = false;
      this._trails.set(s, line);
      this.scene.add(line);
    }
    for (const [s, line] of this._trails) {
      if (!state.shells.includes(s)) {
        this.scene.remove(line);
        line.geometry.dispose();
        line.material.dispose();
        this._trails.delete(s);
      }
    }
    for (const s of state.shells) {
      const line = this._trails.get(s);
      const arr = line.geometry.attributes.position.array;
      const sp = Math.hypot(s.velocity.x, s.velocity.y, s.velocity.z) || 1;
      const ux = s.velocity.x / sp, uy = s.velocity.y / sp, uz = s.velocity.z / sp;
      const N = SHELL_TRAIL_POINTS;
      for (let i = 0; i < N; i++) {
        const off = i * SHELL_TRAIL_STEP;
        arr[i * 3] = s.position.x - ux * off;
        arr[i * 3 + 1] = s.position.y - uy * off;
        arr[i * 3 + 2] = s.position.z - uz * off;
      }
      line.geometry.attributes.position.needsUpdate = true;
    }
  }

  _updateTrajectory(tank) {
    const geo = this.trajectory.geometry;
    if (!tank || !tank.alive) {
      geo.setDrawRange(0, 0);
      return;
    }
    const pos = tank.muzzlePosition(new THREE.Vector3());
    const vel = tank.aimDirection(new THREE.Vector3()).multiplyScalar(MUZZLE_SPEED);
    const arr = geo.attributes.position.array;
    const dt = 0.04;
    let n = 0;
    for (let i = 0; i < MAX_TRAJ_POINTS; i++) {
      arr[n++] = pos.x;
      arr[n++] = pos.y;
      arr[n++] = pos.z;
      vel.y += GRAVITY * dt;
      pos.addScaledVector(vel, dt);
      if (pos.y <= 0.2) {
        arr[n++] = pos.x;
        arr[n++] = pos.y;
        arr[n++] = pos.z;
        i = MAX_TRAJ_POINTS; // stop
      }
    }
    geo.setDrawRange(0, Math.floor(n / 3));
    geo.attributes.position.needsUpdate = true;
    this.trajectory.computeLineDistances();
  }

  render() {
    this.renderer.render(this.scene, this.camera);
  }

  resize(w, h) {
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }
}
