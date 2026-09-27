import * as THREE from 'three';
import { sortHand } from '../game/cards.js';
import { createCardBack, createCardFront } from './cardTextures.js';
import {
  CARD_H,
  CARD_W,
  botHandPose,
  deckPose,
  foreheadPose,
  humanHandPose,
  trickPose,
  trumpPose,
  wonPilePose,
} from './layout.js';

const HALF_THICKNESS = 0.00015;
const DECK_SIZE = 60;

function roundedRectGeometry(w, h, r) {
  const shape = new THREE.Shape();
  const x = -w / 2;
  const y = -h / 2;
  shape.moveTo(x + r, y);
  shape.lineTo(x + w - r, y);
  shape.quadraticCurveTo(x + w, y, x + w, y + r);
  shape.lineTo(x + w, y + h - r);
  shape.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  shape.lineTo(x + r, y + h);
  shape.quadraticCurveTo(x, y + h, x, y + h - r);
  shape.lineTo(x, y + r);
  shape.quadraticCurveTo(x, y, x + r, y);
  const geo = new THREE.ShapeGeometry(shape, 6);
  const pos = geo.attributes.position;
  const uv = geo.attributes.uv;
  for (let i = 0; i < pos.count; i++) uv.setXY(i, (pos.getX(i) - x) / w, (pos.getY(i) - y) / h);
  return geo;
}

const cardGeometry = roundedRectGeometry(CARD_W, CARD_H, 0.007);
const glowGeometry = roundedRectGeometry(CARD_W + 0.014, CARD_H + 0.014, 0.012);
const hitMaterial = new THREE.MeshBasicMaterial({ visible: false });
let backMaterial = null;
const frontMaterials = new Map(); // card id → material, created on first use

function frontMaterialFor(card) {
  let m = frontMaterials.get(card.id);
  if (!m) {
    m = new THREE.MeshBasicMaterial({ map: createCardFront(card), toneMapped: false });
    frontMaterials.set(card.id, m);
  }
  return m;
}

// Inspecting a table card: it rises part of the way toward your eyes, turns to face you and grows.
const INSPECT_APPROACH = 0.3;
const INSPECT_SCALE = 1.7;
const UP = new THREE.Vector3(0, 1, 0);
const IDENTITY = new THREE.Quaternion();
const _target = new THREE.Vector3();
const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _inv = new THREE.Quaternion();

/**
 * One physical card. It isn't tied to a particular card: `setFace(card)` shows a face, and
 * `setFace(null)` shows the back on both sides — how other players' hidden cards are drawn (their
 * identity isn't even known to this browser in online play). An invisible hit area stays at the
 * resting spot so the pointer doesn't lose the card while it's lifted.
 */
class CardObject extends THREE.Group {
  constructor() {
    super();
    backMaterial ??= new THREE.MeshBasicMaterial({ map: createCardBack(), toneMapped: false });
    this.card = null;
    this.inner = new THREE.Group();
    this.add(this.inner);

    this.front = new THREE.Mesh(cardGeometry, backMaterial);
    this.front.position.z = HALF_THICKNESS;
    this.back = new THREE.Mesh(cardGeometry, backMaterial);
    this.back.rotation.y = Math.PI;
    this.back.position.z = -HALF_THICKNESS;
    this.glow = new THREE.Mesh(
      glowGeometry,
      new THREE.MeshBasicMaterial({ color: 0xffd766, transparent: true, opacity: 0.9, toneMapped: false }),
    );
    this.glow.visible = false;
    this.inner.add(this.glow, this.front, this.back);
    this.add(new THREE.Mesh(cardGeometry, hitMaterial));

    this.hovered = false;
    this.lift = 0;
    this.inspected = false;
    this.inspectAmount = 0;
  }

  setFace(card) {
    this.card = card;
    this.front.material = card ? frontMaterialFor(card) : backMaterial;
    this.setDimmed(false);
  }

  setDimmed(dimmed) {
    if (this.card) this.front.material.color.setScalar(dimmed ? 0.42 : 1);
  }

  setGlow(on) {
    this.glow.visible = on;
  }

  update(dt, eye) {
    this.lift += ((this.hovered ? 1 : 0) - this.lift) * Math.min(1, dt * 14);
    this.inspectAmount += ((this.inspected ? 1 : 0) - this.inspectAmount) * Math.min(1, dt * 10);
    const a = this.inspectAmount;
    if (a < 0.001) {
      this.inspectAmount = 0;
      this.inner.quaternion.identity();
      this.inner.position.set(0, this.lift * 0.024, this.lift * 0.012);
      this.inner.scale.setScalar(1 + this.lift * 0.1);
      return;
    }
    // Cards are direct children of the scene, so position/quaternion are world-space.
    // Slide toward you horizontally with a small lift, so it stays below any prompt panel.
    _target.copy(this.position).lerp(eye, INSPECT_APPROACH);
    _target.y = this.position.y + 0.06;
    _q.setFromRotationMatrix(_m.lookAt(eye, _target, UP)); // +Z (the card face) toward the eye
    _inv.copy(this.quaternion).invert();
    this.inner.position.copy(_target).sub(this.position).applyQuaternion(_inv).multiplyScalar(a);
    this.inner.quaternion.slerpQuaternions(IDENTITY, _inv.multiply(_q), a);
    this.inner.scale.setScalar(1 + (INSPECT_SCALE - 1) * a);
  }
}

