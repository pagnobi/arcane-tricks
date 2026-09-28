import { Game } from '../game/Game.js';
import { chooseBid, chooseCard, chooseTrumpSuit } from '../game/bots.js';
import { SUITS, shuffle } from '../game/cards.js';
import { DEFAULT_LOOK, randomLook, sanitizeLook } from '../game/looks.js';
import { toViewSeat, viewFor } from '../game/views.js';
import { BOT_NAMES } from '../config.js';
import { Emitter } from '../net/Emitter.js';
import { EMOTES, HOST_GAME_TIMEOUT_MS, NAME_MAX, PROTOCOL_VERSION, REJOIN_GRACE_MS, sanitizeName } from '../net/protocol.js';

export class Aborted extends Error {}

const sleep = (seconds) => new Promise((resolve) => setTimeout(resolve, seconds * 1000));
const MAX_PLAYERS = 6;

/**
 * The authoritative table. Runs the Game, asks each seat for its decisions and tells every
 * player what happened — each through their own filtered, re-indexed view (see views.js).
 *
 * Seats:  local  = the person at this browser (decides via the local presenter)
 *         remote = a player connected over the network (decides via prompt/answer messages)
 *         bot    = decided by src/game/bots.js; also stands in for a remote player who dropped
 *
 * Solo play is simply a TableHost with no network.
 *
 * Events (always in the receiving player's seat numbering, with that player's `view`):
 *   game · round · turn · trumpChosen · bid · bidsDone · play · trick · roundEnd · gameEnd
 *   presence (someone connected/dropped) · snapshot (rejoin: redraw everything)
 */
export class TableHost extends Emitter {
  constructor({ presenter, net = null, hostName = 'You', hostLook = DEFAULT_LOOK, settings, rng = Math.random, pause = sleep, graceMs = REJOIN_GRACE_MS }) {
    super();
    this.presenter = presenter;
    this.net = net;
    this.settings = { ...settings };
    this.rng = rng;
    this.pause = pause;
    this.graceMs = graceMs;
    this.seats = [{ kind: 'local', name: sanitizeName(hostName) || 'Host', look: sanitizeLook(hostLook), connected: true }];
    this.started = false;
    this.aborted = false;
    this.autoplay = false; // dev/testing: bots decide for the local player too
    this.game = null;
    this.code = null;
    this.promptSeq = 0;
    this.lastEmote = new Map();
  }

  get multiplayer() {
    return !!this.net;
  }

  get speed() {
    return this.settings.fastBots ? 0.45 : 1;
  }

  // ───────────────────────── lobby ─────────────────────────

  /** Open an online room. Resolves with the room code. */
  async openRoom(preferredCode = null) {
    this.code = await this.net.open(preferredCode);
    this.net.on('message', (connId, msg) => this.#onMessage(connId, msg));
    this.net.on('disconnect', (connId) => this.#onDisconnect(connId));
    return this.code;
  }

  lobbyInfo(viewerSeat = 0) {
    return {
      code: this.code,
      settings: { ...this.settings },
      yourSeat: viewerSeat,
      seats: this.seats.map((s) => ({ name: s.name, kind: s.kind, connected: s.connected })),
    };
  }

  updateSettings(settings) {
    this.settings = { ...this.settings, ...settings };
    this.#lobbyChanged();
  }

  #lobbyChanged() {
    this.emit('lobby', this.lobbyInfo(0));
    this.seats.forEach((s, i) => {
      if (s.kind === 'remote' && s.connected) this.net.send(s.connId, { type: 'lobby', ...this.lobbyInfo(i) });
    });
  }

  #seatOfConn(connId) {
    return this.seats.findIndex((s) => s.kind === 'remote' && s.connId === connId && s.connected);
  }

