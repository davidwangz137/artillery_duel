// Keyboard input tracker. Pure state: a Set of currently-held key codes.
// Controllers poll this via isDown(code); it owns no game logic.

export class KeyboardInput {
  constructor() {
    this._down = new Set();
    this._install();
  }

  _install() {
    addEventListener('keydown', (e) => {
      this._down.add(e.code);
      // Stop Space/arrows from scrolling the page while playing.
      if (e.code === 'Space' || e.code.startsWith('Arrow')) e.preventDefault();
    });
    addEventListener('keyup', (e) => this._down.delete(e.code));
    // Release everything if the window loses focus (prevents "stuck key" bugs).
    addEventListener('blur', () => this._down.clear());
  }

  isDown(code) {
    return this._down.has(code);
  }
}
