// Speaks text out loud.
//   'always'   → ElevenLabs/Gemini for everything, phone voice only as a backup.
//   'fallback' → the device's own voice (free, unlimited, no quota) whenever the language has
//                one; the server is only used for languages the device can't speak.
// Screen reader mode stays silent because the screen reader reads the live region instead.
import { settings } from './settings.js';
import { audioContext } from './sounds.js';
import { LOCALES } from './i18n.js';

let voices = [];
// The device's own voice (including a downloaded "Siri" voice) costs nothing and never runs out,
// so it is the default; the paid server voice only fills in languages the device has no voice for.
let serverVoice = 'always'; // false | 'fallback' | 'always'
// Recently spoken sentences, kept in memory only so repeated prompts play instantly.
const cache = new Map();
const CACHE_MAX = 60;
let token = 0;
// ElevenLabs audio plays through Web Audio (the same engine as the app's sounds). Once the first
// tap has unlocked it, it plays everywhere, including iPhone Safari, without per-clip autoplay rules.
let current = null; // the clip playing now
// A second player: the ordinary <audio> element, used if Web Audio is still locked.
const player = new Audio();
player.preload = 'auto';

// ?debug in the address shows what the voice is doing, on screen.
const DEBUG = new URLSearchParams(location.search).has('debug');
let debugBox = null;
export function voiceLog(msg) {
  if (!DEBUG) return;
  if (!debugBox) {
    debugBox = document.createElement('pre');
    debugBox.id = 'voice-debug';
    document.body.append(debugBox);
  }
  const c = audioContext();
  const line = `${new Date().toLocaleTimeString()} [audio ${c ? c.state : 'none'}] ${msg}`;
  debugBox.textContent = (line + '\n' + debugBox.textContent).slice(0, 3000);
}

function loadVoices() {
  voices = window.speechSynthesis?.getVoices() || [];
}
if ('speechSynthesis' in window) {
  loadVoices();
  speechSynthesis.addEventListener?.('voiceschanged', loadVoices);
}

// When ElevenLabs is out of credits, the phone's voice is used straight away (no waiting on
// failed requests) and ElevenLabs is tried again after a while.
let serverRestUntil = 0;
const serverOn = () => Date.now() >= serverRestUntil && serverVoice === 'always';

export function enableServerVoice(mode) {
  serverVoice = mode;
}

// Backup voice (only if ElevenLabs cannot be reached): the most natural voice on the device,
// never the robotic novelty voices.
const ROBOTIC = /fred|albert|zarvox|trinoids|whisper|wobble|bad news|good news|bahh|bells|boing|bubbles|cellos|jester|organ|superstar|hysterical|junior|ralph|kathy|deranged|pipe|espeak|robot/i;
const NATURAL = [/google/i, /premium/i, /enhanced/i, /natural/i, /neural/i, /siri/i, /samantha|ava|allison|susan|zoe|evan|nathan|karen|daniel|moira|tessa/i, /microsoft .*online/i];

function voiceFor(lang) {
  const locale = (LOCALES[lang] || 'en-US').toLowerCase();
  const family = locale.split('-')[0]; // any Urdu voice for 'ur', any English voice for 'en-US'
  const norm = (v) => v.lang.replace('_', '-').toLowerCase();
  const matches = voices.filter((v) => norm(v).split('-')[0] === family && !ROBOTIC.test(v.name));
  if (!matches.length) return null;
  const score = (v) => {
    const i = NATURAL.findIndex((re) => re.test(v.name));
    return (i === -1 ? 0 : 100 - i * 5) + (norm(v) === locale ? 10 : 0) + (v.localService ? 1 : 0);
  };
  return matches.slice().sort((x, y) => score(y) - score(x))[0];
}

export function splitSentences(text) {
  return (text.match(/[^.!?؟।\n]+[.!?؟।]*\s*/g) || [text]).map((s) => s.trim()).filter(Boolean);
}

