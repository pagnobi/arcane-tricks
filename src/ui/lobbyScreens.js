import { FONTS, THEME, drawPanelBackground, roundRect, text, wrappedText } from './draw.js';
import { totalRounds } from '../game/rules.js';
import { CODE_ALPHABET, CODE_LENGTH } from '../net/protocol.js';
import { GAME_TAGLINE, GAME_TITLE } from '../config.js';

// Drawing for the menu / lobby screens. Each function paints a Panel and registers its buttons;
// the Hud decides what the buttons do.

export const HOUSE_RULES = [
  ['dealerRestriction', 'Dealer can’t make the bids add up'],
  ['blindBids', 'Hidden bids (revealed together)'],
  ['foreheadFirstRound', 'Round 1: your card is on your forehead'],
  ['shortGame', 'Short game (half the rounds)'],
  ['fastBots', 'Fast bots'],
];

/** Player-count stepper + house-rule toggles. Mutates `s` and calls onChange(). */
export function drawRules(ctx, p, s, { x, y, w, humans = 1, onChange }) {
  const minPlayers = Math.max(3, humans);
  text(ctx, 'Players', x + 12, y, { font: `bold 30px ${FONTS.sans}`, align: 'left' });
  p.button('minus', { x: x + 148, y: y - 27, w: 54, h: 54 }, '−', {
    size: 34,
    disabled: s.numPlayers <= minPlayers,
    onClick: () => {
      s.numPlayers -= 1;
      onChange();
    },
  });
  text(ctx, String(s.numPlayers), x + 237, y, { font: `bold 40px ${FONTS.sans}` });
  p.button('plus', { x: x + 272, y: y - 27, w: 54, h: 54 }, '+', {
    size: 34,
    disabled: s.numPlayers >= 6,
    onClick: () => {
      s.numPlayers += 1;
      onChange();
    },
  });
  const bots = s.numPlayers - humans;
  const who = humans === 1 ? `You + ${bots} bot${bots === 1 ? '' : 's'}` : `${humans} players + ${bots} bot${bots === 1 ? '' : 's'}`;
  text(ctx, `${who} · ${totalRounds(s.numPlayers, s)} rounds`, x + w - 12, y + 44, { font: `21px ${FONTS.sans}`, align: 'right', fill: THEME.muted });

  text(ctx, 'House rules', x + 12, y + 88, { font: `bold 24px ${FONTS.sans}`, align: 'left', fill: THEME.gold });
  HOUSE_RULES.forEach(([key, label], i) => {
    p.toggle(key, { x, y: y + 108 + i * 52, w, h: 46 }, label, !!s[key], () => {
      s[key] = !s[key];
      // Hidden bids and the dealer restriction can't both apply.
      if (key === 'blindBids' && s.blindBids) s.dealerRestriction = false;
      if (key === 'dealerRestriction' && s.dealerRestriction) s.blindBids = false;
      onChange();
    });
  });
}

export function drawHome(ctx, p, { name, onPick, onRename, onOptions, optionsOpen }) {
  const W = p.pxWidth;
  const H = p.pxHeight;
  drawPanelBackground(ctx, W, H);
  text(ctx, GAME_TITLE, W / 2, 68, { font: `bold 58px ${FONTS.serif}`, fill: THEME.gold });
  text(ctx, GAME_TAGLINE, W / 2, 114, { font: `24px ${FONTS.sans}`, fill: THEME.muted });

  text(ctx, 'Playing as', 60, 178, { font: `21px ${FONTS.sans}`, align: 'left', fill: THEME.muted });
  text(ctx, name, 60, 212, { font: `bold 32px ${FONTS.serif}`, align: 'left', fill: THEME.text, maxWidth: 420 });
  p.button('rename', { x: W - 230, y: 172, w: 180, h: 48 }, 'Change name', { size: 21, onClick: onRename });

  const bx = W / 2 - 220;
  p.button('solo', { x: bx, y: 256, w: 440, h: 64 }, 'Play vs bots', { primary: true, size: 28, onClick: () => onPick('solo') });
  p.button('host', { x: bx, y: 336, w: 440, h: 64 }, 'Host an online table', { size: 26, onClick: () => onPick('host') });
  p.button('join', { x: bx, y: 416, w: 440, h: 64 }, 'Join a table', { size: 26, onClick: () => onPick('join') });

  p.button('options', { x: 40, y: H - 76, w: 140, h: 52 }, 'Options', { size: 22, selected: optionsOpen, onClick: onOptions });
  text(ctx, 'Online: share a 4-letter room code with friends', W - 40, H - 50, {
    font: `19px ${FONTS.sans}`,
    align: 'right',
    fill: THEME.muted,
    maxWidth: W - 240,
  });
}

