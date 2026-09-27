import { Emitter } from '../net/Emitter.js';
import { PROTOCOL_VERSION } from '../net/protocol.js';

const RECONNECT_EVERY_MS = 3000;
const RECONNECT_FOR_MS = 90000;

/**
 * A player at someone else's table. Shows the host's events through the presenter, answers the
 * host's prompts, and — if the connection drops — keeps retrying with the same clientId so the host
 * gives this player their seat (and hand) back.
 *
 * Emits: lobby(info) · started · rejected(reason) · closed · reconnecting · reconnected · lost · ended
 */
export class ClientSession extends Emitter {
  constructor({ createNet, presenter, clientId, name, reconnectEveryMs = RECONNECT_EVERY_MS }) {
    super();
    this.createNet = createNet;
    this.reconnectEveryMs = reconnectEveryMs;
    this.presenter = presenter;
    this.clientId = clientId;
    this.name = name;
    this.net = null;
    this.code = null;
    this.promptId = null;
    this.closed = false;
    this.finished = false; // game over — the host going away now is expected
  }

  async join(code) {
    this.code = code;
    await this.#connect();
  }

  async #connect() {
    const net = this.createNet();
    await net.connect(this.code);
    this.net = net;
    net.on('message', (msg) => this.#onMessage(msg));
    net.on('disconnect', () => this.#onLost(net));
    net.send({ type: 'hello', clientId: this.clientId, name: this.name, version: PROTOCOL_VERSION });
  }

  #onMessage(msg) {
    if (!msg || typeof msg !== 'object' || this.closed) return;
    switch (msg.type) {
      case 'lobby':
        this.emit('lobby', msg);
        break;
      case 'rejected':
        this.closed = true;
        this.emit('rejected', msg.reason);
        break;
      case 'closed':
        this.closed = true;
        if (!this.finished) this.emit('closed'); // after game over the host leaving is expected
        break;
      case 'event':
        if (msg.event?.type === 'game' || msg.event?.type === 'snapshot') this.emit('started');
        if (msg.event?.type === 'gameEnd') this.finished = true;
        if (msg.event?.type === 'snapshot' && this.promptId !== null) {
          // Reconnected mid-decision: drop the stale prompt; the host re-sends it.
          this.presenter.cancelPrompts?.();
          this.promptId = null;
        }
        this.presenter.handle(msg.event).then(
          () => msg.event?.type === 'gameEnd' && this.emit('ended'),
          () => {},
        );
        break;
      case 'prompt':
        this.#onPrompt(msg);
        break;
      case 'pose':
        this.presenter.pose?.(msg.seat, msg.pose);
        break;
      case 'emote':
        this.presenter.emote?.(msg.seat, msg.emote);
        break;
    }
  }

  #onPrompt({ id, kind, data }) {
    if (id === this.promptId) return; // already asking
    if (this.promptId !== null) this.presenter.cancelPrompts?.();
    this.promptId = id;
    this.presenter.prompt(kind, data).then(
      (value) => {
        if (this.promptId !== id) return;
        this.promptId = null;
        this.net?.send({ type: 'answer', id, value });
      },
      () => {
        if (this.promptId === id) this.promptId = null;
      },
    );
  }

  async #onLost(net) {
    if (this.closed || this.finished || net !== this.net) return;
    this.net = null;
    this.emit('reconnecting');
    const giveUpAt = Date.now() + RECONNECT_FOR_MS;
    while (!this.closed && Date.now() < giveUpAt) {
      await new Promise((r) => setTimeout(r, this.reconnectEveryMs));
      if (this.closed) return;
      try {
        await this.#connect();
        this.emit('reconnected');
        return;
      } catch {
        // host not reachable yet — keep trying
      }
    }
    if (!this.closed) {
      this.closed = true;
      this.emit('lost');
    }
  }

  sendPose(pose) {
    this.net?.send({ type: 'pose', pose });
  }

  sendEmote(emote) {
    this.net?.send({ type: 'emote', emote });
  }

  leave() {
    this.closed = true;
    this.net?.send({ type: 'leave' });
    const net = this.net;
    this.net = null;
    setTimeout(() => net?.close(), 200); // let the goodbye go out first
  }
}
