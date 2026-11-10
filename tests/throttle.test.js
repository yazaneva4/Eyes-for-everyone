import test from 'node:test';
import assert from 'node:assert/strict';
import { guard } from '../api/_lib/http.js';

function response() {
  return {
    statusCode: 200,
    headers: {},
    body: null,
    setHeader(name, value) { this.headers[name.toLowerCase()] = value; },
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; },
  };
}
function request(ip, overrides = {}) {
  return {
    method: 'POST',
    headers: { host: 'eyes.example', origin: 'https://eyes.example', 'x-forwarded-for': ip },
    body: { question: 'what is this?' },
    ...overrides,
  };
}

test('ordinary traffic passes the guard', () => {
  const res = response();
  assert.equal(guard(request('10.0.0.1'), res), true);
  assert.equal(res.statusCode, 200);
});

test('a client over the limit gets 429 with Retry-After', () => {
  const ip = '10.0.1.7';
  for (let i = 0; i < 3; i++) assert.equal(guard(request(ip), response(), 3), true);
  const res = response();
  assert.equal(guard(request(ip), res, 3), false);
  assert.equal(res.statusCode, 429);
  assert.equal(res.headers['retry-after'], '60');
  // A different visitor is unaffected by that client's burst.
  assert.equal(guard(request('10.0.1.8'), response(), 3), true);
});

test('browser requests from another site are refused', () => {
  const res = response();
  assert.equal(guard(request('10.0.2.1', { headers: { host: 'eyes.example', origin: 'https://evil.example' } }), res), false);
  assert.equal(res.statusCode, 403);
});

test('only POST is accepted', () => {
  const res = response();
  assert.equal(guard(request('10.0.3.1', { method: 'GET' }), res), false);
  assert.equal(res.statusCode, 405);
});
