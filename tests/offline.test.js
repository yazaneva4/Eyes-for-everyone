import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync, existsSync } from 'node:fs';

const source = readFileSync(new URL('../public/sw.js', import.meta.url), 'utf8');
function worker() {
  const events = {};
  const stored = new Map([['/', new Response('<html>app</html>')]]);
  const deleted = [];
  let shell;
  const cache = {
    match: async (request) => stored.get(typeof request === 'string' ? request : request.url),
    addAll: async (paths) => { shell = paths; },
    put: async () => {},
  };
  vm.runInNewContext(source, {
    self: { addEventListener: (name, handler) => { events[name] = handler; }, skipWaiting() {}, clients: { claim() {} } },
    location: { origin: 'https://eyes.example' }, URL, Response,
    fetch: async () => { throw new Error('offline'); },
    caches: { open: async () => cache, keys: async () => ['eyes-v58', 'eyes-v59', 'another-app'], delete: async key => deleted.push(key) },
  });
  return { events, deleted, get shell() { return shell; } };
}
test('offline HTML fallback is restricted to page navigations', async () => {
  const { events } = worker();
  for (const mode of ['navigate', 'cors', 'no-cors']) {
    let response;
    events.fetch({ request: { url: 'https://eyes.example/missing', method: 'GET', mode }, respondWith: p => { response = p; } });
    const result = await response;
    if (mode === 'navigate') assert.equal(await result.text(), '<html>app</html>');
    else assert.equal(result.type, 'error');
  }
});
test('offline shell includes every bundled language font and existing assets', async () => {
  const w = worker(); let installing;
  w.events.install({ waitUntil: p => { installing = p; } }); await installing;
  for (const path of w.shell) if (path !== '/') assert.ok(existsSync(new URL(`../public${path}`, import.meta.url)), path);
  for (const font of ['atkinson-hyperlegible-next-latin-ext', 'noto-sans-arabic-arabic', 'noto-sans-malayalam-malayalam']) assert.ok(w.shell.includes(`/fonts/${font}.woff2`));
});
test('activation removes only obsolete Eyes caches', async () => {
  const w = worker(); let activating;
  w.events.activate({ waitUntil: p => { activating = p; } }); await activating;
  assert.deepEqual(w.deleted, ['eyes-v58']);
});
