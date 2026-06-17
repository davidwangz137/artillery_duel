// HTML/DOM overlay: HP bars, reload status, controls help, event toasts.
// Reads from GameState each frame; never mutates it.

function el(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  return e;
}

export class Hud {
  constructor(state, player, target, root = document.getElementById('hud')) {
    this.state = state;
    this.player = player;
    this.target = target;

    // Controls help (static).
    root.appendChild(el('div', 'help',
      'WASD drive/turn  ·  Q/E turret  ·  R/F aim  ·  SPACE fire'));

    // HP bars.
    this.bars = root.appendChild(el('div', 'bars'));
    this.playerBar = this._bar('YOU', '#4a90d9');
    this.targetBar = this._bar('TARGET', '#d94a4a');

    // Status line (reload + event toast).
    this.status = root.appendChild(el('div', 'status', ''));
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

  update(state) {
    this._setHp(this.playerBar, this.player);
    this._setHp(this.targetBar, this.target);

    const ready = this.player.cooldown <= 0;
    const reloadTxt = ready ? 'READY' : `reload ${this.player.cooldown.toFixed(1)}s`;

    // Latest relevant event this tick.
    let toast = '';
    for (const ev of state.events) {
      if (ev.type === 'hit' && ev.fatal) toast = 'TARGET DESTROYED!';
      else if (ev.type === 'hit' && ev.target === this.target.tankId) toast = 'Hit!';
      else if (ev.type === 'respawn' && ev.target === this.target.tankId) toast = 'target respawned';
    }
    this.status.textContent = `[ ${reloadTxt} ]${toast ? '   ' + toast : ''}`;
  }

  _setHp(bar, tank) {
    const pct = Math.max(0, tank.hp) / tank.maxHp;
    bar.fill.style.width = (pct * 100).toFixed(1) + '%';
    bar.hp.textContent = tank.alive ? Math.ceil(tank.hp).toString() : 'respawning';
    bar.row.style.opacity = tank.alive ? '1' : '0.45';
  }
}
