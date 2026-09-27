import * as THREE from 'three';
import { Music } from './Music.js';

// Every sound is synthesized at startup with Web Audio — no audio files to license, host or load.
// Sounds with a position are spatialized (HRTF), so in VR a bot's card comes from its seat.
//
// Mixing:  effects ─┐
//                   ├─ master (mute) ─ speakers
//          music ───┘

const SFX_LEVEL = 0.75; // at 100% on the slider
const MUSIC_LEVEL = 0.6;

/** Fill a mono buffer sample-by-sample. `fn(t, i)` returns the sample at time t (seconds). */
function synth(ctx, seconds, fn) {
  const n = Math.floor(seconds * ctx.sampleRate);
  const buffer = ctx.createBuffer(1, n, ctx.sampleRate);
  const data = buffer.getChannelData(0);
  let peak = 0;
  for (let i = 0; i < n; i++) {
    data[i] = fn(i / ctx.sampleRate, i);
    peak = Math.max(peak, Math.abs(data[i]));
  }
  if (peak > 0) for (let i = 0; i < n; i++) data[i] *= 0.8 / peak; // normalise
  return buffer;
}

const noise = () => Math.random() * 2 - 1;

/** A plucked/bell note starting at `start` seconds. */
function note(t, start, freq, decay, { harmonics = [1, 0.3], attack = 0.004 } = {}) {
  const u = t - start;
  if (u < 0) return 0;
  const env = Math.min(1, u / attack) * Math.exp(-u * decay);
  let s = 0;
  harmonics.forEach((amp, k) => {
    s += amp * Math.sin(2 * Math.PI * freq * (k + 1) * u);
  });
  return s * env;
}

/** Simple one-pole filters over a noise source, kept in closure state. */
function filteredNoise(lowpass = 1, highpass = false) {
  let lp = 0;
  let prev = 0;
  return () => {
    lp += (noise() - lp) * lowpass;
    const out = highpass ? lp - prev : lp;
    prev = lp;
    return out;
  };
}

const RECIPES = {
  // Card leaving the deck: short bright flick
  deal: (ctx) => {
    const n = filteredNoise(0.9, true);
    return synth(ctx, 0.07, (t) => n() * Math.exp(-t * 70));
  },
  // Card landing on the felt: soft thud + papery slap
  play: (ctx) => {
    const n = filteredNoise(0.35);
    return synth(ctx, 0.14, (t) => n() * Math.exp(-t * 38) + 0.6 * Math.sin(2 * Math.PI * 150 * t) * Math.exp(-t * 45));
  },
  // Trump card turning over: quick swoosh
  flip: (ctx) => {
    const n = filteredNoise(0.5);
    return synth(ctx, 0.12, (t) => n() * Math.sin((Math.PI * t) / 0.12) ** 2);
  },
  // Trick swept to the winner
  sweep: (ctx) => {
    const n = filteredNoise(0.25);
    return synth(ctx, 0.3, (t) => n() * Math.sin((Math.PI * t) / 0.3) * 0.8);
  },
  // Riffle shuffle: a burst of tiny flicks
  shuffle: (ctx) => {
    const n = filteredNoise(0.8, true);
    return synth(ctx, 0.55, (t) => {
      const phase = (t * 38) % 1;
      return n() * Math.exp(-phase * 9) * Math.sin((Math.PI * t) / 0.55);
    });
  },
  // You won the trick: rising three-note chime
  win: (ctx) =>
    synth(ctx, 1.0, (t) => note(t, 0, 1047, 5) + note(t, 0.07, 1319, 5) + note(t, 0.14, 1568, 4)),
  // Someone else won: a single soft bell
  trick: (ctx) => synth(ctx, 0.6, (t) => note(t, 0, 660, 7, { harmonics: [1, 0.2, 0.1] })),
  // Your turn: gentle two-note ping
  turn: (ctx) => synth(ctx, 0.5, (t) => note(t, 0, 587, 8) + note(t, 0.09, 880, 7)),
  // A Wizard hits the table: sparkles
  wizard: (ctx) => {
    const sparkles = Array.from({ length: 9 }, (_, i) => ({ start: i * 0.05 + Math.random() * 0.03, freq: 1800 + Math.random() * 2200 }));
    return synth(ctx, 0.9, (t) => sparkles.reduce((s, sp) => s + note(t, sp.start, sp.freq, 12, { harmonics: [1] }), 0));
  },
  // A Jester: comic falling "boing"
  jester: (ctx) => {
    let phase = 0;
    return synth(ctx, 0.35, (t) => {
      const f = 520 * Math.exp(-t * 3) * (1 + 0.06 * Math.sin(2 * Math.PI * 22 * t));
      phase += (2 * Math.PI * f) / ctx.sampleRate;
      return Math.sin(phase) * Math.exp(-t * 7);
    });
  },
  // UI button
  click: (ctx) => synth(ctx, 0.04, (t) => Math.sin(2 * Math.PI * 1300 * t) * Math.exp(-t * 140)),
  // Round results
  good: (ctx) =>
    synth(ctx, 1.1, (t) => [523, 659, 784, 1047].reduce((s, f, i) => s + note(t, i * 0.09, f, 4), 0)),
  bad: (ctx) =>
    synth(ctx, 1.0, (t) => [392, 311, 262].reduce((s, f, i) => s + note(t, i * 0.14, f, 4, { harmonics: [1, 0.5, 0.25] }), 0)),
  // You won the game
  fanfare: (ctx) =>
    synth(ctx, 1.8, (t) =>
      [523, 659, 784, 1047, 784, 1047].reduce((s, f, i) => s + note(t, i * (i < 4 ? 0.1 : 0.18), f, 3), 0),
    ),
};

