// Eyes for Everyone — two things, nothing else:
//   DESCRIBE: tap anywhere → photo → the description streams in and is read aloud as it arrives.
//             Tap again for the next photo; double-tap (or the mic) to ask a question about this one.
//   QIBLA:    starts by itself when chosen; a live talking compass. Tap anywhere to hear the direction.
// Switch with the two tabs at the bottom, a sideways swipe, or ← / →.
// Also: long-press repeats · hold 3 s opens settings · swipe down or O opens a picture ·
// drag the answer sheet to resize it · laptop: Space = tap, drop or paste a picture.
import { t, setLang, LANG_ORDER } from './i18n.js';
import { settings, save, applyLook, RATES, SIZES, THEMES, step } from './settings.js';
import { sounds, vibrate } from './sounds.js';
import { speak, speakStream, stopSpeaking, unlockVoice, enableServerVoice, splitSentences, preload } from './voice.js';
import { startCamera, stopCamera, capture, toJpegBase64, checkQuality, cameraRunning } from './camera.js';
import { startListening, useServerStt } from './listen.js';
import { matchCommand } from './commands.js';
import { initGlass } from './glass.js';
import { startQibla, compassPoint } from './sensors.js';

const TIMING = { LONG: 700, SETTINGS: 3000, DOUBLE: 320, DEBOUNCE: 500, ASK_TIMEOUT: 40000 };
const MIN_PT = 16;
const MODES = ['describe', 'qibla'];
const SHEET_SIZES = ['peek', 'auto', 'full'];
// Laptop or PC with a mouse or trackpad: speak keyboard hints instead of touch gestures.
const DESKTOP = matchMedia('(hover: hover) and (pointer: fine)').matches;
// ?demo (pretend camera and compass, for testing) works only on the developer's own machine, never on the real site.
const DEMO = new URLSearchParams(location.search).has('demo') && ['localhost', '127.0.0.1'].includes(location.hostname);
const REDUCED = matchMedia('(prefers-reduced-motion: reduce)');

const $ = (id) => document.getElementById(id);
const el = {
  body: document.body,
  video: $('video'),
  photo: $('photo'),
  stage: $('stage'),
  statusWord: $('status-word'),
  message: $('message'),
  flash: $('flash'),
  srLink: $('sr-link'),
  btnSettings: $('btn-settings'),
  btnGallery: $('btn-gallery'),
  btnSide: $('btn-side'),
  sideIcon: $('side-icon'),
  modebar: $('modebar'),
  fileInput: $('file-input'),
  settings: $('settings'),
  wordmark: $('wordmark'),
  liveStatus: $('live-status'),
  liveMessage: $('live-message'),
  sheet: document.querySelector('.sheet'),
  pill: document.querySelector('.pill'),
  grabber: $('grabber'),
  hud: document.querySelector('.hud'),
};

let state = 'start';
let op = 0; // bumped by every new action; older async work sees the change and quietly stops
let mode = MODES.includes(settings.mode) ? settings.mode : 'describe';
let photo = null; // { base64, url } — kept in memory only, never saved
let history = []; // questions and answers about the current photo
let lastAnswer = '';
let recorderP = null;
let prompting = false;
let blurStrikes = 0;
let abort = null;
let returnState = 'ready';
let pendingPicture = null; // a picture dropped on the page before the first tap
let qibla = null; // the running compass
let qiblaSay = ''; // what a tap in Qibla says right now
let currentText = '';
let paging = false;
let pagePt = 32;

// ---------- screen ----------

function setState(s) {
  state = s;
  el.body.dataset.state = s;
  if (s !== 'answer' && el.body.dataset.sheet !== 'auto') el.body.dataset.sheet = 'auto';
  morph(el.pill, () => (el.statusWord.textContent = t(`status.${s}`)));
  el.liveStatus.textContent = t(`status.${s}`);
  if (s !== 'start') vibrate(40);
  el.body.dataset.photo = photo && ['listening', 'thinking', 'answer'].includes(s) ? 'on' : 'off';
  updateLabels();
}

// Liquid motion: a glass panel that changes size morphs from its old size to the new one.
function morph(box, change) {
  const a = box.getBoundingClientRect();
  change();
  const b = box.getBoundingClientRect();
  if (REDUCED.matches || !box.animate || (Math.abs(a.width - b.width) < 2 && Math.abs(a.height - b.height) < 2)) return;
  box.animate([{ width: `${a.width}px`, height: `${a.height}px` }, { width: `${b.width}px`, height: `${b.height}px` }], {
    duration: 460,
    easing: 'cubic-bezier(0.22, 1, 0.36, 1)',
  });
}

const overflows = (inner) => inner.offsetHeight > el.message.clientHeight + 1 || inner.scrollWidth > el.message.clientWidth + 1;

function setSpan(text, live) {
  let span = live && el.message.firstElementChild;
  if (span) span.textContent = text;
  else {
    el.message.innerHTML = '';
    span = document.createElement('span');
    span.textContent = text;
    el.message.append(span);
  }
  return span;
}

// Text at the chosen size, shrinking toward MIN_PT only if it does not fit. Returns the size, or 0 if it never fits.
// live = a reading that changes often (Qibla, a streaming answer): update the words in place, no animation.
function fit(text, maxPt = settings.textPt, live = false) {
  const span = setSpan(text, live);
  let pt = maxPt;
  el.message.style.fontSize = `${pt}pt`;
  while (overflows(span) && pt > MIN_PT) {
    pt -= 2;
    el.message.style.fontSize = `${pt}pt`;
  }
  return overflows(span) ? 0 : pt;
}

