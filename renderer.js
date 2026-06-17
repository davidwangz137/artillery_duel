import * as THREE from 'three';
import { ARENA, COLORS, GRAVITY, MUZZLE_SPEED } from './constants.js';

// Owns everything visual: the THREE scene, camera, lights, ground, and the
// aim-trajectory preview. It reads from GameState each frame (sync) and draws.
// It never mutates game state.

const MAX_TRAJ_POINTS = 220;

export class Renderer {
  constructor(canvas) {
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(COLORS.sky);
    this.scene.fog = new THREE.Fog(COLORS.sky, 110, 230);

    this.camera = new THREE.PerspectiveCamera(50, 1, 0.1, 1000);
    // Shared angled/overhead view of the whole arena.
    this.camera.position.set(0, 60, 66);
    this.camera.lookAt(0, 0, 0);

    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
    this.renderer.setPixelRatio(Math.min(devicePixelRatio || 1, 2));

    this.scene.add(new THREE.HemisphereLight(0xffffff, 0x4a3f2a, 0.95));
    const dir = new THREE.DirectionalLight(0xffffff, 1.05);
    dir.position.set(40, 80, 30);
    this.scene.add(dir);

    this._buildGround();
    this._buildTrajectory();
  }

  _buildGround() {
    const size = ARENA.half * 2;
    const ground = new THREE.Mesh(
      new THREE.PlaneGeometry(size, size),
      new THREE.MeshStandardMaterial({ color: COLORS.ground, roughness: 1 })
    );
    ground.rotation.x = -Math.PI / 2;
    this.scene.add(ground);

    const grid = new THREE.GridHelper(size, 16, COLORS.gridMain, COLORS.gridSub);
    grid.position.y = 0.02;
    this.scene.add(grid);
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
  }

  sync(state, aimTank) {
    // Add any new tanks/shells/effects that aren't in the scene yet.
    for (const t of state.tanks) if (!t.parent) this.scene.add(t);
    for (const s of state.shells) if (!s.parent) this.scene.add(s);
    for (const e of state.effects) if (!e.parent) this.scene.add(e);

    // Drop scene objects whose backing entity is gone.
    for (let i = this.scene.children.length - 1; i >= 0; i--) {
      const ch = this.scene.children[i];
      if (
        (ch.isShell && !state.shells.includes(ch)) ||
        (ch.isEffect && !state.effects.includes(ch))
      ) {
        this.scene.remove(ch);
      }
    }

    this._updateTrajectory(aimTank);
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
