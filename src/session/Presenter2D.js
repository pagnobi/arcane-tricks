import { SUITS, SUIT_INFO, sortHand } from '../game/cards.js';
import { TableView } from '../game/views.js';
import { EMOTES } from '../net/protocol.js';
import { createCardBack, createCardFront } from '../scene/cardTextures.js';
import { Aborted } from './TableHost.js';
import '../ui/table2d.css';

const sleep = (seconds) => new Promise((resolve) => setTimeout(resolve, seconds * 1000));
const EMOTE_SECONDS = 3;

// Card pictures: the same art as the 3D cards, drawn once per card and kept as image URLs.
const art = new Map();
function cardArt(card) {
  const key = card ? card.id : 'back';
  if (!art.has(key)) {
    const texture = card ? createCardFront(card) : createCardBack();
    art.set(key, texture.image.toDataURL());
    texture.dispose();
  }
  return art.get(key);
}

function el(tag, className = '', text = '') {
  const e = document.createElement(tag);
  if (className) e.className = className;
  if (text) e.textContent = text;
  return e;
}

function button(label, onClick, className = '') {
  const b = el('button', className, label);
  b.addEventListener('click', onClick);
  return b;
}

function cardImg(card) {
  const img = el('img');
  img.src = cardArt(card);
  img.alt = card ? (card.kind === 'number' ? `${card.rank} of ${SUIT_INFO[card.suit].name}` : card.kind) : 'card';
  img.draggable = false;
  return img;
}

function suitBadge(suit) {
  const b = el('span', 't2d-badge');
  b.style.background = SUIT_INFO[suit].color;
  b.textContent = { flame: '🔥', tide: '🌊', grove: '🌿', sun: '☀️' }[suit];
  return b;
}

const signed = (n) => (n > 0 ? `+${n}` : String(n));

/**
 * The 2D table: a flat, touch-friendly screen with just the card game: other players' names,
 * bids, tricks and scores, the trick being played, the trump and your hand. Used on phones (or
 * when chosen in Options). It takes the same events and prompts as the 3D Presenter, so a phone
 * player can sit at the same online table as PC and VR players.
 *
 * Menus, Options and messages still come from the in-world Hud (drawn flat and large on the 3D
 * canvas underneath); this screen steps aside whenever one of those is open.
 */
export class Presenter2D {
  constructor({ hud, sound, world }) {
    this.hud = hud;
    this.sound = sound;
    this.role = 'host';
    this.view = null;
    this.speed = 1;
    this.multiplayer = false;
    this.queue = Promise.resolve();
    this.aborted = false;
    this.pending = null; // the prompt being answered: { reject, close }
    this.onGameEnd = null; // (view, { multiplayer }) → highlights (records stats)
    this.endChoice = null;
    this.onQuit = null;
    this.onEmote = null;
    this.tiles = [];
    this.shownTricks = null;
    this.#build();
    world.onUpdate(() => {
      const covered = hud.modal.mesh.visible || hud.options.mesh.visible;
      this.root.classList.toggle('behind', covered);
    });
  }

  // ───────────────────────── structure ─────────────────────────

