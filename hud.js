// HTML/DOM overlay: player HP, score, enemies remaining, event toasts, and the
// game-over screen. Reads from GameState each frame; never mutates it.

function el(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  return e;
}

// Shown on the title, pause, and game-over overlays (and the in-play help).
const CONTROLS = 'WASD drive/turn  ·  Q/E turret  ·  R/F aim  ·  SPACE fire  ·  P/Esc pause  ·  M mouse-aim';

export class Hud {
  constructor(state, player, enemies, root = document.getElementById('hud')) {
    this.state = state;
    this.player = player;
    this.enemies = enemies;

    this.help = root.appendChild(el('div', 'help', CONTROLS));

    this.bars = root.appendChild(el('div', 'bars'));
    this.playerBar = this._bar('YOU', '#4a90d9');

    this.stats = root.appendChild(el('div', 'stats', ''));
    this.status = root.appendChild(el('div', 'status', ''));

    this.overlay = root.appendChild(el('div', 'overlay hidden'));
    this.overlayTitle = this.overlay.appendChild(el('div', 'overlay-title', ''));
    this.overlayScore = this.overlay.appendChild(el('div', 'overlay-score', ''));
    this.overlayControls = this.overlay.appendChild(el('div', 'overlay-controls', CONTROLS));
    this.overlayHint = this.overlay.appendChild(el('div', 'overlay-hint', ''));
  }

  _bar(label, color) {
    const row = this.bars.appendChild(el('div', 'bar-row'));
    row.appendChild(el('span', 'bar-label', label));
    const track = row.appendChild(el('div', 'bar-track'));
    const fill = track.appendChild(el('div', 'bar-fill'));
    fill.style.background = color;
    row.appendChild(el('span', 'bar-hp', ''));
    return { row, fill, hp: row.querySelector('.bar-hp') };
  }

  update(state, { score, mode, best }) {
    this._setHp(this.playerBar, this.player);
    this.help.textContent = CONTROLS + '  ·  AIM ' + (this.player.mouseAim ? 'mouse' : 'keys');

    const alive = this.enemies.filter((e) => e.alive).length;
    this.stats.textContent = `SCORE ${score}   ·   ENEMIES ${alive}/${this.enemies.length}`;

    // In play: no overlay; show reload status + hit toasts.
    if (mode === 'playing') {
      this.overlay.classList.add('hidden');
      const ready = this.player.cooldown <= 0;
      let toast = '';
      for (const ev of state.events) {
        if (ev.type === 'hit' && ev.by === 'player') toast = ev.fatal ? 'KILL!' : 'Hit!';
      }
      this.status.textContent =
        `[ ${ready ? 'READY' : `reload ${this.player.cooldown.toFixed(1)}s`} ]` +
        (toast ? '   ' + toast : '');
      return;
    }

    // Overlay screens (title / paused / game over) share the controls line.
    this.overlay.classList.remove('hidden');
    this.status.textContent = '';
    if (mode === 'title') {
      this.overlayTitle.textContent = 'ARTILLERY DUEL';
      this.overlayScore.textContent = '';
      this.overlayHint.textContent = 'Press any key to start';
    } else if (mode === 'paused') {
      this.overlayTitle.textContent = 'PAUSED';
      this.overlayScore.textContent = `Score ${score}   ·   Best ${best}`;
      this.overlayHint.textContent = 'Press P to resume';
    } else {
      // game_over
      this.overlayTitle.textContent = 'GAME OVER';
      this.overlayScore.textContent = `Final score: ${score}   ·   Best: ${best}`;
      this.overlayHint.textContent = 'Press ENTER to restart';
    }
  }

  _setHp(bar, tank) {
    const pct = Math.max(0, tank.hp) / tank.maxHp;
    bar.fill.style.width = (pct * 100).toFixed(1) + '%';
    bar.hp.textContent = tank.alive ? Math.ceil(tank.hp).toString() : 'down';
    bar.row.style.opacity = tank.alive ? '1' : '0.45';
  }
}
