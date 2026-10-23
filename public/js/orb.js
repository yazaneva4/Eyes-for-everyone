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

  const active = () => {
    const state = body.dataset.state;
    return isVisible && !document.hidden &&
      (state === 'thinking' || state === 'listening' ||
       (state === 'answer' && body.classList.contains('speaking')));
  };

  const currentState = () => body.dataset.state || 'start';

  function activityFor(state) {
    const level = Number.parseFloat(getComputedStyle(body).getPropertyValue('--level')) || 0;
    if (state === 'thinking') return 0.72;
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
    const radius = Math.min(width, height) * 0.425;
    const pulse = 1 + energy * 0.018;
    const shape = blobPath(cx, cy, radius * pulse, t, state, energy);

    // Ambient corona, not a hard ring or glossy candy shell.
    ctx.save();
    ctx.fillStyle = 'rgba(255, 112, 24, 0.28)';
    ctx.shadowColor = 'rgba(255, 106, 15, 0.5)';
    ctx.shadowBlur = radius * 0.28;
    ctx.fill(shape);
    ctx.restore();

    ctx.save();
    ctx.clip(shape);

    const base = ctx.createRadialGradient(
      cx - radius * 0.28, cy - radius * 0.34, radius * 0.03,
      cx, cy, radius * 1.32
    );
    base.addColorStop(0, '#ffd39a');
    base.addColorStop(0.24, '#ffb254');
    base.addColorStop(0.48, '#ff8b2b');
    base.addColorStop(0.73, '#e95713');
    base.addColorStop(1, '#8f2707');
    ctx.fillStyle = base;
    ctx.fillRect(0, 0, width, height);

    // Broad, soft color fields drift through each other like liquid light.
    // They deliberately avoid sharp stripes, glitter, grain, or a glassy highlight.
    paintCloud(
      cx + Math.sin(t * 0.31) * radius * 0.19,
      cy + Math.cos(t * 0.24) * radius * 0.13,
      radius * 0.79, radius * 0.66, Math.sin(t * 0.19) * 0.7,
      [[0, 'rgba(255, 198, 106, 0.82)'], [0.42, 'rgba(255, 145, 40, 0.45)'], [1, 'rgba(255, 109, 14, 0)']],
      0.9, 'screen'
    );
    paintCloud(
      cx + Math.cos(t * 0.23 + 1.7) * radius * 0.34,
      cy + Math.sin(t * 0.29 + 0.8) * radius * 0.25,
      radius * 0.55, radius * 0.42, t * 0.12,
      [[0, 'rgba(255, 224, 174, 0.78)'], [0.46, 'rgba(255, 170, 80, 0.35)'], [1, 'rgba(255, 141, 36, 0)']],
      0.8, 'screen'
    );
    paintCloud(
      cx + Math.sin(t * 0.21 + 2.3) * radius * 0.32,
      cy + Math.cos(t * 0.26 + 1.1) * radius * 0.3,
      radius * 0.56, radius * 0.72, -t * 0.1,
      [[0, 'rgba(255, 83, 11, 0.72)'], [0.48, 'rgba(245, 77, 7, 0.33)'], [1, 'rgba(213, 49, 0, 0)']],
      0.74, 'screen'
    );
    paintCloud(
      cx + Math.cos(t * 0.2 + 3.2) * radius * 0.18,
      cy + Math.sin(t * 0.18 + 2.7) * radius * 0.31,
      radius * 0.39, radius * 0.37, t * 0.08,
      [[0, 'rgba(255, 178, 69, 0.78)'], [0.52, 'rgba(255, 111, 22, 0.25)'], [1, 'rgba(255, 95, 10, 0)']],
      0.64 + energy * 0.17, 'screen'
    );
    paintCloud(
      cx + Math.cos(t * 0.17 + 1.2) * radius * 0.22,
      cy + radius * 0.24 + Math.sin(t * 0.16) * radius * 0.14,
      radius * 0.54, radius * 0.46, -t * 0.06,
      [[0, 'rgba(111, 24, 2, 0.34)'], [0.52, 'rgba(132, 32, 3, 0.15)'], [1, 'rgba(132, 32, 3, 0)']],
      0.48, 'multiply'
    );

    // Gentle edge depth keeps the orb dimensional without a shiny candy coating.
    const shade = ctx.createRadialGradient(
      cx - radius * 0.08, cy - radius * 0.08, radius * 0.34,
      cx, cy, radius * 1.14
    );
    shade.addColorStop(0, 'rgba(89, 24, 4, 0)');
    shade.addColorStop(0.72, 'rgba(89, 24, 4, 0.035)');
    shade.addColorStop(1, 'rgba(64, 15, 2, 0.38)');
    ctx.globalCompositeOperation = 'multiply';
    ctx.fillStyle = shade;
    ctx.fillRect(0, 0, width, height);

    ctx.globalCompositeOperation = 'source-over';
    ctx.strokeStyle = 'rgba(255, 218, 168, 0.18)';
    ctx.lineWidth = Math.max(0.7, radius * 0.008);
    ctx.stroke(shape);
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
      const speed = currentState() === 'thinking' ? 0.92 : 0.38;
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