import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';

test('PWA kiểm tra lại bản trên mạng và vẫn dùng cache khi ngoại tuyến', async () => {
  const listeners = new Map();
  const requested = [];
  let failNetwork = false;
  let installRequests;
  const offlineResponse = { source: 'offline' };
  const cache = {
    addAll: async (requests) => { installRequests = requests; },
    put: async () => {},
  };
  const context = {
    self: {
      location: { origin: 'https://example.com' },
      addEventListener: (name, handler) => listeners.set(name, handler),
      skipWaiting: async () => {},
      clients: { claim: async () => {} },
    },
    Request: class { constructor(url, options) { this.url = url; this.cache = options.cache; } },
    caches: { open: async () => cache, match: async () => offlineResponse, keys: async () => [] },
    fetch: async (request, options) => {
      requested.push(options.cache);
      if (failNetwork) throw new Error('offline');
      return { ok: true, source: 'network', clone() { return this; } };
    },
    URL,
    Promise,
  };
  runInNewContext(readFileSync(new URL('../sw.js', import.meta.url), 'utf8'), context);

  let installed;
  listeners.get('install')({ waitUntil: (promise) => { installed = promise; } });
  await installed;
  assert.ok(installRequests.length > 0);
  assert.ok(installRequests.every((request) => request.cache === 'reload'));
  assert.ok(['./finance.js', './csv-import.js'].every((asset) => installRequests.some((request) => request.url === asset)));

  const request = { method: 'GET', url: 'https://example.com/app.js' };
  let response;
  listeners.get('fetch')({ request, respondWith: (promise) => { response = promise; } });
  assert.equal((await response).source, 'network');
  assert.deepEqual(requested, ['no-cache']);

  failNetwork = true;
  listeners.get('fetch')({ request, respondWith: (promise) => { response = promise; } });
  assert.equal((await response).source, 'offline');
});