/**
 * Draws the cards for one player's view of the table (you are always seat 0) and animates them
 * between deck, hands, trick and piles. Keeps its own model of which object is where:
 *   hands[seat] = [CardObject…]  (objects of hidden cards have card === null)
 */
export class CardTable {
  constructor(world, tweens, pointer) {
    this.tweens = tweens;
    this.objects = [];
    this.selectable = new Set();
    this.eye = new THREE.Vector3();
    this.sound = null; // optional Sound, set by main.js
    this.hands = [];
    this.trick = []; // [{ obj, player }]
    this.trumpObj = null;
    for (let i = 0; i < DECK_SIZE; i++) {
      const obj = new CardObject();
      world.scene.add(obj);
      pointer.add(obj);
      this.objects.push(obj);
    }
    this.objects.forEach((o, k) => this.#place(o, deckPose(k)));
    world.onUpdate((dt) => {
      world.camera.getWorldPosition(this.eye);
      for (const o of this.objects) o.update(dt, this.eye);
    });
  }

  #place(obj, pose) {
    obj.position.copy(pose.position);
    obj.quaternion.copy(pose.quaternion);
    obj.scale.setScalar(1);
  }

  #move(obj, pose, duration = 0.45, delay = 0, arc = 0, onStart = null) {
    return this.tweens.to(obj, { position: pose.position, quaternion: pose.quaternion, scale: 1 }, duration, delay, arc, onStart);
  }

  /** Face-up cards on the table can be pointed at for a closer look. */
  #setInspectable(o, on) {
    o.inspected = false;
    o.userData.interactive = on
      ? {
          hover: () => {
            o.inspected = true;
          },
          unhover: () => {
            o.inspected = false;
          },
          cursor: 'zoom-in',
        }
      : null;
  }

  #reset(o) {
    this.tweens.cancel(o);
    o.visible = true;
    o.setFace(null);
    o.setGlow(false);
    o.hovered = false;
    this.#setInspectable(o, false);
  }

  /** Pose for the k-th card of a seat's hand, given the current hand model. */
  #handPose(view, seat, obj) {
    const n = view.numPlayers;
    const hand = this.hands[seat];
    if (view.isForeheadRound) return seat === 0 ? humanHandPose(0, 1, false) : foreheadPose(seat, n);
    if (seat === 0) {
      const known = hand.filter((o) => o.card);
      const sorted = sortHand(known.map((o) => o.card), view.trumpSuit).map((c) => known.find((o) => o.card === c));
      const order = [...sorted, ...hand.filter((o) => !o.card)];
      return humanHandPose(order.indexOf(obj), hand.length);
    }
    return botHandPose(seat, n, hand.indexOf(obj), hand.length);
  }

  /** Deal sequence: one card at a time, starting left of the dealer. */
  #dealOrder(view) {
    const order = [];
    for (let r = 0; r < view.round; r++) {
      let seat = view.nextSeat(view.dealer);
      for (let i = 0; i < view.numPlayers; i++) {
        order.push({ seat, card: view.players[seat].hand[r] ?? null });
        seat = view.nextSeat(seat);
      }
    }
    return order;
  }

  /** Stack every card face down in the deck, ready to deal. */
  prepareRound() {
    this.selectable.clear();
    this.hands = [];
    this.trick = [];
    this.trumpObj = null;
    this.objects.forEach((o, k) => {
      this.#reset(o);
      this.#place(o, deckPose(k));
    });
  }

  async deal(view, speed = 1) {
    const deckSpot = deckPose(0).position;
    this.hands = view.players.map(() => []);
    const order = this.#dealOrder(view);
    // Deal from the top of the stack.
    const stack = this.objects.slice(Math.max(0, this.objects.length - order.length - 1)).reverse();
    const assigned = order.map(({ seat, card }, i) => {
      const obj = stack[i];
      this.hands[seat].push(obj);
      obj.setFace(card);
      return { seat, obj };
    });
    this.trumpObj = view.trumpCard ? stack[order.length] : null;
    const moves = assigned.map(({ seat, obj }, i) => {
      const onStart = () => this.sound?.play('deal', deckSpot, { rate: 0.9 + Math.random() * 0.25, volume: 0.6 });
      return this.#move(obj, this.#handPose(view, seat, obj), 0.35 * speed, i * 0.05 * speed, 0.05, onStart).then(() => {
        // Forehead cards are on show to everyone else, so they can be inspected too.
        if (seat !== 0 && obj.card) this.#setInspectable(obj, true);
      });
    });
    await Promise.all(moves);
  }

  async revealTrump(view) {
    if (!view.trumpCard || !this.trumpObj) return;
    const o = this.trumpObj;
    o.setFace(view.trumpCard);
    this.sound?.play('flip', trumpPose().position);
    await this.#move(o, trumpPose(), 0.5, 0, 0.08);
    this.#setInspectable(o, true);
  }

  async layoutHand(view, seat, duration = 0.3) {
    await Promise.all((this.hands[seat] ?? []).map((o) => this.#move(o, this.#handPose(view, seat, o), duration)));
  }

  /** Move `card` from `seat`'s hand to the trick. Hidden cards get their face now. */
  async playToTrick(view, seat, card, order) {
    const hand = this.hands[seat] ?? [];
    let o = hand.find((h) => h.card?.id === card.id);
    if (!o) o = hand.filter((h) => !h.card)[Math.floor(Math.random() * hand.filter((h) => !h.card).length)] ?? hand[0];
    if (!o) return;
    hand.splice(hand.indexOf(o), 1);
    this.selectable.delete(o);
    this.#setInspectable(o, false);
    o.hovered = false;
    o.setFace(card);
    this.trick.push({ obj: o, player: seat });
    const pose = trickPose(seat, view.numPlayers, order, card);
    await Promise.all([this.#move(o, pose, 0.4, 0, 0.06), this.layoutHand(view, seat)]);
    this.sound?.play('play', pose.position, { rate: 0.9 + Math.random() * 0.2 });
    if (card.kind === 'wizard') this.sound?.play('wizard', pose.position);
    if (card.kind === 'jester') this.sound?.play('jester', pose.position);
    this.#setInspectable(o, true);
  }

  glowTrickCard(player) {
    this.trick.find((t) => t.player === player)?.obj.setGlow(true);
  }

  async collectTrick(winner, n) {
    const plays = this.trick;
    this.trick = [];
    for (const { obj } of plays) this.#setInspectable(obj, false);
    this.sound?.play('sweep', wonPilePose(winner, n, 0).position, { volume: 0.7 });
    await Promise.all(plays.map(({ obj }, i) => this.#move(obj, wonPilePose(winner, n, i), 0.45, i * 0.04, 0.05)));
    for (const { obj } of plays) {
      obj.visible = false;
      obj.setGlow(false);
    }
  }

  /** Make your legal cards clickable; the rest dim. */
  setSelectable(legalIds, onPick) {
    for (const o of this.hands[0] ?? []) {
      // In the forehead round your card is hidden from you — it's still yours to play.
      const legal = o.card ? legalIds.has(o.card.id) : legalIds.size > 0;
      o.setDimmed(!legal);
      this.selectable.add(o);
      o.userData.interactive = legal
        ? {
            hover: () => {
              o.hovered = true;
            },
            unhover: () => {
              o.hovered = false;
            },
            click: () => onPick(o.card?.id ?? [...legalIds][0]),
          }
        : null;
    }
  }

  /** Undo setSelectable (table cards keep their inspect behaviour). */
  clearSelectable() {
    for (const o of this.selectable) {
      o.userData.interactive = null;
      o.hovered = false;
      o.setDimmed(false);
    }
    this.selectable.clear();
  }

  /** Sweep every visible card back to the deck. */
  async gatherAll() {
    const visible = this.objects.filter((o) => o.visible && (o.card || this.hands.some((h) => h.includes(o))));
    if (visible.length) this.sound?.play('sweep', deckPose(0).position);
    await Promise.all(
      visible.map((o, k) => {
        o.setGlow(false);
        this.#setInspectable(o, false);
        return this.#move(o, deckPose(k), 0.35, Math.min(k, 20) * 0.01);
      }),
    );
    this.prepareRound();
  }

  /** Rejoin: put everything where the view says, instantly. */
  restore(view) {
    this.prepareRound();
    if (view.phase === 'ready' || view.phase === 'gameOver') return;
    let next = this.objects.length - 1;
    const take = () => this.objects[next--];
    this.hands = view.players.map((p) =>
      p.hand.map((card) => {
        const o = take();
        o.setFace(card);
        return o;
      }),
    );
    this.hands.forEach((hand, seat) =>
      hand.forEach((o) => {
        this.#place(o, this.#handPose(view, seat, o));
        if (seat !== 0 && o.card) this.#setInspectable(o, true);
      }),
    );
    if (view.trumpCard) {
      this.trumpObj = take();
      this.trumpObj.setFace(view.trumpCard);
      this.#place(this.trumpObj, trumpPose());
      this.#setInspectable(this.trumpObj, true);
    }
    view.trick.forEach(({ player, card }, order) => {
      const o = take();
      o.setFace(card);
      this.#place(o, trickPose(player, view.numPlayers, order, card));
      this.#setInspectable(o, true);
      this.trick.push({ obj: o, player });
    });
  }
}
