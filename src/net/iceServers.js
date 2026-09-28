// Which STUN/TURN servers WebRTC may use to connect two players.
//
// STUN helps each browser discover a public address so the two can connect directly. When a
// network blocks direct connections, traffic must go through a TURN relay instead. Sources, best
// first (see README → "Connection problems"):
//   1. VITE_ICE_ENDPOINT  – URL of our Cloudflare Worker (worker/), which hands out short-lived
//                           Cloudflare TURN credentials
//   2. VITE_TURN_URLS / VITE_TURN_USERNAME / VITE_TURN_CREDENTIAL – a fixed TURN server
//   3. PeerJS's free community relay – always last; often overloaded

const env = import.meta.env ?? {};
const FETCH_TIMEOUT_MS = 5000;
const CACHE_MS = 60 * 60 * 1000; // credentials last 6 hours; refresh hourly

const STUN = [
  { urls: ['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302', 'stun:stun2.l.google.com:19302'] },
  { urls: 'stun:stun.cloudflare.com:3478' },
];
const PEERJS_TURN = { urls: ['turn:eu-0.turn.peerjs.com:3478', 'turn:us-0.turn.peerjs.com:3478'], username: 'peerjs', credential: 'peerjsp' };
const FIXED_TURN = env.VITE_TURN_URLS
  ? [
      {
        urls: env.VITE_TURN_URLS.split(',').map((u) => u.trim()).filter(Boolean),
        username: env.VITE_TURN_USERNAME,
        credential: env.VITE_TURN_CREDENTIAL,
      },
    ]
  : [];

let cache = null;
/** Where the relay came from last time — shown in connection error details. */
export let relaySource = env.VITE_ICE_ENDPOINT ? 'cloudflare (not fetched yet)' : FIXED_TURN.length ? 'custom TURN' : 'PeerJS community relay only';

/** ICE servers for a new connection. Never throws: falls back to the built-in list. */
export async function getIceServers({ endpoint = env.VITE_ICE_ENDPOINT, fetchImpl = globalThis.fetch } = {}) {
  const fallback = [...STUN, ...FIXED_TURN, PEERJS_TURN];
  if (!endpoint) return fallback;
  if (cache && cache.expires > Date.now()) return cache.servers;
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
    const res = await fetchImpl(endpoint, { signal: controller.signal });
    clearTimeout(timer);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const { iceServers } = await res.json();
    const relays = (Array.isArray(iceServers) ? iceServers : []).filter((s) => s && s.urls);
    if (!relays.length) throw new Error('empty');
    const servers = [...STUN, ...relays, ...FIXED_TURN, PEERJS_TURN];
    cache = { servers, expires: Date.now() + CACHE_MS };
    relaySource = 'cloudflare';
    return servers;
  } catch (err) {
    relaySource = `cloudflare unavailable (${err?.name === 'AbortError' ? 'timeout' : err?.message ?? 'error'}) — using fallback`;
    return fallback;
  }
}

/** For tests. */
export function resetIceCache() {
  cache = null;
}
