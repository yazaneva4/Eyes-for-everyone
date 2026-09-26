// Short sounds made with the Web Audio API, so there are no sound files to load.
import { settings } from './settings.js';

let ctx;
let thinkingTimer = null;

/** The app's single Web Audio engine (unlocked by the first tap), also used for the voice. */
export const audioContext = () => ac();

function ac() {
  if (!ctx) {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    ctx = new AC();
  }
  if (ctx.state === 'suspended') ctx.resume();
  return ctx;
}

function tone(freq, at, dur, { type = 'sine', gain = 0.25, to } = {}) {
  const c = ac();
  if (!c) return;
  const t0 = c.currentTime + at;
  const osc = c.createOscillator();
  const g = c.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, t0);
  if (to) osc.frequency.exponentialRampToValueAtTime(to, t0 + dur);
  const peak = gain * settings.volume;
  g.gain.setValueAtTime(0.0001, t0);
  g.gain.exponentialRampToValueAtTime(peak, t0 + 0.012);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  osc.connect(g).connect(c.destination);
  osc.start(t0);
  osc.stop(t0 + dur + 0.02);
}

function noise(at, dur, gain) {
  const c = ac();
  if (!c) return;
  const buf = c.createBuffer(1, Math.floor(c.sampleRate * dur), c.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < data.length; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / data.length) ** 2;
  const src = c.createBufferSource();
  const g = c.createGain();
  const hp = c.createBiquadFilter();
  hp.type = 'highpass';
  hp.frequency.value = 1500;
  g.gain.value = gain * settings.volume;
  src.buffer = buf;
  src.connect(hp).connect(g).connect(c.destination);
  src.start(c.currentTime + at);
}

export const sounds = {
  unlock: () => ac(),
  tap: () => tone(1200, 0, 0.03, { gain: 0.08 }),
  // Camera click: two quick noise bursts.
  shutter: () => {
    noise(0, 0.05, 0.9);
    noise(0.07, 0.07, 0.6);
  },
  // Rising two notes: "I'm listening now".
  listening: () => {
    tone(660, 0, 0.12, { gain: 0.3 });
    tone(990, 0.13, 0.18, { gain: 0.3 });
  },
  // Falling two notes: "Got it".
  stop: () => {
    tone(990, 0, 0.1, { gain: 0.25 });
    tone(660, 0.11, 0.14, { gain: 0.25 });
  },
  // Soft pulse that repeats while waiting for the AI.
  thinkingStart: () => {
    sounds.thinkingStop();
    const pulse = () => {
      tone(440, 0, 0.25, { gain: 0.08, to: 520 });
      tone(660, 0.3, 0.25, { gain: 0.06, to: 600 });
    };
    pulse();
    thinkingTimer = setInterval(pulse, 1400);
  },
  thinkingStop: () => {
    clearInterval(thinkingTimer);
    thinkingTimer = null;
  },
  // Bright three-note chime: "Here is your answer".
  answer: () => {
    tone(523, 0, 0.18, { gain: 0.22 });
    tone(659, 0.09, 0.2, { gain: 0.22 });
    tone(784, 0.18, 0.35, { gain: 0.22 });
  },
  // Short tick for the Qibla compass: higher and louder the closer you are.
  tick: (closeness) => tone(500 + closeness * 700, 0, 0.06, { gain: 0.12 + closeness * 0.15 }),
  // Soft two-note "you found it".
  found: () => {
    tone(784, 0, 0.16, { gain: 0.25 });
    tone(1046, 0.15, 0.3, { gain: 0.25 });
  },
  error: () => {
    tone(220, 0, 0.18, { type: 'triangle', gain: 0.35 });
    tone(180, 0.22, 0.28, { type: 'triangle', gain: 0.35 });
  },
};

export function vibrate(pattern) {
  try {
    navigator.vibrate?.(pattern);
  } catch {}
}
