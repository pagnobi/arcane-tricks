import { TableView } from '../game/views.js';
import { TABLE_CENTER, seatPosition } from '../scene/layout.js';
import { Aborted } from './TableHost.js';

const sleep = (seconds) => new Promise((resolve) => setTimeout(resolve, seconds * 1000));

/**
 * Shows one player's table: turns TableHost events into animations, sounds and UI, and turns
 * prompts into bids / card picks. The same code runs for the host, for online guests and in solo
 * play — it only ever sees a view where "you" are seat 0.
 *
 * Events are processed strictly in order through a queue, so a prompt never appears before the
 * animations that lead up to it have finished.
 */
export class Presenter {
  constructor({ cards, avatars, hud, sound }) {
    this.cards = cards;
    this.avatars = avatars;
    this.hud = hud;
    this.sound = sound;
    this.role = 'host'; // 'host' | 'guest' — guests don't control round advancing
    this.view = null;
    this.speed = 1;
    this.multiplayer = false;
    this.queue = Promise.resolve();
    this.aborted = false;
    this.pendingPick = null;
  }

  /** Start fresh for a new table. */
  reset(role) {
    this.role = role;
    this.view = null;
    this.aborted = false;
    this.queue = Promise.resolve();
  }

  handle(event) {
    const run = this.queue.then(() => this.#handle(event));
    this.queue = run.catch(() => {});
    return run;
  }

  prompt(kind, data) {
    const run = this.queue.then(() => this.#prompt(kind, data));
    this.queue = run.catch(() => {});
    return run;
  }

  cancelPrompts(error = new Aborted()) {
    this.hud.cancelPrompts(error);
    this.pendingPick?.(error);
    this.pendingPick = null;
    this.cards.clearSelectable();
  }

  abort() {
    this.aborted = true;
    this.cancelPrompts();
  }

  pose(seat, pose) {
    this.avatars.setPose(seat, pose);
  }

  emote(seat, emote) {
    if (seat !== 0) this.avatars.emote(seat, emote);
    this.sound?.play('click', seat === 0 ? null : seatPosition(seat, this.view?.numPlayers ?? 3).setY(1.3), { volume: 0.6, rate: 1.4 });
  }

  // ───────────────────────── helpers ─────────────────────────

  #check() {
    if (this.aborted) throw new Aborted();
  }

  async #pause(seconds) {
    await sleep(seconds * this.speed);
    this.#check();
  }

  async #step(promise) {
    await promise;
    this.#check();
  }

  #seatSound(seat) {
    return seat === 0 ? null : seatPosition(seat, this.view.numPlayers).setY(1.2);
  }

  /**
   * Redraw nameplates and the status board. `opts.tricks` overrides the "Won" counts shown;
   * otherwise they're the view's, minus the trick held back for `opts.heldTrick`.
   */
  #refresh(opts = {}) {
    const hideBids = this.view.variants.blindBids && this.view.phase === 'bidding';
    if (!opts.tricks) opts = { ...opts, tricks: this.view.players.map((p, i) => p.tricks - (opts.heldTrick === i ? 1 : 0)) };
    this.shownTricks = opts.tricks;
    this.avatars.refresh(this.view, opts);
    this.hud.setStatus(this.view, { ...opts, hideBids });
  }

  // ───────────────────────── events ─────────────────────────

  async #handle(event) {
    this.#check();
    if (event.view) this.view = new TableView(event.view);
    const view = this.view;
    switch (event.type) {
      case 'game':
      case 'snapshot':
        this.speed = event.speed ?? 1;
        this.multiplayer = !!event.multiplayer;
        this.avatars.setup(view, { multiplayer: this.multiplayer });
        this.hud.showGameUi(view, { multiplayer: this.multiplayer, code: event.code });
        if (event.type === 'snapshot') {
          this.hud.closeInfo();
          this.cards.restore(view);
        }
        this.#refresh();
        break;

      case 'presence':
        this.#refresh();
        break;

      case 'round':
        this.hud.closeInfo();
        this.#refresh();
        this.cards.prepareRound();
        this.sound?.play('shuffle', TABLE_CENTER);
        await this.#step(this.cards.deal(view, this.speed));
        await this.#step(this.cards.revealTrump(view));
        if (!view.trumpCard) await this.#pause(1.4); // last round: every card is dealt, so no trump
        break;

      case 'turn':
        this.#refresh({ thinking: event.seat === 0 ? null : event.seat });
        break;

      case 'trumpChosen':
        this.#refresh();
        await this.#step(this.cards.layoutHand(view, 0)); // re-sort with trump first
        await this.#pause(0.8);
        break;

      case 'bid':
        this.#refresh();
        break;

      case 'bidsDone':
        this.#refresh();
        await this.#pause(view.variants.blindBids ? 1.8 : 1.2); // a moment to take in the bids
        break;

      case 'play':
        // The last card of a trick arrives with the trick already counted: keep showing the old
        // counts until the cards are swept to the winner (see 'trick').
        if (event.order === view.numPlayers - 1 && this.shownTricks) this.#refresh({ tricks: this.shownTricks });
        else this.#refresh();
        await this.#step(this.cards.playToTrick(view, event.seat, event.card, event.order));
        break;

      case 'trick': {
        this.cards.glowTrickCard(event.winner);
        this.sound?.play(event.winner === 0 ? 'win' : 'trick', this.#seatSound(event.winner));
        // Hold the winner's old "Won" count until the cards sweep to them, then count it up.
        this.#refresh({ winner: event.winner, heldTrick: event.winner });
        await this.#pause(1.4);
        this.#refresh({ winner: event.winner });
        await this.#step(this.cards.collectTrick(event.winner, view.numPlayers));
        this.#refresh();
        break;
      }

      case 'roundEnd': {
        this.#refresh();
        const mine = view.history[view.history.length - 1].results[0].delta;
        const final = view.phase === 'gameOver';
        if (!final) {
          this.sound?.play(mine > 0 ? 'good' : 'bad');
          if (this.role === 'host') await this.hud.showSummary(view, { final: false });
          else this.hud.showSummary(view, { final: false, waiting: true });
        }
        this.#check();
        await this.#step(this.cards.gatherAll());
        break;
      }

      case 'gameEnd': {
        const [top] = view.standings();
        this.sound?.play(top.isHuman ? 'fanfare' : 'bad');
        await this.hud.showSummary(view, { final: true });
        break;
      }
    }
  }

  // ───────────────────────── your decisions ─────────────────────────

  async #prompt(kind, data) {
    this.#check();
    this.hud.setYourTurn(true);
    try {
      return await this.#ask(kind, data);
    } finally {
      this.hud.setYourTurn(false);
    }
  }

  #ask(kind, data) {
    this.#refresh();
    if (kind === 'trump') {
      this.sound?.play('turn');
      return this.hud.chooseTrump();
    }
    if (kind === 'bid') {
      this.sound?.play('turn');
      return this.hud.askBid(this.view, data.allowed);
    }
    return this.#pickCard(new Set(data.legal));
  }

  /** Light up the cards you may play and wait for a click on one. */
  #pickCard(legalIds) {
    this.sound?.play('turn', null, { volume: 0.6 });

    return new Promise((resolve, reject) => {
      this.pendingPick = reject;
      this.cards.setSelectable(legalIds, (cardId) => {
        this.pendingPick = null;
        this.cards.clearSelectable();
        resolve(cardId);
      });
    });
  }
}
