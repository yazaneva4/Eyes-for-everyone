import test from 'node:test';
import assert from 'node:assert/strict';
import { guard, isB64 } from '../api/_lib/http.js';
import { langOf } from '../api/_lib/ai.js';
import ask from '../api/ask.js';

function response() {
  return {
    code: 200,
    setHeader() {},
    status(code) { this.code = code; return this; },
    json(body) { this.body = body; return this; },
  };
}

test('base64 validation checks the entire payload and padding', () => {
  assert.ok(isB64('aGVsbG8=', 100));
  assert.ok(isB64('YWJj', 100));
  for (const value of ['A'.repeat(200) + '!!!!', 'a=bc', 'abc', '====', '', 'YWJj\n']) {
    assert.equal(isB64(value, 1000), false, value);
  }
  assert.equal(isB64('YWJj', 3), false);
  assert.ok(isB64('A'.repeat(4_000_000), 4_000_000));
});

test('JSON arrays are rejected as request bodies', () => {
  const res = response();
  assert.equal(guard({ method: 'POST', headers: {}, body: [] }, res), false);
  assert.equal(res.code, 400);
});

test('prototype property names fall back to English', () => {
  for (const value of ['__proto__', 'constructor', 'toString']) assert.equal(langOf(value), 'en');
  assert.equal(langOf('ar'), 'ar');
});

test('malformed history entries do not crash a valid photo request', async () => {
  const previous = process.env.MOCK_AI;
  process.env.MOCK_AI = '1';
  try {
    const res = response();
    await ask({ method: 'POST', headers: {}, body: { image: 'YWJj', history: [null, 42, { q: 'Hello', a: 'Hi' }] } }, res);
    assert.equal(res.code, 200);
    assert.ok(res.body);
  } finally {
    if (previous === undefined) delete process.env.MOCK_AI;
    else process.env.MOCK_AI = previous;
  }
});


test('unexpected JSON types are rejected before reaching AI providers', async () => {
  for (const field of ['question', 'lang', 'langName', 'mime', 'provider', 'text', 'language']) {
    for (const value of [null, [], {}, { toString: null }]) {
      const res = response();
      await ask({ method: 'POST', headers: {}, body: { image: 'YWJj', [field]: value } }, res);
      assert.equal(res.code, 400, field);
    }
  }
});

test('language helpers reject malformed objects without coercion', () => {
  assert.equal(langOf({ toString: null }), 'en');
  assert.equal(langOf('x', { toString: null }), 'en');
});
