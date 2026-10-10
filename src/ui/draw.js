// Canvas 2D drawing helpers shared by cards, panels and nameplates.

export const FONTS = {
  serif: 'Georgia, "Times New Roman", serif',
  sans: '"Segoe UI", system-ui, -apple-system, Roboto, sans-serif',
};

export const THEME = {
  bgTop: 'rgba(36, 31, 68, 0.95)',
  bg: 'rgba(15, 17, 36, 0.94)',
  border: '#c9a54c',
  gold: '#e8c66a',
  text: '#f4ecd6',
  muted: '#a6a8c2',
  good: '#7fd69a',
  bad: '#f08a7a',
  button: '#2d2a55',
  buttonHover: '#4a4488',
  primary: '#c0902e',
  primaryHover: '#e0aa42',
  disabled: '#211f36',
};

export function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

export function text(ctx, str, x, y, opts = {}) {
  const {
    font = `28px ${FONTS.sans}`,
    fill = THEME.text,
    align = 'center',
    baseline = 'middle',
    stroke = null,
    lineWidth = 4,
    maxWidth,
  } = opts;
  ctx.font = font;
  ctx.textAlign = align;
  ctx.textBaseline = baseline;
  if (stroke) {
    ctx.lineJoin = 'round';
    ctx.lineWidth = lineWidth;
    ctx.strokeStyle = stroke;
    ctx.strokeText(str, x, y, maxWidth);
  }
  ctx.fillStyle = fill;
  ctx.fillText(str, x, y, maxWidth);
}

/** How long the Won count's pop lasts after a trick is won. */
export const POP_SECONDS = 1.1;

/**
 * "Bid 1 · Won 1", where the Won number can pop: `pop` runs 0→1 over the animation after a trick
 * is won. The number swells and turns green, then settles, while a "+1" floats up and fades.
 */
export function drawBidWon(ctx, bid, tricks, x, y, { font, fill = THEME.text, align = 'left', pop = 0, suffix = '' } = {}) {
  const prefix = `Bid ${bid} · Won `;
  const num = String(tricks);
  ctx.font = font;
  const pw = ctx.measureText(prefix).width;
  const nw = ctx.measureText(num).width;
  const sw = suffix ? ctx.measureText(suffix).width : 0;
  const left = align === 'center' ? x - (pw + nw + sw) / 2 : x;
  text(ctx, prefix, left, y, { font, fill, align: 'left' });
  const active = pop > 0 && pop < 1;
  const bump = active ? Math.sin(Math.PI * Math.min(1, pop * 1.4)) : 0; // up, then back down
  ctx.save();
  ctx.translate(left + pw + nw / 2, y);
  ctx.scale(1 + 0.6 * bump, 1 + 0.6 * bump);
  text(ctx, num, 0, 0, { font, fill: bump > 0.05 ? THEME.good : fill, align: 'center' });
  ctx.restore();
  if (suffix) text(ctx, suffix, left + pw + nw, y, { font, fill, align: 'left' });
  if (active) {
    ctx.save();
    ctx.globalAlpha = 1 - pop;
    text(ctx, '+1', left + pw + nw + sw + 12, y - 8 - 30 * pop, { font: `bold 26px ${FONTS.sans}`, fill: THEME.good, align: 'left' });
    ctx.restore();
  }
}

/** Split text into lines no wider than maxWidth in the given font. */
export function wrapLines(ctx, str, maxWidth, font) {
  ctx.font = font;
  const lines = [];
  let line = '';
  for (const word of String(str).split(' ')) {
    const next = line ? `${line} ${word}` : word;
    if (line && ctx.measureText(next).width > maxWidth) {
      lines.push(line);
      line = word;
    } else {
      line = next;
    }
  }
  if (line) lines.push(line);
  return lines;
}

