// Records the spoken question and turns it into text.
// Main path: MediaRecorder → /api/transcribe (works well for Arabic and Malayalam).
// Fallback: the browser's own speech recognition when the server cannot transcribe.
import { LOCALES } from './i18n.js';
import { speakerMode } from './voice.js';

const MAX_MS = 15000; // a spoken question is never this long
const END_SILENCE_MS = 1200; // this much quiet after speech = finished
const NOBODY_SPOKE_MS = 7000; // no speech at all within this time = no question
const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
let serverStt = true;

export function useServerStt(on) {
  serverStt = on;
}

function pickMime() {
  if (!window.MediaRecorder) return null;
  const list = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg;codecs=opus'];
  return list.find((m) => MediaRecorder.isTypeSupported?.(m)) ?? '';
}

function blobToBase64(blob) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result).split(',')[1] || '');
    r.onerror = reject;
    r.readAsDataURL(blob);
  });
}

/**
 * Starts listening. Returns { stop(): Promise<string>, cancel() }.
 * stop() resolves with the question text ('' if nothing was heard).
 * onAutoStop is called if the 30 second limit is reached.
 */
export async function startListening(lang, onAutoStop) {
  const mime = pickMime();
  if (serverStt && mime !== null) return recordForServer(lang, mime, onAutoStop);
  if (SR) return browserRecognition(lang, onAutoStop);
  throw new Error('no-speech-input');
}

// How loud the microphone is right now, from 0 (silent) to 1 (loud).
function makeMeter(stream) {
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 512;
    ctx.createMediaStreamSource(stream).connect(analyser);
    const data = new Uint8Array(analyser.fftSize);
    return {
      level() {
        analyser.getByteTimeDomainData(data);
        let sum = 0;
        for (const v of data) sum += ((v - 128) / 128) ** 2;
        return Math.min(1, Math.sqrt(sum / data.length) * 5);
      },
      close: () => ctx.close().catch(() => {}),
      works: true,
    };
  } catch {
    return { level: () => 0, close() {}, works: false };
  }
}

async function recordForServer(lang, mime, onAutoStop) {
  speakerMode(true);
  const stream = await navigator.mediaDevices.getUserMedia({
    audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
  });
  const rec = new MediaRecorder(stream, mime ? { mimeType: mime, audioBitsPerSecond: 32000 } : undefined);
  const meter = makeMeter(stream);
  const chunks = [];
  rec.ondataavailable = (e) => e.data.size && chunks.push(e.data);
  const started = Date.now();
  // Listens to the loudness to know when you have finished speaking (like Siri), and remembers the
  // loudest moment, so a silent recording is never sent (an AI can "hear" words in silence).
  let peak = 0;
  let floor = null; // room noise, measured in the first moments
  let heard = false;
  let quietSince = 0;
  let calm = 0;
  let prev = 0;
  const vad = setInterval(() => {
    const lv = meter.level();
    peak = Math.max(peak, lv);
    const now = Date.now();
    if (floor === null) {
      if (now - started < 300) return void (calm = Math.max(calm, lv));
      floor = calm;
    }
    // Keep learning the room noise the whole time. A steady sound (a fan, air conditioning, traffic,
    // our own voice still fading) slowly becomes "the room"; speech rises and falls, so it stays speech.
    const steady = Math.abs(lv - prev) < 0.15 * Math.max(lv, 0.02);
    prev = lv;
    if (lv < floor) floor = lv;
    else floor += (lv - floor) * (steady ? 0.02 : 0.002);
    const speech = Math.max(0.1, floor * 2.2);
    if (lv > speech) {
      heard = true;
      quietSince = 0;
    } else if (heard) {
      quietSince ||= now;
      if (now - quietSince > END_SILENCE_MS) {
        clearInterval(vad);
        onAutoStop?.(); // you stopped talking: answer now
      }
    } else if (now - started > NOBODY_SPOKE_MS) {
      clearInterval(vad);
      onAutoStop?.(); // nobody spoke: carry on without a question
    }
  }, 80);
  rec.start(250);
  const timer = setTimeout(() => onAutoStop?.(), MAX_MS);
  const release = () => {
    clearTimeout(timer);
    clearInterval(vad);
    meter.close();
    stream.getTracks().forEach((t) => t.stop());
    speakerMode(false); // back to the loudspeaker for the answer
  };
  const stopped = () =>
    new Promise((resolve) => {
      if (rec.state === 'inactive') return resolve();
      rec.onstop = resolve;
      rec.stop();
    });

  return {
    level: meter.level,
    async stop(signal) {
      await stopped();
      release();
      const ms = Date.now() - started;
      const blob = new Blob(chunks, { type: rec.mimeType || mime || 'audio/webm' });
      chunks.length = 0;
      if (ms < 700 || blob.size < 2000) return '';
      if (meter.works && peak < 0.08) return ''; // nothing louder than room noise was heard
      const r = await fetch('/api/transcribe', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ audio: await blobToBase64(blob), mime: blob.type, lang }),
        signal,
      });
      if (!r.ok) throw new Error('stt-failed');
      return ((await r.json()).text || '').trim();
    },
    cancel() {
      stopped().then(release);
      chunks.length = 0;
    },
  };
}

function browserRecognition(lang, onAutoStop) {
  return new Promise((resolveStart, rejectStart) => {
    const rec = new SR();
    rec.lang = LOCALES[lang];
    rec.continuous = false; // the browser ends by itself when you stop talking
    rec.interimResults = false;
    let text = '';
    let ended = false;
    let onEnd = null;
    rec.onresult = (e) => {
      for (let i = e.resultIndex; i < e.results.length; i++) if (e.results[i].isFinal) text += e.results[i][0].transcript + ' ';
    };
    rec.onerror = (e) => rejectStart(new Error(e.error || 'speech-error')); // ignored once started
    rec.onend = () => {
      ended = true;
      if (onEnd) onEnd();
      else onAutoStop?.(); // stopped talking: answer now
    };
    rec.onstart = () =>
      resolveStart({
        stop: () =>
          new Promise((resolve) => {
            clearTimeout(timer);
            if (ended) return resolve(text.trim());
            onEnd = () => resolve(text.trim());
            rec.stop();
            setTimeout(() => resolve(text.trim()), 2500);
          }),
        cancel: () => {
          clearTimeout(timer);
          rec.abort();
        },
      });
    const timer = setTimeout(() => onAutoStop?.(), MAX_MS);
    try {
      rec.start();
    } catch (e) {
      rejectStart(e);
    }
  });
}
