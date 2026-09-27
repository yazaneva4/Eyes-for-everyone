import { available, checkKeys } from './_lib/ai.js';

// Tells the app which features have a key, without revealing any key.
export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  const a = available();
  res.status(200).json({
    ask: a.ask,
    transcribe: a.transcribe,
    speak: a.speak,
    voice: a.voice,
    gemini: a.gemini,
    openrouter: a.openrouter,
    elevenlabs: a.elevenlabs,
    mock: a.mock,
    // /api/health?check=1 also tests each key with a real call.
    // (The URL is read directly: req.query uses Node's deprecated url.parse.)
    ...(new URL(req.url, 'http://x').searchParams.get('check') === '1' ? { check: await checkKeys() } : {}),
  });
}
