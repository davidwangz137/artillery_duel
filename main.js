import * as THREE from 'three';
import { ARENA, COLORS } from './constants.js';
import { GameState } from './gamestate.js';
import { Renderer } from './renderer.js';
import { Tank } from './tank.js';
import { HumanController, NullController } from './controller.js';
import { KeyboardInput } from './input.js';
import { Hud } from './hud.js';

// Entry point. Wires together: Renderer (view) <-> GameState (model) <->
// Controllers (intent). The loop is: controllers produce Actions, state.step
// advances the world, renderer draws it.

function main() {
  const canvas = document.getElementById('game');
  const renderer = new Renderer(canvas);
  const input = new KeyboardInput();

  const state = new GameState(ARENA);

  // Player (human) at the far -Z end, facing +Z (toward the target).
  const player = new Tank({ id: 'player', color: COLORS.player, name: 'You' });
  player._spawn.set(0, 0, -ARENA.half * 0.7);
  player.position.copy(player._spawn);
  player.bodyYaw = 0;
  player._syncMesh?.();
  state.addTank(player, new HumanController(input));

  // Static practice target at +Z. This is exactly the slot a future
  // AiController drops into — swap NullController for AiController and it fights.
  const target = new Tank({ id: 'target', color: COLORS.target, name: 'Target' });
  target._spawn.set(0, 0, ARENA.half * 0.7);
  target.position.copy(target._spawn);
  target.bodyYaw = Math.PI; // face the player
  target._syncMesh?.();
  state.addTank(target, new NullController());

  renderer.init(state);
  const hud = new Hud(state, player, target);

  const resize = () => renderer.resize(innerWidth, innerHeight);
  addEventListener('resize', resize);
  resize();

  let last = performance.now();
  const loop = (now) => {
    let dt = (now - last) / 1000;
    last = now;
    dt = Math.min(dt, 1 / 30); // clamp big gaps (e.g. tab switch)

    state.step(dt);
    renderer.sync(state, player);
    renderer.render();
    hud.update(state);

    requestAnimationFrame(loop);
  };
  requestAnimationFrame(loop);
}

main();
