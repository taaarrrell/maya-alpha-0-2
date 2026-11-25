/* M.A.Y.A. Alpha 0.2 — Synthetic adapter integration test (jsdom, synthetic only).
   Simulates a minimal UI consumer the way Echo's frontend will use the
   adapter: it sends messages in Simulated and Live mode (mock fetch) and
   persists the conversation (user + model messages) to a mock storage
   under the UI's history key. It proves the adapter and a UI consumer
   integrate correctly — the conversation and the chain id live under the
   isolated Alpha 0.2 keys, the Alpha 0.1 keys are never touched, typed
   errors do not add a reply, concurrent sends are rejected, and clear()
   drops the chain id and the history.
   No network, no live calls, no real data, no credentials.
   Run:  NODE_PATH=<path to a jsdom install> node test-adapter-integration-0-2.cjs
         (jsdom is available under ~/workspace/your_files/maya-alpha-2a/node_modules)
   Exit: 0 when every test passes, 1 otherwise. */
'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { JSDOM, VirtualConsole } = require('jsdom');

const ADAPTER_PATH = path.join(__dirname, '..', 'shared', 'adapter.js');
const ADAPTER_SRC = fs.readFileSync(ADAPTER_PATH, 'utf8');
const FIXTURES_DIR = path.join(__dirname, 'fixtures');
const IDENTITY = JSON.parse(fs.readFileSync(path.join(FIXTURES_DIR, 'identity-synthetic.json'), 'utf8'));
const WORKER_200 = JSON.parse(fs.readFileSync(path.join(FIXTURES_DIR, 'worker-200.json'), 'utf8'));
const WORKER_ERRORS = JSON.parse(fs.readFileSync(path.join(FIXTURES_DIR, 'worker-errors.json'), 'utf8'));
const WORKER_URL = 'https://maya-alpha-m3-proxy.macman2028.workers.dev';
const CHAIN_KEY = 'maya-alpha-0-2-chain-v0.1';
const HISTORY_KEY = 'maya-alpha-0-2-conversation-v0.1';
const OLD_CHAIN_KEY = 'maya-alpha-chain-v0.1';
const OLD_HISTORY_KEY = 'maya-alpha-conversation-v0.1';
const sleep = ms => new Promise(r => setTimeout(r, ms));
const sha256 = s => crypto.createHash('sha256').update(s, 'utf8').digest('hex');

function mockJsonResponse(status, body) {
  return { ok: status >= 200 && status < 300, status: status, json: async () => body, text: async () => JSON.stringify(body) };
}
function mockErrorResponse(code) {
  const f = WORKER_ERRORS[code];
  if (!f) { throw new Error('no fixture for Worker error code: ' + code); }
  return mockJsonResponse(f.status, f.body);
}

/* ---------- Minimal UI consumer (the way Echo's frontend uses the adapter) ----------
   The consumer owns the conversation history (an array of {role, text}) and
   persists it as JSON under the UI's history key. It never touches the
   adapter's chain key — the adapter owns that. On a successful send it
   appends the model reply; on a typed error it adds NO reply and records
   the error for the UI to display. */
