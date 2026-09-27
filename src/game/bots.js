import { SUITS, createDeck } from './cards.js';
import { trickWinnerIndex } from './rules.js';

// Heuristic bots: estimate tricks from card strength, then play to hit the bid exactly.

export function chooseTrumpSuit(hand) {
  let best = SUITS[0];
  let bestScore = -Infinity;
  for (const suit of SUITS) {
    const cards = hand.filter((c) => c.kind === 'number' && c.suit === suit);
    const score = cards.length * 10 + cards.reduce((s, c) => s + c.rank, 0);
    if (score > bestScore) {
      best = suit;
      bestScore = score;
    }
  }
  return best;
}

/** Rough probability that a card takes a trick on its own. */
export function winChance(card, trumpSuit, numPlayers) {
  if (card.kind === 'wizard') return 0.95;
  if (card.kind === 'jester') return 0;
  const crowd = Math.sqrt(3 / numPlayers);
  if (trumpSuit && card.suit === trumpSuit) {
    const base = card.rank >= 12 ? 0.9 : card.rank >= 10 ? 0.7 : card.rank >= 7 ? 0.45 : 0.25;
    return base * crowd;
  }
  const base = card.rank === 13 ? 0.55 : card.rank === 12 ? 0.35 : card.rank === 11 ? 0.18 : 0.03;
  return Math.min(0.95, base * (trumpSuit ? 1 : 1.25) * crowd);
}

export function chooseBid(game, seat) {
  const allowed = game.allowedBidsFor(seat);
  let estimate;
  if (game.isForeheadRound) {
    // Can't see our own card: estimate the share of unseen cards that would beat everything visible.
    const visible = game.players.filter((p) => p.index !== seat).map((p) => ({ player: p.index, card: p.hand[0] }));
    const seen = new Set(visible.map((v) => v.card.id));
    if (game.trumpCard) seen.add(game.trumpCard.id);
    const unknown = createDeck().filter((c) => !seen.has(c.id));
    const winners = unknown.filter(
      (card) => trickWinnerIndex([...visible, { player: seat, card }], game.trumpSuit) === visible.length,
    );
    estimate = winners.length / unknown.length;
  } else {
    estimate = game.players[seat].hand.reduce((s, c) => s + winChance(c, game.trumpSuit, game.numPlayers), 0);
  }
  return allowed.reduce((best, b) => (Math.abs(b - estimate) < Math.abs(best - estimate) ? b : best), allowed[0]);
}

function power(card, trumpSuit) {
  if (card.kind === 'wizard') return 100;
  if (card.kind === 'jester') return 0;
  return card.suit === trumpSuit ? 40 + card.rank : card.rank;
}

export function chooseCard(game, seat) {
  const legal = game.legalMovesFor(seat);
  if (legal.length === 1) return legal[0];

  const player = game.players[seat];
  const wantTricks = player.bid - player.tricks > 0;
  const byPower = legal.slice().sort((a, b) => power(a, game.trumpSuit) - power(b, game.trumpSuit));
  const weakest = byPower[0];
  const strongest = byPower[byPower.length - 1];

  if (game.trick.length === 0) return wantTricks ? strongest : weakest;

  const wins = (card) => trickWinnerIndex([...game.trick, { player: seat, card }], game.trumpSuit) === game.trick.length;
  const winners = byPower.filter(wins);
  const losers = byPower.filter((c) => !wins(c));

  // Need tricks: win as cheaply as possible, else throw away the weakest card.
  if (wantTricks) return winners.length ? winners[0] : weakest;
  // Bid already met: shed the most dangerous card that still loses; if forced to win, dump the strongest.
  return losers.length ? losers[losers.length - 1] : strongest;
}