function silentWav() {
  const buf = new ArrayBuffer(44 + 800);
  const v = new DataView(buf);
  const w = (o, str) => [...str].forEach((c, i) => v.setUint8(o + i, c.charCodeAt(0)));
  w(0, 'RIFF'); v.setUint32(4, 36 + 800, true); w(8, 'WAVE'); w(12, 'fmt ');
  v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true);
  v.setUint32(24, 8000, true); v.setUint32(28, 16000, true); v.setUint16(32, 2, true);
  v.setUint16(34, 16, true); w(36, 'data'); v.setUint32(40, 800, true);
  return URL.createObjectURL(new Blob([buf], { type: 'audio/wav' }));
}

// Call inside the first tap so iPhone allows sound later.
export function unlockVoice() {
  try {
    // iPhone: say we are a playback app before anything plays, so the silent switch does not mute us.
    if (navigator.audioSession) navigator.audioSession.type = 'playback';
  } catch {}
  try {
    const c = audioContext();
    c?.resume?.();
    // A silent blip inside the tap fully unlocks Web Audio on iPhone.
    if (c) {
      const b = c.createBuffer(1, 1, 22050);
      const src = c.createBufferSource();
      src.buffer = b;
      src.connect(c.destination);
      src.start(0);
    }
    if ('speechSynthesis' in window && !unlockedOnce) {
      const u = new SpeechSynthesisUtterance(' ');
      u.volume = 0;
      speechSynthesis.speak(u);
    }
    // Unlock the backup <audio> player inside the same gesture.
    if (!unlockedOnce) {
      player.src = 'data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEAQB8AAIA+AAACABAAZGF0YQAAAAA=';
      player.play().catch(() => {});
    }
    unlockedOnce = true;
    voiceLog('unlocked by a touch/click');
  } catch (e) {
    voiceLog('unlock failed: ' + e.message);
  }
}
let unlockedOnce = false;

// Browsers only allow sound after a person touches the page, and some (iPhone) only count the end
// of a touch or a click. Unlock on every one of these, so sound can never stay locked.
for (const type of ['pointerup', 'touchend', 'click', 'keydown']) {
  addEventListener(type, () => {
    const c = audioContext();
    if (!unlockedOnce || (c && c.state !== 'running')) unlockVoice();
  }, { capture: true, passive: true });
}

// How loud the AI voice is right now (0 silent … 1 loud), for the orb.
// ElevenLabs audio is measured for real; the backup voices cannot be measured, so they get a gentle
// speech-like wobble instead.
let analyser = null;
let levelData = null;
let playing = null; // 'measured' | 'estimated' | null
function voiceOut(c) {
  if (!analyser) {
    analyser = c.createAnalyser();
    analyser.fftSize = 512;
    analyser.connect(c.destination);
    levelData = new Uint8Array(analyser.fftSize);
  }
  return analyser;
}
export function voiceLevel() {
  if (playing === 'measured' && analyser) {
    analyser.getByteTimeDomainData(levelData);
    let sum = 0;
    for (const v of levelData) sum += ((v - 128) / 128) ** 2;
    return Math.min(1, Math.sqrt(sum / levelData.length) * 4.5);
  }
  if (playing === 'estimated') {
    const t = performance.now() / 1000;
    return Math.max(0, 0.4 + 0.22 * Math.sin(t * 9) * Math.sin(t * 2.3) + 0.1 * Math.sin(t * 17));
  }
  return 0;
}
export const voicePlaying = () => !!playing;

export function stopSpeaking() {
  token++;
  try {
    speechSynthesis.cancel();
  } catch {}
  try {
    current?.stop();
  } catch {}
  current = null;
  playing = null;
  player.pause();
}

function estimateMs(text) {
  return (text.length * 85) / settings.rate + 2500;
}

