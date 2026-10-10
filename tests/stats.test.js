import { describe, expect, it } from 'vitest';
import { EMPTY_STATS, applyGame, statRows } from '../src/stats.js';

// A finished game as seen by you (seat 0): final scores and, per round, everyone's bid/tricks.
function game(scores, myRounds) {
  return {
    players: scores.map((score) => ({ score })),
    history: myRounds.map(([bid, tricks]) => ({ results: [{ bid, tricks }, ...scores.slice(1).map(() => ({ bid: 0, tricks: 0 }))] })),
  };
}

describe('stats', () => {
  it('counts a win, its score and bid accuracy', () => {
    const { stats, highlights } = applyGame(EMPTY_STATS, game([90, 40, 60], [[1, 1], [0, 1], [2, 2]]));
    expect(stats).toMatchObject({ games: 1, wins: 1, soloGames: 1, bestScore: 90, totalScore: 90, rounds: 3, bidsHit: 2, perfectGames: 0, streak: 1, bestStreak: 1 });
    expect(highlights).toEqual([]); // first game: no "new best" fanfare
  });

  it('counts a shared first place as a win', () => {
    expect(applyGame(EMPTY_STATS, game([50, 50, 10], [[0, 0]])).stats.wins).toBe(1);
  });

  it('tracks streaks, personal bests and perfect games', () => {
    let s = applyGame(EMPTY_STATS, game([40, 10, 0], [[0, 1]])).stats;
    const second = applyGame(s, game([70, 10, 0], [[1, 1], [0, 0]]), { multiplayer: true });
    s = second.stats;
    expect(s).toMatchObject({ games: 2, wins: 2, streak: 2, bestStreak: 2, bestScore: 70, onlineGames: 1, perfectGames: 1 });
    expect(second.highlights).toEqual(['New personal best: 70!', '2 wins in a row!', 'Perfect game: every bid hit!']);
    s = applyGame(s, game([-20, 80, 10], [[2, 0]])).stats; // a loss ends the streak
    expect(s).toMatchObject({ games: 3, wins: 2, streak: 0, bestStreak: 2, bestScore: 70 });
  });

  it('shows friendly rows before any games are played', () => {
    const rows = Object.fromEntries(statRows(EMPTY_STATS));
    expect(rows['Games played']).toBe('0');
    expect(rows['Best score']).toBe('–');
    expect(rows['Bid accuracy']).toBe('–');
  });
});
