# Arcane Tricks (working title)

A WebXR trick-taking card game in the style of *Wizard*. Play against AI wizards at a candle-lit table,
in a VR headset or in any desktop browser.

> **About the name:** *Wizard* is a registered trademark of its publisher, so the game ships under its own
> name and its own suits (Flame, Tide, Grove, Sun) and art. The rules themselves aren't protected.
> Before you publish, choose a final title. It is set in `src/config.js`, `index.html` and `public/manifest.webmanifest`.

## Run it

```bash
npm install
npm run dev          # http://localhost:5173 — desktop browser, mouse controls
npm test             # rules engine + full bot-game simulations
npm run build        # static site in dist/
```

**Desktop controls:** click cards and buttons, hover a card on the table to inspect it, scroll to zoom
(toward the cursor), right-drag to look around, number keys to bid, Enter to continue, **M** to mute.

**VR controls:** point with a controller (or your hand) and pull the trigger (or pinch) to select.
Point at any face-up card on the table and it lifts toward you so you can read it.

**Options** (menu or status board): sound on/off, **Music** and **Effects** volume sliders, and **Seated / Standing** for VR.
Seated uses your real floor, so sit in a chair and the table is at real table height. Standing measures
your headset when you enter VR and raises the table to meet you. **Fit table to my height** re-measures at any time.

**Sound:** every effect is synthesized in code with Web Audio (`src/audio/Sound.js`), so there are no audio files
to license. In VR the effects are spatialized, so a bot's card sounds like it comes from its seat.
The background music is generated live (`src/audio/Music.js`): a slow modal chord pad, a wandering harp,
soft bass and candle crackle. It never loops exactly. Edit `SONG` and the chord constants there to change the mood.

### Testing without a headset

Install Meta's **Immersive Web Emulator** extension for Chrome or Edge. It adds a WebXR tab to DevTools
with a virtual Quest, so the **Enter VR** button works on your PC.

### Testing on a Quest

WebXR needs HTTPS when the page comes from anywhere other than `localhost`:

```bash
npm run dev:headset  # serves https://<your-pc-ip>:5173 with a self-signed cert
```

Open that address in the Quest browser, accept the certificate warning, then press **Enter VR**.
Your PC and the headset must be on the same Wi-Fi network.

## Online multiplayer

From the home screen, pick **Host an online table**. You get a 4-letter room code and a share link.
Friends pick **Join a table** and enter the code on the keypad, or just open the link.
Empty seats are filled by bots when you press **Start game**. Up to 6 players can join.

- **Quick chat:** six preset reactions (Nice!, Oops!…) appear as speech bubbles over your wizard.
  There's no free text or voice, so there's nothing to moderate.
- **Presence:** in VR, other players see your wizard's head and hands follow your real movements.
  Desktop players' wizards turn to face wherever they're looking.
- **Rejoin:** if a guest's connection drops (or they reload), the game waits 15 seconds for them,
  then a bot plays their turns until they're back. Rejoining with the same code, or just reloading,
  returns their seat and hand.
- **Names:** everyone starts with a random friendly name (Amber Owl, Cosmic Lynx…). **Change name** on the
  home screen opens an on-screen keyboard (point and click in VR, or just type on desktop) with a
  "Random name" button. Names are up to 16 letters, digits, spaces and `' . _ -`. The host re-checks
  every name it receives and numbers duplicates ("Amber Owl 2").

### How it works

