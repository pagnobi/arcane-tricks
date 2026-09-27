import Peer from 'peerjs';
import { Emitter } from './Emitter.js';
import {
  BROKER_TIMEOUT_MS,
  CLIENT_TIMEOUT_MS,
  CONNECT_TIMEOUT_MS,
  HEARTBEAT_MS,
  HOST_LOBBY_TIMEOUT_MS,
  PEER_PREFIX,
  makeRoomCode,
} from './protocol.js';

// WebRTC transport via PeerJS. The room code *is* the host's peer id (prefixed), so joining a
// table just means connecting to that id. PeerJS's free public broker (0.peerjs.com) is only used
// to introduce the browsers; game traffic then flows directly between them.
//
// Guests ping the host every couple of seconds and the host answers immediately, so a vanished
// player (closed laptop, lost Wi-Fi) is noticed even when WebRTC doesn't report the close.

// STUN servers help each browser discover a public address so the two can connect directly.
// When a network blocks direct connections, traffic must go through a TURN relay instead: PeerJS's
// free community relay is listed as a last resort, but it's often overloaded. For reliable play
// across strict networks, add your own TURN server here (see README → "Connection problems").
const ICE_SERVERS = [
  { urls: ['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302', 'stun:stun2.l.google.com:19302'] },
  { urls: 'stun:stun.cloudflare.com:3478' },
  { urls: ['turn:eu-0.turn.peerjs.com:3478', 'turn:us-0.turn.peerjs.com:3478'], username: 'peerjs', credential: 'peerjsp' },
];
const PEER_OPTIONS = { debug: 1, config: { iceServers: ICE_SERVERS } };

/** Wait for a Peer to register with the broker, but not forever. */
function waitForOpen(peer) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject({ type: 'broker-timeout' }), BROKER_TIMEOUT_MS);
    peer.once('open', () => {
      clearTimeout(timer);
      resolve();
    });
    peer.once('error', (err) => {
      clearTimeout(timer);
      reject(err);
    });
  });
}

function brokerError(err) {
  const offline = ['network', 'server-error', 'socket-error', 'socket-closed', 'broker-timeout'];
  return new Error(offline.includes(err?.type) ? 'offline' : err?.type || 'peer-error');
}

export class PeerHost extends Emitter {
  constructor() {
    super();
    this.conns = new Map(); // connId → { conn, lastSeen, open }
    this.nextId = 1;
    this.peer = null;
    this.code = null;
    this.idleTimeoutMs = HOST_LOBBY_TIMEOUT_MS; // TableHost shortens this once the game starts
  }

  /** Claim a room code (retrying if it's taken). Resolves with the code. */
  async open(preferred = null) {
    for (let attempt = 0; attempt < 5; attempt++) {
      const code = attempt === 0 && preferred ? preferred : makeRoomCode();
      const peer = new Peer(PEER_PREFIX + code, PEER_OPTIONS);
      try {
        await waitForOpen(peer);
      } catch (err) {
        peer.destroy();
        if (err?.type === 'unavailable-id') continue; // someone else has this code
        throw brokerError(err);
      }
      this.peer = peer;
      this.code = code;
      peer.on('connection', (conn) => this.#accept(conn));
      // Lost the broker (not the players): reconnect so new and returning players can still find us.
      peer.on('disconnected', () => {
        if (!peer.destroyed) peer.reconnect();
      });
      this.heartbeat = setInterval(() => this.#dropIdle(), HEARTBEAT_MS);
      return code;
    }
    throw new Error('no-code');
  }

  #accept(conn) {
    const id = this.nextId++;
    const entry = { conn, lastSeen: Date.now(), open: false };
    this.conns.set(id, entry);
    conn.on('open', () => {
      entry.open = true;
      entry.lastSeen = Date.now();
      this.emit('connect', id);
    });
    conn.on('data', (msg) => {
      entry.lastSeen = Date.now();
      // Answer pings from the data handler itself, not a timer — timers barely run in a
      // background tab, but this keeps guests connected while the host is off sharing the code.
      if (msg?.type === 'ping') this.send(id, { type: 'pong' });
      else this.emit('message', id, msg);
    });
    conn.on('close', () => this.#drop(id));
    conn.on('error', () => this.#drop(id));
  }

  #drop(id) {
    const entry = this.conns.get(id);
    if (!entry) return;
    this.conns.delete(id);
    try {
      entry.conn.close();
    } catch {
      // already closed
    }
    if (entry.open) this.emit('disconnect', id);
  }

  #dropIdle() {
    const now = Date.now();
    for (const [id, entry] of this.conns) {
      const limit = entry.open ? this.idleTimeoutMs : CONNECT_TIMEOUT_MS * 2;
      if (now - entry.lastSeen > limit) this.#drop(id);
    }
  }

  send(connId, msg) {
    const entry = this.conns.get(connId);
    if (entry?.open) entry.conn.send(msg);
  }

  disconnect(connId) {
    this.#drop(connId);
  }

  close() {
    clearInterval(this.heartbeat);
    for (const id of [...this.conns.keys()]) this.#drop(id);
    this.peer?.destroy();
  }
}

export class PeerClient extends Emitter {
  constructor() {
    super();
    this.peer = null;
    this.conn = null;
    this.lastSeen = 0;
  }

  /**
   * Connect to a room. `onStage('broker' | 'host')` reports progress. Rejects with:
   *   offline               – couldn't reach the matchmaking service
   *   not-found             – no table with that code
   *   no-direct-connection  – found the table, but the two networks couldn't connect
   */
  async connect(code, onStage = () => {}) {
    onStage('broker');
    const peer = new Peer(PEER_OPTIONS);
    this.peer = peer;
    try {
      await waitForOpen(peer);
    } catch (err) {
      throw brokerError(err);
    }
    onStage('host');
    await new Promise((resolve, reject) => {
      const conn = peer.connect(PEER_PREFIX + code, { reliable: true, serialization: 'json' });
      let settled = false;
      const fail = (reason) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        reject(new Error(reason));
      };
      const timer = setTimeout(() => fail('no-direct-connection'), CONNECT_TIMEOUT_MS);
      peer.once('error', (err) => fail(err?.type === 'peer-unavailable' ? 'not-found' : err?.type || 'peer-error'));
      // PeerJS reports a failed WebRTC negotiation on the connection, not the peer.
      conn.once('error', () => fail('no-direct-connection'));
      conn.on('open', () => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        this.conn = conn;
        resolve();
      });
      conn.on('data', (msg) => {
        this.lastSeen = Date.now();
        if (msg?.type !== 'pong' && msg?.type !== 'ping') this.emit('message', msg);
      });
      conn.on('close', () => this.#lost());
      conn.on('error', () => this.#lost());
    });
    this.lastSeen = Date.now();
    this.heartbeat = setInterval(() => {
      if (Date.now() - this.lastSeen > CLIENT_TIMEOUT_MS) this.#lost();
      else this.send({ type: 'ping' });
    }, HEARTBEAT_MS);
  }

  #lost() {
    if (!this.conn) return;
    this.conn = null;
    clearInterval(this.heartbeat);
    this.emit('disconnect');
  }

  send(msg) {
    if (this.conn?.open) this.conn.send(msg);
  }

  close() {
    clearInterval(this.heartbeat);
    const conn = this.conn;
    this.conn = null;
    try {
      conn?.close();
    } catch {
      // already closed
    }
    this.peer?.destroy();
  }
}
