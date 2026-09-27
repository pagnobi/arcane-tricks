// Shared constants and helpers for online play.
//
// Topology: the host's browser runs the authoritative Game (src/session/TableHost.js); every other
// player is a client that only ever receives *their own view* of the table (src/game/views.js), so
// nobody's browser holds other players' hidden cards.
//
// Host → client messages
//   lobby     { seats, settings, yourSeat, code }          before the game starts
//   event     { event }                                    a table event (see TableHost), in your seat order
//   prompt    { id, kind, data }                           it's your decision: 'trump' | 'bid' | 'play'
//   pose      { seat, pose }                               another player's head/hands
//   emote     { seat, emote }                              a quick-chat reaction
//   rejected  { reason }                                   'full' | 'started' | 'version'
//   closed    {}                                           host left / ended the table
//   ping      {}
// Client → host messages
//   hello     { clientId, name, version }
//   answer    { id, value }
//   pose      { pose }
//   emote     { emote }
//   leave     {}
//   ping      {}

export const PROTOCOL_VERSION = 1;
export const PEER_PREFIX = 'arcane-tricks-v1-';
export const CODE_LENGTH = 4;
export const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ'; // no I or O (look like 1 and 0)
export const HEARTBEAT_MS = 2000;
export const TIMEOUT_MS = 9000; // silence after which a connection counts as lost
export const REJOIN_GRACE_MS = 15000; // how long a dropped player's turn waits before a bot steps in

export const EMOTES = ['Nice!', 'Oops!', 'Well played', 'Hmm…', 'Ha!', 'Good game'];

export function makeRoomCode(rng = Math.random) {
  let code = '';
  for (let i = 0; i < CODE_LENGTH; i++) code += CODE_ALPHABET[Math.floor(rng() * CODE_ALPHABET.length)];
  return code;
}

export function normalizeCode(text) {
  return [...String(text).toUpperCase()].filter((ch) => CODE_ALPHABET.includes(ch)).join('').slice(0, CODE_LENGTH);
}

export function isValidCode(code) {
  return normalizeCode(code) === code && code.length === CODE_LENGTH;
}

const ADJECTIVES = ['Amber', 'Silver', 'Misty', 'Clever', 'Brave', 'Quiet', 'Lucky', 'Cosmic', 'Velvet', 'Rusty', 'Golden', 'Wandering', 'Sleepy', 'Merry'];
const NOUNS = ['Owl', 'Fox', 'Raven', 'Toad', 'Comet', 'Moth', 'Badger', 'Heron', 'Lynx', 'Otter', 'Wisp', 'Newt', 'Sprite', 'Pike'];

export const NAME_MAX = 16;
/** A single character allowed in names. */
export const NAME_CHAR = /^[\p{L}\p{N} '._-]$/u;

/**
 * Clean up a player-chosen name: letters (any language), digits, spaces and ' . _ - only;
 * no emoji or control characters; whitespace collapsed; at most NAME_MAX characters.
 * The host applies this to every name it receives, so a modified client can't sneak anything in.
 */
export function sanitizeName(text) {
  return String(text ?? '')
    .normalize('NFC')
    .replace(/[^\p{L}\p{N} '._-]/gu, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, NAME_MAX)
    .trim();
}

/** Friendly random player names — the default, and one tap away in the name editor. */
export function randomName(rng = Math.random) {
  return `${ADJECTIVES[Math.floor(rng() * ADJECTIVES.length)]} ${NOUNS[Math.floor(rng() * NOUNS.length)]}`;
}

export function randomId() {
  return Array.from({ length: 16 }, () => Math.floor(Math.random() * 36).toString(36)).join('');
}
