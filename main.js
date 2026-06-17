import * as THREE from 'three';
import { ARENA, COLORS, GAME } from './constants.js';
import { GameState } from './gamestate.js';
import { Renderer } from './renderer.js';
import { Tank } from './tank.js';
import { HumanController, NullController } from './controller.js';
import { AiController } from './ai.js';
import { KeyboardInput } from './input.js';
import { Hud } from './hud.js';

// Entry point. Wires together: Renderer (view) <-> GameState (model) <->
// Controllers (intent). The loop is: controllers produce Actions, state.step
// advances the world, renderer draws it.

const MODE = { PLAYING: 'playing', GAME_OVER: 'game_over' };

function main() {
  const canvas = document.getElementById('game');
  const renderer = new Renderer(canvas);
  const input = new KeyboardInput();

  const state = new GameState(ARENA);
  const enemies = [];

  // --- Player (human). autoRespawn=false: death ends the run. ---
  const player = new Tank({ id: 'player', color: COLORS.player, name: 'You' });
  player.autoRespawn = false;
  player._spawn.set(0, 0, -ARENA.half * 0.7);
  player.position.copy(player._spawn);
  player.bodyYaw = 0;
  state.addTank(player, new HumanController(input));

  // --- AI opponents. Each is just a Tank + an AiController. To add more,
  //     bump GAME.numOpponents — nothing else changes. ---
  for (let i = 0; i < GAME.numOpponents; i++) {
    const t = i / Math.max(1, GAME.numOpponents - 1); // 0..1 spread
    const x = (t - 0.5) * (ARENA.half * 1.1);
    const enemy = new Tank({
      id: `enemy-${i}`,
      color: COLORS.enemyPalette[i % COLORS.enemyPalette.length],
      name: `Enemy ${i + 1}`,
    });
    enemy._spawn.set(x, 0, ARENA.half * 0.7);
    enemy.position.copy(enemy._spawn);
    enemy.bodyYaw = Math.PI; // face the player
    enemy.fireCooldown = GAME.aiCooldown;
    state.addTank(enemy, new AiController());
    enemies.push(enemy);
  }

  renderer.init(state);
  const hud = new Hud(state, player, enemies);
  // Dev affordance: visit /#debug to expose internals for testing/inspection.
  if (location.hash === '#debug') window.__game = { state, player, enemies, renderer, input, get mode() { return mode; }, get score() { return score; } };

  let mode = MODE.PLAYING;
  let score = 0;

  const resetGame = () => {
    score = 0;
    state.shells.length = 0;
    state.effects.length = 0;
    for (const t of state.tanks) t.respawn();
    mode = MODE.PLAYING;
  };

  // Restart on Enter when the run is over.
  addEventListener('keydown', (e) => {
    if (e.code === 'Enter' && mode === MODE.GAME_OVER) resetGame();
  });

  const resize = () => renderer.resize(innerWidth, innerHeight);
  addEventListener('resize', resize);
  resize();

  let last = performance.now();
  const loop = (now) => {
    let dt = (now - last) / 1000;
    last = now;
    dt = Math.min(dt, 1 / 30); // clamp big gaps (e.g. tab switch)

    if (mode === MODE.PLAYING) {
      state.step(dt);

      // Score player kills from this tick's events.
      for (const ev of state.events) {
        if (ev.type === 'hit' && ev.fatal && ev.by === 'player') score += 1;
      }
      // Player death ends the run (player never auto-respawns).
      if (!player.alive) mode = MODE.GAME_OVER;
    }

    renderer.sync(state, player);
    renderer.render();
    hud.update(state, { score, mode });

    requestAnimationFrame(loop);
  };
  requestAnimationFrame(loop);
}

main();
