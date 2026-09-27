import { loadSettings, saveSettings } from './config.js';
import { ClientSession } from './session/ClientSession.js';
import { Presenter } from './session/Presenter.js';
import { PoseSync } from './session/PoseSync.js';
import { Aborted, TableHost } from './session/TableHost.js';
import { PeerClient, PeerHost } from './net/PeerNet.js';
import { isValidCode, normalizeCode, randomId } from './net/protocol.js';

const CLIENT_ID_KEY = 'arcane-tricks:clientId';

function loadClientId() {
  try {
    let id = localStorage.getItem(CLIENT_ID_KEY);
    if (!id) {
      id = randomId();
      localStorage.setItem(CLIENT_ID_KEY, id);
    }
    return id;
  } catch {
    return randomId();
  }
}

/** Keep ?room=CODE in the address bar while at a table, so a reload rejoins the same seat. */
function setRoomInUrl(code) {
  try {
    const url = new URL(location.href);
    if (code) url.searchParams.set('room', code);
    else url.searchParams.delete('room');
    history.replaceState(null, '', url);
  } catch {
    // not important
  }
}

function explainError(err, code) {
  switch (err?.message) {
    case 'not-found':
      return `No table found with code ${code}. Check the code, and that the host still has the table open.`;
    case 'offline':
      return 'Couldn’t reach the matchmaking service. Check your internet connection and try again.';
    case 'timeout':
      return 'The host didn’t answer. Some networks (school, office, strict firewalls) block direct connections between players.';
    default:
      return `Connection problem (${err?.message ?? 'unknown'}). Please try again.`;
  }
}

const REJECTED = {
  full: 'That table is full — 6 players is the most.',
  started: 'That game has already started. Ask the host to start a new table.',
  version: 'That table is running a different version of the game. Both players should reload the page.',
};

/**
 * Top-level flow: home menu → solo game, hosting a table, or joining one → back to the menu.
 */
export class App {
  constructor({ world, cards, avatars, hud, sound, getName, rerollName }) {
    this.world = world;
    this.cards = cards;
    this.avatars = avatars;
    this.hud = hud;
    this.getName = getName;
    this.rerollName = rerollName;
    this.presenter = new Presenter({ cards, avatars, hud, sound });
    this.poseSync = new PoseSync(world);
    this.clientId = loadClientId();
    this.session = null; // { quit(), emote(text) } for whatever table we're at
    this.autoplay = false; // dev/testing: bots play your seat when you host or play solo
    hud.onQuit = () => this.session?.quit();
    hud.onEmote = (emote) => this.session?.emote(emote);
  }

  async run() {
    let joinCode = normalizeCode(new URLSearchParams(location.search).get('room') ?? '');
    for (;;) {
      let choice = 'join';
      if (!isValidCode(joinCode)) {
        joinCode = null;
        choice = await this.hud.showHome({ getName: this.getName, onReroll: this.rerollName });
      }
      try {
        if (choice === 'solo') await this.#solo();
        else if (choice === 'host') await this.#host();
        else await this.#join(joinCode);
      } catch (err) {
        if (!(err instanceof Aborted)) {
          console.error(err);
          await this.hud.showMessage({ title: 'Something went wrong', body: String(err?.message ?? err) });
        }
      }
      joinCode = null;
      await this.#cleanup();
    }
  }

