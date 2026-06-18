import * as THREE from 'three';
import { ARENA, COLORS, GAME, TEAMS } from './constants.js';
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

// Split the arena into `count` Z-stripes with a 2*buffer no-man's-land between
// adjacent pens. Each pen keeps a team penned in, so opposing tanks can never
// close to point-blank (the "too close to aim" tie).
function makeTeamPens(half, buffer, count) {
  const margin = 1.5;
  const gap = 2 * buffer;
  const stripe = (2 * half - (count - 1) * gap) / count;
  const pens = [];
  for (let i = 0; i < count; i++) {
    const zMin = -half + i * (stripe + gap);
    const zMax = zMin + stripe;
    pens.push({ xMin: -half + margin, xMax: half - margin, zMin: zMin + margin, zMax: zMax - margin });
  }
  return pens;
}
function main() {
  const canvas = document.getElementById('game');
  const renderer = new Renderer(canvas);
  const input = new KeyboardInput();

  const state = new GameState(ARENA);
  const enemies = [];

  // --- Pre-game config (persisted), toggled on the title screen. ---
  let config;
  try { config = JSON.parse(localStorage.getItem('artillery_config')) || {}; } catch (e) { config = {}; }
  config = Object.assign({ enemyRespawn: true, aiBehavior: 'random' }, config);
  const saveConfig = () => { try { localStorage.setItem('artillery_config', JSON.stringify(config)); } catch (e) {} };
  const applyConfig = () => {
    for (const e of enemies) {
      e.autoRespawn = config.enemyRespawn;
      state.controllers[e.tankId] = new AiController(config.aiBehavior);
    }
  };

  // --- Team pens: split the map along Z into TEAMS.count stripes separated by
  //     a no-man's-land, so opposing tanks can never close to point-blank. ---
  const pens = makeTeamPens(ARENA.half, TEAMS.buffer, TEAMS.count);

  // --- Player (human) on team 0. autoRespawn=false: death ends the run. ---
  const player = new Tank({ id: 'player', color: COLORS.player, name: 'You' });
  player.autoRespawn = false;
  player.team = 0;
  player.pen = pens[0];
  player._spawn.set(0, 0, pens[0].zMin * 0.7); // deep in their own pen
  player.position.copy(player._spawn);
  player.bodyYaw = 0; // face +Z, toward the enemy pen
  state.addTank(player, new HumanController(input, renderer.camera));

  // --- AI opponents on team 1. spawnEnemy() is reused by the difficulty ramp,
  //     so the roster grows as the player scores. ---
  const spawnEnemy = () => {
    const i = enemies.length;
    const enemy = new Tank({
      id: `enemy-${i}`,
      color: COLORS.enemyPalette[i % COLORS.enemyPalette.length],
      name: `Enemy ${i + 1}`,
    });
    enemy.team = 1;
    enemy.pen = pens[1];
    const p = pens[1];
    enemy._spawn.set(
      p.xMin + Math.random() * (p.xMax - p.xMin),
      0,
      p.zMin + Math.random() * (p.zMax - p.zMin)
    );
    enemy.position.copy(enemy._spawn);
    enemy.fireCooldown = GAME.aiCooldown;
    enemy.autoRespawn = config.enemyRespawn;
    state.addTank(enemy, new AiController(config.aiBehavior));
    enemies.push(enemy);
  };
  for (let i = 0; i < GAME.numOpponents; i++) spawnEnemy();
  applyConfig();

  renderer.init(state);
  const hud = new Hud(state, player, enemies);
  // Dev affordance: visit /#debug to expose internals for testing/inspection.
  if (location.hash === '#debug') window.__game = { state, player, enemies, renderer, input, get mode() { return mode; }, get score() { return score; } };

  let mode = MODE.TITLE;
  let score = 0;
  let won = false;
  let best = parseInt(localStorage.getItem('artillery_best') || '0', 10) || 0;

  const resetGame = () => {
    score = 0;
    won = false;
    state.shells.length = 0;
    state.explosions.length = 0;
    state.powerups.length = 0;
    state.effects.length = 0;
    state.nextPowerupAt.clear();
    state.time = 0;
    if (state.terrain) state.terrain.reset(); // fresh field each run
    // Trim any ramp-spawned enemies back to the starting roster.
    while (enemies.length > GAME.numOpponents) {
      const e = enemies.pop();
      const idx = state.tanks.indexOf(e);
      if (idx >= 0) state.tanks.splice(idx, 1);
    }
    for (const t of state.tanks) t.respawn();
    applyConfig(); // reflect current respawn mode + AI behavior
    mode = MODE.PLAYING;
  };

  // Title screen: 1 toggles enemy respawn, 2 toggles AI behavior, Enter/Space
  // starts. P/Esc toggles pause during play. Game over -> Enter restarts.
  // `e.repeat` ignores key autorepeat so holding P can't flicker pause/resume.
  addEventListener('keydown', (e) => {
    if (e.repeat) return;
    if (mode === MODE.TITLE) {
      audio.unlockAudio();
      if (e.code === 'Digit1') { config.enemyRespawn = !config.enemyRespawn; saveConfig(); }
      else if (e.code === 'Digit2') { config.aiBehavior = config.aiBehavior === 'random' ? 'strategic' : 'random'; saveConfig(); }
      else if (e.code === 'Enter' || e.code === 'Space') resetGame();
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
          // Only in respawn (survival) mode — elimination mode must be clearable.
          if (config.enemyRespawn && score % GAME.rampKills === 0 && enemies.length < GAME.maxOpponents) {
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
      // End-of-run checks. Player death = loss. In elimination mode, clearing
      // every enemy = win (they don't respawn).
      if (!player.alive) {
        mode = MODE.GAME_OVER;
        won = false;
        if (score > best) { best = score; localStorage.setItem('artillery_best', String(best)); }
        audio.gameOver();
      } else if (!config.enemyRespawn && enemies.length > 0 && enemies.every((e) => !e.alive)) {
        mode = MODE.GAME_OVER;
        won = true;
        if (score > best) { best = score; localStorage.setItem('artillery_best', String(best)); }
      }
    }

    renderer.sync(state, player);
    renderer.render();
    hud.update(state, { score, mode, best, won, config });

    requestAnimationFrame(loop);
  };
  requestAnimationFrame(loop);
}

main();
