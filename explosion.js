import * as THREE from 'three';
import { COLORS, EXPLOSION } from './constants.js';

// Authoritative explosion entity. It expands over a short TTL; tanks take
// damage the first frame the expanding radius reaches them. This is the clean
// place for radius buffs to apply.
export class Explosion extends THREE.Object3D {
  constructor(pos, ownerId, maxRadius, ttl = EXPLOSION.ttl) {
    super();
    this.isExplosion = true;
    this.position.copy(pos);
    this.ownerId = ownerId;
    this.maxRadius = maxRadius;
    this.ttl = ttl;
    this.age = 0;
    this.radius = 0;
    this.alive = true;
    this.hitIds = new Set();

    this._mesh = new THREE.Mesh(
      new THREE.SphereGeometry(1, 16, 12),
      new THREE.MeshBasicMaterial({
        color: COLORS.explosion,
        transparent: true,
        opacity: 0.65,
      })
    );
    this._mesh.scale.setScalar(0.001);
    this.add(this._mesh);
  }

  update(dt) {
    this.age += dt;
    const p = Math.min(this.age / this.ttl, 1);
    this.radius = this.maxRadius * p;
    this._mesh.scale.setScalar(Math.max(this.radius, 0.001));
    this._mesh.material.opacity = 0.65 * (1 - p);
    if (this.age >= this.ttl) this.alive = false;
  }
}
