import * as THREE from 'three';
import { Panel } from '../ui/Panel.js';
import { FONTS, THEME, drawBidWon, drawPanelBackground, roundRect, text } from '../ui/draw.js';
import { EYE, nameplatePosition, seatAngle, seatFrame, seatPosition, turnMarkerPosition } from './layout.js';
import { randomLook, resolveLook } from '../game/looks.js';

const HEAD_Y = 1.24;
const EMOTE_SECONDS = 3;

/** The hat for a style, built around the top of the head (y = 0 is the head's centre). */
function makeHat(style, hatMat, trimMat) {
  const hat = new THREE.Group();
  const brimRadius = style === 'wide' ? 0.26 : style === 'tall' ? 0.17 : 0.19;
  const brim = new THREE.Mesh(new THREE.CylinderGeometry(brimRadius, brimRadius, 0.015, 32), hatMat);
  brim.position.y = 0.09;
  const band = new THREE.Mesh(new THREE.CylinderGeometry(0.128, 0.132, 0.03, 32, 1, true), trimMat);
  band.position.y = 0.113;
  hat.add(brim, band);
  if (style === 'crooked') {
    // A short cone with a floppy tip bent to one side.
    const base = new THREE.Mesh(new THREE.ConeGeometry(0.13, 0.22, 24, 1, true), hatMat);
    base.position.y = 0.2;
    const tip = new THREE.Mesh(new THREE.ConeGeometry(0.075, 0.22, 20), hatMat);
    tip.position.set(0.05, 0.36, 0);
    tip.rotation.z = -0.6;
    hat.add(base, tip);
  } else {
    const height = style === 'tall' ? 0.46 : style === 'wide' ? 0.3 : 0.34;
    const cone = new THREE.Mesh(new THREE.ConeGeometry(style === 'tall' ? 0.11 : 0.13, height, 24), hatMat);
    cone.position.y = 0.09 + height / 2;
    if (style === 'classic') cone.rotation.z = -0.12;
    hat.add(cone);
  }
  return hat;
}

/**
 * A seated wizard in a given look (see game/looks.js): a robe body plus a separate head group,
 * so a real player's head can move independently.
 */
export function makeWizardFigure(look) {
  const style = resolveLook(look);
  const robe = new THREE.MeshStandardMaterial({ color: style.robe, roughness: 0.8 });
  const trimMat = new THREE.MeshStandardMaterial({ color: style.trim, roughness: 0.6 });
  const hatMat = new THREE.MeshStandardMaterial({ color: style.hatColor, roughness: 0.7 });
  const skin = new THREE.MeshStandardMaterial({ color: style.skinTone, roughness: 0.8 });
  const dark = new THREE.MeshBasicMaterial({ color: 0x111111 });

  const root = new THREE.Group();
  const body = new THREE.Mesh(new THREE.ConeGeometry(0.24, 0.86, 24), robe);
  body.position.y = 0.72;
  const collar = new THREE.Mesh(new THREE.TorusGeometry(0.075, 0.018, 8, 24), trimMat);
  collar.rotation.x = Math.PI / 2;
  collar.position.y = 1.1;
  const hem = new THREE.Mesh(new THREE.CylinderGeometry(0.235, 0.245, 0.05, 32, 1, true), trimMat);
  hem.position.y = 0.33;
  root.add(body, collar, hem);

  const head = new THREE.Group();
  head.position.y = HEAD_Y;
  const skull = new THREE.Mesh(new THREE.SphereGeometry(0.105, 24, 16), skin);
  head.add(skull, makeHat(style.hatStyle, hatMat, trimMat));
  if (style.beard !== null) {
    const b = new THREE.Mesh(new THREE.ConeGeometry(0.07, 0.18, 16), new THREE.MeshStandardMaterial({ color: style.beard }));
    b.position.set(0, -0.12, 0.07);
    b.rotation.x = Math.PI;
    head.add(b);
  }
  for (const side of [-1, 1]) {
    const eye = new THREE.Mesh(new THREE.SphereGeometry(0.014, 8, 8), dark);
    eye.position.set(side * 0.036, 0.02, 0.094);
    head.add(eye);
  }
  root.add(head);

  const hands = [0, 1].map(() => {
    const hand = new THREE.Mesh(new THREE.SphereGeometry(0.035, 12, 10), skin);
    hand.visible = false;
    return hand;
  });
  return { root, head, hands, body: [body, collar, hem], robeMaterial: robe };
}

