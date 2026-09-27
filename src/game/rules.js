// Pure rule functions — no state, no rendering. Shared by the Game, the bots and tests,
// and reusable later on an authoritative multiplayer server.

/** 60 cards / players: 3→20, 4→15, 5→12, 6→10 rounds. */
export function totalRounds(numPlayers, { shortGame = false } = {}) {
  const full = 60 / numPlayers;
  return shortGame ? Math.ceil(full / 2) : full;
}

/** What the turned-up card means for trump. */
export function trumpFromCard(card) {
  if (!card || card.kind === 'jester') return { suit: null, dealerChooses: false };
  if (card.kind === 'wizard') return { suit: null, dealerChooses: true };
  return { suit: card.suit, dealerChooses: false };
}

/**
 * The suit players must follow. Set by the first number card, unless a Wizard
 * was played before any number card (then there is nothing to follow).
 * Leading Jesters don't set a suit; the next card does.
 */
export function leadSuit(trick) {
  for (const { card } of trick) {
    if (card.kind === 'wizard') return null;
    if (card.kind === 'number') return card.suit;
  }
  return null;
}

/** Must follow suit if able; Wizards and Jesters may always be played. */
export function legalCards(hand, trick) {
  const suit = leadSuit(trick);
  if (!suit) return hand.slice();
  const canFollow = hand.some((c) => c.kind === 'number' && c.suit === suit);
  if (!canFollow) return hand.slice();
  return hand.filter((c) => c.kind !== 'number' || c.suit === suit);
}

/**
 * Index (within the trick) of the winning play:
 * first Wizard > highest trump > highest card of the lead suit; all Jesters → first Jester.
 */
export function trickWinnerIndex(trick, trumpSuit) {
  const firstWizard = trick.findIndex((p) => p.card.kind === 'wizard');
  if (firstWizard !== -1) return firstWizard;
  if (trick.every((p) => p.card.kind === 'jester')) return 0;

  const lead = leadSuit(trick);
  let best = -1;
  trick.forEach(({ card }, i) => {
    if (card.kind !== 'number') return;
    if (best === -1 || beats(card, trick[best].card, lead, trumpSuit)) best = i;
  });
  return best;
}

function beats(challenger, current, lead, trumpSuit) {
  const cT = trumpSuit != null && challenger.suit === trumpSuit;
  const bT = trumpSuit != null && current.suit === trumpSuit;
  if (cT !== bT) return cT;
  if (cT) return challenger.rank > current.rank;
  const cL = challenger.suit === lead;
  const bL = current.suit === lead;
  if (cL !== bL) return cL;
  return cL && challenger.rank > current.rank;
}

/** Exact bid: 20 + 10 per trick. Otherwise −10 per trick off. */
export function scoreRound(bid, tricks) {
  return bid === tricks ? 20 + 10 * tricks : -10 * Math.abs(bid - tricks);
}

/**
 * Legal bids for a player. With the dealer restriction house rule, the last bidder
 * (the dealer) may not make the total of all bids equal the number of tricks.
 */
export function allowedBids({ handSize, bidsSoFar, isLastBidder, dealerRestriction }) {
  const all = Array.from({ length: handSize + 1 }, (_, i) => i);
  if (!dealerRestriction || !isLastBidder) return all;
  const forbidden = handSize - bidsSoFar.reduce((s, b) => s + b, 0);
  return all.filter((b) => b !== forbidden);
}
