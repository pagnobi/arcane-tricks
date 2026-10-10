import * as THREE from 'three';
import { Panel } from './Panel.js';
import { FONTS, POP_SECONDS, THEME, drawBidWon, drawPanelBackground, text, wrappedText } from './draw.js';
import { drawSuitGlyph } from '../scene/cardTextures.js';
import { SUITS, SUIT_INFO } from '../game/cards.js';
import { DESKTOP_EYE, EYE } from '../scene/layout.js';
import { SCENES } from '../scene/scenery.js';
import { DEFAULT_PREFS, GAME_TAGLINE } from '../config.js';
import { CODE_LENGTH, EMOTES, NAME_CHAR, NAME_MAX, normalizeCode, sanitizeName } from '../net/protocol.js';
import {
  drawGuestLobby,
  drawHome,
  drawHostLobby,
  drawKeypad,
  drawLookEditor,
  drawMessage,
  drawNameEditor,
  drawRules,
  messageHeightPx,
} from './lobbyScreens.js';
import { randomLook, sanitizeLook } from '../game/looks.js';

// Modal prompts float in front of you; the status board sits low-left of your hand
// (a glance down in VR) and the score pad to the right when opened.
const MODAL_POS = new THREE.Vector3(0, 1.12, -0.48);
const STATUS_POS = new THREE.Vector3(-0.5, 1.02, -0.25);
const SCOREPAD_POS = new THREE.Vector3(0.52, 1.2, -0.4);
const EMOTES_POS = new THREE.Vector3(-0.5, 1.24, -0.3);
const CONTROLS_VR_POS = new THREE.Vector3(0.98, 1.2, -0.05);
const SCOREPAD_ROUNDS = 6;
const VR_BUTTON_PX = 64; // the page's Enter VR button, bottom-right, incl. its margin

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
 * All in-world UI: modal prompts in front of the player, the status board (with its Menu popout),
 * the score pad, Options and Controls, and the emote bar. Prompts return promises the controller
 * awaits. In VR the panels float in the room; on desktop they're pinned to the screen.
 */
