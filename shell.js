import * as THREE from 'three';
import { SHELL, COLORS } from './constants.js';

// A live shell. Extends Mesh so it lives directly in the scene graph; the
// Renderer just needs to add new shells and drop dead ones.
export class Shell extends THREE.Mesh {
  constructor(pos, vel, ownerId) {
    super(
      new THREE.SphereGeometry(SHELL.radius, 12, 10),
      new THREE.MeshStandardMaterial({
        color: COLORS.shell,
        emissive: COLORS.shell,
        emissiveIntensity: 0.7,
        roughness: 0.4,
      })
    );
    this.isShell = true;
    this.position.copy(pos);
    this.velocity = vel.clone();
    this.ownerId = ownerId; // tank id that fired it (used to skip self-hits)
    this.age = 0;
    this.alive = true;
    this._impacted = false; // ground-impact effect already spawned?
  }

  // Semi-implicit Euler: update velocity first, then position.
  integrate(dt, gravity) {
    this.age += dt;
    this.velocity.y += gravity * dt;
    this.position.addScaledVector(this.velocity, dt);
    if (this.position.y <= SHELL.radius || this.age >= SHELL.lifetime) {
      this.alive = false;
    }
  }
}
