// What one player is allowed to see, re-indexed so that *they* are seat 0.
//
// The host builds one of these per player for every event. Hidden cards become `null`, and
// hidden bids become '?', so a client's browser never receives information it shouldn't have.
// The rendering code always assumes "you are seat 0", so the same code draws every player's table.

/** Can `viewer` see the cards in `owner`'s hand right now? */
export function handVisibleTo(game, owner, viewer) {
  const forehead = game.variants.foreheadFirstRound && game.round === 1;
  return forehead ? owner !== viewer : owner === viewer;
}

/** Game seat → seat index as seen by `viewer` (viewer becomes 0). -1 stays -1. */
export function toViewSeat(seat, viewer, n) {
  return seat < 0 ? seat : (seat - viewer + n) % n;
}

export function toGameSeat(viewSeat, viewer, n) {
  return viewSeat < 0 ? viewSeat : (viewSeat + viewer) % n;
}

/**
 * @param game   the authoritative Game
 * @param viewer game seat of the player this view is for
 * @param seats  per-seat metadata: [{ name, kind: 'local'|'remote'|'bot', connected }]
 */
export function viewFor(game, viewer, seats) {
  const n = game.numPlayers;
  const rot = (s) => toViewSeat(s, viewer, n);
  const hideBids = game.variants.blindBids && game.phase === 'bidding';

  const players = [];
  for (let v = 0; v < n; v++) {
    const g = toGameSeat(v, viewer, n);
    const p = game.players[g];
    const meta = seats[g] ?? {};
    const visible = handVisibleTo(game, g, viewer);
    players.push({
      index: v,
      name: p.name,
      isHuman: v === 0, // "is this you" — the UI shows "You" for seat 0
      isBot: meta.kind === 'bot',
      look: meta.look ?? null,
      connected: meta.kind === 'bot' ? true : meta.connected !== false,
      bid: p.bid === null ? null : hideBids && g !== viewer ? '?' : p.bid,
      tricks: p.tricks,
      score: p.score,
      hand: visible ? p.hand.map((c) => ({ ...c })) : p.hand.map(() => null),
    });
  }

  return {
    round: game.round,
    totalRounds: game.totalRounds,
    phase: game.phase,
    variants: { ...game.variants },
    dealer: rot(game.dealer),
    turn: rot(game.turn),
    leader: rot(game.leader),
    trumpCard: game.trumpCard ? { ...game.trumpCard } : null,
    trumpSuit: game.trumpSuit,
    trick: game.trick.map(({ player, card }) => ({ player: rot(player), card: { ...card } })),
    tricksPlayed: game.tricksPlayed,
    undealtCount: game.undealt.length,
    players,
    history: game.history.map((h) => ({
      round: h.round,
      dealer: rot(h.dealer),
      trumpSuit: h.trumpSuit,
      results: players.map((_, v) => ({ ...h.results[toGameSeat(v, viewer, n)] })),
    })),
  };
}

/** Client-side wrapper giving a view the same helpers the renderer uses on a Game. */
export class TableView {
  constructor(data) {
    Object.assign(this, data);
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

  standings() {
    return this.players.slice().sort((a, b) => b.score - a.score);
  }
}
