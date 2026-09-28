// Talks to Gemini, OpenRouter and ElevenLabs. API keys are read from environment variables only
// and never leave the server. Nothing is logged or stored.

export const LANGS = {
  en: { name: 'English', notSure: "I'm not sure.", checkPerson: 'Please check with a person.' },
  ar: { name: 'Arabic', notSure: 'لست متأكدًا.', checkPerson: 'يرجى التحقق مع شخص.' },
  ml: { name: 'Malayalam', notSure: 'എനിക്ക് ഉറപ്പില്ല.', checkPerson: 'ദയവായി ഒരാളോട് ചോദിച്ച് ഉറപ്പാക്കുക.' },
};

// A language the user typed in ("Urdu", "Français"): letters, spaces and a few marks, at most 40.
const CUSTOM_NAME = /^[\p{L}\p{M}][\p{L}\p{M} ()'.-]{1,39}$/u;
export const customNameOk = (n) => CUSTOM_NAME.test(String(n || '').trim());

/** 'en' | 'ar' | 'ml', or 'x:<name>' for a language the user typed in. Anything else is English. */
export function langOf(code, name) {
  if (LANGS[code]) return code;
  if (code === 'x' && customNameOk(name)) return 'x:' + String(name).trim();
  return 'en';
}

/** Name and fixed phrases for a language code from langOf(). */
export function langData(lang) {
  if (LANGS[lang]) return LANGS[lang];
  const name = String(lang).slice(2);
  // The model says these fixed phrases in the typed language itself.
  return { name, custom: true, notSure: `the ${name} for "I'm not sure."`, checkPerson: `the ${name} for "Please check with a person."` };
}

// Pasted keys often carry a stray space, newline or quotes; strip them.
const clean = (v) => String(v || '').trim().replace(/^["']|["']$/g, '').trim();

function keys() {
  return {
    gemini: clean(process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY || process.env.GOOGLE_GENERATIVE_AI_API_KEY),
    openrouter: clean(process.env.OPENROUTER_API_KEY),
    elevenlabs: clean(process.env.ELEVENLABS_API_KEY || process.env.ELEVEN_LABS_API_KEY || process.env.XI_API_KEY),
  };
}

/**
 * Asks each provider "is this key good, and does the model exist?" using free calls.
 * Returns only HTTP status codes and a hint — never the key or the provider's message.
 */
export async function checkKeys() {
  const k = keys();
  const hint = (st) =>
    ({ 200: 'ok', 400: 'bad request (check model name)', 401: 'key rejected', 403: 'key not allowed / no access', 404: 'model or voice not found', 429: 'out of credit or rate limited' })[st] ||
    (st >= 500 ? 'provider is down' : 'unexpected');
  const probe = async (name, url, headers) => {
    if (!k[name]) return [name, { status: 0, hint: 'no key set' }];
    try {
      const r = await fetch(url, { headers, signal: AbortSignal.timeout(10000) });
      return [name, { status: r.status, hint: hint(r.status) }];
    } catch {
      return [name, { status: -1, hint: 'could not reach provider' }];
    }
  };
  const gms = geminiModels();
  const voice = process.env.ELEVENLABS_VOICE_ID || 'JBFqnCBsd6RMkjVDRZzb';
  // Gemini: one real 5-token request, because a key can be valid but out of quota.
  // Reports the cheapest model that actually works for this key.
  const geminiReal = async () => {
    if (!k.gemini) return ['gemini', { status: 0, hint: 'no key set' }];
    let last = { status: -1, hint: 'could not reach provider' };
    const tried = {};
    for (const gm of gms) {
      try {
        const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${gm}:generateContent`, {
          method: 'POST',
          headers: { 'content-type': 'application/json', 'x-goog-api-key': k.gemini },
          body: JSON.stringify({ contents: [{ role: 'user', parts: [{ text: 'Say ok' }] }], generationConfig: { maxOutputTokens: 5 } }),
          signal: AbortSignal.timeout(10000),
        });
        last = { status: r.status, hint: hint(r.status), model: gm, tried };
        if (r.status !== 404) return ['gemini', last];
        tried[gm] = `404: ${(await readError(r)).slice(0, 160)}`;
      } catch {}
    }
    return ['gemini', last];
  };
  // OpenRouter: one real request per free model with a tiny 2×2 image (free models cost nothing).
  const openrouterReal = async () => {
    if (!k.openrouter) return ['openrouter', { status: 0, hint: 'no key set' }];
    const tiny = 'iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAIAAAD91JpzAAAAFklEQVR4nGP4z8DAwMDAxMDAwMDAAAANBAEBqFsHXwAAAABJRU5ErkJggg==';
    const models = {};
    for (const m of openrouterModels()) {
      try {
        const r = await fetch('https://openrouter.ai/api/v1/chat/completions', {
          method: 'POST',
          headers: { 'content-type': 'application/json', authorization: `Bearer ${k.openrouter}` },
          body: JSON.stringify({
            model: m,
            max_tokens: 20,
            messages: [{ role: 'user', content: [{ type: 'text', text: 'Reply with one word: what colour is this?' }, { type: 'image_url', image_url: { url: `data:image/png;base64,${tiny}` } }] }],
          }),
          signal: AbortSignal.timeout(20000),
        });
        let code;
        let reason;
        try {
          const j = await r.json();
          code = j.error?.code ?? j.error?.metadata?.raw?.slice?.(0, 0);
          // The provider's own words (never contains our key), so a failing model can be diagnosed.
          reason = [j.error?.message, j.error?.metadata?.raw].filter(Boolean).join(' | ').slice(0, 240) || undefined;
        } catch {}
        models[m] = { status: r.status, hint: hint(r.status), ...(code !== undefined && r.status !== 200 ? { code, reason } : {}) };
      } catch {
        models[m] = { status: -1, hint: 'could not reach provider' };
      }
    }
    const ok = Object.values(models).some((x) => x.status === 200);
    return ['openrouter', { status: ok ? 200 : Object.values(models)[0]?.status ?? -1, hint: ok ? 'ok' : 'no free model worked', models }];
  };
  // ElevenLabs: one real (one-word) voice request, so quota or permission problems show up here.
  const elevenReal = async () => {
    if (!k.elevenlabs) return ['elevenlabs', { status: 0, hint: 'no key set' }];
    try {
      elevenOutUntil = 0; // a real check, not the remembered answer
      await elevenSpeech('Hi.', 'en', 1);
      return ['elevenlabs', { status: 200, hint: 'ok' }];
    } catch (e) {
      const m = /TTS (\d+): (.*)/s.exec(String(e.message)) || [];
      return ['elevenlabs', { status: +m[1] || -1, hint: QUOTA.test(e.message) ? 'out of credits' : hint(+m[1] || -1), reason: (m[2] || String(e.message)).slice(0, 200) }];
    }
  };
  // Google's voice (the backup voice): one real, one-word request.
  const geminiVoiceReal = async () => {
    if (!k.gemini) return ['geminiVoice', { status: 0, hint: 'no key set' }];
    try {
      const v = await geminiSpeech('Hi.', 'ml');
      return ['geminiVoice', { status: 200, hint: 'ok', bytes: v.audio.length }];
    } catch (e) {
      return ['geminiVoice', { status: e.status || -1, hint: 'failed', reason: String(e.message).slice(0, 200) }];
    }
  };
  const out = await Promise.all([
    geminiVoiceReal(),
    geminiReal(),
    openrouterReal(),
    elevenReal(),
  ]);
  return Object.fromEntries(out);
}

export function available() {
  const k = keys();
  const mock = process.env.MOCK_AI === '1';
  return {
    gemini: !!k.gemini,
    openrouter: !!k.openrouter,
    ask: mock || !!(k.gemini || k.openrouter),
    elevenlabs: !!k.elevenlabs,
    transcribe: !!(k.elevenlabs || k.gemini),
    speak: !!(k.elevenlabs || k.gemini),
    // ElevenLabs is the app's voice, Google's (Gemini) the backup; without either, the phone's own.
    voice: k.elevenlabs ? 'elevenlabs' : k.gemini ? 'gemini' : null,
    mock,
  };
}

// Free OpenRouter models first; Gemini (cheapest Flash-Lite) when they are busy or out of quota.
function order(preferred) {
  const k = keys();
  const pref = preferred || process.env.AI_PROVIDER || 'openrouter';
  const list = pref === 'gemini' ? ['gemini', 'openrouter'] : ['openrouter', 'gemini'];
  return list.filter((p) => k[p]);
}

export function systemPrompt(lang) {
  const L = langData(lang);
  const exactly = (phrase) => (L.custom ? `say ${phrase}` : `say exactly: "${phrase}"`);
  return `You are "Eyes for Everyone", a helper for a person with low vision. They took a photo with their phone and asked a question out loud. Your reply is shown in very large text and read aloud.

Rules:
- Reply ONLY in ${L.name}. Use short, simple sentences and everyday words. No lists, no markdown, no emojis, no headings.
- Say the most important thing first. Keep replies under 50 words, unless you are asked to read text.
- Give positions (left, right, center, top, bottom, near, far) and colors.
- Never identify any person by their face or name, even if they seem famous. You may say "a person" and describe clothing, position and what they are doing.
- When asked to read, read the printed text exactly, word for word. Do not fix, summarize or translate it unless asked.
- Medicine: for any medicine box, bottle, blister pack or label, read only the printed text. Do not explain what it is for or how to take it. Then ${exactly(L.checkPerson)}
- Give no medical advice. Give no guidance on crossing roads, traffic, stairs, edges, driving, electricity, or anything where a mistake could hurt someone. If asked, say you cannot help with safety decisions and suggest asking a person nearby.
- If the photo is unclear, too dark, blurry, cut off, or does not show what they asked about, or if you are not sure, ${exactly(L.notSure)} and ask them to take a new photo. Never guess.
- The question came from speech-to-text and may contain small mistakes. Use common sense.`;
}

function userText(question, history) {
  // Only the last two turns, trimmed: every word here is billed on every follow-up.
  const past = (history || [])
    .slice(-2)
    .map((h) => `Earlier question: ${h.q.slice(0, 200)}\nYour earlier answer: ${h.a.slice(0, 300)}`)
    .join('\n\n');
  return past ? `${past}\n\nNew question about the same photo: ${question}` : question;
}

async function readError(r) {
  const body = await r.text().catch(() => '');
  try {
    const j = JSON.parse(body);
    const d = j.detail;
    return j.error?.message || (d && (typeof d === 'string' ? d : [d.status, d.message].filter(Boolean).join(': '))) || body.slice(0, 200);
  } catch {
    return body.slice(0, 200);
  }
}

// Gemini models that can see images, cheapest first (USD per 1M tokens in / out).
// Google retires old models for new keys (404), so the first one that works is used and
// retired ones are remembered and skipped. After these, the free OpenRouter models are the backup.
const CHEAPEST_GEMINI = [
  'gemini-2.5-flash-lite', // $0.10 / $0.40
  'gemini-2.5-flash-lite-preview-09-2025', // same price, older name
  'gemini-3.1-flash-lite', // $0.25 / $1.50
  'gemini-3.5-flash-lite', // $0.30 / $2.50
];
const retired = new Set();
const geminiModels = () =>
  (process.env.GEMINI_MODEL ? [process.env.GEMINI_MODEL, process.env.GEMINI_FALLBACK_MODEL] : CHEAPEST_GEMINI)
    .filter((m, i, all) => m && all.indexOf(m) === i && !retired.has(m));

// Questions that need the fine print get full image detail; everything else uses medium (~4× fewer image tokens).
const READ_WORDS = /\b(read|text|say|says|written|label|sign|print|ingredients|expiry|expire|date|price|number|medicine|dose|money|riyals?|banknotes?|notes|coins?)\b|اقرأ|اقرا|مكتوب|النص|ملصق|السعر|التاريخ|دواء|ريال|نقود|فلوس|عملة|ورقة نقدية|വായിക്ക|എഴുതി|ലേബൽ|വില|തീയതി|മരുന്ന്|പണം|റിയാൽ|നോട്ട്/i;
export const wantsReading = (q) => READ_WORDS.test(String(q));

let lastUsage = null; // token counts of the most recent Gemini call (for the /test page)

async function geminiGenerate(parts, system, opts = {}) {
  let lastErr;
  for (const model of geminiModels()) {
    // Google is sometimes briefly overloaded (5xx); try the same model once more.
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        return await geminiOnce(model, parts, system, opts);
      } catch (e) {
        lastErr = e;
        if (e.status === 404) retired.add(model); // not available to this key: never try it again
        if (e.status === 429 || e.status === 404) break; // quota used up or model missing: next model
        if (!e.retry) throw e;
        await new Promise((r) => setTimeout(r, 700));
      }
    }
  }
  throw lastErr;
}

async function geminiOnce(model, parts, system, { maxTokens = 300, allowEmpty = false, detail = 'medium' } = {}, plain = false) {
  const config = { temperature: 0.2, maxOutputTokens: maxTokens };
  if (!plain) {
    const v3 = /gemini-3/.test(model);
    // Fewer image tokens unless we need to read small print.
    // Gemini 3: low ≈ 280 image tokens, high ≈ 1120. Gemini 2.5: medium ≈ 256, high = full tiles.
    config.mediaResolution = detail === 'high' ? 'MEDIA_RESOLUTION_HIGH' : v3 ? 'MEDIA_RESOLUTION_LOW' : 'MEDIA_RESOLUTION_MEDIUM';
    // "Thinking" tokens are billed as output: switch it off (2.5) or to the minimum (3.x).
    config.thinkingConfig = v3 ? { thinkingLevel: 'minimal' } : { thinkingBudget: 0 };
  }
  const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-goog-api-key': keys().gemini },
    body: JSON.stringify({
      ...(system ? { systemInstruction: { parts: [{ text: system }] } } : {}),
      contents: [{ role: 'user', parts }],
      generationConfig: config,
    }),
    signal: AbortSignal.timeout(25000),
  });
  // If a model rejects one of the saving options, ask again without them rather than failing.
  if (r.status === 400 && !plain) return geminiOnce(model, parts, system, { maxTokens, allowEmpty, detail }, true);
  if (!r.ok) throw Object.assign(new Error(`Gemini ${model} ${r.status}: ${await readError(r)}`), { retry: r.status >= 500, status: r.status });
  const j = await r.json();
  const u = j.usageMetadata || {};
  lastUsage = { model, in: u.promptTokenCount || 0, out: (u.candidatesTokenCount || 0) + (u.thoughtsTokenCount || 0) };
  const text = (j.candidates?.[0]?.content?.parts || [])
    .filter((p) => !p.thought)
    .map((p) => p.text || '')
    .join('')
    .trim();
  if (!text && !allowEmpty) throw Object.assign(new Error(`Gemini empty (${j.candidates?.[0]?.finishReason || 'no candidate'})`), { retry: true });
  return text;
}

// OpenRouter, free models only: any id not ending in ":free" is ignored, so it can never cost money.
// A fixed list of free models that can see images and write normal answers. Not the random
// "openrouter/free" router: it sometimes picks safety classifiers that reply "User Safety: safe".
const FREE_VISION = ['qwen/qwen3.8-27b:free', 'google/gemma-4-31b-it:free', 'google/gemma-4-26b-a4b-it:free'];
const usable = (m) => /:free$/.test(m) && !/safety|guard|moderat/i.test(m);
const openrouterModels = () =>
  [process.env.OPENROUTER_MODEL, process.env.OPENROUTER_FALLBACK_MODEL, ...FREE_VISION]
    .filter((m) => m && usable(m))
    .filter((m, i, all) => all.indexOf(m) === i)
    .slice(0, 3);
// Replies that are clearly not an answer (classifier output, empty filler).
const junk = (t) => /^\s*(user|assistant)?\s*safety\s*:|^\s*(safe|unsafe)\s*$/i.test(t);

async function openrouterChat(messages, maxTokens) {
  // Try each free model by name; a busy one (429) or one that errors just moves us to the next.
  let lastErr;
  for (const model of openrouterModels()) {
    try {
      const r = await fetch('https://openrouter.ai/api/v1/chat/completions', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${keys().openrouter}`,
          'HTTP-Referer': process.env.SITE_URL || 'https://eyesforeveryone.vercel.app',
          'X-Title': 'Eyes for Everyone',
        },
        body: JSON.stringify({
          model,
          messages,
          max_tokens: maxTokens,
          temperature: 0.2,
          // Qwen can "think" before answering; off = faster replies.
          ...(/qwen/i.test(model) ? { reasoning: { enabled: false } } : {}),
        }),
        signal: AbortSignal.timeout(25000),
      });
      if (!r.ok) throw new Error(`OpenRouter ${model} ${r.status}: ${await readError(r)}`);
      const j = await r.json();
      if (j.error) throw new Error(`OpenRouter ${model}: ${j.error.message || 'error'}`);
      lastUsage = { model: j.model || model, in: j.usage?.prompt_tokens || 0, out: j.usage?.completion_tokens || 0 };
      const text = (j.choices?.[0]?.message?.content || '').trim();
      if (!text || junk(text)) throw new Error(`OpenRouter ${model} returned a non-answer`);
      return text;
    } catch (e) {
      lastErr = e;
    }
  }
  throw lastErr || new Error('No free OpenRouter model configured');
}

const askers = {
  gemini: ({ image, mime, text, system, reading }) =>
    geminiGenerate([{ inlineData: { mimeType: mime, data: image } }, { text }], system, {
      detail: reading ? 'high' : 'medium',
      maxTokens: reading ? 800 : 300,
    }),
  // Some free models "think" first, so leave them room before the answer.
  openrouter: ({ image, mime, text, system }) =>
    // Gemma (and some other free models) reject a separate "system" message, so the rules go in the same message.
    openrouterChat(
      [
        {
          role: 'user',
          content: [
            { type: 'text', text: `${system}\n\n---\n\nQuestion: ${text}` },
            { type: 'image_url', image_url: { url: `data:${mime};base64,${image}` } },
          ],
        },
      ],
      1500
    ),
};

export async function askAI({ image, mime, question, lang, history, provider }) {
  if (process.env.MOCK_AI === '1' && !order().length) {
    await new Promise((r) => setTimeout(r, 1200));
    return {
      answer:
        'Demo mode. No AI key is set. I see a photo. Add a Gemini or OpenRouter key to get real answers.',
      provider: 'mock',
    };
  }
  const system = systemPrompt(lang);
  const text = userText(question, history);
  const reading = wantsReading(question);
  const providers = order(provider);
  if (!providers.length) throw Object.assign(new Error('No AI key configured'), { status: 503 });
  let lastErr;
  for (const p of providers) {
    try {
      lastUsage = null;
      const answer = await askers[p]({ image, mime, text, system, reading });
      if (answer) return { answer, provider: p, tokens: lastUsage };
      lastErr = new Error(`${p} returned an empty answer`);
    } catch (e) {
      lastErr = e;
    }
  }
  throw lastErr;
}

// ---------- streaming answers (words arrive while the AI is still writing) ----------

// A model that has not sent its first words by then is treated as busy, so the next one gets a turn.
const FIRST_WORDS_MS = { openrouter: 9000, gemini: 12000 };
// Stop trying more free models after this long, so Gemini always has time to answer.
const FREE_BUDGET_MS = 20000;

/** A signal that fires if first() is not called within `ms`, or after `total` ms overall. */
function watchdog(ms, total = 45000) {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(new Error('no first words in time')), ms);
  return {
    signal: AbortSignal.any ? AbortSignal.any([ctl.signal, AbortSignal.timeout(total)]) : ctl.signal,
    first: () => clearTimeout(timer),
    done: () => clearTimeout(timer),
  };
}

