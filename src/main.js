import { World } from './scene/World.js';
import { Tweens } from './scene/Tweens.js';
import { Pointer } from './scene/Pointer.js';
import { CardTable } from './scene/CardTable.js';
import { Avatars } from './scene/Avatars.js';
import { Sound } from './audio/Sound.js';
import { Hud } from './ui/Hud.js';
import { Panel } from './ui/Panel.js';
import { App } from './App.js';
import { loadPrefs, savePrefs } from './config.js';
import { randomName, sanitizeName } from './net/protocol.js';

const world = new World(document.getElementById('app'));
const tweens = new Tweens();
world.onUpdate((dt) => tweens.update(dt));

const pointer = new Pointer(world);
const sound = new Sound(world);
const cards = new CardTable(world, tweens, pointer);
cards.sound = sound;
const avatars = new Avatars(world);
const hud = new Hud(world, pointer);
Panel.onButtonClick = () => sound.play('click', null, { volume: 0.5 });

// Player preferences (Options panel + your display name)
function applyPrefs(prefs) {
  sound.configure(prefs);
  if (prefs.vrPosture !== world.posture) world.setPosture(prefs.vrPosture);
}
hud.prefs = loadPrefs();
hud.prefs.name = sanitizeName(hud.prefs.name);
if (!hud.prefs.name) {
  hud.prefs.name = randomName();
  savePrefs(hud.prefs);
}
applyPrefs(hud.prefs);
hud.onPrefsChange = (prefs) => {
  applyPrefs(prefs);
  savePrefs(prefs);
};
hud.onFitHeight = () => world.fitHeight();
world.onHeightFitted = (offset) => hud.showHeightFitted(offset);

const app = new App({
  world,
  cards,
  avatars,
  hud,
  sound,
  getName: () => hud.prefs.name,
  setName: (name) => {
    hud.prefs = { ...hud.prefs, name };
    savePrefs(hud.prefs);
  },
});
app.run();

if (import.meta.env.DEV) window.__arcane = { world, app, hud, cards, sound };
