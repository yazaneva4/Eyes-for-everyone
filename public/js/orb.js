/* Original dependency-free fluid orb renderer for Eyes for Everyone.
   Visual direction informed by the open-source VoiceOrbs project:
   https://github.com/amunozdev/voiceorbs (MIT licensed).
   This Canvas 2D renderer is implemented for this app, with no third-party runtime dependency. */
(() => {
  'use strict';

  const orb = document.querySelector('.orb3d');
  const canvas = orb && orb.querySelector('.orb-canvas');
  const ctx = canvas && canvas.getContext('2d', { alpha: true });
  if (!orb || !canvas || !ctx) return;

  const body = document.body;
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
  let width = 1;
  let height = 1;
  let dpr = 1;
  let time = 0;
  let previousFrame = 0;
  let frame = 0;
  let isVisible = true;

  // Keep a gentle idle animation running too; the previous state gate could
  // leave the canvas completely still whenever the app used another state name.
  const active = () => isVisible && !document.hidden;

  const currentState = () => body.dataset.state || 'start';

  function activityFor(state) {
    const level = Number.parseFloat(getComputedStyle(body).getPropertyValue('--level')) || 0;
    if (state === 'thinking' || state === 'working' || state === 'solving') return 0.78;
    if (state === 'listening') return Math.max(0.12, Math.min(1, 0.12 + level * 0.78));
    if (state === 'answer' && body.classList.contains('speaking')) {
      return Math.max(0.3, Math.min(1, 0.3 + level * 0.58));
    }
    return 0.24;
  }

  function blobPath(cx, cy, radius, t, state, energy) {
    const points = [];
    const count = 96;
    const baseWobble = state === 'thinking' ? 0.031 : state === 'listening' ? 0.019 : 0.022;
    const wobble = baseWobble + energy * 0.009;

    for (let i = 0; i < count; i += 1) {
      const angle = (i / count) * Math.PI * 2;
      const wave =
        Math.sin(angle * 2 + t * 0.46) * wobble +
        Math.sin(angle * 3 - t * 0.35) * wobble * 0.62 +
        Math.sin(angle * 5 + t * 0.22) * wobble * 0.24;
      const r = radius * (1 + wave);
      points.push({ x: cx + Math.cos(angle) * r, y: cy + Math.sin(angle) * r });
    }

    const path = new Path2D();
    const first = points[0];
    const last = points[count - 1];
    path.moveTo((last.x + first.x) / 2, (last.y + first.y) / 2);
    for (let i = 0; i < count; i += 1) {
      const point = points[i];
      const next = points[(i + 1) % count];
      path.quadraticCurveTo(point.x, point.y, (point.x + next.x) / 2, (point.y + next.y) / 2);
    }
    path.closePath();
    return path;
  }

  function paintCloud(cx, cy, rx, ry, rotation, colors, opacity, blend) {
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(rotation);
    ctx.scale(Math.max(1, rx), Math.max(1, ry));
    const gradient = ctx.createRadialGradient(-0.16, -0.18, 0.02, 0, 0, 1.08);
    for (const stop of colors) gradient.addColorStop(stop[0], stop[1]);
    ctx.globalCompositeOperation = blend || 'screen';
    ctx.globalAlpha = opacity;
    ctx.fillStyle = gradient;
    ctx.beginPath();
    ctx.arc(0, 0, 1, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  // Small radial-gradient helper used by every moving light field.
  // Missing this function stopped the first animation frame with a ReferenceError.
  function radialGlow(x, y, radius, innerColor, outerColor) {
    const safeRadius = Math.max(0.001, radius);
    const gradient = ctx.createRadialGradient(x, y, 0, x, y, safeRadius);
    gradient.addColorStop(0, innerColor);
    gradient.addColorStop(1, outerColor);
    return gradient;
  }

  function draw(t, state, energy) {
    const size = Math.min(width, height);
    if (!size) return;
    const elapsed = t;
    const ambient = true;
    const cx = size / 2, cy = size / 2, r = size * .49;
    ctx.clearRect(0, 0, size, size);
    ctx.save();
    ctx.translate(cx, cy);
    ctx.beginPath();
    ctx.arc(0, 0, r, 0, Math.PI * 2);
    ctx.clip();

    // Deep molten base, lit from a hot orange core.
    const base = ctx.createRadialGradient(-r * .28, -r * .36, r * .025, 0, 0, r * 1.23);
    base.addColorStop(0, '#fff0b0');
    base.addColorStop(.10, '#ffd078');
    base.addColorStop(.27, '#ff921e');
    base.addColorStop(.51, '#f24b04');
    base.addColorStop(.76, '#9f2500');
    base.addColorStop(1, '#260700');
    ctx.fillStyle = base;
    ctx.fillRect(-r, -r, r * 2, r * 2);

    // Moving conic light ribbons give the orb a continuously changing surface.
    if (ambient && ctx.createConicGradient) {
      const flow = ctx.createConicGradient(elapsed * .22, Math.sin(elapsed * .17) * r * .12, Math.cos(elapsed * .14) * r * .1);
      flow.addColorStop(0, 'rgba(255,225,133,.10)');
      flow.addColorStop(.12, 'rgba(255,89,4,.48)');
      flow.addColorStop(.25, 'rgba(255,182,47,.40)');
      flow.addColorStop(.40, 'rgba(220,47,0,.20)');
      flow.addColorStop(.58, 'rgba(255,123,8,.53)');
      flow.addColorStop(.74, 'rgba(255,214,91,.34)');
      flow.addColorStop(.88, 'rgba(255,69,0,.30)');
      flow.addColorStop(1, 'rgba(255,225,133,.10)');
      ctx.globalCompositeOperation = 'screen';
      ctx.fillStyle = flow;
      ctx.fillRect(-r, -r, r * 2, r * 2);
    }

    // Smooth light fields orbit and deform over time, like liquid plasma.
    const blobs = [
      { a: .56, b: .48, s: .73, w: .62, phase: .1, c: 'rgba(255,194,56,.92)' },
      { a: .48, b: .58, s: .65, w: -.47, phase: 1.8, c: 'rgba(255,80,0,.92)' },
      { a: .62, b: .42, s: .50, w: .82, phase: 3.1, c: 'rgba(255,225,132,.62)' },
      { a: .42, b: .68, s: .58, w: -.72, phase: 4.6, c: 'rgba(226,48,0,.78)' },
      { a: .38, b: .36, s: .42, w: .95, phase: 2.5, c: 'rgba(255,151,22,.82)' }
    ];
    ctx.globalCompositeOperation = ambient ? 'screen' : 'source-over';
    for (let i = 0; i < blobs.length; i++) {
      const b = blobs[i];
      const angle = elapsed * b.w + b.phase;
      const x = Math.cos(angle) * r * b.a + Math.sin(elapsed * .31 + b.phase) * r * .12;
      const y = Math.sin(angle * .83) * r * b.b + Math.cos(elapsed * .27 + b.phase) * r * .10;
      const rad = r * b.s * (.84 + .11 * Math.sin(elapsed * .9 + i));
      ctx.fillStyle = radialGlow(x, y, rad, ambient ? b.c : 'rgba(255,151,22,.42)', 'rgba(255,80,0,0)');
      ctx.fillRect(-r, -r, r * 2, r * 2);
    }

    // Fine, curved current lines move through the glow.
    ctx.globalCompositeOperation = ambient ? 'lighter' : 'source-over';
    for (let i = 0; i < (ambient ? 7 : 3); i++) {
      const phase = elapsed * (.24 + i * .018) + i * .9;
      const y = (i - 3) * r * .19 + Math.sin(phase) * r * .15;
      ctx.beginPath();
      ctx.moveTo(-r * 1.1, y + Math.cos(phase) * r * .12);
      ctx.bezierCurveTo(-r * .25, y - Math.sin(phase * 1.2) * r * .62, r * .25, y + Math.cos(phase * .8) * r * .55, r * 1.1, y + Math.sin(phase) * r * .2);
      ctx.strokeStyle = i % 2 ? 'rgba(255,222,145,.13)' : 'rgba(255,105,15,.18)';
      ctx.lineWidth = r * (i % 3 === 0 ? .018 : .009);
      ctx.stroke();
    }

    // A bright, moving hot spot and a cool dark edge make it spherical.
    const hx = Math.sin(elapsed * .45) * r * .20 - r * .28;
    const hy = Math.cos(elapsed * .38) * r * .18 - r * .30;
    ctx.globalCompositeOperation = 'screen';
    ctx.fillStyle = radialGlow(hx, hy, r * .57, 'rgba(255,255,231,.82)', 'rgba(255,199,93,0)');
    ctx.fillRect(-r, -r, r * 2, r * 2);

    ctx.globalCompositeOperation = 'multiply';
    const shade = ctx.createRadialGradient(-r * .24, -r * .28, r * .24, r * .08, r * .13, r * 1.19);
    shade.addColorStop(0, 'rgba(255,255,255,1)');
    shade.addColorStop(.52, 'rgba(255,220,187,.96)');
    shade.addColorStop(.84, 'rgba(83,25,3,.40)');
    shade.addColorStop(1, 'rgba(13,3,0,.88)');
    ctx.fillStyle = shade;
    ctx.fillRect(-r, -r, r * 2, r * 2);

    // Specular glass highlight.
    ctx.globalCompositeOperation = 'screen';
    ctx.fillStyle = radialGlow(-r * .30, -r * .34, r * .33, 'rgba(255,255,248,.78)', 'rgba(255,244,205,0)');
    ctx.fillRect(-r, -r, r * 2, r * 2);

    // Small internal sparks travel around the surface.
    ctx.globalCompositeOperation = 'lighter';
    for (let i = 0; i < (ambient ? 9 : 4); i++) {
      const angle = elapsed * (.26 + i * .015) + i * 2.399;
      const rr = r * (.2 + .47 * ((i % 4) / 4) + .04 * Math.sin(elapsed + i));
      const x = Math.cos(angle) * rr;
      const y = Math.sin(angle * 1.13) * rr;
      const dotR = r * (i % 3 === 0 ? .012 : .007);
      ctx.fillStyle = radialGlow(x, y, dotR * 4, 'rgba(255,237,171,.95)', 'rgba(255,119,10,0)');
      ctx.beginPath(); ctx.arc(x, y, dotR * 4, 0, Math.PI * 2); ctx.fill();
    }

    ctx.restore();
    ctx.globalCompositeOperation = 'source-over';
  }

  function resize() {
    const rect = orb.getBoundingClientRect();
    width = Math.max(1, rect.width);
    height = Math.max(1, rect.height);
    dpr = Math.min(window.devicePixelRatio || 1, 1.75);
    canvas.width = Math.round(width * dpr);
    canvas.height = Math.round(height * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    if (reducedMotion.matches) draw(time, currentState(), activityFor(currentState()));
  }

  function stop() {
    if (frame) window.cancelAnimationFrame(frame);
    frame = 0;
    previousFrame = 0;
  }

  function tick(now) {
    if (!active()) {
      stop();
      return;
    }
    if (previousFrame) {
      const delta = Math.min((now - previousFrame) / 1000, 0.045);
      const state = currentState();
      // Match the animation rates from the uploaded Pulse Orb's original mode table.
      const speed =
        state === 'thinking' ? 1.0 :
        ['working', 'solving'].includes(state) ? 1.48 :
        ['searching', 'composing'].includes(state) ? 1.22 :
        state === 'listening' ? 0.72 :
        state === 'answer' && body.classList.contains('speaking') ? 1.12 :
        0.82;
      time += delta * speed;
    }
    previousFrame = now;
    const state = currentState();
    draw(time, state, activityFor(state));
    frame = window.requestAnimationFrame(tick);
  }

  function sync() {
    if (reducedMotion.matches) {
      stop();
      const state = currentState();
      draw(time, state, activityFor(state));
      return;
    }
    if (active()) {
      if (!frame) {
        previousFrame = 0;
        frame = window.requestAnimationFrame(tick);
      }
    } else {
      stop();
    }
  }

  orb.classList.add('is-fluid');
  resize();

  if ('ResizeObserver' in window) {
    new ResizeObserver(resize).observe(orb);
  } else {
    window.addEventListener('resize', resize, { passive: true });
  }

  if ('IntersectionObserver' in window) {
    new IntersectionObserver((entries) => {
      isVisible = entries[0] ? entries[0].isIntersecting : true;
      sync();
    }).observe(orb);
  }

  new MutationObserver(sync).observe(body, { attributes: true, attributeFilter: ['data-state', 'class'] });
  document.addEventListener('visibilitychange', sync);
  reducedMotion.addEventListener('change', sync);
  sync();
})();