function makeConsumer(opts) {
  opts = opts || {};
  const store = new Map();
  const keysTouched = new Set();
  const fetchCalls = [];
  let mockFetch = opts.mockFetch || null;
  const jsdomErrors = [];
  const vc = new VirtualConsole();
  vc.on('jsdomError', e => jsdomErrors.push(String((e && e.message) || e)));
  const dom = new JSDOM('<!doctype html><html><head></head><body></body></html>', {
    url: 'http://localhost/',
    runScripts: 'dangerously',
    pretendToBeVisual: true,
    virtualConsole: vc,
    beforeParse(window) {
      window.fetch = function (url, options) {
        fetchCalls.push({ url: url, options: options });
        if (typeof mockFetch === 'function') { return mockFetch(url, options); }
        return Promise.reject(new Error('network disabled in test'));
      };
      const mockStorage = {
        getItem(k) { keysTouched.add(k); return store.has(k) ? store.get(k) : null; },
        setItem(k, v) { keysTouched.add(k); store.set(k, String(v)); },
        removeItem(k) { keysTouched.add(k); store.delete(k); },
        clear() { keysTouched.add('(clear)'); store.clear(); },
        key(i) { return [...store.keys()][i] || null; },
        get length() { return store.size; }
      };
      Object.defineProperty(window, 'localStorage', { value: mockStorage, configurable: true });
    }
  });
  const window = dom.window;
  window.eval(ADAPTER_SRC);
  if (!window.MayaAlpha02 || typeof window.MayaAlpha02.createAdapter !== 'function') {
    throw new Error('adapter did not attach to window.MayaAlpha02');
  }
  const adapter = window.MayaAlpha02.createAdapter({
    workerUrl: WORKER_URL,
    identity: IDENTITY,
    timeoutMs: opts.timeoutMs || 35000,
    simulatedDelayMs: typeof opts.simulatedDelayMs === 'number' ? opts.simulatedDelayMs : 10,
    nowImpl: opts.nowImpl || function () { return new Date('2026-11-25T12:00:00Z'); }
  });
  const storage = window.localStorage;
  const consumer = {
    window: window,
    adapter: adapter,
    store: store,
    keysTouched: keysTouched,
    fetchCalls: fetchCalls,
    jsdomErrors: jsdomErrors,
    history: [],
    lastError: null,
    setMockFetch: function (fn) { mockFetch = fn; },
    persistHistory: function () {
      storage.setItem(HISTORY_KEY, JSON.stringify(consumer.history));
    },
    loadHistory: function () {
      const raw = storage.getItem(HISTORY_KEY);
      if (raw === null || raw === undefined) { return []; }
      return JSON.parse(raw);
    },
    /* Send a user message. The user message is persisted immediately;
       the model reply is appended (and persisted) only on success. On
       a typed error, no model reply is added and the error is recorded
       for the UI to display by code. Returns the adapter's resolved
       value, or throws the typed error. */
    sendUser: async function (text) {
      consumer.history.push({ role: 'user', text: text });
      consumer.persistHistory();
      consumer.lastError = null;
      let result;
      try {
        result = await adapter.send(text);
      } catch (err) {
        consumer.lastError = err;
        throw err;
      }
      consumer.history.push({ role: 'model', text: result.text });
      consumer.persistHistory();
      return result;
    },
    /* Clear the conversation: the adapter drops the chain id, and the
       consumer drops the history (in memory and in storage). */
    clearConversation: function () {
      adapter.clear();
      consumer.history = [];
      storage.removeItem(HISTORY_KEY);
    }
  };
  return consumer;
}

const results = [];
async function test(name, fn) {
  try { await fn(); results.push({ name: name, pass: true }); console.log('PASS  ' + name); }
  catch (e) { results.push({ name: name, pass: false, detail: e.message }); console.log('FAIL  ' + name + ' — ' + e.message); }
}
function assert(cond, msg) { if (!cond) { throw new Error(msg); } }
function assertError(err, code, kind, msgPart) {
  assert(err && typeof err === 'object', 'expected an error object, got ' + String(err));
  assert(err.code === code, 'error code is ' + JSON.stringify(err.code) + ', expected ' + JSON.stringify(code));
  assert(err.kind === kind, 'error kind is ' + JSON.stringify(err.kind) + ', expected ' + JSON.stringify(kind));
  if (msgPart !== undefined) {
    assert(typeof err.message === 'string' && err.message.indexOf(msgPart) !== -1,
      'error message ' + JSON.stringify(err.message) + ' does not contain ' + JSON.stringify(msgPart));
  }
}

