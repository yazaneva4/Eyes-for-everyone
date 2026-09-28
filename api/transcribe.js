import { transcribe, langOf } from './_lib/ai.js';
import { guard, fail, isB64 } from './_lib/http.js';

export default async function handler(req, res) {
  if (!guard(req, res)) return;
  const { audio, mime, lang } = req.body;
  if (!isB64(audio, 4_000_000) || !/^audio\//.test(String(mime))) {
    return res.status(400).json({ error: 'Bad audio' });
  }
  try {
    const text = await transcribe({ audio, mime, lang: langOf(lang, req.body.langName) });
    res.status(200).json({ text });
  } catch (e) {
    fail(res, e);
  }
}
