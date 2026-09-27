import { describe, expect, it } from 'vitest';
import { Game } from '../src/game/Game.js';
import { seededRandom } from '../src/game/random.js';
import { TableView, toGameSeat, toViewSeat, viewFor } from '../src/game/views.js';
import { LoopbackHub } from '../src/net/LoopbackNet.js';
import { ClientSession } from '../src/session/ClientSession.js';
import { TableHost } from '../src/session/TableHost.js';
import { NAME_MAX, normalizeCode, isValidCode, makeRoomCode, sanitizeName } from '../src/net/protocol.js';

const noPause = () => Promise.resolve();
const settle = () => new Promise((r) => setTimeout(r, 0));

/** A presenter with no graphics: records events and answers prompts with the first legal option. */
class HeadlessPresenter {
  constructor() {
    this.events = [];
    this.prompts = [];
    this.poses = [];
    this.emotes = [];
  }

  async handle(event) {
    this.events.push(event);
  }

  async prompt(kind, data) {
    this.prompts.push({ kind, data });
    if (kind === 'trump') return 'sun';
    if (kind === 'bid') return data.allowed[0];
    return data.legal[0];
  }

  pose(seat, pose) {
    this.poses.push({ seat, pose });
  }

  emote(seat, emote) {
    this.emotes.push({ seat, emote });
  }
}

/** Every view a player receives must hide other players' cards (except the forehead round). */
function assertNoLeaks(events) {
  for (const e of events) {
    if (!e.view) continue;
    const view = new TableView(e.view);
    view.players.forEach((p, seat) => {
      const shouldSee = view.isForeheadRound ? seat !== 0 : seat === 0;
      for (const c of p.hand) expect(c === null).toBe(!shouldSee);
      if (seat !== 0 && view.variants.blindBids && view.phase === 'bidding' && p.bid !== null) expect(p.bid).toBe('?');
    });
  }
}

async function makeTable({ remotes = 2, settings = {}, graceMs = 50 } = {}) {
  const hub = new LoopbackHub();
  const hostPresenter = new HeadlessPresenter();
  const host = new TableHost({
    presenter: hostPresenter,
    net: hub.createHost(),
    hostName: 'Host',
    settings: { numPlayers: 4, fastBots: true, ...settings },
    rng: seededRandom(7),
    pause: noPause,
    graceMs,
  });
  const code = await host.openRoom('ABCD');
  const clients = [];
  for (let i = 0; i < remotes; i++) {
    const presenter = new HeadlessPresenter();
    const nets = [];
    const session = new ClientSession({
      createNet: () => {
        const net = hub.createClient();
        nets.push(net);
        return net;
      },
      presenter,
      clientId: `client-${i}`,
      name: `Guest ${i}`,
    });
    await session.join(code);
    clients.push({ session, presenter, nets });
  }
  await settle();
  return { hub, host, hostPresenter, clients, code };
}

describe('views', () => {
  it('rotate seats so the viewer is always seat 0', () => {
    for (let n = 3; n <= 6; n++) {
      for (let viewer = 0; viewer < n; viewer++) {
        for (let s = 0; s < n; s++) expect(toGameSeat(toViewSeat(s, viewer, n), viewer, n)).toBe(s);
        expect(toViewSeat(viewer, viewer, n)).toBe(0);
      }
    }
  });

  it('hide other hands, reveal them only in the forehead round', () => {
    const seats = Array.from({ length: 4 }, () => ({ kind: 'remote', connected: true }));
    const game = new Game({ players: seats.map((_, i) => ({ name: `P${i}` })), variants: { foreheadFirstRound: true }, rng: seededRandom(1) });
    game.startRound(); // round 1: forehead
    const v1 = viewFor(game, 2, seats);
    expect(v1.players[0].name).toBe('P2');
    expect(v1.players[0].hand).toEqual([null]);
    expect(v1.players[1].hand[0]).not.toBeNull();
    while (game.phase !== 'roundOver') {
      if (game.phase === 'chooseTrump') game.chooseTrump('sun');
      if (game.phase === 'bidding') game.placeBid(game.turn, game.allowedBidsFor(game.turn)[0]);
      if (game.phase === 'playing') game.playCard(game.turn, game.legalMovesFor(game.turn)[0].id);
    }
    game.startRound(); // round 2: normal
    const v2 = viewFor(game, 1, seats);
    expect(v2.players[0].hand.every((c) => c !== null)).toBe(true);
    expect(v2.players.slice(1).every((p) => p.hand.every((c) => c === null))).toBe(true);
  });
});

describe('room codes', () => {
  it('are 4 unambiguous letters', () => {
    const code = makeRoomCode();
    expect(isValidCode(code)).toBe(true);
    expect(normalizeCode(' ab-cd ')).toBe('ABCD');
    expect(normalizeCode('o0i1')).toBe(''); // ambiguous characters are never used
  });
});