(async () => {
  await test('I-01 simulated send persists the conversation under the 0.2 history key', async () => {
    const c = makeConsumer();
    const r = await c.sendUser('Hello');
    assert(r.remaining === 'unknown', 'simulated reply carried a live count: ' + JSON.stringify(r.remaining));
    assert(c.history.length === 2, 'history has ' + c.history.length + ' messages, expected 2');
    assert(c.history[0].role === 'user' && c.history[0].text === 'Hello', 'user message not recorded');
    assert(c.history[1].role === 'model' && c.history[1].text === r.text, 'model reply not recorded');
    const persisted = c.loadHistory();
    assert(persisted.length === 2, 'persisted history has ' + persisted.length + ' messages, expected 2');
    assert(JSON.stringify(persisted) === JSON.stringify(c.history), 'persisted history does not match the in-memory history');
    assert(c.store.get(HISTORY_KEY) !== undefined, 'history key not present in storage');
    assert(c.adapter.getChainId() === null, 'a simulated send set a chain id');
    assert(!c.store.has(CHAIN_KEY), 'a simulated send wrote the chain key');
    assert(c.fetchCalls.length === 0, 'a simulated send called fetch');
  });

  await test('I-02 live send persists the conversation and stores the chain id under the 0.2 chain key', async () => {
    const c = makeConsumer();
    c.setMockFetch(() => Promise.resolve(mockJsonResponse(200, WORKER_200)));
    c.adapter.setMode('live');
    const r = await c.sendUser('Hello');
    assert(r.text === WORKER_200.text, 'live reply text wrong: ' + r.text);
    assert(r.remaining === WORKER_200.remaining, 'live remaining wrong: ' + JSON.stringify(r.remaining));
    assert(c.history.length === 2, 'history has ' + c.history.length + ' messages, expected 2');
    assert(c.history[1].role === 'model' && c.history[1].text === WORKER_200.text, 'live reply not recorded in history');
    assert(c.loadHistory().length === 2, 'persisted history has the wrong length after a live send');
    assert(c.adapter.getChainId() === WORKER_200.interaction_id, 'chain id not stored after a live send');
    assert(c.store.get(CHAIN_KEY) === WORKER_200.interaction_id, 'chain id not persisted under the 0.2 chain key');
    /* A second live send chains: the request carries previous_interaction_id. */
    c.setMockFetch(() => Promise.resolve(mockJsonResponse(200, { text: 'Second reply.', interaction_id: 'int_second_022', remaining: 18 })));
    const r2 = await c.sendUser('Second');
    assert(r2.text === 'Second reply.', 'second live reply text wrong');
    const body2 = JSON.parse(c.fetchCalls[c.fetchCalls.length - 1].options.body);
    assert(body2.previous_interaction_id === WORKER_200.interaction_id, 'second request did not chain: ' + JSON.stringify(body2));
    assert(c.history.length === 4, 'history has ' + c.history.length + ' messages after two exchanges, expected 4');
    assert(c.adapter.getChainId() === 'int_second_022', 'chain id not updated to the second id');
  });

  await test('I-03 the consumer and adapter together touch only the 0.2 keys, never the Alpha 0.1 keys', async () => {
    const c = makeConsumer();
    c.setMockFetch(() => Promise.resolve(mockJsonResponse(200, WORKER_200)));
    c.adapter.setMode('live');
    await c.sendUser('Hello');
    await c.sendUser('Second');
    /* An error, then a clear, then a simulated send — all the paths a
       real UI exercises. */
    c.setMockFetch(() => Promise.resolve(mockErrorResponse('upstream_overloaded')));
    try { await c.sendUser('Third'); } catch (e) { /* expected; see I-04 */ }
    c.clearConversation();
    c.adapter.setMode('simulated');
    await c.sendUser('Hello in simulated');
    assert(c.keysTouched.size === 2 && c.keysTouched.has(CHAIN_KEY) && c.keysTouched.has(HISTORY_KEY),
      'keys touched: ' + [...c.keysTouched].join(', '));
    assert(!c.keysTouched.has(OLD_CHAIN_KEY), 'the Alpha 0.1 chain key was touched');
    assert(!c.keysTouched.has(OLD_HISTORY_KEY), 'the Alpha 0.1 history key was touched');
    assert(!c.store.has(OLD_CHAIN_KEY) && !c.store.has(OLD_HISTORY_KEY), 'an Alpha 0.1 key is present in storage');
  });

  await test('I-04 a typed error (upstream_overloaded) adds no model reply and the user message stays', async () => {
    const c = makeConsumer();
    c.setMockFetch(() => Promise.resolve(mockErrorResponse('upstream_overloaded')));
    c.adapter.setMode('live');
    let caught = null;
    try { await c.sendUser('Hello'); } catch (e) { caught = e; }
    assert(caught !== null, 'the overloaded send resolved, expected a rejection');
    assertError(caught, 'upstream_overloaded', 'worker', 'overloaded');
    assert(c.lastError === caught, 'the consumer did not record the error');
    assert(c.history.length === 1, 'history has ' + c.history.length + ' messages after an error, expected 1 (user only)');
    assert(c.history[0].role === 'user' && c.history[0].text === 'Hello', 'the user message was not kept after the error');
    assert(c.loadHistory().length === 1, 'the persisted history changed after the error');
    assert(c.adapter.getChainId() === null, 'chain id changed after the error');
    assert(c.adapter.isCountStale() === true, 'count is not stale after the error');
    assert(c.fetchCalls.length === 1, 'the failed send was retried');
  });

  await test('I-05 a concurrent second send is rejected with busy and the first send completes and persists', async () => {
    const c = makeConsumer();
    c.setMockFetch(() => new Promise(resolve => {
      setTimeout(() => resolve(mockJsonResponse(200, WORKER_200)), 200);
    }));
    c.adapter.setMode('live');
    const first = c.sendUser('Hello');
    let secondErr = null;
    try { await c.sendUser('Hello again'); } catch (e) { secondErr = e; }
    assert(secondErr !== null, 'the concurrent send resolved, expected a busy rejection');
    assertError(secondErr, 'busy', 'concurrent', 'already in progress');
    assert(c.fetchCalls.length === 1, 'the concurrent send made a second fetch call');
    const r = await first;
    assert(r.text === WORKER_200.text, 'the first send did not complete normally');
    /* The first exchange persisted (user + model). The rejected second
       send added its user message to the history when it was attempted
       — but it must NOT have added a model reply, and it must not have
       consumed a slot. The history is therefore: the first user
       message, the rejected attempt's user message, then the first
       exchange's model reply (appended when the first send completed). */
    assert(c.history.length === 3, 'history has ' + c.history.length + ' messages, expected 3');
    assert(c.history[1].role === 'user' && c.history[1].text === 'Hello again', 'the rejected attempt did not record its user message');
    assert(c.history[2].role === 'model' && c.history[2].text === WORKER_200.text, 'the first send did not append its model reply');
    assert(c.loadHistory().length === 3, 'the persisted history does not match after the concurrent attempt');
    assert(c.adapter.getChainId() === WORKER_200.interaction_id, 'the first send did not store its chain id');
  });

  await test('I-06 clear() drops the chain id and the consumer can clear the history key', async () => {
    const c = makeConsumer();
    c.setMockFetch(() => Promise.resolve(mockJsonResponse(200, WORKER_200)));
    c.adapter.setMode('live');
    await c.sendUser('Hello');
    assert(c.history.length === 2, 'history not populated before the clear');
    assert(c.store.has(CHAIN_KEY), 'chain key not present before the clear');
    assert(c.store.has(HISTORY_KEY), 'history key not present before the clear');
    c.clearConversation();
    assert(c.adapter.getChainId() === null, 'clear() did not drop the chain id');
    assert(!c.store.has(CHAIN_KEY), 'chain key survived the clear');
    assert(c.history.length === 0, 'history not emptied by the clear');
    assert(!c.store.has(HISTORY_KEY), 'history key survived the clear');
    assert(c.loadHistory().length === 0, 'loadHistory is not empty after the clear');
    /* A fresh live send after the clear starts a new chain. */
    c.setMockFetch(() => Promise.resolve(mockJsonResponse(200, { text: 'Fresh.', interaction_id: 'int_fresh_023', remaining: 19 })));
    const r = await c.sendUser('Hello again');
    assert(r.text === 'Fresh.', 'a send after the clear did not work');
    const body = JSON.parse(c.fetchCalls[c.fetchCalls.length - 1].options.body);
    assert(!('previous_interaction_id' in body), 'the post-clear request carried a stale chain id');
    assert(c.history.length === 2, 'history not repopulated after the clear');
    assert(c.adapter.getChainId() === 'int_fresh_023', 'the post-clear chain id was not stored');
  });

  /* ---------- Summary ---------- */
  const failed = results.filter(r => !r.pass);
  console.log('\n' + results.filter(r => r.pass).length + '/' + results.length + ' tests passed.');
  if (failed.length) {
    console.log('Failed:');
    for (const f of failed) { console.log('  - ' + f.name + ': ' + f.detail); }
  }
  console.log('Adapter SHA-256: ' + sha256(ADAPTER_SRC));
  process.exit(failed.length ? 1 : 0);
})();