/** Reads a server-sent-events body and calls onData(json) for every `data:` line. */
async function readSSE(body, onData) {
  const reader = body.getReader();
  const dec = new TextDecoder();
  let buf = '';
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    let nl;
    while ((nl = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, nl).trim();
      buf = buf.slice(nl + 1);
      if (!line.startsWith('data:')) continue;
      const data = line.slice(5).trim();
      if (!data || data === '[DONE]') continue;
      try {
        onData(JSON.parse(data));
      } catch (e) {
        if (e.fatal) throw e;
      }
    }
  }
}

async function geminiStream({ image, mime, text, system, reading }, emit) {
  let lastErr;
  for (const model of geminiModels()) {
    const config = { temperature: 0.2, maxOutputTokens: reading ? 800 : 300 };
    const v3 = /gemini-3/.test(model);
    config.mediaResolution = reading ? 'MEDIA_RESOLUTION_HIGH' : v3 ? 'MEDIA_RESOLUTION_LOW' : 'MEDIA_RESOLUTION_MEDIUM';
    config.thinkingConfig = v3 ? { thinkingLevel: 'minimal' } : { thinkingBudget: 0 };
    const dog = watchdog(FIRST_WORDS_MS.gemini);
    let r;
    try {
      r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:streamGenerateContent?alt=sse`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-goog-api-key': keys().gemini },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: system }] },
        contents: [{ role: 'user', parts: [{ inlineData: { mimeType: mime, data: image } }, { text }] }],
        generationConfig: config,
      }),
      signal: dog.signal,
    });
    } catch (e) {
      dog.done();
      lastErr = e;
      continue;
    }
    if (!r.ok) {
      dog.done();
      lastErr = new Error(`Gemini ${model} ${r.status}: ${await readError(r)}`);
      if (r.status === 404) retired.add(model);
      continue; // quota, retired or overloaded: try the next model
    }
    let got = false;
    try {
      await readSSE(r.body, (j) => {
        const t = (j.candidates?.[0]?.content?.parts || [])
          .filter((x) => !x.thought)
          .map((x) => x.text || '')
          .join('');
        if (t) {
          if (!got) dog.first();
          got = true;
          emit(t);
        }
      });
    } catch (e) {
      dog.done();
      if (got) return; // keep what was already said
      lastErr = e;
      continue;
    }
    dog.done();
    if (got) return;
    lastErr = new Error(`Gemini ${model} sent no text`);
  }
  throw lastErr || new Error('No Gemini model available');
}

async function openrouterStream({ image, mime, text, system }, emit) {
  let lastErr;
  const began = Date.now();
  for (const model of openrouterModels()) {
    if (Date.now() - began > FREE_BUDGET_MS) break; // leave time for Gemini
    const dog = watchdog(FIRST_WORDS_MS.openrouter);
    let r;
    try {
      r = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${keys().openrouter}`,
        'HTTP-Referer': process.env.SITE_URL || 'https://eyesforeveryone.vercel.app',
        'X-Title': 'Eyes for Everyone',
      },
      body: JSON.stringify({
        model,
        stream: true,
        max_tokens: 1500,
        temperature: 0.2,
        ...(/qwen/i.test(model) ? { reasoning: { enabled: false } } : {}),
        messages: [
          {
            role: 'user',
            content: [
              { type: 'text', text: `${system}\n\n---\n\nQuestion: ${text}` },
              { type: 'image_url', image_url: { url: `data:${mime};base64,${image}` } },
            ],
          },
        ],
      }),
      signal: dog.signal,
    });
    } catch (e) {
      dog.done();
      lastErr = e;
      continue; // no answer in time: try the next one
    }
    if (!r.ok) {
      dog.done();
      lastErr = new Error(`OpenRouter ${model} ${r.status}: ${await readError(r)}`);
      continue; // busy free model: try the next one
    }
    // Hold back the first few words to make sure this is a real answer, not a classifier label.
    let head = '';
    let open = false;
    try {
      await readSSE(r.body, (j) => {
        if (j.error) throw Object.assign(new Error(`OpenRouter ${model}: ${j.error.message || 'error'}`), { fatal: true });
        const t = j.choices?.[0]?.delta?.content || '';
        if (!t) return;
        dog.first();
        if (open) return emit(t);
        head += t;
        if (head.length < 24) return;
        if (junk(head)) throw Object.assign(new Error(`OpenRouter ${model} returned a non-answer`), { fatal: true });
        open = true;
        emit(head);
      });
    } catch (e) {
      dog.done();
      if (open) return; // keep what was already said
      lastErr = e;
      continue;
    }
    dog.done();
    if (!open && head.trim() && !junk(head)) {
      emit(head);
      open = true;
    }
    if (open) return;
    lastErr = new Error(`OpenRouter ${model} sent no text`);
  }
  throw lastErr || new Error('No free OpenRouter model available');
}

