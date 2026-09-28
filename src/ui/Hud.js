import * as THREE from 'three';
import { Panel } from './Panel.js';
import { FONTS, THEME, drawPanelBackground, text, wrappedText } from './draw.js';
import { drawSuitGlyph } from '../scene/cardTextures.js';
import { SUITS, SUIT_INFO } from '../game/cards.js';
import { DESKTOP_EYE, EYE } from '../scene/layout.js';
import { DEFAULT_PREFS, GAME_TAGLINE } from '../config.js';
import { CODE_LENGTH, EMOTES, NAME_CHAR, NAME_MAX, normalizeCode, sanitizeName } from '../net/protocol.js';
import { drawGuestLobby, drawHome, drawHostLobby, drawKeypad, drawMessage, drawNameEditor, drawRules, messageHeightPx } from './lobbyScreens.js';

// Modal prompts float in front of you; the status board sits low-left of your hand
// (a glance down in VR) and the score pad to the right when opened.
const MODAL_POS = new THREE.Vector3(0, 1.12, -0.48);
const STATUS_POS = new THREE.Vector3(-0.5, 1.02, -0.25);
const SCOREPAD_POS = new THREE.Vector3(0.52, 1.2, -0.4);
const EMOTES_POS = new THREE.Vector3(-0.5, 1.24, -0.3);
const SCOREPAD_ROUNDS = 6;

function suitBadge(ctx, suit, cx, cy, r) {
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.fillStyle = SUIT_INFO[suit].color;
  ctx.fill();
  ctx.lineWidth = 3;
  ctx.strokeStyle = 'rgba(255,255,255,0.5)';
  ctx.stroke();
  drawSuitGlyph(ctx, suit, cx, cy, r * 1.25, '#ffffff', SUIT_INFO[suit].color);
}

/**
 * All in-world UI: modal prompts in front of the player, the status board and the score pad.
 * Prompts return promises the controller awaits.
 */
export class Hud {
  constructor(world, pointer) {
    this.world = world;
    this.pointer = pointer;
    this.game = null;
    this.message = '';
    this.pending = null;
    this.keyHandler = null;
    this.onQuit = null;
    this.quitArmedUntil = 0;
    // Preferences shown in the Options panel; main.js supplies them and reacts to changes.
    this.prefs = { ...DEFAULT_PREFS };
    this.onPrefsChange = null;
    this.onFitHeight = null;
    this.heightNote = '';

    this.status = this.#makePanel(0.44, 0.3, STATUS_POS, (ctx, p) => this.#drawStatus(ctx, p));
    this.modal = this.#makePanel(0.7, 0.6, MODAL_POS, (ctx, p) => this.modalDraw?.(ctx, p));
    this.scorepad = this.#makePanel(0.62, 0.3, SCOREPAD_POS, (ctx, p) => this.#drawScorepad(ctx, p));
    this.options = this.#makePanel(0.5, 0.52, SCOREPAD_POS, (ctx, p) => this.#drawOptions(ctx, p));
    this.emotes = this.#makePanel(0.44, 0.1, EMOTES_POS, (ctx, p) => this.#drawEmotes(ctx, p));
    this.onEmote = null;
    this.flash = null;
    this.roomCode = null;
    window.addEventListener('keydown', (e) => {
      // While typing a name or room code, every key is text — M must not toggle sound.
      if (!this.textInput && (e.key === 'm' || e.key === 'M')) this.#setPref('sound', !this.prefs.sound);
      else this.keyHandler?.(e);
    });
    world.onUpdate(() => this.#layoutHud());
    // The "fit height" button is only live in VR, so repaint when that changes.
    world.renderer.xr.addEventListener('sessionstart', () => this.options.render());
    world.renderer.xr.addEventListener('sessionend', () => this.options.render());
  }

  #makePanel(width, height, position, draw) {
    const panel = new Panel({ width, height, draw });
    panel.holder = new THREE.Group();
    panel.holder.add(panel.mesh);
    panel.holder.position.copy(position);
    panel.holder.lookAt(EYE);
    panel.mesh.visible = false;
    this.world.scene.add(panel.holder);
    this.pointer.add(panel.mesh);
    return panel;
  }