function layoutText(text) {
  currentText = text;
  // Peek and full show the text at the chosen size as it is (full scrolls; peek shows one line).
  if (el.body.dataset.sheet !== 'auto') {
    paging = false;
    setSpan(text);
    el.message.style.fontSize = `${settings.textPt}pt`;
    return;
  }
  paging = !fit(text);
  // Too long even at the smallest size: one sentence at a time, in step with the voice, all the same size.
  if (paging) {
    const parts = splitSentences(text);
    pagePt = Math.min(...parts.map((p) => fit(p) || MIN_PT));
    fit(parts[0], pagePt);
  }
}

function show(text) {
  morph(el.sheet, () => layoutText(text));
  if (settings.srMode) announce(text);
}

function announce(text) {
  el.liveMessage.textContent = '';
  setTimeout(() => (el.liveMessage.textContent = text), 60);
}

// Page to the sentence being spoken, only while the sheet is its normal size.
const pageTo = (i, s) => paging && el.body.dataset.sheet === 'auto' && i >= 0 && fit(s, pagePt);

async function say(text, { display = true } = {}) {
  if (display) show(text);
  else if (settings.srMode) announce(text);
  await speak(text, { onSentence: display ? pageTo : undefined });
}

const talk = (words) => (settings.srMode ? announce(words) : speak(words));

function flash() {
  el.flash.classList.remove('go');
  void el.flash.offsetWidth;
  el.flash.classList.add('go');
}

function readyPrompt() {
  if (mode === 'qibla') return qiblaSay || t('qiblaLocating');
  return DESKTOP ? t('readyDesktop') : t('ready');
}

function showMode() {
  el.body.dataset.mode = mode;
  for (const b of el.modebar.children) {
    const on = b.dataset.mode === mode;
    b.setAttribute('aria-selected', on ? 'true' : 'false');
    b.tabIndex = on ? 0 : -1;
  }
  updateLabels();
}

function setIcon(use, btn, id) {
  btn.dataset.icon = id || 'none';
  if (id) use.setAttribute('href', `#${id}`);
}

function updateLabels() {
  const prompt = { start: t('tapToStart'), ready: readyPrompt(), listening: t('sr.stop'), thinking: t('sr.wait'), answer: t('tapAgain') }[state];
  el.stage.setAttribute('aria-label', prompt || t('appName'));
  el.wordmark.textContent = t('appName');
  el.srLink.textContent = t('srModeButton');
  $('drop-text').textContent = t('dropHere');
  el.btnSettings.setAttribute('aria-label', t('sr.settings'));
  el.btnGallery.setAttribute('aria-label', t('upload'));
  $('gallery-text').textContent = t('upload');
  for (const b of el.modebar.children) b.textContent = t(`modes.${b.dataset.mode}.name`);

  // The button on the right changes with the moment: repeat, ask about it, or cancel.
  const side =
    mode === 'qibla' && state === 'ready'
      ? null
      : {
          ready: lastAnswer ? [t('sr.repeat'), 'i-redo'] : null,
          answer: [t('sr.askAgain'), 'i-mic'],
        }[state];
  el.btnSide.hidden = !side;
  if (side) {
    el.btnSide.setAttribute('aria-label', side[0]);
    setIcon(el.sideIcon, el.btnSide, side[1]);
  }
  el.btnGallery.hidden = mode === 'qibla' || !['ready', 'answer'].includes(state);
  const size = el.body.dataset.sheet;
  el.grabber.setAttribute('aria-label', t(size === 'auto' ? 'sheet.expand' : size === 'full' ? 'sheet.shrink' : 'sheet.restore'));
  el.grabber.setAttribute('aria-expanded', size === 'full' ? 'true' : 'false');
}

// ---------- the answer sheet: peek · auto · full ----------

function setSheet(size) {
  if (!SHEET_SIZES.includes(size)) return;
  morph(el.sheet, () => {
    el.sheet.style.height = '';
    el.body.dataset.sheet = size;
    if (currentText) layoutText(currentText);
  });
  vibrate(15);
  updateLabels();
}

function stepSheet(dir) {
  if (state !== 'answer') return;
  const i = SHEET_SIZES.indexOf(el.body.dataset.sheet) + dir;
  if (i >= 0 && i < SHEET_SIZES.length) setSheet(SHEET_SIZES[i]);
}

// ---------- gestures ----------

let lastAction = 0;
let pendingTap = null;

function rawTap() {
  const now = Date.now();
  if (pendingTap) {
    clearTimeout(pendingTap);
    pendingTap = null;
    lastAction = now;
    return onDoubleTap();
  }
  if (now - lastAction < TIMING.DEBOUNCE) return; // accidental extra tap
  if (state === 'ready' && mode === 'qibla') return; // nothing to tap in Qibla
  vibrate(20);
  // Only an answer has a double-tap, so everywhere else act at once for a snappy shutter.
  if (state !== 'answer') {
    lastAction = now;
    return onTap();
  }
  pendingTap = setTimeout(() => {
    pendingTap = null;
    lastAction = Date.now();
    onTap();
  }, TIMING.DOUBLE);
}

