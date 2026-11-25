'use strict';
const assert = require('node:assert/strict');
const { createAdapter } = require('../shared/adapter.js');
const url = 'https://synthetic.invalid';
const deferred = () => {
  let resolve;
  const promise = new Promise(done => { resolve = done; });
  return { promise, resolve };
};
const response = (text, count, id) => ({
  ok: true, status: 200, json: async () => ({ text, remaining: count, interaction_id: id })
});

async function main() {
  const oldBody = deferred();
  const bodyStarted = deferred();
  const signals = [];
  const storage = new Map();
  let request = 0;
  let now = new Date('2026-11-25T23:59:00Z');
  const adapter = createAdapter({
    workerUrl: url, nowImpl: () => now, timeoutMs: 90, simulatedDelayMs: 0,
    storage: { getItem: key => storage.get(key), setItem: (key, value) => storage.set(key, value), removeItem: key => storage.delete(key) },
    fetchImpl(endpoint, { signal }) {
      assert.equal(endpoint, url + '/chat');
      signals.push(signal);
      switch (++request) {
        case 1: return Promise.resolve(response('First', 19, 'first'));
        case 2: return Promise.resolve({ ok: true, status: 200, json() { bodyStarted.resolve(); return oldBody.promise; } });
        case 3: return Promise.resolve({ ok: true, status: 200, json: () => new Promise(() => {}) });
        case 5: return Promise.resolve({
          ok: true, status: 200,
          json: () => new Promise((_, reject) => signal.addEventListener('abort', () => reject(new Error('Aborted body'))))
        });
        default: return Promise.resolve(response('Today', 18, 'today'));
      }
    }
  });
  assert.equal(adapter.getMode(), 'simulated');
  assert.match((await adapter.send('hello')).text, /simulated/i);
  assert.equal(request, 0);
  adapter.setMode('live');
  assert.equal((await adapter.send('first')).remaining, 19);
  assert.equal(adapter.isCountStale(), false);
  now = new Date('2026-11-26T00:00:00Z');
  assert.equal(adapter.getRemaining(), 'unknown');
  assert.equal(adapter.isCountStale(), true);
  console.log('PASS adapter simulation never invokes transport, same-day count and UTC expiry');

  const old = adapter.send('old');
  const cancelled = assert.rejects(old, { code: 'cancelled', kind: 'cancelled', message: null });
  await bodyStarted.promise;
  await assert.rejects(adapter.send('duplicate'), { code: 'busy', kind: 'concurrent' });
  adapter.clear();
  await cancelled;
  assert.equal(signals[1].aborted, true);
  assert.equal(adapter.getChainId(), null);
  const newer = adapter.send('new body hangs until abort');
  const timedOut = assert.rejects(newer, { code: 'client_timeout', kind: 'timeout' });
  oldBody.resolve({ text: 'Old', remaining: 17, interaction_id: 'old' });
  await timedOut;
  assert.equal(signals[2].aborted, true);
  assert.equal(adapter.getChainId(), null);
  assert.equal(adapter.getRemaining(), 'unknown');
  assert.equal((await adapter.send('recovery')).remaining, 18);
  assert.equal(adapter.getChainId(), 'today');
  assert.equal(request, 4);
  console.log('PASS adapter busy, reset abort, late parse isolation, newer timeout, explicit recovery');

  const abortAware = await adapter.send('body rejects on abort').catch(error => error);
  assert.equal(signals[4].aborted, true);
  if (abortAware.code === 'upstream_bad_json' && abortAware.kind === 'worker') {
    console.log('FAIL adapter abort-aware body: expected client_timeout/timeout, observed upstream_bad_json/worker');
    process.exitCode = 1;
  } else {
    assert.equal(abortAware.code, 'client_timeout');
    assert.equal(abortAware.kind, 'timeout');
    console.log('PASS adapter abort-aware body reports client_timeout');
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
