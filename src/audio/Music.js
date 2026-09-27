// Generative background music, synthesized live with Web Audio: a slow modal chord pad,
// a wandering harp arpeggio, soft bass, the odd chime, and candle crackle underneath.
// It never repeats exactly, costs no downloads, and needs no licensing.

const BPM = 72;
const EIGHTH = 60 / BPM / 2;
const STEPS_PER_CHORD = 16; // two bars of eighths

const midiToHz = (n) => 440 * 2 ** ((n - 69) / 12);

// [root MIDI note, chord intervals]
const Dm7 = [50, [0, 3, 7, 10]];
const Bbmaj7 = [46, [0, 4, 7, 11]];
const Fmaj7 = [53, [0, 4, 7, 11]];
const C = [48, [0, 4, 7, 14]];
const Gm7 = [55, [0, 3, 7, 10]];
const A = [45, [0, 4, 7, 12]];
const SECTION_A = [Dm7, Bbmaj7, Fmaj7, C];
const SECTION_B = [Dm7, Gm7, Bbmaj7, A];
const SONG = [SECTION_A, SECTION_A, SECTION_B, SECTION_A];
const HARP_PATTERN = [0, 1, 2, 3, 4, 3, 2, 1];

export class Music {
  constructor(ctx, output) {
    this.ctx = ctx;
    this.step = 0;
    this.nextTime = 0;
    this.timer = null;

    // dry + reverb send
    this.dry = ctx.createGain();
    this.dry.gain.value = 0.75;
    this.dry.connect(output);
    this.reverb = ctx.createConvolver();
    this.reverb.buffer = this.#impulse(3.2);
    const wet = ctx.createGain();
    wet.gain.value = 0.55;
    this.reverb.connect(wet).connect(output);
    this.crackleBuffer = this.#crackle();
  }

  start() {
    if (this.timer) return;
    this.nextTime = this.ctx.currentTime + 0.3;
    this.timer = setInterval(() => this.#schedule(), 50);
  }

  stop() {
    clearInterval(this.timer);
    this.timer = null;
  }

  /** Look-ahead scheduler: queue notes slightly in advance on the audio clock. */
  #schedule() {
    const now = this.ctx.currentTime;
    if (this.nextTime < now - 0.2) this.nextTime = now + 0.05; // timers were throttled (background tab)
    while (this.nextTime < now + 0.25) {
      this.#playStep(this.step, this.nextTime);
      this.step += 1;
      this.nextTime += EIGHTH;
    }
  }

  #playStep(step, t) {
    const chordNumber = Math.floor(step / STEPS_PER_CHORD);
    const inChord = step % STEPS_PER_CHORD;
    const section = SONG[Math.floor(chordNumber / 4) % SONG.length];
    const [root, tones] = section[chordNumber % 4];

    if (inChord === 0) {
      this.#pad(root, tones, t, STEPS_PER_CHORD * EIGHTH);
      this.#bass(root - 12, t, 0.5);
    }
    if (inChord === 8) this.#bass(root - 12 + 7, t, 0.3);

    // Harp: follows a rise-and-fall pattern, skipping notes now and then so it breathes.
    if (inChord >= 2 && Math.random() < 0.62) {
      const notes = [...tones.map((i) => root + 12 + i), ...tones.map((i) => root + 24 + i)];
      const shift = chordNumber % 2 ? 2 : 0;
      const n = notes[(HARP_PATTERN[inChord % 8] + shift) % notes.length];
      this.#harp(n, t + Math.random() * 0.02, 0.55 + Math.random() * 0.45);
    }
    if (inChord === 12 && Math.random() < 0.3) {
      this.#chime(root + 36 + tones[Math.floor(Math.random() * tones.length)], t);
    }
    if (Math.random() < 0.35) this.#pop(t + Math.random() * EIGHTH);
  }

  #voice(type, freq, t, { attack, hold, release, level, detune = 0, cutoff = null, reverb = 0.5 }) {
    const { ctx } = this;
    const osc = ctx.createOscillator();
    osc.type = type;
    osc.frequency.value = freq;
    osc.detune.value = detune;
    const env = ctx.createGain();
    env.gain.setValueAtTime(0, t);
    env.gain.linearRampToValueAtTime(level, t + attack);
    env.gain.setValueAtTime(level, t + attack + hold);
    env.gain.exponentialRampToValueAtTime(0.0001, t + attack + hold + release);
    let node = osc;
    if (cutoff) {
      const filter = ctx.createBiquadFilter();
      filter.type = 'lowpass';
      filter.frequency.value = cutoff;
      filter.Q.value = 0.5;
      osc.connect(filter);
      node = filter;
    }
    node.connect(env);
    env.connect(this.dry);
    if (reverb) {
      const send = ctx.createGain();
      send.gain.value = reverb;
      env.connect(send).connect(this.reverb);
    }
    osc.start(t);
    osc.stop(t + attack + hold + release + 0.05);
  }

  #pad(root, tones, t, duration) {
    for (const interval of tones.slice(0, 4)) {
      const f = midiToHz(root + interval);
      const opts = { attack: 1.8, hold: duration - 1.2, release: 2.6, level: 0.035, cutoff: 900, reverb: 0.6 };
      this.#voice('sawtooth', f, t, { ...opts, detune: -7 });
      this.#voice('triangle', f, t, { ...opts, detune: 6, level: 0.05 });
    }
  }

  #bass(note, t, level) {
    this.#voice('sine', midiToHz(note), t, { attack: 0.03, hold: 0.2, release: 2.8, level: 0.22 * level * 2, reverb: 0.15 });
  }

  #harp(note, t, velocity) {
    const f = midiToHz(note);
    this.#voice('triangle', f, t, { attack: 0.005, hold: 0, release: 1.6, level: 0.09 * velocity, reverb: 0.7 });
    this.#voice('sine', f * 2, t, { attack: 0.005, hold: 0, release: 0.8, level: 0.03 * velocity, reverb: 0.7 });
  }

  #chime(note, t) {
    const f = midiToHz(note);
    this.#voice('sine', f, t, { attack: 0.01, hold: 0, release: 3.5, level: 0.035, reverb: 1 });
    this.#voice('sine', f * 2.76, t, { attack: 0.01, hold: 0, release: 1.5, level: 0.012, reverb: 1 });
  }

  /** A tiny wood/candle crackle. */
  #pop(t) {
    const src = this.ctx.createBufferSource();
    src.buffer = this.crackleBuffer;
    src.playbackRate.value = 0.6 + Math.random() * 1.2;
    const g = this.ctx.createGain();
    g.gain.value = 0.02 + Math.random() * 0.05;
    src.connect(g).connect(this.dry);
    src.start(t);
  }

  #impulse(seconds) {
    const { ctx } = this;
    const n = Math.floor(seconds * ctx.sampleRate);
    const ir = ctx.createBuffer(2, n, ctx.sampleRate);
    for (let c = 0; c < 2; c++) {
      const d = ir.getChannelData(c);
      for (let i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / n) ** 3;
    }
    return ir;
  }

  #crackle() {
    const { ctx } = this;
    const n = Math.floor(0.02 * ctx.sampleRate);
    const b = ctx.createBuffer(1, n, ctx.sampleRate);
    const d = b.getChannelData(0);
    let prev = 0;
    for (let i = 0; i < n; i++) {
      const x = (Math.random() * 2 - 1) * Math.exp((-i / n) * 6);
      d[i] = x - prev; // high-passed so it clicks rather than thuds
      prev = x;
    }
    return b;
  }
}