function bindGestures() {
  let down = false;
  let longFired = false;
  let longTimer;
  let settingsTimer;
  let x0 = 0;
  let y0 = 0;
  let dragging = false;
  let canDrag = false;
  let h0 = 0;
  let vy = 0;
  let lastY = 0;
  let lastT = 0;
  const clear = () => {
    clearTimeout(longTimer);
    clearTimeout(settingsTimer);
    down = false;
    el.body.classList.remove('pressing');
  };
  const maxSheet = () => {
    const cs = getComputedStyle(el.hud);
    return el.hud.clientHeight - parseFloat(cs.paddingTop) - parseFloat(cs.paddingBottom);
  };

  const onDown = (e) => {
    if (!e.isPrimary) return;
    sounds.unlock();
    // The answer sheet can be dragged; in full size its text scrolls, so drag it by the top strip.
    const onSheet = e.currentTarget === el.sheet;
    canDrag =
      onSheet &&
      state === 'answer' &&
      (el.body.dataset.sheet !== 'full' || e.target.closest('.grabber') || e.clientY - el.sheet.getBoundingClientRect().top < 48);
    if (onSheet) {
      try {
        el.sheet.setPointerCapture(e.pointerId); // keep following the finger outside the sheet
      } catch {}
    }
    lastY = e.clientY;
    lastT = e.timeStamp;
    vy = 0;
    down = true;
    longFired = false;
    x0 = e.clientX;
    y0 = e.clientY;
    if (!canDrag) el.body.classList.add('pressing');
    longTimer = setTimeout(() => {
      longFired = true;
      lastAction = Date.now();
      onLongPress();
    }, TIMING.LONG);
    settingsTimer = setTimeout(() => {
      clear();
      openSettings();
    }, TIMING.SETTINGS);
  };

  const onMove = (e) => {
    if (!down) return;
    const dx = e.clientX - x0;
    const dy = e.clientY - y0;
    if (Math.hypot(dx, dy) > 24) {
      clearTimeout(longTimer);
      clearTimeout(settingsTimer);
    }
    if (canDrag && !dragging && Math.abs(dy) > 8 && Math.abs(dy) > Math.abs(dx)) {
      dragging = true;
      clearTimeout(longTimer);
      clearTimeout(settingsTimer);
      h0 = el.sheet.getBoundingClientRect().height;
      el.body.classList.add('dragging');
      el.body.classList.remove('pressing');
    }
    if (!dragging) return;
    // Follow the finger; past the ends it resists like rubber.
    const lo = 84;
    const hi = maxSheet();
    let h = h0 - dy;
    if (h > hi) h = hi + (h - hi) * 0.25;
    if (h < lo) h = lo - (lo - h) * 0.25;
    el.sheet.style.height = `${h}px`;
    const dt = e.timeStamp - lastT;
    if (dt > 0) vy = (e.clientY - lastY) / dt;
    lastY = e.clientY;
    lastT = e.timeStamp;
  };

  const onUp = (e) => {
    if (!down) return;
    clear();
    if (dragging) {
      dragging = false;
      el.body.classList.remove('dragging');
      // Settle on the nearest size, or the next one if the sheet was flicked.
      const dy = e.clientY - y0;
      const i = SHEET_SIZES.indexOf(el.body.dataset.sheet);
      let next = i;
      if (vy < -0.45 || dy < -60) next = Math.min(i + 1, 2);
      else if (vy > 0.45 || dy > 60) next = Math.max(i - 1, 0);
      if (dy < -maxSheet() * 0.45) next = 2;
      if (dy > maxSheet() * 0.45) next = 0;
      setSheet(SHEET_SIZES[next]);
      lastAction = Date.now();
      return;
    }
    if (longFired) return;
    if (e.target.closest?.('.grabber')) return; // the handle's own click resizes
    const dx = e.clientX - x0;
    const dy = e.clientY - y0;
    if (Math.abs(dx) > 70 && Math.abs(dx) > Math.abs(dy) * 1.4) return onSwipe(dx < 0 ? 1 : -1);
    if (dy > 80 && Math.abs(dy) > Math.abs(dx) * 1.4) return onSwipeDown();
    rawTap();
  };

  const onCancel = () => {
    clear();
    if (dragging) {
      dragging = false;
      el.body.classList.remove('dragging');
      setSheet(el.body.dataset.sheet);
    }
  };

  // The whole screen and the answer sheet share the same gestures.
  for (const target of [el.stage, el.sheet]) {
    target.addEventListener('pointerdown', onDown);
    target.addEventListener('pointermove', onMove);
    target.addEventListener('pointerup', onUp);
    target.addEventListener('pointercancel', onCancel);
    target.addEventListener('contextmenu', (e) => e.preventDefault());
  }
  el.grabber.addEventListener('click', (e) => {
    e.stopPropagation();
    const size = el.body.dataset.sheet;
    setSheet(size === 'auto' ? 'full' : size === 'full' ? 'peek' : 'auto');
  });
  // Keyboard, switch access and screen readers send a click without pointer events.
  el.stage.addEventListener('click', (e) => e.detail === 0 && rawTap());

  el.srLink.addEventListener('click', () => {
    settings.srMode = true;
    save();
    el.body.classList.add('sr');
    begin();
  });
  el.btnSide.addEventListener('click', () => {
    if (state === 'answer') return listen(t('askNow'));
    if (['listening', 'thinking'].includes(state)) return goReady(t('cancelled'));
    if (state === 'ready') return onLongPress();
  });
  el.btnGallery.addEventListener('click', openPicker);
  el.btnSettings.addEventListener('click', openSettings);
  el.modebar.addEventListener('click', (e) => {
    const b = e.target.closest('[data-mode]');
    if (!b || b.dataset.mode === mode) return;
    if (state === 'start') {
      mode = b.dataset.mode;
      settings.mode = mode;
      save();
      return begin();
    }
    selectMode(b.dataset.mode);
  });
  el.fileInput.addEventListener('change', () => {
    const f = el.fileInput.files?.[0];
    el.fileInput.value = '';
    if (f) loadPicture(f);
  });

  // Trackpad: a sideways scroll switches between Describe and Qibla.
  let wheelX = 0;
  let wheelAt = 0;
  el.stage.addEventListener(
    'wheel',
    (e) => {
      if (Math.abs(e.deltaX) <= Math.abs(e.deltaY)) return;
      wheelX += e.deltaX;
      if (Math.abs(wheelX) > 120 && Date.now() - wheelAt > 700) {
        wheelAt = Date.now();
        onSwipe(wheelX > 0 ? 1 : -1);
        wheelX = 0;
      }
    },
    { passive: true }
  );

  // Laptop/PC: drop a picture anywhere, or paste one (Ctrl/⌘+V).
  let dragDepth = 0;
  addEventListener('dragenter', (e) => {
    if (![...(e.dataTransfer?.types || [])].includes('Files')) return;
    if (dragDepth++ === 0 && state !== 'start') talk(t('dropHere'));
    el.body.classList.add('dropping');
  });
  addEventListener('dragleave', () => {
    if (--dragDepth <= 0) {
      dragDepth = 0;
      el.body.classList.remove('dropping');
    }
  });
  addEventListener('dragover', (e) => e.preventDefault());
  addEventListener('drop', (e) => {
    e.preventDefault();
    dragDepth = 0;
    el.body.classList.remove('dropping');
    const f = [...(e.dataTransfer?.files || [])][0];
    if (f) loadPicture(f);
  });
  addEventListener('paste', (e) => {
    const item = [...(e.clipboardData?.items || [])].find((i) => i.type.startsWith('image/'));
    if (item) loadPicture(item.getAsFile());
  });

  document.addEventListener('keydown', (e) => {
    if (state === 'settings') {
      if (e.key === 'Escape') closeSettings();
      return;
    }
    if (e.metaKey || e.ctrlKey || e.altKey) return; // leave browser shortcuts (like paste) alone
    const onButton = e.target instanceof HTMLButtonElement;
    if ((e.key === ' ' || e.key === 'Enter') && !onButton) {
      e.preventDefault();
      return rawTap();
    }
    const key = e.key.toLowerCase();
    if (key === 'a' && state === 'answer') listen(t('askNow'));
    else if (key === 'r') onLongPress();
    else if (key === 's') openSettings();
    else if (key === 'o') openPicker();
    else if (key === 'h' || e.key === '?') sayHelp();
    else if (e.key === 'Escape') onDoubleTap();
    else if (e.key === 'ArrowUp') stepSheet(1);
    else if (e.key === 'ArrowDown') stepSheet(-1);
    else if (e.key === 'ArrowRight') onSwipe(document.documentElement.dir === 'rtl' ? -1 : 1);
    else if (e.key === 'ArrowLeft') onSwipe(document.documentElement.dir === 'rtl' ? 1 : -1);
  });
}

