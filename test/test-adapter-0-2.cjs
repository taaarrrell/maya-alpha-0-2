/* M.A.Y.A. Alpha 0.2 — Adapter test harness (jsdom, synthetic fixtures only).
   Tests shared/adapter.js (Assignment S01) against a mock Worker endpoint.
   No network, no live calls, no real data, no credentials.
   Run:  NODE_PATH=<path to a jsdom install> node test-adapter-0-2.cjs
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
const UPSTREAM_SHAPES = JSON.parse(fs.readFileSync(path.join(FIXTURES_DIR, 'upstream-shapes.json'), 'utf8'));
const WORKER_URL = 'https://maya-alpha-m3-proxy.macman2028.workers.dev';
const CHAIN_KEY = 'maya-alpha-0-2-chain-v0.1';
const OLD_CHAIN_KEY = 'maya-alpha-chain-v0.1';
const OLD_HISTORY_KEY = 'maya-alpha-conversation-v0.1';
const sleep = ms => new Promise(r => setTimeout(r, ms));
const sha256 = s => crypto.createHash('sha256').update(s, 'utf8').digest('hex');

/* ---------- Mock Worker helpers ---------- */
function mockJsonResponse(status, body) {
  return { ok: status >= 200 && status < 300, status: status, json: async () => body, text: async () => JSON.stringify(body) };
}
function mockErrorResponse(code) {
  const f = WORKER_ERRORS[code];
  if (!f) { throw new Error('no fixture for Worker error code: ' + code); }
  return mockJsonResponse(f.status, f.body);
}

/* Build a fresh jsdom window, install a mock localStorage (recording every
   key touched) and a mock fetch, load the adapter source as a <script>
   would, and construct an adapter. Each test gets a fresh adapter. */
function makeAdapter(opts) {
  opts = opts || {};
  const store = new Map();
  if (opts.seed) {
    for (const k of Object.keys(opts.seed)) { store.set(k, opts.seed[k]); }
  }
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
    nowImpl: opts.nowImpl || undefined
  });
  return {
    window: window,
    adapter: adapter,
    store: store,
    keysTouched: keysTouched,
    fetchCalls: fetchCalls,
    jsdomErrors: jsdomErrors,
    setMockFetch: function (fn) { mockFetch = fn; }
  };
}