function seatRow(ctx, x, y, w, label, tag, { you = false, dim = false } = {}) {
  if (you) {
    roundRect(ctx, x - 10, y - 20, w + 20, 40, 10);
    ctx.fillStyle = 'rgba(232,198,106,0.12)';
    ctx.fill();
  }
  text(ctx, label, x, y, { font: `bold 25px ${FONTS.sans}`, align: 'left', fill: dim ? THEME.muted : you ? THEME.gold : THEME.text, maxWidth: w - 140 });
  text(ctx, tag, x + w, y, { font: `bold 17px ${FONTS.sans}`, align: 'right', fill: THEME.muted });
}

function seatList(ctx, lobby, { x, y, w, numPlayers, yourSeat }) {
  const rows = Math.max(numPlayers, lobby.seats.length);
  for (let i = 0; i < rows; i++) {
    const s = lobby.seats[i];
    const ry = y + i * 42;
    if (!s) seatRow(ctx, x, ry, w, 'Empty seat', 'A BOT WILL PLAY', { dim: true });
    else seatRow(ctx, x, ry, w, i === yourSeat ? `${s.name} (you)` : s.name, i === 0 ? 'HOST' : s.connected ? 'JOINED' : 'CONNECTING', { you: i === yourSeat });
  }
}

export function drawHostLobby(ctx, p, { lobby, settings, link, copied, onCopy, onChange, onStart, onCancel }) {
  const W = p.pxWidth;
  const H = p.pxHeight;
  drawPanelBackground(ctx, W, H);
  const lx = 44;
  text(ctx, 'Your online table', lx, 56, { font: `bold 38px ${FONTS.serif}`, align: 'left', fill: THEME.gold });
  text(ctx, 'Room code', lx, 104, { font: `21px ${FONTS.sans}`, align: 'left', fill: THEME.muted });
  text(ctx, lobby.code.split('').join(' '), lx, 152, { font: `bold 72px ${FONTS.sans}`, align: 'left', fill: THEME.text });

  const label = (what, normal) => (copied?.what === what ? (copied.ok ? 'Copied!' : 'Couldn’t copy') : normal);
  p.button('copy-code', { x: lx, y: 196, w: 170, h: 46 }, label('code', 'Copy code'), {
    size: 20,
    selected: copied?.what === 'code',
    onClick: () => onCopy('code'),
  });
  p.button('copy-link', { x: lx + 182, y: 196, w: 230, h: 46 }, label('link', 'Copy invite link'), {
    size: 20,
    primary: true,
    onClick: () => onCopy('link'),
  });
  text(ctx, 'The link joins in one click — no typing needed.', lx, 266, { font: `18px ${FONTS.sans}`, align: 'left', fill: THEME.muted });
  text(ctx, link, lx, 292, { font: `bold 17px ${FONTS.sans}`, align: 'left', fill: THEME.gold, maxWidth: 420 });

  text(ctx, 'Seats', lx, 336, { font: `bold 24px ${FONTS.sans}`, align: 'left', fill: THEME.gold });
  seatList(ctx, lobby, { x: lx, y: 372, w: 400, numPlayers: settings.numPlayers, yourSeat: 0 });

  ctx.strokeStyle = 'rgba(201,165,76,0.3)';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(488, 40);
  ctx.lineTo(488, H - 110);
  ctx.stroke();
  drawRules(ctx, p, settings, { x: 510, y: 70, w: W - 550, humans: lobby.seats.length, onChange });

  p.button('cancel', { x: lx, y: H - 84, w: 180, h: 58 }, 'Close table', { size: 22, onClick: onCancel });
  p.button('start', { x: W - 340, y: H - 88, w: 300, h: 64 }, 'Start game', { primary: true, size: 30, onClick: onStart });
}

