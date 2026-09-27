// Working title. "Wizard" is a registered trademark of its publisher, so the game ships
// under its own name — change it here (and in index.html / manifest) when you pick one.
export const GAME_TITLE = 'Arcane Tricks';
export const GAME_TAGLINE = 'A trick-taking card game of wizards and jesters';

export const BOT_NAMES = ['Merlin', 'Morgana', 'Gandra', 'Elspeth', 'Thorne', 'Zephyr', 'Isolde', 'Balthazar'];

export const DEFAULT_SETTINGS = {
  numPlayers: 4,
  dealerRestriction: false,
  blindBids: false,
  foreheadFirstRound: false,
  shortGame: false,
  fastBots: false,
};

const STORAGE_KEY = 'arcane-tricks:settings';

export function loadSettings() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const s = { ...DEFAULT_SETTINGS, ...JSON.parse(raw) };
      s.numPlayers = Math.min(6, Math.max(3, Number(s.numPlayers) || DEFAULT_SETTINGS.numPlayers));
      return s;
    }
  } catch {
    // storage unavailable (private mode, blocked site data) — fall back to defaults
  }
  return { ...DEFAULT_SETTINGS };
}

export function saveSettings(settings) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
  } catch {
    // non-essential
  }
}

// Player preferences (not game rules), changed from the Options panel at any time.
export const DEFAULT_PREFS = {
  sound: true, // master on/off
  musicVolume: 0.5, // 0–1
  sfxVolume: 0.8, // 0–1
  vrPosture: 'seated', // 'seated' | 'standing'
  name: null, // your display name at online tables (a random one is picked on first run)
};

const PREFS_KEY = 'arcane-tricks:prefs';

export function loadPrefs() {
  try {
    const raw = localStorage.getItem(PREFS_KEY);
    if (raw) return { ...DEFAULT_PREFS, ...JSON.parse(raw) };
  } catch {
    // fall back to defaults
  }
  return { ...DEFAULT_PREFS };
}

export function savePrefs(prefs) {
  try {
    localStorage.setItem(PREFS_KEY, JSON.stringify(prefs));
  } catch {
    // non-essential
  }
}

/**
 * Change some preferences, merging into what's *currently stored* — so a second tab with an
 * older copy of the preferences can't overwrite settings it didn't touch. Returns the result.
 */
export function updatePrefs(patch) {
  const next = { ...loadPrefs(), ...patch };
  savePrefs(next);
  return next;
}

/** Call `fn(prefs)` when another tab changes the preferences. */
export function onPrefsChangedElsewhere(fn) {
  window.addEventListener('storage', (e) => {
    if (e.key === PREFS_KEY) fn(loadPrefs());
  });
}
