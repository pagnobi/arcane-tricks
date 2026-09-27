import * as THREE from 'three';
import { SUIT_INFO } from '../game/cards.js';
import { FONTS, roundRect, text } from '../ui/draw.js';

// All card art is generated procedurally at startup — no image assets to license or load.

export const TEX_W = 256;
export const TEX_H = 384;

export function drawSuitGlyph(ctx, suit, cx, cy, size, fill, detail = 'rgba(0,0,0,0.28)') {
  const s = size;
  ctx.save();
  ctx.fillStyle = fill;
  ctx.strokeStyle = fill;
  ctx.lineCap = 'round';
  switch (suit) {
    case 'flame': {
      ctx.beginPath();
      ctx.moveTo(cx, cy - s * 0.5);
      ctx.bezierCurveTo(cx + s * 0.12, cy - s * 0.22, cx + s * 0.42, cy - s * 0.05, cx + s * 0.36, cy + s * 0.2);
      ctx.bezierCurveTo(cx + s * 0.3, cy + s * 0.44, cx + s * 0.12, cy + s * 0.5, cx, cy + s * 0.5);
      ctx.bezierCurveTo(cx - s * 0.12, cy + s * 0.5, cx - s * 0.3, cy + s * 0.44, cx - s * 0.36, cy + s * 0.2);
      ctx.bezierCurveTo(cx - s * 0.42, cy - s * 0.05, cx - s * 0.12, cy - s * 0.22, cx, cy - s * 0.5);
      ctx.fill();
      ctx.fillStyle = detail;
      ctx.beginPath();
      ctx.moveTo(cx, cy);
      ctx.bezierCurveTo(cx + s * 0.16, cy + s * 0.12, cx + s * 0.14, cy + s * 0.4, cx, cy + s * 0.4);
      ctx.bezierCurveTo(cx - s * 0.14, cy + s * 0.4, cx - s * 0.16, cy + s * 0.12, cx, cy);
      ctx.fill();
      break;
    }
    case 'tide': {
      ctx.lineWidth = s * 0.13;
      for (let k = -1; k <= 1; k++) {
        const y = cy + k * s * 0.3;
        ctx.beginPath();
        for (let i = 0; i <= 24; i++) {
          const t = i / 24;
          const x = cx - s * 0.42 + t * s * 0.84;
          const yy = y + Math.sin(t * Math.PI * 2) * s * 0.08;
          if (i === 0) ctx.moveTo(x, yy);
          else ctx.lineTo(x, yy);
        }
        ctx.stroke();
      }
      break;
    }
    case 'grove': {
      ctx.beginPath();
      ctx.moveTo(cx, cy - s * 0.5);
      ctx.quadraticCurveTo(cx + s * 0.52, cy - s * 0.05, cx, cy + s * 0.4);
      ctx.quadraticCurveTo(cx - s * 0.52, cy - s * 0.05, cx, cy - s * 0.5);
      ctx.fill();
      ctx.lineWidth = s * 0.07;
      ctx.beginPath();
      ctx.moveTo(cx, cy + s * 0.36);
      ctx.lineTo(cx, cy + s * 0.52);
      ctx.stroke();
      ctx.strokeStyle = detail;
      ctx.lineWidth = s * 0.045;
      ctx.beginPath();
      ctx.moveTo(cx, cy - s * 0.3);
      ctx.lineTo(cx, cy + s * 0.32);
      ctx.stroke();
      break;
    }
    case 'sun': {
      ctx.beginPath();
      ctx.arc(cx, cy, s * 0.24, 0, Math.PI * 2);
      ctx.fill();
      ctx.lineWidth = s * 0.08;
      for (let k = 0; k < 8; k++) {
        const a = (k / 8) * Math.PI * 2;
        ctx.beginPath();
        ctx.moveTo(cx + Math.cos(a) * s * 0.34, cy + Math.sin(a) * s * 0.34);
        ctx.lineTo(cx + Math.cos(a) * s * 0.48, cy + Math.sin(a) * s * 0.48);
        ctx.stroke();
      }
      break;
    }
  }
  ctx.restore();
}

function makeCanvas() {
  const c = document.createElement('canvas');
  c.width = TEX_W;
  c.height = TEX_H;
  return c;
}

function toTexture(canvas) {
  const t = new THREE.CanvasTexture(canvas);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}

function cardBase(ctx) {
  roundRect(ctx, 3, 3, TEX_W - 6, TEX_H - 6, 22);
  ctx.fillStyle = '#f7f1e3';
  ctx.fill();
  ctx.lineWidth = 4;
  ctx.strokeStyle = '#2b2540';
  ctx.stroke();
}

function innerFill(ctx, top, bottom) {
  const g = ctx.createLinearGradient(0, 16, 0, TEX_H - 16);
  g.addColorStop(0, top);
  g.addColorStop(1, bottom);
  roundRect(ctx, 16, 16, TEX_W - 32, TEX_H - 32, 14);
  ctx.fillStyle = g;
  ctx.fill();
}

/** Rank in both corners (the top-left one stays visible when cards overlap in a fan). */
function corners(ctx, label, color, drawSmallGlyph) {
  for (const flip of [false, true]) {
    ctx.save();
    if (flip) {
      ctx.translate(TEX_W, TEX_H);
      ctx.rotate(Math.PI);
    }
    text(ctx, label, 46, 58, { font: `bold 52px ${FONTS.serif}`, fill: color, stroke: 'rgba(0,0,0,0.35)', lineWidth: 5 });
    drawSmallGlyph?.(46, 104);
    ctx.restore();
  }
}