  async #cleanup() {
    this.session = null;
    this.poseSync.stop();
    this.presenter.abort();
    this.cards.clearSelectable();
    this.avatars.clear();
    this.hud.hideGameUi();
    setRoomInUrl(null);
    await this.cards.gatherAll();
  }

  async #solo() {
    const settings = await this.hud.showSoloSetup(loadSettings());
    if (!settings) return;
    saveSettings(settings);
    const host = new TableHost({ presenter: this.presenter, hostName: this.getName(), settings });
    host.autoplay = this.autoplay;
    this.presenter.reset('host');
    this.session = { quit: () => host.abort(), emote: () => {} };
    this.table = host;
    await host.start();
  }

  async #host() {
    const net = new PeerHost();
    const host = new TableHost({ presenter: this.presenter, net, hostName: this.getName(), settings: loadSettings() });
    host.autoplay = this.autoplay;
    this.table = host;
    this.hud.showBusy('Opening your table…', 'Getting a room code');
    try {
      await host.openRoom();
    } catch (err) {
      net.close();
      await this.hud.showMessage({ title: 'Couldn’t open a table', body: explainError(err) });
      return;
    }
    const link = `${location.origin}${location.pathname}?room=${host.code}`;
    const stopListening = host.on('lobby', (lobby) => this.hud.updateLobby(lobby));
    const choice = await this.hud.openHostLobby(host.lobbyInfo(0), { link, onChange: (s) => host.updateSettings(s) });
    stopListening();
    if (choice !== 'start') {
      host.abort();
      net.close();
      return;
    }
    saveSettings(host.settings);
    this.presenter.reset('host');
    this.session = { quit: () => host.abort(), emote: (e) => host.sendLocalEmote(e) };
    this.poseSync.start((pose) => host.sendLocalPose(pose));
    try {
      await host.start();
    } finally {
      host.abort(); // tells guests the table is closed
      setTimeout(() => net.close(), 500);
    }
  }

  async #join(initialCode) {
    let code = initialCode;
    let error = null;
    for (;;) {
      if (!code) code = await this.hud.askRoomCode({ error });
      if (!code) return;
      this.hud.showBusy(`Joining table ${code}…`, 'Connecting to the host');
      const session = new ClientSession({ createNet: () => new PeerClient(), presenter: this.presenter, clientId: this.clientId, name: this.getName() });
      this.presenter.reset('guest');
      const outcome = this.#guestOutcome(session);
      try {
        await session.join(code);
      } catch (err) {
        session.leave();
        error = explainError(err, code);
        if (initialCode) {
          // Came from a link or reload — say what happened, then go back to the menu.
          await this.hud.showMessage({ title: 'Couldn’t join', body: error });
          return;
        }
        continue; // back to the keypad with the error shown
      }
      setRoomInUrl(code);
      const result = await outcome;
      if (result.kind === 'rejected') await this.hud.showMessage({ title: 'Couldn’t join', body: REJECTED[result.reason] ?? 'The host turned the request down.' });
      if (result.kind === 'closed') await this.hud.showMessage({ title: 'Table closed', body: 'The host has closed the table.' });
      if (result.kind === 'lost') await this.hud.showMessage({ title: 'Connection lost', body: 'Couldn’t reconnect to the host. If they’re still playing, rejoin with the same code to get your seat back.' });
      return;
    }
  }

  /** Wire a guest session to the UI; resolves with how the visit ended. */
  #guestOutcome(session) {
    return new Promise((resolve) => {
      let inLobby = false;
      const finish = (result) => {
        this.poseSync.stop();
        this.presenter.abort();
        resolve(result);
      };
      this.session = {
        quit: () => {
          session.leave();
          finish({ kind: 'left' });
        },
        emote: (e) => session.sendEmote(e),
      };
      session.on('lobby', (lobby) => {
        if (inLobby) return this.hud.updateLobby(lobby);
        inLobby = true;
        this.hud.openGuestLobby(lobby).then(
          (value) => {
            inLobby = false;
            if (value === 'leave') this.session.quit();
          },
          () => {
            inLobby = false;
          },
        );
      });
      session.on('started', () => {
        if (inLobby) this.hud.finishPrompt('started');
        inLobby = false;
        this.poseSync.start((pose) => session.sendPose(pose));
      });
      session.on('reconnecting', () => this.hud.flashMessage('Connection lost — reconnecting…', 6));
      session.on('reconnected', () => this.hud.flashMessage('Reconnected!'));
      session.on('rejected', (reason) => finish({ kind: 'rejected', reason }));
      session.on('closed', () => finish({ kind: 'closed' }));
      session.on('lost', () => finish({ kind: 'lost' }));
      session.on('ended', () => {
        session.leave();
        finish({ kind: 'ended' });
      });
    });
  }
}
