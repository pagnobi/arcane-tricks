import { createDeck, shuffle, SUITS } from './cards.js';
import { allowedBids, legalCards, scoreRound, totalRounds, trickWinnerIndex, trumpFromCard } from './rules.js';

export const DEFAULT_VARIANTS = {
  dealerRestriction: false, // dealer can't make total bids == tricks available
  blindBids: false, // bids are hidden until everyone has bid
  foreheadFirstRound: false, // round 1: you see everyone's card but your own
  shortGame: false, // half the usual number of rounds
};

/**
 * Game state machine. Synchronous and rendering-free: the controller asks it what is
 * legal, feeds it decisions (human or bot) and animates the results.
 *
 * Phases: ready → (chooseTrump) → bidding → playing → roundOver → … → gameOver
 */
export class Game {
  constructor({ players, variants = {}, rng = Math.random, firstDealer = 0 }) {
    if (players.length < 3 || players.length > 6) throw new Error('The game needs 3 to 6 players');
    this.players = players.map((p, index) => ({
      name: p.name,
      isHuman: !!p.isHuman,
      index,
      hand: [],
      bid: null,
      tricks: 0,
      score: 0,
    }));
    this.variants = { ...DEFAULT_VARIANTS, ...variants };
    // Blind bids make the dealer restriction impossible to apply fairly.
    if (this.variants.blindBids) this.variants.dealerRestriction = false;
    this.rng = rng;
    this.firstDealer = firstDealer;
    this.totalRounds = totalRounds(players.length, this.variants);

    this.round = 0;
    this.dealer = -1;
    this.phase = 'ready';
    this.trumpCard = null;
    this.trumpSuit = null;
    this.undealt = [];
    this.turn = -1;
    this.leader = -1;
    this.trick = [];
    this.tricksPlayed = 0;
    this.lastTrick = null;
    this.history = [];
  }

  get numPlayers() {
    return this.players.length;
  }

  get isForeheadRound() {
    return this.variants.foreheadFirstRound && this.round === 1;
  }

  nextSeat(seat) {
    return (seat + 1) % this.numPlayers;
  }

  startRound() {
    if (this.phase !== 'ready' && this.phase !== 'roundOver') throw new Error(`Cannot start a round during ${this.phase}`);
    this.round += 1;
    this.dealer = (this.firstDealer + this.round - 1) % this.numPlayers;

    const deck = shuffle(createDeck(), this.rng);
    for (const p of this.players) {
      p.hand = [];
      p.bid = null;
      p.tricks = 0;
    }
    // Deal one at a time, starting left of the dealer. hand[r] is the r-th card dealt.
    let seat = this.nextSeat(this.dealer);
    for (let i = 0; i < this.round * this.numPlayers; i++) {
      this.players[seat].hand.push(deck.pop());
      seat = this.nextSeat(seat);
    }
    this.trumpCard = deck.length ? deck.pop() : null; // last round: no trump
    this.undealt = deck;

    const trump = trumpFromCard(this.trumpCard);
    this.trumpSuit = trump.suit;
    this.leader = this.nextSeat(this.dealer);
    this.phase = trump.dealerChooses ? 'chooseTrump' : 'bidding';
    this.turn = trump.dealerChooses ? this.dealer : this.leader;
    this.trick = [];
    this.tricksPlayed = 0;
    this.lastTrick = null;
  }

  chooseTrump(suit) {
    if (this.phase !== 'chooseTrump') throw new Error('Trump is not being chosen');
    if (!SUITS.includes(suit)) throw new Error(`Unknown suit ${suit}`);
    this.trumpSuit = suit;
    this.phase = 'bidding';
    this.turn = this.leader;
  }

  allowedBidsFor(seat) {
    return allowedBids({
      handSize: this.round,
      bidsSoFar: this.players.filter((p) => p.index !== seat && p.bid !== null).map((p) => p.bid),
      isLastBidder: seat === this.dealer,
      dealerRestriction: this.variants.dealerRestriction,
    });
  }

  placeBid(seat, bid) {
    if (this.phase !== 'bidding' || seat !== this.turn) throw new Error('Not your turn to bid');
    if (!this.allowedBidsFor(seat).includes(bid)) throw new Error(`Bid ${bid} is not allowed`);
    this.players[seat].bid = bid;
    if (seat === this.dealer) {
      this.phase = 'playing';
      this.turn = this.leader;
    } else {
      this.turn = this.nextSeat(seat);
    }
  }

  legalMovesFor(seat) {
    if (this.phase !== 'playing' || seat !== this.turn) return [];
    return legalCards(this.players[seat].hand, this.trick);
  }

  playCard(seat, cardId) {
    if (this.phase !== 'playing' || seat !== this.turn) throw new Error('Not your turn to play');
    const hand = this.players[seat].hand;
    const card = hand.find((c) => c.id === cardId);
    if (!card) throw new Error(`${cardId} is not in hand`);
    if (!legalCards(hand, this.trick).includes(card)) throw new Error(`${cardId} does not follow suit`);

    hand.splice(hand.indexOf(card), 1);
    this.trick.push({ player: seat, card });
    if (this.trick.length < this.numPlayers) {
      this.turn = this.nextSeat(seat);
      return { card, trickComplete: false };
    }

    const plays = this.trick;
    const winner = plays[trickWinnerIndex(plays, this.trumpSuit)].player;
    this.players[winner].tricks += 1;
    this.lastTrick = { plays, winner };
    this.trick = [];
    this.tricksPlayed += 1;
    this.leader = winner;
    this.turn = winner;
    if (this.tricksPlayed === this.round) this.#endRound();
    return { card, trickComplete: true, winner, plays };
  }

  #endRound() {
    const results = this.players.map((p) => {
      const delta = scoreRound(p.bid, p.tricks);
      p.score += delta;
      return { bid: p.bid, tricks: p.tricks, delta, score: p.score };
    });
    this.history.push({ round: this.round, dealer: this.dealer, trumpSuit: this.trumpSuit, results });
    this.phase = this.round === this.totalRounds ? 'gameOver' : 'roundOver';
    this.turn = -1;
  }

  standings() {
    return this.players.slice().sort((a, b) => b.score - a.score);
  }
}