export function drawKeypad(ctx, p, { code, error, onKey, onBack, onJoin, onCancel }) {
  const W = p.pxWidth;
  const H = p.pxHeight;
  drawPanelBackground(ctx, W, H);
  text(ctx, 'Join a table', W / 2, 50, { font: `bold 38px ${FONTS.serif}`, fill: THEME.gold });
  text(ctx, 'Enter the 4-letter room code', W / 2, 90, { font: `22px ${FONTS.sans}`, fill: THEME.muted });

  const boxW = 84;
  const bx0 = W / 2 - (CODE_LENGTH * (boxW + 14) - 14) / 2;
  for (let i = 0; i < CODE_LENGTH; i++) {
    roundRect(ctx, bx0 + i * (boxW + 14), 118, boxW, 92, 14);
    ctx.fillStyle = THEME.button;
    ctx.fill();
    ctx.lineWidth = 3;
    ctx.strokeStyle = i === code.length ? THEME.gold : 'rgba(232,198,106,0.4)';
    ctx.stroke();
    if (code[i]) text(ctx, code[i], bx0 + i * (boxW + 14) + boxW / 2, 166, { font: `bold 56px ${FONTS.sans}` });
  }
  if (error) text(ctx, error, W / 2, 236, { font: `bold 21px ${FONTS.sans}`, fill: THEME.bad, maxWidth: W - 40 });

  const cols = 8;
  const x0 = (W - (cols * 72 - 8)) / 2;
  [...CODE_ALPHABET].forEach((ch, i) => {
    p.button(`key-${ch}`, { x: x0 + (i % cols) * 72, y: 262 + Math.floor(i / cols) * 64, w: 64, h: 56 }, ch, {
      size: 28,
      disabled: code.length >= CODE_LENGTH,
      onClick: () => onKey(ch),
    });
  });
  const by = H - 84;
  p.button('cancel', { x: x0, y: by, w: 150, h: 58 }, 'Cancel', { size: 22, onClick: onCancel });
  p.button('back', { x: x0 + 166, y: by, w: 110, h: 58 }, '⌫', { size: 28, disabled: !code.length, onClick: onBack });
  p.button('join', { x: W - x0 - 250, y: by, w: 250, h: 58 }, 'Join', { primary: true, size: 28, disabled: code.length < CODE_LENGTH, onClick: onJoin });
}

const NAME_ROWS = ['1234567890', 'QWERTYUIOP', 'ASDFGHJKL', "ZXCVBNM'-."];

/**
 * On-screen keyboard for your display name — pointable in VR, clickable on desktop
 * (where you can also just type). `shift` capitalises the next letter.
 */