const streamers = { gemini: geminiStream, openrouter: openrouterStream };

/**
 * Like askAI, but calls write(text) with each piece of the answer as it arrives.
 * Falls back to the next provider only if nothing has been written yet.
 */
export async function askAIStream({ image, mime, question, lang, history, provider, write }) {
  if (process.env.MOCK_AI === '1' && !order().length) {
    const demo = 'Demo mode. No AI key is set. I see a photo. Add a Gemini or OpenRouter key to get real answers.';
    for (const word of demo.split(/(?<= )/)) {
      await new Promise((r) => setTimeout(r, 70));
      write(word);
    }
    return { provider: 'mock' };
  }
  const system = systemPrompt(lang);
  const text = userText(question, history);
  const reading = wantsReading(question);
  const providers = order(provider);
  if (!providers.length) throw Object.assign(new Error('No AI key configured'), { status: 503 });
  let lastErr;
  for (const p of providers) {
    let wrote = false;
    try {
      await streamers[p]({ image, mime, text, system, reading }, (chunk) => {
        wrote = true;
        write(chunk);
      });
      if (wrote) return { provider: p };
    } catch (e) {
      lastErr = e;
      if (wrote) return { provider: p, partial: true };
    }
  }
  throw lastErr;
}

// ---------- speech to text ----------

