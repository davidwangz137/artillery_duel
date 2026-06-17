import * as THREE from 'three';

// Short-lived visual effects (impact puffs, muzzle flashes). Purely cosmetic.
// Extends Object3D so the Renderer treats them like any other scene object.
export class Effect extends THREE.Object3D {
  constructor({ pos, color, ttl, kind = 'impact', scale = 1 }) {
    super();
    this.isEffect = true;
    this.position.copy(pos);
    this.ttl = ttl;
    this.maxTtl = ttl;
    this.kind = kind;
    this.alive = true;

    const mat = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.9 });
    this._mesh =
      kind === 'muzzle'
        ? new THREE.Mesh(new THREE.SphereGeometry(scale, 10, 8), mat)
        : new THREE.Mesh(new THREE.SphereGeometry(0.5, 12, 10), mat);
    this.add(this._mesh);
  }

  update(dt) {
    this.ttl -= dt;
    if (this.ttl <= 0) {
      this.alive = false;
      return;
    }
    const k = 1 - this.ttl / this.maxTtl; // 0 -> 1 over its life
    if (this.kind === 'impact') {
      this._mesh.scale.setScalar(0.5 + k * 3.2);
      this._mesh.material.opacity = 0.9 * (1 - k);
    } else {
      this._mesh.material.opacity = 1 - k;
    }
  }
}
