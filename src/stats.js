// Your lifetime stats, kept in this browser (like your name and settings). A game counts once it
// reaches the end: quitting midway doesn't record anything. Online games are recorded by every
// player for themselves.

const STATS_KEY = 'arcane-tricks:stats';

export const EMPTY_STATS = Object.freeze({
  games: 0,
  wins: 0, // finished first, ties included
  soloGames: 0,
  onlineGames: 0,
  bestScore: null,
  totalScore: 0,
  rounds: 0,
  bidsHit: 0, // rounds where you took exactly the tricks you bid
  perfectGames: 0, // every bid hit
  streak: 0, // wins in a row, up to now
  bestStreak: 0,
});

/**
 * Add one finished game. `view` is your view of the table at the end (you are seat 0).
 * Returns the new stats and short highlights for the results screen.
 */
export function applyGame(stats, view, { multiplayer = false } = {}) {
  const me = view.players[0];
  const top = Math.max(...view.players.map((p) => p.score));
  const won = me.score === top;
  const rounds = view.history.length;
  const hits = view.history.filter((h) => h.results[0].bid === h.results[0].tricks).length;
  const perfect = rounds > 0 && hits === rounds;

  const next = { ...EMPTY_STATS, ...stats };
  const firstGame = next.games === 0;
  const newBest = next.bestScore === null || me.score > next.bestScore;
  next.games += 1;
  next.wins += won ? 1 : 0;
  next[multiplayer ? 'onlineGames' : 'soloGames'] += 1;
  next.totalScore += me.score;
  next.bestScore = newBest ? me.score : next.bestScore;
  next.rounds += rounds;
  next.bidsHit += hits;
  next.perfectGames += perfect ? 1 : 0;
  next.streak = won ? next.streak + 1 : 0;
  next.bestStreak = Math.max(next.bestStreak, next.streak);

  const highlights = [];
  if (newBest && !firstGame) highlights.push(`New personal best: ${me.score}!`);
  if (next.streak >= 2) highlights.push(`${next.streak} wins in a row!`);
  if (perfect) highlights.push('Perfect game: every bid hit!');
  return { stats: next, highlights };
}

/** The numbers shown on the Stats screen, as [label, value] pairs. */
export function statRows(stats) {
  const s = { ...EMPTY_STATS, ...stats };
  const pct = (part, whole) => (whole ? `${Math.round((100 * part) / whole)}%` : '–');
  return [
    ['Games played', String(s.games)],
    ['Wins', s.games ? `${s.wins} (${pct(s.wins, s.games)})` : '0'],
    ['Best score', s.bestScore === null ? '–' : String(s.bestScore)],
    ['Average score', s.games ? String(Math.round(s.totalScore / s.games)) : '–'],
    ['Bid accuracy', pct(s.bidsHit, s.rounds)],
    ['Perfect games', String(s.perfectGames)],
    ['Win streak', `${s.streak} (best ${s.bestStreak})`],
    ['Solo · online', `${s.soloGames} · ${s.onlineGames}`],
  ];
}

export function loadStats() {
  try {
    const raw = localStorage.getItem(STATS_KEY);
    if (raw) return { ...EMPTY_STATS, ...JSON.parse(raw) };
  } catch {
    // fall back to empty stats
  }
  return { ...EMPTY_STATS };
}

function saveStats(stats) {
  try {
    localStorage.setItem(STATS_KEY, JSON.stringify(stats));
  } catch {
    // storage unavailable (private window): stats just won't persist
  }
}

/** Record a finished game and return its highlights. */
export function recordGame(view, opts) {
  const { stats, highlights } = applyGame(loadStats(), view, opts);
  saveStats(stats);
  return highlights;
}

export function resetStats() {
  saveStats({ ...EMPTY_STATS });
}