function drawNameplate(ctx, panel) {
  const s = panel.state;
  if (!s) return;
  const W = panel.pxWidth;
  const H = panel.pxHeight;
  drawPanelBackground(ctx, W, H, { radius: 20, highlight: s.isTurn });
  text(ctx, s.name, 20, 34, { font: `bold 29px ${FONTS.serif}`, align: 'left', fill: THEME.gold, maxWidth: s.isDealer ? 200 : 300 });
  if (s.isDealer) {
    roundRect(ctx, W - 104, 16, 86, 36, 10);
    ctx.fillStyle = THEME.primary;
    ctx.fill();
    text(ctx, 'DEALER', W - 61, 35, { font: `bold 18px ${FONTS.sans}`, fill: '#1a1206' });
  }
  let line;
  let color = THEME.text;
  if (!s.connected) {
    line = 'Reconnecting…';
    color = THEME.bad;
  } else if (s.bid === null) {
    line = 'No bid yet';
    color = THEME.muted;
  } else if (s.bid === '?') line = 'Bid hidden';
  // The bid and tricks won are what everyone watches, so they get the biggest type.
  if (line) text(ctx, line, 20, 82, { font: `bold 38px ${FONTS.sans}`, align: 'left', fill: color, maxWidth: W - 40 });
  else drawBidWon(ctx, s.bid, s.tricks, 20, 82, { font: `bold 38px ${FONTS.sans}`, pop: panel.pop ?? 0 });
  text(ctx, `Score ${s.score}`, 20, 128, { font: `21px ${FONTS.sans}`, align: 'left', fill: THEME.muted });
  if (s.tag) text(ctx, s.tag, W - 20, 128, { font: `bold 18px ${FONTS.sans}`, align: 'right', fill: THEME.muted });
}

function drawBubble(ctx, panel) {
  const W = panel.pxWidth;
  const H = panel.pxHeight;
  roundRect(ctx, 4, 4, W - 8, H - 26, 22);
  ctx.fillStyle = '#f7f1e3';
  ctx.fill();
  ctx.beginPath();
  ctx.moveTo(W / 2 - 14, H - 24);
  ctx.lineTo(W / 2, H - 4);
  ctx.lineTo(W / 2 + 14, H - 24);
  ctx.fill();
  text(ctx, panel.state?.text ?? '', W / 2, (H - 22) / 2 + 2, { font: `bold 34px ${FONTS.sans}`, fill: '#2b2540', maxWidth: W - 30 });
}

const GHOST_OPACITY = 0.5;
const POP_SECONDS = 1.1;
const _m = new THREE.Matrix4();
const _v = new THREE.Vector3();
const _v2 = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _flip = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI);

/**
 * The other players around the table: wizard figures, nameplates, emote bubbles and the turn
 * marker. Bots are animated puppets; remote humans' heads and hands follow their real movements.
 */
export class Avatars {
  constructor(world) {
    this.world = world;
    this.group = new THREE.Group();
    world.scene.add(this.group);
    this.seats = [];
    this.turnMarker = new THREE.Mesh(
      new THREE.TorusGeometry(0.06, 0.007, 8, 48),
      new THREE.MeshBasicMaterial({ color: 0xffd766, transparent: true, toneMapped: false }),
    );
    this.turnMarker.rotation.x = Math.PI / 2;
    this.turnMarker.visible = false;
    world.scene.add(this.turnMarker);
    this.cameraPos = new THREE.Vector3();
    world.onUpdate((dt, t) => this.#update(dt, t));
  }

  /**
   * Passthrough mode: only the wizards' heads (hat, face and beard) show, as see-through ghosts,
   * so they don't block your view of your room. Robes and hands are hidden.
   */
  setGhost(on) {
    this.ghost = on;
    for (const s of this.seats) if (s) this.#applyGhost(s.figure);
  }

  #applyGhost(figure) {
    const on = !!this.ghost;
    for (const part of figure.body) part.visible = !on;
    if (on) for (const hand of figure.hands) hand.visible = false;
    figure.head.traverse((obj) => {
      if (!obj.material) return;
      obj.material.transparent = on;
      obj.material.opacity = on ? GHOST_OPACITY : 1;
      obj.material.needsUpdate = true;
    });
  }

