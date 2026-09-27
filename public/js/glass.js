// Liquid glass that never gets hard to read.
// It looks at the picture behind every glass panel and makes that panel exactly as
// see-through as it can be while keeping text contrast at 7:1 or better.
// It also moves the glass highlight with your finger and with phone tilt.

const TARGET = 7.5; // a little above 7:1 for safety
const MIN_A = 0.42; // clearest glass allowed
const MAX_A = 0.94;
const SCALE = 8; // measure at 1/8 screen size; 4×4 cells ≈ the 32px glass blur

const canvas = document.createElement('canvas');
const ctx = canvas.getContext('2d', { willReadFrequently: true });
let src = { video: null, photo: null, body: null };
let timer = null;

const lin = (c) => {
  c /= 255;
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
};
const lum = ([r, g, b]) => 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
const ratio = (a, b) => (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);

function cssColor(name) {
  const probe = document.createElement('i');
  probe.style.color = `var(${name})`;
  document.body.append(probe);
  const m = getComputedStyle(probe).color.match(/\d+(\.\d+)?/g) || [0, 0, 0];
  probe.remove();
  return m.slice(0, 3).map(Number);
}

/** Smallest glass opacity that keeps the text readable over every sampled colour. */
export function neededAlpha(samples, fg, tint, dark) {
  const lf = lum(fg);
  for (let a = MIN_A; a <= MAX_A; a += 0.02) {
    const ok = samples.every((c) => {
      // The glass brightens what is behind it by 6% before tinting it.
      let mix = c.map((v, i) => a * tint[i] + (1 - a) * Math.min(255, v * 1.06));
      if (dark) mix = mix.map((v) => v + 0.08 * (255 - v)); // the glass shine adds a little light
      return ratio(lf, lum(mix)) >= TARGET;
    });
    if (ok) return +a.toFixed(2);
  }
  return MAX_A;
}

// Draws what is behind the glass into a tiny canvas, using the same "cover" crop as the screen.
function drawBackdrop() {
  const W = innerWidth;
  const H = innerHeight;
  canvas.width = Math.ceil(W / SCALE);
  canvas.height = Math.ceil(H / SCALE);
  const b = src.body.dataset;
  let media = null;
  if (b.photo === 'on' && src.photo.complete && src.photo.naturalWidth) media = src.photo;
  else if (b.camera === 'on' && src.video.videoWidth && ['ready', 'settings'].includes(b.state)) media = src.video;
  if (!media) return false;
  const mw = media.videoWidth || media.naturalWidth;
  const mh = media.videoHeight || media.naturalHeight;
  const s = Math.max(W / mw, H / mh);
  const dw = (mw * s) / SCALE;
  const dh = (mh * s) / SCALE;
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  try {
    ctx.drawImage(media, (canvas.width - dw) / 2, (canvas.height - dh) / 2, dw, dh);
    return true;
  } catch {
    return false;
  }
}

// Average colour of each 4×4 cell under a panel (roughly what the blurred glass shows).
function samplesUnder(rect, data) {
  const out = [];
  const x0 = Math.max(0, Math.floor(rect.left / SCALE));
  const y0 = Math.max(0, Math.floor(rect.top / SCALE));
  const x1 = Math.min(canvas.width, Math.ceil(rect.right / SCALE));
  const y1 = Math.min(canvas.height, Math.ceil(rect.bottom / SCALE));
  for (let y = y0; y < y1; y += 4) {
    for (let x = x0; x < x1; x += 4) {
      const acc = [0, 0, 0];
      let n = 0;
      for (let yy = y; yy < Math.min(y + 4, y1); yy++) {
        for (let xx = x; xx < Math.min(x + 4, x1); xx++) {
          const i = (yy * canvas.width + xx) * 4;
          acc[0] += data[i];
          acc[1] += data[i + 1];
          acc[2] += data[i + 2];
          n++;
        }
      }
      if (n) out.push(acc.map((v) => v / n));
    }
  }
  return out;
}

// Colours of the soft moving background, used when there is no camera or photo.
const AURORA = {
  // What the background can look like behind a panel (warm ember light over off-black, plus grain).
  dark: [
    [120, 60, 18],
    [70, 38, 16],
    [28, 22, 18],
    [12, 10, 9],
  ],
  light: [
    [250, 225, 200],
    [250, 240, 228],
    [250, 249, 247],
  ],
};

export function refreshGlass() {
  if (!src.body) return;
  const dark = document.documentElement.dataset.theme !== 'light';
  const fg = cssColor('--fg');
  const tint = dark ? [20, 16, 13] : [252, 250, 247];
  const hasMedia = drawBackdrop();
  const data = hasMedia ? ctx.getImageData(0, 0, canvas.width, canvas.height).data : null;
  for (const panel of document.querySelectorAll('.glass')) {
    const r = panel.getBoundingClientRect();
    if (!r.width || !r.height) continue;
    // Look a little beyond the edges too: refraction can pull in light from up to ~24px away.
    const wide = { left: r.left - 24, top: r.top - 24, right: r.right + 24, bottom: r.bottom + 24 };
    const samples = data ? samplesUnder(wide, data) : AURORA[dark ? 'dark' : 'light'];
    panel.style.setProperty('--ga', neededAlpha(samples.length ? samples : AURORA.dark, fg, tint, dark));
  }
}

// Live camera changes all the time, so keep measuring while it is on screen.
function schedule() {
  clearInterval(timer);
  const live = src.body.dataset.camera === 'on' && src.body.dataset.state === 'ready';
  if (live) timer = setInterval(refreshGlass, 400);
}

// ---------- the shine follows your finger and the phone's tilt ----------

let raf = 0;
function shineAt(x, y) {
  cancelAnimationFrame(raf);
  raf = requestAnimationFrame(() => {
    for (const panel of document.querySelectorAll('.glass')) {
      const r = panel.getBoundingClientRect();
      if (!r.width) continue;
      panel.style.setProperty('--lx', `${(((x - r.left) / r.width) * 100).toFixed(1)}%`);
      panel.style.setProperty('--ly', `${(((y - r.top) / r.height) * 100).toFixed(1)}%`);
    }
  });
}

export function initGlass({ video, photo, body }) {
  src = { video, photo, body };
  new MutationObserver(() => {
    refreshGlass();
    schedule();
  }).observe(body, { attributes: true, attributeFilter: ['data-state', 'data-camera', 'data-photo', 'class'] });
  new MutationObserver(refreshGlass).observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
  photo.addEventListener('load', refreshGlass);
  addEventListener('resize', refreshGlass);
  addEventListener('pointerdown', (e) => shineAt(e.clientX, e.clientY), { passive: true });
  addEventListener('pointermove', (e) => shineAt(e.clientX, e.clientY), { passive: true });
  addEventListener(
    'deviceorientation',
    (e) => {
      if (e.gamma == null) return;
      const x = innerWidth * (0.5 + Math.max(-1, Math.min(1, e.gamma / 35)) * 0.6);
      const y = innerHeight * (0.5 + Math.max(-1, Math.min(1, (e.beta - 45) / 35)) * 0.6);
      shineAt(x, y);
    },
    { passive: true }
  );
  // Real light-bending (refraction) needs SVG backdrop filters, which only Chromium draws.
  const chromium = !!window.chrome && !/iPhone|iPad|Macintosh.*Safari(?!.*Chrome)/.test(navigator.userAgent) && CSS.supports('backdrop-filter', 'url(#lg-refract)');
  document.documentElement.classList.toggle('refract', chromium);
  refreshGlass();
  schedule();
}