/** Draw text wrapped to maxWidth, vertically centred on y. */
export function wrappedText(ctx, str, x, y, maxWidth, lineHeight, opts = {}) {
  const lines = wrapLines(ctx, str, maxWidth, opts.font ?? `28px ${FONTS.sans}`);
  const top = y - ((lines.length - 1) * lineHeight) / 2;
  lines.forEach((l, i) => text(ctx, l, x, top + i * lineHeight, { ...opts, maxWidth }));
}

export function drawPanelBackground(ctx, w, h, { radius = 26, highlight = false } = {}) {
  roundRect(ctx, 3, 3, w - 6, h - 6, radius);
  const g = ctx.createLinearGradient(0, 0, 0, h);
  g.addColorStop(0, THEME.bgTop);
  g.addColorStop(1, THEME.bg);
  ctx.fillStyle = g;
  ctx.fill();
  ctx.lineWidth = highlight ? 6 : 4;
  ctx.strokeStyle = highlight ? THEME.gold : 'rgba(201, 165, 76, 0.7)';
  ctx.stroke();
}

export function drawButton(ctx, { x, y, w, h, label, hover, disabled, primary, selected, size = 28 }) {
  roundRect(ctx, x, y, w, h, Math.min(14, h / 2));
  if (disabled) ctx.fillStyle = THEME.disabled;
  else if (primary) ctx.fillStyle = hover ? THEME.primaryHover : THEME.primary;
  else ctx.fillStyle = hover || selected ? THEME.buttonHover : THEME.button;
  ctx.fill();
  ctx.lineWidth = 2.5;
  ctx.strokeStyle = disabled ? 'rgba(255,255,255,0.08)' : hover || selected ? THEME.gold : 'rgba(232,198,106,0.45)';
  ctx.stroke();
  if (label) {
    text(ctx, label, x + w / 2, y + h / 2 + 1, {
      font: `bold ${size}px ${FONTS.sans}`,
      fill: disabled ? '#5a5874' : primary ? '#1a1206' : THEME.text,
    });
  }
}

export function drawSlider(ctx, { x, y, w, h, value, hover }) {
  const cy = y + h / 2;
  const trackH = 10;
  roundRect(ctx, x, cy - trackH / 2, w, trackH, trackH / 2);
  ctx.fillStyle = THEME.button;
  ctx.fill();
  if (value > 0) {
    roundRect(ctx, x, cy - trackH / 2, Math.max(trackH, w * value), trackH, trackH / 2);
    ctx.fillStyle = THEME.primary;
    ctx.fill();
  }
  ctx.beginPath();
  ctx.arc(x + w * value, cy, hover ? 17 : 15, 0, Math.PI * 2);
  ctx.fillStyle = hover ? THEME.primaryHover : THEME.gold;
  ctx.fill();
  ctx.lineWidth = 3;
  ctx.strokeStyle = '#1a1206';
  ctx.stroke();
}

export function drawToggle(ctx, { x, y, w, h, label, checked, hover }) {
  if (hover) {
    roundRect(ctx, x, y, w, h, 12);
    ctx.fillStyle = 'rgba(255,255,255,0.07)';
    ctx.fill();
  }
  const bx = x + 12;
  const by = y + (h - 30) / 2;
  roundRect(ctx, bx, by, 30, 30, 7);
  ctx.fillStyle = checked ? THEME.primary : THEME.button;
  ctx.fill();
  ctx.lineWidth = 2;
  ctx.strokeStyle = 'rgba(232,198,106,0.7)';
  ctx.stroke();
  if (checked) {
    ctx.beginPath();
    ctx.moveTo(bx + 7, by + 16);
    ctx.lineTo(bx + 13, by + 22);
    ctx.lineTo(bx + 24, by + 8);
    ctx.lineWidth = 4;
    ctx.lineCap = 'round';
    ctx.strokeStyle = '#1a1206';
    ctx.stroke();
  }
  text(ctx, label, bx + 48, y + h / 2 + 1, { font: `25px ${FONTS.sans}`, align: 'left' });
}