export class Sound {
  constructor(world) {
    this.world = world;
    this.enabled = true;
    this.sfxVolume = 0.8;
    this.musicVolume = 0.5;
    this.ctx = null;
    this.music = null;
    this.buffers = {};
    this.matrix = new THREE.Matrix4();
    this.pos = new THREE.Vector3();
    this.fwd = new THREE.Vector3();
    this.up = new THREE.Vector3();
    // Browsers only allow audio after a user gesture.
    const unlock = () => this.#ensure();
    window.addEventListener('pointerdown', unlock);
    window.addEventListener('keydown', unlock);
    world.renderer.xr.addEventListener('sessionstart', unlock);
    world.onUpdate(() => this.#updateListener());
  }

  #ensure() {
    if (!this.ctx) {
      const Ctx = window.AudioContext || window.webkitAudioContext;
      if (!Ctx) return;
      this.ctx = new Ctx();
      this.master = this.ctx.createGain();
      this.master.connect(this.ctx.destination);
      this.sfxBus = this.ctx.createGain();
      this.sfxBus.connect(this.master);
      this.musicBus = this.ctx.createGain();
      this.musicBus.connect(this.master);
      this.#applyLevels();
      for (const [name, recipe] of Object.entries(RECIPES)) this.buffers[name] = recipe(this.ctx);
      this.music = new Music(this.ctx, this.musicBus);
      this.music.start();
    }
    if (this.ctx.state === 'suspended') this.ctx.resume();
  }

  /** Apply the player's preferences: master on/off plus separate music and effects volume (0–1). */
  configure({ sound, sfxVolume, musicVolume }) {
    this.enabled = sound;
    this.sfxVolume = sfxVolume;
    this.musicVolume = musicVolume;
    this.#applyLevels();
  }

  #applyLevels() {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    // Short ramps so dragging a slider doesn't crackle.
    this.master.gain.setTargetAtTime(this.enabled ? 1 : 0, t, 0.03);
    this.sfxBus.gain.setTargetAtTime(SFX_LEVEL * this.sfxVolume ** 2, t, 0.03); // squared ≈ perceptual loudness
    this.musicBus.gain.setTargetAtTime(MUSIC_LEVEL * this.musicVolume ** 2, t, 0.03);
  }

  /** Play a named sound, optionally from a world position. */
  play(name, position = null, { volume = 1, rate = 1 } = {}) {
    const ctx = this.ctx;
    if (!this.enabled || !ctx || ctx.state !== 'running' || !this.buffers[name]) return;
    const src = ctx.createBufferSource();
    src.buffer = this.buffers[name];
    src.playbackRate.value = rate;
    const gain = ctx.createGain();
    gain.gain.value = volume;
    src.connect(gain);
    if (position) {
      const panner = ctx.createPanner();
      panner.panningModel = 'HRTF';
      panner.distanceModel = 'inverse';
      panner.refDistance = 1;
      panner.rolloffFactor = 0.6;
      setParam(panner, 'position', position.x, position.y, position.z);
      gain.connect(panner).connect(this.sfxBus);
    } else {
      gain.connect(this.sfxBus);
    }
    src.start();
  }

  /** Keep the Web Audio listener on your head (the desktop camera, or the headset in VR). */
  #updateListener() {
    if (!this.ctx) return;
    const cam = this.world.camera;
    this.matrix.copy(cam.matrixWorld);
    this.pos.setFromMatrixPosition(this.matrix);
    this.fwd.set(0, 0, -1).transformDirection(this.matrix);
    this.up.set(0, 1, 0).transformDirection(this.matrix);
    const l = this.ctx.listener;
    if (l.positionX) {
      setParam(l, 'position', this.pos.x, this.pos.y, this.pos.z);
      setParam(l, 'forward', this.fwd.x, this.fwd.y, this.fwd.z);
      setParam(l, 'up', this.up.x, this.up.y, this.up.z);
    } else {
      l.setPosition(this.pos.x, this.pos.y, this.pos.z);
      l.setOrientation(this.fwd.x, this.fwd.y, this.fwd.z, this.up.x, this.up.y, this.up.z);
    }
  }
}

function setParam(node, name, x, y, z) {
  if (node[`${name}X`]) {
    node[`${name}X`].value = x;
    node[`${name}Y`].value = y;
    node[`${name}Z`].value = z;
  } else if (name === 'position') {
    node.setPosition(x, y, z);
  }
}