function speakBrowser(text, lang, my) {
  voiceLog('using the phone voice for: ' + text.slice(0, 40));
  return new Promise((resolve) => {
    if (!('speechSynthesis' in window)) return setTimeout(resolve, 400);
    const u = new SpeechSynthesisUtterance(text);
    u.lang = LOCALES[lang];
    const v = voiceFor(lang);
    if (v) u.voice = v;
    u.rate = settings.rate;
    u.volume = settings.volume;
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      clearInterval(watch);
      playing = null;
      resolve();
    };
    // onend is not always fired on every phone, so a timer backs it up.
    const timer = setTimeout(finish, estimateMs(text));
    const watch = setInterval(() => my !== token && finish(), 100);
    u.onend = finish;
    u.onerror = finish;
    playing = 'estimated';
    speechSynthesis.speak(u);
  });
}

// ElevenLabs speaks at the chosen speed itself (it can do 0.7× to 1.2×).
const voiceSpeed = () => Math.min(1.2, Math.max(0.7, settings.rate));

// ElevenLabs allows only a few requests at the same time, so at most 3 go out at once,
// and a failed one is tried once more, so every sentence stays in the same voice.
const MAX_AT_ONCE = 3;
let inFlight = 0;
const waiting = [];
function limited(job, urgent) {
  return new Promise((resolve, reject) => {
    const run = () => {
      inFlight++;
      job()
        .then(resolve, reject)
        .finally(() => {
          inFlight--;
          waiting.shift()?.();
        });
    };
    if (inFlight < MAX_AT_ONCE) run();
    else if (urgent) waiting.unshift(run); // something to say now goes before background pre-fetching
    else waiting.push(run);
  });
}

// Which server voice answered last: with Google's (small request quota) sentences go in groups.
let lastVoice = null;
async function fetchVoice(text, lang, speed, preload = false) {
  for (let attempt = 0; ; attempt++) {
    // Resting after "no credits": only languages the phone cannot speak itself still ask the server.
    if (Date.now() < serverRestUntil && voiceFor(lang)) throw new Error('tts');
    const r = await fetch('/api/speak', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ text, lang, speed, ...(preload ? { preload: true } : {}), ...(lang === 'x' ? { langName: settings.custom?.name } : {}) }),
    });
    if (r.status === 204) throw new Error('tts'); // nothing to pre-load right now
    if (r.ok) {
      const data = await r.arrayBuffer();
      data.audioType = r.headers.get('content-type') || 'audio/mpeg'; // MP3 from ElevenLabs, WAV from Google
      lastVoice = r.headers.get('x-voice') || lastVoice;
      voiceLog(`voice: ${lastVoice || 'server'}`);
      return data;
    }
    voiceLog(`ElevenLabs answered ${r.status} for: ${text.slice(0, 30)}`);
    if (r.status === 429 || r.status === 503) {
      serverRestUntil = Date.now() + 5 * 60 * 1000;
      voiceLog('ElevenLabs unavailable (no credits?) — using the phone voice for 5 minutes');
      throw new Error('tts');
    }
    if (attempt >= 1) throw new Error('tts');
    await new Promise((res) => setTimeout(res, 500));
  }
}

/** Fetches (and decodes) the ElevenLabs audio for one sentence. Resolves to an AudioBuffer. */
function fetchServerAudio(text, lang, urgent = true) {
  const speed = voiceSpeed();
  const key = `${lang}|${speed}|${text}`;
  if (cache.has(key)) {
    const hit = cache.get(key);
    cache.delete(key);
    cache.set(key, hit); // most recently used goes last
    return hit;
  }
  const p = limited(() => fetchVoice(text, lang, speed, !urgent), urgent)
    .then((data) => {
      const c = audioContext();
      if (!c) throw new Error('no-audio');
      const copy = data.slice(0);
      const type = data.audioType;
      return new Promise((resolve, reject) =>
        c.decodeAudioData(
          data,
          (buffer) => {
            buffer.mp3 = copy; // for the backup player
            buffer.audioType = type;
            resolve(buffer);
          },
          (e) => {
            voiceLog('could not decode voice: ' + (e?.message || e));
            reject(e);
          }
        )
      );
    });
  p.catch(() => cache.delete(key));
  cache.set(key, p);
  if (cache.size > CACHE_MAX) cache.delete(cache.keys().next().value);
  return p;
}