  setup(view, { multiplayer = false } = {}) {
    this.clear();
    const n = view.numPlayers;
    this.multiplayer = multiplayer;
    for (let seat = 1; seat < n; seat++) {
      const player = view.players[seat];
      // The host picks every look (players choose theirs, bots get random ones), so all players
      // see the same wizards. Older hosts don't send looks — fall back to a random one.
      const figure = makeWizardFigure(player.look ?? randomLook());
      figure.root.position.copy(seatPosition(seat, n));
      figure.root.rotation.y = seatAngle(seat, n) + Math.PI;
      // Far-away nameplates are drawn larger so they stay readable.
      const position = nameplatePosition(seat, n);
      const k = THREE.MathUtils.clamp(position.distanceTo(EYE) / 1.8, 1, 1.5);
      const plate = new Panel({ width: 0.34 * k, height: 0.152 * k, ppm: 1000 / k, draw: drawNameplate });
      plate.mesh.position.copy(position);
      plate.mesh.userData.interactive = null; // display only
      const bubble = new Panel({ width: 0.3 * k, height: 0.1 * k, ppm: 1000 / k, draw: drawBubble });
      bubble.mesh.position.copy(position).add(new THREE.Vector3(0, 0.15 * k, 0));
      bubble.mesh.visible = false;
      this.group.add(figure.root, plate.mesh, bubble.mesh, ...figure.hands);
      this.#applyGhost(figure);
      this.seats[seat] = {
        figure,
        plate,
        bubble,
        bubbleUntil: 0,
        k,
        platePos: position.clone(),
        phase: Math.random() * 6,
        frame: seatFrame(seat, n),
        pose: null, // latest remote head/hands, already in our frame
      };
    }
    this.numPlayers = n;
  }

  clear() {
    for (const child of [...this.group.children]) this.group.remove(child);
    this.seats = [];
    this.turnMarker.visible = false;
  }

  /** `tricks`: the "Won" count to show per seat (defaults to the view's). */
  refresh(view, { thinking = null, winner = null, tricks: shown = null } = {}) {
    for (let seat = 1; seat < view.numPlayers; seat++) {
      const p = view.players[seat];
      const s = this.seats[seat];
      if (!s) continue;
      const tricks = shown?.[seat] ?? p.tricks;
      s.plate.state = {
        name: p.name,
        isDealer: view.dealer === seat,
        isTurn: view.turn === seat && view.phase !== 'roundOver' && view.phase !== 'gameOver',
        bid: p.bid,
        tricks,
        score: p.score,
        connected: p.connected !== false,
        tag: this.multiplayer ? (p.isBot ? 'BOT' : 'PLAYER') : null,
      };
      // Just won a trick: animate the Won count (see #update).
      if (s.lastTricks !== undefined && tricks > s.lastTricks) s.popStart = this.world.elapsed;
      s.lastTricks = tricks;
      s.plate.render();
      // "Thinking…" goes in the speech bubble above the sign, so the bid and tricks stay readable.
      s.thinking = thinking === seat;
      s.wonTrick = winner === seat;
    }
    const active = ['chooseTrump', 'bidding', 'playing'].includes(view.phase) && view.turn >= 0;
    this.turnMarker.visible = active;
    if (active) this.turnMarker.position.copy(turnMarkerPosition(view.turn, view.numPlayers));
  }

  /** A quick-chat bubble over a player's head. */
  emote(seat, message) {
    const s = this.seats[seat];
    if (!s) return;
    s.emoteText = message;
    s.bubbleUntil = this.world.elapsed + EMOTE_SECONDS;
  }

