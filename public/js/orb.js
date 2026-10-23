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

  function draw(t, state, energy) {
    ctx.clearRect(0, 0, width, height);

    const cx = width / 2;
    const cy = height / 2;
    const radius = Math.min(width, height) * 0.405;
    const speed = ['thinking', 'working', 'solving', 'searching', 'composing'].includes(state) ? 1.45 : 0.82;
    const phase = t * speed;
    const pulse = 1 + Math.sin(phase * 1.3) * 0.018 + energy * 0.025;

    // Broad atmospheric glow makes this read as light, not a painted orange ball.
    ctx.save();
    const aura = ctx.createRadialGradient(cx, cy, radius * 0.15, cx, cy, radius * 1.62);
    aura.addColorStop(0, 'rgba(255, 132, 32, 0.28)');
    aura.addColorStop(0.48, 'rgba(255, 76, 12, 0.13)');
    aura.addColorStop(1, 'rgba(255, 65, 0, 0)');
    ctx.fillStyle = aura;
    ctx.fillRect(0, 0, width, height);
    ctx.restore();

    // The core is deliberately translucent and bright, with a moving molten center.
    ctx.save();
    ctx.translate(cx, cy);
    ctx.scale(pulse, pulse);
    const sphere = ctx.createRadialGradient(-radius * 0.27, -radius * 0.31, radius * 0.025, 0, 0, radius * 1.13);
    sphere.addColorStop(0, 'rgba(255, 246, 211, 0.99)');
    sphere.addColorStop(0.16, 'rgba(255, 205, 121, 0.98)');
    sphere.addColorStop(0.38, 'rgba(255, 133, 35, 0.96)');
    sphere.addColorStop(0.7, 'rgba(232, 65, 9, 0.94)');
    sphere.addColorStop(1, 'rgba(96, 18, 4, 0.82)');
    ctx.fillStyle = sphere;
    ctx.beginPath();
    ctx.arc(0, 0, radius, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();

    // Cut the moving light ribbons to the sphere, so they flow inside its silhouette.
    ctx.save();
    ctx.beginPath();
    ctx.arc(cx, cy, radius * 0.985, 0, Math.PI * 2);
    ctx.clip();

    // Large, unmistakably moving molten ribbons.
    for (let i = 0; i < 7; i += 1) {
      const p = phase * (0.42 + i * 0.035) + i * 1.19;
      const y = cy + Math.sin(p * 0.76) * radius * 0.53;
      const amp = radius * (0.18 + (i % 3) * 0.055);
      const grad = ctx.createLinearGradient(cx - radius, y - amp, cx + radius, y + amp);
      grad.addColorStop(0, 'rgba(255, 84, 8, 0)');
      grad.addColorStop(0.22, i % 2 ? 'rgba(255, 239, 173, 0.12)' : 'rgba(255, 191, 90, 0.18)');
      grad.addColorStop(0.48, i % 2 ? 'rgba(255, 250, 219, 0.88)' : 'rgba(255, 156, 45, 0.92)');
      grad.addColorStop(0.72, i % 2 ? 'rgba(255, 183, 74, 0.3)' : 'rgba(255, 225, 154, 0.58)');
      grad.addColorStop(1, 'rgba(255, 76, 5, 0)');
      ctx.beginPath();
      ctx.moveTo(cx - radius * 1.3, y - amp * 0.28);
      ctx.bezierCurveTo(
        cx - radius * 0.48, y - amp * (1.25 + Math.sin(p) * 0.24),
        cx + radius * 0.28, y + amp * (1.35 + Math.cos(p * 0.8) * 0.24),
        cx + radius * 1.3, y + amp * 0.12
      );
      ctx.lineWidth = radius * (0.09 + (i % 2) * 0.035);
      ctx.lineCap = 'round';
      ctx.strokeStyle = grad;
      ctx.shadowColor = i % 2 ? 'rgba(255, 230, 163, 0.75)' : 'rgba(255, 92, 12, 0.8)';
      ctx.shadowBlur = radius * 0.12;
      ctx.stroke();
    }

    // A pair of luminous currents travel in opposite directions across the core.
    for (let i = 0; i < 4; i += 1) {
      const p = phase * (i % 2 ? -0.66 : 0.58) + i * 1.57;
      ctx.beginPath();
      ctx.ellipse(
        cx + Math.sin(p) * radius * 0.12,
        cy + Math.cos(p * 0.7) * radius * 0.12,
        radius * (0.48 + i * 0.095),
        radius * (0.16 + (i % 2) * 0.07),
        p * 0.72,
        0,
        Math.PI * 2
      );
      ctx.strokeStyle = i % 2 ? 'rgba(255, 235, 181, 0.52)' : 'rgba(255, 75, 12, 0.7)';
      ctx.lineWidth = radius * (i % 2 ? 0.025 : 0.035);
      ctx.shadowColor = i % 2 ? 'rgba(255, 238, 190, 0.9)' : 'rgba(255, 75, 8, 0.9)';
      ctx.shadowBlur = radius * 0.09;
      ctx.stroke();
    }

    // A bright moving hotspot gives the orb a living, reactive focal point.
    const hx = cx + Math.cos(phase * 0.63) * radius * 0.31;
    const hy = cy + Math.sin(phase * 0.82) * radius * 0.28;
    const hotspot = ctx.createRadialGradient(hx, hy, 0, hx, hy, radius * 0.52);
    hotspot.addColorStop(0, 'rgba(255, 250, 221, 0.78)');
    hotspot.addColorStop(0.25, 'rgba(255, 205, 108, 0.34)');
    hotspot.addColorStop(1, 'rgba(255, 143, 31, 0)');
    ctx.globalCompositeOperation = 'screen';
    ctx.fillStyle = hotspot;
    ctx.fillRect(cx - radius, cy - radius, radius * 2, radius * 2);
    ctx.restore();

    // Fine outer contour and orbiting sparks: these move independently from the core.
    ctx.save();
    ctx.translate(cx, cy);
    for (let i = 0; i < 3; i += 1) {
      ctx.save();
      ctx.rotate(phase * (i % 2 ? -0.18 : 0.14) + i * 1.05);
      ctx.beginPath();
      ctx.ellipse(0, 0, radius * (1.02 + i * 0.035), radius * (0.78 + i * 0.09), i * 0.28, -0.9, 1.1);
      ctx.strokeStyle = i === 1 ? 'rgba(255, 220, 161, 0.55)' : 'rgba(255, 113, 26, 0.34)';
      ctx.lineWidth = Math.max(0.8, radius * 0.018);
      ctx.shadowColor = 'rgba(255, 120, 25, 0.7)';
      ctx.shadowBlur = radius * 0.08;
      ctx.stroke();
      ctx.restore();
    }
    for (let i = 0; i < 8; i += 1) {
      const a = phase * (i % 2 ? -0.72 : 0.57) + i * Math.PI / 4;
      const rr = radius * (1.02 + 0.045 * Math.sin(phase + i));
      const x = Math.cos(a) * rr;
      const y = Math.sin(a) * rr * 0.86;
      ctx.beginPath();
      ctx.arc(x, y, Math.max(1, radius * (0.012 + (i % 3) * 0.004)), 0, Math.PI * 2);
      ctx.fillStyle = i % 2 ? 'rgba(255, 238, 196, 0.92)' : 'rgba(255, 121, 30, 0.9)';
      ctx.shadowColor = ctx.fillStyle;
      ctx.shadowBlur = radius * 0.11;
      ctx.fill();
    }
    ctx.restore();
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
      const speed = ['thinking', 'working', 'solving', 'searching', 'composing'].includes(state) ? 1.12 : 0.46;
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