export class Hud {
  constructor(world, pointer) {
    this.world = world;
    this.pointer = pointer;
    this.game = null;
    this.pending = null;
    this.keyHandler = null;
    this.onQuit = null;
    this.quitArmedUntil = 0;
    // Preferences shown in the Options panel; main.js supplies them and reacts to changes.
    this.prefs = { ...DEFAULT_PREFS };
    this.onPrefsChange = null;
    this.onFitHeight = null;
    this.heightNote = '';

    this.status = this.#makePanel(0.36, 0.176, STATUS_POS, (ctx, p) => this.#drawStatus(ctx, p));
    this.modal = this.#makePanel(0.7, 0.6, MODAL_POS, (ctx, p) => this.modalDraw?.(ctx, p));
    this.scorepad = this.#makePanel(0.62, 0.3, SCOREPAD_POS, (ctx, p) => this.#drawScorepad(ctx, p));
    this.options = this.#makePanel(0.54, 0.75, SCOREPAD_POS, (ctx, p) => this.#drawOptions(ctx, p));
    // How to look around and play; shown with the Options menu (below it on desktop, beside it in VR).
    this.controls = this.#makePanel(0.8, 0.3, CONTROLS_VR_POS, (ctx, p) => this.#drawControls(ctx, p));
    this.menuPop = this.#makePanel(0.17, 0.16, STATUS_POS, (ctx, p) => this.#drawMenuPop(ctx, p));
    this.status.holder.add(this.menuPop.holder);
    this.menuPop.holder.quaternion.identity();
    this.menuPop.holder.position.set((this.status.width + this.menuPop.width) / 2 + 0.008, (this.status.height - this.menuPop.height) / 2, 0);
    this.menuPop.material.depthTest = false;
    this.menuPop.mesh.renderOrder = 12;
    this.emotes = this.#makePanel(0.44, 0.1, EMOTES_POS, (ctx, p) => this.#drawEmotes(ctx, p));
    this.onEmote = null;
    this.roomCode = null;
    window.addEventListener('keydown', (e) => {
      // While typing a name or room code, every key is text — M must not toggle sound.
      if (!this.textInput && (e.key === 'm' || e.key === 'M')) {
        this.#setPref('sound', !this.prefs.sound);
        return;
      }
      if (e.key === 'Escape' && this.menuPop.mesh.visible) {
        this.toggleMenuPop(false);
        return;
      }
      if (e.key === 'Escape' && (this.options.mesh.visible || this.controls.mesh.visible)) {
        this.closeMenu(); // Esc closes the menu (or the first-visit Controls) first
        return;
      }
      const used = this.keyHandler?.(e) === true;
      // Esc opens the menu (Options + Controls), unless an open dialog used it to go back or cancel.
      if (e.key === 'Escape' && !used) this.toggleOptions();
    });
    world.onUpdate(() => this.#layoutHud());
    world.onUpdate((dt, t) => this.#animateStatusPop(t));
    // The "fit height" button is only live in VR, so repaint when that changes.
    for (const event of ['sessionstart', 'sessionend']) {
      world.renderer.xr.addEventListener(event, () => {
        this.options.render();
        this.controls.render();
      });
    }
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
    const key = `${xr}|${this.world.xrButton.hidden}|${cam.aspect.toFixed(3)}|${cam.fov.toFixed(2)}|${this.scorepad.height}|${this.modal.width}x${this.modal.height}|${this.modalPlace}|${this.emotes.mesh.visible}|${this.modal.mesh.visible}|${this.controls.mesh.visible}`;
    if (key === this.layoutKey) return;
    this.layoutKey = key;

    const pinned = [
      [this.status, STATUS_POS, -1, -1],
      [this.scorepad, SCOREPAD_POS, 1, -1], // bottom-right on desktop
      [this.options, SCOREPAD_POS, 1, 1],
      [this.emotes, EMOTES_POS, -1, -1],
    ];
    if (xr) {
      for (const [panel, pos] of [...pinned, [this.modal, MODAL_POS], [this.controls, CONTROLS_VR_POS]]) {
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
    const margin = 0.03 * hh;
    const gap = 0.02 * hh;
    // Pin a panel to the camera: (x, y) is its centre on a plane `dist` in front of the eye.
    const pin = (panel, scale, x, y, renderOrder) => {
      cam.add(panel.holder);
      panel.holder.quaternion.identity();
      panel.holder.scale.setScalar(scale);
      panel.holder.position.set(x, y, -dist);
      panel.material.depthTest = false;
      panel.mesh.renderOrder = renderOrder;
    };

    // Corner panels keep the status board's original text size: ~26% of the screen height,
    // and never wider than 28% of the screen (keeps your hand clear).
    const scale = Math.min((0.26 * 2 * hh) / 0.3, (0.28 * 2 * hw) / 0.44);
    for (const [panel, , sx, sy] of pinned) {
      pin(panel, scale, sx * (hw - margin - (panel.width * scale) / 2), sy * (hh - margin - (panel.height * scale) / 2), 10);
    }
    // If the Enter VR button is showing (a headset is connected), keep the score pad above it.
    if (!this.world.xrButton.hidden) this.scorepad.holder.position.y += (2 * hh * VR_BUTTON_PX) / window.innerHeight;
    // The emote bar sits just above the status board.
    this.emotes.holder.position.y += (this.status.height + 0.012) * scale;

    // Dialogs: centred on screen at the size they'd appear in the room, shrunk to fit narrow
    // windows (phones held upright), and drawn over everything else.
    const modal = this.modal;
    const natural = dist / MODAL_POS.distanceTo(DESKTOP_EYE);
    const fit = Math.min(natural, (0.94 * 2 * hw) / modal.width, (0.9 * 2 * hh) / modal.height);
    const w = modal.width * fit;
    const h = modal.height * fit;
    const centreY = Math.min(0.08 * hh, hh - h / 2);
    if (this.modalPlace === 'nearStatus') {
      // The bid box sits on top of your status board (or the emote bar above it, online),
      // lined up with the board's left edge.
      const st = this.status.holder;
      const below = this.emotes.mesh.visible ? this.emotes : this.status;
      const x = st.position.x - (this.status.width * st.scale.x) / 2 + w / 2;
      const y = below.holder.position.y + (below.height * below.holder.scale.y) / 2 + gap + h / 2;
      pin(modal, fit, THREE.MathUtils.clamp(x, -hw + margin + w / 2, hw - margin - w / 2), Math.min(y, hh - margin - h / 2), 11);
    } else {
      pin(modal, fit, 0, centreY, 11);
    }

    // Controls: centred where a centred dialog would end, filling the space down to the bottom
    // edge, at the same size as dialogs and no wider than ~60% of the screen.
    const controls = this.controls;
    const top = centreY - h / 2 - gap;
    const cScale = Math.max(0.01, Math.min(fit, (top + hh - margin) / controls.height, (0.62 * 2 * hw) / controls.width));
    pin(controls, cScale, 0, top - (controls.height * cScale) / 2, 11);

    // Options sits top-right. In squarer windows it could reach over the centred menu (and the
    // Controls box under it), so shrink it to fit the space beside them, but no smaller than
    // 60% (very narrow screens just have to overlap).
    if (this.modalPlace !== 'nearStatus') {
      let reach = 0; // how far right of centre the centred panels go
      if (modal.mesh.visible) reach = w / 2;
      if (controls.mesh.visible) reach = Math.max(reach, (controls.width * cScale) / 2);
      const room = hw - margin - gap - reach;
      const oScale = Math.max(scale * 0.6, Math.min(scale, room / this.options.width));
      const o = this.options.holder;
      o.scale.setScalar(oScale);
      o.position.set(hw - margin - (this.options.width * oScale) / 2, hh - margin - (this.options.height * oScale) / 2, -dist);
    }
  }

  // ---------- modal plumbing ----------

  #openModal({ width, height, draw, keys, ppm = 1000, textInput = false, place = 'center' }) {
    this.textInput = textInput;
    this.modalPlace = place; // 'center', or 'nearStatus' (desktop: on top of the status board)
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
    this.setYourTurn(false);
    this.menuPop.mesh.visible = false;
    this.status.mesh.visible = false;
    this.scorepad.mesh.visible = false;
    this.options.mesh.visible = false;
    this.controls.mesh.visible = false;
    this.emotes.mesh.visible = false;
    this.#closeModal();
    this.game = null;
  }

  /**
   * It's your move (bid, trump or card): a gold glow pulses around the edge of the screen on
   * desktop, and your status board gets a gold edge.
   */
  setYourTurn(on) {
    if (on === !!this.yourTurn) return;
    this.yourTurn = on;
    document.body.classList.toggle('your-turn', on);
    if (this.status.mesh.visible) this.status.render();
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
    // You just won a trick: animate your Won count (see #animateStatusPop).
    const tricks = opts.tricks?.[0] ?? game?.players?.[0]?.tricks;
    if (this.game && tricks > this.lastTricks) this.statusPopStart = this.world.elapsed;
    this.lastTricks = tricks;
    this.game = game;
    this.statusOpts = opts;
    this.status.render();
    if (this.scorepad.mesh.visible) this.#renderScorepad();
  }

  /** Animate the status board's Won count after you take a trick (see drawBidWon). */
  #animateStatusPop(t) {
    if (this.statusPopStart === undefined) return;
    this.status.pop = (t - this.statusPopStart) / POP_SECONDS;
    if (this.status.pop >= 1) {
      this.status.pop = 0;
      this.statusPopStart = undefined;
    }
    if (this.status.mesh.visible) this.status.render();
  }

  /** The compact status board: round and Menu, trump (centred), your bid (big) and your score. */
  #drawStatus(ctx, p) {
    const game = this.game;
    if (!game) return;
    const W = p.pxWidth;
    const H = p.pxHeight;
    drawPanelBackground(ctx, W, H, { radius: 22, highlight: this.yourTurn });

    // Row 1: round (and room code online) · Menu (pops out Scores / Options / Quit beside the board)
    const round = `Round ${game.round}/${game.totalRounds}`;
    text(ctx, round, 20, 32, { font: `bold 28px ${FONTS.serif}`, align: 'left', fill: THEME.gold });
    if (this.roomCode) {
      ctx.font = `bold 28px ${FONTS.serif}`;
      const x = 20 + ctx.measureText(round).width + 12;
      text(ctx, this.roomCode, x, 33, { font: `bold 18px ${FONTS.sans}`, align: 'left', fill: THEME.muted, maxWidth: W - 120 - x - 10 });
    }
    const menuOpen = this.menuPop.mesh.visible;
    p.button('menu', { x: W - 16 - 104, y: 14, w: 104, h: 32 }, menuOpen ? 'Menu ◂' : 'Menu ▸', {
      size: 18,
      selected: menuOpen,
      onClick: () => this.toggleMenuPop(),
    });

    // Row 2: trump, large and centred
    const trump = game.trumpSuit ? `${SUIT_INFO[game.trumpSuit].name} trump` : game.phase === 'chooseTrump' ? 'Trump: choosing…' : 'No trump';
    ctx.font = `bold 26px ${FONTS.sans}`;
    const badge = game.trumpSuit ? 44 : 0; // badge diameter + gap
    const trumpW = Math.min(W - 40 - badge, ctx.measureText(trump).width);
    const tx = (W - (badge + trumpW)) / 2;
    if (game.trumpSuit) suitBadge(ctx, game.trumpSuit, tx + 18, 72, 18);
    text(ctx, trump, tx + badge, 73, { font: `bold 26px ${FONTS.sans}`, align: 'left', maxWidth: trumpW });

    // Row 3: your bid, big
    const me = game.players[0];
    const hidden = this.statusOpts?.hideBids && me.bid !== null;
    const myTricks = this.statusOpts?.tricks?.[0] ?? me.tricks; // held back until the trick is swept over
    if (me.bid === null) text(ctx, 'No bid yet', W / 2, 112, { font: `bold 31px ${FONTS.sans}`, maxWidth: W - 40 });
    else drawBidWon(ctx, me.bid, myTricks, W / 2, 112, { font: `bold 31px ${FONTS.sans}`, align: 'center', pop: p.pop ?? 0, suffix: hidden ? ' (hidden)' : '' });

    // Row 4: your score, centred
    text(ctx, `Score ${me.score}`, W / 2, 150, { font: `bold 21px ${FONTS.sans}`, fill: THEME.muted });
  }

  // ---------- menu popout ----------

  toggleMenuPop(open = !this.menuPop.mesh.visible) {
    this.menuPop.mesh.visible = open;
    this.quitArmedUntil = 0;
    if (open) this.menuPop.render();
    if (this.status.mesh.visible) this.status.render();
  }

  #drawMenuPop(ctx, p) {
    const W = p.pxWidth;
    const H = p.pxHeight;
    drawPanelBackground(ctx, W, H, { radius: 20 });
    const row = (i) => ({ x: 12, y: 12 + i * 46, w: W - 24, h: 40 });
    p.button('scores', row(0), 'Scores', {
      size: 20,
      selected: this.scorepad.mesh.visible,
      onClick: () => {
        this.toggleScorepad();
        this.toggleMenuPop(false);
      },
    });
    p.button('options', row(1), 'Options', {
      size: 20,
      selected: this.options.mesh.visible,
      onClick: () => {
        this.toggleOptions();
        this.toggleMenuPop(false);
      },
    });
    const armed = performance.now() < this.quitArmedUntil;
    p.button('quit', row(2), armed ? 'Sure? Click again' : 'Quit', {
      size: armed ? 17 : 20,
      onClick: () => {
        if (performance.now() < this.quitArmedUntil) {
          this.quitArmedUntil = 0;
          this.toggleMenuPop(false);
          this.onQuit?.();
        } else {
          this.quitArmedUntil = performance.now() + 3000;
          this.menuPop.render();
          setTimeout(() => this.menuPop.mesh.visible && this.menuPop.render(), 3100);
        }
      },
    });
  }