  #build() {
    const root = (this.root = el('div', 't2d'));
    root.hidden = true;
    const top = el('header', 't2d-top');
    this.roundEl = el('div', 't2d-round');
    this.trumpEl = el('div', 't2d-trump');
    this.trumpCardEl = el('span', 't2d-trumpcard');
    this.emoteBtn = button('💬', () => this.#togglePop(this.emotePop));
    this.emoteBtn.title = 'Emotes';
    top.append(this.roundEl, this.trumpEl, this.emoteBtn, button('Menu', () => this.#togglePop(this.menuPop)));

    this.playersEl = el('section', 't2d-players');
    const trick = el('section', 't2d-trick');
    this.playsEl = el('div', 't2d-plays');
    trick.append(this.playsEl);

    this.meEl = el('section', 't2d-me');
    this.meBid = el('div', 't2d-bid');
    this.meScore = el('div', 't2d-score');
    this.hintEl = el('div', 't2d-hint');
    this.meBubble = el('div', 't2d-bubble');
    this.meBubble.hidden = true;
    this.meEl.append(this.meBid, this.meScore, this.hintEl, this.meBubble);

    this.handEl = el('section', 't2d-hand');
    this.sheet = el('div', 't2d-sheet');
    this.sheet.hidden = true;

    this.menuPop = el('div', 't2d-pop');
    this.menuPop.hidden = true;
    this.quitBtn = button('Quit', () => this.#quit());
    this.menuPop.append(
      button('Scores', () => {
        this.#closePops();
        this.#showScores();
      }),
      button('Options', () => {
        this.#closePops();
        this.hud.toggleOptions();
      }),
      this.quitBtn,
    );
    this.emotePop = el('div', 't2d-pop emotes');
    this.emotePop.hidden = true;
    for (const emote of EMOTES) {
      this.emotePop.append(
        button(emote, () => {
          this.#closePops();
          this.onEmote?.(emote);
        }),
      );
    }

    root.append(top, this.playersEl, trick, this.meEl, this.handEl, this.sheet, this.menuPop, this.emotePop);
    // Tapping anywhere else closes pop-ups, and lowers a lifted card.
    root.addEventListener('pointerdown', (e) => {
      if (!e.target.closest('.t2d-pop, .t2d-top button')) this.#closePops();
      if (!e.target.closest('.t2d-card')) this.#lift(null);
    });
    window.addEventListener('keydown', (e) => this.#onKey(e));
    window.addEventListener('resize', () => this.view && this.#renderHand());
    document.body.append(root);
  }

  #show() {
    this.root.hidden = false;
  }

  hide() {
    this.root.hidden = true;
    this.#closeSheet();
    this.#closePops();
    document.body.classList.remove('your-turn');
  }

  #togglePop(pop) {
    const open = pop.hidden;
    this.#closePops();
    pop.hidden = !open;
  }

  #closePops() {
    this.menuPop.hidden = true;
    this.emotePop.hidden = true;
    this.quitArmed = false;
    this.quitBtn.textContent = 'Quit';
  }

  #quit() {
    if (!this.quitArmed) {
      this.quitArmed = true;
      this.quitBtn.textContent = 'Sure? Tap again';
      return;
    }
    this.#closePops();
    this.onQuit?.();
  }

  // ───────────────────────── presenter interface (see Presenter) ─────────────────────────

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
    const pending = this.pending;
    this.pending = null;
    pending?.close();
    pending?.reject(error);
  }

  abort() {
    this.aborted = true;
    this.cancelPrompts();
    this.hide();
  }

  pose() {} // no wizards on the 2D table

  emote(seat, emote) {
    if (seat === 0) this.#bubble(0, emote, EMOTE_SECONDS);
    else this.#bubble(seat, emote, EMOTE_SECONDS);
    this.sound?.play('click', null, { volume: 0.6, rate: 1.4 });
  }

  /** After a game (host / solo): Rematch, Change rules or Back to menu. */
  askEndChoice() {
    this.#show();
    return this.#finalSheet([]);
  }

  // ───────────────────────── helpers ─────────────────────────