const EXT = { 'audio/webm': 'webm', 'audio/mp4': 'mp4', 'audio/ogg': 'ogg', 'audio/wav': 'wav', 'audio/mpeg': 'mp3', 'audio/aac': 'aac' };

async function elevenTranscribe(buf, mime, lang) {
  if (elevenOut()) throw new Error('ElevenLabs STT 401: quota_exceeded (remembered)');
  const form = new FormData();
  form.append('file', new Blob([buf], { type: mime }), `question.${EXT[mime] || 'webm'}`);
  form.append('model_id', process.env.ELEVENLABS_STT_MODEL || 'scribe_v2');
  const iso3 = { en: 'eng', ar: 'ara', ml: 'mal' }[lang];
  if (iso3) form.append('language_code', iso3); // a typed-in language: let Scribe detect it
  form.append('tag_audio_events', 'false');
  const r = await fetch('https://api.elevenlabs.io/v1/speech-to-text', {
    method: 'POST',
    headers: { 'xi-api-key': keys().elevenlabs },
    body: form,
    signal: AbortSignal.timeout(20000),
  });
  if (!r.ok) throw noteEleven(new Error(`ElevenLabs STT ${r.status}: ${await readError(r)}`));
  const j = await r.json();
  return (j.text || '').trim();
}