  // ---------- score pad ----------

  toggleScorepad() {
    this.scorepad.mesh.visible = !this.scorepad.mesh.visible;
    if (this.scorepad.mesh.visible) {
      this.options.mesh.visible = false; // they share a spot
      this.controls.mesh.visible = false;
      this.#renderScorepad();
    }
    this.status.render();
  }

  // ---------- options ----------

  /** Controls on their own: shown on the main menu when the game first opens. */
  showControls() {
    this.controls.mesh.visible = true;
    this.controls.render();
  }

  /** Hide Options and Controls together. */
  closeMenu() {
    if (this.options.mesh.visible) this.toggleOptions();
    this.controls.mesh.visible = false;
  }

  toggleOptions() {
    this.options.mesh.visible = !this.options.mesh.visible;
    this.controls.mesh.visible = this.options.mesh.visible;
    if (this.options.mesh.visible) {
      this.scorepad.mesh.visible = false;
      this.options.render();
      this.controls.render();
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

    segmented(520, 'Headset view', 'headsetView', [
      ['vr', 'Scene'],
      ['passthrough', 'My room'],
    ]);
    const inRoom = this.prefs.headsetView === 'passthrough';
    let viewNote;
    if (!inRoom) viewNote = 'Play in the scene below. Choose My room to play in your real surroundings.';
    else if (xr || this.world.arSupported) viewNote = 'Your real room shows through, with a glass table, see-through cards and ghostly wizard heads.';
    else viewNote = 'Preview: in a headset like Meta Quest, your real room shows behind the glass table.';
    wrappedText(ctx, viewNote, W / 2, 606, W - 52, 26, { font: `20px ${FONTS.sans}`, fill: THEME.muted });

    segmented(652, 'Scene', 'scene', SCENES.map((s) => [s.id, s.label]));
    const sceneName = SCENES.find((s) => s.id === this.prefs.scene)?.name ?? '';
    text(ctx, inRoom ? `${sceneName} (hidden while My room is on)` : sceneName, W / 2, 722, { font: `20px ${FONTS.sans}`, fill: THEME.muted, maxWidth: W - 52 });
  }

  /** Written instructions: how to look around and play, for the device you're on. */
  #drawControls(ctx, p) {
    const W = p.pxWidth;
    const H = p.pxHeight;
    drawPanelBackground(ctx, W, H);
    const xr = this.world.isXR;
    text(ctx, xr ? 'Controls (VR)' : 'Controls (PC)', 26, 44, { font: `bold 32px ${FONTS.serif}`, align: 'left', fill: THEME.gold });
    const rows = xr
      ? [
          ['Look around', 'Turn your head. Lean in to read cards.'],
          ['Select', 'Point and pull the trigger (or pinch).'],
          ['Inspect a card', 'Point at a card on the table.'],
          ['Your hand', 'Point at a card, then trigger to play it.'],
          ['Table height', 'Options above: Seated / Standing, Fit table.'],
          ['Menu', 'Options button on the board by your hand.'],
        ]
      : [
          ['Move your head', 'Right-click and drag to look around.'],
          ['Zoom', 'Mouse wheel zooms toward the cursor.'],
          ['Inspect a card', 'Point at any card on the table.'],
          ['Play / choose', 'Left-click a card or button.'],
          ['Bid', 'Number keys, or click a number.'],
          ['Keys', 'Enter: continue · M: mute · Esc: menu'],
        ];
    // Two columns of three: what to do (bold), then how (muted) underneath.
    const colW = (W - 52) / 2;
    rows.forEach(([label, how], i) => {
      const x = 26 + Math.floor(i / 3) * (colW + 12);
      const y = 88 + (i % 3) * 64;
      text(ctx, label, x, y, { font: `bold 23px ${FONTS.sans}`, align: 'left' });
      text(ctx, how, x, y + 27, { font: `21px ${FONTS.sans}`, align: 'left', fill: THEME.muted, maxWidth: colW - 12 });
    });
    p.button('close', { x: W - 146, y: 16, w: 120, h: 44 }, xr ? 'Close' : 'Close (Esc)', { size: 20, onClick: () => this.closeMenu() });
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

  /** Home screen. Resolves 'solo' | 'host' | 'join' | 'name' | 'wizard' | 'stats'. */
  showHome({ getName, getLook }) {
    return this.#prompt((done) => {
      this.#openModal({
        width: 0.72,
        height: 0.6,
        draw: (ctx, p) =>
          drawHome(ctx, p, {
            name: getName(),
            look: getLook(),
            onPick: done,
            onRename: () => done('name'),
            onWizard: () => done('wizard'),
            onOptions: () => this.toggleOptions(),
            onStats: () => done('stats'),
            optionsOpen: this.options.mesh.visible,
          }),
        keys: (e) => {
          if (e.key === 'Enter') done('solo');
        },
      });
    });
  }

  /**
   * Your lifetime stats (see stats.js): `rows` are [label, value] pairs. Reset asks for a second
   * click first. Resolves 'reset' or null (Back).
   */
  showStats(rows) {
    let armedUntil = 0;
    const cols = 2;
    const perCol = Math.ceil(rows.length / cols);
    return this.#prompt((done) => {
      this.#openModal({
        width: 0.66,
        height: (120 + perCol * 76 + 96) / 1000,
        draw: (ctx, p) => {
          const W = p.pxWidth;
          const H = p.pxHeight;
          drawPanelBackground(ctx, W, H);
          text(ctx, 'Your stats', W / 2, 54, { font: `bold 42px ${FONTS.serif}`, fill: THEME.gold });
          const colW = (W - 80) / cols;
          rows.forEach(([label, value], i) => {
            const x = 40 + Math.floor(i / perCol) * colW + 10;
            const y = 124 + (i % perCol) * 76;
            text(ctx, label, x, y, { font: `20px ${FONTS.sans}`, align: 'left', fill: THEME.muted });
            text(ctx, value, x, y + 32, { font: `bold 32px ${FONTS.sans}`, align: 'left', maxWidth: colW - 20 });
          });
          const armed = performance.now() < armedUntil;
          p.button('back', { x: 40, y: H - 76, w: 160, h: 52 }, 'Back', { size: 22, onClick: () => done(null) });
          p.button('reset', { x: W - 260, y: H - 76, w: 220, h: 52 }, armed ? 'Sure? Click again' : 'Reset stats', {
            size: armed ? 19 : 22,
            onClick: () => {
              if (performance.now() < armedUntil) return done('reset');
              armedUntil = performance.now() + 3000;
              p.render();
              setTimeout(() => p.render(), 3100);
            },
          });
        },
        keys: (e) => {
          if (e.key === 'Escape' || e.key === 'Enter') {
            done(null);
            return true;
          }
        },
      });
    });
  }

  /**
   * Game setup: player count and house rules. Used before a solo game, and (with its own title and
   * button) to change the rules for a rematch. `humans` = people at the table, the lowest player
   * count allowed. Resolves the settings, or null for Back.
   */
  showSoloSetup(initial, { title = 'Play vs bots', subtitle = GAME_TAGLINE, startLabel = 'Deal me in', humans = 1 } = {}) {
    const s = { ...initial, numPlayers: Math.max(initial.numPlayers, humans, 3) };
    return this.#prompt((done) => {
      const start = () => done({ ...s });
      this.#openModal({
        width: 0.72,
        height: 0.64,
        draw: (ctx, p) => {
          const W = p.pxWidth;
          const H = p.pxHeight;
          drawPanelBackground(ctx, W, H);
          text(ctx, title, W / 2, 64, { font: `bold 48px ${FONTS.serif}`, fill: THEME.gold });
          text(ctx, subtitle, W / 2, 110, { font: `22px ${FONTS.sans}`, fill: THEME.muted });
          drawRules(ctx, p, s, { x: 48, y: 170, w: W - 96, humans, onChange: () => p.render() });
          p.button('start', { x: W / 2 - 150, y: H - 80, w: 300, h: 60 }, startLabel, { primary: true, size: 30, onClick: start });
          p.button('back', { x: 40, y: H - 76, w: 140, h: 52 }, 'Back', { size: 22, onClick: () => done(null) });
        },
        keys: (e) => {
          if (e.key === 'Enter') start();
          if (e.key === 'Escape') {
            done(null);
            return true;
          }
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
          else if (e.key === 'Escape') {
            done(null);
            return true;
          }
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
          else if (e.key === 'Escape') {
            done(null);
            return true;
          }
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

  /** Choose your wizard's style and hat colour. Resolves the new look, or null if cancelled. */
  askLook({ initial, name }) {
    let look = sanitizeLook(initial);
    return this.#prompt((done) => {
      this.#openModal({
        width: 0.8,
        height: 0.56,
        ppm: 1200,
        draw: (ctx, p) =>
          drawLookEditor(ctx, p, {
            look,
            name,
            onSkin: (skin) => {
              look = { ...look, skin };
              p.render();
            },
            onHat: (hat) => {
              look = { ...look, hat };
              p.render();
            },
            onRandom: () => {
              look = randomLook();
              p.render();
            },
            onCancel: () => done(null),
            onSave: () => done(look),
          }),
        keys: (e) => {
          if (e.key === 'Enter') done(look);
          if (e.key === 'Escape') {
            done(null);
            return true;
          }
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
          if (e.key === 'Enter' || e.key === 'Escape') {
            done();
            return e.key === 'Escape';
          }
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
        if (button && e.key === 'Escape') {
          onButton?.();
          return true;
        }
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
    const gridTop = forbidden.length ? 132 : 104;
    const heightPx = gridTop + rows * 70 + 10;

    // Tricks already called by the players before you (unknown while bids are hidden).
    const others = view.players.filter((pl) => pl.index !== 0 && pl.bid !== null);
    const hidden = others.some((pl) => pl.bid === '?');
    const called = others.reduce((sum, pl) => sum + (typeof pl.bid === 'number' ? pl.bid : 0), 0);
    let calledText;
    let calledColor = THEME.text;
    if (hidden) {
      calledText = 'Bids are hidden until everyone has bid';
      calledColor = THEME.muted;
    } else if (others.length === 0) {
      calledText = `0/${max} tricks called · you bid first`;
    } else {
      calledText = `${called}/${max} tricks called so far`;
      if (called > max) calledText += ` (${called - max} over)`;
    }
    // Just wide enough for the number buttons and the lines of text.
    const widthPx = Math.min(560, Math.max(360, cols * 72 + 50, calledText.length * 13 + 60));

    return this.#prompt((done) => {
      this.#openModal({
        place: 'nearStatus',
        width: widthPx / 1000,
        height: heightPx / 1000,
        draw: (ctx, p) => {
          const W = p.pxWidth;
          drawPanelBackground(ctx, W, p.pxHeight);
          text(ctx, 'Your bid', W / 2, 36, { font: `bold 36px ${FONTS.serif}`, fill: THEME.gold });
          text(ctx, calledText, W / 2, 76, { font: `bold 25px ${FONTS.sans}`, fill: calledColor, maxWidth: W - 40 });
          if (forbidden.length) {
            text(ctx, `Dealer rule: you can’t bid ${forbidden.join(', ')}`, W / 2, 106, { font: `bold 21px ${FONTS.sans}`, fill: THEME.bad, maxWidth: W - 40 });
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
  /**
   * Round or final results. A final screen resolves 'rematch' | 'rules' | 'menu'; `highlights` are stats
   * notes ("New personal best!"). `waiting` (guests) shows it without blocking: in a final screen
   * the only button is Leave table.
   */
  showSummary(game, { final, waiting = false, highlights = [] }) {
    const n = game.numPlayers;
    const notes = final ? highlights : [];
    const options = (done) => ({
      width: 0.72,
      height: (176 + n * 50 + 96 + notes.length * 32) / 1000,
      draw: (ctx, p) => this.#drawSummary(ctx, p, { game, final, done, waiting, notes }),
      keys: (e) => {
        if (done && (e.key === 'Enter' || e.key === ' ')) done(final ? 'rematch' : undefined);
        if (done && final && e.key === 'Escape') {
          done('menu');
          return true;
        }
      },
    });
    if (waiting) {
      this.cancelPrompts(new Error('replaced'));
      this.#openModal(options(null));
      return Promise.resolve();
    }
    return this.#prompt((done) => this.#openModal(options(done)));
  }

  #drawSummary(ctx, p, { game, final, done, waiting, notes }) {
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
    for (const [label, x, align] of cols) text(ctx, label, x, 150 + notes.length * 32, { font: `bold 22px ${FONTS.sans}`, align, fill: THEME.muted });

    const order = final ? game.standings() : game.players;
    // Stats highlights, between the title and the table.
    const shift = notes.length * 32;
    notes.forEach((note, i) => text(ctx, note, W / 2, 132 + i * 32, { font: `bold 23px ${FONTS.sans}`, fill: THEME.good }));

    order.forEach((pl, row) => {
      const r = last.results[pl.index];
      const y = 196 + shift + row * 50;
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

    if (waiting && !final) {
      text(ctx, 'Waiting for the host to start the next round…', W / 2, H - 50, { font: `bold 22px ${FONTS.sans}`, fill: THEME.muted });
    } else if (waiting) {
      text(ctx, 'Waiting for the host: rematch or not?', 40, H - 49, { font: `bold 22px ${FONTS.sans}`, align: 'left', fill: THEME.muted });
      p.button('leave', { x: W - 240, y: H - 78, w: 200, h: 58 }, 'Leave table', { onClick: () => this.onQuit?.() });
    } else if (final) {
      const bw = (W - 100) / 3;
      p.button('rematch', { x: 40, y: H - 78, w: bw, h: 58 }, 'Rematch', { primary: true, size: 26, onClick: () => done('rematch') });
      p.button('rules', { x: 50 + bw, y: H - 78, w: bw, h: 58 }, 'Change rules', { size: 24, onClick: () => done('rules') });
      p.button('menu', { x: 60 + 2 * bw, y: H - 78, w: bw, h: 58 }, 'Back to menu', { size: 24, onClick: () => done('menu') });
    } else {
      p.button('continue', { x: W / 2 - 140, y: H - 78, w: 280, h: 58 }, 'Next round', { primary: true, onClick: () => done() });
    }
  }
}