  /**
   * The speech bubble above the nameplate: an emote while it lasts, otherwise "Wins the trick!"
   * or "Thinking…". The nameplate itself always shows the bid, tricks won and score.
   */
  #updateBubble(s, t) {
    let message = null;
    if (t <= s.bubbleUntil) message = s.emoteText;
    else if (s.wonTrick) message = 'Wins the trick!';
    else if (s.thinking) message = 'Thinking…';
    if (message !== s.bubble.state?.text) {
      s.bubble.state = { text: message };
      if (message) s.bubble.render();
    }
    s.bubble.mesh.visible = !!message;
    if (!message) return;
    this.#placeBubble(s);
    s.bubble.mesh.lookAt(this.cameraPos);
  }

  /**
   * Above the nameplate. On a desktop screen the side players' nameplates sit near the top edge,
   * so if the bubble would be cut off there, it moves beside the nameplate (toward the middle).
   */
  #placeBubble(s) {
    const mesh = s.bubble.mesh;
    mesh.position.copy(s.platePos).add(_v.set(0, 0.15 * s.k, 0));
    if (this.world.isXR) return;
    const cam = this.world.camera;
    const top = _v2.copy(mesh.position).add(_v.set(0, 0.05 * s.k, 0)).project(cam).y;
    if (top <= 0.97) return;
    const right = _v.setFromMatrixColumn(cam.matrixWorld, 0).normalize();
    const side = _v2.copy(s.platePos).project(cam).x > 0 ? -1 : 1; // toward the screen centre
    mesh.position.copy(s.platePos).addScaledVector(right, side * (0.34 + 0.3 + 0.03) * 0.5 * s.k);
  }

  /**
   * A remote player's head (position + orientation) and hands, in their own frame
   * (see PoseSync). Head poses from desktop players have no hands.
   */
  setPose(seat, pose) {
    const s = this.seats[seat];
    if (!s || !Array.isArray(pose?.h)) return;
    const [x, y, z, qx, qy, qz, qw] = pose.h;
    const head = new THREE.Vector3(x, y, z).applyMatrix4(s.frame);
    // Camera looks down −Z; the figure's face is +Z. Rotate into our frame around the table.
    const quat = new THREE.Quaternion().setFromRotationMatrix(_m.extractRotation(s.frame)).multiply(_q.set(qx, qy, qz, qw)).multiply(_flip);
    const hands = [pose.l, pose.r].map((p) => (Array.isArray(p) ? new THREE.Vector3(p[0], p[1], p[2]).applyMatrix4(s.frame) : null));
    s.pose = { head, quat, hands, at: this.world.elapsed };
  }

  #update(dt, t) {
    this.world.camera.getWorldPosition(this.cameraPos);
    const k = Math.min(1, dt * 12);
    for (const s of this.seats) {
      if (!s) continue;
      const { figure } = s;
      const live = s.pose && t - s.pose.at < 3; // stale poses fall back to idle
      if (live) {
        // Head follows the player; body stays upright underneath it.
        const worldToRoot = figure.root.matrixWorld.clone().invert();
        const local = s.pose.head.clone().applyMatrix4(worldToRoot);
        figure.head.position.lerp(local, k);
        const rootQ = figure.root.getWorldQuaternion(new THREE.Quaternion());
        figure.head.quaternion.slerp(rootQ.invert().multiply(s.pose.quat), k);
        figure.hands.forEach((hand, i) => {
          const target = s.pose.hands[i];
          hand.visible = !!target && !this.ghost;
          if (target) hand.position.lerp(target, k);
        });
      } else {
        figure.head.position.lerp(new THREE.Vector3(0, HEAD_Y + Math.sin(t * 1.4 + s.phase) * 0.008, 0), k);
        figure.head.quaternion.slerp(new THREE.Quaternion(), k);
        figure.hands.forEach((hand) => (hand.visible = false));
      }
      s.plate.mesh.lookAt(this.cameraPos);
      this.#updateBubble(s, t);
      if (s.popStart !== undefined) {
        s.plate.pop = (t - s.popStart) / POP_SECONDS;
        if (s.plate.pop >= 1) {
          s.plate.pop = 0;
          s.popStart = undefined;
        }
        s.plate.render();
      }
    }
    this.turnMarker.material.opacity = 0.55 + Math.sin(t * 4) * 0.35;
  }
}