/** Warm the cache for prompts the app is about to say, so they start instantly. */
export function preload(texts, lang) {
  if (!serverOn()) return;
  texts.forEach((t) => splitSentences(t).forEach((s) => fetchServerAudio(s, lang, false).catch(() => {})));
}

/**
 * iPhone Safari moves sound to the quiet call earpiece after the microphone is used.
 * Telling it we are a "playback" app again sends speech back to the loudspeaker.
 */
export function speakerMode(recording) {
  try {
    if (navigator.audioSession) navigator.audioSession.type = recording ? 'play-and-record' : 'playback';
  } catch {}
}

/** Plays one decoded clip. Resolves true when it played, false if sound is not possible. */
async function playUrl(buffer, my) {
  const c = audioContext();
  if (!buffer) return false;
  if (c && c.state !== 'running') {
    try {
      await Promise.race([c.resume(), new Promise((r) => setTimeout(r, 1500))]);
    } catch {}
  }
  if (my !== token) return true;
  if (!c || c.state !== 'running') {
    voiceLog('Web Audio locked, trying the audio player');
    return playWithPlayer(buffer, my);
  }
  voiceLog(`playing ${buffer.duration.toFixed(1)}s of ElevenLabs voice`);
  return new Promise((resolve) => {
    const src = c.createBufferSource();
    const gain = c.createGain();
    src.buffer = buffer;
    gain.gain.value = Math.min(1, settings.volume);
    src.connect(gain).connect(voiceOut(c));
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      if (current === src) playing = null;
      clearInterval(watch);
      if (current === src) current = null;
      resolve(true);
    };
    const watch = setInterval(() => {
      if (my !== token) {
        try {
          src.stop();
        } catch {}
        finish();
      }
    }, 100);
    src.onended = finish;
    current = src;
    playing = 'measured';
    src.start();
  });
}

/** Backup: the ordinary audio player. Resolves true if it played. */
function playWithPlayer(buffer, my) {
  if (!buffer.mp3) return Promise.resolve(false);
  return new Promise((resolve) => {
    const url = URL.createObjectURL(new Blob([buffer.mp3], { type: buffer.audioType || 'audio/mpeg' }));
    let done = false;
    const finish = (ok) => {
      if (done) return;
      done = true;
      clearInterval(watch);
      clearTimeout(stall);
      playing = null;
      URL.revokeObjectURL(url);
      resolve(ok);
    };
    const watch = setInterval(() => my !== token && (player.pause(), finish(true)), 100);
    const stall = setTimeout(() => (player.pause(), finish(false)), 8000);
    player.onended = () => finish(true);
    player.onerror = () => finish(false);
    player.src = url;
    player.volume = Math.min(1, settings.volume);
    player
      .play()
      .then(() => {
        playing = 'estimated';
        voiceLog('audio player is playing');
      })
      .catch((e) => {
        voiceLog('audio player refused: ' + e.name);
        finish(false);
      });
  });
}

function srWait(text, my) {
  return new Promise((resolve) => {
    const end = Date.now() + text.split(/\s+/).length * 380 + 600;
    const watch = setInterval(() => {
      if (my !== token || Date.now() > end) {
        clearInterval(watch);
        resolve();
      }
    }, 100);
  });
}

/**
 * Speak text sentence by sentence. Resolves when finished or stopped.
 * onSentence(index, sentence) lets the screen show the part being spoken.
 */
