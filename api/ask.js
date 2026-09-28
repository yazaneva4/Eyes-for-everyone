import { askAI, askAIStream, langOf } from './_lib/ai.js';
import { guard, fail, isB64 } from './_lib/http.js';

export default async function handler(req, res) {
  if (!guard(req, res)) return;
  const { image, mime = 'image/jpeg', question, lang, history, provider, stream } = req.body;
  if (!isB64(image, 4_000_000) || !/^image\/(jpeg|png|webp)$/.test(mime)) {
    return res.status(400).json({ error: 'Bad image' });
  }
  const q = String(question || '').slice(0, 500).trim() || 'Describe what you see.';
  const hist = Array.isArray(history)
    ? history.slice(-3).map((h) => ({ q: String(h.q || '').slice(0, 500), a: String(h.a || '').slice(0, 1500) }))
    : [];
  const started = Date.now();
  const opts = {
    image,
    mime,
    question: q,
    lang: langOf(lang, req.body.langName),
    history: hist,
    provider: provider === 'openrouter' || provider === 'gemini' ? provider : undefined,
  };

  // Streaming: send the words as plain text as soon as the AI writes them.
  if (stream) {
    let started = false;
    try {
      const out = await askAIStream({
        ...opts,
        write: (chunk) => {
          if (!started) {
            started = true;
            res.writeHead(200, {
              'Content-Type': 'text/plain; charset=utf-8',
              'Cache-Control': 'no-store',
              'X-Accel-Buffering': 'no',
            });
          }
          res.write(chunk);
        },
      });
      if (!started) return fail(res, new Error(`${out.provider} sent nothing`));
      res.end();
    } catch (e) {
      if (started) return res.end();
      fail(res, e);
    }
    return;
  }

  try {
    const out = await askAI({
      image,
      mime,
      question: q,
      lang: langOf(lang, req.body.langName),
      history: hist,
      provider: provider === 'openrouter' || provider === 'gemini' ? provider : undefined,
    });
    res.status(200).json({ ...out, ms: Date.now() - started });
  } catch (e) {
    fail(res, e);
  }
}
