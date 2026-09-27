import { Emitter } from './Emitter.js';
import { makeRoomCode } from './protocol.js';

// In-memory stand-in for PeerNet with the same interface — used by tests to run whole online games
// without a browser or network. Messages are JSON round-tripped and delivered asynchronously, like
// the real thing.

const clone = (msg) => JSON.parse(JSON.stringify(msg));

export class LoopbackHub {
  constructor() {
    this.hosts = new Map();
  }

  createHost() {
    return new LoopbackHost(this);
  }

  createClient() {
    return new LoopbackClient(this);
  }
}

class LoopbackHost extends Emitter {
  constructor(hub) {
    super();
    this.hub = hub;
    this.clients = new Map();
    this.nextId = 1;
    this.code = null;
  }

  async open(code = null) {
    code ??= makeRoomCode();
    this.code = code;
    this.hub.hosts.set(code, this);
    return code;
  }

  send(connId, msg) {
    const client = this.clients.get(connId);
    if (!client) return;
    const data = clone(msg);
    queueMicrotask(() => client.emit('message', data));
  }

  disconnect(connId) {
    const client = this.clients.get(connId);
    if (!client) return;
    this.clients.delete(connId);
    queueMicrotask(() => {
      this.emit('disconnect', connId);
      client.emit('disconnect');
    });
  }

  close() {
    this.hub.hosts.delete(this.code);
    for (const id of [...this.clients.keys()]) this.disconnect(id);
  }
}

class LoopbackClient extends Emitter {
  constructor(hub) {
    super();
    this.hub = hub;
    this.host = null;
    this.connId = null;
  }

  async connect(code) {
    const host = this.hub.hosts.get(code);
    if (!host) throw new Error('not-found');
    this.host = host;
    this.connId = host.nextId++;
    host.clients.set(this.connId, this);
    host.emit('connect', this.connId);
  }

  send(msg) {
    if (!this.host?.clients.has(this.connId)) return;
    const data = clone(msg);
    const { host, connId } = this;
    queueMicrotask(() => host.emit('message', connId, data));
  }

  /** Test helper: simulate the network dropping. */
  drop() {
    this.host?.disconnect(this.connId);
  }

  close() {
    this.drop();
  }
}
