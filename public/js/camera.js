// Opens the back camera, takes a still photo, and checks if it is too dark or blurry.

let stream = null;
const demo = new URLSearchParams(location.search).has('demo');

const within = (ms, p, name) =>
  Promise.race([p, new Promise((_, reject) => setTimeout(() => reject(Object.assign(new Error(name), { name })), ms))]);

/**
 * Turns the camera on. Never waits forever. Errors keep the browser's reason in `name`:
 * NotAllowedError (blocked), NotReadableError (another app uses it), NotFoundError (no camera),
 * NoAnswer (the permission question was not answered), NotSupported (no camera access in this browser).
 */
export async function startCamera(video) {
  if (demo) return;
  if (stream) return;
  if (!navigator.mediaDevices?.getUserMedia) throw Object.assign(new Error('NotSupported'), { name: 'NotSupported' });
  const ask = (constraints) => {
    const asking = navigator.mediaDevices.getUserMedia(constraints);
    return within(20000, asking, 'NoAnswer').catch((e) => {
      // If the camera turns up after we gave up, switch it straight off again.
      if (e.name === 'NoAnswer') asking.then((late) => late.getTracks().forEach((t) => t.stop())).catch(() => {});
      throw e;
    });
  };
  let s;
  try {
    // Back camera on phones, the best resolution the camera offers.
    s = await ask({ video: { facingMode: { ideal: 'environment' }, width: { ideal: 1920 }, height: { ideal: 1080 } }, audio: false });
  } catch (e) {
    console.warn('[Eyes] camera, first try:', e.name, e.message);
    // Blocked or unanswered: asking again will not help.
    if (e.name === 'NotAllowedError' || e.name === 'SecurityError' || e.name === 'NoAnswer') throw e;
    // Anything else (e.g. a laptop webcam that dislikes the settings): the plainest possible request.
    try {
      s = await ask({ video: true, audio: false });
    } catch (e2) {
      console.warn('[Eyes] camera, plain try:', e2.name, e2.message);
      throw e2;
    }
  }
  stream = s;
  video.srcObject = stream;
  await within(4000, video.play(), 'NoFrames').catch(() => {});
  // Wait (briefly) for the first frame so the first tap never captures black.
  if (video.readyState < 2) await within(4000, new Promise((r) => video.addEventListener('loadeddata', r, { once: true })), 'NoFrames').catch(() => {});
}

export function stopCamera(video) {
  stream?.getTracks().forEach((t) => t.stop());
  stream = null;
  if (video) video.srcObject = null;
}

export const cameraRunning = () => demo || !!stream;

// A fake scene for testing on a laptop without a camera (?demo in the address).
function drawDemo(ctx, w, h) {
  const g = ctx.createLinearGradient(0, 0, w, h);
  g.addColorStop(0, '#6b8fb3');
  g.addColorStop(1, '#2c3e50');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, w, h);
  ctx.fillStyle = '#d64541';
  ctx.fillRect(w * 0.1, h * 0.45, w * 0.25, h * 0.4);
  ctx.fillStyle = '#f5f5f5';
  ctx.fillRect(w * 0.55, h * 0.2, w * 0.35, h * 0.55);
  ctx.fillStyle = '#111';
  ctx.font = `bold ${Math.round(h * 0.08)}px sans-serif`;
  ctx.fillText('MILK', w * 0.6, h * 0.4);
  ctx.font = `${Math.round(h * 0.05)}px sans-serif`;
  ctx.fillText('1 LITRE', w * 0.6, h * 0.5);
  ctx.fillText('Best before 12/10', w * 0.57, h * 0.62);
}

/** Grabs the current frame, scaled so the longest side is at most maxSide. */
export function capture(video, maxSide = 1280) {
  const vw = demo ? 1280 : video.videoWidth;
  const vh = demo ? 960 : video.videoHeight;
  if (!vw || !vh) throw new Error('no-frame');
  const scale = Math.min(1, maxSide / Math.max(vw, vh));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(vw * scale);
  canvas.height = Math.round(vh * scale);
  const ctx = canvas.getContext('2d');
  if (demo) drawDemo(ctx, canvas.width, canvas.height);
  else ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
  return canvas;
}

export function toJpegBase64(canvas, quality = 0.85) {
  return canvas.toDataURL('image/jpeg', quality).split(',')[1];
}

/**
 * Brightness = average grey level (0 black … 255 white).
 * Sharpness = how much the edges change (variance of the Laplacian). Blurry photos have soft edges.
 */
export function checkQuality(canvas) {
  const w = 320;
  const h = Math.max(1, Math.round((canvas.height / canvas.width) * w));
  const small = document.createElement('canvas');
  small.width = w;
  small.height = h;
  const ctx = small.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(canvas, 0, 0, w, h);
  const px = ctx.getImageData(0, 0, w, h).data;
  const grey = new Float32Array(w * h);
  let sum = 0;
  let blown = 0;
  for (let i = 0; i < w * h; i++) {
    const y = 0.299 * px[i * 4] + 0.587 * px[i * 4 + 1] + 0.114 * px[i * 4 + 2];
    grey[i] = y;
    sum += y;
    if (y > 250) blown++;
  }
  const mean = sum / (w * h);
  let lapSum = 0;
  let lapSq = 0;
  let n = 0;
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const i = y * w + x;
      const l = 4 * grey[i] - grey[i - 1] - grey[i + 1] - grey[i - w] - grey[i + w];
      lapSum += l;
      lapSq += l * l;
      n++;
    }
  }
  const sharpness = lapSq / n - (lapSum / n) ** 2;
  let problem = null;
  if (mean < 35) problem = 'tooDark';
  else if (mean > 235 || blown / (w * h) > 0.6) problem = 'tooBright';
  else if (sharpness < 18) problem = 'blurry';
  return { ok: !problem, problem, mean: Math.round(mean), sharpness: Math.round(sharpness) };
}