// ---------- camera problems: say exactly what is wrong, and offer Upload ----------

function cameraProblem(e) {
  const key =
    { NotAllowedError: 'camBlocked', SecurityError: 'camBlocked', NotReadableError: 'camBusy', AbortError: 'camBusy', NotFoundError: 'camNone', OverconstrainedError: 'camNone', NoAnswer: 'camNoAnswer', NotSupported: 'camUnsupported' }[e?.name] ||
    'camBlocked';
  el.body.dataset.nocam = 'yes';
  el.body.dataset.camera = 'off';
  sounds.error();
  return key;
}

async function cameraOn(my) {
  try {
    await startCamera(el.video);
    el.body.dataset.camera = 'on';
    delete el.body.dataset.nocam;
    return true;
  } catch (e) {
    if (my !== op) return false;
    await say(t(cameraProblem(e)));
    return false;
  }
}

// ---------- actions ----------

function onTap() {
  switch (state) {
    case 'start':
      return begin();
    case 'ready':
      if (mode === 'qibla') return; // Qibla runs by itself: taps do nothing
      return takePhoto();
    case 'listening':
      return prompting ? stopSpeaking() : finishListening();
    case 'answer':
      return retake(); // tap after an answer = the next photo straight away
    default: // thinking: ignore every tap
  }
}

function onDoubleTap() {
  if (state === 'answer') return listen(t('askNow')); // ask about the same photo
  if (['listening', 'thinking'].includes(state)) return goReady(t('cancelled'));
  return onTap();
}

function onSwipe(dir) {
  if (!['ready', 'answer'].includes(state)) return;
  const next = MODES[(MODES.indexOf(mode) + dir + MODES.length) % MODES.length];
  if (next !== mode) selectMode(next);
}

function onSwipeDown() {
  if (mode === 'describe' && ['ready', 'answer'].includes(state)) openPicker();
}

function selectMode(next) {
  mode = next;
  settings.mode = mode;
  save();
  sounds.tap();
  vibrate(25);
  // Qibla starts at once, from this same touch (the iPhone needs a touch to allow the compass).
  goReady();
}

function openPicker() {
  if (['thinking', 'settings'].includes(state)) return;
  el.fileInput.click();
}

function sayHelp() {
  if (['thinking', 'settings', 'listening'].includes(state)) return;
  say(DESKTOP ? t('helpKeys') : t('helpTouch'), { display: state !== 'start' });
}

