import * as THREE from 'three';
import { ARENA, TERRAIN, TEAMS, clamp } from './constants.js';

// Deformable heightfield terrain. Height `h(x,z)` on a regular grid; explosions
// carve smoothed craters down to an indestructible bedrock floor. Driving,
// collisions, and material/slow all query this object (heightAt / normalAt /
// materialAt). Terrain owns its mesh (vertex Y = h, vertex colors = material).
//
// Indexing: grid vertex (ix,iz) for ix,iz in [0..res] maps to world
// (x = -half + ix*cell, z = -half + iz*cell); stored at h[iz*n + ix], n = res+1.

export class Terrain {
  constructor(arena = ARENA, cfg = TERRAIN) {
    this.arena = arena;
    this.cfg = cfg;
    this.res = cfg.resolution;
    this.n = this.res + 1;
    this.size = arena.half * 2;
    this.cell = this.size / this.res;
    this.bedrockY = cfg.bedrockY;
    this.layers = cfg.layers;
    this.bedrockLayer = this.layers.find((l) => l.bedrock) || this.layers[this.layers.length - 1];
    this.h = new Float32Array(this.n * this.n); // all 0 -> flat start
    this._buildMesh();
  }

  // ---- queries (used by driving, collisions, spawns) ----

  // Bilinear height at a world position (smooth surface, not stair-stepped).
  heightAt(x, z) {
    const u = clamp((x + this.arena.half) / this.cell, 0, this.res);
    const v = clamp((z + this.arena.half) / this.cell, 0, this.res);
    const ix = Math.floor(u);
    const iz = Math.floor(v);
    const fx = u - ix;
    const fz = v - iz;
    const ix1 = Math.min(ix + 1, this.res);
    const iz1 = Math.min(iz + 1, this.res);
    const h = this.h;
    const n = this.n;
    const h00 = h[iz * n + ix];
    const h10 = h[iz * n + ix1];
    const h01 = h[iz1 * n + ix];
    const h11 = h[iz1 * n + ix1];
    const a = h00 + (h10 - h00) * fx;
    const b = h01 + (h11 - h01) * fx;
    return a + (b - a) * fz;
  }

  // Surface normal at a world position via central differences.
  normalAt(x, z, out) {
    const e = this.cell;
    const hx = this.heightAt(x + e, z) - this.heightAt(x - e, z);
    const hz = this.heightAt(x, z + e) - this.heightAt(x, z - e);
    out.set(-hx / (2 * e), 1, -hz / (2 * e));
    return out.normalize();
  }

  // Material layer at the surface (depth -> layer). { slow, color, bedrock }.
  materialAt(x, z) {
    return this.layerForHeight(this.heightAt(x, z));
  }
  layerForHeight(hh) {
    // 1-unit bedrock band: smoothing rarely reaches the exact floor, so treat
    // the bottom unit as bedrock (slow + indestructible-colored).
    if (hh <= this.bedrockY + 1) return this.bedrockLayer;
    for (const l of this.layers) if (!l.bedrock && hh >= l.above) return l;
    return this.bedrockLayer;
  }

  // ---- destruction ----

  // Carve a crater: a smooth depression of depth `Cd` within radius `Cr`,
  // bedrock-clamped, then locally smoothed to round off concavities. The no-
  // man's-land divider band is kept flat (skipped).
  crater(x, z, Cr = TERRAIN.craterRadius, Cd = TERRAIN.craterDepth) {
    const half = this.arena.half;
    const cell = this.cell;
    const cx = (x + half) / cell;
    const cz = (z + half) / cell;
    const r = Math.ceil(Cr / cell);
    const ix0 = Math.max(0, Math.floor(cx - r));
    const ix1 = Math.min(this.res, Math.ceil(cx + r));
    const iz0 = Math.max(0, Math.floor(cz - r));
    const iz1 = Math.min(this.res, Math.ceil(cz + r));
    for (let iz = iz0; iz <= iz1; iz++) {
      const wz = -half + iz * cell;
      if (Math.abs(wz) <= TEAMS.buffer) continue; // keep divider flat
      for (let ix = ix0; ix <= ix1; ix++) {
        const wx = -half + ix * cell;
        const dist = Math.hypot(wx - x, wz - z);
        if (dist > Cr) continue;
        const profile = this._profile(dist / Cr);
        const i = iz * this.n + ix;
        this.h[i] = Math.max(this.bedrockY, this.h[i] - Cd * profile);
      }
    }
    this._smooth(ix0, iz0, ix1, iz1, this.cfg.smoothingPasses);
    this._updateMeshRegion(ix0, iz0, ix1, iz1);
  }

