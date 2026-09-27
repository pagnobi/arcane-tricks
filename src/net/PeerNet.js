import Peer from 'peerjs';
import { Emitter } from './Emitter.js';
import { HEARTBEAT_MS, PEER_PREFIX, TIMEOUT_MS, makeRoomCode } from './protocol.js';

// WebRTC transport via PeerJS. The room code *is* the host's peer id (prefixed), so joining a
// table just means connecting to that id. PeerJS's free public broker (0.peerjs.com) is only used
// to introduce the browsers; game traffic then flows directly between them.
//
// Both sides send a heartbeat so a vanished player (closed laptop, lost Wi-Fi) is noticed within
// a few seconds even when WebRTC doesn't report the close.

const PEER_OPTIONS = { debug: 1 };

function waitForOpen(peer) {
  return new Promise((resolve, reject) => {
    peer.once('open', resolve);
    peer.once('error', reject);
  });
}

export class PeerHost extends Emitter {
  constructor() {
    super();
    this.conns = new Map(); // connId → { conn, lastSeen }
    this.nextId = 1;
    this.peer = null;
    this.code = null;
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
        throw new Error(err?.type === 'network' || err?.type === 'server-error' ? 'offline' : err?.type || 'peer-error');
      }
      this.peer = peer;
      this.code = code;
      peer.on('connection', (conn) => this.#accept(conn));
      // Lost the broker (not the players): reconnect so dropped players can rejoin.
      peer.on('disconnected', () => {
        if (!peer.destroyed) peer.reconnect();
      });
      this.heartbeat = setInterval(() => this.#tick(), HEARTBEAT_MS);
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
      if (msg?.type !== 'ping') this.emit('message', id, msg);
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

  #tick() {
    const now = Date.now();
    for (const [id, entry] of this.conns) {
      if (!entry.open) continue;
      if (now - entry.lastSeen > TIMEOUT_MS) this.#drop(id);
      else this.send(id, { type: 'ping' });
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

  /** Connect to a room. Rejects with Error('not-found') if there's no such table. */
  async connect(code) {
    const peer = new Peer(PEER_OPTIONS);
    this.peer = peer;
    try {
      await waitForOpen(peer);
    } catch (err) {
      throw new Error(err?.type === 'network' || err?.type === 'server-error' ? 'offline' : err?.type || 'peer-error');
    }
    await new Promise((resolve, reject) => {
      const conn = peer.connect(PEER_PREFIX + code, { reliable: true, serialization: 'json' });
      const timer = setTimeout(() => reject(new Error('timeout')), 15000);
      peer.once('error', (err) => {
        clearTimeout(timer);
        reject(new Error(err?.type === 'peer-unavailable' ? 'not-found' : err?.type || 'peer-error'));
      });
      conn.on('open', () => {
        clearTimeout(timer);
        this.conn = conn;
        resolve();
      });
      conn.on('data', (msg) => {
        this.lastSeen = Date.now();
        if (msg?.type !== 'ping') this.emit('message', msg);
      });
      conn.on('close', () => this.#lost());
      conn.on('error', () => this.#lost());
    });
    this.lastSeen = Date.now();
    this.heartbeat = setInterval(() => {
      if (Date.now() - this.lastSeen > TIMEOUT_MS) this.#lost();
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
