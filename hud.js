// HTML/DOM overlay: player HP, score, enemies remaining, event toasts, and the
// game-over screen. Reads from GameState each frame; never mutates it.

function el(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  return e;
}

export class Hud {
  constructor(state, player, enemies, root = document.getElementById('hud')) {
    this.state = state;
    this.player = player;
    this.enemies = enemies;

    root.appendChild(el('div', 'help',
      'WASD drive/turn  ·  Q/E turret  ·  R/F aim  ·  SPACE fire'));

    this.bars = root.appendChild(el('div', 'bars'));
    this.playerBar = this._bar('YOU', '#4a90d9');

    this.stats = root.appendChild(el('div', 'stats', ''));
    this.status = root.appendChild(el('div', 'status', ''));

    this.overlay = root.appendChild(el('div', 'overlay hidden'));
    this.overlay.appendChild(el('div', 'overlay-title', 'GAME OVER'));
    this.overlayScore = this.overlay.appendChild(el('div', 'overlay-score', ''));
    this.overlay.appendChild(el('div', 'overlay-hint', 'Press ENTER to restart'));
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

  update(state, { score, mode }) {
    this._setHp(this.playerBar, this.player);

    const alive = this.enemies.filter((e) => e.alive).length;
    this.stats.textContent = `SCORE ${score}   ·   ENEMIES ${alive}/${this.enemies.length}`;

    if (mode === 'game_over') {
      this.status.textContent = '';
      this.overlay.classList.remove('hidden');
      this.overlayScore.textContent = `Final score: ${score}`;
      return;
    }
    this.overlay.classList.add('hidden');

    const ready = this.player.cooldown <= 0;
    let toast = '';
    for (const ev of state.events) {
      if (ev.type === 'hit' && ev.by === 'player') toast = ev.fatal ? 'KILL!' : 'Hit!';
    }
    this.status.textContent =
      `[ ${ready ? 'READY' : `reload ${this.player.cooldown.toFixed(1)}s`} ]` +
      (toast ? '   ' + toast : '');
  }

  _setHp(bar, tank) {
    const pct = Math.max(0, tank.hp) / tank.maxHp;
    bar.fill.style.width = (pct * 100).toFixed(1) + '%';
    bar.hp.textContent = tank.alive ? Math.ceil(tank.hp).toString() : 'down';
    bar.row.style.opacity = tank.alive ? '1' : '0.45';
  }
}
