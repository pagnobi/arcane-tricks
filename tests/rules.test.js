import { describe, expect, it } from 'vitest';
import { createDeck } from '../src/game/cards.js';
import * as THREE from 'three';
import { SEATED_EYE_HEIGHT, TABLE_CENTER, fitHeightOffset, seatFrame, seatPosition } from '../src/scene/layout.js';
import { allowedBids, leadSuit, legalCards, scoreRound, totalRounds, trickWinnerIndex, trumpFromCard } from '../src/game/rules.js';

const n = (suit, rank) => ({ id: `${suit}-${rank}`, kind: 'number', suit, rank });
const W = (i = 0) => ({ id: `wizard-${i}`, kind: 'wizard', suit: null, rank: null });
const J = (i = 0) => ({ id: `jester-${i}`, kind: 'jester', suit: null, rank: null });
const trick = (...cards) => cards.map((card, player) => ({ player, card }));

describe('deck', () => {
  it('has 60 unique cards: 52 numbers, 4 wizards, 4 jesters', () => {
    const deck = createDeck();
    expect(deck).toHaveLength(60);
    expect(new Set(deck.map((c) => c.id)).size).toBe(60);
    expect(deck.filter((c) => c.kind === 'wizard')).toHaveLength(4);
    expect(deck.filter((c) => c.kind === 'jester')).toHaveLength(4);
  });
});

describe('rounds', () => {
  it('deals the whole deck by the last round', () => {
    expect([3, 4, 5, 6].map((p) => totalRounds(p))).toEqual([20, 15, 12, 10]);
    expect(totalRounds(4, { shortGame: true })).toBe(8);
  });
});

describe('trump', () => {
  it('follows the turned-up card', () => {
    expect(trumpFromCard(n('tide', 4))).toEqual({ suit: 'tide', dealerChooses: false });
    expect(trumpFromCard(J())).toEqual({ suit: null, dealerChooses: false });
    expect(trumpFromCard(W())).toEqual({ suit: null, dealerChooses: true });
    expect(trumpFromCard(null)).toEqual({ suit: null, dealerChooses: false });
  });
});

describe('lead suit and following', () => {
  it('is set by the first number card, skipping leading jesters', () => {
    expect(leadSuit(trick(J(), n('sun', 3)))).toBe('sun');
    expect(leadSuit(trick(J(), J(1)))).toBe(null);
  });

  it('is void when a wizard comes before any number card', () => {
    expect(leadSuit(trick(W(), n('sun', 3)))).toBe(null);
    expect(leadSuit(trick(J(), W(), n('sun', 3)))).toBe(null);
  });

  it('forces following suit but always allows wizards and jesters', () => {
    const hand = [n('sun', 2), n('tide', 9), W(), J()];
    expect(legalCards(hand, trick(n('sun', 7))).map((c) => c.id)).toEqual(['sun-2', 'wizard-0', 'jester-0']);
    expect(legalCards(hand, trick(n('grove', 7)))).toHaveLength(4);
    expect(legalCards(hand, trick(W()))).toHaveLength(4);
    expect(legalCards(hand, [])).toHaveLength(4);
  });
});

describe('trick winner', () => {
  it('first wizard wins', () => {
    expect(trickWinnerIndex(trick(n('sun', 13), W(0), W(1)), 'sun')).toBe(1);
  });
  it('trump beats lead suit', () => {
    expect(trickWinnerIndex(trick(n('sun', 13), n('tide', 2), n('sun', 12)), 'tide')).toBe(1);
  });
  it('highest trump wins among trumps', () => {
    expect(trickWinnerIndex(trick(n('tide', 3), n('tide', 9), n('sun', 12)), 'tide')).toBe(1);
  });
  it('off-suit cards never win', () => {
    expect(trickWinnerIndex(trick(n('sun', 2), n('grove', 13), n('flame', 13)), 'tide')).toBe(0);
  });
  it('lead suit set after a jester', () => {
    expect(trickWinnerIndex(trick(J(), n('grove', 4), n('grove', 10), n('sun', 13)), null)).toBe(2);
  });
  it('all jesters: first jester wins', () => {
    expect(trickWinnerIndex(trick(J(0), J(1), J(2)), 'sun')).toBe(0);
  });
  it('no trump: highest lead suit wins', () => {
    expect(trickWinnerIndex(trick(n('sun', 5), n('sun', 11), n('tide', 13)), null)).toBe(1);
  });
});

describe('scoring', () => {
  it('rewards exact bids and penalises misses', () => {
    expect(scoreRound(0, 0)).toBe(20);
    expect(scoreRound(3, 3)).toBe(50);
    expect(scoreRound(2, 0)).toBe(-20);
    expect(scoreRound(1, 4)).toBe(-30);
  });
});

describe('remote player poses', () => {
  it('a player sitting upright at their own seat lands on their avatar at ours', () => {
    for (const n of [3, 4, 5, 6]) {
      for (let seat = 1; seat < n; seat++) {
        const head = new THREE.Vector3(0, SEATED_EYE_HEIGHT, 0).applyMatrix4(seatFrame(seat, n));
        const chair = seatPosition(seat, n);
        expect(head.x).toBeCloseTo(chair.x, 5);
        expect(head.z).toBeCloseTo(chair.z, 5);
        expect(head.y).toBeCloseTo(SEATED_EYE_HEIGHT, 5);
      }
    }
  });
  it('leaning toward the table moves the head toward the table centre', () => {
    const seat = 2;
    const n = 4;
    const upright = new THREE.Vector3(0, 1.2, 0).applyMatrix4(seatFrame(seat, n));
    const leaning = new THREE.Vector3(0, 1.2, -0.3).applyMatrix4(seatFrame(seat, n));
    expect(leaning.distanceTo(TABLE_CENTER.clone().setY(1.2))).toBeLessThan(upright.distanceTo(TABLE_CENTER.clone().setY(1.2)));
  });
});

describe('VR height fitting', () => {
  it('lifts the table for standing players and leaves seated ones alone', () => {
    expect(fitHeightOffset(SEATED_EYE_HEIGHT)).toBeCloseTo(0);
    expect(fitHeightOffset(1.65)).toBeCloseTo(SEATED_EYE_HEIGHT - 1.65); // world shifts down ~43 cm
    expect(fitHeightOffset(1.0)).toBeCloseTo(0.22); // low couch: world shifts up
  });
  it('ignores implausible readings while tracking starts', () => {
    expect(fitHeightOffset(0)).toBeNull();
    expect(fitHeightOffset(Number.NaN)).toBeNull();
    expect(fitHeightOffset(3)).toBeNull();
  });
  it('clamps extreme values', () => {
    expect(fitHeightOffset(2.35)).toBe(-1.0);
    expect(fitHeightOffset(0.55)).toBe(0.5);
  });
});

describe('dealer restriction', () => {
  it('blocks the dealer from evening out the bids', () => {
    expect(allowedBids({ handSize: 3, bidsSoFar: [1, 0], isLastBidder: true, dealerRestriction: true })).toEqual([0, 1, 3]);
    expect(allowedBids({ handSize: 3, bidsSoFar: [1, 0], isLastBidder: false, dealerRestriction: true })).toEqual([0, 1, 2, 3]);
    expect(allowedBids({ handSize: 3, bidsSoFar: [1, 0], isLastBidder: true, dealerRestriction: false })).toEqual([0, 1, 2, 3]);
    // over-bid table: nothing to forbid
    expect(allowedBids({ handSize: 1, bidsSoFar: [1, 1], isLastBidder: true, dealerRestriction: true })).toEqual([0, 1]);
  });
});