function lastFetchBody(ctx) {
  const c = ctx.fetchCalls[ctx.fetchCalls.length - 1];
  if (!c) { throw new Error('no fetch call was recorded'); }
  return JSON.parse(c.options.body);
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
async function assertRejects(promise, code, kind, msgPart) {
  let caught = null;
  try { await promise; } catch (e) { caught = e; }
  assert(caught !== null, 'promise resolved, expected a rejection with code ' + code);
  assertError(caught, code, kind, msgPart);
  return caught;
}

(async () => {
  /* ---------- Simulated mode ---------- */
  await test('A-01 simulated greeting resolves with remaining unknown and no fetch', async () => {
    const ctx = makeAdapter();
    const r = await ctx.adapter.send('Hello');
    assert(r.text.indexOf('Hello.') === 0, 'greeting text wrong: ' + r.text);
    assert(/simulated reply/i.test(r.text), 'greeting does not say it is simulated');
    assert(r.remaining === 'unknown', 'simulated remaining is not unknown: ' + JSON.stringify(r.remaining));
    assert(ctx.fetchCalls.length === 0, 'simulated send called fetch ' + ctx.fetchCalls.length + ' times');
    assert(ctx.adapter.getChainId() === null, 'simulated send set a chain id');
  });

  await test('A-02 simulated who-are-you uses the fixture identity', async () => {
    const ctx = makeAdapter();
    const r = await ctx.adapter.send('Who are you?');
    assert(r.text.indexOf("I'm " + IDENTITY.display_name + ' — ' + IDENTITY.full_name) === 0,
      'who-are-you reply does not use the fixture identity: ' + r.text);
    assert(/simulated by fixed rules/i.test(r.text), 'who-are-you reply does not say it is simulated');
    assert(ctx.fetchCalls.length === 0, 'who-are-you called fetch');
  });

  await test('A-03 simulated help lists the milestone capabilities', async () => {
    const ctx = makeAdapter();
    const r = await ctx.adapter.send('What can you do?');
    assert(/hold a conversation here/i.test(r.text), 'help reply missing the conversation capability: ' + r.text);
    assert(/simulated, not generated by a model/i.test(r.text), 'help reply does not say it is simulated');
    assert(ctx.fetchCalls.length === 0, 'help called fetch');
  });

  await test('A-04 simulated fallback truncates a long message to 60 chars', async () => {
    const ctx = makeAdapter();
    const long = 'This is a very long message that is definitely longer than sixty characters in total length.';
    const r = await ctx.adapter.send(long);
    const expectedSnippet = long.slice(0, 60) + '…';
    assert(r.text.indexOf(expectedSnippet) !== -1, 'fallback does not contain the 60-char snippet: ' + r.text);
    assert(r.text.indexOf(long) === -1, 'fallback contains the full untruncated message');
    const short = await ctx.adapter.send('Something ordinary');
    assert(short.text.indexOf('Something ordinary') !== -1, 'fallback does not quote a short message in full: ' + short.text);
    assert(short.text.indexOf('…') === -1, 'fallback truncated a short message');
  });

  await test('A-05 simulated send does not touch the chain id, the Worker, or the count', async () => {
    const ctx = makeAdapter();
    assert(ctx.adapter.getRemaining() === 'unknown', 'remaining is not unknown before any live reply');
    assert(ctx.adapter.isCountStale() === true, 'count is not stale before any live reply');
    await ctx.adapter.send('Hello');
    await ctx.adapter.send('What can you do?');
    assert(ctx.fetchCalls.length === 0, 'simulated sends called fetch');
    assert(ctx.adapter.getChainId() === null, 'simulated sends set a chain id');
    assert(ctx.adapter.getRemaining() === 'unknown', 'simulated sends changed the remaining count');
    assert(ctx.adapter.isCountStale() === true, 'simulated sends changed the count freshness');
    assert(!ctx.store.has(CHAIN_KEY), 'simulated sends wrote the chain key');
  });

  /* ---------- Live mode: success and chaining ---------- */
  await test('A-06 live success stores the interaction id, updates remaining, marks the count fresh', async () => {
    const ctx = makeAdapter();
    ctx.setMockFetch(() => Promise.resolve(mockJsonResponse(200, WORKER_200)));
    ctx.adapter.setMode('live');
    const r = await ctx.adapter.send('Hello');
    assert(r.text === WORKER_200.text, 'live reply text wrong: ' + r.text);
    assert(r.remaining === WORKER_200.remaining, 'remaining wrong: ' + JSON.stringify(r.remaining));
    assert(ctx.adapter.getChainId() === WORKER_200.interaction_id, 'chain id not stored');
    assert(ctx.store.get(CHAIN_KEY) === WORKER_200.interaction_id, 'chain id not persisted to storage');
    assert(ctx.adapter.getRemaining() === WORKER_200.remaining, 'getRemaining did not return the live count');
    assert(ctx.adapter.isCountStale() === false, 'count is stale after a successful live reply');
    assert(ctx.fetchCalls.length === 1, 'fetch called ' + ctx.fetchCalls.length + ' times');
    const call = ctx.fetchCalls[0];
    assert(call.url === WORKER_URL + '/chat', 'request URL wrong: ' + call.url);
    assert(call.options.method === 'POST', 'request method is not POST');
    assert(call.options.headers['Content-Type'] === 'application/json', 'request content type wrong');
    const body = JSON.parse(call.options.body);
    const topKeys = Object.keys(body).sort();
    assert(JSON.stringify(topKeys) === JSON.stringify(['messages', 'system_instruction']),
      'request body has unexpected top-level fields: ' + topKeys.join(', '));
    assert(body.messages.length === 1 && body.messages[0].role === 'user' && body.messages[0].text === 'Hello',
      'request message wrong: ' + JSON.stringify(body.messages));
    assert(typeof body.system_instruction === 'string' && body.system_instruction.length > 0, 'system instruction missing');
  });

  await test('A-07 live success without a chain id omits previous_interaction_id', async () => {
    const ctx = makeAdapter();
    ctx.setMockFetch(() => Promise.resolve(mockJsonResponse(200, WORKER_200)));
    ctx.adapter.setMode('live');
    await ctx.adapter.send('Hello');
    const body = lastFetchBody(ctx);
    assert(!('previous_interaction_id' in body), 'first request carried a chain id: ' + JSON.stringify(body));
  });

  await test('A-08 live second send chains by previous_interaction_id', async () => {
    const ctx = makeAdapter();
    let n = 0;
    const ids = ['int_first_001', 'int_second_002'];
    ctx.setMockFetch(() => Promise.resolve(mockJsonResponse(200, {
      text: 'Reply ' + (n + 1), interaction_id: ids[n++], remaining: 18
    })));
    ctx.adapter.setMode('live');
    await ctx.adapter.send('First');
    await ctx.adapter.send('Second');
    assert(ctx.fetchCalls.length === 2, 'expected 2 fetch calls, got ' + ctx.fetchCalls.length);
    const body2 = lastFetchBody(ctx);
    assert(body2.previous_interaction_id === 'int_first_001', 'second request did not chain: ' + JSON.stringify(body2));
    assert(body2.messages.length === 1 && body2.messages[0].text === 'Second', 'second request message wrong');
    assert(ctx.adapter.getChainId() === 'int_second_002', 'chain id not updated to the second id');
  });

  /* ---------- Live mode: Worker errors ---------- */
  await test('A-09 Worker error codes map to the right typed error and mark the count stale', async () => {
    const cases = [
      ['upstream_overloaded', 'Gemini is overloaded right now.'],
      ['upstream_auth_failed', 'model key was rejected'],
      ['upstream_error', 'did not return a usable reply'],
      ['daily_limit_reached', 'daily limit of 20'],
      ['bad_request', 'not valid'],
      ['proxy_not_configured', 'model key is not set']
    ];
    for (const [code, msgPart] of cases) {
      const ctx = makeAdapter();
      ctx.setMockFetch(() => Promise.resolve(mockErrorResponse(code)));
      ctx.adapter.setMode('live');
      const err = await assertRejects(ctx.adapter.send('Hello'), code, 'worker', msgPart);
      assert(err.message.indexOf('overload') === -1 || code === 'upstream_overloaded',
        'a non-overload error was presented as overload: ' + code);
      assert(ctx.adapter.isCountStale() === true, 'count is not stale after Worker error ' + code);
      assert(ctx.adapter.getChainId() === null, 'chain id changed after Worker error ' + code);
      assert(ctx.fetchCalls.length === 1, 'Worker error ' + code + ' was retried');
    }
  });

  await test('A-10 unknown Worker error code maps to upstream_error', async () => {
    const ctx = makeAdapter();
    ctx.setMockFetch(() => Promise.resolve(mockJsonResponse(502, { error: 'something_brand_new' })));
    ctx.adapter.setMode('live');
    await assertRejects(ctx.adapter.send('Hello'), 'upstream_error', 'worker', 'did not return a usable reply');
    assert(ctx.adapter.isCountStale() === true, 'count is not stale after an unknown Worker error');
  });

  await test('A-11 200 with unparseable body is upstream_bad_json; 200 with no usable text is upstream_empty_reply', async () => {
    const ctx1 = makeAdapter();
    ctx1.setMockFetch(() => Promise.resolve({
      ok: true, status: 200,
      json: async () => { throw new Error('bad json'); },
      text: async () => 'not json'
    }));
    ctx1.adapter.setMode('live');
    await assertRejects(ctx1.adapter.send('Hello'), 'upstream_bad_json', 'worker', 'could not read');
    assert(ctx1.adapter.isCountStale() === true, 'count is not stale after upstream_bad_json');

    const ctx2 = makeAdapter();
    let calls = 0;
    ctx2.setMockFetch(() => {
      calls++;
      return Promise.resolve(mockJsonResponse(200, calls === 1 ? {} : { text: '' }));
    });
    ctx2.adapter.setMode('live');
    await assertRejects(ctx2.adapter.send('Hello'), 'upstream_empty_reply', 'worker', 'no usable reply');
    await assertRejects(ctx2.adapter.send('Hello again'), 'upstream_empty_reply', 'worker', 'no usable reply');
    assert(ctx2.fetchCalls.length === 2, 'empty-reply case made ' + ctx2.fetchCalls.length + ' fetch calls');
  });

  /* ---------- Live mode: network, timeout, cancellation, concurrency ---------- */
  await test('A-12 network failure is network_error, count stale, no chain id update', async () => {
    const ctx = makeAdapter();
    ctx.setMockFetch(() => Promise.reject(new Error('network down')));
    ctx.adapter.setMode('live');
    await assertRejects(ctx.adapter.send('Hello'), 'network_error', 'network', 'Could not reach the proxy');
    assert(ctx.adapter.isCountStale() === true, 'count is not stale after a network failure');
    assert(ctx.adapter.getChainId() === null, 'chain id changed after a network failure');
    assert(ctx.fetchCalls.length === 1, 'network failure was retried');
  });

  await test('A-13 timeout is client_timeout and a late reply is discarded', async () => {
    const ctx = makeAdapter({ timeoutMs: 120 });
    let resolvedLate = false;
    ctx.setMockFetch(() => new Promise(resolve => {
      setTimeout(() => {
        resolvedLate = true;
        resolve(mockJsonResponse(200, { text: 'Too late.', interaction_id: 'int_late_001', remaining: 5 }));
      }, 400);
    }));
    ctx.adapter.setMode('live');
    await assertRejects(ctx.adapter.send('Hello'), 'client_timeout', 'timeout', 'took too long');
    assert(ctx.adapter.isCountStale() === true, 'count is not stale after a timeout');
    assert(ctx.adapter.getChainId() === null, 'chain id changed after a timeout');
    assert(ctx.adapter.getRemaining() === 'unknown', 'remaining changed after a timeout');
    await sleep(500);
    assert(resolvedLate, 'the mock fetch never resolved late');
    assert(ctx.adapter.getChainId() === null, 'a late reply stored a chain id after the timeout');
    assert(ctx.adapter.getRemaining() === 'unknown', 'a late reply changed the remaining count after the timeout');
  });

  await test('A-14 clear() during a pending live send cancels it, drops the chain id, marks the count stale', async () => {
    const ctx = makeAdapter();
    ctx.setMockFetch(() => Promise.resolve(mockJsonResponse(200, WORKER_200)));
    ctx.adapter.setMode('live');
    await ctx.adapter.send('First');
    assert(ctx.adapter.getChainId() === WORKER_200.interaction_id, 'first live exchange did not set a chain id');
    assert(ctx.adapter.isCountStale() === false, 'count is not fresh after the first live reply');
    /* Second send, resolving late; clear it while it is in flight. */
    let lateResolved = false;
    ctx.setMockFetch(() => new Promise(resolve => {
      setTimeout(() => {
        lateResolved = true;
        resolve(mockJsonResponse(200, { text: 'Too late.', interaction_id: 'int_late_002', remaining: 3 }));
      }, 400);
    }));
    const pending = ctx.adapter.send('Second message');
    await sleep(50);
    ctx.adapter.clear();
    const err = await assertRejects(pending, 'cancelled', 'cancelled');
    assert(err.message === null, 'cancellation error message is not null: ' + JSON.stringify(err.message));
    assert(ctx.adapter.getChainId() === null, 'chain id survived the clear');
    assert(!ctx.store.has(CHAIN_KEY), 'chain key survived the clear');
    assert(ctx.adapter.isCountStale() === true, 'count is not stale after the cancellation');
    await sleep(500);
    assert(lateResolved, 'the mock fetch never resolved late');
    assert(ctx.adapter.getChainId() === null, 'a late reply restored the chain id after the clear');
    assert(!ctx.store.has(CHAIN_KEY), 'a late reply restored the chain key after the clear');
    assert(ctx.adapter.getRemaining() === WORKER_200.remaining, 'the late reply changed the remaining count');
  });

  await test('A-15 concurrent send rejects with busy and the first send still completes', async () => {
    const ctx = makeAdapter();
    ctx.setMockFetch(() => new Promise(resolve => {
      setTimeout(() => resolve(mockJsonResponse(200, WORKER_200)), 200);
    }));
    ctx.adapter.setMode('live');
    const first = ctx.adapter.send('Hello');
    const second = ctx.adapter.send('Hello again');
    await assertRejects(second, 'busy', 'concurrent', 'already in progress');
    assert(ctx.fetchCalls.length === 1, 'the concurrent send made a second fetch call');
    const r = await first;
    assert(r.text === WORKER_200.text, 'the first send did not complete normally');
    assert(ctx.adapter.getChainId() === WORKER_200.interaction_id, 'the first send did not store its chain id');
    /* After the first send completes, a new send works. */
    ctx.setMockFetch(() => Promise.resolve(mockJsonResponse(200, { text: 'Third reply.', interaction_id: 'int_third_003', remaining: 17 })));
    const third = await ctx.adapter.send('Third');
    assert(third.text === 'Third reply.', 'a send after completion did not work');
    assert(ctx.fetchCalls.length === 2, 'expected 2 fetch calls total, got ' + ctx.fetchCalls.length);
  });

  await test('A-16 mode switching does not abort an in-flight send; a later send uses the new mode', async () => {
    const ctx = makeAdapter();
    assert(ctx.adapter.getMode() === 'simulated', 'mode does not default to simulated on construction');
    ctx.setMockFetch(() => new Promise(resolve => {
      setTimeout(() => resolve(mockJsonResponse(200, WORKER_200)), 200);
    }));
    const mode1 = ctx.adapter.setMode('live');
    assert(mode1 === 'live' && ctx.adapter.getMode() === 'live', 'setMode did not return or set live');
    const pending = ctx.adapter.send('Hello');
    await sleep(50);
    const mode2 = ctx.adapter.setMode('simulated');
    assert(mode2 === 'simulated', 'setMode did not return simulated');
    const r = await pending;
    assert(r.text === WORKER_200.text, 'the in-flight live send was aborted by the mode switch');
    assert(r.remaining === WORKER_200.remaining, 'the in-flight live reply lost its remaining count');
    assert(ctx.adapter.getChainId() === WORKER_200.interaction_id, 'the in-flight live send did not store its chain id');
    /* The next send uses the new (simulated) mode: no fetch, scripted reply. */
    const fetchBefore = ctx.fetchCalls.length;
    const sim = await ctx.adapter.send('Who are you?');
    assert(sim.remaining === 'unknown', 'the post-switch send was not simulated');
    assert(sim.text.indexOf(IDENTITY.display_name) !== -1, 'the post-switch send did not return the simulated identity reply');
    assert(ctx.fetchCalls.length === fetchBefore, 'the post-switch simulated send called fetch');
  });

  /* ---------- Count freshness, storage isolation, input validation ---------- */
  await test('A-17 isCountStale is true before any live reply, false after success, true after an error', async () => {
    const ctx = makeAdapter();
    assert(ctx.adapter.isCountStale() === true, 'count is not stale before any live reply');
    ctx.setMockFetch(() => Promise.resolve(mockJsonResponse(200, WORKER_200)));
    ctx.adapter.setMode('live');
    await ctx.adapter.send('Hello');
    assert(ctx.adapter.isCountStale() === false, 'count is stale after a successful live reply');
    ctx.setMockFetch(() => Promise.resolve(mockErrorResponse('upstream_overloaded')));
    await assertRejects(ctx.adapter.send('Hello again'), 'upstream_overloaded', 'worker');
    assert(ctx.adapter.isCountStale() === true, 'count is not stale after an error');
    /* A successful live reply after an error makes it fresh again. */
    ctx.setMockFetch(() => Promise.resolve(mockJsonResponse(200, { text: 'Recovered.', interaction_id: 'int_rec_004', remaining: 8 })));
    await ctx.adapter.send('Hello once more');
    assert(ctx.adapter.isCountStale() === false, 'count is not fresh after the recovery reply');
    assert(ctx.adapter.getRemaining() === 8, 'remaining did not update to the recovery reply count');
  });

  await test('A-18 the adapter touches only its own chain key, never the Alpha 0.1 keys', async () => {
    const ctx = makeAdapter();
    ctx.setMockFetch(() => Promise.resolve(mockJsonResponse(200, WORKER_200)));
    ctx.adapter.setMode('live');
    await ctx.adapter.send('Hello');
    await ctx.adapter.send('Second');
    ctx.adapter.clear();
    await ctx.adapter.send('Hello in simulated');
    assert(ctx.keysTouched.size === 1 && ctx.keysTouched.has(CHAIN_KEY),
      'keys touched: ' + [...ctx.keysTouched].join(', '));
    assert(!ctx.keysTouched.has(OLD_CHAIN_KEY), 'the adapter touched the Alpha 0.1 chain key');
    assert(!ctx.keysTouched.has(OLD_HISTORY_KEY), 'the adapter touched the Alpha 0.1 history key');
    assert(!ctx.store.has(OLD_CHAIN_KEY) && !ctx.store.has(OLD_HISTORY_KEY), 'an Alpha 0.1 key is present in storage');
  });

  await test('A-19 empty and overlong text reject with bad_request and do not call fetch', async () => {
    const ctx = makeAdapter();
    ctx.adapter.setMode('live');
    await assertRejects(ctx.adapter.send(''), 'bad_request', 'worker', 'not valid');
    await assertRejects(ctx.adapter.send('   '), 'bad_request', 'worker', 'not valid');
    await assertRejects(ctx.adapter.send('x'.repeat(2001)), 'bad_request', 'worker', 'not valid');
    assert(ctx.fetchCalls.length === 0, 'an invalid send called fetch ' + ctx.fetchCalls.length + ' times');
    /* A 2000-char message is accepted. */
    ctx.setMockFetch(() => Promise.resolve(mockJsonResponse(200, WORKER_200)));
    const r = await ctx.adapter.send('y'.repeat(2000));
    assert(r.text === WORKER_200.text, 'a 2000-char message was not accepted');
    assert(ctx.fetchCalls.length === 1, 'the 2000-char message did not call fetch');
  });

  await test('A-20 the adapter source contains no secret and only the Worker URL', async () => {
    for (const pat of ['sk-', 'AIza', 'Bearer', 'apikey', 'api-key', 'MODEL_API_KEY', 'password', 'secret_text']) {
      assert(!ADAPTER_SRC.includes(pat), 'adapter source contains forbidden string: ' + pat);
    }
    const urls = ADAPTER_SRC.match(/https?:\/\/[^\s"'<]+/g) || [];
    assert(urls.length === 1, 'expected exactly one URL in the adapter source, found ' + urls.length + ': ' + urls.join(', '));
    assert(urls[0] === WORKER_URL, 'the only URL is not the configured Worker URL: ' + urls[0]);
    /* The source never sends an authorization header: there is no
       header object other than Content-Type. */
    assert(!/Authorization/i.test(ADAPTER_SRC), 'adapter source mentions an Authorization header');
    assert((ADAPTER_SRC.match(/Content-Type/g) || []).length >= 1, 'adapter does not set a Content-Type header');
  });

  await test('A-21 clear() with no in-flight request leaves the count freshness unchanged', async () => {
    const ctx = makeAdapter();
    assert(ctx.adapter.isCountStale() === true, 'count is not stale before any live reply');
    ctx.adapter.clear();
    assert(ctx.adapter.isCountStale() === true, 'clear() with no in-flight request changed the freshness');
    ctx.setMockFetch(() => Promise.resolve(mockJsonResponse(200, WORKER_200)));
    ctx.adapter.setMode('live');
    await ctx.adapter.send('Hello');
    assert(ctx.adapter.isCountStale() === false, 'count is not fresh after a live reply');
    ctx.adapter.clear();
    assert(ctx.adapter.isCountStale() === false, 'clear() with no in-flight request changed a fresh count');
    assert(ctx.adapter.getChainId() === null, 'clear() did not drop the chain id');
  });

  await test('A-22 an invalid stored chain id is dropped and treated as null', async () => {
    const ctx = makeAdapter({ seed: { [CHAIN_KEY]: 'not a valid id!!!' } });
    assert(ctx.adapter.getChainId() === null, 'an invalid stored chain id was not treated as null');
    assert(!ctx.store.has(CHAIN_KEY), 'an invalid stored chain id was not dropped from storage');
    /* The next live request starts a fresh chain (no previous_interaction_id). */
    ctx.setMockFetch(() => Promise.resolve(mockJsonResponse(200, WORKER_200)));
    ctx.adapter.setMode('live');
    await ctx.adapter.send('Hello');
    const body = lastFetchBody(ctx);
    assert(!('previous_interaction_id' in body), 'the request carried the invalid chain id');
    assert(ctx.adapter.getChainId() === WORKER_200.interaction_id, 'the fresh chain id was not stored');
  });

  await test('A-23 the system instruction is built from the fixture identity at request time', async () => {
    const ctx = makeAdapter();
    ctx.setMockFetch(() => Promise.resolve(mockJsonResponse(200, WORKER_200)));
    ctx.adapter.setMode('live');
    await ctx.adapter.send('Hello');
    const body = lastFetchBody(ctx);
    const si = body.system_instruction;
    assert(si.indexOf(IDENTITY.display_name) !== -1, 'system instruction lacks the fixture display name');
    assert(si.indexOf(IDENTITY.full_name) !== -1, 'system instruction lacks the fixture full name');
    assert(si.indexOf(IDENTITY.purpose) !== -1, 'system instruction lacks the fixture purpose');
    assert(si.indexOf(IDENTITY.personality) !== -1, 'system instruction lacks the fixture personality');
    assert(si.indexOf(IDENTITY.principles[0]) !== -1, 'system instruction lacks the fixture principles');
    assert(si.indexOf(IDENTITY.boundaries[0]) !== -1, 'system instruction lacks the fixture boundaries');
    assert(si.indexOf(IDENTITY.traits[0]) !== -1, 'system instruction lacks the fixture traits');
    assert(si.length <= 4000, 'system instruction is over the 4000-char Worker limit: ' + si.length);
    assert(!/Tarell/i.test(si), 'system instruction names a real person');
    assert(!/@/.test(si), 'system instruction contains an address');
    /* The upstream fixture shape is reference-only: the adapter never
       parses it, and the request body never contains upstream fields. */
    assert(!('steps' in body) && !('id' in body), 'request body carries upstream shape fields');
    assert(UPSTREAM_SHAPES.steps[0].type === 'model_output', 'upstream fixture shape is not the documented shape');
  });

  await test('A-24 getRemaining is unknown before any live reply and the live count after one', async () => {
    const ctx = makeAdapter();
    assert(ctx.adapter.getRemaining() === 'unknown', 'getRemaining is not unknown before any live reply');
    ctx.setMockFetch(() => Promise.resolve(mockJsonResponse(200, WORKER_200)));
    ctx.adapter.setMode('live');
    await ctx.adapter.send('Hello');
    assert(ctx.adapter.getRemaining() === WORKER_200.remaining, 'getRemaining did not return the live count');
    /* A simulated send after a live success leaves the count alone. */
    ctx.adapter.setMode('simulated');
    await ctx.adapter.send('Hello');
    assert(ctx.adapter.getRemaining() === WORKER_200.remaining, 'a simulated send changed the remaining count');
    assert(ctx.adapter.getChainId() === WORKER_200.interaction_id, 'a simulated send changed the chain id');
  });

  await test('A-25 setMode returns the new mode and rejects an invalid mode', async () => {
    const ctx = makeAdapter();
    assert(ctx.adapter.setMode('live') === 'live', 'setMode did not return live');
    assert(ctx.adapter.getMode() === 'live', 'getMode did not return live');
    assert(ctx.adapter.setMode('simulated') === 'simulated', 'setMode did not return simulated');
    let threw = false;
    try { ctx.adapter.setMode('bogus'); } catch (e) { threw = true; assert(e && e.name === 'TypeError', 'invalid mode did not throw a TypeError (got ' + (e && e.name) + ')'); }
    assert(threw, 'setMode accepted an invalid mode');
    assert(ctx.adapter.getMode() === 'simulated', 'an invalid setMode changed the mode');
  });

  await test('A-26 a simulated send after a live success leaves the chain id and count intact', async () => {
    const ctx = makeAdapter();
    ctx.setMockFetch(() => Promise.resolve(mockJsonResponse(200, WORKER_200)));
    ctx.adapter.setMode('live');
    await ctx.adapter.send('Hello');
    ctx.adapter.setMode('simulated');
    const r = await ctx.adapter.send('Who are you?');
    assert(r.text.indexOf(IDENTITY.display_name) !== -1, 'the simulated reply after a live success is wrong');
    assert(r.remaining === 'unknown', 'the simulated reply carried a live remaining count');
    assert(ctx.adapter.getChainId() === WORKER_200.interaction_id, 'the simulated send changed the chain id');
    assert(ctx.adapter.getRemaining() === WORKER_200.remaining, 'the simulated send changed the remaining count');
    assert(ctx.adapter.isCountStale() === false, 'the simulated send changed the count freshness');
    assert(ctx.fetchCalls.length === 1, 'the simulated send called fetch');
  });

  /* ---------- Correction 1: UTC daily-reset count freshness ---------- */
  await test('A-27 UTC day rollover makes the count stale and getRemaining returns unknown', async () => {
    let current = new Date('2026-11-25T10:00:00Z');
    const ctx = makeAdapter({ nowImpl: function () { return current; } });
    ctx.setMockFetch(() => Promise.resolve(mockJsonResponse(200, WORKER_200)));
    ctx.adapter.setMode('live');
    await ctx.adapter.send('Hello');
    assert(ctx.adapter.getRemaining() === WORKER_200.remaining, 'count not set after the live reply');
    assert(ctx.adapter.isCountStale() === false, 'count is stale on the same UTC day');
    /* Same UTC day, late evening: still fresh. */
    current = new Date('2026-11-25T23:59:59Z');
    assert(ctx.adapter.getRemaining() === WORKER_200.remaining, 'count expired within the same UTC day');
    assert(ctx.adapter.isCountStale() === false, 'count went stale within the same UTC day');
    /* Next UTC day: the old count belongs to a day whose cap has reset. */
    current = new Date('2026-11-26T00:00:01Z');
    assert(ctx.adapter.getRemaining() === 'unknown', 'a previous-UTC-day count is still shown: ' + JSON.stringify(ctx.adapter.getRemaining()));
    assert(ctx.adapter.isCountStale() === true, 'a previous-UTC-day count is not stale');
    /* A new live reply on the new day restores a fresh count. */
    ctx.setMockFetch(() => Promise.resolve(mockJsonResponse(200, { text: 'New day.', interaction_id: 'int_newday_005', remaining: 20 })));
    const r = await ctx.adapter.send('Hello on the new day');
    assert(r.remaining === 20, 'the new-day reply did not return its count');
    assert(ctx.adapter.getRemaining() === 20, 'getRemaining did not return the new-day count');
    assert(ctx.adapter.isCountStale() === false, 'the new-day count is stale');
    assert(ctx.adapter.getChainId() === 'int_newday_005', 'the new-day reply did not store its chain id');
  });

  await test('A-28 the count expires exactly at midnight UTC, not before', async () => {
    let current = new Date('2026-11-25T23:59:59Z');
    const ctx = makeAdapter({ nowImpl: function () { return current; } });
    ctx.setMockFetch(() => Promise.resolve(mockJsonResponse(200, WORKER_200)));
    ctx.adapter.setMode('live');
    await ctx.adapter.send('Hello');
    assert(ctx.adapter.getRemaining() === WORKER_200.remaining, 'count not set');
    assert(ctx.adapter.isCountStale() === false, 'count is stale before midnight');
    current = new Date('2026-11-26T00:00:00Z');
    assert(ctx.adapter.getRemaining() === 'unknown', 'the count survived midnight UTC');
    assert(ctx.adapter.isCountStale() === true, 'the count is not stale at midnight UTC');
    /* The count is in-memory only: no new storage key was introduced. */
    assert(ctx.keysTouched.size === 1 && ctx.keysTouched.has(CHAIN_KEY),
      'the count was persisted to storage (keys touched: ' + [...ctx.keysTouched].join(', ') + ')');
  });

  /* ---------- Correction 2: client timeout covers response-body parsing ---------- */
  await test('A-29 a hung response-body parse is cut off by the client timeout and the late parse is discarded', async () => {
    const ctx = makeAdapter({ timeoutMs: 120 });
    let parseResolved = false;
    ctx.setMockFetch(() => Promise.resolve({
      ok: true, status: 200,
      json: () => new Promise(resolve => {
        setTimeout(() => {
          parseResolved = true;
          resolve({ text: 'Too late.', interaction_id: 'int_lateparse_006', remaining: 4 });
        }, 400);
      }),
      text: async () => 'unused'
    }));
    ctx.adapter.setMode('live');
    await assertRejects(ctx.adapter.send('Hello'), 'client_timeout', 'timeout', 'took too long');
    assert(ctx.adapter.isCountStale() === true, 'count is not stale after the parse timeout');
    assert(ctx.adapter.getChainId() === null, 'chain id changed after the parse timeout');
    assert(ctx.adapter.getRemaining() === 'unknown', 'remaining changed after the parse timeout');
    await sleep(500);
    assert(parseResolved, 'the mock .json() never resolved late');
    assert(ctx.adapter.getChainId() === null, 'a late parse result stored a chain id');
    assert(ctx.adapter.getRemaining() === 'unknown', 'a late parse result changed the remaining count');
    assert(!ctx.store.has(CHAIN_KEY), 'a late parse result wrote the chain key');
  });

  await test('A-30 a slow-but-within-timeout response-body parse still succeeds', async () => {
    const ctx = makeAdapter({ timeoutMs: 500 });
    ctx.setMockFetch(() => Promise.resolve({
      ok: true, status: 200,
      json: () => new Promise(resolve => {
        setTimeout(() => resolve({ text: 'Slow but in time.', interaction_id: 'int_slowparse_007', remaining: 11 }), 200);
      }),
      text: async () => 'unused'
    }));
    ctx.adapter.setMode('live');
    const r = await ctx.adapter.send('Hello');
    assert(r.text === 'Slow but in time.', 'the slow parse did not return its reply');
    assert(r.remaining === 11, 'the slow parse did not return its remaining count');
    assert(ctx.adapter.getChainId() === 'int_slowparse_007', 'the slow parse did not store its chain id');
    assert(ctx.adapter.getRemaining() === 11, 'getRemaining did not return the slow-parse count');
    assert(ctx.adapter.isCountStale() === false, 'the slow-parse count is stale');
  });

  /* ---------- Correction 3: generation-isolated timers ---------- */
  await test('A-31 a cancelled live send cannot clear a newer send timeout timer', async () => {
    const ctx = makeAdapter({ timeoutMs: 200 });
    /* Gen 1: fetch resolves at ~120 ms. Gen 2: fetch resolves at ~450 ms. */
    let call = 0;
    ctx.setMockFetch(() => {
      call++;
      if (call === 1) {
        return new Promise(resolve => {
          setTimeout(() => resolve(mockJsonResponse(200, { text: 'Gen 1 late.', interaction_id: 'int_gen1_008', remaining: 9 })), 120);
        });
      }
      return new Promise(resolve => {
        setTimeout(() => resolve(mockJsonResponse(200, { text: 'Gen 2 late.', interaction_id: 'int_gen2_009', remaining: 7 })), 400);
      });
    });
    ctx.adapter.setMode('live');
    const first = ctx.adapter.send('First');
    await sleep(50);
    ctx.adapter.clear();
    await assertRejects(first, 'cancelled', 'cancelled');
    assert(ctx.adapter.getChainId() === null, 'the clear did not drop the chain id');
    /* Gen 2 starts now (~50 ms in). Its timeout fires at ~250 ms; gen 1's
       race handler runs at ~120 ms, while gen 2's timer is still pending.
       If that handler cleared gen 2's timer, gen 2 would never time out. */
    const second = ctx.adapter.send('Second');
    /* Guard so the test fails fast (rather than hanging) if gen 2's timer
       was cleared and it never times out. */
    const guard = sleep(600).then(() => { throw new Error('gen 2 did not time out — its timer was cleared by gen 1'); });
    let secondErr = null;
    try { await Promise.race([second, guard]); } catch (e) { secondErr = e; }
    assert(secondErr !== null, 'gen 2 resolved, expected a client_timeout rejection');
    assert(secondErr.code === 'client_timeout',
      'gen 2 error is ' + JSON.stringify(secondErr && secondErr.code) + ' (' + (secondErr && secondErr.message) + '), expected client_timeout');
    assert(ctx.adapter.isCountStale() === true, 'count is not stale after gen 2 timed out');
    /* Let both late fetches resolve; neither late reply may be applied. */
    await sleep(500);
    assert(ctx.adapter.getChainId() === null, 'a late reply stored a chain id');
    assert(ctx.adapter.getRemaining() === 'unknown', 'a late reply changed the remaining count');
    assert(!ctx.store.has(CHAIN_KEY), 'a late reply wrote the chain key');
  });

  await test('A-32 a cancelled simulated send cannot interfere with a newer live send timeout', async () => {
    const ctx = makeAdapter({ timeoutMs: 200, simulatedDelayMs: 400 });
    /* Gen 1: simulated send, reply due at ~400 ms. */
    const first = ctx.adapter.send('Hello');
    await sleep(50);
    ctx.adapter.clear();
    await assertRejects(first, 'cancelled', 'cancelled');
    /* Gen 2: live send, fetch resolves slowly (~450 ms). Its timeout
       fires at ~250 ms. Gen 1's simulated timer (due ~400 ms) must not
       interfere with it. */
    ctx.setMockFetch(() => new Promise(resolve => {
      setTimeout(() => resolve(mockJsonResponse(200, { text: 'Gen 2 late.', interaction_id: 'int_gen2b_010', remaining: 6 })), 400);
    }));
    ctx.adapter.setMode('live');
    const second = ctx.adapter.send('Second');
    const guard = sleep(600).then(() => { throw new Error('gen 2 did not time out — gen 1 simulated timer interfered'); });
    let secondErr = null;
    try { await Promise.race([second, guard]); } catch (e) { secondErr = e; }
    assert(secondErr !== null, 'gen 2 resolved, expected a client_timeout rejection');
    assert(secondErr.code === 'client_timeout',
      'gen 2 error is ' + JSON.stringify(secondErr && secondErr.code) + ' (' + (secondErr && secondErr.message) + '), expected client_timeout');
    await sleep(500);
    assert(ctx.adapter.getChainId() === null, 'a late reply stored a chain id');
    assert(ctx.adapter.getRemaining() === 'unknown', 'a late reply changed the remaining count');
  });

  /* ---------- Correction 4: spanning-midnight quota invalidation ---------- */
  await test('A-33 a live reply arriving after midnight UTC invalidates the count but keeps the reply and chain id', async () => {
    let current = new Date('2026-11-25T23:59:50Z');
    const ctx = makeAdapter({ nowImpl: function () { return current; }, timeoutMs: 5000 });
    let resolveFetch = null;
    ctx.setMockFetch(() => new Promise(resolve => {
      resolveFetch = function () {
        resolve(mockJsonResponse(200, { text: 'Reply after midnight.', interaction_id: 'int_span_011', remaining: 19 }));
      };
    }));
    ctx.adapter.setMode('live');
    const p = ctx.adapter.send('Hello');
    assert(ctx.fetchCalls.length === 1, 'the send did not call fetch');
    assert(typeof resolveFetch === 'function', 'the mock fetch did not capture its resolver');
    /* The reply arrives after midnight UTC: the count in it belongs to
       the old day and must not be treated as fresh. */
    current = new Date('2026-11-26T00:00:05Z');
    resolveFetch();
    const r = await p;
    assert(r.text === 'Reply after midnight.', 'the spanning reply text was not returned');
    assert(r.remaining === 'unknown', 'the spanning reply resolved with a count: ' + JSON.stringify(r.remaining));
    assert(ctx.adapter.getChainId() === 'int_span_011', 'the spanning reply did not store its chain id');
    assert(ctx.store.get(CHAIN_KEY) === 'int_span_011', 'the spanning reply did not persist its chain id');
    assert(ctx.adapter.getRemaining() === 'unknown', 'getRemaining is not unknown after the spanning reply');
    assert(ctx.adapter.isCountStale() === true, 'the count is not stale after the spanning reply');
  });

  await test('A-34 a live reply arriving the same UTC day applies its count fresh (control)', async () => {
    let current = new Date('2026-11-25T12:00:00Z');
    const ctx = makeAdapter({ nowImpl: function () { return current; }, timeoutMs: 5000 });
    ctx.setMockFetch(() => Promise.resolve(mockJsonResponse(200, { text: 'Same day.', interaction_id: 'int_same_012', remaining: 17 })));
    ctx.adapter.setMode('live');
    const r = await ctx.adapter.send('Hello');
    assert(r.remaining === 17, 'the same-day reply did not return its count: ' + JSON.stringify(r.remaining));
    assert(ctx.adapter.getRemaining() === 17, 'getRemaining did not return the same-day count');
    assert(ctx.adapter.isCountStale() === false, 'the same-day count is stale');
    assert(ctx.adapter.getChainId() === 'int_same_012', 'the same-day reply did not store its chain id');
  });

  await test('A-35 a send starting before midnight and replying before midnight applies its count fresh (control)', async () => {
    let current = new Date('2026-11-25T23:59:50Z');
    const ctx = makeAdapter({ nowImpl: function () { return current; }, timeoutMs: 5000 });
    let resolveFetch = null;
    ctx.setMockFetch(() => new Promise(resolve => {
      resolveFetch = function () {
        resolve(mockJsonResponse(200, { text: 'Before midnight.', interaction_id: 'int_before_013', remaining: 18 }));
      };
    }));
    ctx.adapter.setMode('live');
    const p = ctx.adapter.send('Hello');
    assert(typeof resolveFetch === 'function', 'the mock fetch did not capture its resolver');
    /* The reply arrives before midnight UTC: same day as the send. */
    current = new Date('2026-11-25T23:59:55Z');
    resolveFetch();
    const r = await p;
    assert(r.remaining === 18, 'the before-midnight reply did not return its count: ' + JSON.stringify(r.remaining));
    assert(ctx.adapter.getRemaining() === 18, 'getRemaining did not return the before-midnight count');
    assert(ctx.adapter.isCountStale() === false, 'the before-midnight count is stale');
    assert(ctx.adapter.getChainId() === 'int_before_013', 'the before-midnight reply did not store its chain id');
  });

  /* ---------- Correction 5: remaining must be an integer in [0, 20] ---------- */
  await test('A-36 a fractional remaining count (20.5) is treated as no authoritative count', async () => {
    const ctx = makeAdapter({ timeoutMs: 5000 });
    ctx.setMockFetch(() => Promise.resolve(mockJsonResponse(200, { text: 'Fractional.', interaction_id: 'int_frac_014', remaining: 20.5 })));
    ctx.adapter.setMode('live');
    const r = await ctx.adapter.send('Hello');
    assert(r.text === 'Fractional.', 'the fractional-count reply text was not returned');
    assert(r.remaining === 'unknown', 'a fractional count was applied: ' + JSON.stringify(r.remaining));
    assert(ctx.adapter.getChainId() === 'int_frac_014', 'the fractional-count reply did not store its chain id');
    assert(ctx.adapter.getRemaining() === 'unknown', 'getRemaining is not unknown after a fractional count');
    assert(ctx.adapter.isCountStale() === true, 'a fractional count is not stale');
  });

  await test('A-37 out-of-range remaining counts (-1, 21) keep the previous value and mark the count stale', async () => {
    const ctx = makeAdapter({ timeoutMs: 5000 });
    ctx.setMockFetch(() => Promise.resolve(mockJsonResponse(200, { text: 'Valid.', interaction_id: 'int_valid_015', remaining: 15 })));
    ctx.adapter.setMode('live');
    const first = await ctx.adapter.send('Hello');
    assert(first.remaining === 15, 'the valid reply did not return its count');
    assert(ctx.adapter.isCountStale() === false, 'the valid count is stale');
    /* -1: below the range. The reply and chain id are applied; the
       previous count (15) is kept and marked stale. */
    ctx.setMockFetch(() => Promise.resolve(mockJsonResponse(200, { text: 'Negative.', interaction_id: 'int_neg_016', remaining: -1 })));
    const neg = await ctx.adapter.send('Hello again');
    assert(neg.text === 'Negative.', 'the negative-count reply text was not returned');
    assert(neg.remaining === 15, 'a negative count replaced the previous value: ' + JSON.stringify(neg.remaining));
    assert(ctx.adapter.getChainId() === 'int_neg_016', 'the negative-count reply did not store its chain id');
    assert(ctx.adapter.getRemaining() === 15, 'getRemaining did not keep the previous value after a negative count');
    assert(ctx.adapter.isCountStale() === true, 'a negative count is not stale');
    /* 21: above the cap. Same handling. */
    ctx.setMockFetch(() => Promise.resolve(mockJsonResponse(200, { text: 'Over cap.', interaction_id: 'int_over_017', remaining: 21 })));
    const over = await ctx.adapter.send('Hello once more');
    assert(over.remaining === 15, 'an over-cap count replaced the previous value: ' + JSON.stringify(over.remaining));
    assert(ctx.adapter.getChainId() === 'int_over_017', 'the over-cap reply did not store its chain id');
    assert(ctx.adapter.getRemaining() === 15, 'getRemaining did not keep the previous value after an over-cap count');
    assert(ctx.adapter.isCountStale() === true, 'an over-cap count is not stale');
  });

  await test('A-38 a string remaining count ("5") is treated as no authoritative count', async () => {
    const ctx = makeAdapter({ timeoutMs: 5000 });
    ctx.setMockFetch(() => Promise.resolve(mockJsonResponse(200, { text: 'String count.', interaction_id: 'int_str_018', remaining: '5' })));
    ctx.adapter.setMode('live');
    const r = await ctx.adapter.send('Hello');
    assert(r.text === 'String count.', 'the string-count reply text was not returned');
    assert(r.remaining === 'unknown', 'a string count was applied: ' + JSON.stringify(r.remaining));
    assert(ctx.adapter.getChainId() === 'int_str_018', 'the string-count reply did not store its chain id');
    assert(ctx.adapter.getRemaining() === 'unknown', 'getRemaining is not unknown after a string count');
    assert(ctx.adapter.isCountStale() === true, 'a string count is not stale');
  });

  await test('A-39 the boundary counts 0 and 20 are valid, fresh, and applied', async () => {
    const ctx = makeAdapter({ timeoutMs: 5000 });
    ctx.setMockFetch(() => Promise.resolve(mockJsonResponse(200, { text: 'Zero left.', interaction_id: 'int_zero_019', remaining: 0 })));
    ctx.adapter.setMode('live');
    const zero = await ctx.adapter.send('Hello');
    assert(zero.remaining === 0, 'a remaining count of 0 was not applied: ' + JSON.stringify(zero.remaining));
    assert(ctx.adapter.getRemaining() === 0, 'getRemaining did not return 0');
    assert(ctx.adapter.isCountStale() === false, 'a remaining count of 0 is stale');
    assert(ctx.adapter.getChainId() === 'int_zero_019', 'the zero-count reply did not store its chain id');
    ctx.setMockFetch(() => Promise.resolve(mockJsonResponse(200, { text: 'Full cap.', interaction_id: 'int_full_020', remaining: 20 })));
    const full = await ctx.adapter.send('Hello again');
    assert(full.remaining === 20, 'a remaining count of 20 was not applied: ' + JSON.stringify(full.remaining));
    assert(ctx.adapter.getRemaining() === 20, 'getRemaining did not return 20');
    assert(ctx.adapter.isCountStale() === false, 'a remaining count of 20 is stale');
    assert(ctx.adapter.getChainId() === 'int_full_020', 'the full-cap reply did not store its chain id');
  });

  /* ---------- Correction 6: abort-induced parse failure is a timeout, not upstream_bad_json ---------- */
  await test('A-40 a parse failure caused by the timeout abort settles as client_timeout, not upstream_bad_json', async () => {
    const ctx = makeAdapter({ timeoutMs: 120 });
    let abortFired = false;
    ctx.setMockFetch((url, options) => {
      /* The .json() promise rejects with an AbortError when the request
         is aborted (the client timeout aborts the controller at 120 ms). */
      let onAbort = null;
      const jsonPromise = new Promise((resolve, reject) => {
        onAbort = function () {
          abortFired = true;
          const e = new Error('The operation was aborted.');
          e.name = 'AbortError';
          reject(e);
        };
      });
      if (options && options.signal) {
        if (options.signal.aborted) { onAbort(); }
        else { options.signal.addEventListener('abort', onAbort); }
      }
      return Promise.resolve({
        ok: true, status: 200,
        json: function () { return jsonPromise; },
        text: async function () { return 'unused'; }
      });
    });
    ctx.adapter.setMode('live');
    await assertRejects(ctx.adapter.send('Hello'), 'client_timeout', 'timeout', 'took too long');
    assert(abortFired, 'the abort was never delivered to the mock body reader (the AbortError path was not exercised)');
    assert(ctx.adapter.isCountStale() === true, 'count is not stale after the abort-induced parse failure');
    assert(ctx.adapter.getChainId() === null, 'chain id changed after the abort-induced parse failure');
    assert(ctx.adapter.getRemaining() === 'unknown', 'remaining changed after the abort-induced parse failure');
    assert(!ctx.store.has(CHAIN_KEY), 'the abort-induced parse failure wrote the chain key');
  });

  await test('A-41 genuine malformed JSON (SyntaxError, no abort) is still upstream_bad_json', async () => {
    const ctx = makeAdapter({ timeoutMs: 5000 });
    ctx.setMockFetch(() => Promise.resolve({
      ok: true, status: 200,
      json: async function () { const e = new SyntaxError('Unexpected token'); throw e; },
      text: async function () { return 'not json'; }
    }));
    ctx.adapter.setMode('live');
    await assertRejects(ctx.adapter.send('Hello'), 'upstream_bad_json', 'worker', 'could not read');
    assert(ctx.adapter.isCountStale() === true, 'count is not stale after genuine malformed JSON');
    assert(ctx.adapter.getChainId() === null, 'chain id changed after genuine malformed JSON');
    assert(ctx.adapter.getRemaining() === 'unknown', 'remaining changed after genuine malformed JSON');
  });

  await test('A-42 a timed-out send whose parse later fails does not affect a newer send', async () => {
    const ctx = makeAdapter({ timeoutMs: 120 });
    let call = 0;
    ctx.setMockFetch((url, options) => {
      call++;
      if (call === 1) {
        /* Gen 1: .json() rejects with AbortError when aborted (timeout at 120 ms). */
        let onAbort = null;
        const jsonPromise = new Promise((resolve, reject) => {
          onAbort = function () {
            const e = new Error('The operation was aborted.');
            e.name = 'AbortError';
            reject(e);
          };
        });
        if (options && options.signal) {
          if (options.signal.aborted) { onAbort(); }
          else { options.signal.addEventListener('abort', onAbort); }
        }
        return Promise.resolve({
          ok: true, status: 200,
          json: function () { return jsonPromise; },
          text: async function () { return 'unused'; }
        });
      }
      /* Gen 2: a normal success. */
      return Promise.resolve(mockJsonResponse(200, { text: 'Gen 2 reply.', interaction_id: 'int_gen2_021', remaining: 14 }));
    });
    ctx.adapter.setMode('live');
    const first = ctx.adapter.send('First');
    await assertRejects(first, 'client_timeout', 'timeout', 'took too long');
    assert(ctx.adapter.getChainId() === null, 'gen 1 left a chain id after timing out');
    /* Gen 2 starts after gen 1 timed out. It completes on its own terms. */
    const r = await ctx.adapter.send('Second');
    assert(r.text === 'Gen 2 reply.', 'gen 2 did not complete normally after gen 1 timed out');
    assert(r.remaining === 14, 'gen 2 did not return its remaining count');
    assert(ctx.adapter.getChainId() === 'int_gen2_021', 'gen 2 did not store its chain id');
    assert(ctx.adapter.getRemaining() === 14, 'getRemaining did not return gen 2 count');
    assert(ctx.adapter.isCountStale() === false, 'gen 2 count is stale');
  });

  /* ---------- Summary ---------- */
  const failed = results.filter(r => !r.pass);
  console.log('\n' + results.filter(r => r.pass).length + '/' + results.length + ' tests passed.');
  if (failed.length) {
    console.log('Failed:');
    for (const f of failed) { console.log('  - ' + f.name + ': ' + f.detail); }
  }
  /* No jsdom errors may have been recorded while loading the adapter. */
  console.log('Adapter SHA-256: ' + sha256(ADAPTER_SRC));
  process.exit(failed.length ? 1 : 0);
})();
