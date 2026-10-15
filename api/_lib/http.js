// Small request checks shared by every API route.

export function guard(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Use POST' });
    return false;
  }
  // Only accept calls from pages served by this same site.
  const origin = req.headers.origin;
  const host = req.headers['x-forwarded-host'] || req.headers.host;
  if (origin) {
    let originHost = '';
    try {
      originHost = new URL(origin).host;
    } catch {}
    if (originHost !== host) {
      res.status(403).json({ error: 'Forbidden' });
      return false;
    }
  }
  if (!req.body || typeof req.body !== 'object' || Array.isArray(req.body)) {
    res.status(400).json({ error: 'Send JSON' });
    return false;
  }
  for (const key of ['question', 'lang', 'langName', 'mime', 'provider', 'text', 'language']) {
    if (req.body[key] !== undefined && typeof req.body[key] !== 'string') {
      res.status(400).json({ error: `${key} must be text` });
      return false;
    }
  }
  return true;
}

export function fail(res, e) {
  // Log only the error text, never the photo, audio or question.
  console.error(String(e?.message || e).slice(0, 300));
  res.status(e?.status || 502).json({ error: e?.status === 503 ? e.message : 'The AI service failed' });
}

export const isB64 = (s, max) => typeof s === 'string' && s.length > 0 && s.length <= max && s.length % 4 === 0 && /^[A-Za-z0-9+/]+={0,2}$/.test(s);
