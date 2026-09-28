import { speech, langOf } from './_lib/ai.js';
import { guard, fail } from './_lib/http.js';

export default async function handler(req, res) {
  if (!guard(req, res)) return;
  const text = String(req.body.text || '').slice(0, 1200).trim();
  if (!text) return res.status(400).json({ error: 'No text' });
  try {
    const out = await speech({ text, lang: langOf(req.body.lang, req.body.langName), speed: req.body.speed, preload: !!req.body.preload });
    res.setHeader('Content-Type', out.type);
    res.setHeader('X-Voice', out.voice);
    res.status(200).send(out.audio);
  } catch (e) {
    if (e.status === 204) return res.status(204).end();
    // Out of ElevenLabs credits: tell the app, so it switches to the phone's own voice at once.
    // Every voice is out of credits or busy: tell the app, so it uses the phone's own voice at once.
    if (/quota_exceeded|credits remaining|429|RESOURCE_EXHAUSTED/i.test(e.message) || e.status === 429) {
      return res.status(429).json({ error: 'quota' });
    }
    fail(res, e);
  }
}