async function onLongPress() {
  if (!['ready', 'answer'].includes(state)) return;
  if (mode === 'qibla' && state === 'ready') return;
  const my = ++op;
  vibrate([30, 50, 30]);
  if (!lastAnswer) return say(t('nothingToRepeat'), { display: state === 'answer' });
  const back = state;
  await say(lastAnswer);
  if (my === op && back === 'answer') await say(t('tapAgain'), { display: false });
  else if (my === op) show(readyPrompt());
}

function cancelWork() {
  stopQibla();
  stopSpeaking();
  sounds.thinkingStop();
  abort?.abort();
  abort = null;
  recorderP?.then((r) => r.cancel()).catch(() => {});
  recorderP = null;
  prompting = false;
  el.body.classList.remove('recording');
}

async function begin() {
  unlockVoice();
  sounds.unlock();
  requestWakeLock();
  if (pendingPicture) {
    const f = pendingPicture;
    pendingPicture = null;
    mode = 'describe';
    showMode();
    setState('ready');
    if (!settings.disclaimerShown) await showDisclaimer();
    return loadPicture(f);
  }
  goReady();
}

async function showDisclaimer() {
  el.body.classList.add('disclaimer');
  await say(t('disclaimer'));
  el.body.classList.remove('disclaimer');
  settings.disclaimerShown = true;
  save();
}

/** Ready to go in the current mode: the camera for Describe, the compass for Qibla. */
async function goReady(prefix) {
  cancelWork();
  const my = ++op;
  photo = null;
  history = [];
  blurStrikes = 0;
  el.photo.removeAttribute('src');
  showMode();
  setState('ready');
  if (mode === 'qibla') {
    stopCamera(el.video);
    el.body.dataset.camera = 'off';
    return runQibla(my); // must start inside this touch, before anything is awaited
  }
  if (!settings.disclaimerShown) await showDisclaimer();
  if (my !== op) return;
  // Camera and the spoken prompt start together; a camera problem is spoken after the prompt.
  let problem = null;
  const cam = startCamera(el.video)
    .then(() => {
      el.body.dataset.camera = 'on';
      delete el.body.dataset.nocam;
    })
    .catch((e) => (problem = cameraProblem(e)));
  await say(prefix ? `${prefix} ${readyPrompt()}` : readyPrompt());
  await cam;
  if (problem && my === op) await say(t(problem));
}

// After an answer: back to the camera and snap the next photo in one tap.
async function retake() {
  cancelWork();
  const my = ++op;
  photo = null;
  history = [];
  el.photo.removeAttribute('src');
  setState('ready');
  show(t('newPhoto'));
  talk(t('newPhoto'));
  // The camera stayed on while you listened, so the next photo is instant.
  const warm = cameraRunning();
  if (!(await cameraOn(my))) return;
  if (!warm) await new Promise((r) => setTimeout(r, 600)); // let a cold camera set exposure and focus
  if (my === op && state === 'ready') takePhoto();
}

async function takePhoto() {
  const my = ++op;
  stopSpeaking();
  if (!cameraRunning()) {
    if (!(await cameraOn(my))) return;
    await new Promise((r) => setTimeout(r, 500));
  }
  let canvas;
  try {
    canvas = capture(el.video);
  } catch (e) {
    return say(t(cameraProblem(e)));
  }
  sounds.shutter();
  flash();
  vibrate([30, 40, 30]);
  const q = checkQuality(canvas);
  // After two "blurry" warnings in a row, accept the photo anyway (plain walls look "blurry").
  if (!q.ok && !(q.problem === 'blurry' && blurStrikes >= 2)) {
    blurStrikes = q.problem === 'blurry' ? blurStrikes + 1 : 0;
    sounds.error();
    vibrate([90, 60, 90]);
    return say(t(q.problem));
  }
  if (my !== op) return;
  blurStrikes = 0;
  usePhoto(canvas, my);
}

/** A picture from the gallery, a file, a paste or a drop: describe it. */
async function loadPicture(file) {
  if (!file || !/^image\//.test(file.type)) {
    sounds.error();
    return say(t('badFile'), { display: state !== 'start' });
  }
  if (state === 'start') {
    pendingPicture = file; // sound needs one tap first
    return show(t('sharedReceivedStart'));
  }
  if (['thinking', 'settings'].includes(state)) return;
  if (mode !== 'describe') {
    mode = 'describe';
    settings.mode = mode;
    save();
    showMode();
  }
  cancelWork();
  const my = ++op;
  let canvas;
  try {
    const bmp = await createImageBitmap(file);
    const scale = Math.min(1, 1280 / Math.max(bmp.width, bmp.height));
    canvas = document.createElement('canvas');
    canvas.width = Math.round(bmp.width * scale);
    canvas.height = Math.round(bmp.height * scale);
    canvas.getContext('2d').drawImage(bmp, 0, 0, canvas.width, canvas.height);
    bmp.close?.();
  } catch {
    if (my !== op) return;
    sounds.error();
    return say(t('badFile'));
  }
  if (my !== op) return;
  sounds.shutter();
  vibrate([30, 40, 30]);
  usePhoto(canvas, my);
}

// The photo is described straight away — no question needed.
function usePhoto(canvas, my) {
  photo = { base64: toJpegBase64(canvas), url: canvas.toDataURL('image/jpeg', 0.7) };
  history = [];
  el.photo.src = photo.url;
  ask('', my);
}

// ---------- asking: the answer streams in and is spoken while it arrives ----------

