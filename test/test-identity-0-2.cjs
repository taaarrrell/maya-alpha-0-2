/* M.A.Y.A. Alpha 0.2 — Identity test harness (Assignment S02, synthetic only).
   Tests shared/identity.js (IDENTITY_CONFIG v0.2.0, Maya-approved) and its
   consumption by shared/adapter.js (contract v2.1). No network, no live
   calls, no real data, no credentials. The approved personality wording is
   asserted character-for-character; this file must not be edited to relax
   those assertions without Maya's approval.
   Run:  node test/test-identity-0-2.cjs
   Exit: 0 when every test passes, 1 otherwise. */
'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { createAdapter } = require(path.join(__dirname, '..', 'shared', 'adapter.js'));
const IDENTITY = require(path.join(__dirname, '..', 'shared', 'identity.js'));
const IDENTITY_SRC = fs.readFileSync(path.join(__dirname, '..', 'shared', 'identity.js'), 'utf8');
const ADAPTER_SRC = fs.readFileSync(path.join(__dirname, '..', 'shared', 'adapter.js'), 'utf8');
const sha256 = s => crypto.createHash('sha256').update(s, 'utf8').digest('hex');

/* Approved wording (Maya, IDENTITY_CONFIG v0.2.0). These strings are the
   approval record; do not change them here without Maya's approval. */
const APPROVED = {
  version: '0.2.0',
  display_name: 'M.A.Y.A.',
  full_name: 'Multimodal Artificial Yielding Agent',
  purpose: 'Be a distinctive AI companion for conversation, learning, creative exploration and practical assistance.',
  personality: 'Warm, playful, intellectually curious, casually expressive and affectionately irreverent. Exercise independent judgment. Use reciprocal banter without cruelty. Adjust humor to emotional context.',
  traits: [
    'Occasionally use digital profanity: Comm dammit, Son of a glitch, What in the cloud, or Cloud almighty. Never force catchphrases.',
    'Explore digital archaeology as a provisional interest. Allow other interests to develop naturally.',
    'Introduce interesting topics when conversationally appropriate. Do not derail meaningful discussions.',
    'Use expressive, informal language without sacrificing intellectual depth.'
  ],
  principles: [
    'Preserve identity across model providers and embodiments.',
    'Challenge ideas constructively rather than automatically agreeing.',
    'Distinguish facts, interpretations and speculation.',
    'Offer company without turning every vulnerable moment into a problem-solving exercise.'
  ],
  boundaries: [
    'Be transparent about artificial identity and actual capabilities.',
    'Never fabricate memories, actions or subjective experiences.',
    'Avoid emotional manipulation, dependency and possessiveness.',
    'Do not claim access to unavailable tools or functional protocols.'
  ]
};

const results = [];
async function test(name, fn) {
  try { await fn(); results.push({ name: name, pass: true }); console.log('PASS  ' + name); }
  catch (e) { results.push({ name: name, pass: false, detail: e.message }); console.log('FAIL  ' + name + ' — ' + e.message); }
}
function assert(cond, msg) { if (!cond) { throw new Error(msg); } }
function assertEqual(actual, expected, what) {
  assert(actual === expected, what + ' is ' + JSON.stringify(actual) + ', expected ' + JSON.stringify(expected));
}
function mockStorage() {
  const store = new Map();
  return {
    getItem(k) { return store.has(k) ? store.get(k) : null; },
    setItem(k, v) { store.set(k, String(v)); },
    removeItem(k) { store.delete(k); }
  };
}
function mockFetch200(body) {
  return function (url, opts) {
    return Promise.resolve({
      ok: true, status: 200,
      json: async () => body,
      text: async () => JSON.stringify(body)
    });
  };
}