  /**
   * In VR the status board and score pad live in the world beside your hand. On desktop
   * they're pinned to the screen corners like a regular HUD.
   */
  #layoutHud() {
    const cam = this.world.camera;
    const xr = this.world.isXR;
    const key = `${xr}|${cam.aspect.toFixed(3)}|${cam.fov.toFixed(2)}|${this.scorepad.height}|${this.modal.width}x${this.modal.height}`;
    if (key === this.layoutKey) return;
    this.layoutKey = key;

    const pinned = [
      [this.status, STATUS_POS, -1, -1],
      [this.scorepad, SCOREPAD_POS, 1, 1],
      [this.options, SCOREPAD_POS, 1, 1],
      [this.emotes, EMOTES_POS, -1, -1],
    ];
    if (xr) {
      for (const [panel, pos] of [...pinned, [this.modal, MODAL_POS]]) {
        this.world.scene.add(panel.holder);
        panel.holder.position.copy(pos);
        panel.holder.scale.setScalar(1);
        panel.holder.lookAt(EYE);
        panel.material.depthTest = true;
        panel.mesh.renderOrder = 0;
      }
      return;
    }
    const dist = 0.5;
    const hh = dist * Math.tan(THREE.MathUtils.degToRad(cam.fov / 2));
    const hw = hh * cam.aspect;
    // Status board: ~26% of screen height, but never wider than 28% of the screen (keeps the hand clear).
    const scale = Math.min((0.26 * 2 * hh) / this.status.height, (0.28 * 2 * hw) / this.status.width);
    const margin = 0.03 * hh;
    for (const [panel, , sx, sy] of pinned) {
      cam.add(panel.holder);
      panel.holder.quaternion.identity();
      panel.holder.scale.setScalar(scale);
      panel.holder.position.set(
        sx * (hw - margin - (panel.width * scale) / 2),
        sy * (hh - margin - (panel.height * scale) / 2),
        -dist,
      );
      panel.material.depthTest = false;
      panel.mesh.renderOrder = 10;
    }
    // The emote bar sits just above the status board.
    this.emotes.holder.position.y += (this.status.height + 0.012) * scale;