export function drawNameEditor(ctx, p, { name, max, shift, onKey, onShift, onSpace, onBack, onRandom, onCancel, onSave }) {
  const W = p.pxWidth;
  const H = p.pxHeight;
  drawPanelBackground(ctx, W, H);
  text(ctx, 'Your name', W / 2, 48, { font: `bold 38px ${FONTS.serif}`, fill: THEME.gold });

  // The text field
  roundRect(ctx, 44, 82, W - 88, 84, 14);
  ctx.fillStyle = THEME.button;
  ctx.fill();
  ctx.lineWidth = 3;
  ctx.strokeStyle = THEME.gold;
  ctx.stroke();
  ctx.font = `bold 44px ${FONTS.sans}`;
  const caretX = Math.min(70 + ctx.measureText(name).width + 4, W - 150);
  text(ctx, name, 70, 126, { font: `bold 44px ${FONTS.sans}`, align: 'left', maxWidth: W - 230 });
  ctx.fillStyle = THEME.gold;
  ctx.fillRect(caretX, 102, 4, 46);
  text(ctx, `${name.length}/${max}`, W - 64, 126, { font: `20px ${FONTS.sans}`, align: 'right', fill: THEME.muted });
  text(ctx, 'Shown to other players at online tables', W / 2, 192, { font: `19px ${FONTS.sans}`, fill: THEME.muted });

  const full = name.length >= max;
  const keyW = 80;
  const gap = 8;
  NAME_ROWS.forEach((row, r) => {
    const x0 = (W - (row.length * (keyW + gap) - gap)) / 2;
    [...row].forEach((ch, i) => {
      const letter = /[A-Z]/.test(ch);
      const label = letter && !shift ? ch.toLowerCase() : ch;
      p.button(`key-${r}-${i}`, { x: x0 + i * (keyW + gap), y: 218 + r * 68, w: keyW, h: 60 }, label, {
        size: 28,
        disabled: full,
        onClick: () => onKey(label),
      });
    });
  });

  const by = 218 + 4 * 68;
  const bx = (W - (140 + 8 + 440 + 8 + 140)) / 2;
  p.button('shift', { x: bx, y: by, w: 140, h: 60 }, '⇧ Shift', { size: 22, selected: shift, onClick: onShift });
  p.button('space', { x: bx + 148, y: by, w: 440, h: 60 }, 'Space', { size: 22, disabled: full || !name || name.endsWith(' '), onClick: onSpace });
  p.button('back', { x: bx + 596, y: by, w: 140, h: 60 }, '⌫', { size: 28, disabled: !name, onClick: onBack });

  const ay = H - 84;
  p.button('random', { x: 44, y: ay, w: 220, h: 58 }, 'Random name', { size: 22, onClick: onRandom });
  p.button('cancel', { x: W - 44 - 260 - 16 - 170, y: ay, w: 170, h: 58 }, 'Cancel', { size: 22, onClick: onCancel });
  p.button('save', { x: W - 44 - 260, y: ay, w: 260, h: 58 }, 'Save', { primary: true, size: 26, disabled: !name.trim(), onClick: onSave });
}

export function drawGuestLobby(ctx, p, { lobby, onLeave }) {
  const W = p.pxWidth;
  const H = p.pxHeight;
  drawPanelBackground(ctx, W, H);
  text(ctx, `Table ${lobby.code}`, W / 2, 52, { font: `bold 40px ${FONTS.serif}`, fill: THEME.gold });
  text(ctx, 'Waiting for the host to start…', W / 2, 94, { font: `23px ${FONTS.sans}`, fill: THEME.muted });
  seatList(ctx, lobby, { x: 60, y: 150, w: W - 120, numPlayers: lobby.settings.numPlayers, yourSeat: lobby.yourSeat });
  const rules = HOUSE_RULES.filter(([key]) => lobby.settings[key]).map(([, label]) => label);
  wrappedText(ctx, rules.length ? `House rules: ${rules.join(' · ')}` : 'Classic rules', W / 2, H - 130, W - 80, 26, {
    font: `19px ${FONTS.sans}`,
    fill: THEME.muted,
  });
  p.button('leave', { x: W / 2 - 110, y: H - 84, w: 220, h: 58 }, 'Leave table', { size: 24, onClick: onLeave });
}

export function drawMessage(ctx, p, { title, body, button, onOk }) {
  const W = p.pxWidth;
  const H = p.pxHeight;
  drawPanelBackground(ctx, W, H);
  text(ctx, title, W / 2, 54, { font: `bold 36px ${FONTS.serif}`, fill: THEME.gold, maxWidth: W - 40 });
  wrappedText(ctx, body ?? '', W / 2, button ? 132 : 140, W - 60, 30, { font: `23px ${FONTS.sans}`, fill: THEME.text });
  if (button) p.button('ok', { x: W / 2 - 110, y: H - 80, w: 220, h: 58 }, button, { primary: true, size: 26, onClick: onOk });
}