It's peer-to-peer: the **host's browser runs the game** (`src/session/TableHost.js`) and the other
browsers connect to it directly over WebRTC (`src/net/PeerNet.js`, using [PeerJS](https://peerjs.com)).
Each player is sent only *their own view* of the table (`src/game/views.js`), so other players' hidden
cards never reach their browser. The same view-driven renderer (`src/session/Presenter.js`) draws solo
games, the host's table and every guest's table.

`tests/multiplayer.test.js` plays whole online games over an in-memory network (`src/net/LoopbackNet.js`).
It checks that no hidden card leaks, that a bot takes over after a drop, that rejoining works, and that
illegal answers from a modified client are refused.

### Limitations of the peer-to-peer setup

- **The host has to stay.** If the host closes their tab, the table ends for everyone.
  (Guests *can* drop out and rejoin.)
- **Some networks block direct connections** (strict school/office firewalls, some mobile carriers).
  Adding a TURN relay server to `PEER_OPTIONS` in `src/net/PeerNet.js` fixes this at a small hosting cost.
- **The connection broker is PeerJS's free public server** (0.peerjs.com). It only introduces the browsers
  to each other; game traffic doesn't pass through it. Before a big launch, run your own broker
  (`npx peerjs --port 9000`, or the `peer` npm package) and point `PEER_OPTIONS` at it.
- **The host's browser knows every hand** (it runs the game). That's fine among friends, but a public
  ranked mode would need a dedicated server instead. The engine already runs in Node, so moving
  `TableHost` onto a server later is straightforward.
- As with any WebRTC app, players' IP addresses are visible to each other.

## Rules

- A 60-card deck: four suits numbered 1–13, plus 4 Wizards and 4 Jesters.
- Round *N* deals *N* cards to each player, so the number of rounds is 60 ÷ players (3→20, 4→15, 5→12, 6→10).
- The next card is turned up for trump. A Jester means no trump. A Wizard means the dealer picks trump.
  In the last round there's no card left to turn, so there's no trump.
- Starting left of the dealer, everyone bids how many tricks they'll take.
- You must follow the lead suit if you can. Wizards and Jesters can always be played.
- The first Wizard played wins the trick. Otherwise the highest trump wins, then the highest card of the lead suit.
  If every card is a Jester, the first Jester wins.
- Scoring: an exact bid scores 20 + 10 per trick. Otherwise you lose 10 per trick you were off by.

### House rules (menu toggles)

| Toggle | Effect |
| --- | --- |
| Dealer can't make the bids add up | The dealer's bid can't make the total equal the number of tricks, so someone must miss |
| Hidden bids | Bids are revealed together after everyone has bid (not combinable with the dealer rule) |
| Round 1 on your forehead | In round 1 you see everyone's card except your own |
| Short game | Half the usual number of rounds |
| Fast bots | Bots think faster |

## Project layout

```
src/
  game/        Pure rules engine: no rendering, fully unit-tested
    cards.js     deck, suits, hand sorting
    rules.js     trump, follow-suit, trick winner, scoring, bid limits
    Game.js      round/bid/trick state machine
    bots.js      AI bidding and card play
    views.js     what each player may see, re-numbered so they're seat 0
  session/     TableHost (runs a table: solo or online), Presenter (draws one player's table),
               ClientSession (a guest at someone's table), PoseSync (head/hand tracking)
  net/         PeerJS transport, in-memory loopback for tests, protocol constants
  scene/       Three.js: world, table layout, cards, avatars, tweens, pointer input
  audio/       Synthesized, spatialized sound effects and generative music
  ui/          In-world canvas panels (menus, lobby, keypad, bids, status board, score pad, options)
  App.js       home menu → solo / host / join flows
tests/         Vitest: rule cases and hundreds of simulated bot games
```

The engine in `src/game` and the table logic in `src/session/TableHost.js` have no Three.js dependency,
so they also run in Node (that's how the tests play full online games).

## Publishing

`npm run build` outputs a static site in `dist/` with relative paths, so it works from any host or sub-folder.

- **GitHub Pages:** push to a GitHub repo, then under *Settings → Pages* set **Source: GitHub Actions**.
  `.github/workflows/deploy.yml` then builds, tests and deploys on every push to `main`.
- **Netlify / Cloudflare Pages / Vercel:** build command `npm run build`, output directory `dist`.
- **itch.io:** zip the *contents* of `dist/` and upload it as an HTML game. Check that VR works inside
  itch's iframe. Hosting the page at the top level (e.g. GitHub Pages) is the most reliable option for WebXR.
- **Meta Horizon Store (Quest):** the app is already a PWA (`public/manifest.webmanifest`).
  Meta's PWA tooling (`ovr-platform-util create-pwa`) wraps a hosted URL into an APK you can submit.
  Before doing that, add PNG icons (512×512 and 192×192) next to `icon.svg` and list them in the manifest.

## License

Copyright (c) 2026 pagnobi. **All rights reserved.** The source is visible for reference only.
No permission is granted to use, copy, modify or distribute it. See [LICENSE](LICENSE).

## Roadmap ideas

- Self-hosted PeerJS broker + TURN relay for reliability, or a dedicated server for public matchmaking
- Let a new player take over a bot's seat mid-game
- Smarter bots (card counting, reading other players' bids), plus difficulty levels
- Grab-and-throw card play with hand tracking