async function ask(question, my) {
  const q = question.trim() || t('defaultQuestion');
  const alreadySaid = state === 'thinking';
  setState('thinking');
  show(t('thinking'));
  if (!alreadySaid) talk(t('thinking'));
  sounds.thinkingStart();
  abort = abort || new AbortController();
  const ctl = abort;
  const timer = setTimeout(() => ctl.abort(), TIMING.ASK_TIMEOUT);
  let answer = '';
  let voice = null;
  let shown = 0;
  const firstWords = () => {
    sounds.thinkingStop();
    sounds.answer();
    setState('answer');
    voice = speakStream({ onSentence: pageTo });
  };
  try {
    const r = await fetch('/api/ask', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ image: photo.base64, mime: 'image/jpeg', question: q, lang: settings.lang, history, stream: true }),
      signal: ctl.signal,
    });
    if (!r.ok || !r.body) throw new Error(`ask ${r.status}`);
    const reader = r.body.getReader();
    const dec = new TextDecoder();
    for (;;) {
      const { done, value } = await reader.read();
      if (my !== op) return reader.cancel().catch(() => {});
      if (done) break;
      const chunk = dec.decode(value, { stream: true });
      if (!chunk) continue;
      if (!voice) firstWords();
      answer += chunk;
      voice.push(chunk);
      // Show the words as they come (at most ~8 times a second, no animation).
      const now = Date.now();
      if (now - shown > 120) {
        shown = now;
        currentText = answer;
        fit(answer, settings.textPt, true);
        el.message.scrollTop = el.message.scrollHeight;
      }
    }
    if (!answer.trim()) throw new Error('empty');
  } catch {
    clearTimeout(timer);
    if (my !== op) return;
    abort = null;
    sounds.thinkingStop();
    if (!answer.trim()) {
      sounds.error();
      setState('answer');
      return say(t('noAnswer'));
    }
    // The connection broke half-way: keep what arrived.
  }
  clearTimeout(timer);
  if (my !== op) return;
  abort = null;
  answer = answer.trim();
  history.push({ q, a: answer });
  lastAnswer = answer;
  show(answer); // final layout (and the screen reader reads it)
  voice.end();
  await voice.finished;
  if (my === op) await say(t('tapAgain'), { display: false });
}

// ---------- asking a question about the photo ----------

async function listen(intro) {
  cancelWork();
  const my = ++op;
  setState('listening');
  prompting = true;
  await say(intro);
  prompting = false;
  if (my !== op) return;
  sounds.listening();
  vibrate(60);
  el.body.classList.add('recording');
  recorderP = startListening(settings.lang, () => my === op && state === 'listening' && finishListening());
  recorderP.then((rec) => meter(rec, my)).catch(() => {});
  recorderP.catch(async () => {
    if (my !== op) return;
    recorderP = null;
    el.body.classList.remove('recording');
    sounds.error();
    await say(t('noMic'));
    if (my === op) ask('', my);
  });
}

// Feeds the microphone loudness to the CSS so the rings and screen edge move with your voice.
function meter(rec, my) {
  let smooth = 0;
  const tick = () => {
    if (my !== op || state !== 'listening') return el.body.style.setProperty('--level', '0');
    smooth = smooth * 0.7 + (rec.level?.() || 0) * 0.3;
    el.body.style.setProperty('--level', smooth.toFixed(3));
    requestAnimationFrame(tick);
  };
  tick();
}

async function finishListening() {
  if (state !== 'listening' || prompting || !recorderP) return;
  const my = ++op;
  const pending = recorderP;
  recorderP = null;
  el.body.classList.remove('recording');
  sounds.stop();
  setState('thinking');
  show(t('thinking'));
  talk(t('thinking'));
  sounds.thinkingStart();
  abort = new AbortController();
  let question = '';
  try {
    const rec = await pending;
    question = await rec.stop(abort.signal);
  } catch (e) {
    if (my !== op || e.name === 'AbortError') return;
    sounds.thinkingStop();
    await say(t('didntHear'));
    if (my !== op) return;
  }
  if (my !== op) return;
  const cmd = matchCommand(question);
  if (cmd) {
    sounds.thinkingStop();
    return runCommand(cmd, my);
  }
  ask(question, my);
}

async function runCommand(cmd, my) {
  let msg;
  switch (cmd) {
    case 'repeat':
      setState('answer');
      if (!lastAnswer) {
        msg = t('nothingToRepeat');
        break;
      }
      await say(lastAnswer);
      if (my === op) await say(t('tapAgain'), { display: false });
      return;
    case 'faster':
    case 'slower': {
      const v = step(RATES, settings.rate, cmd === 'faster' ? 1 : -1);
      if (v === false) msg = t(cmd === 'faster' ? 'fastest' : 'slowest');
      else {
        settings.rate = v;
        msg = t(cmd);
      }
      break;
    }
    case 'louder':
      if (settings.volume >= 1) msg = t('loudest');
      else {
        settings.volume = Math.min(1, Math.round((settings.volume + 0.1) * 10) / 10);
        msg = t('louder');
      }
      break;
    case 'language':
      changeLanguage();
      msg = t('languageName');
      break;
    case 'bigger':
    case 'smaller': {
      const v = step(SIZES, settings.textPt, cmd === 'bigger' ? 1 : -1);
      if (v === false) msg = t(cmd === 'bigger' ? 'biggest' : 'smallest');
      else {
        settings.textPt = v;
        msg = t('textSize', { n: v });
      }
      break;
    }
    case 'theme':
      settings.theme = THEMES[(THEMES.indexOf(settings.theme) + 1) % THEMES.length];
      msg = t(`themeNames.${settings.theme}`);
      break;
    case 'settings':
      return openSettings();
    case 'qibla':
    case 'describe':
      mode = cmd;
      settings.mode = mode;
      save();
      return goReady();
    case 'open':
      msg = t(DESKTOP ? 'openHintDesktop' : 'openHint');
      break;
    case 'help':
      msg = DESKTOP ? t('helpKeys') : t('helpTouch');
      break;
  }
  save();
  applyLook();
  setState('answer');
  await say(msg);
  if (my === op) await say(t('tapAgain'), { display: false });
}