  #onMessage(connId, msg) {
    if (!msg || typeof msg !== 'object') return;
    if (msg.type === 'hello') return this.#onHello(connId, msg);
    const seat = this.#seatOfConn(connId);
    if (seat < 0) return;
    const s = this.seats[seat];
    switch (msg.type) {
      case 'answer':
        if (s.pending && msg.id === s.pending.id) s.pending.offer(msg.value);
        break;
      case 'pose':
        this.#relayPose(seat, msg.pose);
        break;
      case 'emote':
        this.#relayEmote(seat, msg.emote);
        break;
      case 'leave':
        s.leftOnPurpose = true;
        this.net.disconnect(connId);
        break;
    }
  }

  #onHello(connId, msg) {
    if (msg.version !== PROTOCOL_VERSION) {
      this.net.send(connId, { type: 'rejected', reason: 'version' });
      return;
    }
    const returning = this.seats.find((s) => s.kind === 'remote' && s.clientId === msg.clientId);
    if (returning) {
      returning.connId = connId;
      returning.connected = true;
      returning.leftOnPurpose = false;
      if (this.started) {
        const seat = this.seats.indexOf(returning);
        this.net.send(connId, { type: 'event', event: this.#snapshotFor(seat) });
        returning.pending?.reconnected();
        if (returning.pending) this.#sendPrompt(seat);
        this.#presence();
      } else {
        this.#lobbyChanged();
      }
      return;
    }
    if (this.started) {
      this.net.send(connId, { type: 'rejected', reason: 'started' });
      return;
    }
    if (this.seats.length >= MAX_PLAYERS) {
      this.net.send(connId, { type: 'rejected', reason: 'full' });
      return;
    }
    const name = this.#uniqueName(sanitizeName(msg.name) || 'Guest');
    this.seats.push({ kind: 'remote', name, look: sanitizeLook(msg.look), clientId: String(msg.clientId), connId, connected: true });
    this.settings.numPlayers = Math.max(this.settings.numPlayers, this.seats.length);
    this.#lobbyChanged();
  }

  /** Two players with the same name get numbered: "Amber Owl", "Amber Owl 2". */
  #uniqueName(name) {
    const taken = new Set(this.seats.map((s) => s.name));
    if (!taken.has(name)) return name;
    for (let k = 2; ; k++) {
      const candidate = `${name.slice(0, NAME_MAX - 2).trim()} ${k}`;
      if (!taken.has(candidate)) return candidate;
    }
  }

  #onDisconnect(connId) {
    const seat = this.seats.findIndex((s) => s.kind === 'remote' && s.connId === connId);
    if (seat < 0) return;
    const s = this.seats[seat];
    if (!this.started) {
      this.seats.splice(seat, 1);
      this.#lobbyChanged();
      return;
    }
    s.connected = false;
    s.connId = null;
    s.disconnectedAt = s.leftOnPurpose ? -Infinity : Date.now();
    s.pending?.disconnected();
    this.#presence();
  }

  // ───────────────────────── game loop ─────────────────────────

  async start() {
    const humans = this.seats.length;
    const n = Math.min(MAX_PLAYERS, Math.max(this.settings.numPlayers, humans, 3));
    const taken = new Set(this.seats.map((s) => s.name));
    const botNames = shuffle(BOT_NAMES.filter((name) => !taken.has(name)), this.rng);
    while (this.seats.length < n) {
      this.seats.push({ kind: 'bot', name: botNames.pop() ?? `Bot ${this.seats.length}`, look: randomLook(this.rng), connected: true });
    }

    this.started = true;
    // Lobby tolerates long silences (people off sharing the code); mid-game, notice drops sooner.
    if (this.net && 'idleTimeoutMs' in this.net) this.net.idleTimeoutMs = HOST_GAME_TIMEOUT_MS;
    this.game = new Game({
      players: this.seats.map((s) => ({ name: s.name })),
      variants: {
        dealerRestriction: this.settings.dealerRestriction,
        blindBids: this.settings.blindBids,
        foreheadFirstRound: this.settings.foreheadFirstRound,
        shortGame: this.settings.shortGame,
      },
      rng: this.rng,
      firstDealer: Math.floor(this.rng() * n),
    });
    await this.#emit((viewer) => ({ type: 'game', view: this.#view(viewer), ...this.#gameMeta() }));
    while (this.game.phase !== 'gameOver') await this.#round();
    await this.#emit((viewer) => ({ type: 'gameEnd', view: this.#view(viewer) }));
  }

  /** Stop the game (host quit). Clients are told the table closed. */
  abort() {
    this.aborted = true;
    this.presenter.cancelPrompts?.(new Aborted());
    for (const s of this.seats) {
      s.pending?.cancel();
      if (s.kind === 'remote' && s.connected) this.net.send(s.connId, { type: 'closed' });
    }
  }

  #check() {
    if (this.aborted) throw new Aborted();
  }

  #gameMeta() {
    return { multiplayer: this.multiplayer, speed: this.speed, code: this.code };
  }

  #view(viewer) {
    return viewFor(this.game, viewer, this.seats);
  }

  #rot(seat, viewer) {
    return toViewSeat(seat, viewer, this.seats.length);
  }

  /** Send an event to every human seat (built per viewer) and wait for the local table to show it. */
  async #emit(build) {
    this.#check();
    let local = null;
    this.seats.forEach((s, viewer) => {
      if (s.kind === 'remote' && s.connected) this.net.send(s.connId, { type: 'event', event: build(viewer) });
      if (s.kind === 'local') local = build(viewer);
    });
    if (local) await this.presenter.handle(local);
    this.#check();
  }

  #snapshotFor(viewer) {
    return { type: 'snapshot', view: this.#view(viewer), ...this.#gameMeta() };
  }

  #presence() {
    this.#emit((viewer) => ({ type: 'presence', view: this.#view(viewer) })).catch(() => {});
  }

  async #round() {
    const game = this.game;
    game.startRound();
    await this.#emit((v) => ({ type: 'round', view: this.#view(v) }));

    if (game.phase === 'chooseTrump') {
      const dealer = game.dealer;
      await this.#emit((v) => ({ type: 'turn', seat: this.#rot(dealer, v), kind: 'trump', view: this.#view(v) }));
      const suit = await this.#decide(dealer, 'trump', {});
      game.chooseTrump(suit);
      await this.#emit((v) => ({ type: 'trumpChosen', seat: this.#rot(dealer, v), suit, view: this.#view(v) }));
    }

    while (game.phase === 'bidding') {
      const seat = game.turn;
      await this.#emit((v) => ({ type: 'turn', seat: this.#rot(seat, v), kind: 'bid', view: this.#view(v) }));
      const bid = await this.#decide(seat, 'bid', { allowed: game.allowedBidsFor(seat), round: game.round });
      game.placeBid(seat, bid);
      await this.#emit((v) => ({ type: 'bid', seat: this.#rot(seat, v), view: this.#view(v) }));
    }
    await this.#emit((v) => ({ type: 'bidsDone', view: this.#view(v) }));

    while (game.phase === 'playing') {
      const seat = game.turn;
      await this.#emit((v) => ({ type: 'turn', seat: this.#rot(seat, v), kind: 'play', view: this.#view(v) }));
      const legal = game.legalMovesFor(seat).map((c) => c.id);
      // Forehead round: you mustn't learn your own card, not even from the prompt — send a placeholder.
      const hidden = game.isForeheadRound;
      const answer = await this.#decide(seat, 'play', { legal: hidden ? ['?'] : legal });
      const cardId = answer === '?' ? legal[0] : answer;
      const order = game.trick.length;
      const result = game.playCard(seat, cardId);
      await this.#emit((v) => ({ type: 'play', seat: this.#rot(seat, v), card: result.card, order, view: this.#view(v) }));
      if (result.trickComplete) {
        await this.#emit((v) => ({
          type: 'trick',
          winner: this.#rot(result.winner, v),
          plays: result.plays.map((p) => ({ player: this.#rot(p.player, v), card: p.card })),
          view: this.#view(v),
        }));
      }
    }
    await this.#emit((v) => ({ type: 'roundEnd', view: this.#view(v) }));
  }

  // ───────────────────────── decisions ─────────────────────────

  #botDecision(seat, kind) {
    const game = this.game;
    if (kind === 'trump') return chooseTrumpSuit(game.players[seat].hand);
    if (kind === 'bid') return chooseBid(game, seat);
    return chooseCard(game, seat).id;
  }

  async #decide(seat, kind, data) {
    const s = this.seats[seat];
    let value;
    if (s.kind === 'bot' || (s.kind === 'local' && this.autoplay)) {
      await this.pause((kind === 'trump' ? 1.1 : 0.7) * this.speed);
      value = this.#botDecision(seat, kind);
    } else if (s.kind === 'local') {
      value = await this.presenter.prompt(kind, data);
    } else {
      value = await this.#remoteDecision(seat, kind, data);
    }
    this.#check();
    return value;
  }

  #valid(kind, data, value) {
    if (kind === 'trump') return SUITS.includes(value);
    if (kind === 'bid') return data.allowed.includes(value);
    return data.legal.includes(value);
  }

  /**
   * Ask a remote player. If they're disconnected, wait out the rejoin grace period and then let a
   * bot decide for them (a player who left on purpose is replaced straight away).
   */
  #remoteDecision(seat, kind, data) {
    const s = this.seats[seat];
    return new Promise((resolve, reject) => {
      let timer = null;
      const finish = (value) => {
        clearTimeout(timer);
        s.pending = null;
        resolve(value);
      };
      const botTakeover = async () => {
        clearTimeout(timer);
        s.pending = null;
        await this.pause(0.7 * this.speed);
        resolve(this.#botDecision(seat, kind));
      };
      const armFallback = () => {
        clearTimeout(timer);
        const waited = Date.now() - (s.disconnectedAt ?? Date.now());
        timer = setTimeout(botTakeover, Math.max(0, this.graceMs - waited));
      };
      s.pending = {
        id: ++this.promptSeq,
        kind,
        data,
        offer: (value) => {
          if (this.#valid(kind, data, value)) finish(value);
          else this.#sendPrompt(seat); // stale or tampered answer — ask again
        },
        disconnected: armFallback,
        reconnected: () => clearTimeout(timer),
        cancel: () => {
          clearTimeout(timer);
          s.pending = null;
          reject(new Aborted());
        },
      };
      if (s.connected) this.#sendPrompt(seat);
      else armFallback();
    });
  }

  #sendPrompt(seat) {
    const s = this.seats[seat];
    if (!s.pending || !s.connected) return;
    const { id, kind, data } = s.pending;
    this.net.send(s.connId, { type: 'prompt', id, kind, data });
  }

  // ───────────────────────── presence: poses & emotes ─────────────────────────

  #relayPose(fromSeat, pose) {
    if (!this.started || !pose) return;
    this.seats.forEach((s, viewer) => {
      if (viewer === fromSeat) return;
      const seat = this.#rot(fromSeat, viewer);
      if (s.kind === 'remote' && s.connected) this.net.send(s.connId, { type: 'pose', seat, pose });
      if (s.kind === 'local') this.presenter.pose?.(seat, pose);
    });
  }

  #relayEmote(fromSeat, emote) {
    if (!EMOTES.includes(emote)) return;
    const now = Date.now();
    if (now - (this.lastEmote.get(fromSeat) ?? 0) < 1500) return; // no spamming
    this.lastEmote.set(fromSeat, now);
    this.seats.forEach((s, viewer) => {
      const seat = this.#rot(fromSeat, viewer);
      if (s.kind === 'remote' && s.connected) this.net.send(s.connId, { type: 'emote', seat, emote });
      if (s.kind === 'local') this.presenter.emote?.(seat, emote);
    });
  }

  /** The host's own head/hands and emotes. */
  sendLocalPose(pose) {
    this.#relayPose(0, pose);
  }

  sendLocalEmote(emote) {
    this.#relayEmote(0, emote);
  }
}
