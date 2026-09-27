// Remembers language, voice speed, volume, text size and theme on this phone only.

const KEY = 'eyes.settings.v1';
export const RATES = [0.6, 0.8, 1, 1.25, 1.5, 1.75, 2];
export const SIZES = [18, 20, 24, 28, 32, 40, 48, 56, 64];
export const THEMES = ['yellow', 'white', 'light'];

const defaults = () => ({
  lang: 'en', // English by default; people switch in settings or by voice
  rate: 1,
  volume: 1,
  textPt: 24,
  theme: 'yellow',
  srMode: false,
  disclaimerShown: false,
});

function load() {
  try {
    return { ...defaults(), ...JSON.parse(localStorage.getItem(KEY) || '{}') };
  } catch {
    return defaults();
  }
}

export const settings = load();
// Text became smaller by default; move people from the old 40pt default once.
// English became the default. Anyone whose language was only guessed from the phone goes back to
// English once; a language someone picked themselves (langChosen) is kept.
// Screen reader mode used to switch the app's voice off; the voice is now always on,
// so anyone who switched it on (often by accident) is reset once.
if (!settings.voiceV3) {
  settings.srMode = false;
  settings.voiceV3 = true;
  try {
    localStorage.setItem(KEY, JSON.stringify(settings));
  } catch {}
}
if (!settings.langV2) {
  if (!settings.langChosen) settings.lang = 'en';
  settings.langV2 = true;
  try {
    localStorage.setItem(KEY, JSON.stringify(settings));
  } catch {}
}
if (!settings.volumeV2) {
  if (settings.volume === 0.8) settings.volume = 1;
  settings.volumeV2 = true;
  try {
    localStorage.setItem(KEY, JSON.stringify(settings));
  } catch {}
}
if (!settings.sizeV2) {
  if (settings.textPt === 40) settings.textPt = 24;
  settings.sizeV2 = true;
  try {
    localStorage.setItem(KEY, JSON.stringify(settings));
  } catch {}
}

export function save() {
  try {
    localStorage.setItem(KEY, JSON.stringify(settings));
  } catch {}
}

export function applyLook() {
  const root = document.documentElement;
  root.dataset.theme = settings.theme;
  root.style.setProperty('--text-size', `${settings.textPt}pt`);
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.content = settings.theme === 'light' ? '#faf9f7' : '#0c0a09';
}

// Moves to the next value in a list. Returns false when already at the end.
export function step(list, value, dir) {
  const i = list.indexOf(value);
  const j = (i === -1 ? list.indexOf(1) : i) + dir;
  if (j < 0 || j >= list.length) return false;
  return list[j];
}
