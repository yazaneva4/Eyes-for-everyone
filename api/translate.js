import { translateStrings, customNameOk } from './_lib/ai.js';
import { guard, fail } from './_lib/http.js';

// Translates the app's own words into a language the user typed in. Nothing is stored.
export default async function handler(req, res) {
  if (!guard(req, res)) return;
  const language = String(req.body.language || '').trim();
  const strings = req.body.strings;
  if (!customNameOk(language)) return res.status(400).json({ error: 'Bad language name' });
  if (!strings || typeof strings !== 'object' || JSON.stringify(strings).length > 60000) return res.status(400).json({ error: 'Bad strings' });
  try {
    res.status(200).json(await translateStrings(language, strings));
  } catch (e) {
    fail(res, e);
  }
}