function changeLanguage() {
  settings.lang = LANG_ORDER[(LANG_ORDER.indexOf(settings.lang) + 1) % LANG_ORDER.length];
  settings.langChosen = true;
  setLang(settings.lang);
  save();
  preloadPrompts();
}

// ---------- Qibla: starts by itself, updates live (location stays on the phone) ----------

const num = (n) => new Intl.NumberFormat(settings.lang === 'ar' ? 'ar-SA' : settings.lang === 'ml' ? 'ml-IN' : 'en-US').format(Math.round(n));

function stopQibla() {
  qibla?.stop();
  qibla = null;
  qiblaSay = '';
  delete el.body.dataset.running;
  delete el.body.dataset.facing;
}

async function runQibla(my) {
  let lastTick = 0;
  let lastSpoke = Date.now() + 6000; // let the introduction finish first
  let lastText = '';
  let warnedCalibration = false;
  let facts = null;
  // The pointer's angle, unwrapped so it always turns the short way (no spin from 179° to -179°).
  let pointer = null;
  // startQibla asks the iPhone for compass permission right now, inside the touch that got us here.
  const pending = startQibla(({ heading, turn, accuracy }) => {
    if (my !== op) return;
    el.body.style.setProperty('--heading', `${heading.toFixed(1)}deg`);
    pointer = pointer == null ? turn : pointer + ((((turn - pointer) % 360) + 540) % 360) - 180;
    el.body.style.setProperty('--turn', `${pointer.toFixed(1)}deg`);
    const off = Math.abs(turn);
    const now = Date.now();
    // iPhone tells us when the compass is unsure (accuracy in degrees, -1 = unknown).
    if (!warnedCalibration && (accuracy === -1 || accuracy > 25)) {
      warnedCalibration = true;
      lastSpoke = now + 3000;
      talk(t('calibrate'));
    }
    if (off < 8) {
      qiblaSay = t('facing');
      if (el.body.dataset.facing !== 'yes') {
        el.body.dataset.facing = 'yes';
        sounds.found();
        vibrate([60, 40, 60, 40, 200]);
        lastSpoke = now;
        fit(t('facing'), settings.textPt, true);
        talk(t('facing'));
      }
      return;
    }
    if (el.body.dataset.facing === 'yes' && off < 20) return; // stay "found" through small wobbles
    el.body.dataset.facing = 'no';
    const n = num(Math.round(off / 10) * 10 || 10);
    qiblaSay = off < 25 ? t('almost') : t(turn < 0 ? 'turnLeftDeg' : 'turnRightDeg', { n });
    // Ticks get faster and higher as you get closer.
    if (now - lastTick > 160 + off * 5) {
      lastTick = now;
      sounds.tick(1 - off / 180);
    }
    const text = `${turn < 0 ? '←' : '→'} ${num(Math.round(off / 5) * 5)}°`;
    if (text !== lastText) {
      lastText = text;
      fit(text, settings.textPt, true);
    }
    if (now - lastSpoke > 3500) {
      lastSpoke = now;
      talk(qiblaSay);
    }
  }, DEMO);
  let cancelled = false;
  qibla = { stop: () => (cancelled = true) };
  el.body.dataset.running = 'qibla';
  show(t('qiblaLocating'));
  talk(t('qiblaLocating'));
  let q;
  try {
    q = await pending;
  } catch {
    if (cancelled || my !== op) return;
    stopQibla();
    sounds.error();
    return say(t('noLocation'));
  }
  if (cancelled || my !== op) return q.stop();
  el.body.style.setProperty('--target', `${q.target.toFixed(1)}deg`);
  facts = { km: num(q.distanceKm), deg: num(q.target), dir: t(`compass.${compassPoint(q.target)}`) };
  if (!q.compass) {
    // Laptop or a phone without a compass: it cannot know which way you face,
    // so no compass is drawn — only the facts, and where to use it instead.
    qibla = null;
    el.body.dataset.running = 'qibla-none';
    qiblaSay = t('qiblaNoCompass', facts);
    return say(qiblaSay);
  }
  qibla = q;
  qiblaSay = t('qiblaIntro', facts);
  say(qiblaSay);
}

// ---------- settings ----------

function renderSettings() {
  $('settings-title').textContent = t('settings.title');
  $('settings-done').textContent = t('settings.done');
  $('lbl-lang').textContent = t('settings.language');
  $('lbl-size').textContent = t('settings.textSize');
  $('lbl-speed').textContent = t('settings.speechSpeed');
  $('lbl-theme').textContent = t('settings.colours');
  $('lbl-sr').textContent = t('settings.reader');
  for (const b of el.settings.querySelectorAll('.seg button')) b.setAttribute('aria-checked', b.dataset.v === settings.lang ? 'true' : 'false');
  for (const b of el.settings.querySelectorAll('.sw')) {
    b.setAttribute('aria-checked', b.dataset.v === settings.theme ? 'true' : 'false');
    b.setAttribute('aria-label', t(`themeNames.${b.dataset.v}`));
  }
  $('set-size').value = Math.max(0, SIZES.indexOf(settings.textPt));
  $('out-size').textContent = settings.textPt;
  $('set-speed').value = Math.max(0, RATES.indexOf(settings.rate));
  $('out-speed').textContent = `${settings.rate}×`;
  $('set-sr').setAttribute('aria-checked', settings.srMode ? 'true' : 'false');
}

