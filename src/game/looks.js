// How a wizard looks: a style ("skin") plus a hat colour. Plain data with no rendering, so the
// host can validate looks sent by other players and tests can run in Node.
//
// A look is just ids: { skin: 'merlin', hat: 'violet' }. Colours are 0xRRGGBB numbers.

export const SKINS = [
  { id: 'merlin', name: 'Classic Merlin', robe: 0x5b3fb5, trim: 0xe8c66a, beard: 0xeeeae0, skinTone: 0xe6c3a0, hatStyle: 'classic' },
  { id: 'frost', name: 'Frost Mage', robe: 0x3f7fb8, trim: 0xdff3ff, beard: 0xcfd8e3, skinTone: 0xf0d2bd, hatStyle: 'tall' },
  { id: 'ember', name: 'Ember Sorcerer', robe: 0xa8392f, trim: 0xf2a93b, beard: 0x6b3a22, skinTone: 0xc99a73, hatStyle: 'crooked' },
  { id: 'druid', name: 'Grove Druid', robe: 0x3f7d3a, trim: 0xb8d98a, beard: 0x8a8f86, skinTone: 0xb07a55, hatStyle: 'crooked' },
  { id: 'warlock', name: 'Shadow Warlock', robe: 0x2a2438, trim: 0x9b6bff, beard: null, skinTone: 0xd8c0b0, hatStyle: 'wide' },
  { id: 'sun', name: 'Sun Priestess', robe: 0xd9a52b, trim: 0xfff1c4, beard: null, skinTone: 0x8d5a3b, hatStyle: 'classic' },
  { id: 'stargazer', name: 'Star Gazer', robe: 0x1f2a5c, trim: 0xe8c66a, beard: 0xeeeae0, skinTone: 0x6f4630, hatStyle: 'wide' },
  { id: 'jester', name: 'Court Jester', robe: 0x2f8c7a, trim: 0xe44b6a, beard: null, skinTone: 0xf1c9a5, hatStyle: 'crooked' },
];

export const HAT_COLORS = [
  { id: 'violet', name: 'Violet', color: 0x3b1f73 },
  { id: 'midnight', name: 'Midnight', color: 0x1c2350 },
  { id: 'crimson', name: 'Crimson', color: 0x7a1e2c },
  { id: 'emerald', name: 'Emerald', color: 0x1f5a34 },
  { id: 'teal', name: 'Teal', color: 0x1d5a63 },
  { id: 'gold', name: 'Gold', color: 0xb8862b },
  { id: 'orange', name: 'Orange', color: 0xc0621f },
  { id: 'rose', name: 'Rose', color: 0xb04f7a },
  { id: 'silver', name: 'Silver', color: 0x9aa3b5 },
  { id: 'black', name: 'Black', color: 0x17151f },
];

export const DEFAULT_LOOK = { skin: 'merlin', hat: 'violet' };

const byId = (list, id) => list.find((x) => x.id === id);

/** Keep only known ids (anything else falls back to the default). Safe for untrusted input. */
export function sanitizeLook(look) {
  const skin = byId(SKINS, look?.skin) ? look.skin : DEFAULT_LOOK.skin;
  const hat = byId(HAT_COLORS, look?.hat) ? look.hat : DEFAULT_LOOK.hat;
  return { skin, hat };
}

export function randomLook(rng = Math.random) {
  return {
    skin: SKINS[Math.floor(rng() * SKINS.length)].id,
    hat: HAT_COLORS[Math.floor(rng() * HAT_COLORS.length)].id,
  };
}

/** Everything needed to draw a look: the style's colours plus the hat colour. */
export function resolveLook(look) {
  const { skin, hat } = sanitizeLook(look);
  return { ...byId(SKINS, skin), hatColor: byId(HAT_COLORS, hat).color };
}
