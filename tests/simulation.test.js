import { describe, expect, it } from 'vitest';
import { Game } from '../src/game/Game.js';
import { chooseBid, chooseCard, chooseTrumpSuit } from '../src/game/bots.js';
import { seededRandom } from '../src/game/random.js';

function playBotGame(numPlayers, variants, seed) {
  const game = new Game({
    players: Array.from({ length: numPlayers }, (_, i) => ({ name: `Bot ${i}` })),
    variants,
    rng: seededRandom(seed),
    firstDealer: seed % numPlayers,
  });
  while (game.phase !== 'gameOver') {
    game.startRound();
    const dealt = game.players.reduce((s, p) => s + p.hand.length, 0) + game.undealt.length + (game.trumpCard ? 1 : 0);
    expect(dealt).toBe(60);
    if (game.phase === 'chooseTrump') game.chooseTrump(chooseTrumpSuit(game.players[game.dealer].hand));
    while (game.phase === 'bidding') game.placeBid(game.turn, chooseBid(game, game.turn));
    if (variants.dealerRestriction && game.round > 0) {
      expect(game.players.reduce((s, p) => s + p.bid, 0)).not.toBe(game.round);
    }
    while (game.phase === 'playing') {
      const seat = game.turn;
      game.playCard(seat, chooseCard(game, seat).id);
    }
    const last = game.history.at(-1);
    expect(last.results.reduce((s, r) => s + r.tricks, 0)).toBe(game.round);
  }
  return game;
}

describe('full bot games', () => {
  const variantSets = [
    {},
    { dealerRestriction: true },
    { blindBids: true, foreheadFirstRound: true },
    { shortGame: true, dealerRestriction: true, foreheadFirstRound: true },
  ];
  for (const players of [3, 4, 5, 6]) {
    variantSets.forEach((variants, v) => {
      it(`${players} players, variant set ${v} completes cleanly`, () => {
        for (let seed = 1; seed <= 5; seed++) {
          const game = playBotGame(players, variants, seed * 97 + players);
          expect(game.history).toHaveLength(game.totalRounds);
          for (const p of game.players) {
            expect(p.score).toBe(game.history.reduce((s, h) => s + h.results[p.index].delta, 0));
          }
        }
      });
    });
  }

  it('bots hit their bids a reasonable share of the time', () => {
    let hits = 0;
    let total = 0;
    for (let seed = 1; seed <= 20; seed++) {
      const game = playBotGame(4, {}, seed);
      for (const h of game.history) for (const r of h.results) {
        total += 1;
        if (r.bid === r.tricks) hits += 1;
      }
    }
    expect(hits / total).toBeGreaterThan(0.35);
  });
});

describe('forehead round bots', () => {
  it('mostly bid 0 in a crowd and are usually right', () => {
    let correct = 0;
    let ones = 0;
    let total = 0;
    for (let seed = 1; seed <= 60; seed++) {
      const game = new Game({
        players: Array.from({ length: 5 }, (_, i) => ({ name: `Bot ${i}` })),
        variants: { foreheadFirstRound: true },
        rng: seededRandom(seed),
      });
      game.startRound();
      if (game.phase === 'chooseTrump') game.chooseTrump(chooseTrumpSuit([]));
      while (game.phase === 'bidding') game.placeBid(game.turn, chooseBid(game, game.turn));
      while (game.phase === 'playing') game.playCard(game.turn, chooseCard(game, game.turn).id);
      for (const r of game.history[0].results) {
        total += 1;
        if (r.bid === 1) ones += 1;
        if (r.bid === r.tricks) correct += 1;
      }
    }
    expect(ones / total).toBeLessThan(0.4);
    expect(correct / total).toBeGreaterThan(0.7);
  });
});

describe('game guards', () => {
  it('rejects out-of-turn and illegal plays', () => {
    const game = new Game({ players: [{ name: 'a' }, { name: 'b' }, { name: 'c' }], rng: seededRandom(3) });
    game.startRound();
    if (game.phase === 'chooseTrump') game.chooseTrump('sun');
    const notTurn = game.nextSeat(game.turn);
    expect(() => game.placeBid(notTurn, 0)).toThrow();
    expect(() => game.placeBid(game.turn, 5)).toThrow();
  });
});