  #check() {
    if (this.aborted) throw new Aborted();
  }

  async #pause(seconds) {
    await sleep(seconds * this.speed);
    this.#check();
  }

  #name(seat) {
    return seat === 0 ? 'You' : this.view.players[seat].name;
  }

  /** Redraw names, bids, tricks and scores. `tricks` overrides the Won counts shown (see Presenter). */
  #refresh({ thinking = null, tricks = null, heldTrick = null } = {}) {
    const view = this.view;
    const shown = tricks ?? view.players.map((p, i) => p.tricks - (heldTrick === i ? 1 : 0));
    const before = this.shownTricks;
    this.shownTricks = shown;
    this.roundEl.textContent = `Round ${view.round}/${view.totalRounds}`;
    this.trumpEl.replaceChildren(this.trumpCardEl);
    if (view.trumpSuit) this.trumpEl.append(suitBadge(view.trumpSuit), el('span', '', SUIT_INFO[view.trumpSuit].name), el('span', 't2d-trumpword', 'trump'));
    else this.trumpEl.append(el('span', '', view.phase === 'chooseTrump' ? 'Trump: choosing…' : view.round ? 'No trump' : ''));
    this.emoteBtn.hidden = !this.multiplayer;

    const active = ['chooseTrump', 'bidding', 'playing'].includes(view.phase);
    const hideBids = view.variants.blindBids && view.phase === 'bidding';
    for (let seat = 1; seat < view.numPlayers; seat++) {
      const p = view.players[seat];
      const t = this.tiles[seat];
      if (!t) continue;
      t.root.classList.toggle('turn', active && view.turn === seat);
      t.dealer.hidden = view.dealer !== seat;
      t.kind.hidden = !this.multiplayer;
      t.kind.textContent = p.isBot ? 'BOT' : 'PLAYER';
      this.#bidLine(t.bid, p, shown[seat], p.connected === false, before?.[seat]);
      t.score.textContent = `Score ${p.score}`;
      // Forehead round: everyone else's card is on show.
      const card = view.isForeheadRound ? p.hand[0] : null;
      t.mini.hidden = !card;
      if (card) t.mini.src = cardArt(card);
      t.thinking = thinking === seat;
      this.#updateBubble(seat);
    }
    const me = view.players[0];
    this.meEl.classList.toggle('turn', !!this.yourTurn);
    this.#bidLine(this.meBid, { ...me, bid: me.bid }, shown[0], false, before?.[0], hideBids && me.bid !== null);
    this.meScore.textContent = `Score ${me.score}`;
  }

  /** "Bid 1 · Won 0", with the Won number popping (and a +1) when it goes up. */
  #bidLine(target, p, tricks, disconnected, before, hiddenFromOthers = false) {
    target.className = 't2d-bid';
    target.replaceChildren();
    if (disconnected) {
      target.textContent = 'Reconnecting…';
      target.classList.add('bad');
      return;
    }
    if (p.bid === null) {
      target.textContent = 'No bid yet';
      target.classList.add('muted');
      return;
    }
    if (p.bid === '?') {
      target.textContent = 'Bid hidden';
      return;
    }
    const won = el('span', 't2d-won', String(tricks));
    target.append(`Bid ${p.bid} · Won `, won);
    if (hiddenFromOthers) target.append(el('span', 't2d-score', ' (hidden)'));
    if (before !== undefined && tricks > before) {
      won.classList.add('pop');
      const plus = el('span', 't2d-plus', '+1');
      target.style.position = 'relative';
      target.append(plus);
      setTimeout(() => plus.remove(), 1200);
    }
  }

  // ───────────────────────── players and bubbles ─────────────────────────

  #setupPlayers() {
    const view = this.view;
    this.playersEl.replaceChildren();
    this.tiles = [];
    for (let seat = 1; seat < view.numPlayers; seat++) {
      const root = el('div', 't2d-player');
      const name = el('div', 't2d-name');
      const dealer = el('span', 't2d-tag', 'DEALER');
      const kind = el('span', 't2d-tag soft');
      name.append(el('span', '', view.players[seat].name), dealer, kind);
      const bid = el('div', 't2d-bid');
      const score = el('div', 't2d-score');
      const mini = el('img', 't2d-mini');
      mini.hidden = true;
      const bubble = el('div', 't2d-bubble');
      bubble.hidden = true;
      root.append(name, bid, score, mini, bubble);
      this.playersEl.append(root);
      this.tiles[seat] = { root, dealer, kind, bid, score, mini, bubble, thinking: false, won: false, emote: null, until: 0 };
    }
    this.meTile = { root: this.meEl, bubble: this.meBubble, thinking: false, won: false, emote: null, until: 0 };
  }

  /** Show a speech bubble on a player (seat 0 = you) for a while. */
  #bubble(seat, text, seconds) {
    const t = seat === 0 ? this.meTile : this.tiles[seat];
    if (!t) return;
    t.emote = text;
    t.until = performance.now() + seconds * 1000;
    this.#updateBubble(seat);
    setTimeout(() => this.#updateBubble(seat), seconds * 1000 + 30);
  }

  #updateBubble(seat) {
    const t = seat === 0 ? this.meTile : this.tiles[seat];
    if (!t) return;
    let text = null;
    if (t.emote && performance.now() < t.until) text = t.emote;
    else if (t.won) text = seat === 0 ? 'You win the trick!' : 'Wins the trick!';
    else if (t.thinking) text = 'Thinking…';
    t.bubble.hidden = !text;
    if (text) t.bubble.textContent = text;
  }

  #setWinner(seat) {
    for (let s = 0; s < (this.view?.numPlayers ?? 0); s++) {
      const t = s === 0 ? this.meTile : this.tiles[s];
      if (!t) continue;
      t.won = s === seat;
      this.#updateBubble(s);
    }
  }

  // ───────────────────────── trump, trick and hand ─────────────────────────

  /** The turned-up card, small, beside the trump suit in the top bar. */
  #renderTrumpCard() {
    const view = this.view;
    this.trumpCardEl.replaceChildren();
    if (view.trumpCard) this.trumpCardEl.append(cardImg(view.trumpCard));
  }

  #renderTrick(plays = this.view.trick) {
    this.playsEl.replaceChildren();
    if (!plays.length) {
      if (this.view.phase === 'playing') this.playsEl.append(el('div', 't2d-empty', this.view.turn === 0 ? 'Your lead' : `${this.#name(this.view.turn)} leads`));
      return;
    }
    for (const { player, card } of plays) this.playsEl.append(this.#playEl(player, card));
    this.#sizeTrick();
  }

  #playEl(player, card) {
    const box = el('div', 't2d-play');
    box.dataset.player = player;
    box.append(cardImg(card), el('span', '', this.#name(player)));
    return box;
  }

  /** Trick cards shrink to fit in one or two rows. */
  #sizeTrick() {
    const area = this.playsEl.parentElement.getBoundingClientRect();
    const n = this.playsEl.children.length || 1;
    const rows = n > 3 && area.width < 420 ? 2 : 1;
    const perRow = Math.ceil(n / rows);
    const byWidth = ((area.width - 16 - perRow * 8) / perRow) * 1.5;
    const byHeight = (area.height - rows * 22) / rows - 6;
    this.playsEl.style.setProperty('--trick-card', `${Math.max(48, Math.min(110, byWidth, byHeight))}px`);
  }

  /** Your hand, sorted like the 3D table, sized and overlapped to fit the screen. */
  #renderHand({ legal = null, onPick = null } = this.handState ?? {}) {
    this.handState = { legal, onPick };
    const view = this.view;
    const cards = view.players[0].hand;
    const known = cards.filter(Boolean);
    const order = [...sortHand(known, view.trumpSuit), ...cards.filter((c) => !c)];
    this.handEl.replaceChildren();
    if (!order.length) return;

    const width = this.handEl.getBoundingClientRect().width || window.innerWidth - 16;
    const landscape = window.innerWidth > window.innerHeight;
    const maxH = landscape ? Math.min(120, window.innerHeight * 0.32) : Math.min(156, window.innerHeight * 0.24);
    const rows = !landscape && order.length > 8 ? 2 : 1;
    const perRow = Math.ceil(order.length / rows);
    const cardW = Math.min(maxH / 1.5, width / Math.min(perRow, 5.5));
    const step = perRow > 1 ? Math.min(cardW + 5, (width - cardW) / (perRow - 1)) : cardW;

    for (let r = 0; r < rows; r++) {
      const row = el('div', 't2d-row');
      order.slice(r * perRow, (r + 1) * perRow).forEach((card, i) => {
        const b = el('button', 't2d-card');
        b.style.width = `${cardW}px`;
        if (i > 0) b.style.marginLeft = `${step - cardW}px`;
        b.append(cardImg(card));
        b.card = card;
        if (legal) {
          const ok = card ? legal.has(card.id) : legal.size > 0;
          b.classList.toggle('dim', !ok);
          if (ok) {
            b.classList.add('playable');
            b.addEventListener('pointerup', (e) => this.#tapCard(b, e.pointerType));
          }
        }
        if (this.lifted && card && this.lifted === card.id) b.classList.add('lifted');
        row.append(b);
      });
      this.handEl.append(row);
    }
  }

  /** Touch: first tap lifts a card, a second tap on it plays it. Mouse: one click plays. */
  #tapCard(b, pointerType) {
    const { onPick } = this.handState;
    if (!onPick) return;
    const id = b.card?.id ?? '?';
    if (pointerType === 'mouse' || this.lifted === id) {
      this.lifted = null;
      onPick(b.card?.id ?? null);
      return;
    }
    this.#lift(id);
    this.sound?.play('click', null, { volume: 0.35 });
  }

  #lift(id) {
    if (this.lifted === id) return;
    this.lifted = id;
    for (const b of this.handEl.querySelectorAll('.t2d-card')) b.classList.toggle('lifted', !!id && (b.card?.id ?? '?') === id);
    if (this.handState?.onPick) this.hintEl.textContent = id ? 'Tap it again to play' : 'Tap a card to lift it';
  }

  // ───────────────────────── sheets ─────────────────────────

  /**
   * A panel over the table: `center` (results, scores) over everything, or `over: 'trick'`
   * (bid, trump) in the middle of the table, so your hand stays in view.
   */
  #openSheet(build, { center = false, over = null } = {}) {
    this.sheet.replaceChildren();
    this.sheet.className = center ? 't2d-sheet center' : 't2d-sheet';
    this.sheet.style.removeProperty('top');
    this.sheet.style.removeProperty('bottom');
    build(this.sheet);
    this.sheet.hidden = false;
    if (over === 'trick') {
      // Centre it on the trick area (between the players and your bar).
      const area = this.playsEl.parentElement.getBoundingClientRect();
      const root = this.root.getBoundingClientRect();
      const h = this.sheet.getBoundingClientRect().height;
      const top = Math.max(4, area.top - root.top + (area.height - h) / 2);
      this.sheet.style.top = `${top}px`;
      this.sheet.style.bottom = 'auto';
    }
  }

  #closeSheet() {
    this.sheet.hidden = true;
    this.sheet.replaceChildren();
    this.sheetKeys = null;
  }

  #onKey(e) {
    if (this.root.hidden || this.root.classList.contains('behind')) return;
    this.sheetKeys?.(e);
  }

  /** Round or final standings as a table. */
  #resultsTable(view, final) {
    const last = view.history[view.history.length - 1];
    const table = el('table', 't2d-table');
    const head = el('tr');
    for (const h of ['Player', 'Bid', 'Won', 'Pts', 'Total']) head.append(el('th', '', h));
    table.append(head);
    const order = final ? view.standings() : view.players;
    for (const p of order) {
      const r = last.results[p.index];
      const row = el('tr', p.isHuman ? 'you' : '');
      row.append(el('td', '', p.isHuman ? 'You' : p.name), el('td', '', String(r.bid)), el('td', '', String(r.tricks)));
      row.append(el('td', r.delta > 0 ? 'pos' : 'neg', signed(r.delta)), el('td', '', String(p.score)));
      table.append(row);
    }
    return table;
  }

  #roundSheet(view, waiting) {
    return new Promise((resolve, reject) => {
      const last = view.history[view.history.length - 1];
      const done = () => {
        this.pending = null;
        this.#closeSheet();
        resolve();
      };
      this.#openSheet((s) => {
        s.append(el('h2', '', `Round ${last.round} results`), el('p', 'note', `Next: round ${last.round + 1} of ${view.totalRounds}`));
        s.append(this.#resultsTable(view, false));
        if (waiting) s.append(el('p', 'note', 'Waiting for the host to start the next round…'));
        else {
          const row = el('div', 't2d-buttons');
          row.append(button('Next round', done, 'primary'));
          s.append(row);
        }
      }, { center: true });
      if (waiting) return resolve();
      this.sheetKeys = (e) => (e.key === 'Enter' || e.key === ' ') && done();
      this.pending = { reject, close: () => this.#closeSheet() };
    });
  }

  /** Final standings. Host/solo: resolves 'rematch' | 'rules' | 'menu'. Guests: Leave table. */
  #finalSheet(highlights, waiting = false) {
    const view = this.view;
    return new Promise((resolve, reject) => {
      const choose = (choice) => {
        this.pending = null;
        this.#closeSheet();
        if (choice !== 'rematch') this.hide(); // the menu or the rules screen comes next
        resolve(choice);
      };
      const standings = view.standings();
      const top = standings[0].score;
      const winners = standings.filter((p) => p.score === top);
      const title = winners.length > 1 ? 'It’s a tie!' : winners[0].isHuman ? 'You win!' : `${winners[0].name} wins!`;
      this.#openSheet((s) => {
        s.append(el('h2', '', title), el('p', 'note', 'Final standings'));
        for (const h of highlights) s.append(el('p', 'good', h));
        s.append(this.#resultsTable(view, true));
        const row = el('div', 't2d-buttons');
        if (waiting) {
          s.append(el('p', 'note', 'Waiting for the host: rematch or not?'));
          row.append(button('Leave table', () => this.onQuit?.()));
        } else {
          row.append(button('Rematch', () => choose('rematch'), 'primary'), button('Change rules', () => choose('rules')), button('Back to menu', () => choose('menu')));
        }
        s.append(row);
      }, { center: true });
      if (waiting) return resolve(null);
      this.sheetKeys = (e) => {
        if (e.key === 'Enter') choose('rematch');
        if (e.key === 'Escape') choose('menu');
      };
      this.pending = { reject, close: () => this.#closeSheet() };
    });
  }

  #showScores() {
    const view = this.view;
    if (!view) return;
    this.#openSheet((s) => {
      s.append(el('h2', '', 'Scores'));
      const recent = view.history.slice(-5);
      const table = el('table', 't2d-table');
      const head = el('tr');
      head.append(el('th', '', 'Player'));
      for (const h of recent) head.append(el('th', '', `R${h.round}`));
      head.append(el('th', '', 'Total'));
      table.append(head);
      view.players.forEach((p, i) => {
        const row = el('tr', i === 0 ? 'you' : '');
        row.append(el('td', '', i === 0 ? 'You' : p.name));
        for (const h of recent) {
          const d = h.results[i].delta;
          row.append(el('td', d > 0 ? 'pos' : 'neg', signed(d)));
        }
        row.append(el('td', '', String(p.score)));
        table.append(row);
      });
      s.append(table);
      if (!recent.length) s.append(el('p', 'note', 'No rounds finished yet.'));
      const row = el('div', 't2d-buttons');
      row.append(button('Close', () => this.#closeSheet()));
      s.append(row);
    }, { center: true });
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
        this.hud.closeInfo(); // a guest's lobby or results window
        this.#closeSheet();
        this.shownTricks = null;
        this.lifted = null;
        this.handState = null;
        this.#setupPlayers();
        this.#show();
        this.#refresh();
        this.#renderTrumpCard();
        this.#renderTrick();
        this.#renderHand();
        break;

      case 'presence':
        this.#refresh({ tricks: this.shownTricks });
        break;

      case 'round':
        this.#closeSheet();
        this.lifted = null;
        this.handState = null;
        this.#setWinner(null);
        this.#refresh();
        this.#renderTrumpCard();
        this.#renderTrick([]);
        this.sound?.play('shuffle');
        this.#renderHand();
        this.#dealIn();
        await this.#pause(0.5 + 0.06 * view.round);
        if (view.trumpCard) this.sound?.play('flip');
        if (!view.trumpCard) await this.#pause(1.2); // last round: no trump
        break;

      case 'turn':
        this.#refresh({ thinking: event.seat === 0 ? null : event.seat, tricks: this.shownTricks });
        if (view.phase === 'playing' && !view.trick.length) this.#renderTrick();
        break;

      case 'trumpChosen':
        this.#refresh();
        this.#renderHand();
        await this.#pause(0.8);
        break;

      case 'bid':
        this.#refresh();
        break;

      case 'bidsDone':
        this.#refresh();
        this.#renderTrick();
        await this.#pause(view.variants.blindBids ? 1.8 : 1.2);
        break;

      case 'play': {
        // The last card of a trick arrives with the trick already counted: keep the old count
        // until the cards are swept to the winner.
        const last = event.order === view.numPlayers - 1;
        this.#refresh({ tricks: last && this.shownTricks ? this.shownTricks : null });
        this.handState = null;
        this.lifted = null;
        if (event.seat === 0) this.#renderHand();
        if (event.order === 0) this.playsEl.replaceChildren();
        const box = this.#playEl(event.seat, event.card);
        this.playsEl.append(box);
        this.#sizeTrick();
        this.#flyIn(box, event.seat);
        this.sound?.play('play', null, { volume: 0.7, rate: 0.9 + Math.random() * 0.2 });
        if (event.card.kind === 'wizard') this.sound?.play('wizard');
        if (event.card.kind === 'jester') this.sound?.play('jester');
        await this.#pause(0.35);
        break;
      }

      case 'trick': {
        const winnerBox = [...this.playsEl.querySelectorAll('.t2d-play')].find((p) => Number(p.dataset.player) === event.winner);
        winnerBox?.classList.add('win');
        this.sound?.play(event.winner === 0 ? 'win' : 'trick');
        this.#setWinner(event.winner);
        this.#refresh({ heldTrick: event.winner });
        await this.#pause(1.4);
        this.#refresh(); // count it up as the cards go
        await this.#sweepTo(event.winner);
        this.#setWinner(null);
        this.#renderTrick([]);
        break;
      }

      case 'roundEnd': {
        this.#refresh();
        const final = view.phase === 'gameOver';
        if (!final) {
          const mine = view.history[view.history.length - 1].results[0].delta;
          this.sound?.play(mine > 0 ? 'good' : 'bad');
          await this.#roundSheet(view, this.role !== 'host');
        }
        this.#check();
        break;
      }

      case 'gameEnd': {
        const [top] = view.standings();
        this.sound?.play(top.isHuman ? 'fanfare' : 'bad');
        const highlights = this.onGameEnd?.(view, { multiplayer: this.multiplayer }) ?? [];
        this.endChoice = null;
        this.handEl.replaceChildren();
        if (this.role === 'guest') this.#finalSheet(highlights, true);
        else this.endChoice = await this.#finalSheet(highlights);
        break;
      }
    }
  }

  // ───────────────────────── animations ─────────────────────────

  #dealIn() {
    [...this.handEl.querySelectorAll('.t2d-card')].forEach((b, i) =>
      b.animate([{ transform: 'translateY(-40px) scale(0.6)', opacity: 0 }, { transform: 'none', opacity: 1 }], {
        duration: 260,
        delay: i * 45 * this.speed,
        easing: 'ease-out',
        fill: 'backwards',
      }),
    );
  }

  /** Where a player sits on screen (their tile, or your bar). */
  #seatRect(seat) {
    return (seat === 0 ? this.meEl : this.tiles[seat]?.root)?.getBoundingClientRect();
  }

  #flyIn(box, seat) {
    const from = this.#seatRect(seat);
    const to = box.getBoundingClientRect();
    if (!from) return;
    const dx = from.left + from.width / 2 - (to.left + to.width / 2);
    const dy = from.top + from.height / 2 - (to.top + to.height / 2);
    box.animate([{ transform: `translate(${dx}px, ${dy}px) scale(0.5)`, opacity: 0.4 }, { transform: 'none', opacity: 1 }], {
      duration: 280 * this.speed,
      easing: 'ease-out',
    });
  }

  async #sweepTo(seat) {
    const to = this.#seatRect(seat);
    const boxes = [...this.playsEl.querySelectorAll('.t2d-play')];
    if (!to || !boxes.length) return;
    this.sound?.play('sweep', null, { volume: 0.6 });
    await Promise.all(
      boxes.map((box) => {
        const r = box.getBoundingClientRect();
        const dx = to.left + to.width / 2 - (r.left + r.width / 2);
        const dy = to.top + to.height / 2 - (r.top + r.height / 2);
        return box.animate([{ transform: 'none', opacity: 1 }, { transform: `translate(${dx}px, ${dy}px) scale(0.35)`, opacity: 0 }], {
          duration: 420 * this.speed,
          easing: 'ease-in',
          fill: 'forwards',
        }).finished.catch(() => {});
      }),
    );
    this.#check();
  }

  // ───────────────────────── your decisions ─────────────────────────

  async #prompt(kind, data) {
    this.#check();
    this.yourTurn = true;
    document.body.classList.add('your-turn');
    this.#refresh({ tricks: this.shownTricks });
    this.sound?.play('turn', null, { volume: kind === 'play' ? 0.6 : 1 });
    try {
      if (kind === 'trump') return await this.#askTrump();
      if (kind === 'bid') return await this.#askBid(data.allowed);
      return await this.#pickCard(new Set(data.legal));
    } finally {
      this.yourTurn = false;
      document.body.classList.remove('your-turn');
      this.hintEl.textContent = '';
      if (this.view) this.#refresh({ tricks: this.shownTricks });
    }
  }

  #askTrump() {
    return new Promise((resolve, reject) => {
      const done = (suit) => {
        this.pending = null;
        this.#closeSheet();
        resolve(suit);
      };
      this.#openSheet((s) => {
        s.append(el('h2', '', 'A Wizard was turned up!'), el('p', 'note', 'You’re the dealer: choose the trump suit'));
        const row = el('div', 't2d-buttons');
        for (const suit of SUITS) {
          const b = button(SUIT_INFO[suit].name, () => done(suit), 't2d-suit');
          b.prepend(suitBadge(suit), ' ');
          b.style.borderColor = SUIT_INFO[suit].light;
          row.append(b);
        }
        s.append(row);
      }, { over: 'trick' });
      this.pending = { reject, close: () => this.#closeSheet() };
    });
  }

  #askBid(allowedBids) {
    const view = this.view;
    const allowed = new Set(allowedBids);
    const max = view.round;
    const forbidden = [];
    for (let b = 0; b <= max; b++) if (!allowed.has(b)) forbidden.push(b);
    // Tricks already called by the players before you (unknown while bids are hidden).
    const others = view.players.filter((p) => p.index !== 0 && p.bid !== null);
    const hidden = others.some((p) => p.bid === '?');
    const called = others.reduce((sum, p) => sum + (typeof p.bid === 'number' ? p.bid : 0), 0);
    let calledText = `${called}/${max} tricks called so far`;
    if (hidden) calledText = 'Bids are hidden until everyone has bid';
    else if (!others.length) calledText = `0/${max} tricks called · you bid first`;
    else if (called > max) calledText += ` (${called - max} over)`;
    if (view.isForeheadRound) calledText += ' · your card is on your forehead';

    return new Promise((resolve, reject) => {
      const done = (bid) => {
        this.pending = null;
        this.#closeSheet();
        resolve(bid);
      };
      this.#openSheet((s) => {
        s.append(el('h2', '', 'Your bid'), el('p', hidden ? 'note' : '', calledText));
        if (forbidden.length) s.append(el('p', 'warn', `Dealer rule: you can’t bid ${forbidden.join(', ')}`));
        const row = el('div', 't2d-buttons numbers');
        for (let b = 0; b <= max; b++) {
          const btn = button(String(b), () => done(b));
          btn.disabled = !allowed.has(b);
          row.append(btn);
        }
        s.append(row);
      }, { over: 'trick' });
      this.sheetKeys = (e) => {
        if (max < 10 && /^[0-9]$/.test(e.key) && allowed.has(Number(e.key))) done(Number(e.key));
      };
      this.pending = { reject, close: () => this.#closeSheet() };
    });
  }

  #pickCard(legalIds) {
    return new Promise((resolve, reject) => {
      this.lifted = null;
      this.hintEl.textContent = 'Tap a card to lift it';
      const finish = (cardId) => {
        this.pending = null;
        this.handState = null;
        resolve(cardId ?? [...legalIds][0]);
      };
      this.#renderHand({ legal: legalIds, onPick: finish });
      this.pending = {
        reject,
        close: () => {
          this.handState = null;
          this.lifted = null;
          if (this.view) this.#renderHand();
        },
      };
    });
  }
}