function openSettings() {
  if (['settings', 'thinking'].includes(state)) return;
  returnState = state === 'start' ? 'start' : photo ? 'answer' : 'ready';
  cancelWork();
  ++op;
  setState('settings');
  el.settings.hidden = false;
  renderSettings();
  el.settings.querySelector('.seg [aria-checked="true"]')?.focus();
  say(t('settings.open'), { display: false });
}

function closeSettings() {
  el.settings.hidden = true;
  applyLook();
  if (returnState === 'start') return showStart();
  if (returnState === 'answer' && photo) {
    ++op;
    setState('answer');
    show(lastAnswer || t('tapAgain'));
    return say(t('tapAgain'), { display: false });
  }
  goReady();
}

function bindSettings() {
  // Each change is applied at once and spoken, so it can be used without looking.
  const changed = (msg) => {
    vibrate(20);
    sounds.tap();
    save();
    applyLook();
    renderSettings();
    updateLabels();
    say(msg, { display: false });
  };
  el.settings.querySelector('.seg').addEventListener('click', (e) => {
    const b = e.target.closest('[data-v]');
    if (!b || b.dataset.v === settings.lang) return;
    settings.lang = b.dataset.v;
    settings.langChosen = true;
    setLang(settings.lang);
    preloadPrompts();
    changed(t('languageName'));
  });
  el.settings.querySelector('.swatches').addEventListener('click', (e) => {
    const b = e.target.closest('[data-v]');
    if (!b) return;
    settings.theme = b.dataset.v;
    changed(t(`themeNames.${settings.theme}`));
  });
  const size = $('set-size');
  size.addEventListener('input', () => {
    settings.textPt = SIZES[+size.value];
    $('out-size').textContent = settings.textPt;
    applyLook();
  });
  size.addEventListener('change', () => changed(t('textSize', { n: settings.textPt })));
  const speed = $('set-speed');
  speed.addEventListener('input', () => {
    settings.rate = RATES[+speed.value];
    $('out-speed').textContent = `${settings.rate}×`;
  });
  speed.addEventListener('change', () => changed(t('settings.speed', { n: `${settings.rate}×` })));
  $('set-sr').addEventListener('click', () => {
    settings.srMode = !settings.srMode;
    el.body.classList.toggle('sr', settings.srMode);
    changed(t('settings.sr', { v: t(settings.srMode ? 'settings.on' : 'settings.off') }));
  });
  $('settings-done').addEventListener('click', () => closeSettings());
  el.settings.addEventListener('click', (e) => e.target === el.settings && closeSettings());
}

// ---------- phone housekeeping ----------

async function requestWakeLock() {
  try {
    await navigator.wakeLock?.request('screen');
  } catch {}
}

document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') {
    if (state === 'start') return;
    requestWakeLock();
    // Coming back: Qibla carries on by itself; Describe turns the camera back on.
    if (state === 'ready' && mode === 'qibla' && !qibla) goReady();
    else if (state === 'ready' && !cameraRunning()) startCamera(el.video).then(() => (el.body.dataset.camera = 'on')).catch(() => {});
    return;
  }
  // App hidden: stop microphone, camera, compass and speech right away.
  stopQibla();
  if (['listening', 'thinking'].includes(state)) {
    cancelWork();
    ++op;
    setState(photo ? 'answer' : 'ready');
    show(t('cancelled'));
  }
  stopSpeaking();
  stopCamera(el.video);
  el.body.dataset.camera = 'off';
});

addEventListener('resize', () => {
  if (currentText && !paging && !el.body.dataset.running) layoutText(currentText);
});

async function checkServer() {
  try {
    const h = await (await fetch('/api/health')).json();
    useServerStt(h.transcribe);
    enableServerVoice(h.voice === 'elevenlabs' ? 'always' : false);
    preloadPrompts();
  } catch {
    useServerStt(false);
  }
}

function preloadPrompts() {
  // Fetch the ElevenLabs audio for the common phrases now, so they play instantly later.
  preload(
    [t('disclaimer'), readyPrompt(), t('ready'), t('tapAgain'), t('newPhoto'), t('askNow'), t('qiblaLocating'), t('facing'), t('almost'), t('noAnswer'), t('cancelled')],
    settings.lang
  );
}

function showStart() {
  ++op;
  setState('start');
  show(pendingPicture ? t('sharedReceivedStart') : DESKTOP ? t('tapToStartDesktop') : t('tapToStart'));
}

// ---------- boot ----------

if (new URLSearchParams(location.search).get('sr') === '1') settings.srMode = true;
setLang(settings.lang);
applyLook();
showMode();
el.body.classList.toggle('sr', settings.srMode);
el.body.classList.toggle('desktop', DESKTOP);
bindGestures();
bindSettings();
initGlass({ video: el.video, photo: el.photo, body: el.body });
checkServer();
showStart();
// Offline app shell: the app and Qibla open without internet.
if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(() => {});
