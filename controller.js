import * as THREE from 'three';
import { MUZZLE_SPEED, GRAVITY, clamp } from './constants.js';
import { angleDiff, firingSolutionClamped } from './ballistics.js';

// Controllers turn intent into Actions. A Controller is the ONLY thing that
// decides what a tank tries to do each frame.
//
//   HumanController  -> reads the keyboard               (a real player)
//   NullController   -> does nothing                     (a static target/dummy)
//   AiController     -> reads GameState, returns Action  (FUTURE: an AI opponent)
//
// Because every tank gets its actions from a Controller through the same
// Action shape, swapping a dummy for an AI is a one-line change at construction.
// Nothing in Tank / GameState / Renderer knows or cares who is steering.

// The normalized per-frame action for one tank. All fields are continuous-ish
// (-1..1 from keyboard, but free to be any number for an AI).
export const NO_ACTION = Object.freeze({
  bodyTurn: 0,    // rotate the tank body (+ = left)
  drive: 0,       // drive forward (+) / back (-)
  turretYaw: 0,   // rotate turret (+ = left)
  turretPitch: 0, // elevate barrel (+ = up)
  fire: false,    // request to fire a shell
});

export class Controller {
  // eslint-disable-next-line no-unused-vars
  getAction(state, tank) {
    return NO_ACTION;
  }
}

// A do-nothing controller. Useful for practice targets and as the obvious
// placeholder that an AiController will later replace.
export class NullController extends Controller {}

// Default WASD + QE + RF + Space layout.
const DEFAULT_KEYS = {
  fwd: 'KeyW',
  back: 'KeyS',
  left: 'KeyA',
  right: 'KeyD',
  turretLeft: 'KeyQ',
  turretRight: 'KeyE',
  pitchUp: 'KeyR',
  pitchDown: 'KeyF',
  fire: 'Space',
};

export class HumanController extends Controller {
  constructor(input, camera = null, keys = DEFAULT_KEYS) {
    super();
    this.input = input;
    this.camera = camera;
    this.keys = keys;
    this.mouseAim = true; // mouse aim on by default (M toggles it off)
    this._ndc = null; // cursor in normalized device coords
    this._mouseFire = false; // left mouse button held -> fire
    this._installMouse(); // register mouse + M-key listeners
  }

  _installMouse() {
    addEventListener('mousemove', (e) => {
      this._ndc = {
        x: (e.clientX / innerWidth) * 2 - 1,
        y: -((e.clientY / innerHeight) * 2 - 1),
      };
    });
    addEventListener('mousedown', (e) => { if (e.button === 0) this._mouseFire = true; });
    addEventListener('mouseup', (e) => { if (e.button === 0) this._mouseFire = false; });
    addEventListener('keydown', (e) => {
      if (e.repeat) return;
      if (e.code === 'KeyM') this.mouseAim = !this.mouseAim;
    });
  }

  // Unproject the cursor through the camera onto the ground plane (y = 0).
  _groundPoint() {
    if (!this.camera || !this._ndc) return null;
    const cam = this.camera;
    const v = new THREE.Vector3(this._ndc.x, this._ndc.y, 0.5).unproject(cam);
    const dir = v.sub(cam.position).normalize();
    if (dir.y >= -1e-3) return null; // cursor at/above the horizon: no aim
    const t = -cam.position.y / dir.y;
    return new THREE.Vector3(cam.position.x + dir.x * t, 0, cam.position.z + dir.z * t);
  }

  getAction(state, tank) {
    const k = this.keys;
    const i = this.input;
    const action = {
      bodyTurn: (i.isDown(k.left) ? 1 : 0) + (i.isDown(k.right) ? -1 : 0),
      drive: (i.isDown(k.fwd) ? 1 : 0) + (i.isDown(k.back) ? -1 : 0),
      turretYaw: 0,
      turretPitch: 0,
      fire: i.isDown(k.fire) || this._mouseFire,
    };

    // Mouse aim (optional, toggled with M): slew turret toward the cursor's
    // ground point, clamped to max range. The arc preview always shows the
    // tank's real current aim, which lags the cursor at the turret turn rate.
    let aimed = false;
    if (this.mouseAim) {
      const g = this._groundPoint();
      if (g) {
        const sol = firingSolutionClamped(tank, g, MUZZLE_SPEED, -GRAVITY);
        action.turretYaw = clamp(angleDiff(sol.yaw, tank.aimYaw) / 0.03, -1, 1);
        action.turretPitch = clamp((sol.pitch - tank.pitch) / 0.03, -1, 1);
        aimed = true;
      }
    }
    if (!aimed) {
      action.turretYaw = (i.isDown(k.turretLeft) ? 1 : 0) + (i.isDown(k.turretRight) ? -1 : 0);
      action.turretPitch = (i.isDown(k.pitchUp) ? 1 : 0) + (i.isDown(k.pitchDown) ? -1 : 0);
    }

    tank.mouseAim = this.mouseAim && aimed;
    return action;
  }
}
