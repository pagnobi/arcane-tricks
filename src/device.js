// What kind of device we're on, for choosing between the 3D table and the 2D (phone) table.

/** A phone or small touch tablet, but not a VR headset's browser (those report mobile-ish too). */
export function isPhone() {
  const ua = navigator.userAgent ?? '';
  if (/OculusBrowser|Quest|Pico|Wolvic/i.test(ua)) return false;
  if (/iPhone|iPod|Android.+Mobile|Mobile.+Firefox/i.test(ua)) return true;
  const coarse = window.matchMedia?.('(pointer: coarse)').matches;
  return !!coarse && Math.min(window.screen.width, window.screen.height) < 600;
}

/** The table to use: the player's choice in Options, or by device ('2d' on phones). */
export function resolveTableView(pref) {
  if (pref === '2d' || pref === '3d') return pref;
  return isPhone() ? '2d' : '3d';
}