/** Joins sentences into groups of about `max` characters (fewer requests for Google's voice). */
function group(parts, max = 220) {
  const out = [];
  for (const p of parts) {
    if (out.length && out[out.length - 1].length + p.length < max) out[out.length - 1] += ' ' + p;
    else out.push(p);
  }
  return out;
}
const numberOnly = (t) => /^[\s\d٠-٩൦-൯.,]+$/.test(t);

export async function speak(text, { lang = settings.lang, onSentence } = {}) {
  stopSpeaking();
  speakerMode(false);
  const my = token;
  // A bare number (the countdown) must be instant: if the phone has no voice for this language,
  // say it with the phone's English voice rather than wait for the server.
  if (numberOnly(text) && !voiceFor(lang) && !serverOn()) return speakBrowser(text.trim(), 'en', my);
  const parts = lastVoice === 'gemini' ? group(splitSentences(text)) : splitSentences(text);
  const useServer = serverVoice !== false && (serverOn() || !voiceFor(lang)); // no phone voice (often Malayalam): always the server's natural voice
  // Ask the server for every sentence at once so playback has no gaps.
  const urls = useServer ? parts.map((p) => fetchServerAudio(p, lang).catch(() => null)) : [];
  for (let i = 0; i < parts.length; i++) {
    if (my !== token) return;
    onSentence?.(i, parts[i]);
    if (useServer) {
      const url = await urls[i];
      if (my !== token) return;
      // If the clip is missing or the phone blocks it, say it with the phone's own voice instead.
      const played = url ? await playUrl(url, my) : false;
      if (!played && my === token) await speakBrowser(parts[i], lang, my);
    } else {
      await speakBrowser(parts[i], lang, my);
    }
  }
}

/**
 * Speak an answer while it is still arriving (real-time).
 * push(text) adds words as they come; each finished sentence starts playing at once
 * (its ElevenLabs audio is fetched the moment the sentence is complete).
 * end() says the rest; `finished` resolves when everything has been spoken or it was stopped.
 */
export function speakStream({ lang = settings.lang, onSentence } = {}) {
  stopSpeaking();
  speakerMode(false);
  const my = token;
  const useServer = serverVoice !== false && (serverOn() || !voiceFor(lang)); // no phone voice (often Malayalam): always the server's natural voice
  const queue = [];
  let buf = '';
  let ended = false;
  let wake = null;
  let index = 0;
  const enqueue = (sentence) => {
    const s = sentence.trim();
    if (!s) return;
    queue.push({ s, url: useServer ? fetchServerAudio(s, lang).catch(() => null) : null });
    wake?.();
  };
  // A sentence is finished when its full stop (or ? ! ؟ ।) is followed by a space.
  const cut = () => {
    let m;
    // With Google's voice, wait for about two sentences so there are fewer requests.
    const min = lastVoice === 'gemini' ? 180 : 0;
    let from = 0;
    while ((m = /[.!?؟।]+["'”’)\]]*\s+/g.exec(buf.slice(from)))) {
      const endAt = from + m.index + m[0].length;
      if (endAt >= min) {
        enqueue(buf.slice(0, endAt));
        buf = buf.slice(endAt);
        from = 0;
      } else from = endAt;
    }
  };
  const finished = (async () => {
    for (;;) {
      if (my !== token) return;
      if (queue.length) {
        const { s, url } = queue.shift();
        onSentence?.(index++, s);
        if (useServer) {
          const u = await url;
          if (my !== token) return;
          const played = u ? await playUrl(u, my) : false;
          if (!played && my === token) await speakBrowser(s, lang, my);
        } else {
          await speakBrowser(s, lang, my);
        }
      } else if (ended) {
        return;
      } else {
        await new Promise((r) => (wake = r));
        wake = null;
      }
    }
  })();
  return {
    push(text) {
      buf += text;
      cut();
    },
    end() {
      ended = true;
      enqueue(buf);
      buf = '';
      wake?.();
    },
    finished,
  };
}