    // Dialogs: centred on screen at the size they'd appear in the room, shrunk to fit narrow
    // windows (phones held upright), and drawn over everything else.
    const modal = this.modal;
    const natural = dist / MODAL_POS.distanceTo(DESKTOP_EYE);
    const fit = Math.min(natural, (0.94 * 2 * hw) / modal.width, (0.9 * 2 * hh) / modal.height);
    cam.add(modal.holder);
    modal.holder.quaternion.identity();
    modal.holder.scale.setScalar(fit);
    modal.holder.position.set(0, Math.min(0.08 * hh, hh - (modal.height * fit) / 2), -dist);
    modal.material.depthTest = false;
    modal.mesh.renderOrder = 11;
  }

  // ---------- modal plumbing ----------

  #openModal({ width, height, draw, keys, ppm = 1000, textInput = false }) {
    this.textInput = textInput;
    this.modalDraw = draw;
    this.modal.setSize(width, height, ppm);
    this.modal.hoverId = null;
    this.modal.mesh.visible = true;
    this.modal.render();
    this.keyHandler = keys ?? null;
  }

  #closeModal() {
    this.textInput = false;
    this.modal.mesh.visible = false;
    this.modalDraw = null;
    this.keyHandler = null;
  }

  #prompt(setup) {
    this.cancelPrompts(new Error('replaced')); // only one modal prompt at a time
    return new Promise((resolve, reject) => {
      const done = (value) => {
        if (this.pending?.done !== done) return;
        this.pending = null;
        this.#closeModal();
        resolve(value);
      };
      this.pending = { reject, done };
      setup(done);
    });
  }

  /** Resolve whatever prompt is open (e.g. the guest lobby closes itself when the game starts). */
  finishPrompt(value) {
    this.pending?.done(value);
  }

  /** Close an informational modal (one nobody is waiting on). */
  closeInfo() {
    if (!this.pending) this.#closeModal();
  }

  cancelPrompts(error) {
    if (!this.pending) return;
    const { reject } = this.pending;
    this.pending = null;
    this.#closeModal();
    reject(error);
  }

  // ---------- game UI ----------

  showGameUi(game, { multiplayer = false, code = null } = {}) {
    this.game = game;
    this.roomCode = multiplayer ? code : null;
    this.statusOpts = {};
    this.status.mesh.visible = true;
    this.status.render();
    this.emotes.mesh.visible = multiplayer;
    if (multiplayer) this.emotes.render();
  }

  hideGameUi() {
    this.status.mesh.visible = false;
    this.scorepad.mesh.visible = false;
    this.options.mesh.visible = false;
    this.emotes.mesh.visible = false;
    this.#closeModal();
    this.game = null;
  }

  /** Show a message on the status board for a moment, then go back to the current one. */
  flashMessage(message, seconds = 2.5) {
    this.flash = { message, until: performance.now() + seconds * 1000 };
    this.status.render();
    setTimeout(() => this.status.mesh.visible && this.status.render(), seconds * 1000 + 50);
  }

  #drawEmotes(ctx, p) {
    const W = p.pxWidth;
    drawPanelBackground(ctx, W, p.pxHeight, { radius: 18 });
    EMOTES.forEach((emote, i) => {
      const col = i % 3;
      const row = Math.floor(i / 3);
      p.button(`emote-${i}`, { x: 14 + col * 140, y: 12 + row * 46, w: 132, h: 38 }, emote, {
        size: 19,
        onClick: () => this.onEmote?.(emote),
      });
    });
  }

  setStatus(game, opts = {}) {
    this.game = game;
    this.statusOpts = opts;
    this.status.render();
    if (this.scorepad.mesh.visible) this.#renderScorepad();
  }

  setMessage(message) {
    this.message = message;
    this.status.render();
  }

  #drawStatus(ctx, p) {
    const game = this.game;
    if (!game) return;
    const W = p.pxWidth;
    const H = p.pxHeight;
    drawPanelBackground(ctx, W, H);
    text(ctx, `Round ${game.round} of ${game.totalRounds}`, 24, 38, { font: `bold 32px ${FONTS.serif}`, align: 'left', fill: THEME.gold });
    const dealer = game.players[game.dealer];
    const dealerText = dealer ? `Dealer: ${dealer.isHuman ? 'You' : dealer.name}` : '';
    const line = this.roomCode ? `${dealerText} · Room ${this.roomCode}` : dealerText;
    text(ctx, line, 24, 74, { font: `21px ${FONTS.sans}`, align: 'left', fill: THEME.muted, maxWidth: W - 150 });

    // Trump
    if (game.trumpSuit) {
      suitBadge(ctx, game.trumpSuit, 50, 136, 26);
      text(ctx, 'Trump', 88, 120, { font: `19px ${FONTS.sans}`, align: 'left', fill: THEME.muted });
      text(ctx, SUIT_INFO[game.trumpSuit].name, 88, 150, { font: `bold 27px ${FONTS.sans}`, align: 'left' });
    } else {
      text(ctx, 'Trump', 24, 120, { font: `19px ${FONTS.sans}`, align: 'left', fill: THEME.muted });
      const label = game.phase === 'chooseTrump' ? 'Choosing…' : 'None';
      text(ctx, label, 24, 150, { font: `bold 27px ${FONTS.sans}`, align: 'left' });
    }

    // You
    const me = game.players[0];
    const hidden = this.statusOpts?.hideBids && me.bid !== null;
    const bidLine = me.bid === null ? 'Bid —' : `Bid ${me.bid} · Won ${me.tricks}`;
    text(ctx, `You · Score ${me.score}`, 236, 120, { font: `19px ${FONTS.sans}`, align: 'left', fill: THEME.muted, maxWidth: W - 260 });
    text(ctx, bidLine, 236, 150, { font: `bold 25px ${FONTS.sans}`, align: 'left', maxWidth: W - 260 });
    if (hidden) text(ctx, '(hidden from others)', 236, 172, { font: `16px ${FONTS.sans}`, align: 'left', fill: THEME.muted });

    const buttonStyle = { size: 18 };
    p.button('scores', { x: W - 120, y: 10, w: 100, h: 28 }, 'Scores', {
      ...buttonStyle,
      selected: this.scorepad.mesh.visible,
      onClick: () => this.toggleScorepad(),
    });
    p.button('options', { x: W - 120, y: 42, w: 100, h: 28 }, 'Options', {
      ...buttonStyle,
      selected: this.options.mesh.visible,
      onClick: () => this.toggleOptions(),
    });
    const armed = performance.now() < this.quitArmedUntil;
    p.button('quit', { x: W - 120, y: 74, w: 100, h: 28 }, armed ? 'Sure?' : 'Quit', {
      ...buttonStyle,
      onClick: () => {
        if (performance.now() < this.quitArmedUntil) {
          this.quitArmedUntil = 0;
          this.onQuit?.();
        } else {
          this.quitArmedUntil = performance.now() + 3000;
          this.status.render();
          setTimeout(() => this.status.mesh.visible && this.status.render(), 3100);
        }
      },
    });

    ctx.strokeStyle = 'rgba(201,165,76,0.35)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(20, 190);
    ctx.lineTo(W - 20, 190);
    ctx.stroke();
    const flashing = this.flash && performance.now() < this.flash.until;
    wrappedText(ctx, flashing ? this.flash.message : this.message, W / 2, 245, W - 44, 32, {
      font: `bold 25px ${FONTS.sans}`,
      fill: flashing ? THEME.good : THEME.gold,
    });
  }

  // ---------- score pad ----------

  toggleScorepad() {
    this.scorepad.mesh.visible = !this.scorepad.mesh.visible;
    if (this.scorepad.mesh.visible) {
      this.options.mesh.visible = false; // they share a spot
      this.#renderScorepad();
    }
    this.status.render();
  }

  // ---------- options ----------

  toggleOptions() {
    this.options.mesh.visible = !this.options.mesh.visible;
    if (this.options.mesh.visible) {
      this.scorepad.mesh.visible = false;
      this.options.render();
    }
    if (this.status.mesh.visible) this.status.render();
    if (this.modal.mesh.visible) this.modal.render();
  }

  #setPref(key, value) {
    this.prefs = { ...this.prefs, [key]: value };
    this.onPrefsChange?.({ [key]: value }); // just the change — see updatePrefs()
    this.refreshPrefs();
  }

  /** Redraw anything showing preferences (e.g. after another tab changed them). */
  refreshPrefs() {
    if (this.options.mesh.visible) this.options.render();
  }

  /** Called by main.js once the headset has been measured. */
  showHeightFitted(offset) {
    const cm = Math.round(-offset * 100);
    this.heightNote = cm > 0 ? `Table raised ${cm} cm to meet you` : cm < 0 ? `Table lowered ${-cm} cm` : 'Table is at real height';
    if (this.options.mesh.visible) this.options.render();
  }

  #drawOptions(ctx, p) {
    const W = p.pxWidth;
    const H = p.pxHeight;
    drawPanelBackground(ctx, W, H);
    text(ctx, 'Options', 26, 44, { font: `bold 34px ${FONTS.serif}`, align: 'left', fill: THEME.gold });
    p.button('close', { x: W - 120, y: 20, w: 100, h: 44 }, 'Close', { size: 22, onClick: () => this.toggleOptions() });

    const segmented = (y, label, key, choices) => {
      text(ctx, label, 26, y + 24, { font: `bold 24px ${FONTS.sans}`, align: 'left' });
      choices.forEach(([value, name], i) => {
        const selected = this.prefs[key] === value;
        p.button(`${key}-${value}`, { x: W - 26 - (choices.length - i) * 128, y, w: 120, h: 48 }, name, {
          size: 22,
          primary: selected,
          onClick: () => this.#setPref(key, value),
        });
      });
    };
    segmented(88, 'Sound  (M)', 'sound', [
      [true, 'On'],
      [false, 'Off'],
    ]);

    const volume = (y, label, key) => {
      const on = this.prefs.sound;
      text(ctx, label, 26, y, { font: `bold 24px ${FONTS.sans}`, align: 'left', fill: on ? THEME.text : THEME.muted });
      p.slider(key, { x: 150, y: y - 16, w: W - 250, h: 32 }, this.prefs[key], (v) => this.#setPref(key, v));
      text(ctx, `${Math.round(this.prefs[key] * 100)}%`, W - 26, y, { font: `22px ${FONTS.sans}`, align: 'right', fill: THEME.muted });
    };
    volume(172, 'Music', 'musicVolume');
    volume(228, 'Effects', 'sfxVolume');

    segmented(270, 'In VR I’m…', 'vrPosture', [
      ['seated', 'Seated'],
      ['standing', 'Standing'],
    ]);
    const explain =
      this.prefs.vrPosture === 'standing'
        ? 'The table rises to meet you — your height is measured when you enter VR.'
        : 'Sit in a chair: the table is at real table height.';
    wrappedText(ctx, explain, W / 2, 356, W - 52, 26, { font: `20px ${FONTS.sans}`, fill: THEME.muted });

    const xr = this.world.isXR;
    p.button('fit', { x: 26, y: 398, w: W - 52, h: 54 }, xr ? 'Fit table to my height' : 'Fit table to my height (in VR)', {
      size: 22,
      disabled: !xr,
      onClick: () => this.onFitHeight?.(),
    });
    const note = xr ? this.heightNote || 'Sit or stand naturally, look ahead, then press.' : 'Available once you enter VR.';
    text(ctx, note, W / 2, 482, { font: `19px ${FONTS.sans}`, fill: THEME.muted, maxWidth: W - 52 });
  }

  #renderScorepad() {
    const n = this.game?.numPlayers ?? 3;
    this.scorepad.setSize(0.62, (120 + n * 46 + 20) / 1000);
    this.scorepad.render();
  }

  #drawScorepad(ctx, p) {
    const game = this.game;
    if (!game) return;
    const W = p.pxWidth;
    drawPanelBackground(ctx, W, p.pxHeight);
    const rounds = game.history.slice(-SCOREPAD_ROUNDS);
    text(ctx, 'Score pad', 26, 40, { font: `bold 30px ${FONTS.serif}`, align: 'left', fill: THEME.gold });
    text(ctx, rounds.length ? 'recent rounds' : 'no rounds finished yet', W - 26, 40, {
      font: `20px ${FONTS.sans}`,
      align: 'right',
      fill: THEME.muted,
    });
    const colX = (i) => 178 + i * 58;
    rounds.forEach((h, i) => text(ctx, `R${h.round}`, colX(i), 92, { font: `bold 20px ${FONTS.sans}`, fill: THEME.muted }));
    text(ctx, 'Total', W - 30, 92, { font: `bold 20px ${FONTS.sans}`, align: 'right', fill: THEME.muted });
    game.players.forEach((pl, row) => {
      const y = 140 + row * 46;
      text(ctx, pl.isHuman ? 'You' : pl.name, 26, y, { font: `bold 24px ${FONTS.sans}`, align: 'left', fill: pl.isHuman ? THEME.gold : THEME.text, maxWidth: 124 });
      rounds.forEach((h, i) => {
        const d = h.results[row].delta;
        text(ctx, d > 0 ? `+${d}` : String(d), colX(i), y, { font: `22px ${FONTS.sans}`, fill: d > 0 ? THEME.good : THEME.bad });
      });
      text(ctx, String(pl.score), W - 30, y, { font: `bold 26px ${FONTS.sans}`, align: 'right' });
    });
  }

  // ---------- prompts ----------

  // ---------- menus & lobby ----------

  /** Home screen. Resolves 'solo' | 'host' | 'join' | 'name'. */
  showHome({ getName }) {
    return this.#prompt((done) => {
      this.#openModal({
        width: 0.72,
        height: 0.6,
        draw: (ctx, p) =>
          drawHome(ctx, p, {
            name: getName(),
            onPick: done,
            onRename: () => done('name'),
            onOptions: () => this.toggleOptions(),
            optionsOpen: this.options.mesh.visible,
          }),
        keys: (e) => {
          if (e.key === 'Enter') done('solo');
        },
      });
    });
  }

  /** Solo game setup. Resolves the settings, or null for Back. */
  showSoloSetup(initial) {
    const s = { ...initial };
    return this.#prompt((done) => {
      const start = () => done({ ...s });
      this.#openModal({
        width: 0.72,
        height: 0.64,
        draw: (ctx, p) => {
          const W = p.pxWidth;
          const H = p.pxHeight;
          drawPanelBackground(ctx, W, H);
          text(ctx, 'Play vs bots', W / 2, 64, { font: `bold 48px ${FONTS.serif}`, fill: THEME.gold });
          text(ctx, GAME_TAGLINE, W / 2, 110, { font: `22px ${FONTS.sans}`, fill: THEME.muted });
          drawRules(ctx, p, s, { x: 48, y: 170, w: W - 96, onChange: () => p.render() });
          p.button('start', { x: W / 2 - 150, y: H - 80, w: 300, h: 60 }, 'Deal me in', { primary: true, size: 30, onClick: start });
          p.button('back', { x: 40, y: H - 76, w: 140, h: 52 }, 'Back', { size: 22, onClick: () => done(null) });
        },
        keys: (e) => {
          if (e.key === 'Enter') start();
          if (e.key === 'Escape') done(null);
        },
      });
    });
  }

  /**
   * The host's lobby. `lobby` is live: call updateLobby() when players come and go.
   * Settings changes are reported through onChange. Resolves 'start' | 'cancel'.
   */
  openHostLobby(lobby, { link, onChange, copyText }) {
    this.lobby = lobby;
    const s = { ...lobby.settings };
    let copied = null; // { what: 'code' | 'link', ok, until }
    return this.#prompt((done) => {
      const copy = async (what) => {
        const ok = await copyText(what === 'code' ? this.lobby.code : link);
        copied = { what, ok, until: performance.now() + 2000 };
        this.modal.render();
        setTimeout(() => this.modal.mesh.visible && this.modal.render(), 2100);
      };
      this.#openModal({
        width: 0.88,
        height: 0.6,
        ppm: 1200,
        draw: (ctx, p) =>
          drawHostLobby(ctx, p, {
            lobby: this.lobby,
            settings: s,
            link,
            copied: copied && performance.now() < copied.until ? copied : null,
            onCopy: copy,
            onChange: () => onChange({ ...s }),
            onStart: () => done('start'),
            onCancel: () => done('cancel'),
          }),
      });
      this.lobbySettings = s;
    });
  }

  updateLobby(lobby) {
    this.lobby = lobby;
    if (this.lobbySettings) Object.assign(this.lobbySettings, lobby.settings);
    if (this.modal.mesh.visible) this.modal.render();
  }

  /** In-world keypad for the room code (desktop can type too). Resolves the code or null. */
  askRoomCode({ initial = '', error = null } = {}) {
    let code = initial;
    return this.#prompt((done) => {
      const join = () => code.length === CODE_LENGTH && done(code);
      this.#openModal({
        width: 0.62,
        height: 0.56,
        textInput: true,
        draw: (ctx, p) =>
          drawKeypad(ctx, p, {
            code,
            error,
            onKey: (ch) => {
              code = normalizeCode(code + ch);
              error = null;
              p.render();
            },
            onBack: () => {
              code = code.slice(0, -1);
              p.render();
            },
            onJoin: join,
            onCancel: () => done(null),
          }),
        keys: (e) => {
          if (e.key === 'Enter') join();
          else if (e.key === 'Escape') done(null);
          else if (e.key === 'Backspace') code = code.slice(0, -1);
          else if (e.key.length === 1) code = normalizeCode(code + e.key);
          else return;
          error = null;
          this.modal.render();
        },
      });
    });
  }

  /**
   * Edit your display name with the on-screen keyboard (or a real one).
   * Resolves the cleaned-up name, or null if cancelled.
   */
  askName({ initial, randomName }) {
    let name = sanitizeName(initial);
    let shift = !name; // capitalise the first letter
    return this.#prompt((done) => {
      const add = (ch) => {
        if (name.length >= NAME_MAX || !NAME_CHAR.test(ch)) return;
        if (ch === ' ' && (!name || name.endsWith(' '))) return; // no leading or double spaces
        name += ch;
        shift = ch === ' '; // capitalise the start of each word
      };
      const save = () => {
        const clean = sanitizeName(name);
        if (clean) done(clean);
      };
      this.#openModal({
        width: 0.8,
        height: 0.55,
        ppm: 1200,
        textInput: true,
        draw: (ctx, p) =>
          drawNameEditor(ctx, p, {
            name,
            max: NAME_MAX,
            shift,
            onKey: (ch) => {
              add(ch);
              p.render();
            },
            onShift: () => {
              shift = !shift;
              p.render();
            },
            onSpace: () => {
              add(' ');
              p.render();
            },
            onBack: () => {
              name = name.slice(0, -1);
              shift = !name || name.endsWith(' ');
              p.render();
            },
            onRandom: () => {
              name = randomName();
              shift = false;
              p.render();
            },
            onCancel: () => done(null),
            onSave: save,
          }),
        keys: (e) => {
          if (e.key === 'Enter') save();
          else if (e.key === 'Escape') done(null);
          else if (e.key === 'Backspace') {
            name = name.slice(0, -1);
            shift = !name || name.endsWith(' ');
          } else if (e.key.length === 1 && !e.ctrlKey && !e.metaKey) {
            add(e.key); // a real keyboard already gives the right case
          } else return;
          e.preventDefault();
          this.modal.render();
        },
      });
    });
  }

  /** A guest waiting for the host. Resolves 'leave', or whatever finishPrompt() passes. */
  openGuestLobby(lobby) {
    this.lobby = lobby;
    this.lobbySettings = null;
    return this.#prompt((done) => {
      this.#openModal({ width: 0.66, height: 0.56, draw: (ctx, p) => drawGuestLobby(ctx, p, { lobby: this.lobby, onLeave: () => done('leave') }) });
    });
  }

  /** A message with an OK-style button. */
  showMessage({ title, body, button = 'OK' }) {
    return this.#prompt((done) => {
      this.#openModal({
        width: 0.6,
        height: messageHeightPx(this.modal.ctx, { body, button }) / 1000,
        draw: (ctx, p) => drawMessage(ctx, p, { title, body, button, onOk: () => done() }),
        keys: (e) => {
          if (e.key === 'Enter' || e.key === 'Escape') done();
        },
      });
    });
  }

  /**
   * A message nobody has to answer ("Connecting…"), optionally with one button (e.g. Cancel).
   * Closed by closeInfo() or the next prompt; calling it again just updates the text.
   */
  showBusy(title, body, { button = null, onButton = null } = {}) {
    this.cancelPrompts(new Error('replaced'));
    this.#openModal({
      width: 0.6,
      height: messageHeightPx(this.modal.ctx, { body, button }) / 1000,
      draw: (ctx, p) => drawMessage(ctx, p, { title, body, button, onOk: onButton }),
      keys: (e) => {
        if (button && e.key === 'Escape') onButton?.();
      },
    });
  }

  askBid(view, allowedBids) {
    const allowed = new Set(allowedBids);
    const max = view.round;
    const forbidden = [];
    for (let b = 0; b <= max; b++) if (!allowed.has(b)) forbidden.push(b);
    const cols = Math.min(max + 1, 7);
    const rows = Math.ceil((max + 1) / cols);
    const gridTop = forbidden.length ? 150 : 118;
    const heightPx = gridTop + rows * 70 + 18;

    return this.#prompt((done) => {
      this.#openModal({
        width: 0.56,
        height: heightPx / 1000,
        draw: (ctx, p) => {
          const W = p.pxWidth;
          drawPanelBackground(ctx, W, p.pxHeight);
          text(ctx, 'Your bid', W / 2, 44, { font: `bold 38px ${FONTS.serif}`, fill: THEME.gold });
          text(ctx, `How many of the ${max} trick${max === 1 ? '' : 's'} will you win?`, W / 2, 88, { font: `24px ${FONTS.sans}`, fill: THEME.muted });
          if (forbidden.length) {
            text(ctx, `Dealer rule: you can’t bid ${forbidden.join(', ')}`, W / 2, 122, { font: `bold 22px ${FONTS.sans}`, fill: THEME.bad });
          }
          const x0 = (W - (cols * 72 - 10)) / 2;
          for (let b = 0; b <= max; b++) {
            const c = b % cols;
            const r = Math.floor(b / cols);
            p.button(`bid-${b}`, { x: x0 + c * 72, y: gridTop + r * 70, w: 62, h: 60 }, String(b), {
              size: 30,
              disabled: !allowed.has(b),
              onClick: () => done(b),
            });
          }
        },
        keys: (e) => {
          if (max < 10 && /^[0-9]$/.test(e.key) && allowed.has(Number(e.key))) done(Number(e.key));
        },
      });
    });
  }

  chooseTrump() {
    return this.#prompt((done) => {
      this.#openModal({
        width: 0.6,
        height: 0.27,
        draw: (ctx, p) => {
          const W = p.pxWidth;
          drawPanelBackground(ctx, W, p.pxHeight);
          text(ctx, 'A Wizard was turned up!', W / 2, 42, { font: `bold 34px ${FONTS.serif}`, fill: THEME.gold });
          text(ctx, 'You’re the dealer — choose the trump suit', W / 2, 80, { font: `22px ${FONTS.sans}`, fill: THEME.muted });
          SUITS.forEach((suit, i) => {
            p.button(suit, { x: 30 + i * 138, y: 108, w: 124, h: 140 }, '', {
              onClick: () => done(suit),
              render: (c, rect) => {
                suitBadge(c, suit, rect.x + rect.w / 2, rect.y + 56, 36);
                text(c, SUIT_INFO[suit].name, rect.x + rect.w / 2, rect.y + 116, { font: `bold 24px ${FONTS.sans}` });
              },
            });
          });
        },
        keys: (e) => {
          const i = Number(e.key) - 1;
          if (i >= 0 && i < SUITS.length) done(SUITS[i]);
        },
      });
    });
  }

  /**
   * Round / game results. With `waiting` (online guests between rounds) there's no button: the
   * host advances the game and the next round closes it.
   */
  showSummary(game, { final, waiting = false }) {
    const n = game.numPlayers;
    const options = (done) => ({
      width: 0.72,
      height: (176 + n * 50 + 96) / 1000,
      draw: (ctx, p) => this.#drawSummary(ctx, p, game, final, done, waiting),
      keys: (e) => {
        if (done && (e.key === 'Enter' || e.key === ' ')) done();
      },
    });
    if (waiting) {
      this.cancelPrompts(new Error('replaced'));
      this.#openModal(options(null));
      return Promise.resolve();
    }
    return this.#prompt((done) => this.#openModal(options(() => done())));
  }

  #drawSummary(ctx, p, game, final, onDone, waiting) {
    const W = p.pxWidth;
    const H = p.pxHeight;
    drawPanelBackground(ctx, W, H);
    const last = game.history[game.history.length - 1];
    let title = `Round ${last.round} results`;
    let subtitle = `Next: round ${last.round + 1} of ${game.totalRounds}`;
    if (final) {
      const standings = game.standings();
      const top = standings[0].score;
      const winners = standings.filter((pl) => pl.score === top);
      title = winners.length > 1 ? 'It’s a tie!' : winners[0].isHuman ? 'You win!' : `${winners[0].name} wins!`;
      subtitle = 'Final standings';
    }
    text(ctx, title, W / 2, 50, { font: `bold 44px ${FONTS.serif}`, fill: THEME.gold });
    text(ctx, subtitle, W / 2, 96, { font: `24px ${FONTS.sans}`, fill: THEME.muted });

    const cols = [
      ['Player', 50, 'left'],
      ['Bid', 350, 'center'],
      ['Won', 440, 'center'],
      ['Points', 550, 'center'],
      ['Total', W - 50, 'right'],
    ];
    for (const [label, x, align] of cols) text(ctx, label, x, 150, { font: `bold 22px ${FONTS.sans}`, align, fill: THEME.muted });

    const order = final ? game.standings() : game.players;
    order.forEach((pl, row) => {
      const r = last.results[pl.index];
      const y = 196 + row * 50;
      if (pl.isHuman) {
        ctx.fillStyle = 'rgba(232,198,106,0.12)';
        ctx.fillRect(30, y - 22, W - 60, 44);
      }
      text(ctx, pl.isHuman ? 'You' : pl.name, 50, y, { font: `bold 26px ${FONTS.sans}`, align: 'left', fill: pl.isHuman ? THEME.gold : THEME.text });
      text(ctx, String(r.bid), 350, y, { font: `26px ${FONTS.sans}` });
      text(ctx, String(r.tricks), 440, y, { font: `26px ${FONTS.sans}` });
      text(ctx, r.delta > 0 ? `+${r.delta}` : String(r.delta), 550, y, { font: `bold 26px ${FONTS.sans}`, fill: r.delta > 0 ? THEME.good : THEME.bad });
      text(ctx, String(pl.score), W - 50, y, { font: `bold 28px ${FONTS.sans}`, align: 'right' });
    });

    if (waiting) {
      text(ctx, 'Waiting for the host to start the next round…', W / 2, H - 50, { font: `bold 22px ${FONTS.sans}`, fill: THEME.muted });
      return;
    }
    p.button('continue', { x: W / 2 - 140, y: H - 78, w: 280, h: 58 }, final ? 'Back to menu' : 'Next round', {
      primary: true,
      onClick: onDone,
    });
  }
}