function drawStars(ctx, count, seed) {
  let s = seed;
  const rand = () => ((s = (s * 16807) % 2147483647) / 2147483647);
  ctx.fillStyle = 'rgba(255, 244, 214, 0.8)';
  for (let i = 0; i < count; i++) {
    ctx.beginPath();
    ctx.arc(24 + rand() * (TEX_W - 48), 24 + rand() * (TEX_H - 48), 0.8 + rand() * 2.2, 0, Math.PI * 2);
    ctx.fill();
  }
}

export function createCardFront(card) {
  const canvas = makeCanvas();
  const ctx = canvas.getContext('2d');
  cardBase(ctx);

  if (card.kind === 'number') {
    const info = SUIT_INFO[card.suit];
    innerFill(ctx, info.light, info.color);
    ctx.globalAlpha = 0.16;
    drawSuitGlyph(ctx, card.suit, TEX_W / 2, TEX_H / 2 + 6, 210, '#ffffff', info.color);
    ctx.globalAlpha = 1;
    text(ctx, String(card.rank), TEX_W / 2, TEX_H / 2 - 12, {
      font: `bold 136px ${FONTS.serif}`,
      fill: '#ffffff',
      stroke: 'rgba(0,0,0,0.35)',
      lineWidth: 8,
    });
    drawSuitGlyph(ctx, card.suit, TEX_W / 2, TEX_H / 2 + 92, 58, '#ffffff', info.color);
    corners(ctx, String(card.rank), '#ffffff', (x, y) => drawSuitGlyph(ctx, card.suit, x, y, 34, '#ffffff', info.color));
  } else if (card.kind === 'wizard') {
    innerFill(ctx, '#46298a', '#140b33');
    drawStars(ctx, 40, 7 + card.id.length);
    text(ctx, 'W', TEX_W / 2, TEX_H / 2 - 14, { font: `bold 150px ${FONTS.serif}`, fill: '#f2c94c', stroke: 'rgba(0,0,0,0.5)', lineWidth: 8 });
    text(ctx, 'WIZARD', TEX_W / 2, TEX_H / 2 + 92, { font: `bold 32px ${FONTS.serif}`, fill: '#f2c94c' });
    corners(ctx, 'W', '#f2c94c');
  } else {
    innerFill(ctx, '#66717d', '#262c33');
    text(ctx, 'J', TEX_W / 2, TEX_H / 2 - 14, { font: `bold 150px ${FONTS.serif}`, fill: '#e9edf2', stroke: 'rgba(0,0,0,0.5)', lineWidth: 8 });
    text(ctx, 'JESTER', TEX_W / 2, TEX_H / 2 + 92, { font: `bold 32px ${FONTS.serif}`, fill: '#e9edf2' });
    corners(ctx, 'J', '#e9edf2');
  }
  return toTexture(canvas);
}

export function createCardBack() {
  const canvas = makeCanvas();
  const ctx = canvas.getContext('2d');
  roundRect(ctx, 3, 3, TEX_W - 6, TEX_H - 6, 22);
  ctx.fillStyle = '#1b1e4b';
  ctx.fill();
  ctx.lineWidth = 4;
  ctx.strokeStyle = '#0d0f29';
  ctx.stroke();

  ctx.save();
  roundRect(ctx, 16, 16, TEX_W - 32, TEX_H - 32, 14);
  ctx.clip();
  ctx.strokeStyle = 'rgba(232, 198, 106, 0.16)';
  ctx.lineWidth = 2;
  for (let i = -TEX_H; i < TEX_W + TEX_H; i += 22) {
    ctx.beginPath();
    ctx.moveTo(i, 0);
    ctx.lineTo(i + TEX_H, TEX_H);
    ctx.moveTo(i, TEX_H);
    ctx.lineTo(i + TEX_H, 0);
    ctx.stroke();
  }
  ctx.restore();

  roundRect(ctx, 16, 16, TEX_W - 32, TEX_H - 32, 14);
  ctx.lineWidth = 3;
  ctx.strokeStyle = '#e8c66a';
  ctx.stroke();

  // Crescent moon and star emblem
  const cx = TEX_W / 2;
  const cy = TEX_H / 2;
  ctx.beginPath();
  ctx.arc(cx, cy, 58, 0, Math.PI * 2);
  ctx.fillStyle = '#12143a';
  ctx.fill();
  ctx.lineWidth = 3;
  ctx.strokeStyle = '#e8c66a';
  ctx.stroke();
  ctx.fillStyle = '#e8c66a';
  ctx.beginPath();
  ctx.arc(cx - 8, cy, 36, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#12143a';
  ctx.beginPath();
  ctx.arc(cx + 6, cy - 8, 32, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#e8c66a';
  ctx.beginPath();
  for (let i = 0; i < 10; i++) {
    const r = i % 2 ? 6 : 15;
    const a = -Math.PI / 2 + (i * Math.PI) / 5;
    ctx.lineTo(cx + 24 + Math.cos(a) * r, cy + 18 + Math.sin(a) * r);
  }
  ctx.closePath();
  ctx.fill();
  return toTexture(canvas);
}
