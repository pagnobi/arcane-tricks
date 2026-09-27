import * as THREE from 'three';
import { Panel } from '../ui/Panel.js';
import { FONTS, THEME, drawPanelBackground, roundRect, text } from '../ui/draw.js';
import { EYE, nameplatePosition, seatAngle, seatFrame, seatPosition, turnMarkerPosition } from './layout.js';

const ROBE_COLORS = [0x6a3fb5, 0x2f7a8c, 0xa8413b, 0x3f7d3a, 0xb0842c, 0x39519e];
const HAT_COLORS = [0x3b1f73, 0x1d4c58, 0x6b2420, 0x234a20, 0x6e4f14, 0x222f66];
const HEAD_Y = 1.24;
const EMOTE_SECONDS = 3;

/** A seated wizard: a robe body plus a separate head group (so a real player's head can move). */
function makeWizardFigure(i, { beard = i % 3 !== 1 } = {}) {
  const robe = new THREE.MeshStandardMaterial({ color: ROBE_COLORS[i % ROBE_COLORS.length], roughness: 0.8 });
  const hatMat = new THREE.MeshStandardMaterial({ color: HAT_COLORS[i % HAT_COLORS.length], roughness: 0.7 });
  const skin = new THREE.MeshStandardMaterial({ color: 0xe6c3a0, roughness: 0.8 });
  const dark = new THREE.MeshBasicMaterial({ color: 0x111111 });

  const root = new THREE.Group();
  const body = new THREE.Mesh(new THREE.ConeGeometry(0.24, 0.86, 24), robe);
  body.position.y = 0.72;
  root.add(body);

  const head = new THREE.Group();
  head.position.y = HEAD_Y;
  const skull = new THREE.Mesh(new THREE.SphereGeometry(0.105, 24, 16), skin);
  const brim = new THREE.Mesh(new THREE.CylinderGeometry(0.19, 0.19, 0.015, 24), hatMat);
  brim.position.y = 0.09;
  const hat = new THREE.Mesh(new THREE.ConeGeometry(0.13, 0.34, 24), hatMat);
  hat.position.y = 0.26;
  hat.rotation.z = (i % 2 ? 1 : -1) * 0.12;
  head.add(skull, brim, hat);
  if (beard) {
    const b = new THREE.Mesh(new THREE.ConeGeometry(0.07, 0.18, 16), new THREE.MeshStandardMaterial({ color: 0xe8e4dc }));
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
  return { root, head, hands, robeMaterial: robe };
}

function drawNameplate(ctx, panel) {
  const s = panel.state;
  if (!s) return;
  const W = panel.pxWidth;
  const H = panel.pxHeight;
  drawPanelBackground(ctx, W, H, { radius: 20, highlight: s.isTurn });
  text(ctx, s.name, 20, 36, { font: `bold 32px ${FONTS.serif}`, align: 'left', fill: THEME.gold, maxWidth: s.isDealer ? 200 : 300 });
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
  } else if (s.flash) {
    line = s.flash;
    color = THEME.good;
  } else if (s.thinking) line = 'Thinking…';
  else if (s.bid === null) line = 'Bid —';
  else if (s.bid === '?') line = 'Bid ✓ (hidden)';
  else line = `Bid ${s.bid} · Won ${s.tricks}`;
  text(ctx, line, 20, 80, { font: `26px ${FONTS.sans}`, align: 'left', fill: color });
  text(ctx, `Score ${s.score}`, 20, 116, { font: `22px ${FONTS.sans}`, align: 'left', fill: THEME.muted });
  if (s.tag) text(ctx, s.tag, W - 20, 116, { font: `bold 18px ${FONTS.sans}`, align: 'right', fill: THEME.muted });
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

const _m = new THREE.Matrix4();
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

  setup(view, { multiplayer = false } = {}) {
    this.clear();
    const n = view.numPlayers;
    this.multiplayer = multiplayer;
    for (let seat = 1; seat < n; seat++) {
      const player = view.players[seat];
      const look = seat + Math.floor(Math.random() * 6);
      const figure = makeWizardFigure(look, { beard: player.isBot ? undefined : false });
      figure.root.position.copy(seatPosition(seat, n));
      figure.root.rotation.y = seatAngle(seat, n) + Math.PI;
      // Far-away nameplates are drawn larger so they stay readable.
      const position = nameplatePosition(seat, n);
      const k = THREE.MathUtils.clamp(position.distanceTo(EYE) / 1.8, 1, 1.5);
      const plate = new Panel({ width: 0.34 * k, height: 0.14 * k, ppm: 1000 / k, draw: drawNameplate });
      plate.mesh.position.copy(position);
      plate.mesh.userData.interactive = null; // display only
      const bubble = new Panel({ width: 0.3 * k, height: 0.1 * k, ppm: 1000 / k, draw: drawBubble });
      bubble.mesh.position.copy(position).add(new THREE.Vector3(0, 0.15 * k, 0));
      bubble.mesh.visible = false;
      this.group.add(figure.root, plate.mesh, bubble.mesh, ...figure.hands);
      this.seats[seat] = {
        figure,
        plate,
        bubble,
        bubbleUntil: 0,
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

  refresh(view, { thinking = null, winner = null } = {}) {
    for (let seat = 1; seat < view.numPlayers; seat++) {
      const p = view.players[seat];
      const s = this.seats[seat];
      if (!s) continue;
      s.plate.state = {
        name: p.name,
        isDealer: view.dealer === seat,
        isTurn: view.turn === seat && view.phase !== 'roundOver' && view.phase !== 'gameOver',
        thinking: thinking === seat,
        flash: winner === seat ? 'Wins the trick!' : null,
        bid: p.bid,
        tricks: p.tricks,
        score: p.score,
        connected: p.connected !== false,
        tag: this.multiplayer ? (p.isBot ? 'BOT' : 'PLAYER') : null,
      };
      s.plate.render();
    }
    const active = ['chooseTrump', 'bidding', 'playing'].includes(view.phase) && view.turn >= 0;
    this.turnMarker.visible = active;
    if (active) this.turnMarker.position.copy(turnMarkerPosition(view.turn, view.numPlayers));
  }

  /** A quick-chat bubble over a player's head. */
  emote(seat, message) {
    const s = this.seats[seat];
    if (!s) return;
    s.bubble.state = { text: message };
    s.bubble.render();
    s.bubble.mesh.visible = true;
    s.bubbleUntil = this.world.elapsed + EMOTE_SECONDS;
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
          hand.visible = !!target;
          if (target) hand.position.lerp(target, k);
        });
      } else {
        figure.head.position.lerp(new THREE.Vector3(0, HEAD_Y + Math.sin(t * 1.4 + s.phase) * 0.008, 0), k);
        figure.head.quaternion.slerp(new THREE.Quaternion(), k);
        figure.hands.forEach((hand) => (hand.visible = false));
      }
      s.plate.mesh.lookAt(this.cameraPos);
      if (s.bubble.mesh.visible) {
        s.bubble.mesh.lookAt(this.cameraPos);
        if (t > s.bubbleUntil) s.bubble.mesh.visible = false;
      }
    }
    this.turnMarker.material.opacity = 0.55 + Math.sin(t * 4) * 0.35;
  }
}
