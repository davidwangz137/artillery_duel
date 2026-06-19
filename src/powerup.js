import * as THREE from 'three';
import { COLORS, POWERUPS } from './constants.js';

// Floating pickup. Lives in a team's pen until collected or expired.
export class Powerup extends THREE.Group {
  constructor(kind, team, pos, ttl = POWERUPS.lifetime) {
    super();
    this.isPowerup = true;
    this.kind = kind; // 'speed' | 'blastRadius'
    this.team = team;
    this.age = 0;
    this.ttl = ttl;
    this.alive = true;
    this.position.copy(pos);

    const color = kind === 'speed' ? COLORS.powerupSpeed : COLORS.powerupBlast;

    const core = new THREE.Mesh(
      new THREE.IcosahedronGeometry(1, 0),
      new THREE.MeshStandardMaterial({
        color,
        emissive: color,
        emissiveIntensity: 0.45,
        roughness: 0.35,
        metalness: 0.15,
      })
    );
    core.scale.setScalar(0.7);
    this.add(core);
    this.core = core;

    const ring = new THREE.Mesh(
      new THREE.TorusGeometry(1.1, 0.08, 8, 20),
      new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: 0.25 })
    );
    ring.rotation.x = Math.PI / 2;
    this.add(ring);
    this.ring = ring;
  }

  update(dt) {
    this.age += dt;
    if (this.age >= this.ttl) {
      this.alive = false;
      return;
    }
    this.rotation.y += dt * 1.5;
    const bob = Math.sin(this.age * 3.2) * 0.18;
    this.core.position.y = 0.8 + bob;
    this.ring.position.y = 0.55 + bob * 0.5;
  }
}
