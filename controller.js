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
  constructor(input, keys = DEFAULT_KEYS) {
    super();
    this.input = input;
    this.keys = keys;
  }

  getAction(state, tank) {
    const k = this.keys;
    const i = this.input;
    return {
      bodyTurn: (i.isDown(k.left) ? 1 : 0) + (i.isDown(k.right) ? -1 : 0),
      drive: (i.isDown(k.fwd) ? 1 : 0) + (i.isDown(k.back) ? -1 : 0),
      turretYaw: (i.isDown(k.turretLeft) ? 1 : 0) + (i.isDown(k.turretRight) ? -1 : 0),
      turretPitch: (i.isDown(k.pitchUp) ? 1 : 0) + (i.isDown(k.pitchDown) ? -1 : 0),
      fire: i.isDown(k.fire),
    };
  }
}