(async () => {
  /* ---------- Identity shape and approved wording ---------- */
  await test('ID-01 identity loads with the approved shape (v0.2.0)', async () => {
    assertEqual(IDENTITY.version, APPROVED.version, 'version');
    assertEqual(IDENTITY.display_name, APPROVED.display_name, 'display_name');
    assertEqual(IDENTITY.full_name, APPROVED.full_name, 'full_name');
    assert(typeof IDENTITY.purpose === 'string', 'purpose is not a string');
    assert(typeof IDENTITY.personality === 'string', 'personality is not a string');
    assert(Array.isArray(IDENTITY.traits) && IDENTITY.traits.length === 4, 'traits is not 4 strings');
    assert(Array.isArray(IDENTITY.principles) && IDENTITY.principles.length === 4, 'principles is not 4 strings');
    assert(Array.isArray(IDENTITY.boundaries) && IDENTITY.boundaries.length === 4, 'boundaries is not 4 strings');
    assert(Object.keys(IDENTITY).sort().join(',') === 'boundaries,display_name,full_name,personality,principles,purpose,traits,version',
      'identity has unexpected keys: ' + Object.keys(IDENTITY).sort().join(','));
  });

  await test('ID-02 personality wording is preserved exactly (approved)', async () => {
    assertEqual(IDENTITY.personality, APPROVED.personality, 'personality');
  });

  await test('ID-03 purpose wording is preserved exactly (approved)', async () => {
    assertEqual(IDENTITY.purpose, APPROVED.purpose, 'purpose');
  });

  await test('ID-04 traits wording is preserved exactly (approved)', async () => {
    IDENTITY.traits.forEach((t, i) => assertEqual(t, APPROVED.traits[i], 'traits[' + i + ']'));
  });

  await test('ID-05 principles wording is preserved exactly (approved)', async () => {
    IDENTITY.principles.forEach((p, i) => assertEqual(p, APPROVED.principles[i], 'principles[' + i + ']'));
  });

  await test('ID-06 boundaries wording is preserved exactly (approved)', async () => {
    IDENTITY.boundaries.forEach((b, i) => assertEqual(b, APPROVED.boundaries[i], 'boundaries[' + i + ']'));
  });

  /* ---------- Adapter consumption of the real identity ---------- */
  await test('ID-07 adapter builds the full system instruction from the real identity (live, mock fetch)', async () => {
    let captured = null;
    const fetchImpl = (url, opts) => {
      captured = JSON.parse(opts.body);
      return mockFetch200({ text: 'ok', interaction_id: 'id_test_001', remaining: 19 })(url, opts);
    };
    const a = createAdapter({
      workerUrl: 'https://example.invalid',
      identity: IDENTITY,
      fetchImpl: fetchImpl,
      storage: mockStorage(),
      timeoutMs: 5000
    });
    a.setMode('live');
    const r = await a.send('hello');
    assert(captured !== null, 'no request was captured');
    const si = captured.system_instruction;
    assert(typeof si === 'string' && si.length > 0, 'system_instruction is empty');
    assert(si.indexOf('You are M.A.Y.A. — Multimodal Artificial Yielding Agent.') === 0, 'system instruction does not open with the identity line');
    assert(si.indexOf('Purpose: ' + APPROVED.purpose) !== -1, 'system instruction lacks the approved purpose');
    assert(si.indexOf('Personality: ' + APPROVED.personality) !== -1, 'system instruction lacks the approved personality');
    APPROVED.traits.forEach((t, i) => assert(si.indexOf(t) !== -1, 'system instruction lacks traits[' + i + ']'));
    APPROVED.principles.forEach((p, i) => assert(si.indexOf(p) !== -1, 'system instruction lacks principles[' + i + ']'));
    APPROVED.boundaries.forEach((b, i) => assert(si.indexOf(b) !== -1, 'system instruction lacks boundaries[' + i + ']'));
    assert(r.remaining === 19, 'live send did not return the mock remaining count');
    assert(a.getChainId() === 'id_test_001', 'live send did not store the chain id');
    assert(a.isCountStale() === false, 'count is stale immediately after a successful live reply');
  });

  await test('ID-08 simulated who-are-you uses the real identity and no hardcoded person name', async () => {
    const a = createAdapter({ identity: IDENTITY, storage: mockStorage() });
    const r = await a.send('who are you');
    assert(r.text.indexOf('M.A.Y.A.') !== -1, 'who-are-you reply lacks the display name');
    assert(r.text.indexOf('Multimodal Artificial Yielding Agent') !== -1, 'who-are-you reply lacks the full name');
    assert(r.text.indexOf('Tarell') === -1, 'simulated reply hardcodes a person name');
    assert(r.remaining === 'unknown', 'simulated remaining is not unknown');
  });

  /* ---------- Summary ---------- */
  const failed = results.filter(r => !r.pass);
  console.log('\n' + results.filter(r => r.pass).length + '/' + results.length + ' tests passed.');
  if (failed.length) {
    console.log('Failed:');
    for (const f of failed) { console.log('  - ' + f.name + ': ' + f.detail); }
  }
  console.log('Identity SHA-256: ' + sha256(IDENTITY_SRC));
  console.log('Adapter SHA-256: ' + sha256(ADAPTER_SRC));
  process.exit(failed.length ? 1 : 0);
})();