describe('player names', () => {
  it('are cleaned up: allowed characters only, tidy spaces, length capped', () => {
    expect(sanitizeName('  Jake   the  Great ')).toBe('Jake the Great');
    expect(sanitizeName('Zoë O’Brien')).toBe('Zoë OBrien'); // curly apostrophe isn't allowed; straight ' is
    expect(sanitizeName("D'Artagnan-2.0")).toBe("D'Artagnan-2.0");
    expect(sanitizeName('<script>alert(1)</script>')).toBe('scriptalert1scri'); // stripped, then capped at 16
    expect(sanitizeName('🔥Fire🔥 Mage\n\t')).toBe('Fire Mage');
    expect(sanitizeName('A'.repeat(40))).toHaveLength(NAME_MAX);
    expect(sanitizeName('   ')).toBe('');
    expect(sanitizeName(null)).toBe('');
  });

  it('the host cleans names from guests, falls back to "Guest", and numbers duplicates', async () => {
    const hub = new LoopbackHub();
    const host = new TableHost({ presenter: new HeadlessPresenter(), net: hub.createHost(), hostName: 'Merlin', settings: { numPlayers: 3 }, pause: noPause });
    await host.openRoom('NAME');
    const join = async (clientId, name) => {
      const s = new ClientSession({ createNet: () => hub.createClient(), presenter: new HeadlessPresenter(), clientId, name });
      await s.join('NAME');
    };
    await join('a', 'Merlin'); // same as the host
    await join('b', 'Merlin');
    await join('c', '\u0000💣'); // nothing usable left
    await join('d', 'X'.repeat(50));
    await settle();
    expect(host.seats.map((s) => s.name)).toEqual(['Merlin', 'Merlin 2', 'Merlin 3', 'Guest', 'X'.repeat(NAME_MAX)]);
    // Bots never borrow a player's name.
    await host.start().catch(() => {});
  });
});

