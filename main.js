import * as THREE from 'three';
import { ARENA, COLORS, GAME } from './constants.js';
import { GameState } from './gamestate.js';
import { Renderer } from './renderer.js';
import { Tank } from './tank.js';
import { HumanController, NullController } from './controller.js';
import { AiController } from './ai.js';
import { KeyboardInput } from './input.js';
import { Hud } from './hud.js';
import * as audio from './audio.js';

// Entry point. Wires together: Renderer (view) <-> GameState (model) <->
// Controllers (intent). The loop is: controllers produce Actions, state.step
// advances the world, renderer draws it.

const MODE = { TITLE: 'title', PLAYING: 'playing', PAUSED: 'paused', GAME_OVER: 'game_over' };
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

  // --- AI opponents. Each is a Tank + an AiController. spawnEnemy() is reused
  //     by the difficulty ramp, so the roster grows as the player scores. ---
  const spawnEnemy = () => {
    const i = enemies.length;
    const enemy = new Tank({
      id: `enemy-${i}`,
      color: COLORS.enemyPalette[i % COLORS.enemyPalette.length],
      name: `Enemy ${i + 1}`,
    });
    const x = (Math.random() * 2 - 1) * ARENA.half * 0.8;
    const z = ARENA.half * (0.3 + Math.random() * 0.55);
    enemy._spawn.set(x, 0, z);
    enemy.position.copy(enemy._spawn);
    enemy.bodyYaw = Math.PI; // face the player
    enemy.fireCooldown = GAME.aiCooldown;
    state.addTank(enemy, new AiController());
    enemies.push(enemy);
  };
  for (let i = 0; i < GAME.numOpponents; i++) spawnEnemy();

  renderer.init(state);
  const hud = new Hud(state, player, enemies);
  // Dev affordance: visit /#debug to expose internals for testing/inspection.
  if (location.hash === '#debug') window.__game = { state, player, enemies, renderer, input, get mode() { return mode; }, get score() { return score; } };

  let mode = MODE.TITLE;
  let score = 0;
  let best = parseInt(localStorage.getItem('artillery_best') || '0', 10) || 0;

  const resetGame = () => {
    score = 0;
    state.shells.length = 0;
    state.effects.length = 0;
    // Trim any ramp-spawned enemies back to the starting roster.
    while (enemies.length > GAME.numOpponents) {
      const e = enemies.pop();
      const idx = state.tanks.indexOf(e);
      if (idx >= 0) state.tanks.splice(idx, 1);
    }
    for (const t of state.tanks) t.respawn();
    mode = MODE.PLAYING;
  };

  // Title -> any key starts (and unlocks audio). P/Esc toggles pause during
  // play. Game over -> Enter restarts. `e.repeat` ignores key autorepeat so
  // holding P can't flicker pause/resume.
  addEventListener('keydown', (e) => {
    if (e.repeat) return;
    if (mode === MODE.TITLE) {
      audio.unlockAudio();
      mode = MODE.PLAYING;
    } else if (mode === MODE.GAME_OVER) {
      if (e.code === 'Enter') resetGame();
    } else if (e.code === 'KeyP' || e.code === 'Escape') {
      mode = mode === MODE.PAUSED ? MODE.PLAYING : MODE.PAUSED;
    }
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

      // Score player kills and drive sound from this tick's events.
      for (const ev of state.events) {
        if (ev.type === 'hit' && ev.fatal && ev.by === 'player') {
          score += 1;
          // Difficulty ramp: every rampKills, add an enemy (up to the cap).
          if (score % GAME.rampKills === 0 && enemies.length < GAME.maxOpponents) {
            spawnEnemy();
          }
        }
        if (ev.type === 'fire') audio.fire(ev.by === 'player');
        else if (ev.type === 'hit') audio.hit();
        else if (ev.type === 'impact') {
          const d = Math.hypot(ev.x - player.position.x, ev.z - player.position.z);
          audio.impact(Math.max(0, 1 - d / 60));
        }
      }
      // Player death ends the run (player never auto-respawns).
      if (!player.alive) {
        mode = MODE.GAME_OVER;
        if (score > best) {
          best = score;
          localStorage.setItem('artillery_best', String(best));
        }
        audio.gameOver();
      }
    }

    renderer.sync(state, player);
    renderer.render();
    hud.update(state, { score, mode, best });

    requestAnimationFrame(loop);
  };
  requestAnimationFrame(loop);
}

main();