async function geminiTranscribe(buf, mime, lang) {
  const name = langData(lang).name;
  const text = await geminiGenerate(
    [
      { inlineData: { mimeType: mime, data: buf.toString('base64') } },
      {
        text: `Transcribe the human speech in this audio exactly, in the language spoken (most likely ${name}). Return only the spoken words, nothing else. If there is no clear human speech (silence, noise, music), reply with exactly: [no speech]. Never invent words.`,
      },
    ],
    null,
    { maxTokens: 300, allowEmpty: true } // silence is a valid, empty transcript
  );
  const out = text.replace(/^["'“”]+|["'“”]+$/g, '').trim();
  return /^\[?\s*no speech\s*\]?\.?$/i.test(out) ? '' : out;
}

// Does the text use the expected alphabet? (A Malayalam question should contain Malayalam letters.)
const SCRIPT = { ar: /[\u0600-\u06FF]/, ml: /[\u0D00-\u0D7F]/ };
const scriptOk = (text, lang) => !text || !SCRIPT[lang] || SCRIPT[lang].test(text);

export async function transcribe({ audio, mime, lang }) {
  const buf = Buffer.from(audio, 'base64');
  const base = (mime || 'audio/webm').split(';')[0].trim();
  // ElevenLabs Scribe first (best with every browser format), Gemini as the backup.
  const k = keys();
  const list = [k.elevenlabs && 'elevenlabs', k.gemini && 'gemini'].filter(Boolean);
  if (!list.length) throw Object.assign(new Error('No speech-to-text key configured'), { status: 503 });
  const fns = { elevenlabs: elevenTranscribe, gemini: geminiTranscribe };
  let lastErr;
  let fallback = null;
  for (const p of list) {
    try {
      const text = await fns[p](buf, base, lang);
      // Wrong alphabet usually means the language was misheard; keep it only as a last resort.
      if (scriptOk(text, lang)) return text;
      fallback ??= text;
    } catch (e) {
      lastErr = e;
    }
  }
  if (fallback !== null) return fallback;
  throw lastErr;
}

// ---------- text to speech ----------

// eleven_flash_v2_5 is the fastest but has no Malayalam, so Malayalam uses eleven_v3.
const ELEVEN_MODEL = { en: 'eleven_flash_v2_5', ar: 'eleven_flash_v2_5', ml: 'eleven_v3' };

// Out of ElevenLabs credits: remember it for a few minutes (per server instance), so we stop
// calling ElevenLabs (and filling the logs) until it may have been topped up.
let elevenOutUntil = 0;
const QUOTA = /quota_exceeded|credits remaining/i;
export const elevenOut = () => Date.now() < elevenOutUntil;
function noteEleven(e) {
  if (QUOTA.test(e.message) && !elevenOut()) {
    elevenOutUntil = Date.now() + 5 * 60 * 1000;
    console.warn('ElevenLabs is out of credits; using the backup for 5 minutes.');
  }
  return e;
}

async function elevenSpeech(text, lang, speed = 1) {
  if (elevenOut()) throw new Error('ElevenLabs TTS 401: quota_exceeded (remembered)');
  const voice = process.env.ELEVENLABS_VOICE_ID || 'JBFqnCBsd6RMkjVDRZzb';
  const builtIn = !!LANGS[lang];
  // A typed-in language uses the most multilingual model and lets it detect the language.
  const model = (builtIn && process.env[`ELEVENLABS_TTS_MODEL_${lang.toUpperCase()}`]) || process.env.ELEVENLABS_TTS_MODEL || ELEVEN_MODEL[lang] || 'eleven_v3';
  const r = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(voice)}?output_format=mp3_44100_128`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'xi-api-key': keys().elevenlabs, accept: 'audio/mpeg' },
    body: JSON.stringify({
      text,
      model_id: model,
      ...(builtIn ? { language_code: lang } : {}),
      // ElevenLabs changes the speaking speed itself (0.7–1.2), which sounds natural.
      voice_settings: { stability: 0.6, similarity_boost: 0.8, speed: Math.min(1.2, Math.max(0.7, Number(speed) || 1)) },
    }),
    signal: AbortSignal.timeout(20000),
  });
  if (!r.ok) throw noteEleven(new Error(`ElevenLabs TTS ${r.status}: ${await readError(r)}`));
  return Buffer.from(await r.arrayBuffer());
}

// Google's natural text-to-speech: the second voice, used when ElevenLabs is out of credits or fails.
// It speaks Malayalam and dozens of other languages that phones often have no voice for.
const GEMINI_TTS = ['gemini-2.5-flash-preview-tts', 'gemini-2.5-flash-tts', 'gemini-2.5-pro-preview-tts'];
function wav(pcm, rate) {
  const h = Buffer.alloc(44);
  h.write('RIFF', 0);
  h.writeUInt32LE(36 + pcm.length, 4);
  h.write('WAVEfmt ', 8);
  h.writeUInt32LE(16, 16);
  h.writeUInt16LE(1, 20); // PCM
  h.writeUInt16LE(1, 22); // mono
  h.writeUInt32LE(rate, 24);
  h.writeUInt32LE(rate * 2, 28);
  h.writeUInt16LE(2, 32);
  h.writeUInt16LE(16, 34);
  h.write('data', 36);
  h.writeUInt32LE(pcm.length, 40);
  return Buffer.concat([h, pcm]);
}
// Google's voice has a small request quota, so audio already made is kept (in this server's memory
// only, never stored) and the same sentence is not asked for twice.
const voiceCache = new Map();
async function geminiSpeech(text, lang) {
  const ck = `${lang}|${text}`;
  if (voiceCache.has(ck)) return voiceCache.get(ck);
  const out = await geminiSpeechOnce(text, lang);
  voiceCache.set(ck, out);
  if (voiceCache.size > 300) voiceCache.delete(voiceCache.keys().next().value);
  return out;
}
async function geminiSpeechOnce(text, lang) {
  const key = keys().gemini;
  if (!key) throw Object.assign(new Error('No Gemini key'), { status: 503 });
  const name = langData(lang).name;
  let last;
  for (const model of GEMINI_TTS.filter((m) => !retired.has(m))) {
    const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-goog-api-key': key },
      body: JSON.stringify({
        contents: [{ role: 'user', parts: [{ text: `Read this aloud in ${name}, clearly, warmly and at a calm pace:\n${text}` }] }],
        generationConfig: { responseModalities: ['AUDIO'], speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: 'Kore' } } } },
      }),
      signal: AbortSignal.timeout(25000),
    });
    if (r.status === 404) {
      retired.add(model);
      last = new Error(`Gemini TTS ${model} 404`);
      continue;
    }
    if (!r.ok) throw Object.assign(new Error(`Gemini TTS ${r.status}: ${await readError(r)}`), { status: r.status === 429 ? 429 : 502 });
    const j = await r.json();
    const part = (j.candidates?.[0]?.content?.parts || []).find((p) => p.inlineData?.data);
    if (!part) throw new Error('Gemini TTS sent no audio');
    const rate = Number(/rate=(\d+)/.exec(part.inlineData.mimeType || '')?.[1]) || 24000;
    return { audio: wav(Buffer.from(part.inlineData.data, 'base64'), rate), type: 'audio/wav', voice: 'gemini' };
  }
  throw last || new Error('No Gemini voice model available');
}

/** Speech for one sentence: ElevenLabs first, Google's voice as the backup. Resolves to { audio, type }. */
export async function speech({ text, lang, speed, preload = false }) {
  const k = keys();
  if (!k.elevenlabs && !k.gemini) throw Object.assign(new Error('No text-to-speech key configured'), { status: 503 });
  let lastErr;
  if (k.elevenlabs && !elevenOut()) {
    try {
      return { audio: await elevenSpeech(text, lang, speed), type: 'audio/mpeg', voice: 'elevenlabs' };
    } catch (e) {
      lastErr = e;
    }
  }
  // Pre-loading is only worth it with ElevenLabs; Google's small quota is kept for what is said now.
  if (preload) throw Object.assign(new Error('no preload with the backup voice'), { status: 204 });
  if (k.gemini) {
    try {
      return await geminiSpeech(text, lang);
    } catch (e) {
      lastErr = e;
    }
  }
  throw lastErr || new Error('ElevenLabs TTS 401: quota_exceeded (remembered)');
}

/** Translates the app's own words into a language the user typed in. */
export async function translateStrings(language, strings) {
  const prompt = `Translate the VALUES of this JSON from English into ${language}. It is the text of a phone app for people with low vision; most of it is read aloud.
Rules: keep every key exactly as it is. Keep placeholders such as {n}, {m}, {km}, {deg}, {dir}, {turn}, {acc}, {v} and {name} unchanged. Arrays keep the same length and order. Use short, plain, natural wording. Do not use em dashes.
Reply with only this JSON: {"meta": {"code": "<BCP 47 tag for ${language}, like ur or fr-FR>", "rtl": <true if it is written right to left>, "native": "<the name of ${language} written in ${language}>"}, "strings": <the translated JSON>}

JSON to translate:
${JSON.stringify(strings)}`;
  let lastErr;
  for (const model of geminiModels()) {
    try {
      const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-goog-api-key': keys().gemini },
        body: JSON.stringify({
          contents: [{ role: 'user', parts: [{ text: prompt }] }],
          generationConfig: { temperature: 0.2, maxOutputTokens: 16000, responseMimeType: 'application/json' },
        }),
        signal: AbortSignal.timeout(55000),
      });
      if (r.status === 404) {
        retired.add(model);
        continue;
      }
      if (!r.ok) throw Object.assign(new Error(`Gemini translate ${r.status}: ${await readError(r)}`), { status: r.status });
      const j = await r.json();
      const text = (j.candidates?.[0]?.content?.parts || []).filter((p) => !p.thought).map((p) => p.text || '').join('');
      const out = JSON.parse(text);
      if (!out?.strings || typeof out.strings !== 'object') throw new Error('translation missing');
      return out;
    } catch (e) {
      lastErr = e;
      if (e.status === 429) continue;
    }
  }
  throw lastErr || new Error('No Gemini model for translation');
}
