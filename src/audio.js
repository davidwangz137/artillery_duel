// Procedural sound effects via the WebAudio API — no audio assets needed.
// Call unlockAudio() from a user gesture (key/click) before playing anything.

let ctx = null;
let master = null;
let noiseBuf = null;

export function unlockAudio() {
  if (ctx) {
    if (ctx.state === 'suspended') ctx.resume();
    return;
  }
  const AC = window.AudioContext || window.webkitAudioContext;
  if (!AC) return;
  ctx = new AC();
  master = ctx.createGain();
  master.gain.value = 0.3;
  master.connect(ctx.destination);

  // Pre-bake a short white-noise buffer for impacts.
  noiseBuf = ctx.createBuffer(1, ctx.sampleRate * 0.4, ctx.sampleRate);
  const d = noiseBuf.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
}

function tone({ type = 'sine', from, to, dur, peak = 0.6, delay = 0 }) {
  if (!ctx) return;
  const t = ctx.currentTime + delay;
  const osc = ctx.createOscillator();
  const g = ctx.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(from, t);
  osc.frequency.exponentialRampToValueAtTime(Math.max(to, 1), t + dur);
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(peak, t + 0.008);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  osc.connect(g);
  g.connect(master);
  osc.start(t);
  osc.stop(t + dur + 0.02);
}

function noiseBurst({ dur = 0.3, peak = 0.6, cutoff = 800, delay = 0 }) {
  if (!ctx || !noiseBuf) return;
  const t = ctx.currentTime + delay;
  const src = ctx.createBufferSource();
  src.buffer = noiseBuf;
  const lp = ctx.createBiquadFilter();
  lp.type = 'lowpass';
  lp.frequency.setValueAtTime(cutoff, t);
  lp.frequency.exponentialRampToValueAtTime(Math.max(cutoff * 0.2, 60), t + dur);
  const g = ctx.createGain();
  g.gain.setValueAtTime(peak, t);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  src.connect(lp);
  lp.connect(g);
  g.connect(master);
  src.start(t);
  src.stop(t + dur + 0.02);
}

// A shell leaves the barrel. Player shots are louder/crisper.
export function fire(byPlayer) {
  tone({ type: 'triangle', from: byPlayer ? 240 : 170, to: 55, dur: 0.18, peak: byPlayer ? 0.7 : 0.32 });
  noiseBurst({ dur: 0.12, peak: byPlayer ? 0.25 : 0.1, cutoff: 1200 });
}

// A shell hits the ground. Volume attenuates with distance from the player.
export function impact(volume = 0.5) {
  if (volume <= 0.02) return;
  noiseBurst({ dur: 0.32, peak: 0.6 * volume, cutoff: 600 });
  tone({ type: 'sine', from: 90, to: 40, dur: 0.28, peak: 0.5 * volume });
}

// A shell strikes a tank.
export function hit() {
  tone({ type: 'square', from: 520, to: 180, dur: 0.12, peak: 0.4 });
  tone({ type: 'triangle', from: 780, to: 300, dur: 0.1, peak: 0.25, delay: 0.005 });
}

// The run ends.
export function gameOver() {
  tone({ type: 'sawtooth', from: 330, to: 70, dur: 0.9, peak: 0.4 });
  tone({ type: 'sine', from: 160, to: 50, dur: 1.1, peak: 0.3, delay: 0.05 });
}
