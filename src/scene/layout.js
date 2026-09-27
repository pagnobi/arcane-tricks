import * as THREE from 'three';

// World layout, in metres. The human always sits at seat 0, at the origin, facing −Z.
// In VR the origin is your floor position ("local-floor" reference space).

export const TABLE_CENTER = new THREE.Vector3(0, 0.74, -0.9); // y = table-top height
export const TABLE_RADIUS = 0.85;
export const SEAT_RADIUS = 1.12;
export const CARD_W = 0.08;
export const CARD_H = 0.12;

/** Eye height of someone sitting at the table — the whole scene is designed around it. */
export const SEATED_EYE_HEIGHT = 1.22;

/**
 * How far to shift the VR world vertically so your eyes end up at seated height.
 * Standing players (eyes ~1.6 m) get a negative offset: the table rises to meet them.
 * Returns null while the headset height looks implausible (tracking not ready yet).
 */
export function fitHeightOffset(eyeHeight) {
  if (!(eyeHeight > 0.5 && eyeHeight < 2.4)) return null;
  return THREE.MathUtils.clamp(SEATED_EYE_HEIGHT - eyeHeight, -1.0, 0.5);
}

/** Approximate eye position — UI panels turn to face it. */
export const EYE = new THREE.Vector3(0, 1.25, 0.25);
export const DESKTOP_EYE = new THREE.Vector3(0, 1.36, 0.42);
export const DESKTOP_LOOK = new THREE.Vector3(0, 1.0, -0.9);

const FLIP = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI);
const euler = new THREE.Euler();

function orientation(pitch, yaw, roll) {
  return new THREE.Quaternion().setFromEuler(euler.set(pitch, yaw, roll, 'YXZ'));
}

function pose(position, quaternion, faceUp = true) {
  if (!faceUp) quaternion.multiply(FLIP);
  return { position, quaternion };
}

function normalOf(q) {
  return new THREE.Vector3(0, 0, 1).applyQuaternion(q);
}

function hash(str) {
  let h = 0;
  for (const ch of str) h = (h * 31 + ch.charCodeAt(0)) | 0;
  return h;
}

/**
 * Seat angle around the table (0 = the human, nearest the viewer). Play passes to the left.
 * Bots sit in an arc across the table so everyone is in front of you — no head-turning in VR,
 * and all nameplates stay on screen on desktop.
 */
export function seatAngle(seat, n) {
  if (seat === 0) return 0;
  const step = THREE.MathUtils.degToRad(n <= 4 ? 65 : n === 5 ? 50 : 42);
  return Math.PI - (seat - n / 2) * step;
}

export function seatDirection(seat, n) {
  const a = seatAngle(seat, n);
  return new THREE.Vector3(Math.sin(a), 0, Math.cos(a));
}

/**
 * Every player sees themselves at seat 0. A remote player's head/hand positions arrive in *their*
 * frame; this matrix spins them around the table centre to where that player sits in *our* view.
 */
export function seatFrame(seat, n) {
  const { x, z } = TABLE_CENTER;
  // You sit at the origin, a little nearer the table than the avatars' chairs — push poses back
  // so a remote player's head lands on their avatar's shoulders.
  const chairOffset = SEAT_RADIUS - Math.hypot(x, z);
  return new THREE.Matrix4()
    .makeTranslation(x, 0, z)
    .multiply(new THREE.Matrix4().makeRotationY(seatAngle(seat, n)))
    .multiply(new THREE.Matrix4().makeTranslation(-x, 0, -z + chairOffset));
}

function tableSpot(dir, radius, lift = 0) {
  return TABLE_CENTER.clone().addScaledVector(dir, radius).setY(TABLE_CENTER.y + lift);
}

export function seatPosition(seat, n) {
  return tableSpot(seatDirection(seat, n), SEAT_RADIUS).setY(0);
}

export function nameplatePosition(seat, n) {
  return tableSpot(seatDirection(seat, n), SEAT_RADIUS - 0.04).setY(1.75);
}

export function turnMarkerPosition(seat, n) {
  return tableSpot(seatDirection(seat, n), 0.72, 0.004);
}

/** The human's fan of cards, floating just above the near edge of the table. */
export function humanHandPose(k, count, faceUp = true) {
  const spacing = Math.min(0.06, 0.64 / Math.max(count, 1));
  const x = (k - (count - 1) / 2) * spacing;
  const q = orientation(-0.8, 0, -x * 0.7);
  const position = new THREE.Vector3(x, 0.88 - 0.35 * x * x, -0.12);
  position.addScaledVector(normalOf(q), k * 0.0012); // later cards sit on top
  return pose(position, q, faceUp);
}

/** A bot's fan: fronts face the bot, backs face the table. */
export function botHandPose(seat, n, k, count) {
  const a = seatAngle(seat, n);
  const tangent = new THREE.Vector3(Math.cos(a), 0, -Math.sin(a));
  const spacing = Math.min(0.03, 0.3 / Math.max(count, 1));
  const x = (k - (count - 1) / 2) * spacing;
  const q = orientation(-0.35, a, -x * 1.2);
  const position = tableSpot(seatDirection(seat, n), SEAT_RADIUS - 0.3).addScaledVector(tangent, x);
  position.y = 0.97 - 0.3 * x * x;
  position.addScaledVector(normalOf(q), k * 0.001);
  return pose(position, q);
}

/** Round-1 house rule: the card is held on the forehead, facing everyone else. */
export function foreheadPose(seat, n) {
  const a = seatAngle(seat, n);
  const position = tableSpot(seatDirection(seat, n), SEAT_RADIUS - 0.15).setY(1.36);
  return pose(position, orientation(0.1, a + Math.PI, 0));
}

/** Played cards lie on the table in front of whoever played them, readable from seat 0. */
export function trickPose(seat, n, order, card) {
  const tilt = 0.15;
  const position = tableSpot(seatDirection(seat, n), 0.3, 0.004 + order * 0.002 + (CARD_H / 2) * Math.sin(tilt));
  const yaw = ((Math.abs(hash(card.id)) % 100) / 100 - 0.5) * 0.25;
  return pose(position, orientation(-Math.PI / 2 + tilt, yaw, 0));
}

export function deckPose(k) {
  const position = TABLE_CENTER.clone().add(new THREE.Vector3(-0.075, 0.001 + k * 0.0004, 0));
  return pose(position, orientation(-Math.PI / 2, 0, 0), false);
}

export function trumpPose() {
  const tilt = 0.15;
  const position = TABLE_CENTER.clone().add(new THREE.Vector3(0.075, 0.004 + (CARD_H / 2) * Math.sin(tilt), 0));
  return pose(position, orientation(-Math.PI / 2 + tilt, 0, 0));
}

export function wonPilePose(seat, n, i) {
  const a = seatAngle(seat, n);
  return pose(tableSpot(seatDirection(seat, n), 0.62, 0.002 + i * 0.0005), orientation(-Math.PI / 2, a, 0), false);
}
