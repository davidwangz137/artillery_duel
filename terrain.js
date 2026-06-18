import * as THREE from 'three';
import { ARENA, TERRAIN, clamp } from './constants.js';

// Ground damage grid + texture. Shells crater the ground on impact; cratered
// ground slows tanks (see Tank.applyAction). Cumulative damage eventually pins
// everyone down — the endgame pressure that stops infinite kiting.
//
// The grid is painted to a CanvasTexture used as the ground's albedo map, so
// damage is visible. Indexing: cell (gx,gz) <-> world (x,z); canvas row = gz,
// column = gx, with the texture's default flipY so the crater lands at the
// correct world position.

const UNDAMAGED = { r: 0x4a, g: 0x7a, b: 0x44 }; // matches COLORS.ground
const CRATERED = { r: 0x2a, g: 0x20, b: 0x18 };

export class Terrain {
  constructor(arena = ARENA, resolution = TERRAIN.resolution) {
    this.arena = arena;
    this.res = resolution;
    this.size = arena.half * 2;
    this.cell = this.size / resolution;
    this.grid = new Float32Array(resolution * resolution); // damage in [0,1]
    this.dirty = true;

    this.canvas = document.createElement('canvas');
    this.canvas.width = this.canvas.height = resolution;
    this.ctx = this.canvas.getContext('2d');
    this.texture = new THREE.CanvasTexture(this.canvas);
    this.texture.magFilter = THREE.LinearFilter;
    this.texture.minFilter = THREE.LinearFilter;
    this._repaint();
  }

  _cell(x, z) {
    const h = this.arena.half;
    const gx = clamp(Math.floor(((x + h) / this.size) * this.res), 0, this.res - 1);
    const gz = clamp(Math.floor(((z + h) / this.size) * this.res), 0, this.res - 1);
    return [gx, gz];
  }

  // Nearest-cell damage at a world position (used for the movement slow-down).
  damageAt(x, z) {
    const [gx, gz] = this._cell(x, z);
    return this.grid[gz * this.res + gx];
  }

  // Add a crater: gaussian falloff from the center, clamped to full damage.
  applyImpact(x, z, radius = TERRAIN.blastRadius, amount = TERRAIN.blastAmount) {
    const h = this.arena.half;
    const rCells = Math.ceil(radius / this.cell);
    const [cx, cz] = this._cell(x, z);
    const twoSigSq = 2 * (radius * 0.5) * (radius * 0.5);
    for (let dz = -rCells; dz <= rCells; dz++) {
      const gz = cz + dz;
      if (gz < 0 || gz >= this.res) continue;
      const wz = -h + (gz + 0.5) * this.cell;
      for (let dx = -rCells; dx <= rCells; dx++) {
        const gx = cx + dx;
        if (gx < 0 || gx >= this.res) continue;
        const wx = -h + (gx + 0.5) * this.cell;
        const d2 = (wx - x) * (wx - x) + (wz - z) * (wz - z);
        const fall = Math.exp(-d2 / twoSigSq);
        const idx = gz * this.res + gx;
        this.grid[idx] = Math.min(1, this.grid[idx] + amount * fall);
      }
    }
    this.dirty = true;
  }

  _repaint() {
    const img = this.ctx.createImageData(this.res, this.res);
    const d = img.data;
    for (let i = 0; i < this.grid.length; i++) {
      const dmg = this.grid[i];
      d[i * 4] = UNDAMAGED.r + ((CRATERED.r - UNDAMAGED.r) * dmg) | 0;
      d[i * 4 + 1] = UNDAMAGED.g + ((CRATERED.g - UNDAMAGED.g) * dmg) | 0;
      d[i * 4 + 2] = UNDAMAGED.b + ((CRATERED.b - UNDAMAGED.b) * dmg) | 0;
      d[i * 4 + 3] = 255;
    }
    this.ctx.putImageData(img, 0, 0);
    this.texture.needsUpdate = true;
    this.dirty = false;
  }

  // Call once per frame; repaints only if damage changed.
  update() {
    if (this.dirty) this._repaint();
  }

  reset() {
    this.grid.fill(0);
    this.dirty = true;
    this.update();
  }
}