  // smoothstep bowl: 1 at center (t=0) -> 0 at edge (t=1).
  _profile(t) {
    const x = clamp(1 - t, 0, 1);
    return x * x * (3 - 2 * x);
  }

  // Local 3x3 box blur over the crater window (+pad), `passes` times. Divider
  // cells are never written so the strip stays perfectly flat.
  _smooth(ix0, iz0, ix1, iz1, passes) {
    const n = this.n;
    const res = this.res;
    const half = this.arena.half;
    const cell = this.cell;
    const pad = passes;
    const a = Math.max(0, ix0 - pad);
    const b = Math.min(res, ix1 + pad);
    const c = Math.max(0, iz0 - pad);
    const d = Math.min(res, iz1 + pad);
    for (let p = 0; p < passes; p++) {
      const snap = this.h.slice();
      for (let iz = c; iz <= d; iz++) {
        if (Math.abs(-half + iz * cell) <= TEAMS.buffer) continue;
        for (let ix = a; ix <= b; ix++) {
          const i = iz * n + ix;
          const l = ix > 0 ? snap[i - 1] : snap[i];
          const r = ix < res ? snap[i + 1] : snap[i];
          const u = iz > 0 ? snap[i - n] : snap[i];
          const dn = iz < res ? snap[i + n] : snap[i];
          let v = (snap[i] + l + r + u + dn) * 0.2;
          if (v < this.bedrockY) v = this.bedrockY;
          this.h[i] = v;
        }
      }
    }
  }

  // ---- mesh ----

  _buildMesh() {
    const n = this.n;
    const res = this.res;
    const half = this.arena.half;
    const cell = this.cell;
    const positions = new Float32Array(n * n * 3);
    const colors = new Float32Array(n * n * 3);
    for (let iz = 0; iz < n; iz++) {
      for (let ix = 0; ix < n; ix++) {
        const i = iz * n + ix;
        positions[i * 3] = -half + ix * cell;
        positions[i * 3 + 1] = this.h[i];
        positions[i * 3 + 2] = -half + iz * cell;
        this._writeColor(colors, i, this.layerForHeight(this.h[i]));
      }
    }
    const indices = new Uint32Array(res * res * 6);
    let t = 0;
    for (let iz = 0; iz < res; iz++) {
      for (let ix = 0; ix < res; ix++) {
        const a = iz * n + ix;
        const b = a + 1;
        const c = a + n;
        const d = c + 1;
        indices[t++] = a;
        indices[t++] = c;
        indices[t++] = b;
        indices[t++] = b;
        indices[t++] = c;
        indices[t++] = d;
      }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    geo.setIndex(new THREE.BufferAttribute(indices, 1));
    geo.computeVertexNormals();
    const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1, metalness: 0 });
    this.mesh = new THREE.Mesh(geo, mat);
    this.geo = geo;
  }

  _writeColor(arr, i, layer) {
    const c = layer.color;
    arr[i * 3] = ((c >> 16) & 0xff) / 255;
    arr[i * 3 + 1] = ((c >> 8) & 0xff) / 255;
    arr[i * 3 + 2] = (c & 0xff) / 255;
  }

  // Push a crater's vertex Y + colors into the mesh and recompute normals.
  _updateMeshRegion(ix0, iz0, ix1, iz1) {
    const n = this.n;
    const pad = 1;
    const pos = this.geo.attributes.position.array;
    const col = this.geo.attributes.color.array;
    for (let iz = Math.max(0, iz0 - pad); iz <= Math.min(this.res, iz1 + pad); iz++) {
      for (let ix = Math.max(0, ix0 - pad); ix <= Math.min(this.res, ix1 + pad); ix++) {
        const i = iz * n + ix;
        pos[i * 3 + 1] = this.h[i];
        this._writeColor(col, i, this.layerForHeight(this.h[i]));
      }
    }
    this.geo.attributes.position.needsUpdate = true;
    this.geo.attributes.color.needsUpdate = true;
    this.geo.computeVertexNormals();
  }

  reset() {
    this.h.fill(0);
    const pos = this.geo.attributes.position.array;
    const col = this.geo.attributes.color.array;
    const grass = this.layerForHeight(0);
    for (let i = 0; i < this.h.length; i++) {
      pos[i * 3 + 1] = 0;
      this._writeColor(col, i, grass);
    }
    this.geo.attributes.position.needsUpdate = true;
    this.geo.attributes.color.needsUpdate = true;
    this.geo.computeVertexNormals();
  }
}