describe('online table (loopback network)', () => {
  it('lobby lists joined players and grows the table to fit them', async () => {
    const { host, clients } = await makeTable({ remotes: 3, settings: { numPlayers: 3 } });
    expect(host.seats.map((s) => s.kind)).toEqual(['local', 'remote', 'remote', 'remote']);
    expect(host.settings.numPlayers).toBe(4);
    const lobbies = [];
    clients[2].session.on('lobby', (l) => lobbies.push(l));
    host.updateSettings({ shortGame: true });
    await settle();
    expect(lobbies.at(-1).yourSeat).toBe(3);
    expect(lobbies.at(-1).settings.shortGame).toBe(true);
  });

  it('plays a full game with 2 remote players and a bot, leaking no hidden cards', async () => {
    const { host, hostPresenter, clients } = await makeTable({
      remotes: 2,
      settings: { numPlayers: 4, shortGame: true, foreheadFirstRound: true, blindBids: true },
    });
    await host.start();
    await settle();
    expect(host.game.phase).toBe('gameOver');
    expect(host.seats.map((s) => s.kind)).toEqual(['local', 'remote', 'remote', 'bot']);

    for (const c of [{ presenter: hostPresenter }, ...clients]) {
      // Forehead round: the play prompt must not reveal your own card.
      const firstPlay = c.presenter.prompts.find((p) => p.kind === 'play');
      expect(firstPlay.data.legal).toEqual(['?']);
      const types = c.presenter.events.map((e) => e.type);
      expect(types[0]).toBe('game');
      expect(types.at(-1)).toBe('gameEnd');
      expect(types.filter((t) => t === 'roundEnd')).toHaveLength(host.game.totalRounds);
      expect(c.presenter.prompts.length).toBeGreaterThan(0);
      assertNoLeaks(c.presenter.events);
    }
    // Each client sees the same final scores, rotated so they are seat 0.
    const final = host.game.players.map((p) => p.score);
    clients.forEach((c, i) => {
      const last = c.presenter.events.at(-1).view;
      expect(last.players.map((p) => p.score)).toEqual(final.map((_, v) => final[toGameSeat(v, i + 1, 4)]));
      expect(last.players[0].name).toBe(`Guest ${i}`);
    });
  });

  it('lets a bot take over after a drop, then gives the seat back on rejoin', async () => {
    const hub = new LoopbackHub();
    const hostPresenter = new HeadlessPresenter();
    // Slow the table down a little so the guest can come back mid-game.
    const host = new TableHost({
      presenter: hostPresenter,
      net: hub.createHost(),
      settings: { numPlayers: 3 },
      rng: seededRandom(3),
      pause: () => new Promise((r) => setTimeout(r, 2)),
      graceMs: 30,
    });
    await host.openRoom('WXYZ');
    let networkUp = true;
    const presenter = new HeadlessPresenter();
    const guest = new ClientSession({
      createNet: () => {
        const net = hub.createClient();
        if (!networkUp) net.connect = async () => Promise.reject(new Error('offline'));
        return net;
      },
      presenter,
      clientId: 'guest',
      name: 'Guest',
      reconnectEveryMs: 10,
    });
    await guest.join('WXYZ');
    await settle();

    // The first time the guest is asked anything, their Wi-Fi dies.
    let dropped = false;
    let eventsAtDrop = 0;
    const originalPrompt = presenter.prompt.bind(presenter);
    presenter.prompt = (kind, data) => {
      if (!dropped) {
        dropped = true;
        eventsAtDrop = hostPresenter.events.length;
        networkUp = false;
        guest.net.drop();
        return new Promise(() => {}); // never answers
      }
      return originalPrompt(kind, data);
    };
    const reconnected = new Promise((r) => guest.on('reconnected', r));
    const game = host.start();

    // The game must keep going with a bot in the guest's seat.
    const until = async (check) => {
      for (let i = 0; i < 200 && !check(); i++) await new Promise((r) => setTimeout(r, 5));
      return check();
    };
    expect(await until(() => dropped && hostPresenter.events.length > eventsAtDrop + 3)).toBe(true);
    expect(host.seats[1].connected).toBe(false);

    networkUp = true;
    await reconnected;
    await game;
    await settle();
    expect(host.game.phase).toBe('gameOver');
    expect(host.seats[1].connected).toBe(true);
    const snapshot = presenter.events.find((e) => e.type === 'snapshot');
    expect(snapshot.view.players[0].name).toBe('Guest');
    expect(presenter.events.at(-1).type).toBe('gameEnd');
    assertNoLeaks(presenter.events);
  });

  it('rejects joins once the game has started, and bad answers are re-asked', async () => {
    const { host, hub, clients } = await makeTable({ remotes: 1, settings: { numPlayers: 3, shortGame: true } });
    const guest = clients[0];
    const originalPrompt = guest.presenter.prompt.bind(guest.presenter);
    let cheated = false;
    guest.presenter.prompt = async (kind, data) => {
      if (!cheated && kind === 'bid') {
        cheated = true;
        return 99; // not a legal bid
      }
      return originalPrompt(kind, data);
    };
    const game = host.start();
    await settle();
    const late = new ClientSession({ createNet: () => hub.createClient(), presenter: new HeadlessPresenter(), clientId: 'late', name: 'Late' });
    const reasons = [];
    late.on('rejected', (r) => reasons.push(r));
    await late.join('ABCD');
    await game;
    await settle();
    expect(reasons).toEqual(['started']);
    expect(cheated).toBe(true);
    expect(host.game.history.every((h) => h.results[1].bid !== 99)).toBe(true);
  });

  it('joining never hangs: a host that never replies gives a clear "no-reply" error', async () => {
    const hub = new LoopbackHub();
    const silentHost = hub.createHost(); // accepts connections but runs no table
    await silentHost.open('MUTE');
    const stages = [];
    const guest = new ClientSession({
      createNet: () => hub.createClient(),
      presenter: new HeadlessPresenter(),
      clientId: 'g',
      name: 'Guest',
      replyTimeoutMs: 30,
    });
    await expect(guest.join('MUTE', (s) => stages.push(s))).rejects.toThrow('no-reply');
    expect(stages).toEqual(['hello']);
    // …and a missing table fails straight away.
    const lost = new ClientSession({ createNet: () => hub.createClient(), presenter: new HeadlessPresenter(), clientId: 'h', name: 'Guest' });
    await expect(lost.join('NONE')).rejects.toThrow('not-found');
  });

  it('relays poses and emotes in each receiver’s seat numbering', async () => {
    const { host, hostPresenter, clients } = await makeTable({ remotes: 2, settings: { numPlayers: 3 } });
    const game = host.start();
    await settle();
    clients[0].session.sendPose({ h: [0, 1.2, 0, 0, 0, 0, 1] });
    clients[1].session.sendEmote('Nice!');
    clients[1].session.sendEmote('not an emote');
    await settle();
    await settle();
    expect(hostPresenter.poses[0].seat).toBe(1); // guest 0 is game seat 1 → host view seat 1
    expect(clients[1].presenter.poses[0].seat).toBe(2); // seat 1 as seen from seat 2
    expect(hostPresenter.emotes).toEqual([{ seat: 2, emote: 'Nice!' }]);
    expect(clients[1].presenter.emotes).toEqual([{ seat: 0, emote: 'Nice!' }]);
    host.abort();
    await game.catch(() => {});
  });
});
