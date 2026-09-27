// Qibla: which way to turn to face the Kaaba, from GPS + compass. Works without internet,
// and the location never leaves the phone.

// ---------- Qibla ----------

const KAABA = { lat: 21.422487, lon: 39.826206 };
const rad = (d) => (d * Math.PI) / 180;
const deg = (r) => (r * 180) / Math.PI;

/** Compass bearing (0 = north, clockwise) from a place to the Kaaba. */
export function qiblaBearing(lat, lon) {
  const φ1 = rad(lat);
  const φ2 = rad(KAABA.lat);
  const Δλ = rad(KAABA.lon - lon);
  const y = Math.sin(Δλ) * Math.cos(φ2);
  const x = Math.cos(φ1) * Math.sin(φ2) - Math.sin(φ1) * Math.cos(φ2) * Math.cos(Δλ);
  return (deg(Math.atan2(y, x)) + 360) % 360;
}

/** -180…180: negative = turn left, positive = turn right. */
export const turnBy = (target, heading) => ((target - heading + 540) % 360) - 180;

/** Great-circle distance to the Kaaba in kilometres. */
export function kaabaDistanceKm(lat, lon) {
  const dφ = rad(KAABA.lat - lat);
  const dλ = rad(KAABA.lon - lon);
  const h = Math.sin(dφ / 2) ** 2 + Math.cos(rad(lat)) * Math.cos(rad(KAABA.lat)) * Math.sin(dλ / 2) ** 2;
  return 2 * 6371 * Math.asin(Math.sqrt(h));
}

/** 0 = north … 7 = north-west (eight compass points). */
export const compassPoint = (bearing) => Math.round(bearing / 45) % 8;
/** 0 = north … 15 = north-north-west (sixteen compass points, 22.5 degrees each). */
export const compassPoint16 = (bearing) => Math.round(bearing / 22.5) % 16;

function position() {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) return reject(new Error('no-location'));
    navigator.geolocation.getCurrentPosition(
      (p) => resolve(p.coords),
      () => reject(new Error('no-location')),
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 5 * 60 * 1000 }
    );
  });
}

/**
 * Compass heading (0 = north, clockwise) from a deviceorientation reading, however the phone is held.
 * Flat on the hand: the direction the top edge points. Upright like a camera: the direction the back
 * camera faces (tilt-compensated, W3C Device Orientation spec, "compass heading" example).
 */
function headingFrom(e, absolute) {
  if (typeof e.webkitCompassHeading === 'number' && e.webkitCompassHeading >= 0) return e.webkitCompassHeading; // iPhone does this itself
  if (!(absolute || e.absolute) || typeof e.alpha !== 'number') return null;
  const b = rad(e.beta || 0);
  const g = rad(e.gamma || 0);
  const a = rad(e.alpha);
  if (Math.abs(e.beta || 0) < 35) return (360 - e.alpha) % 360; // roughly flat
  const vx = -Math.cos(a) * Math.sin(g) - Math.sin(a) * Math.sin(b) * Math.cos(g);
  const vy = -Math.sin(a) * Math.sin(g) + Math.cos(a) * Math.sin(b) * Math.cos(g);
  let h = Math.atan(vx / vy);
  if (vy < 0) h += Math.PI;
  else if (vx < 0) h += 2 * Math.PI;
  return deg(h) % 360;
}

/**
 * Starts Qibla guidance. Call it straight from a tap: the iPhone asks for compass permission here.
 * onUpdate({ heading, turn, accuracy }) runs on every smoothed compass reading.
 * Resolves to { stop(), target, distanceKm, compass } — compass is false on devices without one
 * (laptops), which still get the bearing and distance.
 */
export async function startQibla(onUpdate, demo = false) {
  const ask = window.DeviceOrientationEvent?.requestPermission?.(); // must happen before any await
  const where = demo ? { latitude: 24.7136, longitude: 46.6753 } : await position();
  const target = qiblaBearing(where.latitude, where.longitude);
  const distanceKm = kaabaDistanceKm(where.latitude, where.longitude);
  if (demo) {
    let h = 0;
    const timer = setInterval(() => {
      h = (h + 7) % 360;
      onUpdate({ heading: h, turn: turnBy(target, h), accuracy: 10 });
    }, 200);
    return { stop: () => clearInterval(timer), target, distanceKm, compass: true };
  }
  const granted = !ask || (await ask.catch(() => 'denied')) === 'granted';
  // Listen even if permission was refused: some browsers still send readings, and if none arrive
  // the app can say that motion access is blocked instead of claiming there is no compass.
  const absolute = 'ondeviceorientationabsolute' in window;
  const type = absolute ? 'deviceorientationabsolute' : 'deviceorientation';
  let smooth = null;
  let got = false;
  const onEvent = (e) => {
    let h = headingFrom(e, absolute);
    if (h == null || Number.isNaN(h)) return;
    h = (h + (screen.orientation?.angle || 0) + 360) % 360;
    // Low-pass filter on the circle, so the needle does not shake.
    smooth = smooth == null ? h : (smooth + turnBy(h, smooth) * 0.2 + 360) % 360;
    got = true;
    onUpdate({ heading: smooth, turn: turnBy(target, smooth), accuracy: e.webkitCompassAccuracy ?? null });
  };
  addEventListener(type, onEvent);
  const stop = () => removeEventListener(type, onEvent);
  // No readings within 3 seconds: no usable compass (most laptops).
  await new Promise((r) => setTimeout(r, 3000));
  if (!got) stop();
  return { stop, target, distanceKm, compass: got, motionBlocked: !got && !granted };
}
