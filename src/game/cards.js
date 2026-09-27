// The deck: four suits of 1–13, plus 4 Wizards and 4 Jesters (60 cards).
// Suit names/colours are our own so the game has its own identity.

export const SUITS = ['flame', 'tide', 'grove', 'sun'];

export const SUIT_INFO = {
  flame: { name: 'Flame', color: '#c23f2c', light: '#e8735c' },
  tide: { name: 'Tide', color: '#2a69b8', light: '#5a9be0' },
  grove: { name: 'Grove', color: '#28834a', light: '#58b87a' },
  sun: { name: 'Sun', color: '#c0850f', light: '#f0bb3c' },
};

export const RANKS = 13;
export const SPECIALS_EACH = 4;

export function createDeck() {
  const deck = [];
  for (const suit of SUITS) {
    for (let rank = 1; rank <= RANKS; rank++) deck.push({ id: `${suit}-${rank}`, kind: 'number', suit, rank });
  }
  for (let i = 0; i < SPECIALS_EACH; i++) {
    deck.push({ id: `wizard-${i}`, kind: 'wizard', suit: null, rank: null });
    deck.push({ id: `jester-${i}`, kind: 'jester', suit: null, rank: null });
  }
  return deck;
}

export function shuffle(cards, rng = Math.random) {
  const a = cards.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

export function cardName(card) {
  if (card.kind === 'wizard') return 'Wizard';
  if (card.kind === 'jester') return 'Jester';
  return `${card.rank} of ${SUIT_INFO[card.suit].name}`;
}

/** Display order: Wizards, then trump suit, then other suits (high to low), then Jesters. */
export function sortHand(hand, trumpSuit) {
  const suitOrder = trumpSuit ? [trumpSuit, ...SUITS.filter((s) => s !== trumpSuit)] : SUITS;
  const key = (c) => {
    if (c.kind === 'wizard') return 0;
    if (c.kind === 'jester') return 1000;
    return 1 + suitOrder.indexOf(c.suit) * 20 + (RANKS - c.rank);
  };
  return hand.slice().sort((a, b) => key(a) - key(b) || a.id.localeCompare(b.id));
}
