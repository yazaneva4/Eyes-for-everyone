import { speech, langOf } from './_lib/ai.js';
import { guard, fail } from './_lib/http.js';

export default async function handler(req, res) {
  if (!guard(req, res)) return;
  const text = String(req.body.text || '').slice(0, 1200).trim();
  if (!text) return res.status(400).json({ error: 'No text' });
  try {
    const mp3 = await speech({ text, lang: langOf(req.body.lang), speed: req.body.speed });
    res.setHeader('Content-Type', 'audio/mpeg');
    res.status(200).send(mp3);
  } catch (e) {
    // Out of ElevenLabs credits: tell the app, so it switches to the phone's own voice at once.
    if (/quota_exceeded|credits remaining/i.test(e.message)) {
      return res.status(429).json({ error: 'quota' });
    }
    fail(res, e);
  }
}
